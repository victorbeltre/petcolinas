/**
 * meta-leads — Webhook de Meta Lead Ads (Clientes potenciales).
 *
 * Meta llama a esta función cada vez que entra un lead nuevo desde un formulario
 * instantáneo de Facebook/Instagram. La función:
 *   1. Responde la verificación del webhook (GET hub.challenge).
 *   2. En cada lead (POST): lee el leadgen_id, consulta los datos del lead a la
 *      Graph API con el token de la Página, mapea nombre/teléfono/email, decide
 *      la vacante (puesto) y lo inserta en pc_candidatos (sin duplicar).
 *
 * Variables de entorno (Supabase → Edge Functions → Secrets):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (ya existen)
 *   META_VERIFY_TOKEN   — texto que tú inventas; el mismo que pones en Meta.
 *   META_PAGE_TOKEN     — token de la Página con permiso leads_retrieval.
 *   META_APP_SECRET     — (opcional) para validar la firma X-Hub-Signature-256.
 *   META_FORM_MAP       — (opcional) JSON { "FORM_ID": "vet"|"groomer"|"recepcion" }.
 *   META_DEFAULT_PUESTO — (opcional) puesto por defecto si no se detecta (def. "vet").
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") ?? "";
const PAGE_TOKEN = Deno.env.get("META_PAGE_TOKEN") ?? "";
const APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const DEFAULT_PUESTO = Deno.env.get("META_DEFAULT_PUESTO") ?? "vet";
let FORM_MAP: Record<string, string> = {};
try { FORM_MAP = JSON.parse(Deno.env.get("META_FORM_MAP") ?? "{}"); } catch { FORM_MAP = {}; }

const GRAPH = "https://graph.facebook.com/v21.0";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // Verificación del webhook (Meta hace un GET al configurarlo)
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const raw = await req.text();

  // Validar firma si hay APP_SECRET configurado
  if (APP_SECRET) {
    const sig = req.headers.get("x-hub-signature-256") ?? "";
    const ok = await verificarFirma(raw, sig, APP_SECRET);
    if (!ok) {
      console.error("Firma X-Hub-Signature-256 inválida");
      return new Response("Invalid signature", { status: 401 });
    }
  }

  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }

  try {
    const entries = (body.entry as Array<Record<string, unknown>>) ?? [];
    for (const entry of entries) {
      const changes = (entry.changes as Array<Record<string, unknown>>) ?? [];
      for (const ch of changes) {
        if (ch.field !== "leadgen") continue;
        const value = (ch.value as Record<string, unknown>) ?? {};
        const leadId = String(value.leadgen_id ?? "");
        const formId = String(value.form_id ?? "");
        if (leadId) await procesarLead(leadId, formId);
      }
    }
  } catch (e) {
    console.error("meta-leads error procesando:", String(e));
  }

  // Meta espera 200 rápido; siempre respondemos ok.
  return new Response("EVENT_RECEIVED", { status: 200 });
});

// ---------------------------------------------------------------------------

async function procesarLead(leadId: string, formId: string): Promise<void> {
  // Evitar duplicados (Meta puede reintentar el mismo lead)
  const { data: exist } = await supabase
    .from("pc_candidatos")
    .select("id")
    .eq("metaleadid", leadId)
    .limit(1);
  if (exist && exist.length > 0) {
    console.log("Lead ya registrado, se ignora:", leadId);
    return;
  }

  if (!PAGE_TOKEN) {
    console.error("Falta META_PAGE_TOKEN; no puedo leer los datos del lead.");
    return;
  }

  // Traer datos del lead desde la Graph API
  const resp = await fetch(`${GRAPH}/${leadId}?fields=field_data,created_time,form_id&access_token=${encodeURIComponent(PAGE_TOKEN)}`);
  if (!resp.ok) {
    console.error("Graph API lead error:", resp.status, await resp.text());
    return;
  }
  const lead = await resp.json() as Record<string, unknown>;
  const fields = (lead.field_data as Array<{ name: string; values: string[] }>) ?? [];

  const dict: Record<string, string> = {};
  for (const f of fields) {
    const k = String(f.name ?? "").toLowerCase();
    dict[k] = Array.isArray(f.values) ? String(f.values[0] ?? "").trim() : "";
  }
  const pick = (...keys: string[]) => { for (const k of keys) { if (dict[k]) return dict[k]; } return ""; };

  const nombre = pick("full_name", "nombre_completo", "nombre", "name") ||
    [pick("first_name", "nombre"), pick("last_name", "apellido")].filter(Boolean).join(" ").trim() ||
    "(sin nombre)";
  const telefono = pick("phone_number", "telefono", "teléfono", "numero_de_telefono", "número_de_teléfono").replace(/\s/g, "");
  const email = pick("email", "correo", "correo_electrónico", "correo_electronico");

  // Resto de respuestas (preguntas personalizadas) → resumen para Laura
  const estandar = new Set(["full_name", "first_name", "last_name", "name", "nombre", "apellido", "nombre_completo", "phone_number", "telefono", "teléfono", "numero_de_telefono", "número_de_teléfono", "email", "correo", "correo_electrónico", "correo_electronico"]);
  const extras = fields
    .filter((f) => !estandar.has(String(f.name ?? "").toLowerCase()) && f.values && f.values[0])
    .map((f) => `${f.name}: ${f.values[0]}`)
    .join(" · ");

  const puesto = await detectarPuesto(formId);

  const { error } = await supabase.from("pc_candidatos").insert({
    id: Date.now(),
    metaleadid: leadId,
    puesto,
    nombre,
    telefono: telefono || null,
    email: email || null,
    tier: "revisar",
    estado: "Por contactar",
    notas: "",
    evalt: extras || "Lead de Meta (formulario instantáneo).",
    origen: "meta",
  });

  if (error) console.error("Error insertando lead en pc_candidatos:", JSON.stringify(error));
  else console.log("Lead Meta guardado:", nombre, telefono, "puesto:", puesto);
}

// Decide la vacante por: mapa por form_id, luego heurística por nombre del formulario, luego default.
async function detectarPuesto(formId: string): Promise<string> {
  if (formId && FORM_MAP[formId]) return FORM_MAP[formId];
  if (formId && PAGE_TOKEN) {
    try {
      const r = await fetch(`${GRAPH}/${formId}?fields=name&access_token=${encodeURIComponent(PAGE_TOKEN)}`);
      if (r.ok) {
        const f = await r.json() as Record<string, unknown>;
        const n = String(f.name ?? "").toLowerCase();
        if (/groom|peluquer|estilis/.test(n)) return "groomer";
        if (/recepci|ventas|cajer|atenci/.test(n)) return "recepcion";
        if (/veterinar|m[eé]dic/.test(n)) return "vet";
      }
    } catch { /* usar default */ }
  }
  return DEFAULT_PUESTO;
}

async function verificarFirma(raw: string, header: string, secret: string): Promise<boolean> {
  try {
    const expected = header.replace("sha256=", "").trim();
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
    const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
    return hex === expected;
  } catch {
    return false;
  }
}
