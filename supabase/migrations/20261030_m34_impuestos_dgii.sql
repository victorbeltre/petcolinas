-- ============================================================================
--  M34 · Impuestos DGII sin contable: 606, IT-1 (con Anexo A) e IR-17 (30 oct 2026)
--
--  Decisión de Victor: sacar al contable y a Alegra de la ecuación. La app
--  arma cada mes lo que PetColinas declara en la Oficina Virtual:
--    · 606 (compras y gastos con NCF) → archivo TXT con el formato de la
--      Norma 07-2018. Vence el 15 del mes siguiente. Como emisor electrónico,
--      PetColinas ya NO envía 607 ni 608 (la DGII los arma con los e-CF).
--    · IT-1 (ITBIS) → hoja con las casillas y el desglose del Anexo A. Vence el 20.
--    · IR-17 (retenciones de ISR) → retención a personas físicas, sobre todo el
--      alquiler del local (15 % desde la Ley 30-26; configurable). Vence el 10.
--  La DGII no tiene API para declarar: Victor sube el TXT y copia las casillas.
--
--  Datos fiscales:
--    · pc_gastos y pc_cuentas_pagar ganan RNC, NCF, tipo de bien/servicio
--      (1-11 del 606), ITBIS facturado y retenciones. Se editan desde la
--      pestaña Impuestos con pc_gasto_fiscal / pc_cxp_fiscal (solo admin), así
--      el guardado normal de Gastos (upsert desde el navegador) no los pisa.
--    · Los gastos de categoría "Proveedores" son pagos de cuentas por pagar:
--      la factura ya está en pc_cuentas_pagar y no se cuenta dos veces.
-- ============================================================================

-- 1) Columnas fiscales ----------------------------------------------------------
alter table public.pc_gastos add column if not exists rnc text;
alter table public.pc_gastos add column if not exists ncf text;
alter table public.pc_gastos add column if not exists tipo_bienes smallint;
alter table public.pc_gastos add column if not exists itbis numeric(12,2) not null default 0;
alter table public.pc_gastos add column if not exists itbis_retenido numeric(12,2) not null default 0;
alter table public.pc_gastos add column if not exists tipo_retencion smallint;
alter table public.pc_gastos add column if not exists isr_retenido numeric(12,2) not null default 0;
alter table public.pc_gastos add column if not exists fiscal_excluir boolean not null default false;
alter table public.pc_gastos drop constraint if exists pc_gastos_tipo_bienes_check;
alter table public.pc_gastos add constraint pc_gastos_tipo_bienes_check check (tipo_bienes is null or tipo_bienes between 1 and 11);
alter table public.pc_gastos drop constraint if exists pc_gastos_tipo_retencion_check;
alter table public.pc_gastos add constraint pc_gastos_tipo_retencion_check check (tipo_retencion is null or tipo_retencion between 1 and 9);

alter table public.pc_cuentas_pagar add column if not exists tipo_bienes smallint;
alter table public.pc_cuentas_pagar add column if not exists itbis_retenido numeric(12,2) not null default 0;
alter table public.pc_cuentas_pagar add column if not exists tipo_retencion smallint;
alter table public.pc_cuentas_pagar add column if not exists isr_retenido numeric(12,2) not null default 0;
alter table public.pc_cuentas_pagar drop constraint if exists pc_cxp_tipo_bienes_check;
alter table public.pc_cuentas_pagar add constraint pc_cxp_tipo_bienes_check check (tipo_bienes is null or tipo_bienes between 1 and 11);
alter table public.pc_cuentas_pagar drop constraint if exists pc_cxp_tipo_retencion_check;
alter table public.pc_cuentas_pagar add constraint pc_cxp_tipo_retencion_check check (tipo_retencion is null or tipo_retencion between 1 and 9);

insert into public.pc_config (clave, valor, nota) values
  ('ir17_pct_alquiler_pf', '15', '% de ISR que se retiene al pagar alquiler a una persona física (Ley 30-26). Va en el IR-17.'),
  ('ir17_pct_honorarios_pf', '15', '% de ISR que se retiene al pagar honorarios/servicios a una persona física.'),
  ('itbis_pct_retencion_pf', '100', '% del ITBIS facturado por una persona física que se retiene (Norma 08-04).')
on conflict (clave) do nothing;

-- 2) Helpers --------------------------------------------------------------------
-- Forma de pago del 606: 1 efectivo, 2 cheque/transferencia/depósito,
-- 3 tarjeta, 4 a crédito, 5 permuta, 6 nota de crédito, 7 mixto.
create or replace function public.pc_606_forma_pago(p text)
returns smallint language sql immutable set search_path = '' as $$
  select case
    when p is null or btrim(p) = '' then 1
    when lower(p) ~ 'tarjeta' then 3
    when lower(p) ~ 'cr[eé]dito|pendiente' then 4
    when lower(p) ~ 'nota' then 6
    when lower(p) ~ 'permuta' then 5
    when lower(p) ~ 'mixto' then 7
    when lower(p) ~ 'transf|reservas|popular|banco|cheque|dep[oó]sito|bhd|scotia' then 2
    else 1 end::smallint;
$$;

-- Tipo de bien/servicio por defecto según la categoría del gasto.
create or replace function public.pc_606_tipo_defecto(p_categoria text)
returns smallint language sql immutable set search_path = '' as $$
  select case
    when lower(coalesce(p_categoria, '')) ~ 'alquiler' then 3
    when lower(coalesce(p_categoria, '')) ~ 'inventario|mercanc|compra' then 9
    when lower(coalesce(p_categoria, '')) ~ 'equipo|inversion|inversión|activo' then 10
    when lower(coalesce(p_categoria, '')) ~ 'seguro' then 11
    when lower(coalesce(p_categoria, '')) ~ 'banco|interes|interés|financ' then 7
    when lower(coalesce(p_categoria, '')) ~ 'servicio|insumo|publicidad|limpieza|operativ' then 2
    else 6 end::smallint;
$$;

create or replace function public.pc_dia_habil(p date)
returns date language sql immutable set search_path = '' as $$
  select case extract(isodow from p) when 6 then p + 2 when 7 then p + 1 else p end;
$$;

revoke all on function public.pc_606_forma_pago(text) from public, anon;
revoke all on function public.pc_606_tipo_defecto(text) from public, anon;
revoke all on function public.pc_dia_habil(date) from public, anon;
grant execute on function public.pc_606_forma_pago(text), public.pc_606_tipo_defecto(text), public.pc_dia_habil(date) to authenticated;

-- 3) Editar los datos fiscales (solo admin) -----------------------------------
create or replace function public.pc_gasto_fiscal(p_id text, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g public.pc_gastos;
begin
  if not public.pc_es_admin() then
    raise exception using errcode = '42501', message = 'Solo la administración edita los datos fiscales.';
  end if;
  update public.pc_gastos set
    rnc = case when p ? 'rnc' then nullif(regexp_replace(coalesce(p ->> 'rnc', ''), '[^0-9]', '', 'g'), '') else rnc end,
    ncf = case when p ? 'ncf' then nullif(upper(regexp_replace(coalesce(p ->> 'ncf', ''), '\s', '', 'g')), '') else ncf end,
    tipo_bienes = case when p ? 'tipo_bienes' then nullif(p ->> 'tipo_bienes', '')::smallint else tipo_bienes end,
    itbis = case when p ? 'itbis' then coalesce(nullif(p ->> 'itbis', '')::numeric, 0) else itbis end,
    itbis_retenido = case when p ? 'itbis_retenido' then coalesce(nullif(p ->> 'itbis_retenido', '')::numeric, 0) else itbis_retenido end,
    tipo_retencion = case when p ? 'tipo_retencion' then nullif(p ->> 'tipo_retencion', '')::smallint else tipo_retencion end,
    isr_retenido = case when p ? 'isr_retenido' then coalesce(nullif(p ->> 'isr_retenido', '')::numeric, 0) else isr_retenido end,
    fiscal_excluir = case when p ? 'fiscal_excluir' then coalesce((p ->> 'fiscal_excluir')::boolean, false) else fiscal_excluir end
  where id = p_id
  returning * into g;
  if not found then raise exception using errcode = 'P0002', message = 'El gasto no existe.'; end if;
  if g.rnc is not null and length(g.rnc) not in (9, 11) then
    raise exception using errcode = '22023', message = 'El RNC tiene 9 dígitos y la cédula 11.';
  end if;
  if g.ncf is not null and g.ncf !~ '^(B[0-9]{10}|E[0-9]{12})$' then
    raise exception using errcode = '22023', message = 'El NCF es B + 10 dígitos (B0100000123) o E + 12 dígitos (E310000000123).';
  end if;
  if g.itbis < 0 or g.itbis > g.monto then
    raise exception using errcode = '22023', message = 'El ITBIS no puede pasar del monto del gasto.';
  end if;
  return to_jsonb(g);
end $$;
revoke all on function public.pc_gasto_fiscal(text, jsonb) from public, anon;
grant execute on function public.pc_gasto_fiscal(text, jsonb) to authenticated;

create or replace function public.pc_cxp_fiscal(p_id bigint, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.pc_cuentas_pagar;
begin
  if not public.pc_es_admin() then
    raise exception using errcode = '42501', message = 'Solo la administración edita los datos fiscales.';
  end if;
  update public.pc_cuentas_pagar set
    identificacion = case when p ? 'rnc' then nullif(regexp_replace(coalesce(p ->> 'rnc', ''), '[^0-9]', '', 'g'), '') else identificacion end,
    ncf = case when p ? 'ncf' then nullif(upper(regexp_replace(coalesce(p ->> 'ncf', ''), '\s', '', 'g')), '') else ncf end,
    tipo_bienes = case when p ? 'tipo_bienes' then nullif(p ->> 'tipo_bienes', '')::smallint else tipo_bienes end,
    itbis = case when p ? 'itbis' then coalesce(nullif(p ->> 'itbis', '')::numeric, 0) else itbis end,
    itbis_retenido = case when p ? 'itbis_retenido' then coalesce(nullif(p ->> 'itbis_retenido', '')::numeric, 0) else itbis_retenido end,
    tipo_retencion = case when p ? 'tipo_retencion' then nullif(p ->> 'tipo_retencion', '')::smallint else tipo_retencion end,
    isr_retenido = case when p ? 'isr_retenido' then coalesce(nullif(p ->> 'isr_retenido', '')::numeric, 0) else isr_retenido end,
    updated_at = now()
  where id = p_id
  returning * into c;
  if not found then raise exception using errcode = 'P0002', message = 'La cuenta por pagar no existe.'; end if;
  if c.ncf is not null and c.ncf !~ '^(B[0-9]{10}|E[0-9]{12})$' then
    raise exception using errcode = '22023', message = 'El NCF es B + 10 dígitos (B0100000123) o E + 12 dígitos (E310000000123).';
  end if;
  return to_jsonb(c);
end $$;
revoke all on function public.pc_cxp_fiscal(bigint, jsonb) from public, anon;
grant execute on function public.pc_cxp_fiscal(bigint, jsonb) to authenticated;

-- 4) Impuestos del mes ------------------------------------------------------------
-- Devuelve todo lo que se declara por un mes (p_mes = 'AAAA-MM'):
--   lineas_606, sin_comprobante, it1, ir17, vencimientos.
create or replace function public.pc_impuestos_mes(p_mes text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_ini date; v_fin date; v_sig date;
  v_rnc text := regexp_replace(coalesce((select valor from public.pc_config where clave = 'rnc'), ''), '[^0-9]', '', 'g');
  v_exentos jsonb := coalesce((select nullif(valor, '')::jsonb from public.pc_config where clave = 'ecf_exentos'), '[]'::jsonb);
  v_lineas jsonb; v_sin jsonb; v_ventas jsonb; v_formas jsonb; v_comp jsonb; v_notas jsonb; v_ir17 jsonb;
  v_total numeric; v_exento numeric; v_gravado numeric; v_base numeric; v_itbis numeric;
  v_itbis_compras numeric; v_itbis_ret numeric; v_nc_itbis numeric;
begin
  if not public.pc_es_admin() then
    raise exception using errcode = '42501', message = 'Solo la administración ve los impuestos.';
  end if;
  if p_mes !~ '^\d{4}-\d{2}$' then
    raise exception using errcode = '22023', message = 'Mes no válido (AAAA-MM).';
  end if;
  v_ini := (p_mes || '-01')::date; v_fin := (v_ini + interval '1 month')::date - 1; v_sig := v_fin + 1;

  -- Líneas del 606: gastos con NCF (menos los pagos de cuentas por pagar) +
  -- facturas de proveedor con NCF registradas en cuentas por pagar.
  with base as (
    select 'gasto'::text as origen, g.id::text as id, public.pc_fecha_txt(g.fecha) as fecha, g.proveedor, g.descripcion,
           g.rnc, g.ncf, coalesce(g.tipo_bienes, public.pc_606_tipo_defecto(g.categoria)) as tipo_bienes,
           coalesce(g.monto, 0) as total, coalesce(g.itbis, 0) as itbis, coalesce(g.itbis_retenido, 0) as itbis_retenido,
           g.tipo_retencion, coalesce(g.isr_retenido, 0) as isr_retenido,
           public.pc_fecha_txt(g.fecha) as fecha_pago, public.pc_606_forma_pago(g.formapago) as forma_pago
      from public.pc_gastos g
     where upper(coalesce(g.ncf, '')) ~ '^[BE][0-9]' and upper(g.ncf) !~ '^(B02|E32)' and not g.fiscal_excluir
       and lower(coalesce(g.categoria, '')) <> 'proveedores'
       and public.pc_fecha_txt(g.fecha) between v_ini and v_fin
       -- La misma factura ya está en cuentas por pagar: va una sola vez.
       and not exists (select 1 from public.pc_cuentas_pagar c2 where not c2.anulada and upper(c2.ncf) = upper(g.ncf))
    union all
    select 'cxp', c.id::text, c.fecha, c.proveedor, coalesce(c.numero, c.origen, c.tipo),
           c.identificacion, c.ncf,
           coalesce(c.tipo_bienes, case c.tipo when 'servicio' then 2 when 'otro' then 6 else 9 end)::smallint,
           coalesce(c.total, 0), coalesce(c.itbis, 0), coalesce(c.itbis_retenido, 0),
           c.tipo_retencion, coalesce(c.isr_retenido, 0),
           case when coalesce(c.pagado, 0) >= coalesce(c.total, 0) - 0.004
                then (select max((p ->> 'fecha')::date) from jsonb_array_elements(coalesce(c.pagos, '[]'::jsonb)) p where p ->> 'fecha' ~ '^\d{4}-\d{2}-\d{2}') end,
           case when coalesce(c.pagado, 0) >= coalesce(c.total, 0) - 0.004
                then public.pc_606_forma_pago((select p ->> 'metodo' from jsonb_array_elements(coalesce(c.pagos, '[]'::jsonb)) p order by p ->> 'fecha' desc nulls last limit 1))
                else 4 end::smallint
      from public.pc_cuentas_pagar c
     where not c.anulada and upper(coalesce(c.ncf, '')) ~ '^[BE][0-9]' and upper(c.ncf) !~ '^(B02|E32)'
       and c.fecha between v_ini and v_fin
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'origen', b.origen, 'id', b.id, 'proveedor', b.proveedor, 'descripcion', b.descripcion,
      'rnc', regexp_replace(coalesce(b.rnc, ''), '[^0-9]', '', 'g'),
      'tipo_id', case when length(regexp_replace(coalesce(b.rnc, ''), '[^0-9]', '', 'g')) = 11 then 2 else 1 end,
      'tipo_bienes', b.tipo_bienes, 'ncf', upper(b.ncf), 'ncf_modificado', '',
      'fecha', to_char(b.fecha, 'YYYYMMDD'), 'fecha_pago', coalesce(to_char(b.fecha_pago, 'YYYYMMDD'), ''),
      'monto_servicios', case when b.tipo_bienes in (9, 10) then 0 else round(b.total - b.itbis, 2) end,
      'monto_bienes', case when b.tipo_bienes in (9, 10) then round(b.total - b.itbis, 2) else 0 end,
      'monto_total', round(b.total - b.itbis, 2),
      'itbis', round(b.itbis, 2), 'itbis_retenido', round(b.itbis_retenido, 2),
      'itbis_proporcionalidad', 0, 'itbis_costo', 0, 'itbis_adelantar', round(b.itbis, 2),
      'itbis_percibido', 0,
      'tipo_retencion', b.tipo_retencion, 'isr_retenido', round(b.isr_retenido, 2), 'isr_percibido', 0,
      'isc', 0, 'otros_impuestos', 0, 'propina', 0, 'forma_pago', b.forma_pago,
      'avisos', to_jsonb(array_remove(array[
         case when length(regexp_replace(coalesce(b.rnc, ''), '[^0-9]', '', 'g')) not in (9, 11) then 'Falta el RNC o la cédula del proveedor.' end,
         case when upper(b.ncf) !~ '^(B[0-9]{10}|E[0-9]{12})$' then 'El NCF no tiene el formato de la DGII.' end,
         case when (b.isr_retenido > 0 or b.itbis_retenido > 0) and b.fecha_pago is null then 'Tiene retención pero no está pagada: la DGII exige la fecha de pago.' end,
         case when b.isr_retenido > 0 and b.tipo_retencion is null then 'Falta el tipo de retención de ISR.' end
       ], null))
    ) order by b.fecha, b.ncf), '[]'::jsonb)
    into v_lineas
    from base b;

  -- Gastos y facturas de proveedor del mes que NO entran al 606: sin NCF
  -- (no se pueden deducir) o con NCF de consumo B02/E32 (tampoco dan crédito).
  select coalesce(jsonb_agg(x order by (x ->> 'monto')::numeric desc), '[]'::jsonb) into v_sin from (
    select jsonb_build_object('origen', 'gasto', 'id', g.id, 'fecha', g.fecha, 'proveedor', g.proveedor, 'descripcion', g.descripcion,
             'categoria', g.categoria, 'monto', g.monto, 'ncf', g.ncf, 'rnc', g.rnc, 'itbis', g.itbis,
             'isr_retenido', g.isr_retenido, 'tipo_retencion', g.tipo_retencion,
             'tipo_bienes', coalesce(g.tipo_bienes, public.pc_606_tipo_defecto(g.categoria)),
             'motivo', case when upper(coalesce(g.ncf, '')) ~ '^(B02|E32)' then 'consumo' else 'sin_ncf' end) as x
      from public.pc_gastos g
     where (upper(coalesce(g.ncf, '')) !~ '^[BE][0-9]' or upper(g.ncf) ~ '^(B02|E32)') and not g.fiscal_excluir
       and lower(coalesce(g.categoria, '')) not in ('proveedores', 'nomina', 'nómina')
       -- Pagar impuestos (ITBIS, IR-17, TSS) no es una compra: no lleva NCF.
       and coalesce(g.proveedor, '') !~* '^\s*(dgii|tss|tesorer)'
       and coalesce(g.descripcion, '') !~* 'pago (de |del )?(itbis|ir-?1[37]|isr|anticipo|tss|impuesto)'
       and public.pc_fecha_txt(g.fecha) between v_ini and v_fin
    union all
    select jsonb_build_object('origen', 'cxp', 'id', c.id::text, 'fecha', c.fecha, 'proveedor', c.proveedor, 'descripcion', coalesce(c.numero, c.origen, c.tipo),
             'categoria', 'Cuenta por pagar', 'monto', c.total, 'ncf', c.ncf, 'rnc', c.identificacion, 'itbis', c.itbis,
             'isr_retenido', c.isr_retenido, 'tipo_retencion', c.tipo_retencion,
             'tipo_bienes', coalesce(c.tipo_bienes, case c.tipo when 'servicio' then 2 when 'otro' then 6 else 9 end),
             'motivo', case when upper(coalesce(c.ncf, '')) ~ '^(B02|E32)' then 'consumo' else 'sin_ncf' end)
      from public.pc_cuentas_pagar c
     where not c.anulada and c.tipo <> 'prestamo'
       and (upper(coalesce(c.ncf, '')) !~ '^[BE][0-9]' or upper(c.ncf) ~ '^(B02|E32)')
       and c.fecha between v_ini and v_fin) q;

  -- IT-1: ventas del mes (la fuente de ingresos de la app es pc_ventas).
  select coalesce(sum(v.total), 0),
         coalesce(sum(v.total) filter (where exists (select 1 from jsonb_array_elements_text(v_exentos) e
               where lower(coalesce(v.servicio, '') || ' ' || coalesce(v.descripcion, '')) like '%' || lower(e) || '%')), 0)
    into v_total, v_exento
    from public.pc_ventas v
   where public.pc_fecha_txt(v.fecha) between v_ini and v_fin;
  v_gravado := v_total - v_exento;
  v_base := round(v_gravado / 1.18, 2);
  v_itbis := v_gravado - v_base;

  select coalesce(jsonb_object_agg(forma, monto), '{}'::jsonb) into v_formas from (
    select case
      when lower(coalesce(v.formapago, '')) ~ 'tarjeta' then 'tarjeta'
      when lower(coalesce(v.formapago, '')) ~ 'pendiente|cr[eé]dito' then 'credito'
      when lower(coalesce(v.formapago, '')) ~ 'sin cobro' then 'sin_cobro'
      when lower(coalesce(v.formapago, '')) ~ 'transf|reservas|popular|banco|dep' then 'transferencia'
      else 'efectivo' end as forma, sum(v.total) as monto
    from public.pc_ventas v where public.pc_fecha_txt(v.fecha) between v_ini and v_fin group by 1) x;

  select coalesce(jsonb_object_agg(tipo, monto), '{}'::jsonb) into v_comp from (
    select f.ncftipo as tipo, sum(f.total) as monto from public.pc_facturas f
     where coalesce(f.ncf, '') <> '' and coalesce(f.estado, '') <> 'anulada'
       and public.pc_fecha_txt(f.fecha) between v_ini and v_fin group by 1) x;

  select jsonb_build_object('cantidad', count(*), 'total', coalesce(sum(n.total), 0), 'itbis', coalesce(sum(n.itbis), 0)),
         coalesce(sum(n.itbis), 0)
    into v_notas, v_nc_itbis
    from public.pc_notas_credito n where n.fecha between v_ini and v_fin;

  select coalesce(sum((l ->> 'itbis_adelantar')::numeric), 0), coalesce(sum((l ->> 'itbis_retenido')::numeric), 0)
    into v_itbis_compras, v_itbis_ret from jsonb_array_elements(v_lineas) l;

  -- IR-17: retenciones de ISR hechas en el mes (por fecha de pago), con o sin NCF.
  select coalesce(jsonb_agg(jsonb_build_object('tipo_retencion', t, 'monto', m, 'base', b, 'cantidad', n) order by t), '[]'::jsonb)
    into v_ir17 from (
      select coalesce(tipo_retencion, 0) as t, sum(isr) as m, sum(base) as b, count(*) as n from (
        select g.tipo_retencion, g.isr_retenido as isr, g.monto - coalesce(g.itbis, 0) as base from public.pc_gastos g
         where g.isr_retenido > 0 and not g.fiscal_excluir and public.pc_fecha_txt(g.fecha) between v_ini and v_fin
        union all
        select c.tipo_retencion, c.isr_retenido, c.total - coalesce(c.itbis, 0) from public.pc_cuentas_pagar c
         where c.isr_retenido > 0 and not c.anulada
           and (select max((p ->> 'fecha')::date) from jsonb_array_elements(coalesce(c.pagos, '[]'::jsonb)) p where p ->> 'fecha' ~ '^\d{4}-\d{2}-\d{2}') between v_ini and v_fin
      ) r group by 1) y;

  return jsonb_build_object(
    'mes', p_mes, 'rnc', v_rnc,
    'lineas_606', v_lineas,
    'sin_comprobante', v_sin,
    'it1', jsonb_build_object(
      'ventas_total', v_total, 'ventas_exentas', v_exento, 'ventas_gravadas', v_gravado,
      'base_gravada', v_base, 'itbis_cobrado', v_itbis,
      'notas_credito', v_notas, 'itbis_notas_credito', v_nc_itbis,
      'itbis_compras', v_itbis_compras, 'itbis_retenido_a_proveedores', v_itbis_ret,
      'por_forma_pago', v_formas, 'por_comprobante', v_comp,
      'ventas_con_comprobante', coalesce((select sum(value::numeric) from jsonb_each_text(v_comp)), 0)),
    'ir17', v_ir17,
    'vencimientos', jsonb_build_object(
      'ir17', public.pc_dia_habil(v_sig + 9), 'f606', public.pc_dia_habil(v_sig + 14), 'it1', public.pc_dia_habil(v_sig + 19)),
    'config', jsonb_build_object(
      'ir17_pct_alquiler_pf', (select valor from public.pc_config where clave = 'ir17_pct_alquiler_pf'),
      'ir17_pct_honorarios_pf', (select valor from public.pc_config where clave = 'ir17_pct_honorarios_pf'),
      'itbis_pct_retencion_pf', (select valor from public.pc_config where clave = 'itbis_pct_retencion_pf')));
end $$;
revoke all on function public.pc_impuestos_mes(text) from public, anon;
grant execute on function public.pc_impuestos_mes(text) to authenticated;
