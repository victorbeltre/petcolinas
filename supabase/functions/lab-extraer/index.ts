/**
 * lab-extraer — lee un hemograma (PDF o foto) y devuelve sus datos
 * estructurados para que una persona los REVISE antes de generar el PDF
 * PetColinas.
 *
 * Reglas que esta funcion no negocia:
 *  - TRANSCRIBE, no interpreta. Los resultados se devuelven como TEXTO tal cual
 *    estan impresos ("12.5", "<0.1", "+++"): nada de calcular, redondear ni
 *    convertir unidades. Un hemograma con un numero cambiado en la historia
 *    clinica es peor que no tenerlo.
 *  - Lo que no se lee con certeza se marca `dudoso`, no se adivina. La pantalla
 *    de revision lo resalta.
 *  - No diagnostica ni comenta nada. Solo copia, incluida la bandera
 *    alto/bajo que el PROPIO laboratorio impreso junto al resultado.
 *
 * Secrets:  ANTHROPIC_API_KEY   (la misma del WhatsApp con IA; se cobra por uso)
 *
 * Se despliega CON verificacion de JWT, y ademas se exige que quien llama sea
 * personal de la clinica (pc_es_personal): la llave anon de index.html tambien
 * pasa la verificacion de JWT y no debe poder gastar la clave de IA.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODELO = "claude-opus-5";
const MAX_BYTES = 8 * 1024 * 1024;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

const texto = { type: ["string", "null"] };
const HERRAMIENTA = {
  name: "registrar_hemograma",
  description:
    "Registra el contenido de un informe de hemograma veterinario, copiado tal cual esta en el documento.",
  input_schema: {
    type: "object",
    properties: {
      es_hemograma: {
        type: "boolean",
        description: "false si el documento NO es un hemograma / biometria hematica.",
      },
      laboratorio: {
        type: "object",
        description: "Datos del laboratorio que emitio el informe, copiados del encabezado y pie.",
        properties: {
          nombre: texto, direccion: texto, telefono: texto, email: texto, web: texto,
          registro: { ...texto, description: "RNC, exequatur, registro sanitario u otro identificador impreso." },
          responsable: { ...texto, description: "Quien valida/firma, con su titulo, tal como aparece." },
        },
        required: ["nombre"],
      },
      paciente: {
        type: "object",
        properties: {
          nombre: texto, especie: texto, raza: texto, sexo: texto, edad: texto,
          propietario: texto, solicitante: { ...texto, description: "Veterinario o clinica que solicito el analisis." },
          identificador: { ...texto, description: "N. de muestra, orden o historia del laboratorio." },
        },
      },
      fechas: {
        type: "object",
        properties: { toma: texto, recepcion: texto, reporte: texto },
        description: "Fechas tal como estan impresas.",
      },
      muestra: { ...texto, description: "Tipo de muestra, ej. 'Sangre total con EDTA'." },
      metodo: { ...texto, description: "Equipo o metodo impreso, si aparece." },
      parametros: {
        type: "array",
        description: "TODAS las filas de resultados, en el orden del documento.",
        items: {
          type: "object",
          properties: {
            grupo: { ...texto, description: "Seccion a la que pertenece (Serie roja, Serie blanca, Plaquetas, Formula leucocitaria...)." },
            nombre: { type: "string", description: "Nombre del parametro tal como esta impreso." },
            resultado: { type: "string", description: "Valor EXACTO como texto, sin convertir ni redondear." },
            unidad: texto,
            rango: { ...texto, description: "Rango de referencia impreso, tal cual." },
            bandera: {
              type: ["string", "null"],
              enum: ["alto", "bajo", null],
              description: "Solo si el DOCUMENTO lo marca (H/L, flecha, asterisco, negrita). No lo deduzcas comparando con el rango.",
            },
            dudoso: {
              type: "boolean",
              description: "true si el valor, la unidad o el rango no se leen con total certeza (borroso, cortado, ambiguo).",
            },
          },
          required: ["nombre", "resultado", "dudoso"],
        },
      },
      observaciones: { ...texto, description: "Comentarios, interpretacion o notas del laboratorio, copiados literalmente." },
      notas_pie: { ...texto, description: "Avisos o textos del pie del documento." },
      advertencias: {
        type: "array", items: { type: "string" },
        description: "Cualquier cosa que impida una lectura fiable: paginas cortadas, foto torcida, texto ilegible.",
      },
    },
    required: ["es_hemograma", "laboratorio", "parametros", "advertencias"],
  },
};

const INSTRUCCIONES =
  "Eres un transcriptor de informes de laboratorio veterinario. Recibes un hemograma y lo " +
  "registras con la herramienta, copiando EXACTAMENTE lo impreso. No interpretes, no calcules, no " +
  "conviertas unidades, no corrijas, no completes valores que falten ni uses rangos de memoria: si " +
  "algo no esta en el documento, dejalo en null. Si un valor no se lee con certeza marca dudoso=true. " +
  "Incluye todas las filas, tambien las de la formula leucocitaria si existen. Conserva el texto " +
  "original del laboratorio (nombre, direccion, telefono, responsable, observaciones, notas).";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Metodo no permitido" }, 405);

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ") || auth.length < 30) return json({ error: "No autorizado" }, 401);

  // Solo personal de la clinica: se comprueba con el JWT de quien llama.
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: esPersonal, error: eAuth } = await sb.rpc("pc_es_personal");
  if (eAuth || esPersonal !== true) return json({ error: "No autorizado" }, 403);

  if (!ANTHROPIC_API_KEY) {
    return json({ error: "Falta configurar la clave de IA (ANTHROPIC_API_KEY) en Supabase." }, 503);
  }

  let cuerpo: { archivo?: string; mime?: string };
  try { cuerpo = await req.json(); } catch { return json({ error: "Cuerpo invalido" }, 400); }
  const mime = String(cuerpo.mime ?? "");
  const b64 = String(cuerpo.archivo ?? "").replace(/^data:[^;]+;base64,/, "");
  if (!b64) return json({ error: "Falta el archivo" }, 400);
  if (b64.length * 0.75 > MAX_BYTES) return json({ error: "El archivo pasa de 8 MB" }, 413);

  let bloque: Record<string, unknown>;
  if (mime === "application/pdf") {
    bloque = { type: "document", source: { type: "base64", media_type: mime, data: b64 } };
  } else if (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime)) {
    bloque = { type: "image", source: { type: "base64", media_type: mime, data: b64 } };
  } else {
    return json({ error: "Formato no admitido: usa PDF, JPG o PNG." }, 415);
  }

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: 8000,
      system: INSTRUCCIONES,
      tools: [HERRAMIENTA],
      tool_choice: { type: "tool", name: HERRAMIENTA.name },
      messages: [{
        role: "user",
        content: [bloque, { type: "text", text: "Registra este hemograma." }],
      }],
    }),
  });
  const out = await r.json().catch(() => null);
  if (!r.ok || !out) {
    console.error("lab-extraer: Anthropic", r.status, JSON.stringify(out)?.slice(0, 500));
    return json({ error: "No se pudo leer el documento (" + r.status + ")." }, 502);
  }
  const uso = (out.content ?? []).find((c: { type: string }) => c.type === "tool_use");
  if (!uso || out.stop_reason === "max_tokens") {
    return json({ error: "La lectura quedo incompleta. Prueba con una foto mas nitida o el PDF original." }, 502);
  }
  return json({ datos: uso.input });
});
