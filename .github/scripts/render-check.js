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
// Campa\u00F1a de rese\u00F1as (M22): uno por due\u00F1o, nombres reales, ultima visita solo
// cuando la venta es inequivoca, tres redacciones y siempre el enlace directo.
(() => {
  const fallo = (m) => errores.push(m);
  const cli = [
    { id: 1, nombreMascota: "toby", nombrePropietario: "mar\u00EDa p\u00E9rez", telefono: "(809) 555-0101" },
    { id: 2, nombreMascota: "Luna", nombrePropietario: "Mar\u00EDa P\u00E9rez", telefono: "1-809-555-0101" },
    { id: 3, nombreMascota: "Coco", nombrePropietario: "Jos\u00E9 G\u00F3mez", telefono: "8095550202" },
    { id: 4, nombreMascota: "Coco", nombrePropietario: "Laura Ruiz", telefono: "8095550303" },
    { id: 5, nombreMascota: "Max", nombrePropietario: "Sin Tel", telefono: "" }];
  const ven = [{ fecha: "2026-09-12", cliente: "Toby Perez" }, { fecha: "2026-03-01", cliente: "Toby" }, { fecha: "2026-10-01", cliente: "Coco Gomez" }];
  const g = enVM("gruposResenas")(cli, ven);
  const toby = g.find((x) => x.tel === "8095550101"), coco = g.find((x) => x.tel === "8095550202");
  if (g.length !== 3) fallo("rese\u00F1as: debe haber un grupo por tel\u00E9fono y omitir los sin tel\u00E9fono: " + JSON.stringify(g));
  if (!toby || toby.mascotas.length !== 2 || toby.ultimaVisita !== "2026-09-12") fallo("rese\u00F1as: Toby y Luna son del mismo due\u00F1o y su \u00FAltima visita es la m\u00E1s reciente: " + JSON.stringify(toby));
  if (!coco || coco.ultimaVisita) fallo("rese\u00F1as: con dos \"Coco\" en el CRM no se puede saber de qui\u00E9n es la venta; no debe inventar visita: " + JSON.stringify(coco));
  const msg = (o) => enVM("mensajeResenaGoogle")(Object.assign({ duenio: "mar\u00EDa p\u00E9rez", mascotas: ["toby", "Luna"], ultimaVisita: "2026-09-12", firma: "Victor" }, o), "2026-10-24");
  const url = enVM("GOOGLE_RESENA_URL");
  [0, 1, 2].forEach((v) => {
    const m = msg({ variante: v });
    ["Mar\u00EDa", "Toby y Luna", "Victor", "septiembre", url].forEach((x) => { if (!m.includes(x)) fallo("rese\u00F1as variante " + v + ': falta "' + x + '" en: ' + m); });
    if (/Mar\u00EDa P\u00E9rez|undefined|null/.test(m)) fallo("rese\u00F1as variante " + v + ": nombre completo o valores vac\u00EDos en: " + m);
  });
  if (msg({ variante: 0 }) === msg({ variante: 1 }) || msg({ variante: 1 }) === msg({ variante: 2 })) fallo("rese\u00F1as: las tres redacciones deben ser distintas");
  const sinVisita = msg({ ultimaVisita: "", variante: 0 });
  if (/visit/.test(sinVisita)) fallo("rese\u00F1as: sin venta segura no se menciona la visita: " + sinVisita);
  const anioPasado = msg({ ultimaVisita: "2025-12-03", variante: 2 });
  if (!anioPasado.includes("diciembre de 2025")) fallo("rese\u00F1as: una visita de otro a\u00F1o debe decir el a\u00F1o: " + anioPasado);
  const sinDuenio = msg({ duenio: "", mascotas: ["Rocky"], variante: 2 });
  if (!sinDuenio.includes("familia de Rocky")) fallo("rese\u00F1as: sin nombre del due\u00F1o se saluda a la familia de la mascota: " + sinDuenio);
})();
render("CampanaResenas", sandbox.CampanaResenas, { clientes, ventas, firmaPorDefecto: "Victor" }, null, "Rese\u00F1as en Google");
// Inventario desde la factura del proveedor (M23): coincidencia solo exacta,
// la compra se SUMA al stock existente, lo nuevo entra sin codigo (lo pone la
// base) y el inventario existente no se toca.
(() => {
  const fallo = (m) => errores.push(m);
  const inv = [{ id: "7", nombre: "NexGard Spectra L", categoria: "farmaco", stock: 2, costo: 900, pventa: 1500, codigo: "MED-00007", notas: "" }];
  const ls = enVM("lineasDesdeFactura")({ items: [
    { nombre: "Nexgard  spectra l", descripcion: "Antiparasitario", categoria: "farmaco", cantidad: 6, costo_unitario: 950, dudoso: false },
    { nombre: "NexGard Spectra M", descripcion: "Antiparasitario", categoria: "farmaco", cantidad: 3, costo_unitario: null, dudoso: true },
    { nombre: "Collar rojo", descripcion: "Collar", categoria: "inventada", cantidad: "2", dudoso: false }] }, inv);
  if (ls[0].destino !== "7") fallo("factura: mismo nombre (sin importar mayusculas/espacios) debe sumarse al producto existente: " + JSON.stringify(ls[0]));
  if (ls[1].destino !== "nuevo") fallo("factura: otra talla NO es el mismo producto: " + JSON.stringify(ls[1]));
  if (ls[1].costo !== "") fallo("factura: costo ilegible queda vacio, no en 0: " + JSON.stringify(ls[1]));
  if (ls[2].categoria !== "otro" || ls[2].cantidad !== 2) fallo("factura: categoria desconocida cae en otro y la cantidad es numero: " + JSON.stringify(ls[2]));
  const cab = { proveedor: "Agrovet", numero: "F-123", fecha: "2026-10-26" };
  const sum = enVM("filaInventarioDesdeLinea")(ls[0], cab, inv[0], "999");
  if (sum.id !== "7" || sum.stock !== 8 || sum.costo !== 950 || sum.pventa !== 1500 || sum.codigo !== "MED-00007") fallo("factura: sumar a existente debe conservar id/codigo/precio y sumar stock: " + JSON.stringify(sum));
  const nuevo = enVM("filaInventarioDesdeLinea")(ls[1], cab, null, "999");
  if (nuevo.id !== "999" || nuevo.stock !== 3 || nuevo.stockInicial !== 3 || nuevo.codigo || !/F-123/.test(nuevo.notas)) fallo("factura: producto nuevo entra con su cantidad, sin codigo y con el origen anotado: " + JSON.stringify(nuevo));
  const db = enVM('denormalizeRow("pc_inventario", { id: "1", nombre: "x", codigo: "ALI-00001", descripcion: "d" })');
  if (db.codigo !== "ALI-00001" || db.descripcion !== "d") fallo("pc_inventario: codigo y descripcion deben guardarse: " + JSON.stringify(db));
  const back = enVM('normalizeRow("pc_inventario", { id: "1", nombre: "x", codigo: "ALI-00001", descripcion: "d" })');
  if (back.codigo !== "ALI-00001" || back.descripcion !== "d") fallo("pc_inventario: codigo y descripcion deben leerse: " + JSON.stringify(back));
})();
// % de ganancia sobre el costo (Victor, 26 oct): costo 962, venta 1.462 -> 52%, no 34%.
(() => {
  const m = enVM("margenSobreCosto");
  if (m(1462, 962) !== 52) errores.push("margen: costo 962 y venta 1462 debe dar 52% (sobre el costo), dio " + m(1462, 962));
  if (m(100, 100) !== 0 || m(150, 100) !== 50 || m(80, 100) !== -20) errores.push("margen: 100->100=0%, 100->150=50%, 100->80=-20%");
  if (m(100, 0) !== null || m(0, 50) !== null) errores.push("margen: sin costo o sin precio no hay porcentaje");
})();
// Recetarios (M24): edad desde el nacimiento, fecha dd/mm/aaaa, y las
// indicaciones bajan de letra para caber en la hoja (y avisan si no caben).
(() => {
  const fallo = (m) => errores.push("recetario: " + m);
  const edad = enVM("edadDesdeNacimiento");
  if (edad("2023-05-10", "2026-10-28") !== "3 a\u00F1os") fallo("3 a\u00F1os y 5 meses se dice 3 a\u00F1os: " + edad("2023-05-10", "2026-10-28"));
  if (edad("2025-08-01", "2026-10-28") !== "1 a\u00F1o y 2 meses") fallo("cachorro de 14 meses: " + edad("2025-08-01", "2026-10-28"));
  if (edad("2026-06-20", "2026-10-28") !== "4 meses") fallo("4 meses: " + edad("2026-06-20", "2026-10-28"));
  if (edad("", "2026-10-28") !== "") fallo("sin fecha de nacimiento no se inventa edad");
  const iso = enVM("fechaRecetaISO");
  if (iso("28/10/2026") !== "2026-10-28" || iso("5-3-2026") !== "2026-03-05" || iso("ayer") !== null) fallo("fecha dd/mm/aaaa a ISO");
  const aj = enVM("ajustarIndicaciones");
  const medir = (t, tam) => t.length * tam * 0.5;   // letra de ancho fijo para la prueba
  const corto = aj("Apoquel 1/2 tableta cada 12 horas", medir);
  if (!corto.cabe || corto.tam !== 11) fallo("un texto corto va con la letra grande: " + JSON.stringify(corto));
  const largo = aj(Array(14).fill("Linea de indicacion numero tal con dosis").join("\n"), medir);
  if (!largo.cabe || largo.tam >= 11) fallo("un texto largo baja la letra para caber: " + JSON.stringify({ tam: largo.tam, n: largo.lineas.length }));
  const enorme = aj(Array(40).fill("Linea").join("\n"), medir);
  if (enorme.cabe) fallo("40 lineas no caben en la hoja y debe avisarse");
  if (aj("uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince dieciseis diecisiete dieciocho diecinueve veinte veintiuno", medir).lineas.some((l) => medir(l, 11) > 352 + 0.01 && l.includes(" "))) fallo("ninguna linea pasa del ancho del area");
})();
render("Recetario", sandbox.Recetario, { clientes, historias: [], medicoPorDefecto: "Dra. Naylan", usuarioNombre: "Naylan" }, null, "Recetarios");
// Busqueda de productos al facturar (28 oct 2026): palabras clave en cualquier
// orden, sin acentos, por codigo o descripcion, y solo lo que tiene stock.
(() => {
  const fallo = (m) => errores.push("buscar producto: " + m);
  const inv = [
    { id: "1", nombre: "NexGard Spectra L 15-30 kg", categoria: "farmaco", stock: 4, codigo: "MED-00003", descripcion: "Antiparasitario masticable" },
    { id: "2", nombre: "NexGard Spectra M", categoria: "farmaco", stock: 0, codigo: "MED-00004" },
    { id: "3", nombre: "Champ\u00FA de avena", categoria: "higiene", stock: 7, descripcion: "Piel sensible" },
    { id: "4", nombre: "Royal Canin Mini", categoria: "alimento", stock: 2 }];
  const b = (q, o) => enVM("buscarEnInventario")(inv, q, o).map((p) => p.id).join(",");
  if (b("spectra l") !== "1") fallo("'spectra l' encuentra la talla L con stock: " + b("spectra l"));
  if (b("spectra") !== "1") fallo("la talla M sin stock no aparece: " + b("spectra"));
  if (b("spectra", { soloConStock: false }) !== "1,2") fallo("sin filtro de stock aparecen las dos: " + b("spectra", { soloConStock: false }));
  if (b("CHAMPU avena") !== "3" || b("piel") !== "3") fallo("sin acentos ni mayusculas, y por descripcion");
  if (b("med-00003") !== "1") fallo("por codigo");
  if (b("alimento") !== "4") fallo("por categoria");
  if (b("") !== "3,1,4") fallo("sin texto: todo lo que tiene stock, en orden alfabetico: " + b(""));
})();
// Cotizaciones (M25): totales al estilo Alegra, retenciones y estado vencida.
(() => {
  const fallo = (m) => errores.push("cotizacion: " + m);
  const calc = enVM("calcularCotizacion");
  const items = [{ nombre: "Consulta", cantidad: 1, precio: 1500, descPct: 0, itbis: false },
                 { nombre: "NexGard Spectra L", cantidad: 2, precio: 1000, descPct: 10, itbis: true }];
  const r = calc(items, []);
  // bruto 3500, desc 200, neto 3300, ITBIS 18% de 1800 = 324, total 3624
  if (r.subtotal !== 3500 || r.descuento !== 200 || r.neto !== 3300 || r.impuestos !== 324 || r.total !== 3624) fallo("totales: " + JSON.stringify(r));
  const rr = calc(items, ["isr10", "itbis30"]);
  // ISR 10% de 3300 = 330; ITBIS retenido 30% de 324 = 97.2 -> total 3624 - 427.2 = 3196.8
  if (rr.retenido !== 427.2 || rr.total !== 3196.8) fallo("retenciones: " + JSON.stringify({ ret: rr.retenido, total: rr.total }));
  const est = enVM("estadoCotizacion");
  if (est({ estado: "enviada", vence: "2026-10-01" }, "2026-10-29") !== "vencida") fallo("una enviada con fecha pasada esta vencida");
  if (est({ estado: "aceptada", vence: "2026-10-01" }, "2026-10-29") !== "aceptada") fallo("una aceptada no se marca vencida");
  const msg = enVM("mensajeCotizacionWA")({ numero: 7, cliente_nombre: "Mar\u00EDa P\u00E9rez", mascota: "Toby", vence: "2026-11-13" }, r);
  if (!/COT-0007/.test(msg) || !/Mar\u00EDa/.test(msg) || !/Toby/.test(msg) || !/3,624/.test(msg) || !/13\/11\/2026/.test(msg) || /P\u00E9rez/.test(msg)) fallo("mensaje WhatsApp: " + msg);
})();
render("Cotizaciones", sandbox.Cotizaciones, { clientes, tarifasGrooming: [], tarifasVet: [], inventario: [], setVentas: () => {} }, null, "Cotizaciones");
// Ordenes de compra (M26): recepcion al inventario, estado atrasada y mensaje al proveedor.
(() => {
  const fallo = (m) => errores.push("orden de compra: " + m);
  const inv = [{ id: "1", nombre: "NexGard Spectra L", stock: 2 }, { id: "2", nombre: "Shampoo avena", stock: 0 }];
  const plan = enVM("planRecepcionOC")([
    { nombre: "NexGard Spectra L", prodId: "1", cantidad: 6, precio: 1000, descPct: 10 },
    { nombre: "shampoo  AVENA", cantidad: "3", precio: 280, descPct: 0 },
    { nombre: "Collar nuevo", cantidad: 4, precio: 150 },
    { nombre: "", cantidad: 9, precio: 1 }], inv);
  if (plan.length !== 3) fallo("las lineas vacias no se reciben: " + plan.length);
  if (!plan[0].prod || plan[0].prod.id !== "1" || plan[0].cantidad !== 6 || plan[0].costo !== 900) fallo("producto elegido: suma 6 al costo con descuento (900): " + JSON.stringify(plan[0]));
  if (!plan[1].prod || plan[1].prod.id !== "2" || plan[1].cantidad !== 3) fallo("mismo nombre escrito a mano se suma al existente: " + JSON.stringify(plan[1]));
  if (plan[2].prod) fallo("un producto que no existe entra como nuevo");
  const est = enVM("estadoOrdenCompra");
  if (est({ estado: "enviada", entrega: "2026-10-20" }, "2026-10-29") !== "atrasada") fallo("enviada con entrega pasada = atrasada");
  if (est({ estado: "recibida", entrega: "2026-10-20" }, "2026-10-29") !== "recibida") fallo("recibida no se marca atrasada");
  const msg = enVM("mensajeOrdenCompraWA")({ numero: 3, proveedor: "Agrovet", entrega: "2026-11-02" }, enVM("calcularCotizacion")([{ nombre: "NexGard", cantidad: 6, precio: 1000, obs: "talla L" }], []));
  if (!/OC-0003/.test(msg) || !/6 x NexGard \(talla L\)/.test(msg) || !/02\/11\/2026/.test(msg)) fallo("mensaje: " + msg);
})();
render("OrdenesCompra", sandbox.OrdenesCompra, { inventario: [], gastos: [], refetchInventario: () => {} }, null, "rdenes de compra");
// Cuentas por pagar (M27): antiguedad como Alegra, saldo y estado.
(() => {
  const fallo = (m) => errores.push("cuentas por pagar: " + m);
  const hoy = "2026-10-29";
  const cs = [
    { total: 1000, pagado: 0, vence: "2026-11-10" },           // no vencida
    { total: 500, pagado: 200, vence: "2026-10-20" },          // vencida 9 dias, saldo 300
    { total: 800, pagado: 0, vence: "2026-09-10" },            // 49 dias
    { total: 400, pagado: 0, vence: "2026-08-10" },            // 80 dias
    { total: 900, pagado: 0, vence: "2026-06-01" },            // 150 dias
    { total: 700, pagado: 700, vence: "2026-06-01" },          // pagada: no cuenta
    { total: 999, pagado: 0, vence: "2026-06-01", anulada: true }];
  const r = enVM("antiguedadCxP")(cs, hoy);
  if (r.noVencidas !== 1000 || r.d30 !== 300 || r.d60 !== 800 || r.d90 !== 400 || r.d91 !== 900 || r.total !== 3400) fallo("tramos: " + JSON.stringify(r));
  const est = enVM("estadoCxP");
  if (est(cs[0], hoy) !== "pendiente" || est(cs[1], hoy) !== "vencida" || est(cs[5], hoy) !== "pagada" || est(cs[6], hoy) !== "anulada") fallo("estados");
  if (est({ total: 500, pagado: 100, vence: "2026-12-01" }, hoy) !== "parcial") fallo("abonada sin vencer = parcial");
  if (enVM("saldoCxP")({ total: 100.1, pagado: 100.2 }) !== 0) fallo("el saldo nunca es negativo");
  // M28: vencimiento de la factura subida. Leido > plazo de credito > se pide (nunca se inventa).
  const v = enVM("venceDesdeFactura");
  if (v({ vence: "2026-11-28" }, "2026-10-29").vence !== "2026-11-28") fallo("el vencimiento leido de la factura manda");
  const p = v({ vence: null, dias_credito: 30 }, "2026-10-29");
  if (p.vence !== "2026-11-28" || p.origen !== "plazo") fallo("credito 30 dias = fecha + 30: " + JSON.stringify(p));
  if (v({ dias_credito: 0 }, "2026-10-29").vence !== "2026-10-29") fallo("contado vence el mismo dia");
  if (v({ vence: "2026-10-01" }, "2026-10-29").origen !== "falta") fallo("un vencimiento antes de la fecha es mala lectura: se pide");
  if (v({}, "2026-10-29").vence !== "") fallo("sin vencimiento ni plazo NO se inventa uno");
  const t = enVM("textoVenceCxP");
  if (t("2026-10-29", hoy) !== "Vence hoy" || t("2026-11-03", hoy) !== "Vence en 5 días" || t("2026-10-27", hoy) !== "Venció hace 2 días") fallo("textoVenceCxP");
})();
// M29: nomina con clave. Quincenas, cuentas y que los sueldos NO esten en el codigo publico.
(() => {
  const fallo = (m) => errores.push("nomina: " + m);
  const pq = enVM("periodoQuincena");
  if (pq("2026-10-15") !== "2026-10-Q1" || pq("2026-10-16") !== "2026-10-Q2") fallo("1-15 = Q1, 16-fin = Q2");
  const rg = enVM("rangoPeriodoNomina");
  if (rg("2026-02-Q2").hasta !== "2026-02-28" || rg("2026-10-Q1").desde !== "2026-10-01") fallo("rango de la quincena");
  const mv = enVM("moverPeriodoNomina");
  if (mv("2026-12-Q2", 1) !== "2027-01-Q1" || mv("2026-01-Q1", -1) !== "2025-12-Q2") fallo("mover de quincena cruza meses y anos");
  const q = enVM("calcularQuincenaNomina")({ base: 15000, comisiones: 2500, incentivos: 1000, adelantos: 3000, descuentos: 500 });
  if (q.bruto !== 18500 || q.neto !== 15000) fallo("adelantos y descuentos restan, incentivos suman: " + JSON.stringify(q));
  // M30: tarifario por servicio (montos de mentira: el repo es publico).
  const tar = [{ id: 1, empleado_id: 7, servicio: "Baños pequeños", alias: ["Baño raza pequeña"], comision: 10 },
    { id: 2, empleado_id: 7, servicio: "Baño pequeño con línea", alias: [], comision: 20 },
    { id: 3, empleado_id: 7, servicio: "Corte de uñas + pulido canino", alias: ["Corte de uñas"], comision: 4 },
    { id: 4, empleado_id: 7, servicio: "Corte de uñas + pulido felino", alias: ["Corte de uñas felino"], comision: 5 },
    { id: 5, empleado_id: 9, servicio: "Muestra / Diagnóstico", alias: [], comision: 30 }];
  const td = (n) => (enVM("tarifaDeServicioNomina")(n, tar) || {}).id;
  if (td("baño pequeño") !== 1 || td("Baño pequeño c/línea") !== 2 || td("Corte de uñas felino") !== 4 || td("Corte de uñas") !== 3
      || td("Muestra/diagnóstico") !== 5 || td("Coprológico") !== undefined) fallo("tarifaDeServicioNomina: plurales, c/línea, la tarifa más larga gana, sin inventar");
  const cn = enVM("comisionesNominaPorTarifa")([
    { fecha: "2026-10-20", area: "grooming", recibidopor: "Naylan Perez", items: [{ nombre: "3x Baño pequeño" }, { nombre: "(2) Baño pequeño" }, { nombre: "Baño pequeño c/línea", qty: 1 }] },
    { fecha: "2026-10-21", area: "veterinaria", items: [{ nombre: "Muestra/diagnóstico", qty: 2 }, { nombre: "Coprológico" }, { nombre: "NexGard", area: "farmacia" }] },
    { fecha: "2026-10-05", area: "grooming", items: [{ nombre: "Baño pequeño" }] }], tar, "2026-10-16", "2026-10-31");
  if (cn.porEmpleado[7].total !== 70 || cn.porEmpleado[9].total !== 60) fallo("comisiones por tarifa (la de Alexander aunque la registre Naylan; cantidades; solo el periodo): " + JSON.stringify(cn.porEmpleado));
  if (cn.sinTarifa.length !== 1 || cn.sinTarifa[0][0] !== "Coprológico") fallo("sin tarifa: solo servicios de vet/grooming, no farmacia: " + JSON.stringify(cn.sinTarifa));
  // Farmacia: 5% de (venta - costo) para quien VENDE (Naylan/Alexander); cortesias sin comision.
  const inv = [{ id: 50, nombre: "Nexgard Spectra 2-3.5 kg", costo: 924 }];
  const vend = [{ id: 9, clave: "naylan" }, { id: 7, clave: "alexander" }];
  const fa = enVM("comisionesNominaPorTarifa")([
    { fecha: "2026-10-20", area: "farmacia", recibidopor: "Naylan Perez", items: [{ nombre: "Nexgard Spectra 2-3.5 KG ", area: "farmacia", subtotal: 1416 }] },
    { fecha: "2026-10-20", area: "farmacia", recibidopor: "Laura", items: [{ nombre: "Nexgard Spectra 2-3.5 kg", area: "farmacia", subtotal: 1585 }] },
    { fecha: "2026-10-21", area: "farmacia", recibidopor: "Alexander", items: [{ nombre: "Cephalexin 250mg", area: "farmacia", subtotal: 270 }, { nombre: "Rimadyl", area: "farmacia", subtotal: 80 }] },
    { fecha: "2026-10-22", area: "grooming", recibidopor: "Alexander", items: [{ nombre: "Baño pequeño (cortesía casa)", subtotal: 0 }] }],
    tar, "2026-10-16", "2026-10-31", { inventario: inv, vendedores: vend, costosManual: { "cephalexin 250mg": "200" } });
  if (!fa.porEmpleado[9] || fa.porEmpleado[9].total !== 24.6) fallo("5% farmacia: (1416 - 924) x 5% = 24.60: " + JSON.stringify(fa.porEmpleado[9]));
  if (!fa.porEmpleado[7] || fa.porEmpleado[7].total !== 3.5 || fa.porEmpleado[7].sinCosto.length !== 1) fallo("costo a mano (270-200)x5% = 3.50 y Rimadyl sin costo queda pendiente, no inventado: " + JSON.stringify(fa.porEmpleado[7]));
  if (fa.cortesias !== 1) fallo("la cortesia no genera comision y se cuenta aparte");
  const g = enVM("esGastoNomina");
  if (!g({ categoria: "nomina" }) || !g({ categoria: "Nómina" }) || g({ categoria: "insumo" })) fallo("esGastoNomina");
  const html = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "index.html"), "utf8");
  const ini = html.slice(html.indexOf("const EMPLEADOS_INIT"), html.indexOf("];", html.indexOf("const EMPLEADOS_INIT")));
  if (/mensualidad:\s*[1-9]/.test(ini)) fallo("EMPLEADOS_INIT no puede llevar sueldos: el repo es publico");
})();
render("NominaSegura", sandbox.NominaSegura, { ventas: [], gastos: [], setGastos: () => {}, pagosNom: [], ventasMes: [], mesActual: "2026-10" }, null, "Nómina");
render("CuentasPorPagar", sandbox.CuentasPorPagar, { gastos: [], setGastos: () => {}, inventario: [] }, null, "Cuentas por pagar");
render("ModalFacturaProveedor", sandbox.ModalFacturaProveedor, { inventario: [], onCerrar: () => {}, onGuardado: () => {} }, null, "Cargar factura de proveedor");
render("Inventario", sandbox.Inventario, { inventario: [{ id: "1", nombre: "Royal Canin Mini", categoria: "alimento", stock: 3, codigo: "ALI-00001", descripcion: "Alimento seco" }], setInventario: () => {}, ventas: [], deleteInv: () => {}, refetchInventario: () => {} }, null, "ALI-00001");
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

// Stock al facturar (26 oct 2026): sin stock no se factura, se descuenta lo
// vendido, la comprobacion es contra la BASE y dos ventas simultaneas no se
// llevan la misma ultima unidad. Base falsa en memoria.
async function pruebaStock() {
  const fallo = (m) => errores.push("stock: " + m);
  const inv = [{ id: "1", nombre: "NexGard Spectra L", stock: 5 }, { id: "2", nombre: "Ferox", stock: 0 }, { id: "3", nombre: "NexGard Spectra M", stock: 9 }];
  const ls = enVM("lineasStockVenta")([
    { prodId: "1", qty: 2, area: "farmacia", nombre: "2x NexGard Spectra L" },
    { area: "farmacia", nombre: "1x nexgard spectra l", qty: 1 },
    { area: "grooming", nombre: "Ba\u00F1o", qty: 1 },
    { categoria: "farmacia", nombre: "Producto nuevo", qty: 1 },
    { categoria: "farmacia", prodId: "3", qty: 1, sinControlStock: true }], inv);
  if (ls.length !== 1 || ls[0].prod.id !== "1" || ls[0].qty !== 3) fallo("se suman las lineas del mismo producto, y no cuentan servicios, productos que no existen ni altas rapidas: " + JSON.stringify(ls));
  const dif = enVM("diferenciaStockFactura");
  const d1 = dif([{ descripcion: "NexGard Spectra L", cantidad: 1 }], [{ descripcion: "NexGard Spectra L", cantidad: 3 }, { descripcion: "Ba\u00F1o", cantidad: 1 }], inv);
  if (d1.descontar.length !== 1 || d1.descontar[0].qty !== 2 || d1.devolver.length) fallo("editar factura de 1 a 3 descuenta solo 2: " + JSON.stringify(d1));
  const d2 = dif([{ descripcion: "NexGard Spectra L", cantidad: 3 }], [{ descripcion: "NexGard Spectra L", cantidad: 1 }], inv);
  if (d2.devolver.length !== 1 || d2.devolver[0].qty !== 2 || d2.descontar.length) fallo("bajar de 3 a 1 devuelve 2: " + JSON.stringify(d2));
  const d3 = dif([{ descripcion: "Ferox", cantidad: 1 }], [{ descripcion: "Ferox", cantidad: 1 }], inv);
  if (d3.descontar.length || d3.devolver.length) fallo("guardar sin cambiar productos no mueve el stock: " + JSON.stringify(d3));
  let db = {};
  const orig = { supaFetch: sandbox.supaFetch, fetch: sandbox.fetch, supaAccessToken: sandbox.supaAccessToken, auditar: sandbox.auditar };
  let alPatch = null;
  sandbox.supaAccessToken = async () => "t";
  sandbox.auditar = () => {};
  sandbox.supaFetch = async (t, m, body, q) => {
    if (m === "GET") {
      const ids = /id=in\.\((.*)\)/.test(q) ? decodeURIComponent(q.match(/id=in\.\((.*)\)/)[1]).split(",").map((x) => x.replace(/"/g, "")) : [q.match(/id=eq\.([^&]+)/)[1]];
      return ids.filter((i) => i in db).map((i) => ({ id: i, stock: db[i] }));
    }
    if (m === "PATCH") { db[q.match(/id=eq\.([^&]+)/)[1]] = body.stock; return true; }
  };
  sandbox.fetch = async (url, o) => {
    const id = decodeURIComponent(url.match(/id=eq\.([^&]+)/)[1]), esperado = Number(url.match(/stock=eq\.(-?\d+)/)[1]);
    if (alPatch) { const f = alPatch; alPatch = null; f(); }
    if (db[id] !== esperado) return { ok: true, json: async () => [] };
    db[id] = JSON.parse(o.body).stock;
    return { ok: true, json: async () => [{ id, stock: db[id] }] };
  };
  try {
    const desc = enVM("descontarStockVenta");
    db = { "1": 5, "2": 0 };
    let r = await desc([{ prod: inv[0], qty: 2 }]);
    if (!r.ok || db["1"] !== 3) fallo("vender 2 de 5 debe dejar 3: " + JSON.stringify(r) + " " + JSON.stringify(db));
    db = { "1": 5, "2": 0 };
    r = await desc([{ prod: inv[0], qty: 1 }, { prod: inv[1], qty: 1 }]);
    if (r.ok || !r.faltantes.length || r.faltantes[0].nombre !== "Ferox" || db["1"] !== 5) fallo("sin stock de Ferox no se factura NADA de la venta: " + JSON.stringify(r) + " " + JSON.stringify(db));
    db = { "1": 1 };
    r = await desc([{ prod: { ...inv[0], stock: 50 }, qty: 2 }]);
    if (r.ok || db["1"] !== 1) fallo("manda lo que dice la base, no lo que hay en pantalla: " + JSON.stringify(r));
    db = { "1": 5 };
    alPatch = () => { db["1"] = 1; };   // otra caja vende 4 en el mismo instante
    r = await desc([{ prod: inv[0], qty: 2 }]);
    if (r.ok || db["1"] !== 1) fallo("dos ventas simultaneas no pueden llevarse la misma ultima unidad: " + JSON.stringify(r) + " " + JSON.stringify(db));
    if (!/quedan 0 unidades/.test(enVM("mensajeSinStock")([{ nombre: "Ferox", disponible: 0, pedido: 1 }]))) fallo("el aviso debe decir cuantas quedan");
  } finally { Object.assign(sandbox, orig); }
}

(async () => {
await pruebaStock();
if (errores.length) {
  console.error("❌ Vistas que se romperían en pantalla:\n");
  errores.forEach((e) => console.error("  • " + e));
  console.error("\nNormalmente es una función que se llama pero ya no existe.");
  process.exit(1);
}
console.log(`✓ Vistas principales renderizan sin errores (42 comprobadas + la receta impresa, las comisiones, el menú y la caja).`);
})();
