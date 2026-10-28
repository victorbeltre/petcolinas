-- ─────────────────────────────────────────────────────────────────────────────
-- M24 · Recetarios (28 oct 2026)
--
-- Seccion "Recetarios": recetas digitales sobre la plantilla de PetColinas
-- (receta-plantilla.jpg, hecha en Canva por Victor). Cada receta se guarda para
-- poder reabrirla, reimprimirla o duplicarla; el PDF se arma en el navegador y
-- no se guarda (se regenera igual desde estos campos).
-- Sin datos de clientes en el archivo: solo estructura.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.pc_recetas (
  id            bigint generated always as identity primary key,
  fecha         date not null default current_date,
  cliente_id    text,
  paciente      text not null,
  edad          text,
  sexo          text,
  especie       text,
  peso          text,
  diagnostico   text,
  indicaciones  text not null,
  medico        text,
  creado_por    text,
  created_at    timestamptz not null default now()
);
create index if not exists pc_recetas_fecha_idx on public.pc_recetas (fecha desc);
-- Regla Critica 6: RLS en la misma migracion. Todo el personal lee y escribe; anon nada.
alter table public.pc_recetas enable row level security;
revoke all on public.pc_recetas from anon;
grant select, insert, update, delete on public.pc_recetas to authenticated;
drop policy if exists pc_recetas_personal on public.pc_recetas;
create policy pc_recetas_personal on public.pc_recetas for all to authenticated
  using ((select public.pc_es_personal())) with check ((select public.pc_es_personal()));
