/**
 * form-intake — puerta de entrada del Google Form al CRM.
 *
 * Por que existe: el Apps Script hablaba directo con la API REST usando la
 * llave anon, que es publica (va dentro de index.html). Para que eso
 * funcionara hubo que abrirle a `anon` una politica de INSERT en pc_clientes
 * — o sea, cualquiera que copiara la llave del navegador podia meter filas
 * basura en el CRM. Ahora el Apps Script llama aqui con un secreto que solo
 * el conoce, y esta funcion escribe con la llave de servicio. La politica
 * anon se puede cerrar.
 *
 * Mismo patron que pagadito-cobro: lo que autoriza a escribir vive como
 * secret del servidor, nunca en un archivo que el cliente descarga.
 *
 * Donde vive el secreto: en la tabla `public.pc_secretos` (fila
 * FORM_INTAKE_SECRET), no como variable de entorno, para poder rotarlo por
 * SQL sin entrar al dashboard a mano.
 *
 * Esta en `public` a proposito, aunque suene raro para un secreto: esta
 * funcion llega a la base por PostgREST (la misma API REST), asi que un
 * esquema oculto de la API tampoco seria visible para ella. La proteccion
 * viene de otro lado: la tabla tiene RLS activo y NINGUNA politica, y no
 * tiene grants para anon ni authenticated — nadie que use la app puede leer
 * una sola fila. service_role tiene BYPASSRLS, y es la unica que entra.
 *
 * Secrets que si son de entorno: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * (ambos ya existen en todo proyecto de Supabase).
 *
 * Desplegar SIN verificacion de JWT: Apps Script no trae sesion de Supabase,
 * su credencial es el secreto compartido.
 *
 * POST { secreto, cliente: { nombremascota, nombrepropietario, ... } }
 *   201 { ok: true, id }            fila creada
 *   200 { ok: true, id, duplicado } ya existia (mismo telefono + mascota)
 *   401 { error }                   secreto invalido
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Se cachea entre invocaciones tibias para no consultar la base en cada
// inscripcion. Si el secreto se rota, la funcion lo recoge cuando el runtime
// recicle el proceso (o al redesplegar).
let secretoCache: string | null = null;
async function obtenerSecreto(): Promise<string> {
  if (secretoCache !== null) return secretoCache;
  const { data, error } = await supabase
    .from("pc_secretos")
    .select("valor").eq("nombre", "FORM_INTAKE_SECRET").maybeSingle();
  if (error) console.error("No se pudo leer el secreto:", error.message);
  secretoCache = data?.valor ?? "";
  return secretoCache;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
};

// Solo estas columnas se aceptan. Cualquier otra cosa que llegue se ignora en
// vez de reventar el insert: el Google Form cambia de preguntas cada tanto.
const COLUMNAS = new Set([
  "nombremascota", "especie", "raza", "sexo", "fechanacimiento", "color", "tamano",
  "esterilizado", "nombrepropietario", "telefono", "email", "direccion", "instagram",
  "alergias", "medicamentos", "condiciones", "veterinarioexterno", "notas",
  "fecharegistro", "cedula",
]);

/** Comparacion en tiempo constante: no filtra el secreto por el tiempo de respuesta. */
function secretoValido(esperado: string, recibido: string): boolean {
  if (!esperado || !recibido || recibido.length !== esperado.length) return false;
  let dif = 0;
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ recibido.charCodeAt(i);
  return dif === 0;
}

const soloDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const esperado = await obtenerSecreto();
  if (!esperado) {
    return json({ error: "Falta la fila FORM_INTAKE_SECRET en pc_secretos." }, 500);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "JSON invalido" }, 400); }

  if (!secretoValido(esperado, String(body.secreto ?? ""))) {
    return json({ error: "No autorizado." }, 401);
  }

  const entrada = (body.cliente ?? {}) as Record<string, unknown>;
  const cliente: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(entrada)) {
    if (COLUMNAS.has(k) && v !== null && v !== undefined && v !== "") cliente[k] = v;
  }
  if (!cliente.nombremascota && !cliente.nombrepropietario) {
    return json({ error: "Hace falta al menos el nombre de la mascota o del propietario." }, 400);
  }

  // Anti-duplicado: si la misma persona llena el formulario dos veces (pasa, y
  // mas cuando el primer intento parece no responder), no se crea otra ficha.
  const tel = soloDigitos(cliente.telefono);
  if (tel.length >= 7) {
    const { data: previos } = await supabase
      .from("pc_clientes")
      .select("id, nombremascota, telefono")
      .ilike("nombremascota", String(cliente.nombremascota ?? ""))
      .limit(50);
    const yaEsta = (previos ?? []).find((p) => soloDigitos(p.telefono).endsWith(tel.slice(-7)));
    if (yaEsta) return json({ ok: true, id: yaEsta.id, duplicado: true }, 200);
  }

  // El id es numerico y lo pone la app con Date.now(); aqui se hace igual para
  // que las fichas del formulario convivan con las que se crean a mano.
  const id = Date.now();
  if (!cliente.fecharegistro) {
    cliente.fecharegistro = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
  }

  const { error } = await supabase.from("pc_clientes").insert({ id, ...cliente });
  if (error) return json({ error: "No se pudo guardar: " + error.message }, 500);

  return json({ ok: true, id }, 201);
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}
