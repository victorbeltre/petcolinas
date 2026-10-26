-- ─────────────────────────────────────────────────────────────────────────────
-- M23 · Inventario cargado desde la factura del proveedor (26 oct 2026)
--
-- Victor pidio empezar el inventario de cero y cargarlo desde la foto de la
-- factura de cada proveedor: nombre, descripcion, cantidad comprada, categoria y
-- un CODIGO UNICO por producto.
--
-- 1) pc_inventario gana `codigo` y `descripcion`. El codigo lo pone la BASE, no
--    el navegador: dos personas cargando facturas a la vez desde dos telefonos
--    sacarian el mismo numero si se calculara en la app. Formato PREFIJO-00001,
--    con el prefijo segun la categoria (MED, ALI, ACC, HIG, INS, PAP, OTR) y un
--    solo contador para todos, asi que un numero nunca se repite aunque el
--    producto cambie de categoria. Una vez puesto no cambia.
-- 2) pc_compras guarda cada factura cargada (proveedor, numero, NCF, fecha,
--    total y las lineas tal como se aprobaron), para saber de donde salio cada
--    unidad. Solo-admin: tiene costos.
--
-- El inventario que ya existia NO se toca (decision de Victor, 26 oct): los
-- productos viejos no tienen codigo hasta que se editan o se les suma una
-- compra; ahi el trigger les asigna uno. Antes de aplicar se copio la tabla a
-- `respaldos.pc_inventario_20261026` (esquema no expuesto, Regla Critica 6.3).
-- Sin datos de clientes en el archivo: solo estructura.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.pc_inventario add column if not exists codigo text;
alter table public.pc_inventario add column if not exists descripcion text;
create unique index if not exists pc_inventario_codigo_uk on public.pc_inventario (codigo) where codigo is not null;

create sequence if not exists public.pc_inventario_codigo_seq;
revoke all on sequence public.pc_inventario_codigo_seq from anon, authenticated;

create or replace function public.pc_inv_prefijo(cat text) returns text
language sql immutable set search_path = '' as $$
  select case lower(coalesce(cat, ''))
    when 'farmaco'   then 'MED'
    when 'alimento'  then 'ALI'
    when 'accesorio' then 'ACC'
    when 'higiene'   then 'HIG'
    when 'insumo'    then 'INS'
    when 'papeleria' then 'PAP'
    else 'OTR' end
$$;

-- SECURITY DEFINER solo para poder tomar el siguiente numero de la secuencia sin
-- darle permiso directo sobre ella al personal. No es invocable por la API
-- (es un trigger) y no lee nada mas.
create or replace function public.pc_inv_codigo() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and coalesce(old.codigo, '') <> '' then
    new.codigo := old.codigo;            -- el codigo no cambia nunca
  elsif coalesce(new.codigo, '') = '' then
    new.codigo := public.pc_inv_prefijo(new.categoria) || '-' ||
                  lpad(nextval('public.pc_inventario_codigo_seq')::text, 5, '0');
  end if;
  return new;
end $$;
revoke all on function public.pc_inv_codigo() from public, anon, authenticated;

drop trigger if exists pc_inventario_codigo on public.pc_inventario;
create trigger pc_inventario_codigo before insert or update on public.pc_inventario
  for each row execute function public.pc_inv_codigo();

create table if not exists public.pc_compras (
  id            bigint generated always as identity primary key,
  fecha         date not null default current_date,
  proveedor     text,
  numero        text,
  ncf           text,
  total         numeric(12,2),
  items         jsonb not null default '[]'::jsonb,
  registrado_por text,
  created_at    timestamptz not null default now()
);
-- Regla Critica 6: RLS en la misma migracion.
alter table public.pc_compras enable row level security;
revoke all on public.pc_compras from anon;
grant select, insert on public.pc_compras to authenticated;
drop policy if exists pc_compras_admin on public.pc_compras;
create policy pc_compras_admin on public.pc_compras for all to authenticated
  using ((select public.pc_es_admin())) with check ((select public.pc_es_admin()));
