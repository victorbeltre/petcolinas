-- ============================================================================
--  M3 · La separacion de roles baja del navegador a la base (6 sep 2026)
--
--  Antes: las 18 tablas tenian la misma politica `pc_auth_all` =
--  using(true) para authenticated. Que caja "no viera las finanzas" era una
--  cortina en JavaScript; cualquier usuario con sesion podia pedir pc_gastos
--  o pc_pagos por la API y verlo todo.
--
--  Ahora el rol se resuelve en Postgres a partir del correo del JWT:
--    pc_usuarios_rol  (email -> rol, y a que empleado corresponde)
--    pc_rol()         'admin' | 'vet' | 'groomer' | 'caja' | 'sin_rol'
--
--  Matriz:
--    operativas (clientes, citas, ventas, facturas, inventario, tarifas,
--      seguimientos, historias, fichas, depositos, llamadas): los 4 roles.
--    gastos, empleados (salarios), candidatos, ventas_blocklist: solo admin.
--    pagos (nomina): admin todo; vet/groomer SOLO sus propias filas.
--    auditoria: todos insertan (la app audita desde cualquier portal);
--      solo admin lee/edita/borra.
--    pagos_online: solo admin lee (antes por lista de correos fija).
--  Un usuario autenticado sin fila en pc_usuarios_rol no ve nada.
--
--  Idempotente. Para volver atras: supabase/migrations/20260906_m3_revertir.sql
-- ============================================================================

-- 1) Quien es quien ---------------------------------------------------------
create table if not exists public.pc_usuarios_rol (
  email           text primary key,
  rol             text not null check (rol in ('admin','vet','groomer','caja')),
  empleado_id     text,          -- id en pc_empleados, para "mis pagos"
  empleado_nombre text,
  creado_en       timestamptz default now()
);
alter table public.pc_usuarios_rol enable row level security;

insert into public.pc_usuarios_rol (email, rol, empleado_id, empleado_nombre) values
  ('petcolinasrd@gmail.com',     'admin',   null, 'Victor Ballas'),
  ('admin@petcolinas.com',       'admin',   null, 'Admin'),
  ('naylan@petcolinas.com',      'vet',     'e6', 'Naylan Perez'),
  ('valentina@petcolinas.com',   'vet',     '5',  'Dra. Valentina'),
  ('alexander@petcolinas.com',   'groomer', '1',  'Alexander Ramírez'),
  ('veterinaria@petcolinas.com', 'caja',    null, 'Caja')
on conflict (email) do nothing;

-- 2) Funciones de rol -------------------------------------------------------
-- security definer: leen pc_usuarios_rol sin pasar por su RLS (evita recursion).
create or replace function public.pc_rol()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select rol from public.pc_usuarios_rol
      where email = lower(coalesce(auth.jwt() ->> 'email', ''))),
    'sin_rol');
$$;
create or replace function public.pc_es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.pc_rol() = 'admin';
$$;
create or replace function public.pc_es_personal()
returns boolean language sql stable security definer set search_path = public as $$
  select public.pc_rol() in ('admin','vet','groomer','caja');
$$;
create or replace function public.pc_mi_empleado()
returns table (empleado_id text, empleado_nombre text)
language sql stable security definer set search_path = public as $$
  select empleado_id, empleado_nombre from public.pc_usuarios_rol
   where email = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;
-- OJO: en Postgres toda funcion nace con EXECUTE para PUBLIC, asi que hay que
-- quitarselo explicitamente. `anon` no las necesita; `authenticated` si, porque
-- las politicas de abajo se evaluan con el rol del que hace la peticion.
revoke all on function public.pc_rol(), public.pc_es_admin(), public.pc_es_personal(), public.pc_mi_empleado()
  from public, anon;
grant execute on function public.pc_rol(), public.pc_es_admin(), public.pc_es_personal(), public.pc_mi_empleado()
  to authenticated, service_role;

-- pc_usuarios_rol: cada quien ve su fila; admin administra.
drop policy if exists pc_usuarios_rol_propia on public.pc_usuarios_rol;
create policy pc_usuarios_rol_propia on public.pc_usuarios_rol
  for select to authenticated
  using (email = lower(coalesce((select auth.jwt() ->> 'email'), '')));
drop policy if exists pc_usuarios_rol_admin on public.pc_usuarios_rol;
create policy pc_usuarios_rol_admin on public.pc_usuarios_rol
  for all to authenticated
  using ((select public.pc_es_admin())) with check ((select public.pc_es_admin()));
grant select, insert, update, delete on public.pc_usuarios_rol to authenticated;

-- 3) Tablas operativas: los cuatro roles -------------------------------------
do $$
declare t text;
begin
  foreach t in array array['pc_clientes','pc_citas','pc_seguimientos','pc_inventario',
                           'pc_tarifas','pc_historias','pc_fichas_clinicas','pc_depositos',
                           'pc_ventas','pc_facturas','pc_llamadas']
  loop
    execute format('drop policy if exists pc_auth_all on public.%I', t);
    execute format('drop policy if exists pc_personal on public.%I', t);
    execute format('create policy pc_personal on public.%I for all to authenticated
                      using ((select public.pc_es_personal()))
                      with check ((select public.pc_es_personal()))', t);
  end loop;
end $$;

-- 4) Solo admin: finanzas, personal, reclutamiento --------------------------
do $$
declare t text;
begin
  foreach t in array array['pc_gastos','pc_empleados','pc_candidatos','pc_ventas_blocklist']
  loop
    execute format('drop policy if exists pc_auth_all on public.%I', t);
    execute format('drop policy if exists pc_solo_admin on public.%I', t);
    execute format('create policy pc_solo_admin on public.%I for all to authenticated
                      using ((select public.pc_es_admin()))
                      with check ((select public.pc_es_admin()))', t);
  end loop;
end $$;

-- 5) Nomina: admin todo; cada empleado lee lo suyo ---------------------------
drop policy if exists pc_auth_all on public.pc_pagos;
drop policy if exists pc_pagos_admin on public.pc_pagos;
create policy pc_pagos_admin on public.pc_pagos for all to authenticated
  using ((select public.pc_es_admin())) with check ((select public.pc_es_admin()));
-- OJO: pc_pagos guarda empleadoid como 'e1','e2' mientras pc_empleados usa
-- '1','2','5' y 'e6' — dos convenciones que ya convivian antes de M3. Por eso
-- la comparacion normaliza (quita la 'e' inicial de ambos lados); si no, cada
-- empleado veia 0 pagos suyos. Vale la pena unificar esos ids algun dia.
drop policy if exists pc_pagos_propios on public.pc_pagos;
create policy pc_pagos_propios on public.pc_pagos for select to authenticated
  using (
    (select public.pc_rol()) in ('vet','groomer') and (
      regexp_replace(lower(coalesce(empleadoid::text,'')), '^e', '')
        = regexp_replace(lower(coalesce((select m.empleado_id from public.pc_mi_empleado() m),'@nada')), '^e', '')
      or lower(coalesce(empleadonombre,'')) = lower(coalesce((select m.empleado_nombre from public.pc_mi_empleado() m),'@nada'))
    )
  );

-- 6) Auditoria: todos escriben, solo admin lee ------------------------------
drop policy if exists pc_auth_all on public.pc_auditoria;
drop policy if exists pc_auditoria_insertar on public.pc_auditoria;
create policy pc_auditoria_insertar on public.pc_auditoria for insert to authenticated
  with check ((select public.pc_es_personal()));
drop policy if exists pc_auditoria_admin on public.pc_auditoria;
create policy pc_auditoria_admin on public.pc_auditoria for all to authenticated
  using ((select public.pc_es_admin())) with check ((select public.pc_es_admin()));

-- 7) Pagos en linea: solo admin lee (antes: lista fija de correos) ----------
drop policy if exists pc_pagos_online_leer on public.pc_pagos_online;
create policy pc_pagos_online_leer on public.pc_pagos_online for select to authenticated
  using ((select public.pc_es_admin()));

-- 8) Comprobacion: ninguna tabla pc_* de public sin RLS ni sin politica -----
do $$
declare r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'pc\_%'
             and not c.relrowsecurity
  loop
    raise exception 'La tabla % no tiene RLS activo', r.relname;
  end loop;
end $$;

-- ── Endurecimiento posterior (mismo dia, tras revisar get_advisors) ─────────
-- En Postgres toda funcion nace con EXECUTE para PUBLIC: revocarle solo a
-- `anon` no servia de nada porque lo heredaba por PUBLIC. Se quita a PUBLIC y
-- se otorga unicamente a quien lo necesita. `authenticated` es imprescindible:
-- las politicas de arriba evaluan estas funciones con el rol del solicitante.
do $$
declare f text;
begin
  foreach f in array array['public.pc_rol()','public.pc_es_admin()','public.pc_es_personal()','public.pc_mi_empleado()']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- Regla Critica 6, punto 3: los respaldos con fecha salen de `public`.
-- El esquema `respaldos` no esta en los esquemas expuestos por la API
-- (pgrst.db_schemas no esta fijado, asi que solo se expone `public`).
create schema if not exists respaldos;
revoke all on schema respaldos from anon, authenticated;
do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema='public' and table_name='pc_clientes_backup_20260830') then
    execute 'alter table public.pc_clientes_backup_20260830 set schema respaldos';
  end if;
  if exists (select 1 from information_schema.tables
              where table_schema='public' and table_name='pc_merge_map_20260830') then
    execute 'alter table public.pc_merge_map_20260830 set schema respaldos';
  end if;
end $$;
revoke all on all tables in schema respaldos from anon, authenticated;
grant usage on schema respaldos to service_role;
grant all on all tables in schema respaldos to service_role;
