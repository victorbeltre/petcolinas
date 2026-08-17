/**
 * pagadito-cobro — genera el enlace de pago con tarjeta para una factura.
 *
 * La app NUNCA habla con Pagadito directamente: el WSK es la llave con la que
 * se autoriza cobrar dinero, y el index.html es publico. Todo pasa por aqui.
 *
 *   App  ->  esta funcion  ->  API de Pagadito
 *                ^ aqui viven UID y WSK, como secrets
 *
 * Secrets que hay que configurar en Supabase:
 *   PAGADITO_UID      — el UID del panel de Pagadito
 *   PAGADITO_WSK      — el WSK del panel de Pagadito
 *   PAGADITO_MONEDA   — "USD" o "DOP" (confirmar con Pagadito cual acepta la cuenta)
 *   PAGADITO_SANDBOX  — "1" para pruebas, "0" o sin poner para cobros reales
 *
 * Uso normal (POST):
 *   { ventaId, mascota, propietario, monto, detalle: [{ nombre, cantidad, precio }] }
 *   -> { url, ern, pagoId }   la app abre esa url o la manda por WhatsApp
 *
 * DIAGNOSTICO (GET ...?diagnostico=1):
 *   Hace solo el "connect" y devuelve TAL CUAL lo que contesto Pagadito.
 *   Sirve para confirmar credenciales y formato sin cobrarle a nadie.
 *   Nunca devuelve el WSK.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UID = Deno.env.get("PAGADITO_UID") ?? "";
const WSK = Deno.env.get("PAGADITO_WSK") ?? "";
const MONEDA = Deno.env.get("PAGADITO_MONEDA") ?? "USD";
const SANDBOX = (Deno.env.get("PAGADITO_SANDBOX") ?? "0") === "1";

// Los dos ambientes de la APIPG. Si Pagadito te da otra URL, se cambia aqui.
const ENDPOINT = SANDBOX
  ? "https://sandbox.pagadito.com/comercios/apipg/charges.php"
  : "https://comercios.pagadito.com/apipg/charges.php";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
};

/**
 * Una sola puerta hacia Pagadito. Manda el formulario y devuelve el cuerpo
 * crudo ademas del parseado: si el formato no es el esperado, el crudo es lo
 * que permite ver que paso de verdad en vez de quedarse con un null.
 */
async function pagadito(campos: Record<string, string>) {
  const body = new URLSearchParams({ format_return: "json", ...campos });
  const resp = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const crudo = await resp.text();
  let datos: Record<string, unknown> | null = null;
  try { datos = JSON.parse(crudo); } catch { /* se devuelve el crudo tal cual */ }
  return { httpStatus: resp.status, crudo, datos };
}

// Rutas conocidas de la APIPG. El diagnostico las prueba todas para no seguir
// adivinando cual usa la cuenta.
const CANDIDATOS = [
  "https://sandbox.pagadito.com/comercios/apipg/charges.php",
  "https://sandbox.pagadito.com/comercios/apipg/index.php",
  "https://sandbox.pagadito.com/comercios/apipg/",
  "https://sandbox.pagadito.com/comercios/wspg/charges.php",
  "https://comercios.pagadito.com/apipg/charges.php",
  "https://comercios.pagadito.com/apipg/index.php",
  "https://comercios.pagadito.com/apipg/",
  "https://comercios.pagadito.com/wspg/charges.php",
];

/** Un connect contra una ruta, contando TODO lo que se pueda observar. */
async function probar(u: string) {
  const t0 = Date.now();
  const body = new URLSearchParams({
    operation: "connect", uid: UID, wsk: WSK, format_return: "json",
  }).toString();
  try {
    const resp = await fetch(u, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      redirect: "manual",       // para ver la redireccion en vez de seguirla
    });
    const cuerpo = await resp.text();
    let code: string | null = null;
    try { code = String((JSON.parse(cuerpo) as Record<string, unknown>)?.code ?? "") || null; } catch { /* no era json */ }
    return {
      url: u,
      http: resp.status,
      tipo: resp.headers.get("content-type"),
      redirige: resp.headers.get("location"),
      largo: cuerpo.length,
      code,
      muestra: cuerpo.slice(0, 300),
      ms: Date.now() - t0,
    };
  } catch (e) {
    return { url: u, error: String(e).slice(0, 250), ms: Date.now() - t0 };
  }
}

async function conectar() {
  const r = await pagadito({ operation: "connect", uid: UID, wsk: WSK });
  const code = String(r.datos?.code ?? "");
  // PG1001 = conexion establecida; "value" trae el token de sesion.
  const token = code === "PG1001" ? String(r.datos?.value ?? "") : "";
  return { ...r, code, token };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);

  // ── Modo diagnostico ──────────────────────────────────────────────────────
  // Prueba TODAS las rutas conocidas de la APIPG con un connect (no cobra ni
  // escribe nada) y reporta el HTTP de cada una. Un cuerpo vacio no dice nada
  // por si solo: el status es el que distingue un 404 de una redireccion al
  // login o de un endpoint que existe pero rechazo el formato.
  if (url.searchParams.get("diagnostico") === "1") {
    if (!UID || !WSK) {
      return json({
        ok: false,
        problema: "Faltan los secrets PAGADITO_UID y/o PAGADITO_WSK en Supabase.",
      }, 400);
    }
    const resultados = [];
    for (const u of CANDIDATOS) resultados.push(await probar(u));
    const gana = resultados.find((r) => r.code);
    return json({
      ok: !!gana,
      endpoint_configurado: ENDPOINT,
      ambiente: SANDBOX ? "SANDBOX (pruebas)" : "PRODUCCION (cobros reales)",
      moneda_configurada: MONEDA,
      uid_usado: UID.slice(0, 6) + "…" + UID.slice(-4),   // nunca completo
      wsk_configurado: WSK ? "si (" + WSK.length + " caracteres)" : "NO",
      endpoint_que_responde: gana ? gana.url : null,
      codigo_pagadito: gana ? gana.code : null,
      pruebas: resultados,
      que_significa: gana
        ? "Funciona en " + gana.url + " con codigo " + gana.code +
          (String(gana.code) === "PG1001" ? ". Credenciales OK." : ". Revisa ese codigo: el endpoint sirve pero algo del connect no le gusto.")
        : "Ninguna ruta contesto un JSON con 'code'. Mira el campo http de cada prueba: " +
          "404 = la ruta no existe; 301/302 = redirige (mira 'redirige'); 200 con cuerpo vacio = " +
          "existe pero no acepto los parametros; error = ni resolvio el dominio.",
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: cors });
  }
  // Esta funcion se despliega SIN verificacion de JWT, porque el modo
  // diagnostico se abre desde el navegador. Para que nadie pueda generar
  // cobros a lo loco, el POST si exige que venga la cabecera de la app.
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ") || auth.length < 30) {
    return json({ error: "Falta la autorizacion. Este endpoint solo se llama desde la app." }, 401);
  }
  if (!UID || !WSK) {
    return json({ error: "Faltan los secrets PAGADITO_UID / PAGADITO_WSK." }, 500);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "JSON invalido" }, 400); }

  const ventaId = String(body.ventaId ?? "").trim();
  const mascota = String(body.mascota ?? "").trim();
  const propietario = String(body.propietario ?? "").trim();
  const monto = Number(body.monto ?? 0);
  const detalle = Array.isArray(body.detalle) ? body.detalle : [];

  if (!(monto > 0)) return json({ error: "El monto debe ser mayor que cero." }, 400);

  // ERN: la referencia con la que Pagadito identifica el cobro. Se le pega el
  // reloj para que un reintento no choque con el intento anterior.
  const ern = "PC-" + (ventaId || "X") + "-" + Date.now().toString().slice(-6);

  // Se registra ANTES de mandar a Pagadito. Si el cliente paga y la respuesta
  // se pierde en el camino, la fila ya existe y el retorno la puede completar.
  const pagoId = Date.now();
  await supabase.from("pc_pagos_online").insert({
    id: pagoId,
    ern,
    ventaid: ventaId || null,
    mascota: mascota || null,
    propietario: propietario || null,
    monto,
    moneda: MONEDA,
    estado: "iniciado",
    creadoen: new Date().toISOString(),
  });

  const c = await conectar();
  if (!c.token) {
    await supabase.from("pc_pagos_online")
      .update({ estado: "error", detalle: c.crudo.slice(0, 800) })
      .eq("id", pagoId);
    return json({
      error: "Pagadito no acepto la conexion.",
      codigo: c.code,
      respuesta: c.crudo.slice(0, 800),
    }, 502);
  }

  const lineas = (detalle.length ? detalle : [{ nombre: "Servicios PetColinas", cantidad: 1, precio: monto }])
    .map((it: Record<string, unknown>) => ({
      quantity: Number(it.cantidad ?? 1) || 1,
      description: String(it.nombre ?? "Servicio").slice(0, 60),
      price: Number(it.precio ?? 0),
      url_product: "https://victorbeltre.github.io/petcolinas/",
    }));

  const t = await pagadito({
    operation: "exec_trans",
    token: c.token,
    ern,
    amount: monto.toFixed(2),
    currency: MONEDA,
    details: JSON.stringify(lineas),
    custom_params: JSON.stringify({ param1: mascota, param2: propietario, param3: ventaId }),
  });

  const code = String(t.datos?.code ?? "");
  // PG1002 = transaccion registrada; "value" trae la URL a la que va el cliente.
  const urlPago = code === "PG1002" ? String(t.datos?.value ?? "") : "";

  if (!urlPago) {
    await supabase.from("pc_pagos_online")
      .update({ estado: "error", detalle: t.crudo.slice(0, 800) })
      .eq("id", pagoId);
    return json({
      error: "Pagadito no genero el enlace de pago.",
      codigo: code,
      respuesta: t.crudo.slice(0, 800),
    }, 502);
  }

  await supabase.from("pc_pagos_online")
    .update({ estado: "pendiente", url: urlPago })
    .eq("id", pagoId);

  return json({ url: urlPago, ern, pagoId, moneda: MONEDA, monto });
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}
