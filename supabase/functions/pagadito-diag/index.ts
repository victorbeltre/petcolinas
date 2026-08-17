/**
 * pagadito-diag — valida el protocolo REAL de Pagadito antes de tocar el cobro.
 *
 * Lo que aprendimos del WSDL y de la documentacion:
 *   - La "APIPG" no es una API web: son las funciones de una clase PHP/Java.
 *     Por eso apipg/charges.php devolvia 200 con cuerpo vacio.
 *   - El protocolo de verdad es WSPG, SOAP estilo RPC/encoded (NuSOAP).
 *     Endpoint:  https://comercios.pagadito.com/wspg/charges.php?utf8_enc
 *     Namespace: urn:https://comercios.pagadito.com/wspg/charges
 *
 * Esta funcion hace el flujo completo SIN mover dinero:
 *   1. Lee el WSDL y saca el soapAction de cada operacion (cero adivinanza).
 *   2. connect  -> debe dar PG1001 y un token.
 *   3. get_exchange_rate DOP -> para saber como trata la moneda dominicana.
 *   4. exec_trans de prueba -> solo REGISTRA y devuelve la URL de pago.
 *      Nadie paga nada si no se abre esa URL y se mete una tarjeta.
 *
 * Se borra en cuanto la integracion quede andando.
 * Desplegar SIN verificacion de JWT.
 */

const UID = Deno.env.get("PAGADITO_UID") ?? "";
const WSK = Deno.env.get("PAGADITO_WSK") ?? "";
const MONEDA = Deno.env.get("PAGADITO_MONEDA") ?? "USD";

const SOAP_URL = "https://comercios.pagadito.com/wspg/charges.php?utf8_enc";
const WSDL_URL = "https://comercios.pagadito.com/wspg/charges.php?wsdl";
const NS = "urn:https://comercios.pagadito.com/wspg/charges";

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const desesc = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&amp;/g, "&");

/** El soapAction de cada operacion, sacado del propio WSDL. */
async function acciones(): Promise<Record<string, string>> {
  const r = await fetch(WSDL_URL);
  const xml = await r.text();
  const mapa: Record<string, string> = {};
  const re = /<(?:wsdl:)?operation\s+name="([^"]+)"[\s\S]{0,500}?soapAction="([^"]*)"/g;
  for (const m of xml.matchAll(re)) if (!mapa[m[1]]) mapa[m[1]] = m[2];
  return mapa;
}

/** Una llamada SOAP RPC/encoded. Devuelve el <return> ya parseado. */
async function soap(op: string, partes: Array<[string, string]>, accion: string) {
  const cuerpo = partes.map(([n, v]) => `<${n} xsi:type="xsd:string">${esc(v)}</${n}>`).join("");
  const env = `<?xml version="1.0" encoding="UTF-8"?>` +
    `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"` +
    ` xmlns:xsd="http://www.w3.org/2001/XMLSchema"` +
    ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"` +
    ` xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/"` +
    ` xmlns:tns="${NS}"` +
    ` SOAP-ENV:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
    `<SOAP-ENV:Body><tns:${op}>${cuerpo}</tns:${op}></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
  try {
    const resp = await fetch(SOAP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", "SOAPAction": accion },
      body: env,
    });
    const xml = await resp.text();
    const m = xml.match(/<return[^>]*>([\s\S]*?)<\/return>/);
    const retorno = m ? desesc(m[1]).trim() : null;
    let datos: Record<string, unknown> | null = null;
    try { datos = retorno ? JSON.parse(retorno) : null; } catch { /* no era json */ }
    const falla = (xml.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/) || [])[1] ?? null;
    return { op, accion, http: resp.status, falla, retorno, datos, xml: xml.slice(0, 900) };
  } catch (e) {
    return { op, accion, error: String(e).slice(0, 250) };
  }
}

Deno.serve(async () => {
  const salida: Record<string, unknown> = {
    credenciales: {
      uid: UID ? UID.slice(0, 6) + "…" + UID.slice(-4) : "FALTA",
      wsk: WSK ? WSK.length + " caracteres" : "FALTA",
    },
    endpoint: SOAP_URL,
    moneda_configurada: MONEDA,
  };

  const acc = await acciones();
  salida.soapAction_del_wsdl = acc;

  // 1. connect
  const c = await soap("connect", [
    ["uid", UID], ["wsk", WSK], ["format_return", "json"],
  ], acc.connect ?? (NS + "#connect"));
  salida.paso1_connect = c;

  const code = String((c as Record<string, unknown>).datos
    ? ((c as { datos: Record<string, unknown> }).datos.code ?? "") : "");
  const token = code === "PG1001"
    ? String(((c as { datos: Record<string, unknown> }).datos.value ?? "")) : "";
  salida.token_obtenido = token ? "SI (" + token.length + " caracteres)" : "no";

  if (!token) {
    salida.conclusion = "El connect no dio token. Mira paso1_connect: 'falla' es el error SOAP, " +
      "'retorno' es lo que contesto Pagadito, 'xml' es la respuesta cruda.";
    return json(salida);
  }

  // 2. tasa de cambio del peso dominicano
  salida.paso2_tasa_dop = await soap("get_exchange_rate", [
    ["token", token], ["currency", "DOP"], ["format_return", "json"],
  ], acc.get_exchange_rate ?? (NS + "#get_exchange_rate"));

  // 3. exec_trans de prueba. SOLO registra la transaccion y devuelve la URL
  //    de pago. No se cobra nada si nadie abre esa URL y pone una tarjeta.
  const ern = "PC-DIAG-" + Date.now().toString().slice(-8);
  const detalles = JSON.stringify([{
    quantity: 1,
    description: "Prueba de conexion PetColinas",
    price: 1.00,
    url_product: "https://victorbeltre.github.io/petcolinas/",
  }]);
  const t = await soap("exec_trans", [
    ["token", token], ["ern", ern], ["amount", "1.00"], ["details", detalles],
    ["format_return", "json"], ["currency", MONEDA], ["custom_params", "{}"],
    ["allow_pending_payments", "false"],
  ], acc.exec_trans ?? (NS + "#exec_trans"));
  salida.paso3_exec_trans = t;
  salida.ern_de_prueba = ern;

  const td = (t as Record<string, unknown>).datos as Record<string, unknown> | null;
  const codeT = String(td?.code ?? "");
  salida.url_de_pago = codeT === "PG1002" ? String(td?.value ?? "") : null;
  salida.conclusion = codeT === "PG1002"
    ? "TODO FUNCIONA. connect y exec_trans OK. En 'url_de_pago' esta el enlace de la prueba de RD$1/US$1 (no se cobro nada)."
    : "El connect funciono pero exec_trans dio '" + (codeT || "sin code") + "'. Mira paso3_exec_trans.";

  return json(salida);
});

function json(d: unknown) {
  return new Response(JSON.stringify(d, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
}
