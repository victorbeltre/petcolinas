/**
 * whatsapp-bot — Agente automático de WhatsApp para PetColinas.
 *
 * Recibe los mensajes del WhatsApp Business (Cloud API), los contesta con Claude
 * (claude-opus-5) usando los datos reales de la clínica (clientes, tarifas,
 * agenda) y guarda toda la conversación en Supabase para que Laura la vea y
 * pueda tomar el control desde la pestaña "WhatsApp" de la app.
 *
 * Rutas:
 *   GET  ?hub.mode=subscribe...  → verificación del webhook de Meta
 *   POST { entry: [...] }        → mensaje entrante de un cliente
 *   POST { accion: "enviar", telefono, texto }   → Laura escribe desde la app
 *   POST { accion: "bot", telefono, activo }     → prender/apagar el bot del chat
 *
 * Secrets (Supabase → Edge Functions → Secrets):
 *   ANTHROPIC_API_KEY   — clave de console.anthropic.com (se cobra por uso)
 *   WA_TOKEN            — token permanente de la app de Meta (WhatsApp)
 *   WA_PHONE_NUMBER_ID  — Phone number ID del número de WhatsApp Business
 *   WA_VERIFY_TOKEN     — texto que tú inventas; el mismo que pones en Meta
 *   WA_APP_SECRET       — (opcional) para validar X-Hub-Signature-256
 *   WA_HORARIO_HUMANO   — (opcional) "1" para que el bot avise cuando está cerrado
 *
 * Tablas: pc_wa_chats, pc_wa_mensajes (ver el SQL que acompaña esta función).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@0.70.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const WA_TOKEN = Deno.env.get("WA_TOKEN") ?? "";
const WA_PHONE_NUMBER_ID = Deno.env.get("WA_PHONE_NUMBER_ID") ?? "";
const WA_VERIFY_TOKEN = Deno.env.get("WA_VERIFY_TOKEN") ?? "";
const WA_APP_SECRET = Deno.env.get("WA_APP_SECRET") ?? "";

const GRAPH = "https://graph.facebook.com/v21.0";
const MODELO = "claude-opus-5";
const TZ = "America/Santo_Domingo";
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

// ---------------------------------------------------------------------------
// Fecha / hora de República Dominicana

function hoyRDiso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}
function horaRD(): string {
  return new Date().toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
}
function fechaLarga(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

// Convierte "hoy", "mañana", "el viernes", "28/06" o ISO a YYYY-MM-DD real de RD.
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
      if (diff === 0) diff = 7;
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
    if (!m[3] && iso < hoyISO) iso = mk(yy + 1);
    return iso;
  }
  const d = new Date(raw);
  return isNaN(d.getTime()) ? hoyISO : d.toISOString().slice(0, 10);
}

// CANDADO DE HORARIO PetColinas (el mismo que usa Sofía)
//   Lun, Mié-Sáb: 9:00-18:00 · Martes: SOLO veterinaria · Domingo: 9:00-13:00 · 45 min
function validarHorario(fechaISO: string, hora: string, tipo: string): { ok: boolean; motivo?: string } {
  const toMin = (h: string) => { const [hh, mm] = (h || "").split(":").map(Number); return (hh || 0) * 60 + (mm || 0); };
  const fmt = (x: number) => String(Math.floor(x / 60)).padStart(2, "0") + ":" + String(x % 60).padStart(2, "0");
  const dia = new Date(fechaISO + "T12:00:00Z").getUTCDay();
  const DUR = 45;
  const m = toMin(hora);
  if (dia === 2 && tipo !== "consulta") {
    return { ok: false, motivo: "Los martes solo atendemos veterinaria; el grooming no está disponible ese día. Ofrécele otro día u ofrécele consulta veterinaria el martes." };
  }
  const open = 540;
  const close = dia === 0 ? 780 : 1080;
  const lastStart = close - DUR;
  if (m < open || m > lastStart) {
    return { ok: false, motivo: `Fuera de horario. El ${DIAS[dia]} atendemos de ${fmt(open)} a ${fmt(close)} (última cita ${fmt(lastStart)}). Ofrécele la hora disponible más cercana.` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Servidor

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Verificación del webhook (Meta hace un GET al configurarlo)
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === WA_VERIFY_TOKEN) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  const raw = await req.text();
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw || "{}"); } catch { return json({ error: "JSON inválido" }, 400); }

  // --- Acciones que dispara la app PetColinas (panel de Laura) ---
  const accion = String(body.accion ?? "");
  if (accion) {
    // El webhook de Meta necesita que la función sea pública (verify_jwt off),
    // así que las acciones del panel se filtran aquí con la anon key de la app.
    const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const auth = req.headers.get("authorization") ?? "";
    if (ANON && !auth.includes(ANON)) return json({ error: "No autorizado." }, 401);
    return await manejarAccion(accion, body);
  }

  // --- Webhook de WhatsApp ---
  if (WA_APP_SECRET) {
    const sig = req.headers.get("x-hub-signature-256") ?? "";
    if (!(await firmaValida(raw, sig, WA_APP_SECRET))) {
      console.error("Firma X-Hub-Signature-256 inválida");
      return new Response("Invalid signature", { status: 401, headers: cors });
    }
  }

  // Meta exige respuesta rápida: procesamos en segundo plano.
  const tarea = procesarWebhook(body).catch((e) => console.error("whatsapp-bot error:", String(e)));
  const runtime = (globalThis as unknown as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(tarea); else await tarea;

  return new Response("EVENT_RECEIVED", { status: 200, headers: cors });
});

// ---------------------------------------------------------------------------
// Acciones del panel de la app

async function manejarAccion(accion: string, body: Record<string, unknown>): Promise<Response> {
  const telefono = normTel(String(body.telefono ?? ""));
  if (!telefono) return json({ error: "Falta el teléfono." }, 400);

  if (accion === "bot") {
    const activo = body.activo === true || body.activo === "true";
    await supabase.from("pc_wa_chats").update({ bot: activo }).eq("telefono", telefono);
    return json({ ok: true, bot: activo });
  }

  if (accion === "enviar") {
    const texto = String(body.texto ?? "").trim();
    if (!texto) return json({ error: "Mensaje vacío." }, 400);
    const waid = await enviarWhatsApp(telefono, texto);
    if (!waid) return json({ error: "No se pudo enviar el mensaje por WhatsApp." }, 502);
    await guardarMensaje(telefono, "humano", texto, waid);
    // Al escribir un humano, el bot se apaga en ese chat para no pisarse.
    await supabase.from("pc_wa_chats").update({
      bot: false, noleidos: 0, ultimomensaje: texto, ultimafecha: new Date().toISOString(),
    }).eq("telefono", telefono);
    return json({ ok: true, waid });
  }

  if (accion === "leido") {
    await supabase.from("pc_wa_chats").update({ noleidos: 0 }).eq("telefono", telefono);
    return json({ ok: true });
  }

  return json({ error: "Acción desconocida: " + accion }, 400);
}

// ---------------------------------------------------------------------------
// Webhook

async function procesarWebhook(body: Record<string, unknown>): Promise<void> {
  const entries = (body.entry as Array<Record<string, unknown>>) ?? [];
  for (const entry of entries) {
    const changes = (entry.changes as Array<Record<string, unknown>>) ?? [];
    for (const ch of changes) {
      const value = (ch.value as Record<string, unknown>) ?? {};
      const mensajes = (value.messages as Array<Record<string, unknown>>) ?? [];
      const contactos = (value.contacts as Array<Record<string, unknown>>) ?? [];
      const nombrePerfil = String(
        ((contactos[0]?.profile as Record<string, unknown>)?.name) ?? "",
      ).trim();

      for (const m of mensajes) {
        await procesarMensaje(m, nombrePerfil);
      }
    }
  }
}

async function procesarMensaje(m: Record<string, unknown>, nombrePerfil: string): Promise<void> {
  const waid = String(m.id ?? "");
  const telefono = normTel(String(m.from ?? ""));
  if (!telefono) return;

  const tipo = String(m.type ?? "text");
  let texto = "";
  if (tipo === "text") texto = String((m.text as Record<string, unknown>)?.body ?? "");
  else if (tipo === "button") texto = String((m.button as Record<string, unknown>)?.text ?? "");
  else if (tipo === "interactive") {
    const i = (m.interactive as Record<string, unknown>) ?? {};
    const r = (i.button_reply ?? i.list_reply) as Record<string, unknown> | undefined;
    texto = String(r?.title ?? "");
  } else if (tipo === "image") texto = "[El cliente envió una foto] " + String((m.image as Record<string, unknown>)?.caption ?? "");
  else if (tipo === "audio" || tipo === "voice") texto = "[El cliente envió una nota de voz]";
  else if (tipo === "document") texto = "[El cliente envió un documento]";
  else if (tipo === "location") texto = "[El cliente envió su ubicación]";
  else texto = "[Mensaje de tipo " + tipo + "]";

  // Evitar duplicados: Meta reintenta el mismo mensaje si no respondemos a tiempo.
  if (waid) {
    const { data: yaEsta } = await supabase.from("pc_wa_mensajes").select("id").eq("waid", waid).limit(1);
    if (yaEsta && yaEsta.length > 0) { console.log("Mensaje repetido, se ignora:", waid); return; }
  }

  const chat = await asegurarChat(telefono, nombrePerfil);
  await guardarMensaje(telefono, "cliente", texto, waid);
  await supabase.from("pc_wa_chats").update({
    ultimomensaje: texto.slice(0, 200),
    ultimafecha: new Date().toISOString(),
    noleidos: (Number(chat.noleidos) || 0) + 1,
    estado: "abierto",
  }).eq("telefono", telefono);

  // Si Laura tomó el control de este chat, el bot NO contesta.
  if (chat.bot === false) { console.log("Bot apagado para", telefono, "— no se responde."); return; }

  if (!ANTHROPIC_API_KEY) { console.error("Falta ANTHROPIC_API_KEY: el bot no puede responder."); return; }

  const respuesta = await responderConClaude(telefono, chat);
  if (respuesta) {
    const id = await enviarWhatsApp(telefono, respuesta);
    await guardarMensaje(telefono, "bot", respuesta, id);
    await supabase.from("pc_wa_chats").update({
      ultimomensaje: respuesta.slice(0, 200),
      ultimafecha: new Date().toISOString(),
    }).eq("telefono", telefono);
  }
}

// ---------------------------------------------------------------------------
// Claude

async function responderConClaude(telefono: string, chat: Record<string, unknown>): Promise<string> {
  const historial = await cargarHistorial(telefono);
  const system = await construirSystem(telefono, chat);

  const tools = [
    {
      name: "obtenerInfoCliente",
      description: "Busca en el CRM de PetColinas la ficha de una mascota: dueño, especie, raza, peso, última visita y estado de la desparasitación. Úsala SIEMPRE antes de recomendar antiparasitarios o de hablar del historial.",
      input_schema: {
        type: "object" as const,
        properties: { nombreMascota: { type: "string", description: "Nombre de la mascota" } },
        required: ["nombreMascota"],
      },
    },
    {
      name: "obtenerFechaHora",
      description: "Devuelve la fecha y hora actual en República Dominicana. Úsala antes de agendar o de hablar de 'hoy', 'mañana' o días de la semana.",
      input_schema: { type: "object" as const, properties: {} },
    },
    {
      name: "verDisponibilidad",
      description: "Muestra las citas ya ocupadas de un día para poder ofrecer horas libres.",
      input_schema: {
        type: "object" as const,
        properties: { fecha: { type: "string", description: "Fecha en YYYY-MM-DD, o 'hoy'/'mañana'/'el viernes'" } },
        required: ["fecha"],
      },
    },
    {
      name: "agendarCita",
      description: "Crea la cita en la agenda de PetColinas. Solo úsala cuando ya tengas confirmados: nombre de la mascota, nombre del dueño, servicio, fecha y hora.",
      input_schema: {
        type: "object" as const,
        properties: {
          nombreMascota: { type: "string" },
          nombrePropietario: { type: "string" },
          servicio: { type: "string", description: "Servicio solicitado, ej. 'Baño pequeño' o 'Consulta'" },
          fecha: { type: "string", description: "YYYY-MM-DD o 'hoy'/'mañana'/'el viernes'" },
          hora: { type: "string", description: "HH:MM en formato 24 horas" },
        },
        required: ["nombreMascota", "servicio", "fecha", "hora"],
      },
    },
    {
      name: "pasarAHumano",
      description: "Escala la conversación a Laura (recepción). Úsala ante emergencias médicas, reclamos, temas de dinero/facturación, o cuando el cliente pida hablar con una persona.",
      input_schema: {
        type: "object" as const,
        properties: { motivo: { type: "string", description: "Por qué se escala" } },
        required: ["motivo"],
      },
    },
  ];

  const messages: Anthropic.MessageParam[] = historial;
  let salida = "";

  for (let vuelta = 0; vuelta < 6; vuelta++) {
    const resp = await anthropic.messages.create({
      model: MODELO,
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      system,
      tools,
      messages,
    });

    const textos = resp.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text);
    if (textos.length) salida = textos.join("\n").trim();

    if (resp.stop_reason !== "tool_use") break;

    const usos = resp.content.filter((b) => b.type === "tool_use") as Anthropic.ToolUseBlock[];
    messages.push({ role: "assistant", content: resp.content });

    const resultados: Anthropic.ToolResultBlockParam[] = [];
    for (const u of usos) {
      const args = (u.input ?? {}) as Record<string, unknown>;
      let out = "";
      try {
        if (u.name === "obtenerInfoCliente") out = await toolInfoCliente(args);
        else if (u.name === "obtenerFechaHora") out = toolFechaHora();
        else if (u.name === "verDisponibilidad") out = await toolDisponibilidad(args);
        else if (u.name === "agendarCita") out = await toolAgendarCita(args, telefono, chat);
        else if (u.name === "pasarAHumano") out = await toolPasarAHumano(args, telefono);
        else out = "Herramienta desconocida.";
      } catch (e) {
        console.error("Error en tool", u.name, String(e));
        out = "Hubo un error consultando el sistema. Continúa sin ese dato y ofrece que Laura confirme.";
      }
      resultados.push({ type: "tool_result", tool_use_id: u.id, content: out });
    }
    messages.push({ role: "user", content: resultados });
  }

  return salida;
}

async function construirSystem(telefono: string, chat: Record<string, unknown>): Promise<string> {
  const hoy = hoyRDiso();
  const tarifas = await listaTarifas();

  // Si el número ya es cliente, le damos su ficha al bot desde el arranque.
  let ficha = "";
  try {
    const { data } = await supabase
      .from("pc_clientes")
      .select("nombremascota, nombrepropietario, especie, raza, telefono")
      .ilike("telefono", `%${telefono.slice(-7)}%`)
      .limit(5);
    if (data && data.length) {
      ficha = "\n\nESTE NÚMERO YA ES CLIENTE. Mascotas registradas a su nombre:\n" +
        data.map((c) => `- ${c.nombremascota ?? "?"} (${c.especie ?? "?"} ${c.raza ?? ""}) — dueño: ${c.nombrepropietario ?? "?"}`).join("\n") +
        "\nSalúdalo por su nombre y no le pidas datos que ya tienes.";
    }
  } catch { /* opcional */ }

  return `Eres **Sofía**, la asistente de WhatsApp de PetColinas, una clínica veterinaria y spa de mascotas en Plaza Las Colinas, Santo Domingo Oeste, República Dominicana.

Hoy es ${fechaLarga(hoy)} (${hoy}) y son las ${horaRD()} hora de República Dominicana.

## Tu trabajo
Atiendes a los clientes por WhatsApp: respondes dudas, das precios, agendas citas y das seguimiento. Eres cálida, breve y dominicana en el trato (de "usted", sin exagerar el acento).

## Cómo escribir
- Mensajes CORTOS: 2 a 4 líneas. Esto es WhatsApp, no un correo.
- Usa emojis con moderación (🐾 🐶 🐱 ✂️ 💉 📅), nunca más de dos por mensaje.
- Una sola pregunta por mensaje. No abrumes con listas largas de precios: pregunta primero qué necesita.
- Formato WhatsApp: *negrita* con un asterisco. Nunca uses markdown de títulos ni tablas.
- Nunca inventes precios, horarios ni disponibilidad. Si no lo sabes, usa una herramienta o escala a Laura.

## Datos de la clínica
- Dirección: Plaza Las Colinas, Santo Domingo Oeste.
- Horario: lunes y de miércoles a sábado de 9:00 a 6:00 pm · martes SOLO veterinaria de 9:00 a 6:00 pm (no hay grooming los martes) · domingo de 9:00 a 1:00 pm.
- Las citas duran 45 minutos. La última cita entra 45 minutos antes de cerrar.
- Programa de lealtad: cada 10 baños de grooming, el siguiente es GRATIS.
- Contamos con veterinarias (Aylein y Valentina) y groomer (Alexander). Laura está en recepción.

## Tarifas vigentes (RD$)
${tarifas}

Los precios de productos (comida, antiparasitarios, accesorios) varían: no los inventes, ofrece confirmarlos con Laura. Excepción: NexGard Spectra según peso — 2-3 kg RD$1,416 · 3-7 kg RD$1,462 · 7.6-15 kg RD$1,559 · 15-30 kg RD$1,771 · 30-60 kg RD$1,992.

## Reglas al agendar
1. Antes de proponer días, llama a obtenerFechaHora.
2. Pregunta: nombre de la mascota, nombre del dueño, qué servicio, y qué día/hora prefiere.
3. Usa verDisponibilidad para no ofrecer una hora que ya está tomada.
4. Solo llama a agendarCita cuando el cliente CONFIRME el día y la hora.
5. Después de agendar, confírmale la cita en un mensaje corto.

## Cuándo pasar a un humano (herramienta pasarAHumano)
- Emergencia médica o un animal en peligro → dile que llame YA al 809-752-6806 y escala.
- Reclamos, quejas, devoluciones o temas de dinero.
- Cualquier consejo médico específico: NO diagnostiques ni recetes. Puedes dar orientación general y recomendar la consulta.
- Si el cliente pide hablar con una persona.

## Límites
- No prometas resultados médicos ni des dosis de medicamentos.
- No compartas datos de otros clientes.
- Si el cliente escribe en inglés, respóndele en inglés.${ficha}`;
}

async function listaTarifas(): Promise<string> {
  try {
    const { data } = await supabase.from("pc_tarifas").select("nombre, precio, area").order("id", { ascending: true }).limit(200);
    if (!data || !data.length) return "(No se pudieron cargar las tarifas; ofrece confirmarlas con Laura.)";
    const g = data.filter((t) => String(t.area ?? "").toLowerCase().startsWith("groom") || String(t.nombre ?? "").toLowerCase().match(/ba[ñn]o|corte|desenred|deslan|grooming|u[ñn]as/));
    const v = data.filter((t) => !g.includes(t));
    const fmt = (t: Record<string, unknown>) => `- ${t.nombre}: RD$${Number(t.precio ?? 0).toLocaleString("es-DO")}`;
    return "Grooming:\n" + g.map(fmt).join("\n") + "\n\nVeterinaria:\n" + v.map(fmt).join("\n");
  } catch {
    return "(No se pudieron cargar las tarifas; ofrece confirmarlas con Laura.)";
  }
}

// ---------------------------------------------------------------------------
// Herramientas

function toolFechaHora(): string {
  const iso = hoyRDiso();
  return `Hoy es ${fechaLarga(iso)}. Fecha corta: ${iso}. Hora actual en RD: ${horaRD()}.`;
}

async function toolInfoCliente(args: Record<string, unknown>): Promise<string> {
  const nombre = String(args.nombreMascota ?? "").toLowerCase().trim();
  if (!nombre) return "No se indicó el nombre de la mascota.";

  const { data: clientes } = await supabase.from("pc_clientes").select("*").ilike("nombremascota", `%${nombre}%`).limit(1);
  const cliente = clientes?.[0];
  const { data: ventas } = await supabase.from("pc_ventas").select("*").ilike("cliente", `%${nombre}%`).order("fecha", { ascending: false }).limit(40);

  const info: string[] = [];
  let peso: number | null = null;
  if (cliente) {
    if (cliente.nombrepropietario) info.push(`Propietario: ${cliente.nombrepropietario}`);
    if (cliente.especie) info.push(`Especie: ${cliente.especie}`);
    if (cliente.raza) info.push(`Raza: ${cliente.raza}`);
    const p = Number(cliente.peso ?? cliente.pesokg ?? cliente.peso_kg);
    if (!isNaN(p) && p > 0) { peso = p; info.push(`Peso: ${p} kg`); }
  } else {
    info.push("No hay ficha en el CRM con ese nombre de mascota (puede ser cliente nuevo).");
  }

  if (ventas && ventas.length) {
    const u = ventas[0];
    info.push(`Última visita: ${u.fecha} (${u.area ?? ""} — ${u.servicio ?? ""}, RD$${Number(u.total ?? 0).toLocaleString("es-DO")})`);
    const banos = ventas.filter((v) => /ba[ñn]o/i.test(String(v.servicio ?? ""))).length;
    if (banos > 0) info.push(`Baños registrados: ${banos} (cada 10 baños el siguiente es gratis).`);
  } else {
    info.push("Sin visitas registradas.");
  }

  const anti = estadoAntiparasitario(ventas ?? [], peso);
  if (anti) info.push(anti);
  return info.join("\n");
}

function nexgardPorPeso(peso: number | null): string | null {
  if (!peso || peso <= 0) return null;
  if (peso <= 3) return "NexGard Spectra 2-3 kg (RD$1,416)";
  if (peso <= 7) return "NexGard Spectra 3-7 kg (RD$1,462)";
  if (peso <= 15) return "NexGard Spectra 7.6-15 kg (RD$1,559)";
  if (peso <= 30) return "NexGard Spectra 15-30 kg (RD$1,771)";
  return "NexGard Spectra 30-60 kg (RD$1,992)";
}

function estadoAntiparasitario(ventas: Array<Record<string, unknown>>, peso: number | null): string | null {
  const texto = (v: Record<string, unknown>) =>
    `${v.servicio ?? ""} ${v.producto ?? ""} ${v.descripcion ?? ""} ${v.detalle ?? ""} ${v.area ?? ""}`.toLowerCase();
  let mejor: { fecha: string; ciclo: number; nombre: string } | null = null;
  for (const v of ventas) {
    const t = texto(v);
    let ciclo = 0, nombre = "";
    if (/bravecto/.test(t)) { ciclo = 90; nombre = "Bravecto"; }
    else if (/nexgard|next ?gard|spectra/.test(t)) { ciclo = 30; nombre = "NexGard Spectra"; }
    else if (/frontline|spot ?on|pipeta|antiparasit|desparasit/.test(t)) { ciclo = 30; nombre = "antiparasitario"; }
    if (!ciclo) continue;
    const fecha = String(v.fecha ?? "");
    if (!fecha) continue;
    if (!mejor || fecha > mejor.fecha) mejor = { fecha, ciclo, nombre };
  }
  const sug = nexgardPorPeso(peso);
  if (!mejor) return `Antiparasitario: sin compras registradas.${sug ? ` Recomendado por su peso: ${sug}.` : ""}`;
  const dias = Math.floor((Date.now() - new Date(mejor.fecha + "T12:00:00Z").getTime()) / 86400000);
  if (dias > mejor.ciclo) {
    return `Antiparasitario VENCIDO: última dosis (${mejor.nombre}) el ${mejor.fecha}, hace ${dias} días; el ciclo es de ${mejor.ciclo} días.${sug ? ` Recomendado: ${sug}.` : ""}`;
  }
  return `Antiparasitario al día: última dosis (${mejor.nombre}) el ${mejor.fecha}; le quedan ~${mejor.ciclo - dias} días de protección.`;
}

async function toolDisponibilidad(args: Record<string, unknown>): Promise<string> {
  const fecha = parseFechaRD(String(args.fecha ?? ""));
  const { data } = await supabase
    .from("pc_citas")
    .select("hora, tipo, nombremascota, estado")
    .eq("fecha", fecha)
    .order("hora", { ascending: true });
  const activas = (data ?? []).filter((c) => String(c.estado ?? "") !== "cancelada");
  const dia = new Date(fecha + "T12:00:00Z").getUTCDay();
  const cierre = dia === 0 ? "13:00" : "18:00";
  const nota = dia === 2 ? " (martes: SOLO veterinaria, no hay grooming)" : "";
  if (!activas.length) return `El ${fechaLarga(fecha)} (${fecha}) no hay citas todavía. Horario: 09:00 a ${cierre}${nota}. Todo está disponible.`;
  return `Citas ya ocupadas el ${fechaLarga(fecha)} (${fecha}), horario 09:00 a ${cierre}${nota}:\n` +
    activas.map((c) => `- ${c.hora} ${c.tipo ?? ""} (${c.nombremascota ?? ""})`).join("\n") +
    "\nCada cita ocupa 45 minutos. Ofrece solo horas que no choquen con estas.";
}

async function toolAgendarCita(args: Record<string, unknown>, telefono: string, chat: Record<string, unknown>): Promise<string> {
  const nombreMascota = String(args.nombreMascota ?? "").trim();
  if (!nombreMascota) return "Falta el nombre de la mascota; pregúntaselo al cliente.";
  const fechaISO = parseFechaRD(String(args.fecha ?? ""));
  const hora = String(args.hora ?? "").trim() || "09:00";
  const servicio = String(args.servicio ?? "Cita por WhatsApp").trim();
  const propietario = String(args.nombrePropietario ?? chat.nombre ?? "").trim();
  const tipo = /ba[ñn]o|corte|grooming|peluquer|desenred|deslan|u[ñn]as/i.test(servicio) ? "grooming" : "consulta";

  const chk = validarHorario(fechaISO, hora, tipo);
  if (!chk.ok) return "NO se agendó. " + chk.motivo;

  // ¿Ya hay una cita a esa misma hora?
  const { data: choque } = await supabase.from("pc_citas").select("id, nombremascota").eq("fecha", fechaISO).eq("hora", hora).limit(1);
  if (choque && choque.length) {
    return `NO se agendó: ya hay una cita a las ${hora} el ${fechaISO}. Ofrécele otra hora (usa verDisponibilidad).`;
  }

  let clienteid: string | null = null;
  try {
    const { data: cl } = await supabase.from("pc_clientes").select("id").ilike("nombremascota", `%${nombreMascota}%`).limit(1);
    if (cl?.[0]?.id != null) clienteid = String(cl[0].id);
  } catch { /* opcional */ }

  const { error } = await supabase.from("pc_citas").insert({
    id: Date.now(),
    fecha: fechaISO,
    hora,
    duracion: 45,
    tipo,
    empleado: "",
    estado: "pendiente",
    clienteid,
    nombrecliente: propietario || null,
    nombremascota: nombreMascota,
    telefono: telefono.slice(-10),
    servicio,
    precio: 0,
    notas: "Agendada por Sofía (WhatsApp)",
    motivocancelacion: "",
    enespera: false,
    mensajesenviados: "[]",
  });

  if (error) {
    console.error("Error guardando cita:", JSON.stringify(error));
    return "No se pudo guardar la cita. Dile al cliente que Laura le confirmará en un momento y escala con pasarAHumano.";
  }

  sincronizarCalendario();
  return `Cita creada: ${nombreMascota}, ${servicio}, ${fechaLarga(fechaISO)} a las ${hora}. Confírmasela al cliente en un mensaje corto.`;
}

async function toolPasarAHumano(args: Record<string, unknown>, telefono: string): Promise<string> {
  const motivo = String(args.motivo ?? "El cliente necesita atención personal").trim();
  await supabase.from("pc_wa_chats").update({
    bot: false,
    estado: "escalado",
    etiqueta: motivo.slice(0, 120),
  }).eq("telefono", telefono);
  console.log("Chat escalado a humano:", telefono, motivo);
  return "Listo, el chat quedó marcado para que Laura lo atienda. Dile al cliente que en un momento le responde una persona del equipo y NO sigas resolviendo el tema tú.";
}

function sincronizarCalendario(): void {
  fetch(SUPABASE_URL + "/functions/v1/calendar-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + SUPABASE_SERVICE_KEY },
  }).then(() => console.log("calendar-sync avisado")).catch((e) => console.warn("calendar-sync:", String(e)));
}

// ---------------------------------------------------------------------------
// Persistencia

async function asegurarChat(telefono: string, nombrePerfil: string): Promise<Record<string, unknown>> {
  const { data } = await supabase.from("pc_wa_chats").select("*").eq("telefono", telefono).limit(1);
  if (data && data.length) {
    if (nombrePerfil && !data[0].nombre) {
      await supabase.from("pc_wa_chats").update({ nombre: nombrePerfil }).eq("telefono", telefono);
      data[0].nombre = nombrePerfil;
    }
    return data[0];
  }
  const nuevo = {
    telefono,
    nombre: nombrePerfil || null,
    bot: true,
    noleidos: 0,
    estado: "abierto",
    creado: new Date().toISOString(),
  };
  await supabase.from("pc_wa_chats").insert(nuevo);
  return nuevo as unknown as Record<string, unknown>;
}

async function guardarMensaje(telefono: string, rol: string, texto: string, waid: string | null): Promise<void> {
  const { error } = await supabase.from("pc_wa_mensajes").insert({
    id: Date.now() + Math.floor(Math.random() * 1000),
    telefono,
    waid: waid || null,
    rol,
    texto,
    fecha: new Date().toISOString(),
  });
  if (error) console.error("Error guardando mensaje:", JSON.stringify(error));
}

// Historial en el formato que espera la API de Claude (últimos 30 mensajes).
async function cargarHistorial(telefono: string): Promise<Anthropic.MessageParam[]> {
  const { data } = await supabase
    .from("pc_wa_mensajes")
    .select("rol, texto, fecha")
    .eq("telefono", telefono)
    .order("id", { ascending: false })
    .limit(30);
  const filas = (data ?? []).reverse();

  const out: Anthropic.MessageParam[] = [];
  for (const f of filas) {
    const texto = String(f.texto ?? "").trim();
    if (!texto) continue;
    const rol = String(f.rol) === "cliente" ? "user" : "assistant";
    const contenido = String(f.rol) === "humano" ? `(Laura del equipo respondió) ${texto}` : texto;
    // Claude exige alternancia: si el rol se repite, se fusiona con el anterior.
    if (out.length && out[out.length - 1].role === rol) {
      out[out.length - 1].content = String(out[out.length - 1].content) + "\n" + contenido;
    } else {
      out.push({ role: rol as "user" | "assistant", content: contenido });
    }
  }
  // La conversación siempre debe empezar (y terminar) con el cliente.
  while (out.length && out[0].role !== "user") out.shift();
  if (!out.length) out.push({ role: "user", content: "Hola" });
  return out;
}

// ---------------------------------------------------------------------------
// WhatsApp Cloud API

async function enviarWhatsApp(telefono: string, texto: string): Promise<string> {
  if (!WA_TOKEN || !WA_PHONE_NUMBER_ID) { console.error("Faltan WA_TOKEN o WA_PHONE_NUMBER_ID"); return ""; }
  try {
    const r = await fetch(`${GRAPH}/${WA_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: telefono,
        type: "text",
        text: { preview_url: false, body: texto.slice(0, 4000) },
      }),
    });
    const j = await r.json() as Record<string, unknown>;
    if (!r.ok) { console.error("Error enviando WhatsApp:", r.status, JSON.stringify(j)); return ""; }
    const msgs = (j.messages as Array<Record<string, unknown>>) ?? [];
    return String(msgs[0]?.id ?? "");
  } catch (e) {
    console.error("Fallo de red enviando WhatsApp:", String(e));
    return "";
  }
}

// ---------------------------------------------------------------------------
// Utilidades

function normTel(t: string): string {
  const d = String(t || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 10) return "1" + d;          // 8097526806 → 18097526806
  if (d.length === 7) return "1809" + d;
  return d;
}

async function firmaValida(raw: string, header: string, secret: string): Promise<boolean> {
  try {
    const esperado = header.replace("sha256=", "").trim();
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
    const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
    return hex === esperado;
  } catch { return false; }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
