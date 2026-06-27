/**
 * vapi-tools — Edge Function que maneja las tool calls de Vapi durante una llamada activa.
 *   - obtenerInfoCliente  →  devuelve historial del cliente/mascota desde Supabase
 *   - agendarCita         →  crea una cita en pc_citas (la que lee la pestaña Agenda)
 *
 * FIX jun 2026 (v2):
 *   - Lee las tool calls de CUALQUIER formato de Vapi (toolCalls, toolCallList,
 *     anidado o no) — antes solo leía msg.toolCallList y por eso nunca corría.
 *   - Acepta arguments como objeto YA parseado o como string JSON.
 *   - Loguea el body completo y cada tool para poder diagnosticar desde los Logs.
 *   - Inserta en pc_citas con los nombres de columna EXACTOS de la app.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// CANDADO DE HORARIO PetColinas
//   Lun, Mie-Sab: 9:00-18:00  ·  Martes: SOLO veterinaria 9:00-18:00
//   Domingo: 9:00-13:00  ·  Citas de 45 min.
function validarHorario(fechaISO: string, hora: string, tipo: string): { ok: boolean; motivo?: string } {
  const toMin = (h: string) => { const [hh, mm] = (h || "").split(":").map(Number); return (hh || 0) * 60 + (mm || 0); };
  const fmt = (x: number) => String(Math.floor(x / 60)).padStart(2, "0") + ":" + String(x % 60).padStart(2, "0");
  const dia = new Date(fechaISO + "T12:00:00Z").getUTCDay(); // 0=dom .. 6=sab
  const nombres = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const DUR = 45;
  const m = toMin(hora);

  // Martes: solo veterinaria (consulta). Grooming no.
  if (dia === 2 && tipo !== "consulta") {
    return { ok: false, motivo: "Los martes solo atendemos servicios de veterinaria; el grooming no está disponible ese día. ¿Le agendo otro día, o prefiere una consulta veterinaria el martes?" };
  }

  const open = 540;                       // 9:00
  const close = dia === 0 ? 780 : 1080;   // domingo 13:00, resto 18:00
  const lastStart = close - DUR;          // ultima cita que cierra a tiempo

  if (m < open || m > lastStart) {
    return {
      ok: false,
      motivo: `Ese horario está fuera de nuestro horario de atención. El ${nombres[dia]} atendemos de ${fmt(open)} a ${fmt(close)} (la última cita es a las ${fmt(lastStart)}). ¿Le agendo a la hora disponible más cercana dentro de ese rango?`,
    };
  }
  return { ok: true };
}

// --- Fecha/hora en horario de República Dominicana (America/Santo_Domingo, UTC-4) ---
const TZ = "America/Santo_Domingo";
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function hoyRDiso(): string {
  // en-CA produce YYYY-MM-DD
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

function horaRD(): string {
  return new Date().toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
}

// Convierte lo que diga el cliente ("hoy", "mañana", "el viernes", "28/06", "2026-06-28")
// a una fecha real YYYY-MM-DD usando SIEMPRE la fecha actual de RD como base.
function parseFechaRD(raw: string): string {
  const hoyISO = hoyRDiso();
  const base = new Date(hoyISO + "T12:00:00Z");
  const addDays = (n: number) => { const d = new Date(base); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const s = (raw || "").toLowerCase().trim();
  if (!s) return hoyISO;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/pasado\s+ma[ñn]ana/.test(s)) return addDays(2);
  if (/\bma[ñn]ana\b/.test(s)) return addDays(1);
  if (/\bhoy\b/.test(s)) return hoyISO;
  const dows: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, "miércoles": 3, jueves: 4, viernes: 5, sabado: 6, "sábado": 6 };
  for (const [k, v] of Object.entries(dows)) {
    if (s.includes(k)) {
      const cur = base.getUTCDay();
      let diff = (v - cur + 7) % 7;
      if (diff === 0) diff = 7; // "el lunes" = el próximo lunes
      return addDays(diff);
    }
  }
  const m = s.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
  if (m) {
    const dd = +m[1], mm = +m[2];
    let yy = m[3] ? +m[3] : +hoyISO.slice(0, 4);
    if (yy < 100) yy += 2000;
    const mk = (y: number) => `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    let iso = mk(yy);
    if (!m[3] && iso < hoyISO) iso = mk(yy + 1); // si ya pasó este año, usar el próximo
    return iso;
  }
  const d = new Date(raw);
  return isNaN(d.getTime()) ? hoyISO : d.toISOString().slice(0, 10);
}

function handleFechaHora(): string {
  const iso = hoyRDiso();
  const d = new Date(iso + "T12:00:00Z");
  return `Hoy es ${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}. La fecha en formato corto es ${iso} y la hora actual es ${horaRD()}.`;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Bad JSON" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Diagnóstico: ver exactamente qué envía Vapi (aparece en Logs)
  console.log("vapi-tools BODY:", JSON.stringify(body));

  const msg = (body.message ?? body) as Record<string, unknown>;

  // Reporte de fin de llamada: guardamos el resumen para la app (pestaña Llamadas)
  const msgType = String(msg.type ?? "");
  if (msgType === "end-of-call-report" || msgType === "report") {
    await guardarLlamada(msg);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // Las tool calls pueden venir en varios campos según la versión de Vapi
  const rawCalls = (
    (msg.toolCalls as unknown[]) ??
    (msg.toolCallList as unknown[]) ??
    (body.toolCalls as unknown[]) ??
    (body.toolCallList as unknown[]) ??
    []
  ) as Array<Record<string, unknown>>;

  console.log("vapi-tools toolCalls encontradas:", rawCalls.length);

  const results: Array<{ toolCallId: string; result: string }> = [];

  for (const call of rawCalls) {
    const fn = (call.function ?? call) as Record<string, unknown>;
    const name = String(fn.name ?? call.name ?? "");
    const id = String(call.id ?? call.toolCallId ?? fn.id ?? "");

    // arguments puede ser objeto YA parseado o string JSON
    let args: Record<string, unknown> = {};
    const rawArgs = (fn.arguments ?? call.arguments ?? {}) as unknown;
    if (typeof rawArgs === "string") {
      try { args = JSON.parse(rawArgs || "{}"); } catch { args = {}; }
    } else if (rawArgs && typeof rawArgs === "object") {
      args = rawArgs as Record<string, unknown>;
    }

    console.log("vapi-tools tool:", name, "args:", JSON.stringify(args));

    if (name === "obtenerInfoCliente") {
      results.push({ toolCallId: id, result: await handleObtenerInfoCliente(args) });
    } else if (name === "agendarCita") {
      results.push({ toolCallId: id, result: await handleAgendarCita(args, msg) });
    } else if (name === "obtenerFechaHora" || name === "fechaHoy") {
      results.push({ toolCallId: id, result: handleFechaHora() });
    } else {
      results.push({ toolCallId: id, result: "Herramienta desconocida: " + name });
    }
  }

  return new Response(JSON.stringify({ results }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});

// ---------------------------------------------------------------------------

async function handleObtenerInfoCliente(args: Record<string, unknown>): Promise<string> {
  const nombreMascota = String(args.nombreMascota ?? args.mascota ?? "").toLowerCase().trim();
  if (!nombreMascota) return "No se proporcionó nombre de mascota.";

  const { data: clientes } = await supabase
    .from("pc_clientes")
    .select("*")
    .ilike("nombremascota", `%${nombreMascota}%`)
    .limit(1);

  const cliente = clientes?.[0];

  // Trae más ventas para poder detectar la última desparasitación.
  const { data: ventas } = await supabase
    .from("pc_ventas")
    .select("*")
    .ilike("cliente", `%${nombreMascota}%`)
    .order("fecha", { ascending: false })
    .limit(40);

  const { data: seguimientos } = await supabase
    .from("pc_seguimientos")
    .select("proximafecha, notas, tipo")
    .ilike("mascota", `%${nombreMascota}%`)
    .order("proximafecha", { ascending: false })
    .limit(3);

  const info: string[] = [];
  let peso: number | null = null;

  if (cliente) {
    if (cliente.nombrepropietario) info.push(`Propietario: ${cliente.nombrepropietario}`);
    if (cliente.especie) info.push(`Especie: ${cliente.especie}`);
    if (cliente.raza) info.push(`Raza: ${cliente.raza}`);
    if (cliente.telefono) info.push(`Teléfono: ${cliente.telefono}`);
    const p = Number(cliente.peso ?? cliente.pesokg ?? cliente.peso_kg);
    if (!isNaN(p) && p > 0) { peso = p; info.push(`Peso: ${p} kg`); }
  }

  if (ventas && ventas.length > 0) {
    const ultima = ventas[0];
    info.push(`Última visita: ${ultima.fecha} (${ultima.area ?? ""} — ${ultima.servicio ?? ""} ${ultima.total ?? 0} pesos)`);
  } else {
    info.push("No se encontraron visitas anteriores.");
  }

  // --- Estado de la desparasitación (lo más importante para seguimiento) ---
  const estado = estadoAntiparasitario(ventas ?? [], peso);
  if (estado) info.push(estado);

  if (seguimientos && seguimientos.length > 0) {
    const seg = seguimientos[0];
    info.push(`Seguimiento pendiente: ${seg.notas ?? ""} (${seg.proximafecha ?? ""})`);
  }

  return info.length > 0 ? info.join("\n") : "No se encontró información del cliente.";
}

// Devuelve la presentación de NexGard Spectra y su precio según el peso (kg).
// Precios en texto hablable ("1462 pesos") para que el TTS los pronuncie bien.
function nexgardPorPeso(peso: number | null): string | null {
  if (!peso || peso <= 0) return null;
  if (peso <= 3) return "NexGard Spectra de 2 a 3 kg (1416 pesos)";
  if (peso <= 7) return "NexGard Spectra de 3 a 7 kg (1462 pesos)";
  if (peso <= 15) return "NexGard Spectra de 7.6 a 15 kg (1559 pesos)";
  if (peso <= 30) return "NexGard Spectra de 15 a 30 kg (1771 pesos)";
  return "NexGard Spectra de 30 a 60 kg (1992 pesos)";
}

// Analiza las ventas y dice si la protección antiparasitaria está vencida.
//   NexGard/Frontline/Spot On = ciclo 30 días · Bravecto = ciclo 90 días.
function estadoAntiparasitario(
  ventas: Array<Record<string, unknown>>,
  peso: number | null,
): string | null {
  const texto = (v: Record<string, unknown>) =>
    `${v.servicio ?? ""} ${v.producto ?? ""} ${v.descripcion ?? ""} ${v.detalle ?? ""} ${v.area ?? ""}`.toLowerCase();

  let mejor: { fecha: string; ciclo: number; nombre: string } | null = null;
  for (const v of ventas) {
    const t = texto(v);
    let ciclo = 0;
    let nombre = "";
    if (/bravecto/.test(t)) { ciclo = 90; nombre = "Bravecto"; }
    else if (/nexgard|next ?gard|spectra/.test(t)) { ciclo = 30; nombre = "NexGard Spectra"; }
    else if (/frontline|spot ?on|pipeta|antiparasit|desparasit/.test(t)) { ciclo = 30; nombre = "antiparasitario"; }
    if (!ciclo) continue;
    const fecha = String(v.fecha ?? "");
    if (!fecha) continue;
    if (!mejor || fecha > mejor.fecha) mejor = { fecha, ciclo, nombre };
  }

  if (!mejor) {
    const sug = nexgardPorPeso(peso);
    return `Antiparasitario: NO hay compras registradas de protección antipulgas/garrapatas. Oportunidad de venta.${sug ? ` Recomendado para su peso: ${sug}.` : ""}`;
  }

  const dias = Math.floor((Date.now() - new Date(mejor.fecha + "T12:00:00Z").getTime()) / 86400000);
  const vencido = dias > mejor.ciclo;
  const sug = nexgardPorPeso(peso);
  if (vencido) {
    return `Antiparasitario VENCIDO: última dosis (${mejor.nombre}) fue hace ${dias} días el ${mejor.fecha}; el ciclo es de ${mejor.ciclo} días, así que ya está DESPROTEGIDO. Prioridad de venta.${sug ? ` Recomendado para su peso: ${sug}.` : ""}`;
  }
  const restan = mejor.ciclo - dias;
  return `Antiparasitario al día: última dosis (${mejor.nombre}) hace ${dias} días el ${mejor.fecha}; le quedan ~${restan} días de protección.`;
}

// ---------------------------------------------------------------------------
// Guarda el resumen de la llamada (end-of-call-report de Vapi) en pc_llamadas
// y, si la llamada generó una cita, le adjunta el resumen a esa cita.

async function guardarLlamada(msg: Record<string, unknown>): Promise<void> {
  try {
    const call = (msg.call as Record<string, unknown>) ?? {};
    const customer = (call.customer as Record<string, unknown>) ?? {};
    const telefono = String(customer.number ?? "").replace(/\D/g, "").slice(-10);

    const analysis = (msg.analysis as Record<string, unknown>) ?? {};
    const resumen = String(msg.summary ?? analysis.summary ?? "").trim();
    const transcript = String(msg.transcript ?? "").trim();

    const startedAt = String(msg.startedAt ?? call.startedAt ?? "");
    const endedAt = String(msg.endedAt ?? call.endedAt ?? "");
    let duracion = 0;
    if (startedAt && endedAt) {
      duracion = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000));
    }
    const grabacion = String(msg.recordingUrl ?? msg.stereoRecordingUrl ?? "");
    const motivo = String(msg.endedReason ?? "").trim();

    const fechaISO = hoyRDiso();
    const hora = horaRD();

    // Enlazar con la cita recién creada en esta llamada (mismo teléfono)
    let citaid: number | null = null;
    let nombrecliente = "";
    let nombremascota = "";
    if (telefono) {
      const { data: citas } = await supabase
        .from("pc_citas")
        .select("*")
        .eq("telefono", telefono)
        .order("id", { ascending: false })
        .limit(1);
      const c = citas?.[0];
      if (c) {
        citaid = Number(c.id) || null;
        nombrecliente = String(c.nombrecliente ?? "");
        nombremascota = String(c.nombremascota ?? "");
        if (resumen) {
          const notas = `Agendada por Sofía (agente de voz)\nResumen de la llamada: ${resumen}`;
          await supabase.from("pc_citas").update({ notas }).eq("id", c.id);
        }
      }
    }

    const { error } = await supabase.from("pc_llamadas").insert({
      id: Date.now(),
      fecha: fechaISO,
      hora,
      telefono: telefono || null,
      nombrecliente: nombrecliente || null,
      nombremascota: nombremascota || null,
      resumen: resumen || null,
      transcript: transcript || null,
      duracion,
      grabacionurl: grabacion || null,
      motivofin: motivo || null,
      citaid,
      origen: "sofia",
    });

    if (error) console.error("Error guardando en pc_llamadas:", JSON.stringify(error));
    else console.log("Llamada guardada:", telefono, fechaISO, "dur", duracion, "s");
  } catch (e) {
    console.error("guardarLlamada error:", String(e));
  }
}

// ---------------------------------------------------------------------------

async function handleAgendarCita(
  args: Record<string, unknown>,
  msg: Record<string, unknown>,
): Promise<string> {
  const nombreMascota = String(args.nombreMascota ?? args.mascota ?? "").trim();
  const fechaRaw = String(args.fecha ?? "").trim(); // se espera YYYY-MM-DD
  const hora = String(args.hora ?? "").trim() || "09:00";
  const motivo = String(args.motivo ?? args.servicio ?? "Cita agendada por agente de voz").trim();

  if (!nombreMascota) {
    console.error("agendarCita SIN nombre de mascota. args:", JSON.stringify(args));
    return "Se necesita el nombre de la mascota para agendar.";
  }

  const nombrePropietario = String(
    args.nombrePropietario ?? args.propietario ?? (msg as Record<string, unknown>)?.nombrePropietario ?? "",
  ).trim();

  // Fecha ISO (YYYY-MM-DD): interpreta "hoy"/"mañana"/"el viernes"/"28/06"/ISO
  // usando SIEMPRE la fecha real de RD como base.
  const fechaISO = parseFechaRD(fechaRaw);

  // Teléfono del cliente que llama
  const callObj = (msg.call as Record<string, unknown>) ?? {};
  const callCustomer = (callObj.customer as Record<string, unknown>) ?? {};
  const telefono = String(callCustomer.number ?? args.telefono ?? "").replace(/\D/g, "").slice(-10);

  const servicio = String(args.servicio ?? motivo).trim();
  const sl = (servicio + " " + motivo).toLowerCase();
  const tipo = /ba[ñn]o|corte|grooming|peluquer|desenred|deslan/.test(sl) ? "grooming" : "consulta";

  // CANDADO DE HORARIO: rechaza dias/horas fuera de atencion
  const chk = validarHorario(fechaISO, hora, tipo);
  if (!chk.ok) {
    console.log("agendarCita rechazada por horario:", chk.motivo);
    return chk.motivo;
  }

  // Vincular clienteid del CRM (opcional, no bloquea)
  let clienteid: string | null = null;
  try {
    const { data: cl } = await supabase
      .from("pc_clientes")
      .select("id")
      .ilike("nombremascota", `%${nombreMascota}%`)
      .limit(1);
    if (cl?.[0]?.id != null) clienteid = String(cl[0].id);
  } catch { /* opcional */ }

  const nuevaCita = {
    id: Date.now(),
    fecha: fechaISO,
    hora,
    duracion: 45,
    tipo,
    empleado: String(args.empleado ?? "").trim(),
    estado: "pendiente",
    clienteid,
    nombrecliente: nombrePropietario || null,
    nombremascota: nombreMascota,
    telefono: telefono || null,
    servicio,
    precio: 0,
    notas: "Agendada por Sofía (agente de voz)",
    motivocancelacion: "",
    enespera: false,
    mensajesenviados: "[]",
  };

  const { error } = await supabase.from("pc_citas").insert(nuevaCita);

  if (error) {
    console.error("Error guardando cita en pc_citas:", JSON.stringify(error));
    return "Hubo un problema al guardar la cita. Por favor registrarla manualmente.";
  }

  console.log("agendarCita OK:", nombreMascota, fechaISO, hora);
  return `Cita agendada correctamente para ${nombreMascota} el ${fechaISO} a las ${hora}. ¡Los esperamos en PetColinas!`;
}
