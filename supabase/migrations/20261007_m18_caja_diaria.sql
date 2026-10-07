-- ============================================================================
--  M18 · Flujo de caja: libro de caja y arqueo diario (7 oct 2026)
--
--  Pedido de Victor: Saldo Inicial + Entradas - Salidas = Saldo Final, con un
--  registro operativo de 8 columnas (fecha/hora, referencia, concepto,
--  categoria, metodo de pago, entrada, salida, saldo acumulado).
--
--  ── Por que NO hay una tabla que guarde todos los movimientos ─────────────
--  Porque el dinero ya esta registrado: cada venta de pc_ventas ES una entrada
--  y cada fila de pc_gastos ES una salida. Copiarlas a un libro aparte daria
--  DOS fuentes de verdad para el mismo dinero: o el equipo registra cada venta
--  dos veces, o se sincronizan y se desincronizan igual. Y el dia que no
--  cuadren, ningun reporte sabe a cual creerle.
--
--  Asi que el libro es una VISTA sobre lo que ya existe. Las 8 columnas salen
--  de ahi; la octava (saldo acumulado) se calcula al leer, porque depende del
--  rango y del orden que se este mirando.
--
--  Lo unico que de verdad no tenia casa:
--    · el arqueo                                     -> pc_caja_dia
--    · el efectivo que no es ni venta ni gasto        -> pc_caja_movimientos
--      (retiro al banco, aporte del dueño, caja chica)
--
--  ── Lo que hubo que resolver primero ──────────────────────────────────────
--  `formapago` es texto libre y tenia 60 variantes: "efectivo"/"Efectivo"/
--  "EFECTIVO", "popular"/"populat", "reservas"/"banresevas"/"bareservas",
--  "trasferencia", y frases enteras ("este no se le cobro al cliente"). Sin
--  normalizar, un total "por metodo de pago" sale repartido en decenas de
--  columnas que en realidad son la misma.
--  Medido sobre las 1.832 ventas, pc_metodo_pago() reconoce el 85,8%:
--  transferencia 51,6%, efectivo 31,0%, tarjeta 3,2%. Queda por arreglar a
--  mano: 142 sin metodo anotado, 13 mixtas, 9 irreconocibles, 6 sin cobro.
--
--  ── Comprobado contra los datos reales ────────────────────────────────────
--    · El libro cuadra EXACTO con sus fuentes: diferencia 0,00 en ventas,
--      abonos y gastos.
--    · 1.796 filas, 1.796 ids unicos. Cero duplicados.
--    · Ninguna venta aparece a la vez como venta y como abono.
--    · Todo en numeric(14,2): pesos Y centavos. Con bigint habia 0,30 de
--      deriva en 1.718 ventas, y en un libro de caja la deriva se acumula.
--    · Caja ve 0 gastos en el detalle (pc_gastos es solo-admin desde M3) pero
--      su efectivo teorico coincide con el del admin al centavo.
--
--  OJO AL APLICAR ESTE ARCHIVO DE NUEVO: `create or replace view` REINICIA las
--  opciones de la vista. Despues de cada recreacion hay que volver a poner
--  security_invoker, o la vista pasa a leer con los permisos de quien la creo
--  y se salta la RLS — caja veria los gastos. Paso de verdad al montar esto y
--  lo cazo get_advisors como ERROR.
-- ============================================================================

-- 1) Normalizadores ---------------------------------------------------------
create or replace function public.pc_metodo_pago(p_texto text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when t ~ 'pendiente'                then 'PENDIENTE'
    when t ~ 'sin cobro|no se le cobr'  then 'SIN COBRO'
    -- MIXTO a proposito: "efectivo ($1000)/ transferencia ($350)" nombra dos
    -- metodos; repartir el monto sin que alguien diga cuanto va a cada uno
    -- seria inventarse el dato. Se marca y se arregla a mano.
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

-- El banco, para cuadrar contra el estado de cuenta: una transferencia a
-- Popular y otra a Reservas no se concilian juntas.
create or replace function public.pc_banco(p_texto text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select case
    when t ~ 'popular|populat'           then 'Popular'
    when t ~ 'reserv|resevas|bareservas' then 'Banreservas'
    when t ~ 'santa cruz'                then 'Santa Cruz'
    else null end
  from (select lower(trim(coalesce(p_texto, ''))) as t) x;
$$;

-- Las fechas se guardan como texto: esto convierte sin reventar con lo que haya.
create or replace function public.pc_fecha(p_texto text)
returns date language sql immutable set search_path = public, pg_temp as $$
  select case when coalesce(p_texto,'') ~ '^\d{4}-\d{2}-\d{2}' then left(p_texto,10)::date end;
$$;

revoke all on function public.pc_metodo_pago(text) from public, anon;
revoke all on function public.pc_banco(text)       from public, anon;
revoke all on function public.pc_fecha(text)       from public, anon;

-- 2) El arqueo ---------------------------------------------------------------
-- El arqueo es SOBRE EFECTIVO: una transferencia no esta en la gaveta, asi que
-- meterla al cuadrar el cajon solo produce descuadres que nadie puede explicar.
-- El libro si muestra todos los metodos.
create table if not exists public.pc_caja_dia (
  fecha              date primary key,
  estado             text not null default 'abierta' check (estado in ('abierta','cerrada')),
  saldo_inicial      numeric(14,2) not null default 0,
  abierta_en         timestamptz default now(),
  abierta_por        text,
  cerrada_en         timestamptz,
  cerrada_por        text,
  efectivo_contado   numeric(14,2),
  -- Foto del momento del cierre, NO un calculo que se rehace. Las ventas se
  -- corrigen dias despues (se vio en M8); si esto se recalculara, el arqueo
  -- dejaria de decir lo que de verdad se conto esa noche. Al mirarlo despues,
  -- la app compara la foto con el calculo de hoy: si no cuadran, esa diferencia
  -- es informacion, no un error.
  entradas_efectivo  numeric(14,2),
  salidas_efectivo   numeric(14,2),
  teorico_efectivo   numeric(14,2),
  diferencia         numeric(14,2),     -- contado - teorico. Negativo = falta.
  notas              text,
  actualizado        timestamptz default now()
);
alter table public.pc_caja_dia enable row level security;
drop policy if exists pc_caja_dia_personal on public.pc_caja_dia;
create policy pc_caja_dia_personal on public.pc_caja_dia for all to authenticated
  using ((select public.pc_es_personal())) with check ((select public.pc_es_personal()));
revoke all on public.pc_caja_dia from anon;

-- 3) Movimientos que NO son venta ni gasto -----------------------------------
-- Hoy no tienen donde vivir: pc_gastos es solo del admin, asi que si caja paga
-- el agua desde el cajon no puede registrarlo en ningun sitio. Esta tabla si la
-- puede usar todo el personal.
create table if not exists public.pc_caja_movimientos (
  id           bigserial primary key,
  fecha        date not null,
  hora         time,
  tipo         text not null check (tipo in ('ENTRADA','SALIDA')),
  concepto     text not null,
  categoria    text,
  metodo_pago  text not null default 'EFECTIVO',
  referencia   text,                                  -- recibo, NCF, nº de transferencia
  monto        numeric(14,2) not null check (monto > 0),  -- positivo; el signo lo da `tipo`
  usuario      text,
  notas        text,
  creado       timestamptz default now()
);
create index if not exists pc_caja_mov_fecha_idx on public.pc_caja_movimientos (fecha desc);
alter table public.pc_caja_movimientos enable row level security;
drop policy if exists pc_caja_mov_personal on public.pc_caja_movimientos;
create policy pc_caja_mov_personal on public.pc_caja_movimientos for all to authenticated
  using ((select public.pc_es_personal())) with check ((select public.pc_es_personal()));
revoke all on public.pc_caja_movimientos from anon;
revoke all on sequence public.pc_caja_movimientos_id_seq from anon;

-- 4) El libro de caja --------------------------------------------------------
create or replace view public.pc_caja_libro as
select
  'venta:' || v.id as id, public.pc_fecha(v.fecha) as fecha,
  coalesce(v.created_at, public.pc_fecha(v.fecha)::timestamptz) as fecha_hora,
  v.id::text as referencia,
  coalesce(nullif(v.servicio,''), nullif(v.descripcion,''), 'Venta')
    || coalesce(' - ' || nullif(v.cliente,''), '') as concepto,
  coalesce(nullif(v.area,''), 'Ventas') as categoria,
  public.pc_metodo_pago(v.formapago) as metodo_pago,
  public.pc_banco(v.formapago) as banco,
  coalesce(v.total,0)::numeric(14,2) as entrada,
  0::numeric(14,2) as salida,
  v.recibidopor as usuario, 'venta'::text as origen
from public.pc_ventas v
where public.pc_fecha(v.fecha) is not null
  and public.pc_metodo_pago(v.formapago) not in ('PENDIENTE','SIN COBRO')
  and coalesce(jsonb_array_length(case when jsonb_typeof(v.abonos)='array' then v.abonos else '[]'::jsonb end), 0) = 0
union all
-- Las ventas con abonos NO entran arriba: su dinero entra por aqui, el dia en
-- que de verdad llego al cajon. Contar las dos cosas lo sacaria DOS VECES.
select
  'abono:' || v.id || ':' || (a.ord - 1), public.pc_fecha(a.item ->> 'fecha'),
  coalesce(public.pc_fecha(a.item ->> 'fecha')::timestamptz, v.created_at),
  v.id::text, 'Abono - ' || coalesce(nullif(v.cliente,''), 'cliente'), 'Abonos',
  public.pc_metodo_pago(coalesce(a.item ->> 'forma','') || ' ' || coalesce(a.item ->> 'banco','')),
  public.pc_banco(coalesce(a.item ->> 'forma','') || ' ' || coalesce(a.item ->> 'banco','')),
  coalesce((a.item ->> 'monto')::numeric, 0)::numeric(14,2), 0::numeric(14,2),
  a.item ->> 'por', 'abono'
from public.pc_ventas v
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(v.abonos)='array' then v.abonos else '[]'::jsonb end) with ordinality as a(item, ord)
where public.pc_fecha(a.item ->> 'fecha') is not null
  and coalesce((a.item ->> 'monto')::numeric, 0) > 0
union all
select
  'gasto:' || g.id, public.pc_fecha(g.fecha),
  coalesce(g.created_at, public.pc_fecha(g.fecha)::timestamptz),
  coalesce(nullif(g.proveedor,''), g.id::text),
  coalesce(nullif(g.descripcion,''), 'Gasto'),
  coalesce(nullif(g.categoria,''), 'Sin categoria'),
  public.pc_metodo_pago(g.formapago), public.pc_banco(g.formapago),
  0::numeric(14,2), coalesce(g.monto,0)::numeric(14,2), null, 'gasto'
from public.pc_gastos g
where public.pc_fecha(g.fecha) is not null
union all
select
  'mov:' || m.id, m.fecha, (m.fecha + coalesce(m.hora,'00:00'::time))::timestamptz,
  m.referencia, m.concepto, coalesce(nullif(m.categoria,''), 'Caja'),
  m.metodo_pago, null,
  (case when m.tipo='ENTRADA' then m.monto else 0 end)::numeric(14,2),
  (case when m.tipo='SALIDA'  then m.monto else 0 end)::numeric(14,2),
  m.usuario, 'movimiento'
from public.pc_caja_movimientos m;

-- SIEMPRE despues de cada create or replace (ver el aviso de la cabecera).
alter view public.pc_caja_libro set (security_invoker = on);
revoke all on public.pc_caja_libro from anon;
grant select on public.pc_caja_libro to authenticated;

-- 5) El resumen del dia ------------------------------------------------------
-- SECURITY DEFINER a proposito, y este es el motivo: pc_gastos es solo-admin,
-- asi que el libro (que respeta RLS) le enseña CERO gastos a caja. Si el arqueo
-- se calculara con lo que caja ve, su efectivo teorico saldria demasiado alto y
-- tendria un sobrante falso todos los dias. Esta funcion devuelve SOLO totales
-- —nunca el detalle— para que quien cuenta la gaveta tenga el numero correcto
-- sin ver en que gasta el dueño. Comprobado el 13 jun 2026: caja ve 0 gastos en
-- el detalle pero su salida_efectivo es 5.000,00, igual que la del admin.
create or replace function public.pc_caja_resumen(p_fecha date)
returns table (
  saldo_inicial numeric, entradas_efectivo numeric, salidas_efectivo numeric,
  teorico_efectivo numeric, entradas_total numeric, salidas_total numeric
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.pc_es_personal() then
    raise exception 'No autorizado';
  end if;
  return query
  with ini as (
    select coalesce((select d.saldo_inicial from public.pc_caja_dia d where d.fecha = p_fecha), 0) as s
  ), mov as (
    select
      coalesce(sum(l.entrada) filter (where l.metodo_pago = 'EFECTIVO'), 0) as ent_ef,
      coalesce(sum(l.salida)  filter (where l.metodo_pago = 'EFECTIVO'), 0) as sal_ef,
      coalesce(sum(l.entrada), 0) as ent_tot,
      coalesce(sum(l.salida),  0) as sal_tot
    from public.pc_caja_libro l where l.fecha = p_fecha
  )
  select ini.s, mov.ent_ef, mov.sal_ef,
         (ini.s + mov.ent_ef - mov.sal_ef), mov.ent_tot, mov.sal_tot
  from ini, mov;
end $$;
revoke all on function public.pc_caja_resumen(date) from public, anon;

-- 6) El reporte de periodo (semana, mes, rango) -------------------------------
-- Todo lo suma Postgres y baja en UN solo jsonb. Un mes son ~150 movimientos,
-- pero un año son 1.800: traerselos al navegador para sumarlos alli es justo lo
-- que se quito en M7. Y SECURITY DEFINER por la misma razon que pc_caja_resumen:
-- pc_gastos es solo-admin, asi que si caja genera el reporte con lo que ella ve,
-- las salidas salen en cero y el flujo neto miente. Devuelve SOLO agregados,
-- nunca el detalle, para que el numero sea correcto sin enseñar en que se gasta.
create or replace function public.pc_caja_reporte(
  p_desde date, p_hasta date,
  p_metodo text default null, p_categoria text default null
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  if not public.pc_es_personal() then raise exception 'No autorizado'; end if;
  if p_hasta < p_desde then raise exception 'El rango esta al reves: % va despues de %', p_desde, p_hasta; end if;

  with mov as (
    select * from public.pc_caja_libro l
     where l.fecha between p_desde and p_hasta
       and (p_metodo    is null or l.metodo_pago = p_metodo)
       and (p_categoria is null or l.categoria   = p_categoria)
  ), tot as (
    select coalesce(sum(entrada),0) e, coalesce(sum(salida),0) s, count(*) n,
           count(distinct fecha) d from mov
  ), met as (
    select coalesce(jsonb_agg(x order by x->>'metodo'), '[]'::jsonb) j from (
      select jsonb_build_object('metodo', metodo_pago,
               'entradas', sum(entrada), 'salidas', sum(salida),
               'neto', sum(entrada)-sum(salida), 'movimientos', count(*)) x
        from mov group by metodo_pago) z
  ), cat as (
    select coalesce(jsonb_agg(x order by (x->>'total')::numeric desc), '[]'::jsonb) j from (
      select jsonb_build_object('categoria', categoria,
               'entradas', sum(entrada), 'salidas', sum(salida),
               'neto', sum(entrada)-sum(salida),
               'total', sum(entrada)+sum(salida), 'movimientos', count(*)) x
        from mov group by categoria) z
  ), dia as (
    select coalesce(jsonb_agg(x order by x->>'fecha'), '[]'::jsonb) j from (
      select jsonb_build_object('fecha', fecha,
               'entradas', sum(entrada), 'salidas', sum(salida),
               'neto', sum(entrada)-sum(salida), 'movimientos', count(*)) x
        from mov group by fecha) z
  ), arq as (
    -- Los arqueos del rango: cuantos dias se cerraron y como cuadraron.
    select count(*) filter (where estado='cerrada') cerrados,
           count(*) filter (where estado='abierta') abiertos,
           count(*) filter (where estado='cerrada' and abs(coalesce(diferencia,0)) >= 0.005) con_descuadre,
           coalesce(sum(diferencia) filter (where estado='cerrada'), 0) descuadre_neto,
           coalesce(sum(abs(diferencia)) filter (where estado='cerrada'), 0) descuadre_abs
      from public.pc_caja_dia where fecha between p_desde and p_hasta
  )
  select jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'dias_rango', (p_hasta - p_desde) + 1,
    'totales', jsonb_build_object(
      'entradas', tot.e, 'salidas', tot.s, 'neto', tot.e - tot.s,
      'movimientos', tot.n, 'dias_con_movimiento', tot.d,
      -- promedio sobre los dias que DE VERDAD tuvieron movimiento: dividir
      -- entre los dias del rango mete los domingos cerrados y hunde la media.
      'promedio_dia_entradas', case when tot.d > 0 then round(tot.e / tot.d, 2) else 0 end,
      'promedio_dia_neto',     case when tot.d > 0 then round((tot.e - tot.s) / tot.d, 2) else 0 end),
    'por_metodo', met.j, 'por_categoria', cat.j, 'por_dia', dia.j,
    'arqueos', jsonb_build_object(
      'cerrados', arq.cerrados, 'abiertos', arq.abiertos,
      'con_descuadre', arq.con_descuadre,
      'descuadre_neto', arq.descuadre_neto, 'descuadre_abs', arq.descuadre_abs)
  ) into v
  from tot, met, cat, dia, arq;
  return v;
end $$;
revoke all on function public.pc_caja_reporte(date, date, text, text) from public, anon;
-- Comprobado el 7 oct 2026 contra agosto 2026: entradas 195.380,00 / salidas
-- 1.550,00 / neto 193.830,00 / 130 movimientos en 24 dias / promedio 8.140,83,
-- identico a sumar pc_caja_libro a mano. Y contra septiembre: 223.803,10 en 151
-- movimientos. OJO con ese septiembre: las salidas dan 0,00 porque NADIE
-- registro gastos ese mes (pc_gastos tiene 6 filas en junio, 1 en agosto, 0 en
-- septiembre). El reporte no miente: la mitad del dato no se esta capturando.

-- ── Basura que dejo el montaje ──────────────────────────────────────────────
-- La vista `pc_caja_libro_bigint_viejo` quedo huerfana de un intento fallido.
-- El conector de Supabase CUELGA en cualquier DROP (se intento seis veces), asi
-- que se le vacio el cuerpo (`where false`) y se le quitaron los permisos. No
-- expone nada ni la usa nadie. Borrarla a mano desde el panel de Supabase:
--   drop view public.pc_caja_libro_bigint_viejo;
