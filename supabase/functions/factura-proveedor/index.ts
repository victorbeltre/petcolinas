/**
 * factura-proveedor — lee la foto (o el PDF) de la factura de un proveedor y
 * devuelve las lineas para cargarlas al inventario (M23, 26 oct 2026).
 *
 * La funcion SOLO LEE: devuelve una propuesta y no escribe nada. El admin la
 * revisa y corrige en la pestaña Inventario antes de guardar, y el codigo unico
 * de cada producto lo pone la base (trigger pc_inventario_codigo), no la IA.
 *
 * No tiene nada que ver con los hemogramas: los resultados de laboratorio NO se
 * leen (regla de Victor). Una factura de compra si, porque ahi lo que se busca
 * es justamente el texto: producto, cantidad y costo.
 *
 * Solo-admin: la factura trae costos. Se comprueba con pc_es_admin() usando la
 * sesion de quien llama.
 * Secret: ANTHROPIC_API_KEY (el mismo que usaba lab-extraer).
 * Desplegar CON verificacion de JWT.
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
const numero = { type: ["number", "null"] };
const HERRAMIENTA = {
  name: "registrar_factura_compra",
  description: "Registra las lineas de una factura de compra de un proveedor de una clinica veterinaria.",
  input_schema: {
    type: "object",
    properties: {
      es_factura: { type: "boolean", description: "false si el documento NO es una factura, conduce o cotizacion de compra." },
      proveedor: { ...texto, description: "Nombre comercial del proveedor que emite la factura." },
      numero: { ...texto, description: "Numero de factura o de pedido, tal como esta impreso." },
      ncf: { ...texto, description: "NCF (comprobante fiscal dominicano, ej. B0100000123 o E310000000001), si aparece." },
      fecha: { ...texto, description: "Fecha de la factura en formato AAAA-MM-DD." },
      total: { ...numero, description: "Total a pagar de la factura." },
      items: {
        type: "array",
        description: "TODAS las lineas de productos, en el orden del documento. No incluir subtotales, ITBIS, descuentos globales ni fletes.",
        items: {
          type: "object",
          properties: {
            nombre: { type: "string", description: "Nombre corto y claro del producto, con marca y presentacion (ej. 'NexGard Spectra 7.6-15 kg', 'Royal Canin Mini Adult 3 kg'). Sin codigos internos del proveedor." },
            descripcion: { type: "string", description: "Una frase util para el personal: que es y para que sirve (ej. 'Antiparasitario masticable interno y externo para perros de 7.6 a 15 kg')." },
            categoria: {
              type: "string",
              enum: ["farmaco", "alimento", "accesorio", "higiene", "insumo", "papeleria", "otro"],
              description: "farmaco = medicamentos, vacunas, antiparasitarios, suplementos; alimento = comida y snacks para mascotas; accesorio = collares, correas, juguetes, camas, platos, ropa; higiene = shampoo, colonias, toallitas, pañales y productos de limpieza de la mascota para la venta; insumo = material de uso interno de la clinica (jeringas, gasas, guantes, cuchillas, desinfectante); papeleria = oficina; otro = lo que no encaje.",
            },
            cantidad: { type: "number", description: "Unidades compradas. Si la linea dice cajas con N unidades y se venden sueltas, devolver el total de unidades e indicarlo en nota." },
            costo_unitario: { ...numero, description: "Precio unitario de compra SIN ITBIS, si se puede leer." },
            vencimiento: { ...texto, description: "Fecha de vencimiento AAAA-MM-DD si la factura la trae." },
            lote: texto,
            nota: { ...texto, description: "Cualquier aclaracion (ej. 'caja de 3 tabletas', 'bonificado')." },
            dudoso: { type: "boolean", description: "true si el nombre, la cantidad o el costo no se leen con total certeza." },
          },
          required: ["nombre", "descripcion", "categoria", "cantidad", "dudoso"],
        },
      },
      advertencias: { type: "array", items: { type: "string" }, description: "Lo que impida una lectura fiable: foto cortada, borrosa, paginas faltantes." },
    },
    required: ["es_factura", "items", "advertencias"],
  },
};

const INSTRUCCIONES =
  "Lees facturas de compra de proveedores de PetColinas, una clinica veterinaria y tienda de mascotas en " +
  "Republica Dominicana. Registra cada linea de producto con la herramienta. Copia cantidades y costos tal " +
  "como estan impresos: no inventes ni completes lo que no se lee (dejalo en null y marca dudoso=true). " +
  "El nombre debe servir para buscar el producto en la tienda; la descripcion, para que el personal sepa " +
  "que es. Clasifica cada producto en la categoria correcta.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Metodo no permitido" }, 405);

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ") || auth.length < 30) return json({ error: "No autorizado" }, 401);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: esAdmin, error: eAuth } = await sb.rpc("pc_es_admin");
  if (eAuth || esAdmin !== true) return json({ error: "Solo el administrador puede cargar facturas." }, 403);

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
    return json({ error: "Formato no admitido: usa foto (JPG/PNG) o PDF." }, 415);
  }

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: 8000,
      system: INSTRUCCIONES,
      tools: [HERRAMIENTA],
      tool_choice: { type: "tool", name: HERRAMIENTA.name },
      messages: [{ role: "user", content: [bloque, { type: "text", text: "Registra esta factura de compra." }] }],
    }),
  });
  const out = await r.json().catch(() => null);
  if (!r.ok || !out) {
    console.error("factura-proveedor: Anthropic", r.status, JSON.stringify(out)?.slice(0, 500));
    return json({ error: "No se pudo leer la factura (" + r.status + ")." }, 502);
  }
  const uso = (out.content ?? []).find((c: { type: string }) => c.type === "tool_use");
  if (!uso || out.stop_reason === "max_tokens") {
    return json({ error: "La lectura quedo incompleta. Prueba con una foto mas nitida o por partes." }, 502);
  }
  return json({ datos: uso.input });
});
