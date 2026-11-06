-- M38 · ITBIS por producto (6 nov 2026)
-- Exentos: medicamentos, suplementos, desparasitantes y calmantes (categoria farmaco).
-- Llevan ITBIS: accesorios, alimentos, higiene (incluidos spray, shampoo y limpiador auricular), insumos, papeleria y servicios.
-- Sin montos de negocio aqui. La lista de precios hereda el ITBIS del producto.
alter table public.pc_inventario add column if not exists itbis boolean;
update public.pc_inventario set itbis = false where categoria = 'farmaco';
update public.pc_inventario set itbis = true where categoria = 'farmaco' and (lower(nombre) like '%spray%' or lower(nombre) like '%shampoo%' or lower(nombre) like '%limpiador%');
update public.pc_inventario set itbis = true where itbis is null;
