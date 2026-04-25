# CLAUDE.md - PetColinas
Leido automaticamente por Claude Code al iniciar.

## NEGOCIO
PetColinas - Veterinaria, Plaza Las Colinas, Santo Domingo Oeste, RD
Dueno: Victor Ballas | petcolinasrd@gmail.com
App: https://victorbeltre.github.io/petcolinas/
Supabase: https://ulrzzddovkioxeaarnjk.supabase.co

## USUARIOS
admin@petcolinas.com / Nickyjose00 -> Admin
aylein@petcolinas.com / aylein2026 -> Vet 30%
valentina@petcolinas.com / valentina2026 -> Vet 40%
alexander@petcolinas.com / alexander2026 -> Groomer

## REGLA CRITICA 1 - authChecked
supaGetSession() NO es async. authChecked debe iniciar en TRUE si no hay sesion.
const [authChecked, setAuthChecked] = useState(() => {
  try {
    const s = localStorage.getItem('pc_session');
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

## LOGIN - NOTA IMPORTANTE
petcolinasrd@gmail.com funciona en telefono pero NO en PC de la oficina.
Error: ERR_NAME_NOT_RESOLVED (DNS no resuelve supabase.co).
Fix PC: ejecutar `ipconfig /flushdns` en cmd, o cambiar DNS a 8.8.8.8 / 8.8.4.4.
Login correcto Admin: admin@petcolinas.com / Nickyjose00

## PLUGINS INSTALADOS (25 Abr 2026)
- superpowers@claude-plugins-official -> en .claude/settings.json
- ruflo MCP server -> npx ruflo@latest mcp start (orquestacion de agentes)

## PENDIENTES (20 Mar 2026)
1. Boton rojo ventas pendientes en header admin
2. Verificar Top Servicios visible en Dashboard Aylein
3. Confirmar Vacunas muestra todos los registros de Aylein
4. Crear usuarios Supabase Auth para Alexander y Valentina

Actualizado 25 Abr 2026