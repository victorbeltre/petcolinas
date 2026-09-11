# CLAUDE.md - PetColinas
Leido automaticamente por Claude Code al iniciar.

## NEGOCIO
PetColinas - Veterinaria, Plaza Las Colinas, Santo Domingo Oeste, RD
Dueno: Victor Ballas | petcolinasrd@gmail.com
App: https://victorbeltre.github.io/petcolinas/
Supabase: https://ulrzzddovkioxeaarnjk.supabase.co

## USUARIOS
admin@petcolinas.com / Nickyjose00 -> Admin
naylan@petcolinas.com / naylan2026 -> Vet 30% (veterinaria) + 5% (farmacia/ventas)
valentina@petcolinas.com / valentina2026 -> Vet 40% (sin acceso a Supabase Auth actualmente)
alexander@petcolinas.com / alexander2026 -> Groomer
veterinaria@petcolinas.com -> Caja (factura y registra ventas, sin ver el negocio)

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
Debe tener 16 pestañas: dashboard, agenda, ventas, clientes, seguimientos,
inventario, nomina, gastos, reportes, facturas, cobros, planes, servicios,
importar(Exportar Excel), vozia, notificaciones. Y los componentes Agenda, PortalVeterinaria,
PortalGroomer, VozIA, ExportarExcel. Peso >1 MB. El workflow validate-app.yml
bloquea el merge a main si falla.

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

## FINANZAS
PE real: RD$203,739/mes
Publicidad: $600 USD/mes (Google Ads + Instagram desde Mar 2026)
Ene 2026: RD$111,479 | Feb: RD$120,753 | Mar al 19: ~RD$146,863

## BOOST ENGINE
Lunes=2X, Mierc=3X, Viernes=Lucky, Sabado=1.5X
Victor activa boosts manuales desde Nomina (hasta 5X)

## FLUJO VENTA EMPLEADOS
1. Empleado: busca mascota CRM + producto + cantidad -> pendiente
2. Admin: agrega datos dueno (nombre/tel/dir/email) + forma de pago -> aprueba
3. Al aprobar: venta registrada + CRM actualizado automaticamente

## PENDIENTES QUE SOLO VICTOR PUEDE HACER (act. 8 Sep 2026)
1. (M6) Supabase → Authentication → Providers → Email → activar
   "Leaked password protection" (compara contra HaveIBeenPwned). Es un
   interruptor del dashboard; no se puede por SQL ni por el conector.
   AL 8 SEP SIGUE APAGADO: el advisor lo reporta en cada revision.
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

## PENDIENTES (20 Mar 2026)
1. Boton rojo ventas pendientes en header admin
2. Verificar Top Servicios visible en Dashboard Aylein
3. Confirmar Vacunas muestra todos los registros de Aylein
4. Crear usuarios Supabase Auth para Alexander y Valentina

Generado 20 Mar 2026