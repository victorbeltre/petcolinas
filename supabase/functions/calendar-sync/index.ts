/**
 * calendar-sync — Sincroniza la Agenda de PetColinas (pc_citas) con Google Calendar
 * en AMBOS SENTIDOS, usando una cuenta de servicio de Google.
 *
 *   app  → Calendar : cita creada/editada/cancelada en la app (o por Sofía) se
 *                     crea, actualiza o borra como evento del calendario.
 *   Calendar → app  : evento creado o movido en Google Calendar baja a pc_citas.
 *
 * Resolución de conflictos: gana el último cambio. Cada cita guarda cuándo se
 * sincronizó por última vez (gcalsync); si desde entonces cambió la cita se
 * empuja, y si cambió el evento se baja.
 *
 * Variables de entorno (Supabase → Edge Functions → Secrets):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (ya existen)
 *   GOOGLE_SA_EMAIL      — client_email del JSON de la cuenta de servicio.
 *   GOOGLE_SA_KEY        — private_key del JSON (con los \n tal cual vienen).
 *   GOOGLE_CALENDAR_ID   — normalmente petcolinasrd@gmail.com
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SA_EMAIL = Deno.env.get("GOOGLE_SA_EMAIL") ?? "";
const SA_KEY = (Deno.env.get("GOOGLE_SA_KEY") ?? "").replace(/\\n/g, "\n");
const CALENDAR_ID = Deno.env.get("GOOGLE_CALENDAR_ID") ?? "petcolinasrd@gmail.com";

const TZ = "America/Santo_Domingo";
const CAL = "https://www.googleapis.com/calendar/v3/calendars/" + encodeURIComponent(CALENDAR_ID);
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

// ---------------------------------------------------------------------------
// Autenticación: JWT firmado con la llave de la cuenta de servicio → access token

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken(): Promise<string> {
  if (!SA_EMAIL || !SA_KEY) throw new Error("Faltan GOOGLE_SA_EMAIL o GOOGLE_SA_KEY");
  const now = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();
  const head = b64url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64url(enc.encode(JSON.stringify({
    iss: SA_EMAIL,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })));
  const pem = SA_KEY.replace(/-----[A-Z ]+-----/g, "").replace(/\s/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const firma = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(head + "." + claim));
  const jwt = head + "." + claim + "." + b64url(new Uint8Array(firma));

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + jwt,
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error("OAuth Google: " + JSON.stringify(j));
  return j.access_token as string;
}

async function api(token: string, ruta: string, method = "GET", body?: unknown) {
  const r = await fetch(CAL + ruta, {
    method,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 404 || r.status === 410) return null; // evento borrado
  const txt = await r.text();
  if (!r.ok) throw new Error("Calendar " + method + " " + ruta + " → " + r.status + " " + txt);
  return txt ? JSON.parse(txt) : null;
}

// ---------------------------------------------------------------------------
// Conversiones cita ⇄ evento

const pad = (n: number) => String(n).padStart(2, "0");

// "2026-07-11" + "13:00" → "2026-07-11T13:00:00" (hora local de RD)
function inicioLocal(fecha: string, hora: string): string {
  const h = (hora || "09:00").slice(0, 5);
  return `${fecha}T${h.length === 4 ? "0" + h : h}:00`;
}

function finLocal(fecha: string, hora: string, duracion: number): string {
  const [hh, mm] = (hora || "09:00").split(":").map(Number);
  const t = (hh || 0) * 60 + (mm || 0) + (Number(duracion) || 45);
  return `${fecha}T${pad(Math.floor(t / 60) % 24)}:${pad(t % 60)}:00`;
}

function tituloEvento(c: Record<string, unknown>): string {
  const mascota = String(c.nombremascota ?? "").trim() || "Cita";
  const servicio = String(c.servicio ?? "").trim();
  return servicio ? `${mascota} · ${servicio}` : mascota;
}

function cuerpoEvento(c: Record<string, unknown>) {
  const detalle = [
    c.nombrecliente ? "Dueño: " + c.nombrecliente : "",
    c.telefono ? "Teléfono: " + c.telefono : "",
    c.empleado ? "Atiende: " + c.empleado : "",
    c.tipo ? "Tipo: " + c.tipo : "",
    c.estado ? "Estado: " + c.estado : "",
    c.notas ? "\n" + c.notas : "",
  ].filter(Boolean).join("\n");
  return {
    summary: tituloEvento(c),
    description: detalle + "\n\n— Sincronizado desde la app PetColinas",
    start: { dateTime: inicioLocal(String(c.fecha), String(c.hora)), timeZone: TZ },
    end: { dateTime: finLocal(String(c.fecha), String(c.hora), Number(c.duracion)), timeZone: TZ },
    extendedProperties: { private: { pcCitaId: String(c.id) } },
  };
}

// Evento de Google → campos de cita. Devuelve null si no tiene hora concreta.
function eventoACita(ev: Record<string, unknown>): Record<string, unknown> | null {
  const start = (ev.start as Record<string, unknown>) ?? {};
  const end = (ev.end as Record<string, unknown>) ?? {};
  const sdt = String(start.dateTime ?? "");
  if (!sdt) return null; // evento de día completo: no encaja en la agenda por horas
  const fecha = sdt.slice(0, 10);
  const hora = sdt.slice(11, 16);
  let duracion = 45;
  const edt = String(end.dateTime ?? "");
  if (edt) {
    const mins = Math.round((new Date(edt).getTime() - new Date(sdt).getTime()) / 60000);
    if (mins > 0 && mins < 24 * 60) duracion = mins;
  }
  const titulo = String(ev.summary ?? "").trim();
  const partes = titulo.split(/\s+·\s+|\s+-\s+/);
  const mascota = (partes[0] || titulo || "Evento de Google Calendar").trim();
  const servicio = partes.slice(1).join(" · ").trim() || titulo;
  const t = (titulo + " " + String(ev.description ?? "")).toLowerCase();
  const tipo = /ba[ñn]o|corte|grooming|peluquer|desenred|deslan/.test(t) ? "grooming"
    : /consulta|vacuna|veterinar|cirug/.test(t) ? "consulta" : "seguimiento";
  return { fecha, hora, duracion, tipo, nombremascota: mascota, servicio };
}

// ---------------------------------------------------------------------------

async function sincronizar(): Promise<Record<string, number>> {
  const token = await getAccessToken();
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
  const desde = new Date(Date.now() - 30 * 86400000).toISOString();
  const hasta = new Date(Date.now() + 150 * 86400000).toISOString();
  const stats = { creadosEnCalendar: 0, actualizadosEnCalendar: 0, borradosEnCalendar: 0, creadasEnApp: 0, actualizadasEnApp: 0 };

  // Eventos del calendario en la ventana de trabajo
  const eventos: Array<Record<string, unknown>> = [];
  let pageToken = "";
  do {
    const q = `/events?singleEvents=true&showDeleted=true&maxResults=2500` +
      `&timeMin=${encodeURIComponent(desde)}&timeMax=${encodeURIComponent(hasta)}` +
      (pageToken ? `&pageToken=${pageToken}` : "");
    const pag = await api(token, q);
    for (const e of (pag?.items ?? [])) eventos.push(e);
    pageToken = pag?.nextPageToken ?? "";
  } while (pageToken);

  const porCitaId = new Map<string, Record<string, unknown>>();
  const porEventId = new Map<string, Record<string, unknown>>();
  for (const ev of eventos) {
    porEventId.set(String(ev.id), ev);
    const ext = ((ev.extendedProperties as Record<string, unknown>)?.private ?? {}) as Record<string, unknown>;
    if (ext.pcCitaId) porCitaId.set(String(ext.pcCitaId), ev);
  }

  // Citas de la app en la misma ventana
  const { data: citas } = await supabase
    .from("pc_citas")
    .select("*")
    .gte("fecha", desde.slice(0, 10))
    .lte("fecha", hasta.slice(0, 10));

  const masNuevo = (a: string, b: string) => new Date(a).getTime() > new Date(b || 0).getTime();

  // --- Sentido 1: app → Calendar --------------------------------------------
  for (const c of (citas ?? [])) {
    const idc = String(c.id);
    const ev = (c.gcaleventid && porEventId.get(String(c.gcaleventid))) || porCitaId.get(idc) || null;
    const cancelada = c.estado === "cancelada";
    const sync = String(c.gcalsync ?? "");
    const citaCambio = !sync || masNuevo(String(c.actualizado ?? ""), sync);
    const evActivo = ev && ev.status !== "cancelled";

    if (cancelada) {
      if (evActivo) {
        await api(token, "/events/" + encodeURIComponent(String(ev!.id)), "DELETE");
        await supabase.from("pc_citas").update({ gcaleventid: null, gcalsync: new Date().toISOString() }).eq("id", c.id);
        stats.borradosEnCalendar++;
      }
      continue;
    }

    if (!evActivo) {
      // No existe (o se borró en Calendar): si la cita es nueva la creamos.
      // Si el evento fue borrado a propósito en Calendar, cancelamos la cita.
      if (c.gcaleventid && ev && ev.status === "cancelled") {
        await supabase.from("pc_citas")
          .update({ estado: "cancelada", motivocancelacion: "Evento borrado en Google Calendar", gcaleventid: null, gcalsync: new Date().toISOString() })
          .eq("id", c.id);
        stats.actualizadasEnApp++;
        continue;
      }
      const nuevo = await api(token, "/events", "POST", cuerpoEvento(c));
      if (nuevo) {
        await supabase.from("pc_citas").update({ gcaleventid: String(nuevo.id), gcalsync: new Date().toISOString() }).eq("id", c.id);
        stats.creadosEnCalendar++;
      }
      continue;
    }

    // Existe en ambos lados: gana el que cambió más recientemente
    const evCambio = masNuevo(String(ev!.updated ?? ""), sync);
    if (evCambio && !citaCambio) {
      const campos = eventoACita(ev!);
      if (campos) {
        await supabase.from("pc_citas").update({ ...campos, gcaleventid: String(ev!.id), gcalsync: new Date().toISOString() }).eq("id", c.id);
        stats.actualizadasEnApp++;
      }
    } else if (citaCambio) {
      await api(token, "/events/" + encodeURIComponent(String(ev!.id)), "PATCH", cuerpoEvento(c));
      await supabase.from("pc_citas").update({ gcaleventid: String(ev!.id), gcalsync: new Date().toISOString() }).eq("id", c.id);
      stats.actualizadosEnCalendar++;
    }
  }

  // --- Sentido 2: Calendar → app (eventos que no nacieron en la app) ---------
  const idsCitas = new Set((citas ?? []).map((c) => String(c.id)));
  for (const ev of eventos) {
    if (ev.status === "cancelled") continue;
    const ext = ((ev.extendedProperties as Record<string, unknown>)?.private ?? {}) as Record<string, unknown>;
    if (ext.pcCitaId && idsCitas.has(String(ext.pcCitaId))) continue; // ya está enlazado
    const campos = eventoACita(ev);
    if (!campos) continue;
    if (String(campos.fecha) < hoy) continue; // no importar historial viejo del calendario

    const nueva = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      ...campos,
      empleado: "",
      estado: "pendiente",
      clienteid: null,
      nombrecliente: null,
      telefono: null,
      precio: 0,
      notas: "Creada desde Google Calendar",
      motivocancelacion: "",
      enespera: false,
      mensajesenviados: "[]",
      gcaleventid: String(ev.id),
      gcalsync: new Date().toISOString(),
    };
    const { error } = await supabase.from("pc_citas").insert(nueva);
    if (error) { console.error("Insert cita desde Calendar:", JSON.stringify(error)); continue; }
    // Etiquetamos el evento para no volver a importarlo
    await api(token, "/events/" + encodeURIComponent(String(ev.id)), "PATCH",
      { extendedProperties: { private: { pcCitaId: String(nueva.id) } } });
    stats.creadasEnApp++;
  }

  return stats;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const stats = await sincronizar();
    console.log("calendar-sync OK:", JSON.stringify(stats));
    return new Response(JSON.stringify({ ok: true, ...stats }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("calendar-sync error:", String(e));
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
