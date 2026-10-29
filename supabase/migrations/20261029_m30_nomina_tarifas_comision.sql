-- ─────────────────────────────────────────────────────────────────────────────
-- M30 · Tarifario de comisiones por servicio (29 oct 2026)
--
-- Victor compartio lo que gana Naylan (veterinaria) y Alexander (grooming) por
-- CADA servicio (monto fijo, no porcentaje). Va dentro de la nomina con clave
-- (M29): RLS sin politicas y solo se lee/escribe con un pase de nomina.
--
-- La comision se asigna por el SERVICIO, no por `recibidopor`: en las ventas,
-- `recibidopor` es quien registro la venta (Naylan registra muchos baños), no
-- quien hizo el trabajo. Un servicio de la tabla de Alexander es de Alexander.
-- `alias`: otras formas en que el servicio aparece escrito en las ventas.
-- Sin montos en este archivo (repo publico): se cargan aparte.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.pc_nomina_comisiones (
  id           bigint generated always as identity primary key,
  empleado_id  bigint not null references public.pc_nomina_empleados(id),
  servicio     text not null,
  precio       numeric(12,2),
  comision     numeric(12,2) not null check (comision >= 0),
  alias        text[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.pc_nomina_comisiones enable row level security;
revoke all on public.pc_nomina_comisiones from anon, authenticated;

create or replace function public.pc_nomina_datos(p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.pc_nomina_pase_ok(p_token);
  return jsonb_build_object(
    'empleados', coalesce((select jsonb_agg(to_jsonb(e) order by e.activo desc, e.nombre) from public.pc_nomina_empleados e), '[]'::jsonb),
    'movimientos', coalesce((select jsonb_agg(to_jsonb(m) order by m.fecha desc, m.id desc) from public.pc_nomina_movimientos m), '[]'::jsonb),
    'comisiones', coalesce((select jsonb_agg(to_jsonb(c) order by c.empleado_id, c.id) from public.pc_nomina_comisiones c), '[]'::jsonb));
end $$;

-- Guarda (o borra, con p_c.borrar = true) una fila del tarifario.
create or replace function public.pc_nomina_guardar_comision(p_token uuid, p_c jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_row public.pc_nomina_comisiones;
begin
  perform public.pc_nomina_pase_ok(p_token);
  if coalesce((p_c ->> 'borrar')::boolean, false) then
    delete from public.pc_nomina_comisiones where id = (p_c ->> 'id')::bigint;
    return null;
  end if;
  if coalesce(trim(p_c ->> 'servicio'), '') = '' then raise exception 'Falta el servicio'; end if;
  if (p_c ->> 'id') is null then
    insert into public.pc_nomina_comisiones (empleado_id, servicio, precio, comision, alias)
    values ((p_c ->> 'empleado_id')::bigint, trim(p_c ->> 'servicio'), nullif(p_c ->> 'precio', '')::numeric, (p_c ->> 'comision')::numeric,
            coalesce((select array_agg(x) from jsonb_array_elements_text(p_c -> 'alias') x), '{}'))
    returning * into v_row;
  else
    update public.pc_nomina_comisiones set servicio = trim(p_c ->> 'servicio'), precio = nullif(p_c ->> 'precio', '')::numeric,
      comision = (p_c ->> 'comision')::numeric, alias = coalesce((select array_agg(x) from jsonb_array_elements_text(p_c -> 'alias') x), '{}'), updated_at = now()
    where id = (p_c ->> 'id')::bigint returning * into v_row;
  end if;
  return to_jsonb(v_row);
end $$;
revoke all on function public.pc_nomina_guardar_comision(uuid, jsonb) from public, anon;
grant execute on function public.pc_nomina_guardar_comision(uuid, jsonb) to authenticated;
revoke all on function public.pc_nomina_datos(uuid) from public, anon;
grant execute on function public.pc_nomina_datos(uuid) to authenticated;
