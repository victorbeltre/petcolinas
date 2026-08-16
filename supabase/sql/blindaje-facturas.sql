-- ============================================================================
--  PetColinas · BLINDAJE DE FACTURAS
--  Registra en la BASE DE DATOS cada edicion y cada borrado de facturas y cada
--  borrado de ventas, con el detalle campo por campo, quien lo hizo y la hora.
--  Va en la base de datos a proposito: aunque alguien use otra herramienta o
--  toque la app, el registro se escribe igual y no se puede borrar ni editar.
--
--  Se puede correr varias veces sin romper nada.
-- ============================================================================

-- 1. TABLA DEL REGISTRO -------------------------------------------------------

create table if not exists public.pc_auditoria (
  id       bigint primary key,
  fecha    timestamptz not null default now(),
  usuario  text,
  tabla    text,
  accion   text,
  filaid   text,
  resumen  text,
  monto    numeric default 0
);

alter table public.pc_auditoria add column if not exists datos_antes   jsonb;
alter table public.pc_auditoria add column if not exists datos_despues jsonb;
alter table public.pc_auditoria add column if not exists origen        text default 'app';

create index if not exists pc_auditoria_fecha_idx on public.pc_auditoria (fecha desc);
create index if not exists pc_auditoria_tabla_idx on public.pc_auditoria (tabla, accion);


-- 2. AYUDANTES PARA ESCRIBIR EL DETALLE EN CRISTIANO --------------------------

create or replace function public.pc_aud_etiqueta(col text)
returns text language sql immutable as $$
  select case col
    when 'total'        then 'Total'
    when 'precio'       then 'Precio'
    when 'subtotal'     then 'Subtotal'
    when 'descuento'    then 'Descuento'
    when 'comision'     then 'Comision'
    when 'itbis'        then 'ITBIS'
    when 'monto'        then 'Monto'
    when 'fondo'        then 'Dinero en fondo'
    when 'deposito'     then 'Deposito'
    when 'servicio'     then 'Servicio'
    when 'descripcion'  then 'Descripcion'
    when 'cliente'      then 'Cliente'
    when 'mascota'      then 'Mascota'
    when 'propietario'  then 'Propietario'
    when 'telefono'     then 'Telefono'
    when 'fecha'        then 'Fecha'
    when 'formapago'    then 'Forma de pago'
    when 'metodopago'   then 'Metodo de pago'
    when 'banco'        then 'Banco'
    when 'estado'       then 'Estado'
    when 'numero'       then 'No. de factura'
    when 'recibidopor'  then 'Atendido por'
    when 'cobradopor'   then 'Cobrado por'
    when 'area'         then 'Area'
    when 'notas'        then 'Notas'
    else col
  end;
$$;

-- Formatea dinero; si el valor no es numerico lo devuelve tal cual.
create or replace function public.pc_aud_dinero(v text)
returns text language plpgsql immutable as $$
begin
  if v is null or v = '' then return '(vacio)'; end if;
  return 'RD$ ' || to_char(round(v::numeric), 'FM999,999,999');
exception when others then
  return v;
end;
$$;

create or replace function public.pc_aud_num(v text)
returns numeric language plpgsql immutable as $$
begin
  return coalesce(v::numeric, 0);
exception when others then
  return 0;
end;
$$;

-- Convierte el arreglo items en "Bano pequeno RD$799 + Corte RD$400"
create or replace function public.pc_aud_lineas(v jsonb)
returns text language sql immutable as $$
  select coalesce(string_agg(
           coalesce(it->>'nombre', it->>'descripcion', '?') || ' RD$' ||
           coalesce(it->>'subtotal', it->>'precio', '0'),
           ' + ' order by ord), '')
  from jsonb_array_elements(
         case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end
       ) with ordinality as t(it, ord);
$$;

-- Compara dos versiones de una fila y describe que cambio, campo por campo.
create or replace function public.pc_aud_diff(antes jsonb, despues jsonb)
returns text language plpgsql stable as $$
declare
  k text; sa text; sb text; lin_a text; lin_b text;
  partes text[] := '{}';
begin
  antes   := coalesce(antes,   '{}'::jsonb);
  despues := coalesce(despues, '{}'::jsonb);

  for k in
    select key from (
      select jsonb_object_keys(antes) as key
      union
      select jsonb_object_keys(despues)
    ) t order by key
  loop
    continue when k in ('id', 'items', 'created_at', 'updated_at');
    sa := coalesce(antes ->> k, '');
    sb := coalesce(despues ->> k, '');
    continue when sa = sb;

    if k in ('total','precio','subtotal','descuento','comision','itbis',
             'monto','totalpagado','fondo','deposito') then
      partes := partes || (public.pc_aud_etiqueta(k) || ': ' ||
                           public.pc_aud_dinero(sa) || ' -> ' || public.pc_aud_dinero(sb));
    else
      partes := partes || (public.pc_aud_etiqueta(k) || ': ' ||
                           coalesce(nullif(sa,''), '(vacio)') || ' -> ' ||
                           coalesce(nullif(sb,''), '(vacio)'));
    end if;
  end loop;

  lin_a := public.pc_aud_lineas(antes   -> 'items');
  lin_b := public.pc_aud_lineas(despues -> 'items');
  if lin_a is distinct from lin_b then
    partes := partes || ('Servicios: [' || coalesce(nullif(lin_a,''), 'vacio') ||
                         '] -> [' || coalesce(nullif(lin_b,''), 'vacio') || ']');
  end if;

  return array_to_string(partes, ' || ');
end;
$$;


-- 3. EL VIGILANTE -------------------------------------------------------------
-- security definer: escribe en pc_auditoria aunque el usuario no tenga permiso
-- de tocar esa tabla. Asi nadie puede evitar que quede el rastro.

create or replace function public.pc_auditar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  antes     jsonb;
  despues   jsonb;
  fila      jsonb;
  v_accion  text;
  v_usuario text;
  v_quien   text;
  v_detalle text;
  v_id      bigint;
  v_intento int;
  v_ok      boolean := false;
begin
  if TG_OP = 'DELETE' then
    antes := to_jsonb(OLD); despues := null;          fila := to_jsonb(OLD); v_accion := 'borrar';
  else
    antes := to_jsonb(OLD); despues := to_jsonb(NEW); fila := to_jsonb(NEW); v_accion := 'editar';
    if antes = despues then
      return NEW;                       -- guardo sin cambiar nada: no molestar
    end if;
  end if;

  -- Quien lo hizo: el email de la sesion. Si no hay sesion, el rol de la base.
  begin
    v_usuario := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
  exception when others then
    v_usuario := null;
  end;
  if coalesce(v_usuario, '') = '' then
    v_usuario := 'sin sesion (' || coalesce(current_user::text, '?') || ')';
  end if;

  -- Encabezado: de quien es la fila (esto sale como titulo en el aviso).
  v_quien := nullif(concat_ws(' · ',
    nullif(coalesce(fila->>'cliente', fila->>'mascota', fila->>'nombremascota'), ''),
    case when coalesce(fila->>'numero','') <> '' then 'factura #' || (fila->>'numero') end,
    nullif(coalesce(fila->>'servicio', fila->>'descripcion'), '')
  ), '');
  if v_quien is null then
    v_quien := TG_TABLE_NAME || ' #' || coalesce(fila->>'id', '?');
  end if;

  if v_accion = 'borrar' then
    v_detalle := concat_ws(' || ',
      'SE ELIMINO LA FILA COMPLETA',
      'Total: ' || public.pc_aud_dinero(coalesce(antes->>'total', antes->>'monto')),
      case when coalesce(antes->>'fecha','') <> ''
           then 'Fecha de la fila: ' || (antes->>'fecha') end,
      case when public.pc_aud_lineas(antes->'items') <> ''
           then 'Servicios: ' || public.pc_aud_lineas(antes->'items') end,
      case when coalesce(antes->>'formapago', antes->>'metodopago', '') <> ''
           then 'Forma de pago: ' || coalesce(antes->>'formapago', antes->>'metodopago') end,
      case when coalesce(antes->>'recibidopor','') <> ''
           then 'Atendido por: ' || (antes->>'recibidopor') end);
  else
    v_detalle := public.pc_aud_diff(antes, despues);
  end if;

  -- El id lleva la misma escala que los que genera la app (milisegundos), para
  -- que el aviso del dashboard pueda ordenarlos juntos. Si dos caen en el mismo
  -- milisegundo se reintenta con otro numero en vez de tumbar la operacion.
  <<reintentos>>
  for v_intento in 1..25 loop
    v_id := (extract(epoch from clock_timestamp()) * 1000)::bigint
            + floor(random() * 997)::bigint;
    begin
      insert into public.pc_auditoria
        (id, fecha, usuario, tabla, accion, filaid, resumen, monto,
         datos_antes, datos_despues, origen)
      values
        (v_id, now(), v_usuario, TG_TABLE_NAME, v_accion,
         coalesce(fila->>'id', ''),
         left(v_quien || case when coalesce(v_detalle,'') <> '' then ' || ' || v_detalle else '' end, 4000),
         public.pc_aud_num(coalesce(fila->>'total', fila->>'monto')),
         antes, despues, 'bd');
      v_ok := true;
    exception when unique_violation then
      v_ok := false;
    end;
    exit reintentos when v_ok;
  end loop;

  return case when TG_OP = 'DELETE' then OLD else NEW end;
exception when others then
  -- Pase lo que pase, el registro nunca puede impedir que el negocio facture.
  raise warning 'pc_auditar fallo en % %: %', TG_TABLE_NAME, TG_OP, sqlerrm;
  return case when TG_OP = 'DELETE' then OLD else NEW end;
end;
$$;


-- 4. DONDE VIGILA -------------------------------------------------------------
-- Facturas: toda edicion y todo borrado.
-- Ventas: solo los borrados (las ediciones de ventas ya quedan por la app, y
-- editar una factura toca varias ventas de golpe: seria puro ruido).

drop trigger if exists pc_facturas_auditoria on public.pc_facturas;
create trigger pc_facturas_auditoria
  after update or delete on public.pc_facturas
  for each row execute function public.pc_auditar();

drop trigger if exists pc_ventas_auditoria on public.pc_ventas;
create trigger pc_ventas_auditoria
  after delete on public.pc_ventas
  for each row execute function public.pc_auditar();


-- 5. EL REGISTRO NO SE TOCA ---------------------------------------------------
-- Ni la app ni ningun empleado pueden editar ni borrar lo que ya quedo escrito.

create or replace function public.pc_auditoria_inmutable()
returns trigger language plpgsql as $$
begin
  if current_user in ('anon', 'authenticated') then
    raise exception 'El registro de auditoria es de solo lectura: no se puede % .', lower(TG_OP);
  end if;
  return case when TG_OP = 'DELETE' then OLD else NEW end;
end;
$$;

drop trigger if exists pc_auditoria_no_tocar on public.pc_auditoria;
create trigger pc_auditoria_no_tocar
  before update or delete on public.pc_auditoria
  for each row execute function public.pc_auditoria_inmutable();

revoke truncate on public.pc_auditoria from anon, authenticated;

-- Quien puede LEER el registro: solo el perfil principal. La doctora puede
-- escribir en el (la app lo hace sola) pero no ve lo que se anota sobre ella.
alter table public.pc_auditoria enable row level security;

drop policy if exists pc_auditoria_leer     on public.pc_auditoria;
drop policy if exists pc_auditoria_escribir on public.pc_auditoria;

create policy pc_auditoria_leer on public.pc_auditoria
  for select to authenticated
  using (
    lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''))
      in ('admin@petcolinas.com', 'petcolinasrd@gmail.com')
  );

create policy pc_auditoria_escribir on public.pc_auditoria
  for insert to authenticated
  with check (true);

grant select, insert, update on public.pc_auditoria to authenticated;
