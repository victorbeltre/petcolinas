-- ─────────────────────────────────────────────────────────────────────────────
-- M31 · Tarifario fijo de costos para comisiones de farmacia (31 oct 2026)
--
-- Victor: "dejalo guardado como tarifario fijo". Los productos que se venden
-- pero no tienen costo en el inventario (Tropiclean, Epiotic, NexGard...) no
-- pueden pagar el 5% de farmacia. Este tarifario guarda su costo unitario para
-- siempre, sin tocar el inventario. La app lo usa cuando el inventario no trae
-- costo; si el admin escribe un costo a mano en el historial, ese gana.
--
-- Igual que los sueldos y las comisiones (M29/M30): RLS sin politicas; solo se
-- lee y escribe con un pase de nomina. Los montos NO van en este archivo (el repo
-- es publico): se cargan aparte.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.pc_nomina_costos (
  id              bigint generated always as identity primary key,
  nombre          text not null,
  alias           text[] not null default '{}',
  costo_unitario  numeric(12,2) not null check (costo_unitario >= 0),
  notas           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.pc_nomina_costos enable row level security;
revoke all on public.pc_nomina_costos from anon, authenticated;

-- pc_nomina_datos ahora tambien devuelve el tarifario de costos.
create or replace function public.pc_nomina_datos(p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.pc_nomina_pase_ok(p_token);
  return jsonb_build_object(
    'empleados', coalesce((select jsonb_agg(to_jsonb(e) order by e.activo desc, e.nombre) from public.pc_nomina_empleados e), '[]'::jsonb),
    'movimientos', coalesce((select jsonb_agg(to_jsonb(m) order by m.fecha desc, m.id desc) from public.pc_nomina_movimientos m), '[]'::jsonb),
    'comisiones', coalesce((select jsonb_agg(to_jsonb(c) order by c.empleado_id, c.id) from public.pc_nomina_comisiones c), '[]'::jsonb),
    'costos', coalesce((select jsonb_agg(to_jsonb(k) order by k.nombre) from public.pc_nomina_costos k), '[]'::jsonb));
end $$;

-- Guarda (o borra, con p_c.borrar = true) un costo del tarifario.
create or replace function public.pc_nomina_guardar_costo(p_token uuid, p_c jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_row public.pc_nomina_costos;
begin
  perform public.pc_nomina_pase_ok(p_token);
  if coalesce((p_c ->> 'borrar')::boolean, false) then
    delete from public.pc_nomina_costos where id = (p_c ->> 'id')::bigint;
    return null;
  end if;
  if coalesce(trim(p_c ->> 'nombre'), '') = '' then raise exception 'Falta el nombre del producto'; end if;
  if (p_c ->> 'id') is null then
    insert into public.pc_nomina_costos (nombre, alias, costo_unitario, notas)
    values (trim(p_c ->> 'nombre'), coalesce((select array_agg(x) from jsonb_array_elements_text(p_c -> 'alias') x), '{}'),
            (p_c ->> 'costo_unitario')::numeric, p_c ->> 'notas')
    returning * into v_row;
  else
    update public.pc_nomina_costos set nombre = trim(p_c ->> 'nombre'),
      alias = coalesce((select array_agg(x) from jsonb_array_elements_text(p_c -> 'alias') x), '{}'),
      costo_unitario = (p_c ->> 'costo_unitario')::numeric, notas = p_c ->> 'notas', updated_at = now()
    where id = (p_c ->> 'id')::bigint returning * into v_row;
  end if;
  return to_jsonb(v_row);
end $$;
revoke all on function public.pc_nomina_datos(uuid) from public, anon;
grant execute on function public.pc_nomina_datos(uuid) to authenticated;
revoke all on function public.pc_nomina_guardar_costo(uuid, jsonb) from public, anon;
grant execute on function public.pc_nomina_guardar_costo(uuid, jsonb) to authenticated;
