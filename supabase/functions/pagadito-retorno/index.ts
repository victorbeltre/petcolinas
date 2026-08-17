/**
 * pagadito-retorno — a donde vuelve el cliente despues de pagar.
 *
 * Esta es la URL que hay que poner como "URL de retorno" en el panel de
 * Pagadito. Pagadito manda aqui al cliente con el token de la transaccion;
 * la funcion le pregunta a Pagadito como quedo, marca la venta como cobrada y
 * le muestra al cliente una pagina de gracias.
 *
 * IMPORTANTE: no se confia en lo que venga por la URL para dar por pagado
 * nada. Se vuelve a preguntar a Pagadito con get_status; si no, cualquiera
 * podria escribir la direccion a mano y aparecer como que pago.
 *
 * Secrets: los mismos de pagadito-cobro.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UID = Deno.env.get("PAGADITO_UID") ?? "";
const WSK = Deno.env.get("PAGADITO_WSK") ?? "";
const SANDBOX = (Deno.env.get("PAGADITO_SANDBOX") ?? "0") === "1";

const ENDPOINT = SANDBOX
  ? "https://sandbox.pagadito.com/comercios/apipg/charges.php"
  : "https://comercios.pagadito.com/apipg/charges.php";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const APP = "https://victorbeltre.github.io/petcolinas/";

async function pagadito(campos: Record<string, string>) {
  const resp = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ format_return: "json", ...campos }).toString(),
  });
  const crudo = await resp.text();
  try { return { crudo, datos: JSON.parse(crudo) as Record<string, unknown> }; }
  catch { return { crudo, datos: null }; }
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  // Pagadito devuelve el token de la transaccion; los nombres varian segun el
  // ambiente, asi que se aceptan los tres que usa.
  const tokenTrans = url.searchParams.get("token_trans")
    ?? url.searchParams.get("token")
    ?? url.searchParams.get("tkn")
    ?? "";
  const ern = url.searchParams.get("ern") ?? "";

  if (!tokenTrans) return pagina("No pudimos identificar el pago", "Si ya pagaste, escríbenos por WhatsApp y lo confirmamos a mano.", false);

  // 1. Conectar y preguntar el estado real.
  const c = await pagadito({ operation: "connect", uid: UID, wsk: WSK });
  const token = String(c.datos?.code ?? "") === "PG1001" ? String(c.datos?.value ?? "") : "";
  if (!token) {
    await marcar(ern, tokenTrans, "revisar", c.crudo.slice(0, 500));
    return pagina("Recibimos tu pago", "Lo estamos confirmando. Si algo falta te escribimos.", true);
  }

  const s = await pagadito({ operation: "get_status", token, token_trans: tokenTrans });
  const valor = (s.datos?.value ?? {}) as Record<string, unknown>;
  const estado = String(valor.status ?? "").toUpperCase();
  const referencia = String(valor.reference ?? "");

  if (estado === "COMPLETED") {
    await marcar(ern, tokenTrans, "pagado", referencia);
    // Cerrar la venta: deja de estar pendiente de cobro.
    const { data: pago } = await supabase.from("pc_pagos_online")
      .select("ventaid, monto").eq("ern", ern).maybeSingle();
    if (pago?.ventaid) {
      await supabase.from("pc_ventas")
        .update({ formapago: "Tarjeta (Pagadito)" })
        .eq("id", pago.ventaid);
    }
    return pagina("¡Pago recibido!", "Gracias por confiar en PetColinas. Ya quedó registrado en tu cuenta.", true);
  }

  await marcar(ern, tokenTrans, estado === "REGISTERED" ? "pendiente" : "fallido", s.crudo.slice(0, 500));
  return estado === "REGISTERED"
    ? pagina("Tu pago está en proceso", "En cuanto el banco lo confirme lo vas a ver reflejado.", true)
    : pagina("El pago no se completó", "No se te cobró nada. Puedes intentarlo de nuevo o pagar en la clínica.", false);
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
