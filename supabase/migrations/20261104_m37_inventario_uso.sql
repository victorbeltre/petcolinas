-- M37 · Uso de cada producto del inventario (5 nov 2026)
-- venta (se vende al cliente), consulta (se usa en la consulta veterinaria) u operacion
-- (se consume en la clinica o en grooming: papel, maquinilla, champu de grooming...).
-- Se clasifica a mano en Inventario o con "Organizar automaticamente". Sin datos de negocio aqui.
alter table public.pc_inventario add column if not exists uso text
  check (uso in ('venta','consulta','operacion'));
update public.pc_inventario set uso = case categoria when 'farmaco' then 'consulta'
  when 'insumo' then 'operacion' when 'papeleria' then 'operacion' else 'venta' end
 where codigo is not null and codigo <> '' and uso is null;
