/**
 * pagadito-retorno — a donde vuelve el cliente despues de pagar.
 *
 * Esta es la URL que va en "URL de Retorno" del panel de Pagadito.
 *
 * NO se confia en lo que venga por la direccion: se le vuelve a preguntar a
 * Pagadito con get_status antes de dar nada por pagado. Si no, cualquiera
 * podria escribir la URL a mano y aparecer como que pago.
 *
 * Protocolo: WSPG, SOAP RPC/encoded. soapAction = urn:ws#<operacion>
 *   connect(uid, wsk, format_return)              -> PG1001 + token
 *   get_status(token, token_trans, format_return)  -> estado + referencia
 *
 * Se despliega SIN verificacion de JWT: el navegador del cliente entra aqui
 * sin ningun token nuestro.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const UID = Deno.env.get("PAGADITO_UID") ?? "";
const WSK = Deno.env.get("PAGADITO_WSK") ?? "";

const SOAP_URL = "https://comercios.pagadito.com/wspg/charges.php?utf8_enc";
const NS = "urn:https://comercios.pagadito.com/wspg/charges";
const APP = "https://victorbeltre.github.io/petcolinas/";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const desesc = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&amp;/g, "&");

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
  return { code: String(datos.code ?? ""), value: datos.value, retorno };
}

/** El estado puede venir como objeto en 'value' o suelto. Se aceptan los dos. */
function leerEstado(value: unknown, retorno: string) {
  let v: Record<string, unknown> = {};
  if (value && typeof value === "object") v = value as Record<string, unknown>;
  else if (typeof value === "string") { try { v = JSON.parse(value); } catch { /* era texto */ } }
  if (!v.status) { try { v = { ...JSON.parse(retorno), ...v }; } catch { /* nada */ } }
  return {
    estado: String(v.status ?? "").toUpperCase(),
    referencia: String(v.reference ?? ""),
    fecha: String(v.date_trans ?? ""),
  };
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  // Pagadito devuelve el token de la transaccion; el nombre varia, se aceptan
  // los que usa.
  const tokenTrans = url.searchParams.get("token_trans")
    ?? url.searchParams.get("token") ?? url.searchParams.get("tkn") ?? "";
  const ernUrl = url.searchParams.get("ern") ?? "";

  if (!tokenTrans) {
    return pagina("No pudimos identificar el pago",
      "Si ya pagaste, escríbenos por WhatsApp y lo confirmamos a mano.", false);
  }

  const c = await soap("connect", [["uid", UID], ["wsk", WSK], ["format_return", "json"]]);
  if (c.code !== "PG1001" || !c.value) {
    await marcar(ernUrl, tokenTrans, "revisar", "no se pudo conectar a Pagadito");
    return pagina("Recibimos tu pago",
      "Lo estamos confirmando. Si algo falta te escribimos.", true);
  }

  const s = await soap("get_status", [
    ["token", String(c.value)], ["token_trans", tokenTrans], ["format_return", "json"],
  ]);
  const { estado, referencia, fecha } = leerEstado(s.value, s.retorno);

  // El ern puede no venir en la URL: se busca por el token de la transaccion.
  let ern = ernUrl;
  if (!ern) {
    const { data } = await supabase.from("pc_pagos_online")
      .select("ern").eq("tokentrans", tokenTrans).maybeSingle();
    ern = data?.ern ?? "";
  }

  if (estado === "COMPLETED") {
    await marcar(ern, tokenTrans, "pagado", [referencia, fecha].filter(Boolean).join(" · "));
    // Cerrar la venta: deja de estar pendiente de cobro.
    const { data: pago } = await supabase.from("pc_pagos_online")
      .select("ventaid").eq("ern", ern).maybeSingle();
    if (pago?.ventaid) {
      await supabase.from("pc_ventas")
        .update({ formapago: "Tarjeta (Pagadito)" }).eq("id", pago.ventaid);
    }
    return pagina("¡Pago recibido!",
      "Gracias por confiar en PetColinas. Ya quedó registrado en tu cuenta.", true);
  }

  if (estado === "REGISTERED" || estado === "PENDING") {
    await marcar(ern, tokenTrans, "pendiente", estado);
    return pagina("Tu pago está en proceso",
      "En cuanto el banco lo confirme lo vas a ver reflejado.", true);
  }

  await marcar(ern, tokenTrans, "fallido", estado || s.retorno.slice(0, 200));
  return pagina("El pago no se completó",
    "No se te cobró nada. Puedes intentarlo de nuevo o pagar en la clínica.", false);
});

async function marcar(ern: string, tokenTrans: string, estado: string, detalle: string) {
  if (!ern) return;
  await supabase.from("pc_pagos_online")
    .update({ estado, tokentrans: tokenTrans, detalle, cerradoen: new Date().toISOString() })
    .eq("ern", ern);
}

function pagina(titulo: string, texto: string, ok: boolean) {
  const color = ok ? "#1a6b3a" : "#b8232a";
  return new Response(
    `<!doctype html><html lang="es"><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>PetColinas</title></head>
     <body style="margin:0;font-family:system-ui,-apple-system,sans-serif;background:#f0f4f8;
                  display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px">
       <div style="background:#fff;border-radius:16px;padding:36px 30px;max-width:420px;text-align:center;
                   box-shadow:0 10px 40px rgba(0,0,0,.12)">
         <div style="font-size:46px">${ok ? "✅" : "⚠️"}</div>
         <h1 style="font-size:21px;color:${color};margin:14px 0 8px">${titulo}</h1>
         <p style="font-size:15px;color:#5a6472;line-height:1.5;margin:0 0 22px">${texto}</p>
         <a href="${APP}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;
            border-radius:9px;padding:12px 22px;font-weight:700;font-size:14px">\u{1F43E} PetColinas</a>
       </div></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
