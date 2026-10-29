# CLAUDE.md - PetColinas

## NEGOCIO
PetColinas - Veterinaria, Plaza Las Colinas, Santo Domingo Oeste, RD
Dueno: Victor Ballas | petcolinasrd@gmail.com
App: https://victorbeltre.github.io/petcolinas/
Supabase: https://ulrzzddovkioxeaarnjk.supabase.co

## USUARIOS
admin@petcolinas.com -> Admin
naylan@petcolinas.com -> Vet 30% (veterinaria) + 5% (farmacia/ventas)
valentina@petcolinas.com -> Vet 40% (sin usuario en Supabase Auth)
alexander@petcolinas.com -> Groomer
veterinaria@petcolinas.com -> Caja (factura y registra ventas, sin ver el negocio)

Las contrasenas NO van en este archivo: el repo es PUBLICO. Viven en el gestor
de claves de Victor.

Aylein Santiago ya NO tiene acceso (20 Ago 2026, ya no labora con nosotros). Su
historial de ventas/comisiones se conserva intacto (Regla Critica 2), pero se
quito de las listas activas de seleccion (nueva venta, nueva vacuna, etc).

## REGLA CRITICA 1 - authChecked
supaGetSession() NO es async. authChecked debe iniciar en TRUE si no hay sesion.
La sesion (pc_session) vive en sessionStorage, NO en localStorage (21 Ago 2026):
cada pestaña del navegador queda con su propia sesion independiente, para poder
tener admin y doctora abiertos en pestañas distintas sin que se pisen. A cambio,
cerrar la pestaña cierra la sesion (hay que volver a iniciar sesion la proxima).
const [authChecked, setAuthChecked] = useState(() => {
  try {
    const s = sessionStorage.getItem('pc_session');
    if (!s) return true;
    const p = JSON.parse(s);
    if (p.expires_at && Date.now()/1e3 > p.expires_at) return true;
    return false;
  } catch { return true; }
});

Sesion vencida (28 oct 2026): si el token ya no sirve (401) aunque el reloj del equipo
diga que no ha vencido, `supaFetch` lo renueva UNA vez (`renovarSesion`) y repite. Si no
se puede, `avisarSesionVencida` manda a la pantalla de entrada con un aviso. Antes la app
seguia con la llave publica y mostraba pantallas VACIAS ("sin ventas registradas",
facturas viejas del cache) sin decir por que: paso en una Mac con Safari.

## REGLA CRITICA 2 - Filtro Aylein historico
Todos los servicios vet hasta Mar 2026 = Aylein.
Valentina solo ve servicios con su nombre explicito.
recibidopor vacio en vet historico = Aylein por defecto.

## REGLA CRITICA 3 - Verificar sintaxis ANTES de deployar
const script = html.slice(html.lastIndexOf('<script>')+8, html.lastIndexOf('</script>'));
try { new Function(script); } catch(e) { throw 'SINTAXIS ERROR: ' + e.message; }

## REGLA CRITICA 4 - REPO Y VERSION CORRECTA (NO REGRESAR)
La app LIVE vive en el repo `victorbeltre/petcolinas` (este), servida por
GitHub Pages desde `main`. El codigo fuente de desarrollo esta en
`petcolinas-app`. NUNCA deployar/commitear un index.html que NO sea la app
completa. Un deploy desde petcolinas-app pisó la version buena con una vieja
de 10 pestañas (PR #33) — no repetir.
ANTES de commitear index.html, correr: node .github/scripts/validate-index.js
Debe tener 15 pestanas obligatorias: dashboard, agenda, ventas, clientes,
seguimientos, inventario, nomina, gastos, reportes, facturas, cobros, planes,
servicios, importar(Exportar Excel), notificaciones. Y los componentes Agenda,
PortalVeterinaria, PortalGroomer, MenuLateral, ExportarExcel. Peso >1 MB. El
workflow validate-app.yml bloquea el merge a main si falla.
OJO: la pestana "vozia" y el componente VozIA se ELIMINARON el 14 sep 2026
porque no se usaban (decision de Victor), no por una regresion. Si vuelven a
aparecer en la lista de obligatorias sin que nadie los haya reconstruido, es
que se revirtio algo. MenuLateral ocupa ese sitio en la guardia: si ESE
desaparece, la app queda entera pero sin forma de navegarla.

## REGLA CRITICA 5 - Laura tambien contribuye (desde 19 Ago 2026)
Laura (menos experimentada con este stack) empezo a abrir PRs directo a main
en paralelo, en sesiones de Claude separadas de esta. Por eso:

1. SIEMPRE, antes de tocar index.html, correr `git fetch origin main` y
   comparar con el ultimo commit local (`git log HEAD..origin/main`). Si hay
   commits que esta sesion no hizo, AVISARLE A VICTOR que se movio y un
   resumen de que, ANTES de seguir trabajando.
2. Hacer fast-forward (`git merge --ff-only origin/main`) para no perder ese
   trabajo ni generar un merge feo. Si el fast-forward no aplica limpio, parar
   y preguntarle a Victor como proceder — no forzar nada.
3. Punto de restauracion: la rama `respaldo-2026-08-19-antes-de-laura` en el
   repo (commit 02a5ca0) es la ultima version antes de que Laura empezara a
   contribuir. Validada: 1.54 MB, sintaxis OK, 16 pestañas completas. Si algo
   que ella suba rompe la app en produccion, se puede restaurar `main` a ese
   punto y reconstruir desde ahi lo que valga la pena conservar.

## REGLA CRITICA 6 - Toda tabla nueva nace expuesta (6 Sep 2026)
Supabase deja cualquier tabla nueva del esquema `public` legible por la API
con la llave publica (anon) hasta que alguien le activa RLS. El 30 Ago 2026
alguien creo `pc_clientes_backup_20260830` (copia completa de los 771
clientes) y `pc_merge_map_20260830` sin RLS: cualquiera con la llave que va
en index.html podia bajarse la lista entera con un GET. Se cerro el 6 Sep.
Por eso, SIEMPRE que se cree o altere una tabla (a mano, por migracion o por
script):
1. `alter table public.X enable row level security;` en la MISMA migracion.
   Sin politicas, RLS activo = invisible por la API; la service_role no se
   ve afectada, asi que los scripts de mantenimiento siguen funcionando.
2. Correr `get_advisors(type=security)` del conector de Supabase antes de
   dar el trabajo por terminado. Cualquier `rls_disabled_in_public` es un
   bloqueo, no una advertencia.
3. Un respaldo con fecha (`*_backup_*`, `*_map_*`) NUNCA se queda en
   `public`: o se borra al terminar, o se mueve a un esquema no expuesto.
4. Nada de datos de clientes dentro de index.html (M1, 6 Sep 2026): las
   semillas `*_SEED` y las listas de candidatos estan vacias a proposito.
   No volver a llenarlas; todo vive en Supabase.

## CAJA Y CUENTAS (M18/M19, oct 2026)
La pestana Caja tiene 5 modos: Dia, Semana, Mes, Rango y Cuentas.
El libro NO duplica nada: `pc_caja_libro` es una vista sobre ventas, abonos y
gastos. Un TRASLADO (pc_traslados) no es ingreso ni gasto — es la misma plata
cambiando de sitio — asi que NO toca el flujo del negocio, pero SI el efectivo
de la gaveta y el saldo de las cuentas. Si alguien lo mete como gasto, el
reporte dira que el negocio perdio esa plata.
La comision de tarjeta NO esta escrita en ningun sitio: sale de restar lo que
llego menos lo que salio en la liquidacion. No inventar un porcentaje.
El banco NO se arquea, se concilia: su diferencia se llama "partidas
pendientes", no descuadre (tarjetas a T+1/T+3 netas de comision, cargos del
banco, cheques sin cobrar). Si se presenta como descuadre, dara rojo todas las
noches y la gente dejara de mirar tambien el de la gaveta, que si sirve.
Las cuentas de banco son SOLO-ADMIN (RLS + `pc_es_admin()` en las funciones).
Pero `pc_caja_resumen` es SECURITY DEFINER y solo devuelve totales, para que
caja tenga el efectivo teorico correcto sin ver un solo traslado ni un gasto.
En los reportes el dinero se clasifica de DOS formas: por metodo de pago (lo ve
todo el personal, no nombra bancos) y por cuenta — "Donde cayo el dinero", en
cuatro bloques: caja chica / bancos / tarjetas por liquidar / sin asignar, cada
cuenta desplegable a sus categorias. `por_cuenta` y `por_cuenta_categoria`
vienen NULOS para quien no es admin.
`pc_caja_reporte` mantiene su firma de 4 argumentos A PROPOSITO: añadirle un
quinto parametro crearia una sobrecarga y una pestaña vieja del navegador
mandaria 4 claves que PostgREST no sabria resolver. Si hace falta otro dato, va
dentro del jsonb de respuesta, no como parametro nuevo.

PENDIENTE DE VICTOR en este modulo:
- Confirmar si `santacruz` es cuenta suya (hoy desactivada: 4 transferencias por
  RD$ 4.925 en 2026, parece el banco DESDE el que pago un cliente).
- Anotar una vez el saldo real de cada banco: sin ese punto de partida el
  teorico es la suma de todo desde 2025 y no significa nada (la app lo avisa).
- Registro de gastos (verificado 25 oct 2026): pc_gastos tiene 6 filas en junio,
  1 en agosto, 0 en septiembre y 26 en octubre. Ya se esta anotando; sostenerlo.
  El flujo de caja solo puede ser tan cierto como lo que se anote.

## HEMOGRAMAS (M21, oct 2026)
Evolucion del paciente -> "Resultados de laboratorio" -> "Convertir a formato
PetColinas". DOS REGLAS DE VICTOR:
1) LOS RESULTADOS NO SE LEEN, NO SE TRANSCRIBEN Y NO SE TOCAN. El documento del
   laboratorio (foto, o paginas del PDF dibujadas por pdf.js) se usa como IMAGEN:
   cada numero son los pixeles del laboratorio. Una primera version leia el
   documento (IA, luego OCR) y CAMBIO RESULTADOS al probarla con una foto; se
   elimino. render-check FALLA si reaparece parsearFilasLab, leerDocumentoLab,
   ocrLab, tesseract, etc. NO volver a leer/transcribir resultados.
2) NADA DEL LABORATORIO ORIGINAL debe salir (actualizado 16 oct): ni logo, ni
   nombre, ni direccion, ni firma, ni "informe emitido por". Todo el PDF es de
   PetColinas (cabecera con logo y colores, paciente y propietario tomados del
   SISTEMA, marco, pie PetColinas). La app NO pide ni imprime el nombre del lab.
Como se quita lo del laboratorio (el sistema no lo detecta, porque no lee): dos
franjas deslizables (quitar X% de arriba / X% de abajo, donde suelen estar logo,
nombre, direccion, firma y sello), recuadros blancos para lo suelto (marca de
agua, sello al costado), recorte libre, y "Ver como queda" para revisar la
pagina final ANTES de generar. Opcional, apagado por defecto: teñir el texto de
azul marino (un valor que el lab marco en rojo pasaria a azul).
Se guardan 2 archivos en el bucket privado `laboratorios`: original y PDF ya
generado (no se regenera). La Edge Function `lab-extraer` (IA) sigue desplegada
pero huerfana: borrarla del panel. El logo real vive en `logo.png` en la raiz
del repo (subido el 16 oct 2026, recortado a 313x272 desde el original de 500x500);
el PDF lo toma de ahi, y la factura impresa tambien lo referenciaba. Si el archivo
falta, se dibuja "PetColinas" en texto. PENDIENTE: probar con un hemograma real.

## DESPARASITACION: RECORDATORIOS POR PRODUCTO (oct 2026)
Seguimientos -> "Programar desparasitacion", y al vender un desparasitante la app
pregunta "Dura 1 mes / 3 meses". EL PRODUCTO MANDA: del catalogo `ANTIPARASITARIOS`
salen el tipo de recordatorio, el plazo y lo que dice el WhatsApp.
- NexGard Spectra: desparasita por DENTRO Y POR FUERA, efecto 35 dias -> tipo
  `desparasitacion`. Ferox: protege SOLO POR FUERA (pulgas y garrapatas), efecto 3
  MESES -> tipo `antipulgas`. (Ferox estaba como mensual/35 dias: error de catalogo.)
  Spectra va ANTES que NexGard en el catalogo ("NexGard Spectra" contiene "nexgard").
- Cada entrada lleva `cobertura` ("interna_externa" | "externa"); un producto nuevo se
  agrega ahi. El mensaje de Ferox NO puede decir que desparasita por dentro, y el de
  Spectra no se presenta como solo antipulgas (hay pruebas que lo fijan).
- Los meses son de CALENDARIO (`sumarMeses`: 31 ene + 1 mes = 28 feb). 35 dias se dice
  "35 dias", no "1 mes". La fecha se puede ajustar a mano.
- El mensaje de WhatsApp se arma al enviar (`mensajeRecordatorioParasitos`): dueño,
  mascota, producto, que cubre, cuanto dura y la fecha; dice "es hoy"/"es mañana"/"se
  vencio hace N dias". Lo usan el Dashboard y el boton de WhatsApp de Seguimientos.
- Sin duplicados POR TIPO (`fusionarRecordatorio`): dos Ferox no se acumulan, pero un
  Ferox (por fuera) y un Spectra (por dentro) conviven. Uno ya completado no se toca.
- "desparasit" suelto NO cae en "antipulgas a 35 dias": un desparasitante sin producto
  conocido se pregunta (1 mes / 3 meses). Las ventas VIEJAS de ese tipo ya no avisan.
- `CADENCIA_SERVICIO` (cita sugerida al facturar) elige el plazo MAS CORTO que coincida;
  por eso "Bravecto antipulgas" sugeria 30 dias en vez de 90. Ahora las entradas
  genericas llevan `no:` para no aplicar si hay un producto con plazo propio.
Los productos que no son Spectra/Ferox (NexGard, Bravecto, Simparica, Frontline...)
estan clasificados como "solo por fuera" por el catalogo previo de la app: confirmar
con Victor si alguno cubre tambien por dentro.
Pendiente: el WhatsApp sale por wa.me (se abre el chat y se manda a mano); el envio
automatico depende de conectar WhatsApp Business (M17).

## RESEÑAS GOOGLE (M22, 24 oct 2026)
Enlace directo: `GOOGLE_RESENA_URL` (writereview?placeid=ChIJ2-vO-zFhpY4RKsqBAr6TjEU).
Va al final del mensaje "mascota lista" (admin, Naylan y Agenda) y en la pestaña
"⭐ Reseñas Google" (admin y portal de la doctora): campaña a TODOS los clientes,
un mensaje por DUEÑO (agrupado por telefono), personalizado con nombre, mascotas y
mes de la ultima visita, en 3 variantes. Uno por clic via wa.me; se marca enviado al
pulsar Enviar. Estado compartido en `pc_resenas` (no localStorage) para que admin y
doctora no le escriban dos veces al mismo cliente. Ritmo sugerido 20-30 al dia (avisa
al pasar de 30) para que WhatsApp no marque el numero como spam.

## INVENTARIO DESDE FACTURA DE PROVEEDOR (M23, 26 oct 2026)
Inventario -> "Cargar factura de proveedor": foto o PDF -> Edge Function
`factura-proveedor` (IA, solo-admin, secret ANTHROPIC_API_KEY) propone las lineas
(nombre, descripcion, cantidad, costo, categoria) -> el admin las REVISA y corrige ->
se guardan. La funcion solo lee; no escribe nada. (Esto NO contradice la regla de
hemogramas: alli los resultados no se leen; una factura de compra si.)
- Codigo unico por producto (MED/ALI/ACC/HIG/INS/PAP/OTR-00001): lo pone la BASE
  (trigger `pc_inventario_codigo`), un solo contador, y no cambia nunca.
- Mismo nombre normalizado = se SUMA al producto existente; otra talla/presentacion
  entra como nuevo (el admin puede elegir a mano "Anadir a").
- Cada factura queda en `pc_compras` (solo-admin).
- Victor pidio NO borrar el inventario existente: los 101 productos viejos siguen,
  sin codigo hasta que se editan o se les suma una compra. Copia previa en
  `respaldos.pc_inventario_20261026` (esquema no expuesto).
- Categoria nueva `higiene`. "farmaco" sigue siendo la clave (se muestra Medicamento).

## STOCK AL FACTURAR (26 oct 2026)
Decision de Victor: facturar un producto DESCUENTA del inventario, y SIN STOCK NO SE
FACTURA. Aplica en Ventas (admin/caja), Facturas (nueva o editada), Facturar de los
portales y Mi Vitrina/Farmacia de la doctora. Todo pasa por `lineasStockVenta` +
`descontarStockVenta` (global, antes de `function Ventas`):
- Producto = elegido de la lista del inventario (prodId) o, escrito a mano en
  farmacia, con nombre IDENTICO normalizado. Antes se comparaban 8 caracteres y
  "NexGard Spectra M" descontaba de la L. Servicios y productos inexistentes no cuentan.
- Se comprueba contra la BASE, no contra la memoria de la pestaña. El descuento es
  condicional (`stock=eq.<leido>`): si otra caja vendio a la vez, se relee; no se
  vende dos veces la ultima unidad. Si algo falla a mitad, se devuelve lo descontado.
- Si falta UN producto, no se factura NADA de esa venta (mensajeSinStock dice cuantas quedan).
- Facturas editadas: solo la diferencia (`diferenciaStockFactura`): subir cantidad
  descuenta, bajar devuelve, guardar sin cambios no mueve nada.
- Excepcion: "Alta rapida" de Facturar (`sinControlStock`): entra con stock 0 y
  bloquearla impediria vender lo que esta en la mano.
- Productos viejos con stock 0 que SI estan en el estante: hay que ponerles stock en
  Inventario antes de poder venderlos.
- Pendiente (no hecho): borrar o editar una venta YA registrada en Ventas no devuelve
  el stock.
- Buscar producto al facturar (28 oct): `buscarEnInventario(inv, q)` = palabras clave en
  cualquier orden, sin acentos, en nombre/codigo/descripcion/categoria/proveedor, y SOLO lo
  que tiene stock (`{soloConStock:false}` para ver todo). La usan Ventas (catalogo y entrada
  libre), Facturas (autocompletado), Facturar de los portales (buscador en vez de la lista
  desplegable) y Mi Vitrina. Se dice cuantos sin stock quedaron fuera.

## DISEÑO "MODERNO Y LIMPIO" (etapa 1, 28 oct 2026)
Decision de Victor: nuevo look de la app interna, estilo moderno y limpio, por etapas
y SIN tocar como funciona nada. Etapa 1 (hecha):
- Letra Inter (Google Fonts; si no carga, cae a la del sistema). Constante `FUENTE`.
  Los titulos que estaban en Georgia (serif) usan `FUENTE`.
- Tokens nuevos en `C`: `borde`, `texto`, `suave`, `fondo` (#f5f7f6). El verde de marca
  sigue siendo `C.verde` (#1a6b3a): se reserva para lo que se toca o esta activo.
- Card/Btn/Badge/Input/Select: borde fino en vez de sombra pesada, radio 10-14, etiquetas
  sin MAYUSCULAS. Anillo verde al enfocar un campo (CSS global).
- Menu lateral blanco con el activo en verde suave; logo real (`logo.png`).
- `CabeceraAdmin`: franja blanca fija de 62 px (antes bloque verde de ~170 px con seis
  renglones de estado). Mantiene: seccion, fecha, por cobrar, EstadoSync (prop `claro`),
  sincronizar, usuario y Salir.
- `LoginScreen`: portada de Victor (`portada-app.jpg`, de su PDF de Canva, recortada a 2480x968)
  en el 45% izquierdo (lo fijo Victor) + formulario a la derecha; en tablet/telefono
  la portada arriba (29 oct 2026).
- Entrada en TELEFONO (<=640 px, 29 oct 2026, inspirada en Alegra): fondo blanco, sin la
  portada ancha ni la tarjeta; logo.png centrado, "Ingresa a tu cuenta", "Correo
  electronico", "¿Olvidaste tu contraseña?" (aviso: la restablece el admin), ojo para ver
  la clave y boton redondo "Ingresar". Clases `.pc-solo-movil` / `.pc-solo-pc`. La PC y la
  tablet NO cambian (decision de Victor). `<meta name="color-scheme" content="light">`
  para que el modo oscuro del telefono no la pinte gris.
- Avisos de pantalla: los bordes de 1.5-2 px se afinan a 1 px por CSS (`.pc-app`).
Pendiente (etapa 2+): portales de la doctora (rosado) y del groomer, tarjetas del Dashboard,
cambiar los emojis del menu por iconos SVG, tablas.

## RECETARIOS (M24, 28 oct 2026)
Pestaña "Recetarios" (admin, grupo Clientes) y "recetarios_vet" (portal de la doctora).
Se escribe ENCIMA de la plantilla de Victor (Canva, A5): `receta-plantilla.jpg` en la
raiz del repo = la plantilla a 216 ppp SIN la fecha "28/10/2026" que traia impresa.
- Medidas en puntos de la hoja A5 (419.25 x 595.5): `RECETA_CAMPOS`, `RECETA_TX`,
  `RECETA_FIRMA`. Las usan la vista (inputs sobre la imagen) y el PDF (canvas -> jsPDF),
  asi lo que se ve es lo que sale. Si cambia la plantilla, hay que remedir.
- La plantilla no tenia SEXO: se rotula "SEXO:" junto a la edad (mismo color #0c1e31).
- Indicaciones: la letra baja sola de 11 a 7.5 pt (`ajustarIndicaciones`); si ni asi
  caben, no se genera y se pide resumir (no se invade el sello de abajo a la derecha).
- Buscar paciente en el CRM llena nombre, especie·raza, sexo, edad (de fechaNacimiento)
  y el ultimo peso de pc_historias. Todo editable.
- Historial en `pc_recetas` (Abrir / Duplicar). Si la tabla no existe, la receta se
  genera igual y solo avisa que no se guardo.
- Distinto de "imprimir receta" del historial clinico (`imprimirReceta`), que sigue igual.

## COTIZACIONES (M25, 29 oct 2026)
Pestaña "Cotizaciones" (admin, grupo Operacion), modelada sobre Alegra (captura de Victor).
- Tabla `pc_cotizaciones`; numero COT-0001 por secuencia de la BASE (no en el navegador).
- Lineas: producto/servicio con buscador (tarifas grooming/vet + inventario con stock y
  codigo; en una cotizacion SI se puede incluir algo sin stock), cantidad, precio, descuento %,
  impuesto Ninguno/ITBIS 18%. Retenciones: ISR 10%, ISR 2% (sobre el neto), ITBIS retenido
  30%/100% (sobre el ITBIS). Totales en `calcularCotizacion` (hay pruebas en render-check).
- Vence a 15 dias por defecto; "vencida" se calcula (borrador/enviada con fecha pasada).
- PDF A4 con texto real y logo (`pdfCotizacion`), WhatsApp (`mensajeCotizacionWA`), Compartir
  PDF, Duplicar. Los terminos se recuerdan en localStorage (`pc_cot_terminos`).
- "Convertir en venta": pide quien atendio, pasa por `descontarStockVenta` (sin stock no se
  convierte) y crea una venta "Pago pendiente" (se cobra en Cobros), comision 0 -> la nomina
  la calcula por area. La cotizacion queda "facturada" y de solo lectura.

## ORDENES DE COMPRA (M26, 29 oct 2026)
Pestaña "Ordenes de compra" (admin, grupo Negocio), modelada sobre Alegra. Tabla
`pc_ordenes_compra`, SOLO-ADMIN (costos). Numero OC-0001 por secuencia de la base.
- Proveedor con sugerencias (ordenes anteriores traen identificacion y telefono; tambien
  los proveedores del inventario y de los gastos). Uno nuevo se escribe y queda.
- Lineas: concepto (buscador del inventario, precio = COSTO) o libre, precio, desc %,
  ITBIS, cantidad, observaciones. Mismos calculos que cotizaciones (`calcularCotizacion`).
- Terminos y notas salen en el PDF; comentarios internos NO.
- Estados: borrador, enviada, recibida, cancelada; "entrega atrasada" se calcula.
- "Recibir mercancia" (`planRecepcionOC`): producto existente (prodId o nombre identico)
  -> stock + cantidad (leido fresco de la base) y costo actualizado; nuevo -> se crea con
  categoria "otro" y precio de venta 0 (hay que completarlo). Anota en `pc_compras`.
  Una orden recibida o cancelada queda de solo lectura.
- No hay "bodega" ni "centro de costo" (Alegra los trae; PetColinas tiene un solo local).

## CUENTAS POR PAGAR (M27, 29 oct 2026)
Pestaña "Cuentas por pagar" (admin, grupo Negocio), como el reporte de Alegra: periodo,
antiguedad del saldo (vencidas 1-30, 31-60, 61-90, 91+ y no vencidas: `antiguedadCxP`),
total por pagar y detalle (tipo, numero/NCF, proveedor, creacion, vencimiento, total,
pagado, por pagar). Tabla `pc_cuentas_pagar`, SOLO-ADMIN.
- Entradas: a mano (factura de proveedor, servicio, prestamo, otro), "Traer de compras"
  (pc_compras: facturas cargadas en Inventario y ordenes recibidas) o "A credito" al
  recibir una orden de compra. `origen` unico evita registrar dos veces la misma compra.
- Pagos y abonos en `pagos` (jsonb). Opcion (marcada) de anotar el pago como GASTO categoria
  "Proveedores" para que salga del flujo de caja. NUNCA categoria "Inventario": esa crea
  productos fantasma (inventarioDeGastos). Si el pago ya esta en Gastos, desmarcarla.
- Anular solo sin pagos. Exportar a Excel (XLSX si cargo SheetJS; si no, CSV).
- SUBIR FACTURA (M28, 29 oct 2026): boton "Subir factura del proveedor" (foto o PDF) -> la
  misma Edge Function `factura-proveedor` lee proveedor, RNC, numero, NCF, fecha,
  VENCIMIENTO (limite de pago), plazo de credito, condicion, subtotal, ITBIS, total y
  conceptos -> el admin revisa y guarda. El original queda en el bucket privado
  `facturas-proveedores` (solo-admin; "Ver factura" = enlace firmado de 5 min).
  VENCIMIENTO OBLIGATORIO: leido de la factura > fecha + plazo de credito > se pide a mano
  (`venceDesdeFactura`; nunca se inventa). Un proveedor ya conocido se escribe igual que
  antes; NCF o numero+proveedor repetido pide confirmacion. Si la IA falla, el archivo
  queda adjunto y se escribe a mano. "Vence en N d" en naranja a 7 dias o menos.
  Las columnas nuevas solo se mandan si tienen valor: el registro a mano sirve sin M28.

## FINANZAS
PE real: RD$203,739/mes
Publicidad: $600 USD/mes (Google Ads + Instagram desde Mar 2026)
Ventas (corte 19 mar 2026, NO actualizado desde entonces):
Ene RD$111,479 | Feb RD$120,753 | Mar al 19 ~RD$146,863
Para la cifra de hoy, usar la pestana Caja (M18/M19), que la calcula en vivo.

## BOOST ENGINE
Lunes=2X, Mierc=3X, Viernes=Lucky, Sabado=1.5X
Victor activa boosts manuales desde Nomina (hasta 5X)

## FLUJO VENTA EMPLEADOS
1. Empleado: busca mascota CRM + producto + cantidad -> pendiente
2. Admin: agrega datos dueno (nombre/tel/dir/email) + forma de pago -> aprueba
3. Al aprobar: venta registrada + CRM actualizado automaticamente

## PENDIENTES QUE SOLO VICTOR PUEDE HACER (act. 8 Sep 2026)
1. (M6) "Leaked password protection" de Supabase Auth (compara contra
   HaveIBeenPwned). BLOQUEADO POR PLAN: es funcion de Pro en adelante y la
   organizacion esta en free (verificado 25 oct 2026), asi que el interruptor
   no aparece. Opciones: subir a Pro y activarlo en Authentication →
   Providers → Email, o aceptar el riesgo y dejar de listarlo como pendiente.
   Lo que SI se puede hoy en free, en esa misma pantalla: subir la longitud
   minima de contrasena y exigir mayusculas, digitos y simbolos.
   El advisor lo seguira reportando mientras este apagado.
1b. (M4) Pegar el nuevo `form-to-crm.gs` en Apps Script (Extensiones → Apps
   Script del formulario) y correr `diagnostico()`. Solo DESPUES de eso se
   puede quitar la politica `"pc_clientes insert formulario web"`, que hoy
   deja a `anon` insertar en pc_clientes con la llave publica. Es lo unico
   que queda abierto de M4: la Edge Function `form-intake` ya esta
   desplegada y probada, pero mientras el Apps Script viejo siga corriendo,
   quitar la politica dejaria de entrar las inscripciones.
1a. (M17) WhatsApp con IA. TODO el codigo esta listo y probado; falta conectar
   el numero, y eso son pasos en Meta que solo puedes hacer tu. El orden exacto
   esta en `docs/whatsapp-puesta-en-marcha.md`.
   EL NUMERO NO SE PIERDE (act. 11 sep 2026): con "Coexistencia" de Meta el
   809-752-6806 sigue funcionando en el telefono Y a la vez en la Cloud API,
   con hasta 6 meses de historial sincronizado. Se activa por el flujo
   Embedded Signup (app propia como Tech Provider, o un BSP que lo soporte).
   Lo que si se pierde: las listas de difusion quedan de solo lectura, y se
   apagan mensajes temporales, "ver una vez", ubicacion en vivo y editar/
   eliminar. Si PetColinas usa difusion para promociones, mirarlo antes.
   Hay que suscribirse a `message_echoes` ademas de `messages`: sin eso, la
   doctora contesta desde el telefono, el bot no se entera y contesta tambien,
   y el cliente recibe dos respuestas. La funcion ya trata el eco apagando el
   bot en ese chat.
   NO usar Baileys/whatsapp-web.js ni nodos de n8n no oficiales: funcionan,
   pero van contra los terminos de WhatsApp y el riesgo es que baneen el
   numero del negocio, que es justo lo que se quiere evitar.
   Nada sale a clientes sin aprobar: `wa_auto` esta en `no` y la reactivacion
   tiene tope de 15 al dia (`wa_max_reactivacion_dia`).
1c. (M16) Cargar el rango REAL de NCF autorizado por la DGII desde la
   Oficina Virtual, en Dashboard → Datos del negocio → "Registrar un rango
   nuevo". Sin eso las facturas se emiten pero salen sin comprobante fiscal.
   No se puede inventar: seria emitir numeros que la DGII no reconoce.
2. (M5) El esquema `hogar` (app personal de presupuesto del hogar: 13 tablas,
   politicas `allow_all` para anon) vive en el MISMO proyecto de Supabase que
   el negocio. Hoy NO es alcanzable por la API (`pgrst.db_schemas` no esta
   fijado, solo se expone `public`), asi que no hay fuga. Pero mezcla datos
   personales con datos de clientes y estorba si algun dia se alquila la app.
   Procedimiento cuando se decida: crear un proyecto nuevo, `pg_dump -n hogar`
   desde este y restaurar alla, apuntar la app del hogar al proyecto nuevo,
   y despues `drop schema hogar cascade` aqui. NUNCA agregar `hogar` a los
   esquemas expuestos de la API sin antes arreglar esas politicas.
3. Los datos personales que se sacaron de index.html (M1) siguen en el
   HISTORIAL de git (cualquier commit anterior al 6 Sep 2026). Purgarlos de
   verdad requiere `git filter-repo` + force push, que reescribe todo el
   historial y afecta a Laura: decision de Victor.

## PENDIENTES MENORES (rev. 25 oct 2026)
1. Boton rojo de ventas pendientes en el header del admin (sin verificar).
2. Crear el usuario de Supabase Auth de Valentina. Alexander ya lo tiene
   (verificado 25 oct 2026).

Ultima revision: 25 oct 2026.