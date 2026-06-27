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

  const { data: ventas } = await supabase
    .from("pc_ventas")
    .select("fecha, area, servicio, total")
    .ilike("cliente", `%${nombreMascota}%`)
    .order("fecha", { ascending: false })
    .limit(5);

  const { data: seguimientos } = await supabase
    .from("pc_seguimientos")
    .select("proximafecha, notas, tipo")
    .ilike("mascota", `%${nombreMascota}%`)
    .order("proximafecha", { ascending: false })
    .limit(3);

  const info: string[] = [];

  if (cliente) {
    if (cliente.nombrepropietario) info.push(`Propietario: ${cliente.nombrepropietario}`);
    if (cliente.especie) info.push(`Especie: ${cliente.especie}`);
    if (cliente.raza) info.push(`Raza: ${cliente.raza}`);
    if (cliente.telefono) info.push(`Teléfono: ${cliente.telefono}`);
  }

  if (ventas && ventas.length > 0) {
    const ultima = ventas[0];
    info.push(`Última visita: ${ultima.fecha} (${ultima.area} — ${ultima.servicio || ""} RD$${ultima.total || 0})`);
  } else {
    info.push("No se encontraron visitas anteriores.");
  }

  if (seguimientos && seguimientos.length > 0) {
    const seg = seguimientos[0];
    info.push(`Seguimiento pendiente: ${seg.notas ?? ""} (${seg.proximafecha ?? ""})`);
  }

  return info.length > 0 ? info.join("\n") : "No se encontró información del cliente.";
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

  // Fecha ISO (YYYY-MM-DD): si no parsea, usar hoy
  const d = new Date(fechaRaw);
  const fechaISO = (fechaRaw && !isNaN(d.getTime())) ? d.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

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
