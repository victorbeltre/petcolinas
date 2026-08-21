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

## PENDIENTES (20 Mar 2026)
1. Boton rojo ventas pendientes en header admin
2. Verificar Top Servicios visible en Dashboard Aylein
3. Confirmar Vacunas muestra todos los registros de Aylein
4. Crear usuarios Supabase Auth para Alexander y Valentina

Generado 20 Mar 2026