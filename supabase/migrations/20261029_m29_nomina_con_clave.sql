-- ─────────────────────────────────────────────────────────────────────────────
-- M29 · Nomina con clave propia (29 oct 2026)
--
-- Victor: "Quiero que esta seccion siempre se abra con una contraseña, aunque se
-- haya iniciado sesion en el usuario de administrador. Necesito mucha
-- confidencialidad". Una clave que solo revisara la pantalla no protege nada:
-- con la sesion del admin abierta, cualquiera podria leer los sueldos por la API
-- (o desde Reportes / Exportar Excel). Por eso:
--
-- 1) Las tablas de nomina tienen RLS activo y NINGUNA politica: la API no las
--    deja leer ni escribir a nadie, ni al admin. Solo entran las funciones de
--    abajo (SECURITY DEFINER), y cada una exige un PASE vigente.
-- 2) El pase se obtiene con pc_nomina_abrir(clave): la clave se compara contra
--    un hash bcrypt (pgcrypto), nunca se guarda en claro. Dura 20 minutos y se
--    renueva con cada uso. 5 claves malas en 15 minutos bloquean 15 minutos.
-- 3) Ademas de la clave, quien llama tiene que ser admin (pc_es_admin()).
--
-- Si Victor olvida la clave: en el SQL Editor de Supabase,
--   delete from public.pc_nomina_clave;
-- y al abrir Nomina la app pide crear una nueva. Los datos no se pierden.
--
-- Pagos: cada quincena, adelanto o incentivo pagado se anota tambien en Gastos
-- (categoria "nomina") SIN el nombre de la persona, para que el flujo de caja
-- cuadre sin revelar quien cobra cuanto (decision de Victor, 29 oct).
--
-- Sin sueldos ni nombres en este archivo: el repo es publico. Los empleados y
-- sus sueldos se cargan aparte, desde el conector o desde la propia app.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.pc_nomina_clave (
  id          int primary key default 1 check (id = 1),
  hash        text not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create table if not exists public.pc_nomina_pases (
  token   uuid primary key default gen_random_uuid(),
  email   text not null,
  expira  timestamptz not null
);
create table if not exists public.pc_nomina_intentos (
  id     bigint generated always as identity primary key,
  email  text,
  ok     boolean not null,
  en     timestamptz not null default now()
);
create table if not exists public.pc_nomina_empleados (
  id              bigint generated always as identity primary key,
  nombre          text not null,
  cargo           text,
  sueldo_mensual  numeric(12,2) not null default 0 check (sueldo_mensual >= 0),
  empleado_ref    text,            -- id en pc_empleados (para enlazar comisiones de ventas)
  activo          boolean not null default true,
  notas           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create table if not exists public.pc_nomina_movimientos (
  id            bigint generated always as identity primary key,
  empleado_id   bigint not null references public.pc_nomina_empleados(id),
  fecha         date not null default current_date,
  tipo          text not null check (tipo in ('quincena', 'adelanto', 'incentivo', 'comision', 'descuento')),
  periodo       text,              -- 2026-10-Q1 / 2026-10-Q2
  monto         numeric(12,2) not null check (monto >= 0),
  detalle       jsonb not null default '{}'::jsonb,   -- desglose de la quincena
  metodo        text,
  nota          text,
  pagado_ahora  boolean not null default true,         -- false = incentivo que se suma a la proxima quincena
  liquidado_en  bigint,            -- adelanto/incentivo ya incluido en esta quincena (id)
  gasto_id      text,
  anulado       boolean not null default false,
  creado_por    text,
  created_at    timestamptz not null default now()
);
create index if not exists pc_nomina_mov_emp_idx on public.pc_nomina_movimientos (empleado_id, fecha desc);

-- Regla Critica 6: RLS en la misma migracion, y SIN politicas a proposito.
alter table public.pc_nomina_clave       enable row level security;
alter table public.pc_nomina_pases       enable row level security;
alter table public.pc_nomina_intentos    enable row level security;
alter table public.pc_nomina_empleados   enable row level security;
alter table public.pc_nomina_movimientos enable row level security;
revoke all on public.pc_nomina_clave, public.pc_nomina_pases, public.pc_nomina_intentos,
              public.pc_nomina_empleados, public.pc_nomina_movimientos from anon, authenticated;

-- ── Funciones ────────────────────────────────────────────────────────────────
-- Devuelve el email del pase si sigue vigente (y lo alarga 20 min); si no, error.
create or replace function public.pc_nomina_pase_ok(p_token uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  if not (select public.pc_es_admin()) then raise exception 'Solo el administrador' using errcode = '42501'; end if;
  update public.pc_nomina_pases set expira = now() + interval '20 minutes'
   where token = p_token and expira > now()
     and email = lower(coalesce(auth.jwt() ->> 'email', ''))
  returning email into v_email;
  if v_email is null then raise exception 'NOMINA_CERRADA' using errcode = '28000'; end if;
  return v_email;
end $$;

create or replace function public.pc_nomina_estado() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.pc_es_admin()) then raise exception 'Solo el administrador' using errcode = '42501'; end if;
  return jsonb_build_object('tiene_clave', exists (select 1 from public.pc_nomina_clave));
end $$;

-- Solo sirve la PRIMERA vez (no hay clave). Despues, cambiar exige la actual.
create or replace function public.pc_nomina_crear_clave(p_clave text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(coalesce(auth.jwt() ->> 'email', '')); v_tok uuid;
begin
  if not (select public.pc_es_admin()) then raise exception 'Solo el administrador' using errcode = '42501'; end if;
  if length(coalesce(p_clave, '')) < 6 then raise exception 'La clave debe tener al menos 6 caracteres'; end if;
  insert into public.pc_nomina_clave (id, hash, updated_by) values (1, extensions.crypt(p_clave, extensions.gen_salt('bf', 10)), v_email)
  on conflict (id) do nothing;
  if not found then raise exception 'Ya existe una clave de nomina'; end if;
  insert into public.pc_nomina_pases (email, expira) values (v_email, now() + interval '20 minutes') returning token into v_tok;
  return v_tok;
end $$;

create or replace function public.pc_nomina_abrir(p_clave text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(coalesce(auth.jwt() ->> 'email', '')); v_hash text; v_tok uuid;
begin
  if not (select public.pc_es_admin()) then raise exception 'Solo el administrador' using errcode = '42501'; end if;
  if (select count(*) from public.pc_nomina_intentos where not ok and en > now() - interval '15 minutes') >= 5 then
    raise exception 'NOMINA_BLOQUEADA';
  end if;
  select hash into v_hash from public.pc_nomina_clave where id = 1;
  if v_hash is null then raise exception 'NOMINA_SIN_CLAVE'; end if;
  if extensions.crypt(coalesce(p_clave, ''), v_hash) <> v_hash then
    insert into public.pc_nomina_intentos (email, ok) values (v_email, false);
    raise exception 'NOMINA_CLAVE_MAL';
  end if;
  insert into public.pc_nomina_intentos (email, ok) values (v_email, true);
  delete from public.pc_nomina_pases where expira < now();
  insert into public.pc_nomina_pases (email, expira) values (v_email, now() + interval '20 minutes') returning token into v_tok;
  return v_tok;
end $$;

create or replace function public.pc_nomina_cerrar(p_token uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.pc_nomina_pases where token = p_token;
$$;

create or replace function public.pc_nomina_cambiar_clave(p_token uuid, p_actual text, p_nueva text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_email text := public.pc_nomina_pase_ok(p_token); v_hash text;
begin
  select hash into v_hash from public.pc_nomina_clave where id = 1;
  if extensions.crypt(coalesce(p_actual, ''), v_hash) <> v_hash then raise exception 'NOMINA_CLAVE_MAL'; end if;
  if length(coalesce(p_nueva, '')) < 6 then raise exception 'La clave debe tener al menos 6 caracteres'; end if;
  update public.pc_nomina_clave set hash = extensions.crypt(p_nueva, extensions.gen_salt('bf', 10)), updated_at = now(), updated_by = v_email where id = 1;
  delete from public.pc_nomina_pases where token <> p_token;   -- cierra otras pestanas abiertas
end $$;

create or replace function public.pc_nomina_datos(p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.pc_nomina_pase_ok(p_token);
  return jsonb_build_object(
    'empleados', coalesce((select jsonb_agg(to_jsonb(e) order by e.activo desc, e.nombre) from public.pc_nomina_empleados e), '[]'::jsonb),
    'movimientos', coalesce((select jsonb_agg(to_jsonb(m) order by m.fecha desc, m.id desc) from public.pc_nomina_movimientos m), '[]'::jsonb));
end $$;

create or replace function public.pc_nomina_guardar_empleado(p_token uuid, p_e jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_row public.pc_nomina_empleados;
begin
  perform public.pc_nomina_pase_ok(p_token);
  if coalesce(trim(p_e ->> 'nombre'), '') = '' then raise exception 'Falta el nombre'; end if;
  if (p_e ->> 'id') is null then
    insert into public.pc_nomina_empleados (nombre, cargo, sueldo_mensual, empleado_ref, activo, notas)
    values (trim(p_e ->> 'nombre'), p_e ->> 'cargo', coalesce((p_e ->> 'sueldo_mensual')::numeric, 0), nullif(p_e ->> 'empleado_ref', ''),
            coalesce((p_e ->> 'activo')::boolean, true), p_e ->> 'notas')
    returning * into v_row;
  else
    update public.pc_nomina_empleados set nombre = trim(p_e ->> 'nombre'), cargo = p_e ->> 'cargo',
      sueldo_mensual = coalesce((p_e ->> 'sueldo_mensual')::numeric, sueldo_mensual), empleado_ref = nullif(p_e ->> 'empleado_ref', ''),
      activo = coalesce((p_e ->> 'activo')::boolean, activo), notas = p_e ->> 'notas', updated_at = now()
    where id = (p_e ->> 'id')::bigint returning * into v_row;
  end if;
  return to_jsonb(v_row);
end $$;

-- Registra un pago. Si es quincena, marca como liquidados los adelantos e
-- incentivos que se le sumaron/restaron (p_m.liquida = [ids]).
create or replace function public.pc_nomina_registrar(p_token uuid, p_m jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_email text := public.pc_nomina_pase_ok(p_token); v_row public.pc_nomina_movimientos;
begin
  insert into public.pc_nomina_movimientos (empleado_id, fecha, tipo, periodo, monto, detalle, metodo, nota, pagado_ahora, gasto_id, creado_por)
  values ((p_m ->> 'empleado_id')::bigint, coalesce((p_m ->> 'fecha')::date, current_date), p_m ->> 'tipo', p_m ->> 'periodo',
          (p_m ->> 'monto')::numeric, coalesce(p_m -> 'detalle', '{}'::jsonb), p_m ->> 'metodo', p_m ->> 'nota',
          coalesce((p_m ->> 'pagado_ahora')::boolean, true), p_m ->> 'gasto_id', v_email)
  returning * into v_row;
  if v_row.tipo = 'quincena' and jsonb_typeof(p_m -> 'liquida') = 'array' then
    update public.pc_nomina_movimientos set liquidado_en = v_row.id
     where id in (select (x)::bigint from jsonb_array_elements_text(p_m -> 'liquida') x)
       and empleado_id = v_row.empleado_id and liquidado_en is null and not anulado;
  end if;
  return to_jsonb(v_row);
end $$;

create or replace function public.pc_nomina_anular(p_token uuid, p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.pc_nomina_pase_ok(p_token);
  update public.pc_nomina_movimientos set anulado = true where id = p_id;
  update public.pc_nomina_movimientos set liquidado_en = null where liquidado_en = p_id;   -- vuelven a quedar pendientes
end $$;

-- Toda funcion nace con EXECUTE para PUBLIC (que anon hereda): se quita y se
-- da solo a authenticated. Ademas cada una exige admin.
do $$
declare f text;
begin
  foreach f in array array[
    'pc_nomina_pase_ok(uuid)', 'pc_nomina_estado()', 'pc_nomina_crear_clave(text)', 'pc_nomina_abrir(text)',
    'pc_nomina_cerrar(uuid)', 'pc_nomina_cambiar_clave(uuid,text,text)', 'pc_nomina_datos(uuid)',
    'pc_nomina_guardar_empleado(uuid,jsonb)', 'pc_nomina_registrar(uuid,jsonb)', 'pc_nomina_anular(uuid,bigint)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
