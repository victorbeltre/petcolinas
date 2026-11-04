-- ─────────────────────────────────────────────────────────────────────────────
-- M35 · Precios de venta con clave propia (4 nov 2026)
--
-- Seccion "Precios" (solo admin + clave propia, igual que Nomina M29). Aqui se
-- fija el precio de cada servicio y producto a partir de lo que se quiere recibir
-- neto, descontando lo que cobra la tarjeta:
--   - comision de Cardnet: 4.00% (estado de cuenta de octubre 2026)
--   - retencion de ITBIS de tarjeta: 1.69% (se trata como NO reembolsable hasta
--     que el contador confirme; `retencion_recuperable` = false)
--   precio sin ITBIS = neto / (1 - costo_tarjeta)
--   total al cliente = precio sin ITBIS x 1.18 si lleva ITBIS
-- Un solo precio para efectivo y tarjeta: la comision va dentro del precio.
--
-- RLS sin politicas en todas las tablas: solo entran las funciones SECURITY
-- DEFINER, y cada una exige admin + un pase vigente de pc_precios_abrir(clave).
-- Clave olvidada: delete from public.pc_precios_clave; y la app pide otra nueva.
-- Sin montos de negocio en este archivo: los precios se cargan desde la app.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.pc_precios_clave (
  id          int primary key default 1 check (id = 1),
  hash        text not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create table if not exists public.pc_precios_pases (
  token   uuid primary key default gen_random_uuid(),
  email   text not null,
  expira  timestamptz not null
);
create table if not exists public.pc_precios_intentos (
  id     bigint generated always as identity primary key,
  email  text,
  ok     boolean not null,
  en     timestamptz not null default now()
);
create table if not exists public.pc_precios_config (
  id                     int primary key default 1 check (id = 1),
  comision_tarjeta       numeric(6,2) not null default 4.00 check (comision_tarjeta >= 0),
  retencion_itbis        numeric(6,2) not null default 1.69 check (retencion_itbis >= 0),
  retencion_recuperable  boolean not null default false,
  updated_at             timestamptz not null default now()
);
insert into public.pc_precios_config (id) values (1) on conflict (id) do nothing;
create table if not exists public.pc_precios_items (
  id              bigint generated always as identity primary key,
  nombre          text not null,
  area            text not null default 'otro',           -- grooming | veterinaria | farmacia | otro
  neto            numeric(12,2) not null check (neto >= 0),         -- lo que quieres recibir, sin ITBIS ni tarjeta
  costo           numeric(12,2),                                    -- costo de compra (opcional, para el margen)
  itbis           boolean not null default true,                    -- lleva ITBIS
  precio_sin_itbis numeric(12,2) not null default 0,               -- calculado al guardar
  precio_total    numeric(12,2) not null default 0,                 -- lo que paga el cliente
  notas           text,
  activo          boolean not null default true,
  updated_at      timestamptz not null default now()
);

alter table public.pc_precios_clave    enable row level security;
alter table public.pc_precios_pases    enable row level security;
alter table public.pc_precios_intentos enable row level security;
alter table public.pc_precios_config   enable row level security;
alter table public.pc_precios_items    enable row level security;
revoke all on public.pc_precios_clave, public.pc_precios_pases, public.pc_precios_intentos,
              public.pc_precios_config, public.pc_precios_items from anon, authenticated;

-- ── Funciones ────────────────────────────────────────────────────────────────
create or replace function public.pc_precios_pase_ok(p_token uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  if not (select public.pc_es_admin()) then raise exception 'Solo el administrador' using errcode = '42501'; end if;
  update public.pc_precios_pases set expira = now() + interval '20 minutes'
   where token = p_token and expira > now()
     and email = lower(coalesce(auth.jwt() ->> 'email', ''))
  returning email into v_email;
  if v_email is null then raise exception 'PRECIOS_CERRADOS' using errcode = '28000'; end if;
  return v_email;
end $$;

create or replace function public.pc_precios_estado() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.pc_es_admin()) then raise exception 'Solo el administrador' using errcode = '42501'; end if;
  return jsonb_build_object('tiene_clave', exists (select 1 from public.pc_precios_clave));
end $$;

create or replace function public.pc_precios_crear_clave(p_clave text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(coalesce(auth.jwt() ->> 'email', '')); v_tok uuid;
begin
  if not (select public.pc_es_admin()) then raise exception 'Solo el administrador' using errcode = '42501'; end if;
  if length(coalesce(p_clave, '')) < 6 then raise exception 'La clave debe tener al menos 6 caracteres'; end if;
  insert into public.pc_precios_clave (id, hash, updated_by) values (1, extensions.crypt(p_clave, extensions.gen_salt('bf', 10)), v_email)
  on conflict (id) do nothing;
  if not found then raise exception 'Ya existe una clave de precios'; end if;
  insert into public.pc_precios_pases (email, expira) values (v_email, now() + interval '20 minutes') returning token into v_tok;
  return v_tok;
end $$;

create or replace function public.pc_precios_abrir(p_clave text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(coalesce(auth.jwt() ->> 'email', '')); v_hash text; v_tok uuid;
begin
  if not (select public.pc_es_admin()) then raise exception 'Solo el administrador' using errcode = '42501'; end if;
  if (select count(*) from public.pc_precios_intentos where not ok and en > now() - interval '15 minutes') >= 5 then
    raise exception 'PRECIOS_BLOQUEADOS';
  end if;
  select hash into v_hash from public.pc_precios_clave where id = 1;
  if v_hash is null then raise exception 'PRECIOS_SIN_CLAVE'; end if;
  if extensions.crypt(coalesce(p_clave, ''), v_hash) <> v_hash then
    insert into public.pc_precios_intentos (email, ok) values (v_email, false);
    raise exception 'PRECIOS_CLAVE_MAL';
  end if;
  insert into public.pc_precios_intentos (email, ok) values (v_email, true);
  delete from public.pc_precios_pases where expira < now();
  insert into public.pc_precios_pases (email, expira) values (v_email, now() + interval '20 minutes') returning token into v_tok;
  return v_tok;
end $$;

create or replace function public.pc_precios_cerrar(p_token uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.pc_precios_pases where token = p_token;
$$;

-- Calcula el precio de un item segun la configuracion vigente.
create or replace function public.pc_precios_calcular(p_neto numeric, p_itbis boolean) returns table (sin_itbis numeric, total numeric)
language sql stable security definer set search_path = '' as $$
  select s.sin_itbis, round(s.sin_itbis * case when p_itbis then 1.18 else 1 end, 2)
  from (select round(p_neto / (1 - ((c.comision_tarjeta + case when c.retencion_recuperable then 0 else c.retencion_itbis end) / 100.0)), 2) as sin_itbis
        from public.pc_precios_config c where c.id = 1) s;
$$;

create or replace function public.pc_precios_datos(p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.pc_precios_pase_ok(p_token);
  return jsonb_build_object(
    'config', (select to_jsonb(c) from public.pc_precios_config c where c.id = 1),
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.area, i.nombre) from public.pc_precios_items i), '[]'::jsonb));
end $$;

create or replace function public.pc_precios_parametros(p_token uuid, p_com numeric, p_ret numeric, p_recup boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.pc_precios_pase_ok(p_token);
  if p_com < 0 or p_ret < 0 then raise exception 'Los porcentajes no pueden ser negativos'; end if;
  update public.pc_precios_config set comision_tarjeta = p_com, retencion_itbis = p_ret,
    retencion_recuperable = coalesce(p_recup, false), updated_at = now() where id = 1;
  -- Al cambiar la tasa se recalculan todos los precios.
  update public.pc_precios_items i set precio_sin_itbis = c.sin_itbis, precio_total = c.total, updated_at = now()
    from (select id, (select sin_itbis from public.pc_precios_calcular(neto, itbis)) sin_itbis,
                 (select total from public.pc_precios_calcular(neto, itbis)) total from public.pc_precios_items) c
   where c.id = i.id;
  return (select to_jsonb(cfg) from public.pc_precios_config cfg where cfg.id = 1);
end $$;

create or replace function public.pc_precios_guardar(p_token uuid, p_i jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_row public.pc_precios_items; v_calc record;
begin
  perform public.pc_precios_pase_ok(p_token);
  if coalesce(trim(p_i ->> 'nombre'), '') = '' then raise exception 'Falta el nombre'; end if;
  select * into v_calc from public.pc_precios_calcular((p_i ->> 'neto')::numeric, coalesce((p_i ->> 'itbis')::boolean, true));
  if (p_i ->> 'id') is null then
    insert into public.pc_precios_items (nombre, area, neto, costo, itbis, precio_sin_itbis, precio_total, notas, activo)
    values (trim(p_i ->> 'nombre'), coalesce(p_i ->> 'area', 'otro'), (p_i ->> 'neto')::numeric, nullif(p_i ->> 'costo', '')::numeric,
            coalesce((p_i ->> 'itbis')::boolean, true), v_calc.sin_itbis, v_calc.total, p_i ->> 'notas', coalesce((p_i ->> 'activo')::boolean, true))
    returning * into v_row;
  else
    update public.pc_precios_items set nombre = trim(p_i ->> 'nombre'), area = coalesce(p_i ->> 'area', 'otro'),
      neto = (p_i ->> 'neto')::numeric, costo = nullif(p_i ->> 'costo', '')::numeric,
      itbis = coalesce((p_i ->> 'itbis')::boolean, true), precio_sin_itbis = v_calc.sin_itbis, precio_total = v_calc.total,
      notas = p_i ->> 'notas', activo = coalesce((p_i ->> 'activo')::boolean, true), updated_at = now()
    where id = (p_i ->> 'id')::bigint returning * into v_row;
  end if;
  return to_jsonb(v_row);
end $$;

create or replace function public.pc_precios_borrar(p_token uuid, p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.pc_precios_pase_ok(p_token);
  delete from public.pc_precios_items where id = p_id;
end $$;

revoke all on function public.pc_precios_pase_ok(uuid), public.pc_precios_estado(), public.pc_precios_crear_clave(text),
  public.pc_precios_abrir(text), public.pc_precios_cerrar(uuid), public.pc_precios_calcular(numeric, boolean),
  public.pc_precios_datos(uuid), public.pc_precios_parametros(uuid, numeric, numeric, boolean),
  public.pc_precios_guardar(uuid, jsonb), public.pc_precios_borrar(uuid, bigint) from public, anon;
grant execute on function public.pc_precios_estado(), public.pc_precios_crear_clave(text), public.pc_precios_abrir(text),
  public.pc_precios_cerrar(uuid), public.pc_precios_datos(uuid), public.pc_precios_parametros(uuid, numeric, numeric, boolean),
  public.pc_precios_guardar(uuid, jsonb), public.pc_precios_borrar(uuid, bigint) to authenticated;
