/**
 * pagadito-cobro — genera el enlace de pago con tarjeta para una factura.
 *
 * La app NUNCA habla con Pagadito: el WSK autoriza cobrar dinero y el
 * index.html es publico. Todo pasa por aqui, donde vive como secret.
 *
 * Protocolo: WSPG, SOAP estilo RPC/encoded (NuSOAP).
 *   endpoint    https://comercios.pagadito.com/wspg/charges.php?utf8_enc
 *   namespace   urn:https://comercios.pagadito.com/wspg/charges
 *   soapAction  urn:ws#<operacion>     <- ojo: NO es el namespace
 *   connect(uid, wsk, format_return)                       -> PG1001 + token
 *   exec_trans(token, ern, amount, details, format_return,
 *              currency, custom_params,
 *              allow_pending_payments)                     -> PG1002 + url
 *
 * Secrets:
 *   PAGADITO_UID, PAGADITO_WSK, PAGADITO_MONEDA (DOP o USD)
 *
 * Se despliega SIN verificacion de JWT, asi que el POST exige la cabecera
 * Authorization que manda la app.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const UID = Deno.env.get("PAGADITO_UID") ?? "";
const WSK = Deno.env.get("PAGADITO_WSK") ?? "";
const MONEDA = Deno.env.get("PAGADITO_MONEDA") ?? "DOP";
// Lo que cobra Pagadito por procesar la transaccion. Se lo pasa al cliente
// como recargo visible, no lo absorbe PetColinas. Se calcula aqui, nunca en
// el navegador, para que no se pueda manipular desde la app.
const RECARGO_PCT = Number(Deno.env.get("PAGADITO_RECARGO_PCT") ?? "6") / 100;

const SOAP_URL = "https://comercios.pagadito.com/wspg/charges.php?utf8_enc";
const NS = "urn:https://comercios.pagadito.com/wspg/charges";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
};

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const desesc = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&amp;/g, "&");

/** Una llamada SOAP a WSPG. Devuelve el <return> ya parseado. */
async function soap(op: string, partes: Array<[string, string]>) {
  const cuerpo = partes.map(([n, v]) => `<${n} xsi:type="xsd:string">${esc(v)}</${n}>`).join("");
  const env = `<?xml version="1.0" encoding="UTF-8"?>` +
    `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"` +
    ` xmlns:xsd="http://www.w3.org/2001/XMLSchema"` +
    ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"` +
    ` xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/"` +
    ` xmlns:tns="${NS}"` +
    ` SOAP-ENV:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
    `<SOAP-ENV:Body><tns:${op}>${cuerpo}</tns:${op}></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
  const resp = await fetch(SOAP_URL, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", "SOAPAction": "urn:ws#" + op },
    body: env,
  });
  const xml = await resp.text();
  const m = xml.match(/<return[^>]*>([\s\S]*?)<\/return>/);
  const retorno = m ? desesc(m[1]).trim() : "";
  let datos: Record<string, unknown> = {};
  try { datos = retorno ? JSON.parse(retorno) : {}; } catch { /* no era json */ }
  const falla = (xml.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/) || [])[1] ?? null;
  return { code: String(datos.code ?? ""), valor: String(datos.value ?? ""), mensaje: String(datos.message ?? ""), falla, retorno };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ") || auth.length < 30) {
    return json({ error: "Falta la autorizacion. Este endpoint solo se llama desde la app." }, 401);
  }
  if (!UID || !WSK) return json({ error: "Faltan los secrets PAGADITO_UID / PAGADITO_WSK." }, 500);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "JSON invalido" }, 400); }

  const ventaId = String(body.ventaId ?? "").trim();
  const mascota = String(body.mascota ?? "").trim();
  const propietario = String(body.propietario ?? "").trim();
  const subtotal = Number(body.monto ?? 0);
  const detalle = Array.isArray(body.detalle) ? body.detalle : [];
  if (!(subtotal > 0)) return json({ error: "El monto debe ser mayor que cero." }, 400);

  // El 6% de Pagadito lo paga el cliente que usa la tarjeta, no PetColinas.
  // Se calcula sobre el subtotal y se manda como una linea de detalle mas,
  // asi la suma de lineas siempre cuadra con el "amount" que se le manda a
  // Pagadito (un descuadre ahi fue justo lo que tumbo la primera prueba).
  const recargo = Math.round(subtotal * RECARGO_PCT * 100) / 100;
  const monto = Math.round((subtotal + recargo) * 100) / 100;

  // ERN: la referencia con la que Pagadito identifica el cobro. Se le pega el
  // reloj para que un reintento no choque con el intento anterior.
  const ern = "PC-" + (ventaId || "X") + "-" + Date.now().toString().slice(-6);

  // Se registra ANTES de mandar a Pagadito. Si el cliente paga y la respuesta
  // se pierde en el camino, la fila ya existe y el retorno la puede completar.
  const pagoId = Date.now();
  await supabase.from("pc_pagos_online").insert({
    id: pagoId, ern, ventaid: ventaId || null, mascota: mascota || null,
    propietario: propietario || null, monto, subtotal, recargo, moneda: MONEDA,
    estado: "iniciado", creadoen: new Date().toISOString(),
  });

  const c = await soap("connect", [["uid", UID], ["wsk", WSK], ["format_return", "json"]]);
  if (c.code !== "PG1001" || !c.valor) {
    await supabase.from("pc_pagos_online")
      .update({ estado: "error", detalle: (c.falla || c.retorno || "").slice(0, 800) }).eq("id", pagoId);
    return json({ error: "Pagadito no acepto la conexion.", codigo: c.code, mensaje: c.mensaje, respuesta: c.retorno.slice(0, 500) }, 502);
  }
  const token = c.valor;

  const lineas = (detalle.length ? detalle : [{ nombre: "Servicios PetColinas", cantidad: 1, precio: subtotal }])
    .map((it: Record<string, unknown>) => ({
      quantity: Number(it.cantidad ?? 1) || 1,
      description: String(it.nombre ?? "Servicio").slice(0, 120),
      price: Number(it.precio ?? 0),
      url_product: "https://victorbeltre.github.io/petcolinas/",
    }));
  if (recargo > 0) {
    lineas.push({
      quantity: 1,
      description: "Cargo por procesamiento con tarjeta (" + (RECARGO_PCT * 100).toFixed(0) + "%)",
      price: recargo,
      url_product: "https://victorbeltre.github.io/petcolinas/",
    });
  }

  const t = await soap("exec_trans", [
    ["token", token], ["ern", ern], ["amount", monto.toFixed(2)],
    ["details", JSON.stringify(lineas)], ["format_return", "json"],
    ["currency", MONEDA],
    ["custom_params", JSON.stringify({ param1: mascota, param2: propietario, param3: ventaId })],
    ["allow_pending_payments", "false"],
  ]);

  if (t.code !== "PG1002" || !t.valor) {
    await supabase.from("pc_pagos_online")
      .update({ estado: "error", detalle: (t.falla || t.retorno || "").slice(0, 800) }).eq("id", pagoId);
    return json({ error: "Pagadito no genero el enlace de pago.", codigo: t.code, mensaje: t.mensaje, respuesta: t.retorno.slice(0, 500) }, 502);
  }

  await supabase.from("pc_pagos_online")
    .update({ estado: "pendiente", url: t.valor, tokentrans: token }).eq("id", pagoId);

  return json({ url: t.valor, ern, pagoId, moneda: MONEDA, subtotal, recargo, monto });
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}
