-- M39 · Precio de producto desde el inventario (6 nov 2026)
-- Productos: el precio final es el del inventario. De ahi se calcula lo que queda:
-- quita ITBIS, comision de tarjeta, empaque por venta y costo del producto; sobre lo que
-- queda, la comision del colaborador (5%). Servicios: sin cambios (salen de su neto).
-- Montos de empaque y comision en pc_precios_config (editables). Sin datos de negocio en el repo.
alter table public.pc_precios_config add column if not exists empaque_por_venta numeric(10,2) not null default 13;
alter table public.pc_precios_config add column if not exists comision_colaborador numeric(6,2) not null default 5.00;
alter table public.pc_precios_items add column if not exists origen_precio text not null default 'neto';
alter table public.pc_precios_items drop constraint if exists pc_precios_items_neto_check;
-- Las recalculaciones por tasa solo tocan los precios que salen de un neto.
