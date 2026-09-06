-- ============================================================================
--  Tablas que la app usaba sin que existieran (6 sep 2026)
--
--  pc_paquetes, pc_wa_chats y pc_wa_mensajes se llamaban desde hace meses
--  desde index.html y desde la Edge Function whatsapp-bot, pero nunca se
--  crearon: el SQL de supabase/sql/00-pendiente-todo.sql se aplico a medias
--  (pc_pagos_online si, pc_paquetes no). Consecuencias reales:
--    · Planes prepagados: la pestaña se veia bien pero nada se guardaba.
--    · Bandeja de WhatsApp: el bot no registraba chats ni mensajes, asi que
--      cada conversacion arrancaba sin historial y no quedaba rastro.
--
--  El esquema sale de lo que YA escriben la app y whatsapp-bot.
-- ============================================================================
create table if not exists public.pc_paquetes (
  id bigint primary key, mascota text not null, clienteid text, nombre text,
  banostotal integer default 0, banosusados integer default 0,
  precio numeric default 0, fecha date, vence date,
  estado text default 'activo', notas text
);
create index if not exists pc_paquetes_mascota_idx on public.pc_paquetes (lower(mascota));

create table if not exists public.pc_wa_chats (
  telefono text primary key, nombre text,
  bot boolean default true,            -- false = alguien tomo el control
  noleidos integer default 0,
  estado text default 'abierto',       -- abierto | escalado
  etiqueta text,                       -- motivo cuando el bot escala a humano
  ultimomensaje text, ultimafecha timestamptz, creado timestamptz default now()
);
create index if not exists pc_wa_chats_ultimafecha_idx on public.pc_wa_chats (ultimafecha desc nulls last);

create table if not exists public.pc_wa_mensajes (
  id bigint primary key, telefono text not null,
  waid text,                           -- id del mensaje en WhatsApp (anti-duplicado)
  rol text,                            -- cliente | bot | humano
  texto text, fecha timestamptz default now()
);
create index if not exists pc_wa_mensajes_telefono_idx on public.pc_wa_mensajes (telefono, id desc);
create index if not exists pc_wa_mensajes_waid_idx on public.pc_wa_mensajes (waid);

-- RLS con el modelo de roles de M3: las usa todo el personal (caja tiene la
-- pestaña de WhatsApp y registra ventas con planes prepagados).
do $$
declare t text;
begin
  foreach t in array array['pc_paquetes','pc_wa_chats','pc_wa_mensajes']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists pc_paquetes_todo on public.%I', t);
    execute format('drop policy if exists pc_personal on public.%I', t);
    execute format('create policy pc_personal on public.%I for all to authenticated
                      using ((select public.pc_es_personal()))
                      with check ((select public.pc_es_personal()))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname='supabase_realtime' and schemaname='public' and tablename='pc_paquetes') then
    execute 'alter publication supabase_realtime add table public.pc_paquetes';
  end if;
end $$;
