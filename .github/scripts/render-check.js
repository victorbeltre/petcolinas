// Renderiza las vistas principales en un React falso para detectar llamadas a
// funciones que ya no existen. Nace de un caso real: al editar el contador de
// lealtad se borró un bloque de funciones de Facturas y la vista "Ver factura"
// quedaba en blanco; la validación de sintaxis no lo detecta porque el archivo
// es sintácticamente correcto.
const fs = require("fs"), vm = require("vm");
const html = fs.readFileSync("index.html", "utf8");
const script = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));

let hookIdx = 0, hooks = [];
const React = {
  createElement: (t, p, ...c) => ({ t: typeof t === "function" ? t.name : t, p, c }),
  useState: (init) => { const i = hookIdx++; if (!(i in hooks)) hooks[i] = typeof init === "function" ? init() : init;
    return [hooks[i], (v) => { hooks[i] = typeof v === "function" ? v(hooks[i]) : v; }]; },
  useEffect: () => {}, useLayoutEffect: () => {}, useMemo: (f) => f(), useCallback: (f) => f,
  useRef: (v) => ({ current: v }), Fragment: "Fragment", memo: (f) => f,
};
const store = {};
const sandbox = {
  console: { log() {}, warn() {}, error() {} }, React,
  ReactDOM: { createRoot: () => ({ render() {} }) },
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  fetch: () => Promise.resolve({ ok: false, json: () => ({}), text: () => "" }),
  setTimeout: () => 0, setInterval: () => 0, clearInterval() {}, clearTimeout() {},
  document: { getElementById: () => ({}), createElement: () => ({ style: {}, click() {}, remove() {} }), body: { appendChild() {} }, addEventListener() {} },
  navigator: {}, alert() {}, confirm: () => true, Blob: class {}, URL: { createObjectURL: () => "", revokeObjectURL() {} },
  Intl, Date, Math, JSON, encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN,
  Number, String, Object, Array, Set, Map, RegExp, Error, Promise,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
try { vm.runInContext(script, sandbox, { timeout: 30000 }); }
catch (e) { console.error("❌ El script no carga:", e.message); process.exit(1); }

const ventas = [{ id: 1, fecha: "2026-08-08", cliente: "Rocky", area: "grooming", servicio: "Baño pequeño",
  descripcion: "Baño pequeño", total: 799, comision: 100, formapago: "efectivo", formaPago: "efectivo",
  items: [{ nombre: "Baño pequeño", precio: 799, subtotal: 799, descPct: 0 }] }];
const clientes = [{ id: 9, nombreMascota: "Rocky", nombrePropietario: "Ana", telefono: "8095551212", banos2025: 2, notas: "" }];
const factura = { id: "venta_2026-08-08_rocky", numero: "0001", fecha: "2026-08-08", mascota: "Rocky",
  propietario: "Ana", telefono: "8095551212", items: [{ descripcion: "Baño pequeño", cantidad: 1, precio: 799 }],
  itbis: false, subtotal: 799, itbisAmt: 0, total: 799, estado: "pagada", metodoPago: "Efectivo", notas: "" };

const errores = [];
function render(nombre, comp, props, prep, debeContener) {
  if (typeof comp !== "function") { errores.push(`${nombre}: el componente no existe`); return; }
  hookIdx = 0; hooks = [];
  let salida = null;
  try {
    comp(props);
    if (prep) prep(hooks);
    hookIdx = 0;
    salida = comp(props);
  } catch (e) {
    // OJO: los errores nacen dentro del vm, así que "instanceof ReferenceError"
    // del proceso anfitrión NO los reconoce. Se comparan por nombre y mensaje.
    const nom = (e && e.constructor && e.constructor.name) || "";
    if (nom === "ReferenceError" || /is not defined|is not a function/.test(e.message || "")) {
      errores.push(`${nombre}: ${e.message}`);
    }
    return;
  }
  // Comprobar que de verdad se renderizó la vista esperada y no otra: si la
  // preparación de estado falla, la prueba pasaría sin ejercitar nada.
  if (debeContener) {
    const txt = JSON.stringify(salida, (k, v) => (typeof v === "function" ? undefined : v));
    if (!txt || !txt.includes(debeContener)) {
      errores.push(`${nombre}: la prueba no llegó a esa vista (no apareció "${debeContener}") — revisa render-check.js`);
    }
  }
}

const propsFact = { ventas, setVentas() {}, deleteVenta() {}, clientes,
  tarifasGrooming: sandbox.TARIFAS_GROOMING, tarifasVet: sandbox.TARIFAS_VET, inventario: [] };

render("Facturas (lista)", sandbox.Facturas, propsFact);
// facturaActual es el useState declarado justo después de "vista", así que se
// localiza por posición relativa en vez de buscar "el primer null", que caía en
// un hook interno de useSupabase y dejaba la prueba sin ejercitar la vista.
render("Facturas (ver factura)", sandbox.Facturas, propsFact, (h) => {
  const i = h.indexOf("lista");
  if (i < 0) throw new Error("no se encontró el estado 'vista'");
  h[i] = "ver";
  h[i + 1] = factura;
}, "Pasar al fondo");
render("Facturas (nueva factura)", sandbox.Facturas, propsFact, (h) => {
  const i = h.indexOf("lista"); if (i >= 0) h[i] = "nueva";
}, "Servicios / Productos");
render("CierreCaja", sandbox.CierreCaja, { ventas, gastos: [] });
render("Cobros", sandbox.Cobros, {
  ventas: ventas.concat([{ id: 99991, fecha: "2026-01-05", cliente: "Doky Diaz",
    servicio: "Baño pequeño", total: 1289, formapago: "Pago pendiente" }]),
  setVentas: () => {},
  clientes: [{ id: 1, nombreMascota: "Doky Diaz", nombrePropietario: "Ana Diaz", telefono: "8095551234" }]
}, null, "Total por cobrar");
render("AvisoCitasProximas", sandbox.AvisoCitasProximas, {
  citas: [{ id: 5001, fecha: new Date(Date.now() + 864e5).toISOString().slice(0, 10),
    hora: "10:00", nombreMascota: "Doky Diaz", nombreCliente: "Ana Diaz",
    telefono: "8095551234", servicio: "Baño y corte", estado: "pendiente" }],
  setCitas: () => {}, clientes: []
}, null, "sin recordatorio enviado");
render("EstadoSync", sandbox.EstadoSync, {});
render("Planes", sandbox.Planes, {
  paquetes: [{ id: 1, mascota: "Doky Diaz", nombre: "Plan 6 baños", banostotal: 6,
    banosusados: 2, precio: 3995, fecha: "2026-08-01", vence: "2027-04-01", estado: "activo" }],
  setPaquetes: () => {}, clientes: [{ id: 1, nombreMascota: "Doky Diaz" }],
  ventas: [], setVentas: () => {}
}, null, "Planes prepagados");
render("ModalChequeo", sandbox.ModalChequeo, {
  mascota: "Doky Diaz", fecha: "2026-08-17",
  clientes: [{ id: 1, nombreMascota: "Doky Diaz" }],
  veterinario: "Doctora", onCerrar: () => {}, onGuardado: () => {}
}, null, "Chequeo de 5 puntos");
render("Reactivacion", sandbox.Reactivacion, {
  clientes: [{ id: 1, nombreMascota: "Doky Diaz", nombrePropietario: "Ana Diaz",
    telefono: "8095551234", ultimaVisita2025: "2026-06-01" }],
  ventas: [{ id: 1, fecha: "2026-06-01", cliente: "Doky Diaz", total: 1289, area: "grooming" }]
}, null, "Reactivaci");
render("AvisoReactivacion", sandbox.AvisoReactivacion, {
  clientes: [{ id: 1, nombreMascota: "Doky Diaz", telefono: "8095551234" }],
  ventas: [{ id: 1, fecha: new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10),
    cliente: "Doky Diaz", total: 1289 }],
  setTab: () => {}
});
render("AvisoAntiparasitarios", sandbox.AvisoAntiparasitarios, {
  seguimientos: [{ id: 9001, mascota: "Gucci Brito", propietario: "", telefono: "",
    tipo: "antipulgas", proximaFecha: "2026-07-08", completado: false, activo: true,
    notas: "NexGard — toca reforzar la protección (35 días)" }],
  clientes: [{ id: 1, nombreMascota: "Gucci Brito", nombrePropietario: "Dianny Brito", telefono: "" }],
  ventas: [], setTab: () => {}
}, null, "sin tel");
render("Candidatos", sandbox.Candidatos, {});
render("WhatsAppInbox", sandbox.WhatsAppInbox, {});
render("Llamadas", sandbox.Llamadas, {});

if (errores.length) {
  console.error("❌ Vistas que se romperían en pantalla:\n");
  errores.forEach((e) => console.error("  • " + e));
  console.error("\nNormalmente es una función que se llama pero ya no existe.");
  process.exit(1);
}
console.log(`✓ Vistas principales renderizan sin errores (15 comprobadas).`);
