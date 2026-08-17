/**
 * pagadito-diag — funcion temporal, solo para averiguar el protocolo.
 *
 * No cobra, no escribe en la base, no importa nada. Hace tres cosas:
 *   1. Prueba como se llama el parametro de la operacion en apipg/charges.php
 *      (ya sabemos que esa ruta existe: contesta 200 con cuerpo vacio, o sea
 *      que corre pero no reconoce lo que le mandamos).
 *   2. Trae el WSDL del servicio SOAP y saca los nombres reales de operaciones
 *      y parametros. Esa es la fuente autoritativa.
 *   3. Trae la pagina de documentacion de la APIPG como texto plano.
 *
 * Se puede borrar en cuanto la integracion quede andando.
 * Desplegar SIN verificacion de JWT (se abre desde el navegador).
 */

const UID = Deno.env.get("PAGADITO_UID") ?? "";
const WSK = Deno.env.get("PAGADITO_WSK") ?? "";
const BASE = "https://comercios.pagadito.com/apipg/charges.php";

const NOMBRES = ["operation", "f", "op", "action", "method", "oper", "cmd"];

async function probar(nombre: string, envio: "form" | "json" | "get", conFormato: boolean) {
  const campos: Record<string, string> = { uid: UID, wsk: WSK };
  campos[nombre] = "connect";
  if (conFormato) campos.format_return = "json";
  const etiqueta = nombre + " + " + envio + (conFormato ? " + format_return" : "");
  try {
    let resp: Response;
    if (envio === "get") {
      resp = await fetch(BASE + "?" + new URLSearchParams(campos), { method: "GET" });
    } else if (envio === "json") {
      resp = await fetch(BASE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(campos),
      });
    } else {
      resp = await fetch(BASE, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(campos).toString(),
      });
    }
    const cuerpo = await resp.text();
    return { prueba: etiqueta, http: resp.status, largo: cuerpo.length, muestra: cuerpo.slice(0, 300) };
  } catch (e) {
    return { prueba: etiqueta, error: String(e).slice(0, 150) };
  }
}

async function wsdl() {
  const u = "https://comercios.pagadito.com/wspg/charges.php?wsdl";
  try {
    const r = await fetch(u);
    const xml = await r.text();
    const saca = (re: RegExp) => [...new Set([...xml.matchAll(re)].map((m) => m[1]))];
    return {
      http: r.status,
      largo: xml.length,
      operaciones: saca(/<(?:wsdl:)?operation\s+name="([^"]+)"/g),
      partes: saca(/<(?:wsdl:)?part\s+name="([^"]+)"/g),
      elementos: saca(/<(?:xsd?|xs):element\s+name="([^"]+)"/g),
      direccion: (xml.match(/location="([^"]+)"/) || [])[1] ?? null,
      crudo: xml.slice(0, 5000),
    };
  } catch (e) {
    return { error: String(e).slice(0, 200) };
  }
}

async function docs() {
  const u = "https://dev.pagadito.com/index.php?mod=docs&hac=mostrar&tema=APIPG";
  try {
    const r = await fetch(u);
    const html = await r.text();
    const texto = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
      .replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    return { http: r.status, largo: html.length, texto: texto.slice(0, 15000) };
  } catch (e) {
    return { error: String(e).slice(0, 200) };
  }
}

Deno.serve(async () => {
  const pruebas = [];
  for (const n of NOMBRES) pruebas.push(await probar(n, "form", true));
  pruebas.push(await probar("operation", "json", true));
  pruebas.push(await probar("f", "json", true));
  pruebas.push(await probar("operation", "get", true));
  pruebas.push(await probar("f", "get", true));
  pruebas.push(await probar("operation", "form", false));

  const conRespuesta = pruebas.filter((p) => (p.largo ?? 0) > 0);
  const [w, d] = await Promise.all([wsdl(), docs()]);

  return new Response(JSON.stringify({
    credenciales: {
      uid: UID ? UID.slice(0, 6) + "…" + UID.slice(-4) : "FALTA",
      wsk: WSK ? WSK.length + " caracteres" : "FALTA",
    },
    endpoint_probado: BASE,
    las_que_devolvieron_algo: conRespuesta,
    todas_las_pruebas: pruebas,
    wsdl: w,
    docs: d,
  }, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
});
