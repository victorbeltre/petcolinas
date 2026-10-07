-- ─────────────────────────────────────────────────────────────────────────────
-- M19 · Cuentas, traslados y conciliacion bancaria (7 oct 2026)
--
-- EL PROBLEMA QUE RESUELVE
-- El arqueo de M18 cuenta la gaveta. Pero en 2026 la gaveta movio RD$ 642.122,30
-- de RD$ 2,07 MM: el 69% del dinero NUNCA toca el efectivo. Cada noche se
-- contaban 642 mil pesos y se dejaban 1,4 millones sin ninguna verificacion.
--   Efectivo            642.122,30   (31%)
--   Banreservas         590.860,00
--   Popular             463.503,00
--   Transferencia s/b   110.141,00   <- transferencia sin banco anotado
--   Tarjeta              88.784,00
--   Mixto                24.151,00
--   Santa Cruz            4.925,00
--
-- POR QUE EL BANCO NO SE ARQUEA
-- La gaveta se CUENTA: si no cuadra, hay un error o un robo, hoy. El banco no se
-- puede contar, se CONCILIA contra el estado de cuenta, y dia a dia nunca cuadra
-- por razones estructurales, no por descuido:
--   · las tarjetas caen a T+1/T+3 y caen NETAS de la comision del adquirente;
--   · cargos del banco y cheques que no se han hecho efectivos;
--   · pagos que el dueño hace desde el telefono sin que nadie los anote.
-- Montarlo como "arqueo del banco" daria descuadre todas las noches, y un numero
-- que siempre descuadra la gente deja de mirarlo — incluido el de la gaveta, que
-- si sirve. Por eso aqui la diferencia NO se llama descuadre: se llama partidas
-- pendientes, y se enseña como lista.
--
-- LA COMISION DE TARJETA NO SE INVENTA, SE MIDE
-- No hay ningun porcentaje escrito en ningun sitio. `pc_traslados` guarda lo que
-- SALIO del origen y lo que ENTRO al destino; la resta ES la comision, exacta.
-- Si el POS liquida 10.000,00 y el banco abona 9.650,00, la comision son 350,00
-- porque asi lo dice el banco, no porque alguien estimara un 3,5%.
--
-- EL HUECO QUE TAPA
-- `pc_caja_movimientos.tipo` solo aceptaba ENTRADA|SALIDA. El dia que depositaran
-- el efectivo de la gaveta en Banreservas lo habrian anotado como SALIDA y el
-- reporte habria dicho que el negocio perdio esa plata. Un traslado es la misma
-- plata cambiando de sitio: neto CERO en el negocio. La tabla estaba vacia
-- cuando se escribio esto, asi que no hubo que reparar ningun dato.
--
-- DONDE VA CADA COSA (la separacion importa)
--   pc_caja_libro    flujo del NEGOCIO     -> NO ve traslados (si no, doble conteo)
--   pc_caja_resumen  efectivo de la gaveta -> SI ve traslados (sale/entra plata)
--   pc_cuenta_libro  saldo por cuenta      -> SI los ve, expandidos en dos lineas
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Las cuentas donde vive el dinero ----------------------------------------
-- `banco` es el valor que devuelve pc_banco(), para poder atribuir lo que ya
-- existe sin tocar ni una fila de pc_ventas ni de pc_gastos.
create table if not exists public.pc_cuentas (
  id        text primary key,
  nombre    text not null,
  tipo      text not null check (tipo in ('EFECTIVO','BANCO','PUENTE','SIN_ASIGNAR')),
  banco     text,
  se_cuenta boolean not null default false,   -- true solo la gaveta: se arquea fisico
  activa    boolean not null default true,
  orden     int not null default 100,
  notas     text,
  creado    timestamptz default now()
);
alter table public.pc_cuentas enable row level security;
revoke all on public.pc_cuentas from anon;
grant select, insert, update, delete on public.pc_cuentas to authenticated;
drop policy if exists "pc_cuentas solo admin" on public.pc_cuentas;
create policy "pc_cuentas solo admin" on public.pc_cuentas
  for all to authenticated using (public.pc_es_admin()) with check (public.pc_es_admin());

insert into public.pc_cuentas (id, nombre, tipo, banco, se_cuenta, activa, orden, notas) values
  ('gaveta',      'Caja chica (gaveta)', 'EFECTIVO',    null,          true,  true, 10,
     'La unica que se cuenta a mano. Su arqueo es pc_caja_dia.'),
  ('banreservas', 'Banreservas',         'BANCO',       'Banreservas', false, true, 20, null),
  ('popular',     'Popular',             'BANCO',       'Popular',     false, true, 30, null),
  ('santacruz',   'Santa Cruz',          'BANCO',       'Santa Cruz',  false, false, 40,
     'Desactivada a proposito: en 2026 son 4 transferencias por RD$ 4.925,00. Parece el banco DESDE el que pago un cliente, no una cuenta del negocio. Activar solo si Victor confirma que es suya.'),
  ('tarjetas',    'Tarjetas por liquidar','PUENTE',     null,          false, true, 50,
     'Cuenta puente. La venta con tarjeta entra aqui el dia de la venta y sale cuando el banco la deposita (T+1 a T+3). La diferencia entre lo que sale de aqui y lo que entra al banco ES la comision del adquirente, medida.'),
  ('sin_asignar', 'Sin asignar',          'SIN_ASIGNAR', null,         false, true, 90,
     'Lo que no se puede atribuir: transferencia sin banco anotado, MIXTO, SIN ANOTAR, OTRO. A proposito es ruidoso: mientras tenga saldo, la conciliacion no puede cerrar.')
on conflict (id) do nothing;

-- 2) A que cuenta cae cada movimiento del libro -------------------------------
-- MIXTO va a sin_asignar aunque traiga banco: si una venta se cobro parte en
-- efectivo y parte por transferencia, partirla por la mitad seria inventarse
-- cuanto fue de cada cosa.
-- STABLE, no IMMUTABLE: lee pc_cuentas, y con IMMUTABLE el planificador la
-- podria constant-foldear y dejar de ver un banco recien dado de alta.
-- SECURITY DEFINER porque pc_cuentas es solo-admin: sin esto, para un no-admin
-- la subconsulta volveria vacia y TODO caeria en 'sin_asignar' en silencio. El
-- mapeo (que banco es que cuenta) no es secreto; secretas son las filas, y esas
-- las sigue filtrando la RLS en la vista, que es security_invoker.
create or replace function public.pc_cuenta_de(p_metodo text, p_banco text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when p_metodo = 'EFECTIVO' then 'gaveta'
    when p_metodo = 'TARJETA'  then 'tarjetas'
    when p_metodo in ('TRANSFERENCIA','CHEQUE') then
      coalesce((select c.id from public.pc_cuentas c
                 where c.tipo = 'BANCO' and c.banco = p_banco limit 1), 'sin_asignar')
    else 'sin_asignar'
  end;
$$;
revoke all on function public.pc_cuenta_de(text, text) from public, anon;

-- 3) Traslados: la misma plata cambiando de sitio ----------------------------
-- `monto` es lo que SALIO del origen; `monto_recibido` lo que ENTRO al destino.
-- Nulo = entro lo mismo que salio. Cuando difieren, la resta es la comision o el
-- cargo del banco, y es un dato real, no una estimacion.
create table if not exists public.pc_traslados (
  id             bigserial primary key,
  fecha          date not null,
  hora           time,
  cuenta_origen  text not null references public.pc_cuentas(id),
  cuenta_destino text not null references public.pc_cuentas(id),
  monto          numeric(14,2) not null check (monto > 0),
  monto_recibido numeric(14,2) check (monto_recibido is null or monto_recibido > 0),
  concepto       text not null,
  referencia     text,
  usuario        text,
  notas          text,
  creado         timestamptz default now(),
  constraint pc_traslados_distintas check (cuenta_origen <> cuenta_destino)
);
create index if not exists pc_traslados_fecha_idx on public.pc_traslados (fecha);
alter table public.pc_traslados enable row level security;
revoke all on public.pc_traslados from anon;
grant select, insert, update, delete on public.pc_traslados to authenticated;
grant usage, select on sequence public.pc_traslados_id_seq to authenticated;
drop policy if exists "pc_traslados solo admin" on public.pc_traslados;
create policy "pc_traslados solo admin" on public.pc_traslados
  for all to authenticated using (public.pc_es_admin()) with check (public.pc_es_admin());

-- 4) El saldo que el dueño LEE de la app del banco ----------------------------
-- No se calcula: se declara. Es el ancla contra la que se concilia el teorico.
create table if not exists public.pc_cuenta_saldos (
  cuenta_id     text not null references public.pc_cuentas(id),
  fecha         date not null,
  saldo         numeric(14,2) not null,
  declarado_por text,
  declarado_en  timestamptz default now(),
  notas         text,
  primary key (cuenta_id, fecha)
);
alter table public.pc_cuenta_saldos enable row level security;
revoke all on public.pc_cuenta_saldos from anon;
grant select, insert, update, delete on public.pc_cuenta_saldos to authenticated;
drop policy if exists "pc_cuenta_saldos solo admin" on public.pc_cuenta_saldos;
create policy "pc_cuenta_saldos solo admin" on public.pc_cuenta_saldos
  for all to authenticated using (public.pc_es_admin()) with check (public.pc_es_admin());

-- 5) El libro por cuenta ------------------------------------------------------
-- Dos fuentes: lo que ya hay en pc_caja_libro (atribuido con pc_cuenta_de) y los
-- traslados, que se expanden en DOS lineas — salida del origen, entrada al
-- destino — porque en un libro por cuenta un traslado toca dos cuentas.
create or replace view public.pc_cuenta_libro as
  select l.id, public.pc_cuenta_de(l.metodo_pago, l.banco) as cuenta_id,
         l.fecha, l.fecha_hora, l.referencia, l.concepto, l.categoria,
         l.metodo_pago, l.banco, l.entrada, l.salida, l.usuario, l.origen
    from public.pc_caja_libro l
  union all
  select 'traslado:' || t.id || ':sale', t.cuenta_origen,
         t.fecha, (t.fecha + coalesce(t.hora, '00:00:00'::time))::timestamptz,
         t.referencia, t.concepto, 'Traslado', 'TRASLADO', null,
         0::numeric(14,2), t.monto, t.usuario, 'traslado'
    from public.pc_traslados t
  union all
  select 'traslado:' || t.id || ':entra', t.cuenta_destino,
         t.fecha, (t.fecha + coalesce(t.hora, '00:00:00'::time))::timestamptz,
         t.referencia, t.concepto, 'Traslado', 'TRASLADO', null,
         coalesce(t.monto_recibido, t.monto), 0::numeric(14,2), t.usuario, 'traslado'
    from public.pc_traslados t;
-- OJO (Regla 7 del README): `create or replace view` REINICIA las opciones, asi
-- que security_invoker se vuelve a poner DESPUES de cada recreacion. Sin esto la
-- vista leeria con los permisos de quien la creo y se saltaria la RLS.
alter view public.pc_cuenta_libro set (security_invoker = on);
revoke all on public.pc_cuenta_libro from anon;
grant select on public.pc_cuenta_libro to authenticated;

-- 6) El saldo REAL de cada cuenta, venga de donde venga ----------------------
-- Sin duplicar: para la gaveta YA existe y es el arqueo de pc_caja_dia (el
-- efectivo contado a mano); para los bancos es lo que Victor lee de la app del
-- banco y declara. Copiar el arqueo a pc_cuenta_saldos daria dos sitios
-- distintos diciendo cuanto habia en la gaveta esa noche.
create or replace view public.pc_cuenta_declarado as
  select s.cuenta_id, s.fecha, s.saldo, s.declarado_por as por, s.notas, 'declarado'::text as origen
    from public.pc_cuenta_saldos s
  union all
  select 'gaveta', d.fecha, d.efectivo_contado, d.cerrada_por, d.notas, 'arqueo'::text
    from public.pc_caja_dia d
   where d.estado = 'cerrada' and d.efectivo_contado is not null;
alter view public.pc_cuenta_declarado set (security_invoker = on);
revoke all on public.pc_cuenta_declarado from anon;
grant select on public.pc_cuenta_declarado to authenticated;

-- 7) Estado de las cuentas en un dia -----------------------------------------
-- Con cuanto empezaron, que se movio y con cuanto terminaron. SECURITY DEFINER
-- porque pc_cuenta_libro respeta RLS y pc_gastos es solo-admin; pero la funcion
-- EXIGE admin, asi que el que no lo es no la usa, no es que vea de mas.
--
-- El teorico se ancla en el ultimo saldo REAL conocido (arqueo de la gaveta o
-- saldo declarado del banco) y le suma los movimientos desde ahi. Sin ancla, el
-- teorico seria la suma de todo desde 2025, que no significa nada: por eso se
-- devuelve `sin_ancla` y la pantalla lo dice en vez de enseñar un numero falso.
create or replace function public.pc_cuentas_estado(p_fecha date)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  if not public.pc_es_admin() then raise exception 'No autorizado'; end if;

  select coalesce(jsonb_agg(x order by orden), '[]'::jsonb) into v from (
    select c.orden, jsonb_build_object(
      'cuenta_id', c.id, 'nombre', c.nombre, 'tipo', c.tipo,
      'se_cuenta', c.se_cuenta,
      'ancla_fecha', a.fecha, 'ancla_saldo', a.saldo, 'ancla_origen', a.origen,
      'sin_ancla', (a.fecha is null),
      'saldo_inicial', ini.v,
      'entradas', dia.e, 'salidas', dia.s,
      'saldo_final_teorico', ini.v + dia.e - dia.s,
      'declarado_hoy', hoy.saldo, 'declarado_origen', hoy.origen,
      'diferencia', case when hoy.saldo is null then null
                         else hoy.saldo - (ini.v + dia.e - dia.s) end,
      'movimientos', dia.n
    ) x
    from public.pc_cuentas c
    left join lateral (
      select d.fecha, d.saldo, d.origen from public.pc_cuenta_declarado d
       where d.cuenta_id = c.id and d.fecha < p_fecha
       order by d.fecha desc limit 1) a on true
    cross join lateral (
      select coalesce(a.saldo, 0) + coalesce((
        select sum(l.entrada - l.salida) from public.pc_cuenta_libro l
         where l.cuenta_id = c.id
           and l.fecha > coalesce(a.fecha, '0001-01-01'::date)
           and l.fecha < p_fecha), 0) as v) ini
    cross join lateral (
      select coalesce(sum(l.entrada), 0) e, coalesce(sum(l.salida), 0) s, count(*) n
        from public.pc_cuenta_libro l
       where l.cuenta_id = c.id and l.fecha = p_fecha) dia
    left join lateral (
      select d.saldo, d.origen from public.pc_cuenta_declarado d
       where d.cuenta_id = c.id and d.fecha = p_fecha limit 1) hoy on true
    where c.activa
  ) z;

  return jsonb_build_object('fecha', p_fecha, 'cuentas', v);
end $$;
revoke all on function public.pc_cuentas_estado(date) from public, anon;

-- 8) El arqueo de la gaveta tiene que ver los traslados -----------------------
-- Reemplaza la version de M18. Si el teorico de la doctora no bajara cuando
-- Victor se lleva el efectivo al banco, el arqueo le daria un faltante enorme
-- justo el dia que todo esta bien. Va aqui dentro porque pc_caja_resumen ya era
-- SECURITY DEFINER y solo devuelve totales: ella tiene el numero correcto sin
-- ver un solo traslado (comprobado: admin y caja leen -16.002,90 el 19 sep).
-- OJO con la asimetria, y es a proposito: entradas/salidas_efectivo SI llevan
-- traslados (son billetes entrando o saliendo de la gaveta); entradas/salidas
-- _total NO (un traslado no es ingreso ni gasto del negocio).
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
  ), tras as (
    select
      coalesce(sum(coalesce(t.monto_recibido, t.monto))
                 filter (where t.cuenta_destino = 'gaveta'), 0) as ent_ef,
      coalesce(sum(t.monto) filter (where t.cuenta_origen = 'gaveta'), 0) as sal_ef
    from public.pc_traslados t where t.fecha = p_fecha
  )
  select ini.s,
         (mov.ent_ef + tras.ent_ef),
         (mov.sal_ef + tras.sal_ef),
         (ini.s + mov.ent_ef + tras.ent_ef - mov.sal_ef - tras.sal_ef),
         mov.ent_tot, mov.sal_tot
  from ini, mov, tras;
end $$;
revoke all on function public.pc_caja_resumen(date) from public, anon;

-- 9) El reporte, ahora tambien clasificado por cuenta -------------------------
-- Reemplaza la version de M18. "Por metodo de pago" ya separaba efectivo de
-- banco, pero metia Banreservas y Popular en el mismo saco bajo TRANSFERENCIA,
-- y no dejaba cruzar una cuenta con sus categorias (de lo que entro en efectivo,
-- cuanto fue grooming y cuanto farmacia). Eso es `por_cuenta` y
-- `por_cuenta_categoria`.
--
-- OJO: se mantiene la MISMA firma de 4 argumentos a proposito. Añadir un quinto
-- parametro con default crearia una SOBRECARGA, y entonces una pestaña del
-- navegador que siguiera abierta con el codigo viejo mandaria 4 claves y
-- PostgREST no sabria cual de las dos funciones elegir ("could not choose the
-- best candidate function"). Como el cruce viene siempre en la respuesta, no
-- hace falta ningun filtro nuevo: la pantalla despliega por cuenta sin otra
-- llamada.
--
-- Los dos desgloses nuevos van SOLO para admin (vienen nulos para los demas),
-- porque en M19 se decidio que las cuentas de banco no las ve caja. El desglose
-- por metodo, que ella si ve, no nombra ningun banco.
create or replace function public.pc_caja_reporte(
  p_desde date, p_hasta date,
  p_metodo text default null, p_categoria text default null
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb; v_admin boolean;
begin
  if not public.pc_es_personal() then raise exception 'No autorizado'; end if;
  if p_hasta < p_desde then raise exception 'El rango esta al reves: % va despues de %', p_desde, p_hasta; end if;
  v_admin := public.pc_es_admin();

  with mov as (
    select l.*, public.pc_cuenta_de(l.metodo_pago, l.banco) as cuenta_id
      from public.pc_caja_libro l
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
  ), cta as (
    select coalesce(jsonb_agg(x order by (x->>'orden')::int, x->>'cuenta_id'), '[]'::jsonb) j from (
      select jsonb_build_object('cuenta_id', m.cuenta_id,
               'nombre', coalesce(c.nombre, m.cuenta_id),
               'tipo', coalesce(c.tipo, 'SIN_ASIGNAR'),
               'orden', coalesce(c.orden, 999),
               'entradas', sum(m.entrada), 'salidas', sum(m.salida),
               'neto', sum(m.entrada)-sum(m.salida), 'movimientos', count(*)) x,
             coalesce(c.orden, 999) orden
        from mov m left join public.pc_cuentas c on c.id = m.cuenta_id
       group by m.cuenta_id, c.nombre, c.tipo, c.orden) z
  ), ctacat as (
    select coalesce(jsonb_agg(x order by x->>'cuenta_id', (x->>'total')::numeric desc), '[]'::jsonb) j from (
      select jsonb_build_object('cuenta_id', cuenta_id, 'categoria', categoria,
               'entradas', sum(entrada), 'salidas', sum(salida),
               'neto', sum(entrada)-sum(salida),
               'total', sum(entrada)+sum(salida), 'movimientos', count(*)) x
        from mov group by cuenta_id, categoria) z
  ), arq as (
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
      'promedio_dia_entradas', case when tot.d > 0 then round(tot.e / tot.d, 2) else 0 end,
      'promedio_dia_neto',     case when tot.d > 0 then round((tot.e - tot.s) / tot.d, 2) else 0 end),
    'por_metodo', met.j, 'por_categoria', cat.j, 'por_dia', dia.j,
    'por_cuenta',           case when v_admin then cta.j    else null end,
    'por_cuenta_categoria', case when v_admin then ctacat.j else null end,
    'arqueos', jsonb_build_object(
      'cerrados', arq.cerrados, 'abiertos', arq.abiertos,
      'con_descuadre', arq.con_descuadre,
      'descuadre_neto', arq.descuadre_neto, 'descuadre_abs', arq.descuadre_abs)
  ) into v
  from tot, met, cat, dia, cta, ctacat, arq;
  return v;
end $$;
revoke all on function public.pc_caja_reporte(date, date, text, text) from public, anon;

-- ── Comprobado el 7 oct 2026 ────────────────────────────────────────────────
-- 1) Atribuir a cuentas no pierde ni duplica un peso:
--      pc_caja_libro   2.370.194,30 entradas / 408.070,00 salidas / 1.796 filas
--      pc_cuenta_libro 2.370.194,30 entradas / 408.070,00 salidas / 1.796 filas
--      (sin traslados) diferencia 0,00 y 0 filas.
-- 2) Un traslado NO mueve el flujo del negocio: neto del 19 sep 23.920,10 antes
--    y 23.920,10 despues de meter dos traslados.
-- 3) Un traslado SI mueve el efectivo: teorico de la gaveta 3.997,10 -> -16.002,90
--    tras depositar 20.000,00. gaveta -20.000,00 / banreservas +20.000,00.
-- 4) La comision de tarjeta se MIDE: POS liquida 10.000,00, Popular abona
--    9.650,00, tarjetas -10.000,00 y popular +9.650,00 -> comision 350,00. No
--    hay ningun porcentaje escrito en ninguna parte del codigo.
-- 5) Caja (veterinaria@) ve 0 cuentas, 0 traslados, 0 saldos, y pc_cuentas_estado
--    le responde "No autorizado" — pero su pc_caja_resumen da -16.002,90, el
--    MISMO numero que el del admin.
-- 6) get_advisors(security): ningun ERROR, ningun rls_disabled_in_public.
-- 7) Clasificar por cuenta no cambia ni un total (septiembre 2026):
--      totales            entradas 223.803,10 / salidas 0,00
--      suma por_cuenta    entradas 223.803,10 / salidas 0,00  -> cuadra
--      suma cuenta x cat  entradas 223.803,10 / salidas 0,00  -> cuadra
--    Y lo que antes era un solo "TRANSFERENCIA" ahora se ve separado:
--      gaveta 61.867,10 (28%) · Banreservas 30.053,00 · Popular 11.337,00
--      tarjetas por liquidar 83.736,00 (37%) · sin asignar 36.810,00 (16%)
-- 8) Caja recibe por_cuenta y por_cuenta_categoria en NULO, conserva sus 3
--    filas de por_metodo y los mismos totales que el admin.
