-- ============================================================================
--  M31 · Facturación electrónica (e-CF) — Ley 32-23 (30 oct 2026)
--
--  PetColinas SRL (micro/pequeña) debe emitir e-CF desde el 15 nov 2026. Desde
--  entonces el NCF tipo B queda solo para contingencias declaradas por la DGII.
--
--  Decisión de Victor: sin contable ni software pagado. La app manda cada e-CF
--  por la API de eCF MSeller (plan gratis: 250 e-CF/mes para micro y pequeñas),
--  que firma con el certificado .p12 de PetColinas y lo envía a la DGII.
--  Respaldo: emitir en el Facturador Gratuito de la DGII y anotar el e-NCF.
--  Es la misma lógica que se construyó para VetMake, en versión de una clínica.
--
--  Piezas:
--    1. Rangos e-NCF E31 / E32 / E34 en pc_ncf_secuencias (10 dígitos).
--    2. Columnas ecf_* en pc_facturas; el e-NCF se asigna en el SERVIDOR
--       (pc_ecf_asignar_factura) en la misma transacción que toma el número.
--    3. pc_ecf_registrar_manual: e-NCF emitido en el Facturador Gratuito.
--    4. pc_notas_credito + pc_emitir_nota_credito: E34 (o B04) — una factura con
--       comprobante no se edita ni se borra, se corrige con nota de crédito.
--    5. Trigger: un e-CF no rechazado no cambia líneas, montos ni fecha, y su
--       e-NCF/estado solo lo cambia el servidor.
--    6. Conexión con el proveedor: pc_ecf_config + Supabase Vault (la app nunca
--       vuelve a leer la contraseña ni la API key).
--    7. Documento JSON con la estructura oficial DGII y funciones solo-servidor
--       para la Edge Function pc-ecf.
-- ============================================================================

-- 1) Rangos -------------------------------------------------------------------
alter table public.pc_ncf_secuencias drop constraint if exists pc_ncf_secuencias_tipo_check;
alter table public.pc_ncf_secuencias add constraint pc_ncf_secuencias_tipo_check
  check (tipo in ('B01','B02','B04','B14','B15','E31','E32','E34'));

create or replace function public.pc_ncf_formatear(p_tipo text, p_numero bigint)
returns text language sql immutable set search_path = '' as $$
  select p_tipo || lpad(p_numero::text, case when p_tipo like 'E%' then 10 else 8 end, '0');
$$;
revoke all on function public.pc_ncf_formatear(text, bigint) from public, anon;
grant execute on function public.pc_ncf_formatear(text, bigint) to authenticated, service_role;

-- pc_asignar_ncf (tipo B, flujo viejo) sigue igual pero formatea E con 10 dígitos.
create or replace function public.pc_asignar_ncf(p_tipo text)
returns text language plpgsql security definer set search_path = public as $$
declare v_sig bigint; v_hasta bigint; v_vence date; v_activa boolean;
begin
  if not public.pc_es_personal() then
    raise exception 'No autorizado para asignar NCF';
  end if;
  if p_tipo like 'E%' then
    raise exception 'Los e-NCF se asignan con pc_ecf_asignar_factura.';
  end if;
  update public.pc_ncf_secuencias
     set siguiente = siguiente + 1, actualizado = now()
   where tipo = p_tipo
   returning siguiente - 1, hasta, vence, activa
   into v_sig, v_hasta, v_vence, v_activa;
  if v_sig is null then
    raise exception 'No hay secuencia configurada para el tipo %', p_tipo;
  end if;
  if not v_activa then
    raise exception 'La secuencia % esta desactivada', p_tipo;
  end if;
  if v_sig > v_hasta then
    raise exception 'Se acabaron los NCF del tipo %. Hay que pedir una secuencia nueva a la DGII.', p_tipo;
  end if;
  if v_vence is not null and v_vence < current_date then
    raise exception 'La autorizacion de los NCF % vencio el %', p_tipo, v_vence;
  end if;
  return public.pc_ncf_formatear(p_tipo, v_sig);
end $$;
revoke all on function public.pc_asignar_ncf(text) from public, anon;
grant execute on function public.pc_asignar_ncf(text) to authenticated, service_role;

-- 2) Estado e-CF en la factura -------------------------------------------------
alter table public.pc_facturas add column if not exists ecf_estado text;
alter table public.pc_facturas add column if not exists ecf_origen text;
alter table public.pc_facturas add column if not exists ecf_codigo_seguridad text;
alter table public.pc_facturas add column if not exists ecf_qr_url text;
alter table public.pc_facturas add column if not exists ecf_fecha_firma text;
alter table public.pc_facturas add column if not exists ecf_track_id text;
alter table public.pc_facturas add column if not exists ecf_mensaje text;
alter table public.pc_facturas add column if not exists ecf_intentos integer not null default 0;
alter table public.pc_facturas add column if not exists ecf_actualizado timestamptz;
alter table public.pc_facturas drop constraint if exists pc_facturas_ecf_estado_check;
alter table public.pc_facturas add constraint pc_facturas_ecf_estado_check check (ecf_estado is null or ecf_estado in
  ('por_enviar','en_proceso','aceptado','aceptado_condicional','rechazado','manual'));

-- Fecha de la factura (texto AAAA-MM-DD en esta tabla) como date, sin romper con
-- filas viejas mal escritas.
create or replace function public.pc_fecha_txt(p text)
returns date language plpgsql immutable set search_path = '' as $$
begin
  if p ~ '^\d{4}-\d{2}-\d{2}' then return substr(p, 1, 10)::date; end if;
  return null;
exception when others then return null;
end $$;
revoke all on function public.pc_fecha_txt(text) from public, anon;
grant execute on function public.pc_fecha_txt(text) to authenticated, service_role;

-- 3) Notas de crédito -----------------------------------------------------------
create table if not exists public.pc_notas_credito (
  id              bigint generated by default as identity primary key,
  operacion_id    uuid not null unique,
  ncf             text not null unique,
  factura_id      text not null references public.pc_facturas(id) on update cascade,
  ncf_modificado  text not null,
  fecha           date not null,
  motivo          text not null,
  subtotal        numeric(14,2) not null,
  itbis           numeric(14,2) not null default 0,
  total           numeric(14,2) not null check (total > 0),
  rnccliente      text,
  propietario     text,
  emitida_por     text,
  ecf_estado      text check (ecf_estado is null or ecf_estado in
                    ('por_enviar','en_proceso','aceptado','aceptado_condicional','rechazado','manual')),
  ecf_origen      text,
  ecf_codigo_seguridad text,
  ecf_qr_url      text,
  ecf_fecha_firma text,
  ecf_track_id    text,
  ecf_mensaje     text,
  ecf_intentos    integer not null default 0,
  ecf_actualizado timestamptz,
  created_at      timestamptz not null default now()
);
alter table public.pc_notas_credito enable row level security;
revoke all on public.pc_notas_credito from anon, public, authenticated;
grant select on public.pc_notas_credito to authenticated;
drop policy if exists pc_notas_leer on public.pc_notas_credito;
create policy pc_notas_leer on public.pc_notas_credito for select to authenticated
  using ((select public.pc_es_personal()));
create index if not exists pc_notas_credito_factura_idx on public.pc_notas_credito (factura_id);

-- 4) Proteger el e-CF ----------------------------------------------------------
-- La app guarda facturas con upsert desde el navegador. Un e-CF ya enviado no
-- se puede cambiar por ahí: el e-NCF y su estado solo los toca el servidor
-- (marca pc.ecf_servidor), y líneas, montos y fecha quedan fijos salvo que la
-- DGII lo haya rechazado.
create or replace function public.pc_proteger_factura_ecf()
returns trigger language plpgsql set search_path = '' as $$
declare v_servidor boolean := coalesce(current_setting('pc.ecf_servidor', true), '') = '1';
begin
  if v_servidor then return new; end if;
  if old.ncf is not null and old.ncf <> '' then
    -- El comprobante ya entregado no se cambia ni se borra desde la app.
    new.ncf := old.ncf; new.ncftipo := old.ncftipo; new.rnccliente := old.rnccliente;
  end if;
  if old.ncf like 'E%' then
    new.ecf_estado := old.ecf_estado; new.ecf_origen := old.ecf_origen;
    new.ecf_codigo_seguridad := old.ecf_codigo_seguridad; new.ecf_qr_url := old.ecf_qr_url;
    new.ecf_fecha_firma := old.ecf_fecha_firma; new.ecf_track_id := old.ecf_track_id;
    new.ecf_mensaje := old.ecf_mensaje; new.ecf_intentos := old.ecf_intentos; new.ecf_actualizado := old.ecf_actualizado;
    if coalesce(old.ecf_estado, '') <> 'rechazado'
       and (new.items is distinct from old.items or new.total is distinct from old.total
            or new.subtotal is distinct from old.subtotal or new.itbisamt is distinct from old.itbisamt
            or new.fecha is distinct from old.fecha or new.itbis is distinct from old.itbis) then
      raise exception using errcode = '22023',
        message = 'Esta factura ya tiene comprobante electrónico: no se cambian líneas, montos ni fecha. Para corregirla emite una nota de crédito.',
        hint = 'pc_ecf_inmutable';
    end if;
  elsif new.ncf like 'E%' then
    -- Nadie se inventa un e-NCF desde el navegador.
    raise exception using errcode = '42501', message = 'El e-NCF lo asigna el servidor.';
  end if;
  return new;
end $$;
revoke all on function public.pc_proteger_factura_ecf() from public, anon, authenticated;
drop trigger if exists pc_proteger_factura_ecf on public.pc_facturas;
create trigger pc_proteger_factura_ecf before update on public.pc_facturas
  for each row execute function public.pc_proteger_factura_ecf();

create or replace function public.pc_proteger_factura_ecf_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('pc.ecf_servidor', true), '') <> '1'
     and (new.ncf like 'E%' or new.ecf_estado is not null) then
    raise exception using errcode = '42501', message = 'El e-NCF lo asigna el servidor.';
  end if;
  return new;
end $$;
revoke all on function public.pc_proteger_factura_ecf_insert() from public, anon, authenticated;
drop trigger if exists pc_proteger_factura_ecf_insert on public.pc_facturas;
create trigger pc_proteger_factura_ecf_insert before insert on public.pc_facturas
  for each row execute function public.pc_proteger_factura_ecf_insert();

-- Una factura con comprobante no se borra: se corrige con nota de crédito.
create or replace function public.pc_no_borrar_factura_fiscal()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.ncf is not null and old.ncf <> '' then
    raise exception using errcode = '22023',
      message = 'Una factura con comprobante fiscal no se borra: emite una nota de crédito.';
  end if;
  return old;
end $$;
revoke all on function public.pc_no_borrar_factura_fiscal() from public, anon, authenticated;
drop trigger if exists pc_no_borrar_factura_fiscal on public.pc_facturas;
create trigger pc_no_borrar_factura_fiscal before delete on public.pc_facturas
  for each row execute function public.pc_no_borrar_factura_fiscal();

-- 5) Tomar un número del rango (uso interno) ------------------------------------
create or replace function public.pc_tomar_numero(p_tipo text)
returns text language plpgsql security definer set search_path = '' as $$
declare sec public.pc_ncf_secuencias;
begin
  select * into sec from public.pc_ncf_secuencias where tipo = p_tipo for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = format('No hay un rango de %s registrado. Cárgalo en Datos fiscales con los números que autorizó la DGII.', p_tipo);
  end if;
  if not coalesce(sec.activa, true) then
    raise exception using errcode = '22023', message = format('El rango de %s está desactivado.', p_tipo);
  end if;
  if sec.siguiente > sec.hasta then
    raise exception using errcode = '22023', message = format('Se acabaron los comprobantes %s. Pide un rango nuevo a la DGII.', p_tipo);
  end if;
  if sec.vence is not null and sec.vence < (now() at time zone 'America/Santo_Domingo')::date then
    raise exception using errcode = '22023', message = format('La autorización de los comprobantes %s venció el %s.', p_tipo, to_char(sec.vence, 'DD/MM/YYYY'));
  end if;
  update public.pc_ncf_secuencias set siguiente = siguiente + 1, actualizado = now() where tipo = p_tipo;
  return public.pc_ncf_formatear(p_tipo, sec.siguiente);
end $$;
revoke all on function public.pc_tomar_numero(text) from public, anon, authenticated;

-- 6) Asignar el e-NCF a una factura YA guardada --------------------------------
create or replace function public.pc_ecf_asignar_factura(p_factura_id text, p_tipo text, p_rnc_cliente text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  f public.pc_facturas;
  rnc text := regexp_replace(coalesce(p_rnc_cliente, ''), '[^0-9]', '', 'g');
  comprobante text;
begin
  if not public.pc_es_personal() then
    raise exception using errcode = '42501', message = 'No autorizado.';
  end if;
  if public.pc_rol() not in ('admin', 'caja', 'vet') then
    raise exception using errcode = '42501', message = 'Tu rol no emite comprobantes fiscales.';
  end if;
  if p_tipo not in ('E31', 'E32') then
    raise exception using errcode = '22023', message = 'Tipo de e-CF no válido (E31 o E32).';
  end if;
  select * into f from public.pc_facturas where id = p_factura_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Primero hay que guardar la factura.';
  end if;
  if f.estado = 'anulada' then
    raise exception using errcode = '22023', message = 'Una factura anulada no recibe comprobante.';
  end if;
  if f.ncf is not null and f.ncf <> '' then
    return to_jsonb(f);   -- idempotente: nunca consume un segundo número
  end if;
  if p_tipo = 'E31' and length(rnc) not in (9, 11) then
    raise exception using errcode = '22023', message = 'El Crédito Fiscal (E31) exige el RNC (9 dígitos) o la cédula (11) del cliente.';
  end if;
  if p_tipo = 'E32' and coalesce(f.total, 0) >= 250000 and length(rnc) not in (9, 11) then
    raise exception using errcode = '22023', message = 'Una factura de consumo de RD$250,000 o más exige el RNC o la cédula del cliente.';
  end if;
  comprobante := public.pc_tomar_numero(p_tipo);
  perform set_config('pc.ecf_servidor', '1', true);
  update public.pc_facturas
     set ncf = comprobante, ncftipo = p_tipo, rnccliente = nullif(rnc, ''),
         ecf_estado = 'por_enviar', ecf_origen = 'proveedor', ecf_actualizado = now(), autogenerada = false
   where id = f.id
  returning * into f;
  perform set_config('pc.ecf_servidor', '', true);
  return to_jsonb(f);
end $$;
revoke all on function public.pc_ecf_asignar_factura(text, text, text) from public, anon;
grant execute on function public.pc_ecf_asignar_factura(text, text, text) to authenticated;

-- 7) e-CF emitido en el Facturador Gratuito -------------------------------------
create or replace function public.pc_ecf_registrar_manual(
  p_factura_id text, p_encf text, p_codigo_seguridad text, p_fecha_firma text default null, p_rnc_cliente text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  f public.pc_facturas;
  v_encf text := upper(regexp_replace(coalesce(p_encf, ''), '\s', '', 'g'));
  v_codigo text := btrim(coalesce(p_codigo_seguridad, ''));
  rnc text := regexp_replace(coalesce(p_rnc_cliente, ''), '[^0-9]', '', 'g');
begin
  if not public.pc_es_personal() or public.pc_rol() not in ('admin', 'caja', 'vet') then
    raise exception using errcode = '42501', message = 'Tu rol no registra comprobantes fiscales.';
  end if;
  if v_encf !~ '^E3[12][0-9]{10}$' then
    raise exception using errcode = '22023', message = 'El e-NCF tiene 13 caracteres: E31 o E32 y 10 dígitos (ej. E320000000001).';
  end if;
  if v_codigo !~ '^[A-Za-z0-9]{6}$' then
    raise exception using errcode = '22023', message = 'El código de seguridad tiene 6 letras o números (sale en el PDF del Facturador Gratuito).';
  end if;
  if left(v_encf, 3) = 'E31' and length(rnc) not in (9, 11) then
    raise exception using errcode = '22023', message = 'Un E31 lleva el RNC o la cédula del cliente.';
  end if;
  select * into f from public.pc_facturas where id = p_factura_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Primero hay que guardar la factura.';
  end if;
  if f.ncf is not null and f.ncf <> '' then
    if f.ncf = v_encf then return to_jsonb(f); end if;
    raise exception using errcode = '22023', message = format('Esta factura ya tiene el comprobante %s.', f.ncf);
  end if;
  perform set_config('pc.ecf_servidor', '1', true);
  update public.pc_facturas
     set ncf = v_encf, ncftipo = left(v_encf, 3), rnccliente = nullif(rnc, ''),
         ecf_estado = 'manual', ecf_origen = 'facturador_gratuito', ecf_codigo_seguridad = v_codigo,
         ecf_fecha_firma = nullif(left(btrim(coalesce(p_fecha_firma, '')), 30), ''), ecf_actualizado = now(),
         autogenerada = false
   where id = f.id
  returning * into f;
  perform set_config('pc.ecf_servidor', '', true);
  return to_jsonb(f);
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'Ese e-NCF ya está anotado en otra factura.';
end $$;
revoke all on function public.pc_ecf_registrar_manual(text, text, text, text, text) from public, anon;
grant execute on function public.pc_ecf_registrar_manual(text, text, text, text, text) to authenticated;

-- 8) Nota de crédito (E34 si la factura es electrónica, B04 si no) --------------
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
  v_itbis := case when coalesce(f.itbisamt, 0) > 0 and f.total > 0 then round(v_total * f.itbisamt / f.total, 2) else 0 end;
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

-- 9) Conexión con el proveedor --------------------------------------------------
create table if not exists public.pc_ecf_config (
  id              boolean primary key default true check (id),
  proveedor       text not null default 'mseller' check (proveedor in ('mseller')),
  ambiente        text not null default 'TesteCF' check (ambiente in ('TesteCF', 'CerteCF', 'eCF')),
  activo          boolean not null default false,
  email           text,
  password_id     uuid,
  api_key_id      uuid,
  id_token        text,
  refresh_token   text,
  token_sub       text,
  token_expira    timestamptz,
  ultima_prueba   timestamptz,
  ultima_prueba_ok boolean,
  actualizado     timestamptz not null default now()
);
alter table public.pc_ecf_config enable row level security;
revoke all on public.pc_ecf_config from public, anon, authenticated;
insert into public.pc_ecf_config (id) values (true) on conflict (id) do nothing;

create or replace function public.pc_ecf_config()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.pc_ecf_config;
begin
  if not public.pc_es_personal() then
    raise exception using errcode = '42501', message = 'No autorizado.';
  end if;
  select * into c from public.pc_ecf_config where id;
  return jsonb_build_object(
    'proveedor', c.proveedor, 'ambiente', c.ambiente, 'activo', c.activo, 'email', c.email,
    'tiene_password', c.password_id is not null, 'tiene_api_key', c.api_key_id is not null,
    'ultima_prueba', c.ultima_prueba, 'ultima_prueba_ok', c.ultima_prueba_ok,
    'rnc', regexp_replace(coalesce((select valor from public.pc_config where clave = 'rnc'), ''), '[^0-9]', '', 'g'),
    'razon_social', (select valor from public.pc_config where clave = 'razon_social'),
    'direccion', (select valor from public.pc_config where clave = 'direccion'),
    'secuencias', (select coalesce(jsonb_agg(jsonb_build_object('tipo', s.tipo, 'desde', s.desde, 'hasta', s.hasta,
                     'siguiente', s.siguiente, 'vence', s.vence, 'activa', s.activa) order by s.tipo), '[]'::jsonb)
                     from public.pc_ncf_secuencias s where s.tipo like 'E%'));
end $$;
revoke all on function public.pc_ecf_config() from public, anon;
grant execute on function public.pc_ecf_config() to authenticated;

create or replace function public.pc_ecf_guardar_config(p_config jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ambiente text := nullif(btrim(coalesce(p_config ->> 'ambiente', '')), '');
  v_activo boolean := (p_config ->> 'activo')::boolean;
  v_email text := nullif(lower(btrim(coalesce(p_config ->> 'email', ''))), '');
  v_password text := nullif(p_config ->> 'password', '');
  v_api_key text := nullif(btrim(coalesce(p_config ->> 'api_key', '')), '');
  c public.pc_ecf_config;
  v_reset boolean;
begin
  if public.pc_rol() <> 'admin' then
    raise exception using errcode = '42501', message = 'Solo la administración configura la facturación electrónica.';
  end if;
  if v_ambiente is not null and v_ambiente not in ('TesteCF', 'CerteCF', 'eCF') then
    raise exception using errcode = '22023', message = 'Ambiente no válido.';
  end if;
  select * into c from public.pc_ecf_config where id for update;
  if v_password is not null then
    if c.password_id is null then c.password_id := vault.create_secret(v_password, 'pc_ecf_password', 'Contraseña MSeller de PetColinas');
    else perform vault.update_secret(c.password_id, v_password); end if;
  end if;
  if v_api_key is not null then
    if c.api_key_id is null then c.api_key_id := vault.create_secret(v_api_key, 'pc_ecf_api_key', 'API key MSeller de PetColinas');
    else perform vault.update_secret(c.api_key_id, v_api_key); end if;
  end if;
  if v_activo and (coalesce(v_email, c.email) is null or c.password_id is null or c.api_key_id is null) then
    raise exception using errcode = '22023', message = 'Para activar faltan el correo, la contraseña o la API key del proveedor.';
  end if;
  v_reset := (v_ambiente is not null and v_ambiente <> c.ambiente) or (v_email is not null and v_email is distinct from c.email) or v_password is not null;
  update public.pc_ecf_config set
    ambiente = coalesce(v_ambiente, ambiente), activo = coalesce(v_activo, activo), email = coalesce(v_email, email),
    password_id = c.password_id, api_key_id = c.api_key_id,
    id_token = case when v_reset then null else id_token end,
    refresh_token = case when v_reset then null else refresh_token end,
    token_expira = case when v_reset then null else token_expira end,
    ultima_prueba_ok = case when v_reset then null else ultima_prueba_ok end,
    actualizado = now()
  where id;
  return public.pc_ecf_config();
end $$;
revoke all on function public.pc_ecf_guardar_config(jsonb) from public, anon;
grant execute on function public.pc_ecf_guardar_config(jsonb) to authenticated;

-- 10) Documento e-CF (JSON con la estructura oficial DGII) ----------------------
create or replace function public.pc_ecf_fecha(p date)
returns text language sql immutable set search_path = '' as $$ select to_char(p, 'DD-MM-YYYY'); $$;
revoke all on function public.pc_ecf_fecha(date) from public, anon, authenticated;

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
    v_gravado := coalesce(f.itbis, false);
    v_credito := f.estado = 'pendiente';
    for linea in select * from jsonb_array_elements(coalesce(nullif(f.items, '')::jsonb, '[]'::jsonb)) loop
      i := i + 1;
      v_bruto := coalesce((linea ->> 'precio')::numeric, 0) * coalesce(nullif(linea ->> 'cantidad', '')::numeric, 1);
      v_monto := round(v_bruto * (1 - coalesce(nullif(linea ->> 'descuento', '')::numeric, 0) / 100), 2);
      v_item := jsonb_build_object(
        'NumeroLinea', i,
        'IndicadorFacturacion', case when v_gravado then 1 else 4 end,
        'NombreItem', left(coalesce(nullif(btrim(linea ->> 'descripcion'), ''), 'Servicio'), 80),
        'IndicadorBienoServicio', case when coalesce((linea ->> 'bien')::boolean, false) then 1 else 2 end,
        'CantidadItem', coalesce(nullif(linea ->> 'cantidad', '')::numeric, 1),
        'PrecioUnitarioItem', round(coalesce((linea ->> 'precio')::numeric, 0), 2),
        'MontoItem', v_monto);
      if v_bruto - v_monto > 0 then v_item := v_item || jsonb_build_object('DescuentoMonto', round(v_bruto - v_monto, 2)); end if;
      v_items := v_items || v_item;
    end loop;
    -- Totales del documento = suma de las líneas (la DGII los cuadra contra ellas).
    select coalesce(sum((x ->> 'MontoItem')::numeric), 0) into v_sub from jsonb_array_elements(v_items) x;
    v_itbis := case when v_gravado then round(v_sub * 0.18, 2) else 0 end;
    v_total := v_sub + v_itbis;
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
    v_sub := nc.subtotal; v_itbis := nc.itbis; v_total := nc.total;
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
  v_iddoc := v_iddoc || jsonb_build_object('IndicadorMontoGravado', 0, 'TipoIngresos', '01', 'TipoPago', case when v_credito then 2 else 1 end);
  if v_credito then v_iddoc := v_iddoc || jsonb_build_object('FechaLimitePago', public.pc_ecf_fecha(v_fecha + 30)); end if;

  if v_rnc_comp is not null then
    v_comprador := jsonb_build_object('RNCComprador', v_rnc_comp, 'RazonSocialComprador', left(coalesce(v_nombre_comp, 'Cliente'), 150));
  elsif v_tipo = 'E31' then
    raise exception using errcode = '22023', message = 'El E31 necesita el RNC o la cédula del cliente.';
  end if;
  v_totales := case when v_gravado
    then jsonb_build_object('MontoGravadoTotal', v_sub, 'MontoGravadoI1', v_sub, 'ITBIS1', 18, 'TotalITBIS', v_itbis, 'TotalITBIS1', v_itbis, 'MontoTotal', v_total)
    else jsonb_build_object('MontoExento', v_sub, 'MontoTotal', v_total) end;

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

-- 11) Funciones solo-servidor (Edge Function pc-ecf, service_role) --------------
create or replace function public.pc_ecf_servidor_contexto(p_email text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_rol text; c public.pc_ecf_config;
begin
  select rol into v_rol from public.pc_usuarios_rol where email = lower(coalesce(p_email, ''));
  if v_rol is null then
    return jsonb_build_object('ok', false, 'mensaje', 'Tu usuario no tiene rol en PetColinas.');
  end if;
  select * into c from public.pc_ecf_config where id;
  return jsonb_build_object('ok', true, 'rol', v_rol, 'activo', c.activo, 'proveedor', c.proveedor, 'ambiente', c.ambiente,
    'email', c.email,
    'password', (select s.decrypted_secret from vault.decrypted_secrets s where s.id = c.password_id),
    'api_key', (select s.decrypted_secret from vault.decrypted_secrets s where s.id = c.api_key_id),
    'id_token', c.id_token, 'refresh_token', c.refresh_token, 'token_sub', c.token_sub, 'token_expira', c.token_expira);
end $$;

create or replace function public.pc_ecf_servidor_guardar_token(p_id_token text, p_refresh_token text, p_sub text, p_expira timestamptz, p_prueba_ok boolean default null)
returns void language sql security definer set search_path = '' as $$
  update public.pc_ecf_config set id_token = p_id_token, refresh_token = coalesce(p_refresh_token, refresh_token),
    token_sub = coalesce(p_sub, token_sub), token_expira = p_expira,
    ultima_prueba = case when p_prueba_ok is null then ultima_prueba else now() end,
    ultima_prueba_ok = coalesce(p_prueba_ok, ultima_prueba_ok)
  where id;
$$;

create or replace function public.pc_ecf_servidor_resultado(p_clase text, p_id text, p_resultado jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_prov text := lower(coalesce(p_resultado ->> 'status', ''));
  v_error text := nullif(p_resultado ->> 'error', '');
  v_estado text; v_fila jsonb;
begin
  v_estado := case
    when v_error is not null then null
    when v_prov like 'aceptado condicional%' then 'aceptado_condicional'
    when v_prov like 'aceptado%' then 'aceptado'
    when v_prov like 'rechazado%' then 'rechazado'
    else 'en_proceso' end;
  perform set_config('pc.ecf_servidor', '1', true);
  execute format($q$
    update public.%I set
      ecf_estado = coalesce($1, ecf_estado),
      ecf_codigo_seguridad = coalesce(nullif($2 ->> 'securityCode', ''), ecf_codigo_seguridad),
      ecf_qr_url = coalesce(nullif($2 ->> 'qr_url', ''), ecf_qr_url),
      ecf_fecha_firma = coalesce(nullif($2 ->> 'signedDate', ''), ecf_fecha_firma),
      ecf_track_id = coalesce(nullif($2 ->> 'internalTrackId', ''), ecf_track_id),
      ecf_mensaje = left(coalesce($3, nullif($2 ->> 'mensaje', ''), case when $1 = 'rechazado' then 'Rechazado por la DGII' end), 1000),
      ecf_intentos = ecf_intentos + case when coalesce(($2 ->> 'envio')::boolean, false) then 1 else 0 end,
      ecf_actualizado = now()
    where id::text = $4
    returning to_jsonb(%I.*)$q$,
    case when p_clase = 'nota' then 'pc_notas_credito' else 'pc_facturas' end,
    case when p_clase = 'nota' then 'pc_notas_credito' else 'pc_facturas' end)
  into v_fila using v_estado, p_resultado, v_error, p_id;
  perform set_config('pc.ecf_servidor', '', true);
  return v_fila;
end $$;

create or replace function public.pc_ecf_servidor_pendientes()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select 'factura' as clase, f.id::text as id, f.ncf from public.pc_facturas f where f.ecf_estado = 'en_proceso'
    union all
    select 'nota', n.id::text, n.ncf from public.pc_notas_credito n where n.ecf_estado = 'en_proceso'
    limit 100) x;
$$;

revoke all on function public.pc_ecf_servidor_contexto(text) from public, anon, authenticated;
revoke all on function public.pc_ecf_servidor_guardar_token(text, text, text, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.pc_ecf_servidor_resultado(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.pc_ecf_servidor_pendientes() from public, anon, authenticated;
grant execute on function public.pc_ecf_servidor_contexto(text) to service_role;
grant execute on function public.pc_ecf_servidor_guardar_token(text, text, text, timestamptz, boolean) to service_role;
grant execute on function public.pc_ecf_servidor_resultado(text, text, jsonb) to service_role;
grant execute on function public.pc_ecf_servidor_pendientes() to service_role;
