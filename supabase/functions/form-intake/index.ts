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
 * Secrets (Supabase → Edge Functions → Secrets):
 *   FORM_INTAKE_SECRET  — texto largo al azar; el mismo que va en form-to-crm.gs
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (ya existen)
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

const SECRETO = Deno.env.get("FORM_INTAKE_SECRET") ?? "";
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

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
function secretoValido(recibido: string): boolean {
  if (!SECRETO || !recibido || recibido.length !== SECRETO.length) return false;
  let dif = 0;
  for (let i = 0; i < SECRETO.length; i++) dif |= SECRETO.charCodeAt(i) ^ recibido.charCodeAt(i);
  return dif === 0;
}

const soloDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!SECRETO) return json({ error: "Falta el secret FORM_INTAKE_SECRET en el servidor." }, 500);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "JSON invalido" }, 400); }

  if (!secretoValido(String(body.secreto ?? ""))) {
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
