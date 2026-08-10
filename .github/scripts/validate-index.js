// Guardia anti-regresión para index.html (app PetColinas).
// Falla (exit 1) si la app no es la versión completa esperada.
// Ejecutado por .github/workflows/validate-app.yml en cada PR/push a main.

const fs = require("fs");

const errores = [];
const html = fs.readFileSync("index.html", "utf8");

// 1) Tamaño mínimo — la versión completa pesa ~1.24 MB; la vieja rota ~765 KB.
const bytes = Buffer.byteLength(html, "utf8");
if (bytes < 1_000_000) {
  errores.push(`index.html demasiado pequeño (${bytes} bytes). La app completa pesa >1 MB. Posible versión regresada/incompleta.`);
}

// 2) Pestañas obligatorias (TABS). Una regresión típica elimina agenda/servicios/vozia/notificaciones.
const TABS_OBLIGATORIAS = [
  "dashboard", "agenda", "ventas", "clientes", "seguimientos",
  "inventario", "nomina", "gastos", "reportes", "facturas",
  "servicios", "importar", "vozia", "notificaciones",
];
for (const id of TABS_OBLIGATORIAS) {
  if (!html.includes(`id: "${id}"`)) {
    errores.push(`Falta la pestaña obligatoria: id: "${id}"`);
  }
}

// 3) Componentes clave que deben existir.
const COMPONENTES = [
  "function Agenda",
  "function PortalVeterinaria",
  "function PortalGroomer",
  "function VozIA",
  "function ExportarExcel",
];
for (const c of COMPONENTES) {
  if (!html.includes(c)) {
    errores.push(`Falta el componente clave: ${c}`);
  }
}

// 4) Sintaxis JS del script embebido (REGLA CRÍTICA 3).
try {
  const ini = html.lastIndexOf("<script>") + 8;
  const fin = html.lastIndexOf("</script>");
  const script = html.slice(ini, fin);
  new Function(script);
} catch (e) {
  errores.push(`SINTAXIS JS INVÁLIDA: ${e.message}`);
}

// 5) La constante de auto-actualización (pc_app_version) debe subir en cada
// cambio de index.html. Estuvo congelada en "20260616-v1" desde el 16 de junio
// mientras la app siguió cambiando: los navegadores del equipo conservaban el
// HTML viejo en caché y nunca recibían los arreglos ya desplegados.
const versionActual = (html.match(/var V = "([^"]+)"/) || [])[1];
if (!versionActual) {
  errores.push('No se encontró la constante de versión (var V = "...") en index.html.');
} else {
  try {
    const { execSync } = require("child_process");
    const base = execSync("git show origin/main:index.html", {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const versionBase = (base.match(/var V = "([^"]+)"/) || [])[1];
    if (versionBase && base !== html && versionBase === versionActual) {
      errores.push(
        `index.html cambió pero la versión sigue en "${versionActual}". ` +
        `Súbela (ej. "${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-v1") ` +
        `o el equipo seguirá viendo la versión vieja en caché.`
      );
    }
  } catch {
    // Sin acceso a origin/main (checkout superficial, clon local): no se valida.
  }
}

if (errores.length > 0) {
  console.error("❌ Validación de index.html FALLÓ — no mergear esta versión:\n");
  errores.forEach((e) => console.error("  • " + e));
  console.error("\nProbablemente se subió una versión equivocada/vieja de la app. Restaura la versión completa antes de mergear.");
  process.exit(1);
}

console.log(`✓ index.html válido (${bytes} bytes, ${TABS_OBLIGATORIAS.length} pestañas, ${COMPONENTES.length} componentes, versión ${versionActual}, sintaxis JS OK).`);
