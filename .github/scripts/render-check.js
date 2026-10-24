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
let impreso = "";
const sandbox = {
  console: { log() {}, warn() {}, error() {} }, React,
  ReactDOM: { createRoot: () => ({ render() {} }) },
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  fetch: () => Promise.resolve({ ok: false, json: () => ({}), text: () => "" }),
  setTimeout: () => 0, setInterval: () => 0, clearInterval() {}, clearTimeout() {},
  document: { getElementById: () => ({}), createElement: () => ({ style: {}, click() {}, remove() {} }), body: { appendChild() {} }, addEventListener() {} },
  navigator: {}, alert() {}, confirm: () => true, Blob: class {}, URL: { createObjectURL: () => "", revokeObjectURL() {} },
  // Ventana de impresión falsa: guarda el HTML que se le escribe para poder
  // comprobar lo que saldría en el papel (receta, factura impresa...).
  open: () => ({ document: { write(h) { impreso = h; }, close() {} }, print() {} }),
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
const enVM = (codigo) => vm.runInContext(codigo, sandbox);
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
// Caja (M18). CierreCaja ya solo reparte entre el dia a dia y los reportes; el
// React falso NO baja a los hijos, asi que cada uno se renderiza aparte.
render("CierreCaja (reparte al día)", sandbox.CierreCaja, {}, null, "CajaDia");
render("CierreCaja (reparte al reporte)", sandbox.CierreCaja, {}, (h) => {
  const i = h.indexOf("dia");
  if (i < 0) throw new Error("no se encontró el estado 'modo'");
  h[i] = "mes";
}, "CajaReporte");
// El libro se lee de la base, asi que sin datos sale "sin movimientos"; se le
// inyecta una fila para ejercitar la tabla de verdad.
render("CajaDia (dia sin abrir)", sandbox.CajaDia, {}, (h) => {
  const i = h.findIndex((x) => x === true);   // cargando
  if (i >= 0) h[i] = false;
}, "Abrir el d");
render("CajaDia (con movimientos)", sandbox.CajaDia, {}, (h) => {
  const iCarg = h.findIndex((x) => x === true); if (iCarg >= 0) h[iCarg] = false;
  const iLibro = h.findIndex((x) => Array.isArray(x) && x.length === 0);
  if (iLibro < 0) throw new Error("no se encontro el estado 'libro'");
  h[iLibro] = [{ id: "venta:1", fecha: "2026-10-07", fecha_hora: "2026-10-07T10:30:00Z",
    referencia: "1", concepto: "Bano pequeno - Rocky", categoria: "grooming",
    metodo_pago: "EFECTIVO", banco: null, entrada: 799.50, salida: 0, origen: "venta" }];
  h[iLibro + 1] = { fecha: "2026-10-07", estado: "abierta", saldo_inicial: 1000.25 };
  h[iLibro + 2] = { saldo_inicial: 1000.25, entradas_efectivo: 799.50, salidas_efectivo: 0,
    teorico_efectivo: 1799.75, entradas_total: 799.50, salidas_total: 0 };
}, "Bano pequeno - Rocky");
// El reporte de periodo. Todo lo suma Postgres y baja en un solo jsonb, asi que
// la prueba inyecta esa respuesta tal cual la devuelve pc_caja_reporte: si
// alguien le cambia la forma al jsonb, aqui revienta antes de llegar a pantalla.
const repEjemplo = (ent, sal) => ({
  desde: "2026-08-01", hasta: "2026-08-31", dias_rango: 31,
  totales: { entradas: ent, salidas: sal, neto: ent - sal, movimientos: 130,
    dias_con_movimiento: 24, promedio_dia_entradas: ent / 24, promedio_dia_neto: (ent - sal) / 24 },
  por_metodo: [{ metodo: "EFECTIVO", entradas: ent, salidas: sal, neto: ent - sal, movimientos: 120 },
    { metodo: "SIN ANOTAR", entradas: 0, salidas: 0, neto: 0, movimientos: 10 }],
  por_categoria: [{ categoria: "grooming", entradas: ent, salidas: 0, neto: ent, movimientos: 118 }],
  por_dia: [{ fecha: "2026-08-04", entradas: ent, salidas: sal, neto: ent - sal, movimientos: 7 }],
  arqueos: { cerrados: 2, abiertos: 1, con_descuadre: 1, descuadre_neto: -25.50, descuadre_abs: 25.50 }
});
render("CajaReporte", sandbox.CajaReporte, { modo: "mes" }, (h) => {
  const i = h.findIndex((x) => x === null);   // rep
  if (i < 0) throw new Error("no se encontró el estado 'rep'");
  h[i] = repEjemplo(195380.00, 1550.00);
  h[i + 1] = repEjemplo(150000.00, 1000.00);
  const j = h.findIndex((x) => x === true);   // cargando
  if (j >= 0) h[j] = false;
}, "Por método de pago");
// Y que las cifras salgan con centavos: el reporte es lo que Victor mira para
// decidir, y RD() redondeando esconde justo lo que no cuadra.
render("CajaReporte (centavos)", sandbox.CajaReporte, { modo: "rango" }, (h) => {
  const i = h.findIndex((x) => x === null);
  if (i < 0) throw new Error("no se encontró el estado 'rep'");
  h[i] = repEjemplo(1799.75, 0.25);
  h[i + 1] = null;
  const j = h.findIndex((x) => x === true);
  if (j >= 0) h[j] = false;
}, "1,799.75");
// M19 · Cuentas. Se inyecta la respuesta de pc_cuentas_estado tal cual la
// devuelve el jsonb: si alguien le cambia la forma, revienta aqui y no delante
// de Victor. Incluye una cuenta sin ancla y otra con partidas pendientes.
const cuentaEj = (id, nombre, tipo, extra) => Object.assign({
  cuenta_id: id, nombre, tipo, se_cuenta: tipo === "EFECTIVO",
  ancla_fecha: "2026-10-06", ancla_saldo: 5000.25, ancla_origen: "declarado",
  sin_ancla: false, saldo_inicial: 5000.25, entradas: 1799.75, salidas: 250.00,
  saldo_final_teorico: 6550.00, declarado_hoy: null, declarado_origen: null,
  diferencia: null, movimientos: 4
}, extra || {});
render("CajaCuentas", sandbox.CajaCuentas, {}, (h) => {
  const i = h.findIndex((x) => x === null);   // estado
  if (i < 0) throw new Error("no se encontró el estado 'estado'");
  h[i] = { fecha: "2026-10-07", cuentas: [
    cuentaEj("gaveta", "Caja chica (gaveta)", "EFECTIVO", { declarado_hoy: 6550.00, declarado_origen: "arqueo", diferencia: 0 }),
    cuentaEj("banreservas", "Banreservas", "BANCO", { declarado_hoy: 6200.00, diferencia: -350.00 }),
    cuentaEj("tarjetas", "Tarjetas por liquidar", "PUENTE", { sin_ancla: true, ancla_fecha: null, ancla_saldo: null }),
    cuentaEj("sin_asignar", "Sin asignar", "SIN_ASIGNAR", { saldo_final_teorico: -85117.00 })
  ] };
  h[i + 1] = [{ id: 1, fecha: "2026-10-07", cuenta_origen: "tarjetas", cuenta_destino: "banreservas",
    monto: 10000.00, monto_recibido: 9650.00, concepto: "Liquidacion POS" }];
  h[i + 2] = [{ id: "gaveta", nombre: "Caja chica (gaveta)" }, { id: "banreservas", nombre: "Banreservas" }];
  const j = h.findIndex((x) => x === true);  // cargando
  if (j >= 0) h[j] = false;
}, "Partidas pendientes");
// Y que el aviso de "sin punto de partida" salga: sin el, un teorico que es la
// suma de todo desde 2025 pasaria por un saldo real.
render("CajaCuentas (sin ancla)", sandbox.CajaCuentas, {}, (h) => {
  const i = h.findIndex((x) => x === null);
  if (i < 0) throw new Error("no se encontró el estado 'estado'");
  h[i] = { fecha: "2026-10-07", cuentas: [
    cuentaEj("popular", "Popular", "BANCO", { sin_ancla: true, ancla_fecha: null, ancla_saldo: null })] };
  h[i + 1] = []; h[i + 2] = [];
  const j = h.findIndex((x) => x === true);
  if (j >= 0) h[j] = false;
}, "no tiene punto de partida");
// Cuando el servidor dice que no, la pantalla lo dice y no enseña numeros.
render("CajaCuentas (sin permiso)", sandbox.CajaCuentas, {}, (h) => {
  const i = h.findIndex((x) => x === "");    // error
  if (i >= 0) h[i] = "Las cuentas de banco solo las ve el administrador.";
  const j = h.findIndex((x) => x === true);
  if (j >= 0) h[j] = false;
}, "solo las ve el administrador");
render("ModalTraslado", sandbox.ModalTraslado, {
  fecha: "2026-10-07", ocupado: false, onCerrar: () => {}, onGuardar: () => {},
  cuentas: [{ id: "gaveta", nombre: "Caja chica (gaveta)" }, { id: "banreservas", nombre: "Banreservas" }]
}, null, "Mover dinero entre cuentas");
render("ModalSaldoBanco", sandbox.ModalSaldoBanco, {
  fecha: "2026-10-07", ocupado: false, onCerrar: () => {}, onGuardar: () => {},
  cuenta: { cuenta_id: "banreservas", nombre: "Banreservas", saldo_final_teorico: 6550.00 }
}, null, "Saldo real de ");
// M19b · El dinero clasificado por cuenta. Se renderiza aparte porque el React
// falso no baja a los hijos: dentro de CajaReporte solo saldria el nodo.
const CC = { verde: "#1a6b3a", azul: "#1a4fa0", grisd: "#5a6472", rojo: "#c0392b", borde: "#e0e4e8" };
const repCuentas = {
  por_cuenta: [
    { cuenta_id: "gaveta", nombre: "Caja chica (gaveta)", tipo: "EFECTIVO", orden: 10, entradas: 61867.10, salidas: 0, neto: 61867.10, movimientos: 49 },
    { cuenta_id: "banreservas", nombre: "Banreservas", tipo: "BANCO", orden: 20, entradas: 30053.00, salidas: 0, neto: 30053.00, movimientos: 14 },
    { cuenta_id: "popular", nombre: "Popular", tipo: "BANCO", orden: 30, entradas: 11337.00, salidas: 0, neto: 11337.00, movimientos: 9 },
    { cuenta_id: "tarjetas", nombre: "Tarjetas por liquidar", tipo: "PUENTE", orden: 50, entradas: 83736.00, salidas: 0, neto: 83736.00, movimientos: 56 },
    { cuenta_id: "sin_asignar", nombre: "Sin asignar", tipo: "SIN_ASIGNAR", orden: 90, entradas: 36810.00, salidas: 0, neto: 36810.00, movimientos: 23 }
  ],
  por_cuenta_categoria: [
    { cuenta_id: "gaveta", categoria: "grooming", entradas: 38240.10, salidas: 0, neto: 38240.10, total: 38240.10, movimientos: 32 },
    { cuenta_id: "gaveta", categoria: "Abonos", entradas: 8597.00, salidas: 0, neto: 8597.00, total: 8597.00, movimientos: 9 }
  ]
};
render("TarjetaPorCuenta", sandbox.TarjetaPorCuenta, { rep: repCuentas, C: CC, n: (x) => Number(x) || 0 },
  null, "Caja chica");
// Desplegada: tienen que salir las categorias de esa cuenta.
render("TarjetaPorCuenta (desplegada)", sandbox.TarjetaPorCuenta,
  { rep: repCuentas, C: CC, n: (x) => Number(x) || 0 },
  (h) => { const i = h.indexOf(""); if (i < 0) throw new Error("no se encontró 'abierta'"); h[i] = "gaveta"; },
  "38,240.10");
// Y que los cuatro bloques esten, sobre todo el de "sin asignar": si ese se
// pierde de vista, nadie arregla nunca los datos que caen ahi.
(() => {
  const salida = sandbox.TarjetaPorCuenta({ rep: repCuentas, C: CC, n: (x) => Number(x) || 0 });
  const txt = JSON.stringify(salida, (k, v) => (typeof v === "function" ? undefined : v));
  ["Caja chica", "Bancos", "Tarjetas por liquidar", "Sin asignar"].forEach((b) => {
    if (!txt.includes(b)) errores.push(`TarjetaPorCuenta: falta el bloque "${b}"`);
  });
})();
// Para caja el servidor manda por_cuenta en nulo. La tarjeta no debe aparecer
// ni a medias: si se renderizara vacia, pareceria que no entro nada.
render("CajaReporte (caja, sin por_cuenta)", sandbox.CajaReporte, { modo: "mes" }, (h) => {
  const i = h.findIndex((x) => x === null);
  if (i < 0) throw new Error("no se encontró el estado 'rep'");
  h[i] = Object.assign(repEjemplo(195380.00, 1550.00), { por_cuenta: null, por_cuenta_categoria: null });
  h[i + 1] = null;
  const j = h.findIndex((x) => x === true);
  if (j >= 0) h[j] = false;
}, "Por método de pago");
// Gastos: "Pagado por" y "Metodo" se elegian en pantalla pero NO se guardaban
// (la base solo escribia formapago desde formaPago y la app usa metodo/pagadoPor),
// asi que se perdian al recargar: 55 de 68 gastos sin metodo. Ida y vuelta:
(() => {
  const g = { id: "9", fecha: "2026-10-16", categoria: "insumo", descripcion: "Shampoo", monto: 1250.25,
    proveedor: "X", metodo: "tarjeta empresarial Banreservas", pagadoPor: "Petcolinas" };
  const db = enVM('denormalizeRow("pc_gastos", ' + JSON.stringify(g) + ')');
  if (db.formapago !== "tarjeta empresarial Banreservas") errores.push("Gastos: el metodo no llega a formapago (" + db.formapago + ")");
  if (db.pagadopor !== "Petcolinas") errores.push("Gastos: pagadoPor no llega a pagadopor (" + db.pagadopor + ")");
  const back = enVM('normalizeRow("pc_gastos", ' + JSON.stringify(db) + ')');
  if (back.metodo !== g.metodo || back.pagadoPor !== g.pagadoPor) errores.push("Gastos: metodo/pagadoPor no sobreviven a recargar");
  // Un gasto viejo sin nada no debe inventarse metodo ni pagador.
  const viejo = enVM('normalizeRow("pc_gastos", { id: "1", fecha: "2026-01-01", monto: 5, formapago: null, pagadopor: null })');
  if (viejo.metodo || viejo.pagadoPor) errores.push("Gastos: un gasto viejo no deberia traer metodo ni pagador inventados");
})();
render("Gastos", sandbox.Gastos, {
  gastos: [{ id: "9", fecha: new Date().toISOString().slice(0, 7) + "-05", categoria: "insumo", descripcion: "Shampoo",
    monto: 1250.25, metodo: "tarjeta empresarial Banreservas", pagadoPor: "Petcolinas" }],
  setGastos: () => {}
}, null, "Petcolinas");
(() => {
  const salida = sandbox.TarjetaPorCuenta({ rep: { por_cuenta: [
    { cuenta_id: "tarjeta_empresa", nombre: "Tarjeta empresarial Banreservas", tipo: "CREDITO", orden: 60,
      entradas: 0, salidas: 1250.25, neto: -1250.25, movimientos: 1 }], por_cuenta_categoria: [] },
    C: CC, n: (x) => Number(x) || 0 });
  const txt = JSON.stringify(salida, (k, v) => (typeof v === "function" ? undefined : v));
  if (!txt.includes("Tarjeta empresarial")) errores.push("TarjetaPorCuenta: la tarjeta empresarial no aparece en ningun bloque");
})();
// M21 · Resultados de laboratorio. REGLA: el documento se usa como imagen; NUNCA
// se lee ni se reescribe un resultado. Una version anterior hacia OCR y cambio
// valores al probarla con una foto. Si alguien vuelve a meter lectura, esto falla.
(() => {
  ["parsearFilasLab", "datosDeTexto", "leerDocumentoLab", "ocrLab", "leerPDFLab", "plantillaLab"].forEach((f) => {
    if (typeof sandbox[f] === "function") errores.push("Laboratorio: existe " + f + "(): los resultados no se leen ni se reescriben");
  });
  if (/tesseract/i.test(html)) errores.push("Laboratorio: aparece tesseract (OCR) en index.html: los resultados no se leen");
  ["generarLabPDFDoc", "componerPaginaLab", "paginasDeArchivo"].forEach((f) => {
    if (typeof sandbox[f] !== "function") errores.push("Laboratorio: falta " + f);
  });
})();
render("LabResultados", sandbox.LabResultados, { clienteId: "9", cliente: { nombreMascota: "Rocky" } }, null, "Resultados de laboratorio");
const paginaLab = { url: "data:image/jpeg;base64,AAAA", w: 1000, h: 1400 };
render("ModalLabPreparar", sandbox.ModalLabPreparar, {
  paginas: [paginaLab, paginaLab], archivo: { type: "application/pdf" }, ocupado: false, cliente: { nombreMascota: "Rocky" },
  onCerrar: () => {}, onGuardar: () => {}
}, null, "Convertir a formato PetColinas");
// El texto de la pantalla promete que los resultados no se tocan: que ningun
// campo de la pantalla pueda ser de resultados. Solo hay laboratorio y fecha.
(() => {
  hookIdx = 0; hooks = [];
  const todos = (n, f, acc = []) => { if (!n || typeof n !== "object") return acc; if (Array.isArray(n)) { n.forEach((x) => todos(x, f, acc)); return acc; } if (f(n)) acc.push(n); [].concat(n.c || []).forEach((c) => todos(c, f, acc)); return acc; };
  const arbol = sandbox.ModalLabPreparar({ paginas: [paginaLab], archivo: null, ocupado: false, cliente: {}, onCerrar() {}, onGuardar() {} });
  // Solo controles de PetColinas: fecha, las dos franjas (range) y la casilla de teñir.
  // Ningun texto libre: nada donde escribir o cambiar un resultado.
  const campos = todos(arbol, (n) => n.t === "textarea" || n.t === "select" || (n.t === "input" && !(n.p && ["date", "range", "checkbox"].includes(n.p.type))));
  if (campos.length) errores.push("ModalLabPreparar: hay " + campos.length + " campo(s) de texto: no debe haber donde editar resultados");
  const txt = JSON.stringify(arbol, (k, v) => (typeof v === "function" ? undefined : v));
  if (/Laboratorio \(para el pie/.test(txt)) errores.push("ModalLabPreparar: no debe pedirse el nombre del laboratorio");
})();
// Desparasitacion: el PRODUCTO manda (que cubre y cuanto dura) y de ahi salen el
// recordatorio, la fecha y el mensaje de WhatsApp.
//   NexGard Spectra: desparasita por dentro y por fuera, efecto 35 dias.
//   Ferox: protege solo por fuera (pulgas y garrapatas), efecto 3 meses.
(() => {
  const ev = (c) => enVM(c);
  const fallo = (m) => errores.push(m);
  // Meses de CALENDARIO, no bloques de 30 dias.
  [["2026-10-15", 1, "2026-11-15"], ["2026-10-15", 3, "2027-01-15"], ["2026-01-31", 1, "2026-02-28"],
   ["2026-11-30", 3, "2027-02-28"], ["2028-01-31", 1, "2028-02-29"], ["2026-12-20", 1, "2027-01-20"]].forEach(([f, n, esp]) => {
    const r = ev(`sumarMeses("${f}", ${n})`);
    if (r !== esp) fallo(`sumarMeses(${f}, ${n}) dio ${r}, se esperaba ${esp}`);
  });
  [[30, "1 mes"], [35, "35 d\u00EDas"], [84, "3 meses"], [90, "3 meses"], [45, "45 d\u00EDas"]].forEach(([n, esp]) => {
    const r = ev(`duracionTexto(${n})`); if (r !== esp) fallo(`duracionTexto(${n}) dio "${r}", se esperaba "${esp}" (35 dias NO es "1 mes")`);
  });
  // ---- el catalogo ----
  const sp = ev('detectarAntiparasitario("NexGard Spectra 15-30kg")'), fe = ev('detectarAntiparasitario("Ferox 2.5kg")'), ng = ev('detectarAntiparasitario("NexGard")');
  if (!sp || sp.nombre !== "NexGard Spectra" || sp.dias !== 35 || sp.cobertura !== "interna_externa" || sp.tipo !== "desparasitacion") fallo("NexGard Spectra mal clasificado: " + JSON.stringify(sp));
  if (!fe || fe.dias !== 90 || fe.meses !== 3 || fe.cobertura !== "externa" || fe.tipo !== "antipulgas") fallo("Ferox debe durar 3 meses y cubrir solo por fuera: " + JSON.stringify(fe));
  if (!ng || ng.nombre !== "NexGard" || ng.cobertura !== "externa") fallo("NexGard comun no debe confundirse con Spectra: " + JSON.stringify(ng));
  if (ev('proximaFechaProducto(infoProducto("Ferox"), "2026-10-23")') !== "2027-01-23") fallo("Ferox: +3 meses desde el 23 oct debe ser el 23 ene");
  if (ev('proximaFechaProducto(infoProducto("NexGard Spectra"), "2026-10-23")') !== "2026-11-27") fallo("Spectra: +35 dias desde el 23 oct debe ser el 27 nov");
  const sg = ev('seguimientoAntiparasitario("Rocky", "2026-10-23", detectarAntiparasitario("Ferox"), "")');
  if (sg.proximaFecha !== "2027-01-23" || sg.tipo !== "antipulgas") fallo("recordatorio automatico de Ferox mal armado: " + JSON.stringify(sg));
  const sg2 = ev('seguimientoAntiparasitario("Rocky", "2026-10-23", detectarAntiparasitario("NexGard Spectra"), "")');
  if (sg2.proximaFecha !== "2026-11-27" || sg2.tipo !== "desparasitacion") fallo("recordatorio automatico de Spectra mal armado: " + JSON.stringify(sg2));
  // La cadencia de citas: el producto con plazo propio gana sobre el generico.
  [["Bravecto antipulgas", 90], ["Ferox antipulgas", 90], ["NexGard Spectra", 35], ["NexGard", 30]].forEach(([txt, d]) => {
    const r = ev(`proximaCitaSugerida(${JSON.stringify(txt)}, "2026-10-23")`);
    if (!r || r.dias !== d) fallo(`proximaCitaSugerida("${txt}") sugiere ${r && r.dias} dias, se esperaban ${d}`);
  });
  // Un desparasitante SIN plazo conocido ya no se asume antipulgas de 35 dias.
  if (ev('detectarAntiparasitario("Desparasitante generico")') !== null) fallo("'desparasit' no debe asumirse antipulgas de 35 dias");
  if (!ev('detectarDesparasitante("Pastilla desparasitante")')) fallo("detectarDesparasitante no reconoce un desparasitante");
  // El Dashboard avisa de los dos tipos.
  if (!ev('tocaReforzar({ tipo: "desparasitacion", proximaFecha: "2026-10-25", completado: false, activo: true }, "2026-10-23")')) fallo("tocaReforzar no cubre desparasitacion");
  // ---- el recordatorio manual ----
  const a1 = ev('armarRecordatorioParasitos({ mascota: "Rocky", fecha: "2026-10-23", opcion: "1" })');
  const a3 = ev('armarRecordatorioParasitos({ mascota: "Rocky", fecha: "2026-10-23", opcion: "3", tipo: "antipulgas", producto: "Ferox" })');
  const a35 = ev('armarRecordatorioParasitos({ mascota: "Rocky", fecha: "2026-10-23", opcion: "otro", diasOtro: 35, producto: "NexGard Spectra" })');
  if (a1.proximaFecha !== "2026-11-23" || a1.frecuencia !== 30 || a1.tipo !== "desparasitacion") fallo("recordatorio de 1 mes mal calculado: " + JSON.stringify(a1));
  if (a3.proximaFecha !== "2027-01-23" || a3.frecuencia !== 90) fallo("recordatorio de 3 meses mal calculado: " + JSON.stringify(a3));
  if (a35.proximaFecha !== "2026-11-27" || a35.frecuencia !== 35 || !a35.notas.includes("35 d\u00EDas")) fallo("recordatorio de 35 dias mal calculado: " + JSON.stringify(a35));
  // Sin duplicados, pero POR TIPO: dos Ferox no se acumulan; un Ferox y un Spectra si conviven.
  const f1 = ev('fusionarRecordatorio([{ id: 7, mascota: "Rocky", tipo: "antipulgas", completado: false, activo: true, proximaFecha: "2026-10-01" }], armarRecordatorioParasitos({ mascota: "rocky ", fecha: "2026-10-23", opcion: "3", tipo: "antipulgas" }))');
  if (f1.lista.length !== 1 || !f1.actualizo || f1.seg.id !== 7 || f1.seg.proximaFecha !== "2027-01-23") fallo("fusionarRecordatorio duplico o no actualizo: " + JSON.stringify(f1));
  const f2 = ev('fusionarRecordatorio([{ id: 7, mascota: "Rocky", tipo: "antipulgas", completado: false, activo: true, proximaFecha: "2026-12-01" }], armarRecordatorioParasitos({ mascota: "Rocky", fecha: "2026-10-23", tipo: "desparasitacion" }))');
  if (f2.lista.length !== 2 || f2.actualizo) fallo("un Ferox (solo por fuera) y un Spectra (por dentro) NO deben pisarse: " + JSON.stringify(f2));
  const f3 = ev('fusionarRecordatorio([{ id: 7, mascota: "Rocky", tipo: "antipulgas", completado: true }], armarRecordatorioParasitos({ mascota: "Rocky", fecha: "2026-10-23", tipo: "antipulgas" }))');
  if (f3.lista.length !== 2) fallo("un recordatorio YA completado no debe fusionarse con el nuevo");
  // ---- el mensaje: depende del producto ----
  const m = (o, h) => ev(`mensajeRecordatorioParasitos(${JSON.stringify(o)}, "${h}")`);
  const SPEC = { propietario: "Ana Diaz", mascota: "Rocky", producto: "NexGard Spectra", tipo: "desparasitacion", frecuencia: 35, ultimaFecha: "2026-10-23", proximaFecha: "2026-11-27" };
  const FER = { propietario: "Ana Diaz", mascota: "Rocky", producto: "Ferox", tipo: "antipulgas", frecuencia: 90, ultimaFecha: "2026-10-23", proximaFecha: "2027-01-23" };
  const ms = m(SPEC, "2026-11-24"), mf = m(FER, "2027-01-20");
  ["Hola Ana!", "Rocky", "NexGard Spectra", "23 de octubre", "desparasita por dentro y por fuera", "efecto de 35 d\u00EDas", "es el 27 de noviembre (en 3 d\u00EDas)", "PetColinas"].forEach((x) => { if (!ms.includes(x)) fallo('mensaje de Spectra: falta "' + x + '" en: ' + ms); });
  ["Hola Ana!", "Ferox", "pulgas y garrapatas", "dura 3 meses", "protege por fuera", "desparasitaci\u00F3n interna es aparte", "es el 23 de enero de 2027"].forEach((x) => { if (!mf.includes(x)) fallo('mensaje de Ferox: falta "' + x + '" en: ' + mf); });
  if (/por dentro y por fuera/.test(mf)) fallo("Ferox solo protege por fuera: su mensaje NO debe decir que desparasita por dentro: " + mf);
  if (/pulgas|garrapatas/.test(ms)) fallo("Spectra desparasita por dentro y por fuera: su mensaje no debe presentarse como solo antipulgas: " + ms);
  if (!m(SPEC, "2026-11-27").includes("es hoy") || !m(SPEC, "2026-11-26").includes("es ma\u00F1ana")) fallo("el mensaje debe decir 'es hoy' / 'es ma\u00F1ana'");
  if (!m(SPEC, "2026-11-28").includes("se venci\u00F3 hace 1 d\u00EDa") || !m(SPEC, "2026-12-04").includes("hace 7 d\u00EDas")) fallo("vencido: singular y plural");
  const gen = m({ propietario: "Ana", mascota: "Rocky", producto: "Desparasitante", tipo: "desparasitacion", frecuencia: 30, ultimaFecha: "2026-10-23", proximaFecha: "2026-11-23" }, "2026-11-20");
  if (/con Desparasitante/.test(gen) || !gen.includes("se desparasit\u00F3 el 23 de octubre (el tratamiento dura 1 mes)")) fallo("sin producto el mensaje no debe decir 'con Desparasitante': " + gen);
  const sinDueno = m({ propietario: "", mascota: "Luna", producto: "Frontline", tipo: "antipulgas", frecuencia: 35, ultimaFecha: "2026-10-23", proximaFecha: "2026-11-27" }, "2026-11-25");
  if (!sinDueno.startsWith("Hola! ") || !sinDueno.includes("35 d\u00EDas")) fallo("mensaje sin due\u00F1o mal armado: " + sinDueno);
  // El WhatsApp de Seguimientos usa el mensaje nuevo, y los otros tipos siguen igual.
  const wa = decodeURIComponent(ev('whatsappMsg({ tipo: "antipulgas", mascota: "Rocky", propietario: "Ana Diaz", notas: "Ferox \u2014 dura 3 meses", frecuencia: 90, ultimaFecha: "2026-10-23", proximaFecha: "2027-01-23" })'));
  if (!wa.includes("Hola Ana!") || !wa.includes("Ferox") || !wa.includes("protege por fuera")) fallo("whatsappMsg no usa el mensaje del producto: " + wa);
  if (!decodeURIComponent(ev('whatsappMsg({ tipo: "bano_regular", mascota: "Rocky", frecuencia: 21 })')).includes("ba\u00F1o")) fallo("whatsappMsg: los otros tipos deben seguir igual");
})();
// "Mascota lista" pide la rese\u00F1a en Google con el enlace que abre DIRECTO la
// ventana de escribirla (lo usan el CRM del admin y el portal de la doctora).
(() => {
  const fallo = (m) => errores.push(m);
  const url = enVM("GOOGLE_RESENA_URL");
  if (!/^https:\/\/search\.google\.com\/local\/writereview\?placeid=ChIJ[\w-]+$/.test(url)) fallo("GOOGLE_RESENA_URL debe abrir directo la rese\u00F1a de Google: " + url);
  const msg = enVM('msgMascotaLista({ nombrePropietario: "Ana Diaz", nombreMascota: "Rocky" })');
  if (!msg.includes(url) || !msg.includes("Rocky") || !msg.includes("RD$400")) fallo("el aviso de mascota lista debe conservar su texto y llevar el enlace de la rese\u00F1a: " + msg);
})();
render("ProgramarDesparasitacion", sandbox.ProgramarDesparasitacion, {
  inicial: { mascota: "Rocky", producto: "Bravecto", opcion: "3", fecha: "2026-10-23", tipo: "antipulgas" },
  clientes: [{ id: 1, nombreMascota: "Rocky", nombrePropietario: "Ana Diaz", telefono: "8095551234" }],
  seguimientos: [], setSeguimientos: () => {}, onCerrar: () => {}
}, null, "Programar pr\u00F3xima desparasitaci\u00F3n");
render("ModalArqueo", sandbox.ModalArqueo, {
  fecha: "2026-10-07", ocupado: false, onCerrar: () => {}, onCerrarCaja: () => {},
  resumen: { saldo_inicial: 1000.25, entradas_efectivo: 799.50, salidas_efectivo: 0, teorico_efectivo: 1799.75 }
}, null, "Debe haber en la gaveta");
render("ModalMovimientoCaja", sandbox.ModalMovimientoCaja, {
  fecha: "2026-10-07", metodos: ["EFECTIVO","TRANSFERENCIA"], ocupado: false,
  onCerrar: () => {}, onGuardar: () => {}
}, null, "Retiro al banco");
// El formateador con centavos: si alguien lo cambia por RD() se pierden los
// centavos y el arqueo deja de cuadrar.
// RDc se declara con `const`, que en un contexto de vm NO queda como propiedad
// del objeto global: hay que evaluarlo desde dentro.
(() => {
  const r = vm.runInContext('RDc(1799.75)', sandbox);
  if (!/1,799\.75/.test(r)) errores.push('RDc(1799.75) dio "' + r + '", deberia mostrar los centavos');
  const cero = vm.runInContext('RDc(0)', sandbox);
  if (!/0\.00/.test(cero)) errores.push('RDc(0) dio "' + cero + '", deberia ser 0.00');
  // Y que NO redondee como RD(), que es lo que esconderia los centavos.
  const viejo = vm.runInContext('RD(1799.75)', sandbox);
  if (/\.75/.test(viejo)) errores.push('RD() ya no redondea: alguien lo cambio, revisa que no rompa el resto de la app');
})();
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
// OJO: la fecha va relativa a hoy, no fija. El aviso solo muestra lo que cae
// dentro de su ventana (unos días por delante y 45 hacia atrás), así que una
// fecha escrita a mano caduca sola con el tiempo y la prueba deja de llegar a
// la vista aunque el componente esté perfecto.
render("AvisoAntiparasitarios", sandbox.AvisoAntiparasitarios, {
  seguimientos: [{ id: 9001, mascota: "Gucci Brito", propietario: "", telefono: "",
    tipo: "antipulgas", proximaFecha: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10),
    completado: false, activo: true,
    notas: "NexGard — toca reforzar la protección (35 días)" }],
  clientes: [{ id: 1, nombreMascota: "Gucci Brito", nombrePropietario: "Dianny Brito", telefono: "" }],
  ventas: [], setTab: () => {}
}, null, "sin tel");
render("Candidatos", sandbox.Candidatos, {});
render("WhatsAppInbox", sandbox.WhatsAppInbox, {});
render("PantallaWhatsApp", sandbox.PantallaWhatsApp, {}, null, "Seguimientos");
// El menu lateral: si esto se rompe no se pierde una vista, se pierde la
// navegacion entera y la app queda inservible.
render("MenuLateral", sandbox.MenuLateral, {
  tab: "dashboard", setTab: () => {}, badges: { ventas: 3 },
  abierto: false, setAbierto: () => {}, mini: false, setMini: () => {}
}, null, "Inventario");
render("MenuLateral (encogido)", sandbox.MenuLateral, {
  tab: "ventas", setTab: () => {}, badges: {},
  abierto: true, setAbierto: () => {}, mini: true, setMini: () => {}
}, null, "pc-menu-abierto");
// Toda pestaña tiene que caer en un grupo del menu, o desaparece de la
// navegacion sin que nada falle: seguiria existiendo pero sin forma de llegar.
(() => {
  const sinGrupo = (sandbox.TABS || []).filter((t) => !sandbox.GRUPOS_MENU.includes(t.grupo));
  if (sinGrupo.length) {
    errores.push("Pestañas que no salen en el menú: " + sinGrupo.map((t) => t.id).join(", "));
  }
})();
// La cola de seguimientos: se prepara el estado con una fila para que se
// ejercite la tarjeta de verdad y no solo el "no hay nada pendiente".
render("SeguimientosWA", sandbox.SeguimientosWA, {}, (h) => {
  const i = h.findIndex((x) => Array.isArray(x) && x.length === 0);
  if (i < 0) throw new Error("no se encontró el estado 'filas'");
  h[i] = [{ id: 1, telefono: "18095551212", propietario: "Viannesa", mascota: "Shayna",
    tipo: "vacuna", estado: "pendiente", motivo: "Toca su baño medicado el 2026-09-09",
    texto: "Hola Viannesa 👋 A Shayna le toca su baño medicado (09/09)." }];
  const j = h.findIndex((x) => x === true);   // cargando
  if (j >= 0) h[j] = false;
}, "le toca su baño medicado");
render("Llamadas", sandbox.Llamadas, {});
// Reportes no estaba cubierto y es donde se leen las cifras del mes: si algo
// aqui revienta, Victor ve una pantalla en blanco justo cuando va a decidir.
// Las ventas van con la fecha del mes en curso para que la comparativa y el
// ritmo diario se ejerciten de verdad (en un mes cerrado no se calcula ritmo).
const mesActual = new Date().toISOString().slice(0, 7);
render("Reportes", sandbox.Reportes, {
  ventas: ventas.map((v) => ({ ...v, fecha: mesActual + "-08" })),
  gastos: [{ id: "g1", fecha: mesActual + "-03", monto: 5000, categoria: "Alquiler" }],
  pagosNom: [{ id: "p1", mes: mesActual, totalPagado: 20000, comisiones: 3000 }],
  empleados: []
}, null, "punto de equilibrio");
render("ConfigFiscal", sandbox.ConfigFiscal, {}, null, "Datos del negocio");
// ResumenMes se renderiza dentro de Reportes, pero el React falso no baja a los
// hijos: createElement(ResumenMes, ...) devuelve el nodo sin ejecutar el
// componente. Hay que llamarlo aparte o la prueba de arriba no lo tocaria.
const mesTotales = (m, ing) => ({ mes: m, ingresos: ing, egresos: 25e3, utilidad: ing - 25e3, servicios: 3 });
render("ResumenMes", sandbox.ResumenMes, {
  comparativa: {
    actual: mesTotales(mesActual, 18e4),
    anterior: mesTotales("2026-08", 15e4),
    anioPasado: mesTotales("2025-09", 0),
    vsAnterior: 20, vsAnioPasado: null
  },
  PE: 203739,
  ritmoPE: { falta: 23739, diasQuedan: 5, porDia: 4748 },
  nombreMes: (m) => m
}, null, "punto de equilibrio");

const historiaEjemplo = { id: "h1", clienteid: "9", fecha: "2026-09-01", tipo: "Consulta",
  descripcion: "Otitis externa", veterinario: "Dra. Valentina", diagnostico: "Otitis",
  tratamiento: "Limpieza diaria del oído", medicamentos: "Otomax 1 gota c/12h, Amoxicilina 250mg c/12h x 7 días",
  proximacita: "2026-09-15", notas: "" };
render("ModalHistoriaDesdeFactura", sandbox.ModalHistoriaDesdeFactura, {
  factura, cliente: { ...clientes[0], nombre: "Rocky" }, historias: [historiaEjemplo], onCerrar: () => {}
}, null, "Receta");
// La receta no es un componente: se comprueba el papel que produce. Sin esto,
// un error ahi no sale hasta que alguien le da a imprimir con el cliente
// delante.
(() => {
  impreso = "";
  try { sandbox.imprimirReceta(historiaEjemplo, { ...clientes[0], nombre: "Rocky" }); }
  catch (e) { errores.push("imprimirReceta: " + e.message); return; }
  ["Otomax", "Amoxicilina", "Rocky", "Dra. Valentina", "Otitis"].forEach((t) => {
    if (!impreso.includes(t)) errores.push(`imprimirReceta: falta "${t}" en la receta impresa`);
  });
  // Los medicamentos van uno por renglon: si se pierde la separacion, el dueño
  // recibe un parrafo en vez de una lista.
  if ((impreso.match(/<li>/g) || []).length !== 2) {
    errores.push("imprimirReceta: los medicamentos no quedaron en renglones separados");
  }
})();

// Las comisiones estaban escritas a mano en quince sitios y ahora salen de una
// sola funcion. Esto fija los valores vigentes: si alguien los cambia sin
// querer, se paga mal a alguien y no se nota hasta que reclame.
[["grooming", 0.12], ["vet", 0.30], ["vet_valentina", 0.40], ["farmacia", 0.05]].forEach(([k, v]) => {
  const r = sandbox.comisionPct(k);
  if (r !== v) errores.push(`comisionPct("${k}") devolvió ${r}, se esperaba ${v}`);
});
// Y que acepte las dos formas de escribirlo: "30" y "0.30" son el mismo 30%.
// PC_CONFIG se declara con `let`, y eso en un contexto de vm NO queda como
// propiedad del objeto global: hay que tocarlo desde dentro.
[["35", 0.35], ["0.35", 0.35], ["", 0.30]].forEach(([valor, esperado]) => {
  const r = enVM(`PC_CONFIG.comision_vet = ${JSON.stringify(valor)}; comisionPct("vet");`);
  if (r !== esperado) errores.push(`comisionPct con "${valor}" devolvió ${r}, se esperaba ${esperado}`);
});
enVM('delete PC_CONFIG.comision_vet;');

if (errores.length) {
  console.error("❌ Vistas que se romperían en pantalla:\n");
  errores.forEach((e) => console.error("  • " + e));
  console.error("\nNormalmente es una función que se llama pero ya no existe.");
  process.exit(1);
}
console.log(`✓ Vistas principales renderizan sin errores (42 comprobadas + la receta impresa, las comisiones, el menú y la caja).`);
