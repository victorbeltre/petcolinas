-- ============================================================================
--  M32 · e-CF con precios que YA incluyen ITBIS (30 oct 2026)
--
--  Las facturas de PetColinas se guardan con itbis = false porque el tarifario
--  ya trae el ITBIS dentro del precio. Mandarlas a la DGII como "exentas" sería
--  declarar mal: la DGII considera gravados los servicios veterinarios (respuesta
--  oficial en su Comunidad de Ayuda) y el grooming no tiene exención.
--  El documento e-CF ahora:
--    · marca IndicadorMontoGravado = 1 (precios con ITBIS incluido) y calcula
--      base = monto / 1.18, ITBIS = monto - base;
--    · deja exentas solo las líneas cuya descripción contiene una palabra de
--      pc_config.ecf_exentos (lista JSON que define Victor);
--    · se puede volver al modo "exento" poniendo ecf_precios_incluyen_itbis = 'no'.
-- ============================================================================
insert into public.pc_config (clave, valor, nota) values
  ('ecf_precios_incluyen_itbis', 'si', 'si = los precios de la factura ya traen el ITBIS 18% (e-CF con IndicadorMontoGravado 1).'),
  ('ecf_exentos', '[]', 'Palabras (JSON) de productos exentos de ITBIS en el e-CF. Ej.: ["alimento"]. Confirmar cada uno con la DGII.')
on conflict (clave) do nothing;

create or replace function public.pc_ecf_documento(p_clase text, p_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  f public.pc_facturas; nc public.pc_notas_credito; fo public.pc_facturas; sec public.pc_ncf_secuencias;
  v_rnc text := regexp_replace(coalesce((select valor from public.pc_config where clave = 'rnc'), ''), '[^0-9]', '', 'g');
  v_razon text := coalesce((select nullif(btrim(valor), '') from public.pc_config where clave = 'razon_social'), 'PetColinas SRL');
  v_dir text := coalesce((select nullif(btrim(valor), '') from public.pc_config where clave = 'direccion'), 'Santo Domingo Oeste');
  v_tipo text; v_encf text; v_fecha date; v_rnc_comp text; v_nombre_comp text;
  v_items jsonb := '[]'::jsonb; v_iddoc jsonb; v_totales jsonb; v_comprador jsonb; v_ref jsonb;
  v_gravado boolean; v_sub numeric; v_itbis numeric; v_total numeric; v_credito boolean;
  linea jsonb; i integer := 0; v_monto numeric; v_bruto numeric; v_item jsonb;
  v_incluido boolean := coalesce((select lower(valor) from public.pc_config where clave = 'ecf_precios_incluyen_itbis'), 'si') = 'si';
  v_exentos jsonb := coalesce((select nullif(valor, '')::jsonb from public.pc_config where clave = 'ecf_exentos'), '[]'::jsonb);
  v_grav_incl numeric := 0; v_exento numeric := 0; v_linea_grav boolean; v_indicador integer := 0; v_desc text;
begin
  if v_rnc !~ '^([0-9]{9}|[0-9]{11})$' then
    raise exception using errcode = '22023', message = 'Falta el RNC de PetColinas en Datos fiscales.';
  end if;
  if p_clase = 'factura' then
    select * into f from public.pc_facturas where id = p_id;
    if not found or coalesce(f.ncf, '') not like 'E%' then
      raise exception using errcode = 'P0002', message = 'La factura no tiene e-NCF.';
    end if;
    v_tipo := f.ncftipo; v_encf := f.ncf; v_fecha := coalesce(public.pc_fecha_txt(f.fecha), (now() at time zone 'America/Santo_Domingo')::date);
    v_rnc_comp := nullif(regexp_replace(coalesce(f.rnccliente, ''), '[^0-9]', '', 'g'), '');
    v_nombre_comp := nullif(btrim(coalesce(nullif(f.propietario, ''), f.mascota, '')), '');
    -- Dos formas de facturar en PetColinas:
    --   · itbis = true: el ITBIS se suma ENCIMA del precio (facturas viejas).
    --   · itbis = false (lo normal): los precios del tarifario YA incluyen el
    --     ITBIS (pc_config.ecf_precios_incluyen_itbis = 'si'). La DGII considera
    --     gravados los servicios veterinarios y de grooming; una línea es exenta
    --     solo si su descripción contiene una palabra de pc_config.ecf_exentos.
    v_gravado := coalesce(f.itbis, false);
    v_credito := f.estado = 'pendiente';
    if not v_gravado and v_incluido then v_indicador := 1; end if;
    for linea in select * from jsonb_array_elements(coalesce(nullif(f.items, '')::jsonb, '[]'::jsonb)) loop
      i := i + 1;
      v_desc := lower(coalesce(linea ->> 'descripcion', ''));
      v_linea_grav := (v_gravado or v_incluido)
        and not exists (select 1 from jsonb_array_elements_text(v_exentos) e where v_desc like '%' || lower(e) || '%');
      v_bruto := coalesce((linea ->> 'precio')::numeric, 0) * coalesce(nullif(linea ->> 'cantidad', '')::numeric, 1);
      v_monto := round(v_bruto * (1 - coalesce(nullif(linea ->> 'descuento', '')::numeric, 0) / 100), 2);
      if v_linea_grav then v_grav_incl := v_grav_incl + v_monto; else v_exento := v_exento + v_monto; end if;
      v_item := jsonb_build_object(
        'NumeroLinea', i,
        'IndicadorFacturacion', case when v_linea_grav then 1 else 4 end,
        'NombreItem', left(coalesce(nullif(btrim(linea ->> 'descripcion'), ''), 'Servicio'), 80),
        'IndicadorBienoServicio', case when coalesce((linea ->> 'bien')::boolean, false) then 1 else 2 end,
        'CantidadItem', coalesce(nullif(linea ->> 'cantidad', '')::numeric, 1),
        'PrecioUnitarioItem', round(coalesce((linea ->> 'precio')::numeric, 0), 2),
        'MontoItem', v_monto);
      if v_bruto - v_monto > 0 then v_item := v_item || jsonb_build_object('DescuentoMonto', round(v_bruto - v_monto, 2)); end if;
      v_items := v_items || v_item;
    end loop;
    if v_indicador = 1 then
      -- Precios con ITBIS incluido: base = gravado / 1.18.
      v_sub := round(v_grav_incl / 1.18, 2);
      v_itbis := v_grav_incl - v_sub;
      v_total := v_grav_incl + v_exento;
    else
      v_sub := v_grav_incl;
      v_itbis := round(v_grav_incl * 0.18, 2);
      v_total := v_grav_incl + v_itbis + v_exento;
    end if;
    v_gravado := v_grav_incl > 0;
  elsif p_clase = 'nota' then
    select * into nc from public.pc_notas_credito where id::text = p_id;
    if not found or nc.ncf not like 'E34%' then
      raise exception using errcode = 'P0002', message = 'La nota de crédito no es electrónica.';
    end if;
    select * into fo from public.pc_facturas where id = nc.factura_id;
    v_tipo := 'E34'; v_encf := nc.ncf; v_fecha := nc.fecha;
    v_rnc_comp := nullif(regexp_replace(coalesce(nc.rnccliente, ''), '[^0-9]', '', 'g'), '');
    v_nombre_comp := nullif(btrim(coalesce(nc.propietario, '')), '');
    v_gravado := coalesce(nc.itbis, 0) > 0; v_credito := false;
    v_sub := nc.subtotal; v_itbis := nc.itbis; v_total := nc.total; v_exento := 0;
    if not v_gravado then v_exento := v_sub; end if;
    v_items := jsonb_build_array(jsonb_build_object('NumeroLinea', 1, 'IndicadorFacturacion', case when v_gravado then 1 else 4 end,
      'NombreItem', left('Nota de crédito: ' || nc.motivo, 80), 'IndicadorBienoServicio', 2, 'CantidadItem', 1,
      'PrecioUnitarioItem', v_sub, 'MontoItem', v_sub));
    v_ref := jsonb_build_object('NCFModificado', nc.ncf_modificado,
      'FechaNCFModificado', public.pc_ecf_fecha(coalesce(public.pc_fecha_txt(fo.fecha), nc.fecha)),
      'CodigoModificacion', case when nc.total >= coalesce(fo.total, 0) then '1' else '3' end,
      'RazonModificacion', left(nc.motivo, 90));
  else
    raise exception using errcode = '22023', message = 'Clase de documento no válida.';
  end if;

  select * into sec from public.pc_ncf_secuencias where tipo = v_tipo;
  v_iddoc := jsonb_build_object('TipoeCF', substr(v_tipo, 2), 'eNCF', v_encf);
  if v_tipo = 'E31' and sec.vence is not null then
    v_iddoc := v_iddoc || jsonb_build_object('FechaVencimientoSecuencia', public.pc_ecf_fecha(sec.vence));
  end if;
  if v_tipo = 'E34' then
    v_iddoc := v_iddoc || jsonb_build_object('IndicadorNotaCredito',
      case when v_fecha - coalesce(public.pc_fecha_txt(fo.fecha), v_fecha) > 30 then 1 else 0 end);
  end if;
  v_iddoc := v_iddoc || jsonb_build_object('IndicadorMontoGravado', v_indicador, 'TipoIngresos', '01', 'TipoPago', case when v_credito then 2 else 1 end);
  if v_credito then v_iddoc := v_iddoc || jsonb_build_object('FechaLimitePago', public.pc_ecf_fecha(v_fecha + 30)); end if;

  if v_rnc_comp is not null then
    v_comprador := jsonb_build_object('RNCComprador', v_rnc_comp, 'RazonSocialComprador', left(coalesce(v_nombre_comp, 'Cliente'), 150));
  elsif v_tipo = 'E31' then
    raise exception using errcode = '22023', message = 'El E31 necesita el RNC o la cédula del cliente.';
  end if;
  v_totales := jsonb_strip_nulls(jsonb_build_object(
    'MontoGravadoTotal', case when v_gravado then v_sub end,
    'MontoGravadoI1', case when v_gravado then v_sub end,
    'MontoExento', case when v_exento > 0 or not v_gravado then case when v_gravado then v_exento else v_total end end,
    'ITBIS1', case when v_gravado then 18 end,
    'TotalITBIS', case when v_gravado then v_itbis end,
    'TotalITBIS1', case when v_gravado then v_itbis end,
    'MontoTotal', v_total));
  return jsonb_build_object('ECF', jsonb_strip_nulls(jsonb_build_object(
    'Encabezado', jsonb_strip_nulls(jsonb_build_object(
      'Version', '1.0', 'IdDoc', v_iddoc,
      'Emisor', jsonb_build_object('RNCEmisor', v_rnc, 'RazonSocialEmisor', left(v_razon, 150),
                                   'DireccionEmisor', left(v_dir, 100), 'FechaEmision', public.pc_ecf_fecha(v_fecha)),
      'Comprador', v_comprador, 'Totales', v_totales)),
    'DetallesItems', jsonb_build_object('Item', v_items),
    'InformacionReferencia', v_ref)));
end $$;
revoke all on function public.pc_ecf_documento(text, text) from public, anon, authenticated;
grant execute on function public.pc_ecf_documento(text, text) to service_role;

-- Nota de crédito: ITBIS proporcional al e-CF que modifica.
create or replace function public.pc_emitir_nota_credito(p_factura_id text, p_total numeric, p_motivo text, p_operacion_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare f public.pc_facturas; previo public.pc_notas_credito; ya numeric; v_total numeric; v_itbis numeric;
        v_tipo text; comprobante text; fila public.pc_notas_credito;
begin
  if public.pc_rol() <> 'admin' then
    raise exception using errcode = '42501', message = 'Solo la administración emite notas de crédito.';
  end if;
  if p_operacion_id is null then
    raise exception using errcode = '22023', message = 'Falta el identificador de la operación.';
  end if;
  select * into previo from public.pc_notas_credito where operacion_id = p_operacion_id;
  if found then return to_jsonb(previo); end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then
    raise exception using errcode = '22023', message = 'Escribe el motivo de la nota de crédito (mínimo 5 letras).';
  end if;
  select * into f from public.pc_facturas where id = p_factura_id for update;
  if not found or coalesce(f.ncf, '') = '' then
    raise exception using errcode = '22023', message = 'La nota de crédito solo modifica facturas con comprobante fiscal.';
  end if;
  if f.ncf like 'E%' and coalesce(f.ecf_estado, '') in ('por_enviar', 'en_proceso', 'rechazado') then
    raise exception using errcode = '22023', message = 'El e-CF de esta factura todavía no está aceptado por la DGII.';
  end if;
  v_tipo := case when f.ncf like 'E%' then 'E34' else 'B04' end;
  select coalesce(sum(total), 0) into ya from public.pc_notas_credito where factura_id = f.id;
  v_total := round(coalesce(p_total, f.total - ya), 2);
  if v_total <= 0 or v_total > f.total - ya + 0.004 then
    raise exception using errcode = '22023',
      message = format('El monto debe estar entre RD$0.01 y lo que queda por acreditar: RD$%s.', to_char(f.total - ya, 'FM999G999G990D00'));
  end if;
  -- e-CF: el ITBIS de la nota sale en la misma proporción que en el e-CF
  -- (con precios que ya incluyen ITBIS, itbisamt de la factura es 0).
  if f.ncf like 'E%' then
    select round(v_total * coalesce((d -> 'ECF' -> 'Encabezado' -> 'Totales' ->> 'TotalITBIS')::numeric, 0)
                 / nullif((d -> 'ECF' -> 'Encabezado' -> 'Totales' ->> 'MontoTotal')::numeric, 0), 2)
      into v_itbis from (select public.pc_ecf_documento('factura', f.id) as d) x;
    v_itbis := coalesce(v_itbis, 0);
  else
    v_itbis := case when coalesce(f.itbisamt, 0) > 0 and f.total > 0 then round(v_total * f.itbisamt / f.total, 2) else 0 end;
  end if;
  comprobante := public.pc_tomar_numero(v_tipo);
  insert into public.pc_notas_credito (operacion_id, ncf, factura_id, ncf_modificado, fecha, motivo, subtotal, itbis, total,
                                       rnccliente, propietario, emitida_por, ecf_estado, ecf_origen, ecf_actualizado)
  values (p_operacion_id, comprobante, f.id, f.ncf, (now() at time zone 'America/Santo_Domingo')::date, left(btrim(p_motivo), 500),
          v_total - v_itbis, v_itbis, v_total, f.rnccliente, coalesce(nullif(f.propietario, ''), f.mascota),
          coalesce(auth.jwt() ->> 'email', ''),
          case when v_tipo = 'E34' then 'por_enviar' end, case when v_tipo = 'E34' then 'proveedor' end,
          case when v_tipo = 'E34' then now() end)
  returning * into fila;
  return to_jsonb(fila);
end $$;
revoke all on function public.pc_emitir_nota_credito(text, numeric, text, uuid) from public, anon;
grant execute on function public.pc_emitir_nota_credito(text, numeric, text, uuid) to authenticated;
