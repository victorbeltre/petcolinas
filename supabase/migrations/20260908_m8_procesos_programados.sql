-- ============================================================================
--  M8 · Infraestructura para procesos programados (8 sep 2026)
--
--  Hasta ahora TODO lo automatico de la app depende de que alguien tenga el
--  navegador abierto: los avisos, los conteos, los recordatorios. Si nadie
--  abre la app un lunes, ese lunes no pasa nada. Todo lo de la lista 2
--  (recordatorios de vacuna, aviso de cita el dia antes, seguimiento del
--  cliente que dejo de venir) necesita que la base pueda hacer cosas sola.
--
--  Esto es la plomeria y UNA primera tarea inofensiva.
--  NINGUNA tarea de aqui manda mensajes a clientes. Eso no se enciende sin
--  que Victor lo diga: un recordatorio automatico mal calibrado le escribe a
--  700 personas antes de que a nadie le de tiempo de pararlo.
--
--  Zona horaria: pg_cron programa en UTC. Santo Domingo es UTC-4 todo el año
--  (no hay horario de verano), asi que las 05:30 de aqui son las 09:30 UTC.
-- ============================================================================

create extension if not exists pg_cron;

-- 1) Bitacora ---------------------------------------------------------------
-- Sin esto, una tarea que falle en silencio a las 5 de la mañana no se nota
-- hasta que alguien echa en falta el resultado, semanas despues.
create table if not exists public.pc_tareas_log (
  id       bigserial primary key,
  tarea    text not null,
  inicio   timestamptz not null default now(),
  fin      timestamptz,
  ok       boolean,
  detalle  text,
  filas    integer
);
create index if not exists pc_tareas_log_tarea_idx on public.pc_tareas_log (tarea, inicio desc);
alter table public.pc_tareas_log enable row level security;
drop policy if exists pc_tareas_log_admin on public.pc_tareas_log;
create policy pc_tareas_log_admin on public.pc_tareas_log for select to authenticated
  using ((select public.pc_es_admin()));
revoke all on public.pc_tareas_log from anon;
revoke all on sequence public.pc_tareas_log_id_seq from anon;

-- 2) El dia, ya sumado -------------------------------------------------------
-- Hoy los reportes recalculan sobre las ~1.700 ventas cada vez que se abre la
-- pestaña, y eso solo va a ir a peor. Esta tabla guarda una fila por fecha.
create table if not exists public.pc_resumen_diario (
  fecha        date primary key,
  ingresos     bigint  not null default 0,
  servicios    integer not null default 0,
  grooming     bigint  not null default 0,
  veterinaria  bigint  not null default 0,
  farmacia     bigint  not null default 0,
  otros        bigint  not null default 0,
  egresos      bigint  not null default 0,
  actualizado  timestamptz default now()
);
alter table public.pc_resumen_diario enable row level security;
drop policy if exists pc_resumen_diario_leer on public.pc_resumen_diario;
create policy pc_resumen_diario_leer on public.pc_resumen_diario for select to authenticated
  using ((select public.pc_es_personal()));
drop policy if exists pc_resumen_diario_admin on public.pc_resumen_diario;
create policy pc_resumen_diario_admin on public.pc_resumen_diario for all to authenticated
  using ((select public.pc_es_admin())) with check ((select public.pc_es_admin()));
revoke all on public.pc_resumen_diario from anon;

-- 3) La tarea ----------------------------------------------------------------
-- RECALCULA un rango en vez de acumular, a proposito: una venta vieja que se
-- corrige (pasa, y bastante) rehace sola la fila de ese dia en la siguiente
-- corrida, en lugar de quedarse mal para siempre.
create or replace function public.pc_tarea_resumen_diario(p_desde date default null, p_hasta date default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_desde date := coalesce(p_desde, (current_date at time zone 'America/Santo_Domingo')::date - 7);
  v_hasta date := coalesce(p_hasta, (current_date at time zone 'America/Santo_Domingo')::date);
  v_log   bigint;
  v_filas integer := 0;
begin
  insert into public.pc_tareas_log (tarea, detalle)
  values ('resumen_diario', 'del ' || v_desde || ' al ' || v_hasta)
  returning id into v_log;

  with dias as (
    select v.fecha::date as fecha,
           sum(coalesce(v.total, 0))::bigint as ingresos,
           count(*)::integer as servicios,
           sum(case when v.area = 'grooming'    then coalesce(v.total,0) else 0 end)::bigint as grooming,
           sum(case when v.area = 'veterinaria' then coalesce(v.total,0) else 0 end)::bigint as veterinaria,
           sum(case when v.area in ('farmacia','medicamentos') then coalesce(v.total,0) else 0 end)::bigint as farmacia,
           sum(case when v.area is null or v.area not in ('grooming','veterinaria','farmacia','medicamentos')
                    then coalesce(v.total,0) else 0 end)::bigint as otros
      from public.pc_ventas v
     where v.fecha is not null and v.fecha <> ''
       and v.fecha::date between v_desde and v_hasta
     group by v.fecha::date
  ), gastos_dia as (
    select g.fecha::date as fecha, sum(coalesce(g.monto,0))::bigint as egresos
      from public.pc_gastos g
     where g.fecha is not null and g.fecha <> ''
       and g.fecha::date between v_desde and v_hasta
     group by g.fecha::date
  )
  insert into public.pc_resumen_diario as r
    (fecha, ingresos, servicios, grooming, veterinaria, farmacia, otros, egresos, actualizado)
  -- full outer join: hay dias con gasto y sin venta (un domingo que se paga el
  -- alquiler) y no pueden desaparecer del resumen.
  select coalesce(d.fecha, gd.fecha),
         coalesce(d.ingresos,0), coalesce(d.servicios,0), coalesce(d.grooming,0),
         coalesce(d.veterinaria,0), coalesce(d.farmacia,0), coalesce(d.otros,0),
         coalesce(gd.egresos,0), now()
    from dias d full outer join gastos_dia gd on gd.fecha = d.fecha
  on conflict (fecha) do update set
    ingresos = excluded.ingresos, servicios = excluded.servicios,
    grooming = excluded.grooming, veterinaria = excluded.veterinaria,
    farmacia = excluded.farmacia, otros = excluded.otros,
    egresos = excluded.egresos, actualizado = now();
  get diagnostics v_filas = row_count;

  update public.pc_tareas_log set fin = now(), ok = true, filas = v_filas where id = v_log;
  return v_filas;
exception when others then
  update public.pc_tareas_log set fin = now(), ok = false,
         detalle = coalesce(detalle,'') || ' | ERROR: ' || sqlerrm
   where id = v_log;
  raise;
end $$;

-- OJO con esto: `revoke ... from public, anon` NO alcanza. Supabase otorga
-- EXECUTE a `authenticated` por privilegios por defecto al crear la funcion,
-- asi que hay que nombrarlo. Esta tarea recalcula cientos de dias de golpe y
-- no tiene por que dispararla nadie desde el navegador: la corre el cron, que
-- entra como postgres.
revoke all on function public.pc_tarea_resumen_diario(date, date) from public, anon, authenticated;
grant execute on function public.pc_tarea_resumen_diario(date, date) to service_role;

-- 4) El horario --------------------------------------------------------------
-- 05:30 de Santo Domingo, antes de abrir, para que el resumen del dia anterior
-- ya este cuando alguien mire. Recalcula los ultimos 7 dias, no solo ayer.
select cron.schedule('resumen_diario', '30 9 * * *',
  $cron$select public.pc_tarea_resumen_diario();$cron$);

-- Relleno historico, una sola vez (307 dias al aplicarse):
--   select public.pc_tarea_resumen_diario('2025-01-01'::date, current_date);
-- Comprobado mes a mes contra pc_ventas: diferencia 0 en los 10 meses con
-- datos, tanto en importe como en numero de servicios.

-- ── Como añadir una tarea nueva (para la lista 2) ───────────────────────────
--   1. Una funcion `public.pc_tarea_<nombre>()`, security definer, que abra su
--      fila en pc_tareas_log al empezar y la cierre al terminar (ok/error).
--   2. `revoke ... from public, anon, authenticated` y grant solo a
--      service_role. Nombrar a `authenticated` explicitamente.
--   3. `select cron.schedule('<nombre>', '<cron en UTC>', $$select ...$$);`
--   4. Si la tarea manda algo hacia afuera (WhatsApp, correo), NO se programa
--      sin permiso de Victor, y se estrena con la lista limitada a el.
