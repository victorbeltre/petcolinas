-- M36 · Precios: la comision de tarjeta se cobra sobre el TOTAL (incluido ITBIS).
-- precio sin ITBIS = neto / (1 - costo_tarjeta x 1.18) si lleva ITBIS; neto / (1 - costo_tarjeta) si es exento.
-- Sin esta correccion el precio quedaba ~1% corto. Recalcula todos los items.
create or replace function public.pc_precios_calcular(p_neto numeric, p_itbis boolean) returns table (sin_itbis numeric, total numeric) language sql stable security definer set search_path = '' as $$
  select s.sin_itbis, round(s.sin_itbis * case when p_itbis then 1.18 else 1 end, 2)
  from (select round(p_neto / (1 - ((c.comision_tarjeta + case when c.retencion_recuperable then 0 else c.retencion_itbis end) / 100.0) * case when p_itbis then 1.18 else 1 end), 2) as sin_itbis
        from public.pc_precios_config c where c.id = 1) s;
$$;
update public.pc_precios_items i set precio_sin_itbis = c.sin_itbis, precio_total = c.total, updated_at = now()
from (select it.id, calc.sin_itbis, calc.total from public.pc_precios_items it cross join lateral public.pc_precios_calcular(it.neto, it.itbis) calc) c
where c.id = i.id;
