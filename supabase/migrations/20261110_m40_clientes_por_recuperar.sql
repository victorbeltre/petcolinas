-- ─────────────────────────────────────────────────────────────────────────────
-- M40 · Clientes por recuperar (10 nov 2026)
--
-- Clientes recurrentes que dejaron de venir (45, 60, 90+ dias sin visita). La
-- lista se calcula en la app con las ventas; aqui solo se guarda a quien ya se
-- le escribio y a quien no hay que escribirle, para que dos personas del equipo
-- no le manden el mismo mensaje. Una fila por TELEFONO (10 digitos), igual que
-- pc_resenas (M22).
--
-- Sin datos de clientes en el archivo: solo la estructura.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.pc_recuperar (
  telefono      text primary key check (telefono ~ '^\d{10}$'),
  estado        text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'no_contactar')),
  envios        int  not null default 0 check (envios >= 0),
  ultimo_envio  timestamptz,
  enviado_por   text,
  actualizado   timestamptz not null default now()
);
-- Regla Critica 6: RLS en la misma migracion. Todo el personal lee y escribe; anon no ve nada.
alter table public.pc_recuperar enable row level security;
revoke all on public.pc_recuperar from anon;
grant select, insert, update on public.pc_recuperar to authenticated;
drop policy if exists pc_recuperar_personal on public.pc_recuperar;
create policy pc_recuperar_personal on public.pc_recuperar for all to authenticated
  using ((select public.pc_es_personal())) with check ((select public.pc_es_personal()));
