-- VetMake · Fase 1: patrón multi-tenant para las tablas operativas restantes
--
-- Requiere que 0001_negocios_y_membresia.sql ya se haya aplicado y que las
-- seis tablas existan con la estructura de PetColinas. Este archivo no crea
-- tablas desde cero: agrega únicamente la frontera de negocio_id y reemplaza
-- las políticas de un solo negocio.
--
-- En el código actual, la tabla que representa nómina es pc_empleados. El
-- prompt inicial la llamaba pc_nomina; no se inventa una tabla nueva para
-- resolver esa diferencia.
--
-- Igual que 0002, la migración está pensada para el proyecto VetMake vacío.
-- Si se aplica sobre tablas con datos, hay que hacer el backfill de negocio_id
-- antes de ejecutar el ALTER COLUMN ... SET NOT NULL.

-- ─── pc_ventas ────────────────────────────────────────────────────────────
alter table pc_ventas
  add column negocio_id uuid references negocios(id);

alter table pc_ventas
  alter column negocio_id set not null;

create index on pc_ventas (negocio_id);

drop policy if exists "pc_auth_all" on pc_ventas;
drop policy if exists "pc_ventas all" on pc_ventas;
drop policy if exists "pc_ventas delete" on pc_ventas;

create policy "negocio_lee_sus_ventas"
  on pc_ventas
  for select
  to authenticated
  using (negocio_id = mi_negocio());

create policy "negocio_escribe_sus_ventas"
  on pc_ventas
  for insert
  to authenticated
  with check (negocio_id = mi_negocio());

create policy "negocio_actualiza_sus_ventas"
  on pc_ventas
  for update
  to authenticated
  using (negocio_id = mi_negocio())
  with check (negocio_id = mi_negocio());

create policy "negocio_borra_sus_ventas"
  on pc_ventas
  for delete
  to authenticated
  using (negocio_id = mi_negocio());

-- ─── pc_facturas ──────────────────────────────────────────────────────────
alter table pc_facturas
  add column negocio_id uuid references negocios(id);

alter table pc_facturas
  alter column negocio_id set not null;

create index on pc_facturas (negocio_id);

drop policy if exists "pc_auth_all" on pc_facturas;
drop policy if exists "pc_facturas all" on pc_facturas;
drop policy if exists "pc_facturas delete" on pc_facturas;

create policy "negocio_lee_sus_facturas"
  on pc_facturas
  for select
  to authenticated
  using (negocio_id = mi_negocio());

create policy "negocio_escribe_sus_facturas"
  on pc_facturas
  for insert
  to authenticated
  with check (negocio_id = mi_negocio());

create policy "negocio_actualiza_sus_facturas"
  on pc_facturas
  for update
  to authenticated
  using (negocio_id = mi_negocio())
  with check (negocio_id = mi_negocio());

create policy "negocio_borra_sus_facturas"
  on pc_facturas
  for delete
  to authenticated
  using (negocio_id = mi_negocio());

-- ─── pc_inventario ────────────────────────────────────────────────────────
alter table pc_inventario
  add column negocio_id uuid references negocios(id);

alter table pc_inventario
  alter column negocio_id set not null;

create index on pc_inventario (negocio_id);

drop policy if exists "pc_auth_all" on pc_inventario;
drop policy if exists "pc_inventario all" on pc_inventario;
drop policy if exists "pc_inventario delete" on pc_inventario;

create policy "negocio_lee_su_inventario"
  on pc_inventario
  for select
  to authenticated
  using (negocio_id = mi_negocio());

create policy "negocio_escribe_su_inventario"
  on pc_inventario
  for insert
  to authenticated
  with check (negocio_id = mi_negocio());

create policy "negocio_actualiza_su_inventario"
  on pc_inventario
  for update
  to authenticated
  using (negocio_id = mi_negocio())
  with check (negocio_id = mi_negocio());

create policy "negocio_borra_su_inventario"
  on pc_inventario
  for delete
  to authenticated
  using (negocio_id = mi_negocio());

-- ─── pc_empleados (nómina) ────────────────────────────────────────────────
alter table pc_empleados
  add column negocio_id uuid references negocios(id);

alter table pc_empleados
  alter column negocio_id set not null;

create index on pc_empleados (negocio_id);

drop policy if exists "pc_auth_all" on pc_empleados;
drop policy if exists "pc_empleados all" on pc_empleados;
drop policy if exists "pc_empleados delete" on pc_empleados;

create policy "negocio_lee_sus_empleados"
  on pc_empleados
  for select
  to authenticated
  using (negocio_id = mi_negocio());

create policy "negocio_escribe_sus_empleados"
  on pc_empleados
  for insert
  to authenticated
  with check (negocio_id = mi_negocio());

create policy "negocio_actualiza_sus_empleados"
  on pc_empleados
  for update
  to authenticated
  using (negocio_id = mi_negocio())
  with check (negocio_id = mi_negocio());

create policy "negocio_borra_sus_empleados"
  on pc_empleados
  for delete
  to authenticated
  using (negocio_id = mi_negocio());

-- ─── pc_gastos ────────────────────────────────────────────────────────────
alter table pc_gastos
  add column negocio_id uuid references negocios(id);

alter table pc_gastos
  alter column negocio_id set not null;

create index on pc_gastos (negocio_id);

drop policy if exists "pc_auth_all" on pc_gastos;
drop policy if exists "pc_gastos all" on pc_gastos;
drop policy if exists "pc_gastos delete" on pc_gastos;

create policy "negocio_lee_sus_gastos"
  on pc_gastos
  for select
  to authenticated
  using (negocio_id = mi_negocio());

create policy "negocio_escribe_sus_gastos"
  on pc_gastos
  for insert
  to authenticated
  with check (negocio_id = mi_negocio());

create policy "negocio_actualiza_sus_gastos"
  on pc_gastos
  for update
  to authenticated
  using (negocio_id = mi_negocio())
  with check (negocio_id = mi_negocio());

create policy "negocio_borra_sus_gastos"
  on pc_gastos
  for delete
  to authenticated
  using (negocio_id = mi_negocio());

-- ─── pc_citas ─────────────────────────────────────────────────────────────
alter table pc_citas
  add column negocio_id uuid references negocios(id);

alter table pc_citas
  alter column negocio_id set not null;

create index on pc_citas (negocio_id);

drop policy if exists "pc_auth_all" on pc_citas;
drop policy if exists "pc_citas all" on pc_citas;
drop policy if exists "pc_citas delete" on pc_citas;

create policy "negocio_lee_sus_citas"
  on pc_citas
  for select
  to authenticated
  using (negocio_id = mi_negocio());

create policy "negocio_escribe_sus_citas"
  on pc_citas
  for insert
  to authenticated
  with check (negocio_id = mi_negocio());

create policy "negocio_actualiza_sus_citas"
  on pc_citas
  for update
  to authenticated
  using (negocio_id = mi_negocio())
  with check (negocio_id = mi_negocio());

create policy "negocio_borra_sus_citas"
  on pc_citas
  for delete
  to authenticated
  using (negocio_id = mi_negocio());
