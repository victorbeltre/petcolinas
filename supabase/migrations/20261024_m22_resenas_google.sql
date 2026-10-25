-- ─────────────────────────────────────────────────────────────────────────────
-- M22 · Campaña de reseñas en Google (24 oct 2026)
--
-- Victor quiere pedirle la reseña a TODOS los clientes, no solo a los que acaban
-- de recoger su mascota, y que la doctora tambien pueda ir mandandolas en sus
-- ratos libres. Los mensajes salen por wa.me (se abre el chat y se manda a
-- mano), uno por dueño (agrupado por telefono).
--
-- Esta tabla es lo unico que hace falta guardar: a quien ya se le escribio,
-- quien ya dejo la reseña y a quien no hay que volver a escribirle. Si viviera en
-- localStorage, el admin y la doctora le escribirian dos veces al mismo cliente
-- desde dos telefonos — justo lo que hace que un mensaje deje de sentirse
-- personal. Una fila por TELEFONO (10 digitos), no por mascota: el dueño de
-- Toby y Luna recibe un solo mensaje.
--
-- Sin datos de clientes en el archivo (regla 4 del README): solo la estructura.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.pc_resenas (
  telefono      text primary key check (telefono ~ '^\d{10}$'),
  estado        text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'reseno', 'no_contactar')),
  envios        int  not null default 0 check (envios >= 0),
  ultimo_envio  timestamptz,
  enviado_por   text,
  actualizado   timestamptz not null default now()
);
-- Regla Critica 6: RLS en la misma migracion. Todo el personal (la doctora
-- incluida) lee y escribe; anon no ve nada.
alter table public.pc_resenas enable row level security;
revoke all on public.pc_resenas from anon;
grant select, insert, update on public.pc_resenas to authenticated;
drop policy if exists pc_resenas_personal on public.pc_resenas;
create policy pc_resenas_personal on public.pc_resenas for all to authenticated
  using ((select public.pc_es_personal())) with check ((select public.pc_es_personal()));
