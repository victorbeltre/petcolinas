-- ============================================================================
--  PetColinas · TODO LO PENDIENTE DE SUPABASE, EN UN SOLO ARCHIVO
--
--  Orden importante: primero las tablas, despues el realtime (necesita que las
--  tablas existan). Se puede correr varias veces sin romper nada.
--
--  Falta aparte: supabase/sql/blindaje-facturas.sql (triggers de auditoria).
-- ============================================================================

-- ── 1. PLANES PREPAGADOS ────────────────────────────────────────────────────
create table if not exists public.pc_paquetes (
  id          bigint primary key,
  mascota     text not null,
  clienteid   text,
  nombre      text,
  banostotal  integer default 0,
  banosusados integer default 0,
  precio      numeric default 0,
  fecha       date,
  vence       date,
  estado      text default 'activo',
  notas       text
);

create index if not exists pc_paquetes_mascota_idx on public.pc_paquetes (lower(mascota));

alter table public.pc_paquetes enable row level security;
drop policy if exists pc_paquetes_todo on public.pc_paquetes;
create policy pc_paquetes_todo on public.pc_paquetes
  for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.pc_paquetes to authenticated;


-- ── 2. COBROS CON TARJETA (PAGADITO) ────────────────────────────────────────
-- Solo la Edge Function escribe aqui, con la llave de servicio. El navegador
-- ni escribe ni lee: los pagos no se tocan desde el cliente.
create table if not exists public.pc_pagos_online (
  id          bigint primary key,
  ern         text unique not null,
  ventaid     text,
  mascota     text,
  propietario text,
  monto       numeric default 0,
  moneda      text default 'USD',
  estado      text default 'iniciado',
  url         text,
  tokentrans  text,
  detalle     text,
  creadoen    timestamptz default now(),
  cerradoen   timestamptz
);

create index if not exists pc_pagos_online_ern_idx    on public.pc_pagos_online (ern);
create index if not exists pc_pagos_online_estado_idx on public.pc_pagos_online (estado, creadoen desc);

alter table public.pc_pagos_online enable row level security;
drop policy if exists pc_pagos_online_leer on public.pc_pagos_online;
create policy pc_pagos_online_leer on public.pc_pagos_online
  for select to authenticated
  using (
    lower(coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', ''))
      in ('admin@petcolinas.com', 'petcolinasrd@gmail.com')
  );
grant select on public.pc_pagos_online to authenticated;


-- ── 3. SINCRONIZACION EN VIVO ───────────────────────────────────────────────
-- REPLICA IDENTITY FULL: sin esto, en un UPDATE o DELETE solo viaja la llave
-- primaria y la app no sabe cual fila cambio de verdad.
do $$
declare t text;
begin
  foreach t in array array[
    'pc_ventas','pc_clientes','pc_citas','pc_facturas','pc_paquetes',
    'pc_seguimientos','pc_inventario','pc_gastos','pc_pagos',
    'pc_historias','pc_tarifas'
  ] loop
    if to_regclass('public.' || t) is null then
      raise notice 'La tabla % no existe todavia, se salta.', t;
      continue;
    end if;

    execute format('alter table public.%I replica identity full', t);

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'En vivo: %', t;
    else
      raise notice 'Ya estaba en vivo: %', t;
    end if;
  end loop;
end $$;


-- ── COMPROBACION FINAL ──────────────────────────────────────────────────────
select tablename as "tablas en vivo"
from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
order by tablename;
