/**
 * vapi-tools — Edge Function que maneja las tool calls de Vapi durante una llamada activa.
 *
 * Vapi llama a este endpoint cuando el modelo quiere usar una herramienta:
 *   - obtenerInfoCliente  →  devuelve historial del cliente/mascota desde Supabase
 *   - agendarCita         →  crea una cita en pc_citas (la que lee la pestaña Agenda)
 *
 * IMPORTANTE (fix jun 2026): antes agendarCita escribía en pc_seguimientos con
 * columnas equivocadas (proxima_fecha/ultima_fecha) y por eso la cita nunca
 * aparecía en la Agenda. Ahora inserta en pc_citas con los nombres de columna
 * EXACTOS que usa la app (todo en minúscula, sin guion bajo).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

  // Vapi sends the message nested under body.message
  const msg = (body.message ?? body) as Record<string, unknown>;
  const toolCalls = (msg.toolCallList ?? []) as Array<{
    id: string;
    function: { name: string; arguments: string };
  }>;

  const results: Array<{ toolCallId: string; result: string }> = [];

  for (const call of toolCalls) {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function.arguments || "{}");
    } catch {
      /* ignore parse errors */
    }

    const name = call.function.name;

    if (name === "obtenerInfoCliente") {
      const resultado = await handleObtenerInfoCliente(args);
      results.push({ toolCallId: call.id, result: resultado });
    } else if (name === "agendarCita") {
      const resultado = await handleAgendarCita(args, msg);
      results.push({ toolCallId: call.id, result: resultado });
    } else {
      results.push({ toolCallId: call.id, result: "Herramienta desconocida." });
    }
  }

  return new Response(JSON.stringify({ results }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});

// ---------------------------------------------------------------------------

async function handleObtenerInfoCliente(args: Record<string, unknown>): Promise<string> {
  const nombreMascota = String(args.nombreMascota ?? "").toLowerCase().trim();
  if (!nombreMascota) return "No se proporcionó nombre de mascota.";

  // Buscar en CRM — la columna real es "nombremascota" (minúscula, sin camelCase)
  const { data: clientes } = await supabase
    .from("pc_clientes")
    .select("*")
    .ilike("nombremascota", `%${nombreMascota}%`)
    .limit(1);

  const cliente = clientes?.[0];

  // Última visita en ventas
  const { data: ventas } = await supabase
    .from("pc_ventas")
    .select("fecha, area, servicio, total")
    .ilike("cliente", `%${nombreMascota}%`)
    .order("fecha", { ascending: false })
    .limit(5);

  // Seguimientos pendientes — columnas reales: proximafecha / ultimafecha
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
  const nombreMascota = String(args.nombreMascota ?? "").trim();
  const fechaRaw = String(args.fecha ?? "").trim(); // se espera YYYY-MM-DD
  const hora = String(args.hora ?? "").trim() || "09:00";
  const motivo = String(args.motivo ?? args.servicio ?? "Cita agendada por agente de voz").trim();

  if (!nombreMascota) return "Se necesita el nombre de la mascota para agendar.";

  // Propietario desde args o desde la info de la llamada
  const nombrePropietario = String(
    args.nombrePropietario ?? (msg as Record<string, unknown>)?.nombrePropietario ?? "",
  ).trim();

  // Fecha ISO (YYYY-MM-DD): si no parsea, usar hoy
  let fechaISO: string;
  const d = new Date(fechaRaw);
  fechaISO = (fechaRaw && !isNaN(d.getTime())) ? d.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

  // Teléfono del cliente que llama
  const callObj = (msg.call as Record<string, unknown>) ?? {};
  const callCustomer = (callObj.customer as Record<string, unknown>) ?? {};
  const telefono = String(callCustomer.number ?? args.telefono ?? "").replace(/\D/g, "").slice(-10);

  const servicio = String(args.servicio ?? motivo).trim();

  // Tipo de cita: grooming si el servicio menciona baño/corte/grooming, si no consulta vet
  const sl = (servicio + " " + motivo).toLowerCase();
  const tipo = /ba[ñn]o|corte|grooming|peluquer|desenred|deslan/.test(sl) ? "grooming" : "consulta";

  // Intentar vincular el clienteid del CRM (opcional, no bloquea)
  let clienteid: string | null = null;
  try {
    const { data: cl } = await supabase
      .from("pc_clientes")
      .select("id")
      .ilike("nombremascota", `%${nombreMascota}%`)
      .limit(1);
    if (cl?.[0]?.id != null) clienteid = String(cl[0].id);
  } catch {
    /* opcional */
  }

  // INSERT en pc_citas con los nombres de columna EXACTOS que usa la app
  // (ver denormalizeRow("pc_citas") en index.html).
  const nuevaCita = {
    id: Date.now(),
    fecha: fechaISO,
    hora,
    duracion: 60,
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
    console.error("Error guardando cita en pc_citas:", error);
    return "Hubo un problema al guardar la cita. Por favor registrarla manualmente.";
  }

  return `Cita agendada correctamente para ${nombreMascota} el ${fechaISO} a las ${hora}. ¡Los esperamos en PetColinas!`;
}
