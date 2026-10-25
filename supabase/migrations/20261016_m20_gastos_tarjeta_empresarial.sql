-- ─────────────────────────────────────────────────────────────────────────────
-- M20 · Gastos: "Pagado por Petcolinas" y "Tarjeta empresarial Banreservas"
--
-- LO QUE ESTABA ROTO (y por que esto no era solo añadir dos opciones)
-- El formulario de Gastos dejaba elegir "Pagado por" y "Metodo", pero la capa de
-- guardado solo escribia `formapago` desde `formaPago`, y la app usa `metodo` y
-- `pagadoPor`: lo elegido se perdia al recargar. 55 de 68 gastos no tenian
-- metodo. Sin pagadopor no habia columna donde guardarlo. Anadir una opcion
-- nueva sin arreglar eso habria sido una opcion que desaparece.
--
-- POR QUE LA TARJETA EMPRESARIAL ES UN METODO PROPIO
-- 1) "tarjeta empresarial Banreservas" contiene "tarjeta" Y "reserv": con la
--    regla vieja pc_metodo_pago lo leia como MIXTO y el gasto caia en "sin
--    asignar" para siempre. Ahora se detecta ANTES del chequeo de mixto.
-- 2) No es TARJETA (la cuenta puente de cobros por liquidar: dinero que viene).
--    Pagar con la tarjeta de credito de la empresa es DEUDA: no sale del banco
--    hasta que se paga el estado de cuenta. Por eso su cuenta es tipo CREDITO,
--    con saldo negativo = lo que se debe, y se salda con un TRASLADO desde
--    Banreservas (que no es gasto: el gasto ya se contó al hacer la compra).
--
-- Efecto en los libros: el gasto SI es salida del negocio (flujo), NO toca el
-- efectivo de la gaveta, y suma en la cuenta tarjeta_empresa.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.pc_gastos add column if not exists pagadopor text;

-- DROP de una restriccion de tabla funciona en el conector (el cuelgue de la
-- regla 8 del README es solo con vistas).
alter table public.pc_cuentas drop constraint if exists pc_cuentas_tipo_check;
alter table public.pc_cuentas add constraint pc_cuentas_tipo_check
  check (tipo in ('EFECTIVO','BANCO','PUENTE','CREDITO','SIN_ASIGNAR'));

insert into public.pc_cuentas (id, nombre, tipo, banco, se_cuenta, activa, orden, notas) values
 ('tarjeta_empresa','Tarjeta empresarial Banreservas','CREDITO','Banreservas',false,true,60,
  'Deuda, no dinero: lo que se paga con la tarjeta no sale del banco hasta que se paga el estado de cuenta. El saldo es negativo = lo que se debe. Se salda con un traslado desde Banreservas.')
on conflict (id) do nothing;

create or replace function public.pc_metodo_pago(p_texto text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when t ~ 'pendiente'                then 'PENDIENTE'
    when t ~ 'sin cobro|no se le cobr'  then 'SIN COBRO'
    when t ~ 'tarjeta empresari'        then 'TARJETA EMPRESA'
    when (t ~ 'efectivo')::int
       + (t ~ 'transfer|trasferencia|popular|populat|reserv|resevas|bareservas|santa cruz|cuenta victor|banco')::int
       + (t ~ 'tarjeta')::int
       + (t ~ 'cheque')::int > 1        then 'MIXTO'
    when t ~ 'efectivo'                 then 'EFECTIVO'
    when t ~ 'tarjeta'                  then 'TARJETA'
    when t ~ 'cheque'                   then 'CHEQUE'
    when t ~ 'transfer|trasferencia|popular|populat|reserv|resevas|bareservas|santa cruz|cuenta victor|banco'
                                        then 'TRANSFERENCIA'
    when t = ''                         then 'SIN ANOTAR'
    else 'OTRO'
  end
  from (select lower(trim(coalesce(p_texto, ''))) as t) x;
$$;

create or replace function public.pc_cuenta_de(p_metodo text, p_banco text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when p_metodo = 'EFECTIVO' then 'gaveta'
    when p_metodo = 'TARJETA'  then 'tarjetas'
    when p_metodo = 'TARJETA EMPRESA' then 'tarjeta_empresa'
    when p_metodo in ('TRANSFERENCIA','CHEQUE') then
      coalesce((select c.id from public.pc_cuentas c
                 where c.tipo = 'BANCO' and c.banco = p_banco limit 1), 'sin_asignar')
    else 'sin_asignar'
  end;
$$;
revoke all on function public.pc_cuenta_de(text, text) from public, anon;

-- Comprobado el 16 oct 2026 (gasto de prueba de 1.250,25, revertido):
--   pc_metodo_pago('Tarjeta empresarial Banreservas') = TARJETA EMPRESA (no MIXTO)
--   libro: metodo TARJETA EMPRESA, banco Banreservas, cuenta tarjeta_empresa
--   reporte del dia: salidas 1.250,25; por_cuenta: Tarjeta empresarial = 1.250,25
--   efectivo de la gaveta: 1.550,00 antes y despues (no se mueve)
--   salidas 2026: 270.577,00 -> 271.827,25 (sube exactamente 1.250,25)
--   los metodos de los 68 gastos existentes no cambian (ninguno decia "empresarial").
--   get_advisors(security): ningun ERROR.

-- ─────────────────────────────────────────────────────────────────────────────
-- M20b · «Pendiente de pago» como método de un gasto
--
-- Una factura recibida y aun no pagada es un gasto del negocio (se incurrio) pero
-- NO una salida de caja (el dinero no se ha movido). La rama de VENTAS del libro
-- ya excluia PENDIENTE; la de GASTOS no, asi que un gasto pendiente aparecia como
-- RD$ 5.000 que ya salieron. Comprobado antes de arreglarlo.
--
-- Efecto: el gasto SIGUE sumando en la pantalla de Gastos y en el estado de
-- resultados (se incurrio), pero NO en el libro de caja, ni en el reporte, ni en
-- ninguna cuenta. Cuando se paga, se edita el gasto y se le pone el metodo real:
-- ahi entra al libro. OJO: entra con la fecha DEL GASTO, no la del pago, porque
-- pc_gastos solo guarda una fecha. Si el pago cae en otro mes, el flujo de caja de
-- ese mes no lo vera; es una limitacion conocida, no un descuido.
--
-- Se re-aplica security_invoker despues del create or replace (regla 7).
-- Definicion de la rama de gastos tal como quedo desplegada:
--   FROM pc_gastos g
--  WHERE pc_fecha(g.fecha) IS NOT NULL AND pc_metodo_pago(g.formapago) <> 'PENDIENTE'
-- (el resto de la vista es el de M18, sin cambios). Aplicado con un reemplazo
-- sobre pg_get_viewdef para no retipear las otras tres ramas.
--
-- Comprobado el 16 oct 2026: gasto pendiente = 0 filas en el libro; el mismo
-- gasto al pasar a «transferencia popular» = 1 fila; ningun gasto existente decia
-- «pendiente», asi que ninguna cifra historica cambio.
-- ─────────────────────────────────────────────────────────────────────────────
