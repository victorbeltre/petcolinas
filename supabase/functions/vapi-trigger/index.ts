/**
 * vapi-trigger — Edge Function que inicia una llamada SALIENTE vía Vapi.
 *
 * La app PetColinas llama a este endpoint con:
 *   { nombreMascota, nombrePropietario, telefono, motivo, contexto? }
 *
 * Pasos:
 *   1. Valida y normaliza el número a E.164.
 *   2. Construye el firstMessage según el motivo.
 *   3. Inicia la llamada con la API de Vapi.
 *   4. Crea la fila inicial en pc_llamadas (estado=pendiente) con el callId.
 *      Al colgar, vapi-tools (end-of-call-report) COMPLETA esa misma fila
 *      (resumen, transcripción, duración) enlazando por vapicallid.
 *   5. Devuelve { callId, status }.
 *
 * IMPORTANTE: el esquema de pc_llamadas es compartido con vapi-tools:
 *   vapicallid, fecha, hora, telefono, nombremascota, nombrecliente, motivo,
 *   estado, resumen, transcript, duracion, grabacionurl, citaid, origen.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPI_API_KEY = Deno.env.get("VAPI_API_KEY")!;
const VAPI_ASSISTANT_ID = Deno.env.get("VAPI_ASSISTANT_ID")!;
const VAPI_PHONE_NUMBER_ID = Deno.env.get("VAPI_PHONE_NUMBER_ID")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const TZ = "America/Santo_Domingo";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: cors });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const nombreMascota = String(body.nombreMascota ?? "").trim();
  const nombrePropietario = String(body.nombrePropietario ?? "").trim();
  let telefono = String(body.telefono ?? "").trim().replace(/\s|-/g, "");
  const motivo = String(body.motivo ?? "manual").trim();
  const contexto = String(body.contexto ?? "").trim();

  if (!nombreMascota || !telefono) {
    return json({ error: "Se requieren nombreMascota y telefono." }, 400);
  }

  // Normalizar número dominicano → E.164
  if (!telefono.startsWith("+")) {
    if (telefono.startsWith("1") && telefono.length === 11) {
      telefono = "+" + telefono;
    } else if (telefono.length === 10) {
      telefono = "+1" + telefono;
    } else if (telefono.length === 7) {
      telefono = "+1809" + telefono; // asumir Santo Domingo si solo 7 dígitos
    } else {
      telefono = "+" + telefono;
    }
  }
  const telefono10 = telefono.replace(/\D/g, "").slice(-10);

  // Primer mensaje personalizado según motivo
  const hora = new Date().getHours();
  const saludo = hora < 12 ? "Buenos días" : hora < 19 ? "Buenas tardes" : "Buenas noches";
  const primerNombre = nombrePropietario.split(" ")[0] || "señor/a";

  const firstMessageMap: Record<string, string> = {
    seguimiento: `${saludo}, ¿con ${primerNombre} hablo? Le llamo de PetColinas para dar seguimiento a ${nombreMascota}.`,
    seguimiento_vencido: `${saludo}, ¿con ${primerNombre} hablo? Le llamo de PetColinas para dar seguimiento a ${nombreMascota}.`,
    cliente_inactivo: `${saludo}, ¿con ${primerNombre} hablo? Le llamo de PetColinas para saber cómo está ${nombreMascota}.`,
    post_consulta: `${saludo}, ¿con ${primerNombre} hablo? Le llamo de PetColinas para preguntar cómo ha seguido ${nombreMascota} después de su última visita.`,
    manual: `${saludo}, ¿con ${primerNombre} hablo? Le llamo de PetColinas para hablar sobre ${nombreMascota}.`,
  };

  const firstMessage = firstMessageMap[motivo] ?? firstMessageMap.manual;

  // Llamar a la API de Vapi
  const vapiPayload = {
    assistantId: VAPI_ASSISTANT_ID,
    phoneNumberId: VAPI_PHONE_NUMBER_ID,
    customer: {
      number: telefono,
      name: nombrePropietario,
    },
    assistantOverrides: {
      firstMessage,
      variableValues: {
        nombreMascota,
        nombrePropietario,
        motivo,
        contexto,
      },
    },
    metadata: {
      nombreMascota,
      nombrePropietario,
      motivo,
      origen: "petcolinas_app",
    },
  };

  let vapiResponse: Record<string, unknown>;
  try {
    const resp = await fetch("https://api.vapi.ai/call/phone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VAPI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(vapiPayload),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Vapi error:", resp.status, errText);
      return json({ error: `Vapi error ${resp.status}: ${errText}` }, 502);
    }

    vapiResponse = await resp.json() as Record<string, unknown>;
  } catch (err) {
    console.error("Error conectando con Vapi:", err);
    return json({ error: "No se pudo conectar con Vapi." }, 502);
  }

  const callId = String(vapiResponse.id ?? "");

  // Crear fila inicial en pc_llamadas (esquema unificado). vapi-tools la completa al colgar.
  const fechaISO = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const horaRD = new Date().toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
  const { error: insErr } = await supabase.from("pc_llamadas").insert({
    vapicallid: callId,
    fecha: fechaISO,
    hora: horaRD,
    telefono: telefono10,
    nombremascota: nombreMascota,
    nombrecliente: nombrePropietario || null,
    motivo,
    estado: "pendiente",
    resumen: contexto || null,
    origen: "saliente",
  });
  if (insErr) console.error("Error creando fila en pc_llamadas:", JSON.stringify(insErr));

  return json({ callId, status: "iniciada", telefono });
});

// ---------------------------------------------------------------------------

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
