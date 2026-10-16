-- ─────────────────────────────────────────────────────────────────────────────
-- M21 · Resultados de laboratorio (hemograma) en la Evolucion del paciente
--
-- Se sube el informe del laboratorio (PDF/foto); la Edge Function `lab-extraer`
-- lo TRANSCRIBE con IA; una persona lo REVISA contra el original; y se genera un
-- PDF con la identidad de PetColinas conservando los datos del laboratorio.
--
-- Todo es solo-personal (admin, vet, groomer, caja), igual que pc_historias.
-- El original va a un bucket PRIVADO: se ve con un enlace firmado de 5 minutos,
-- nunca publico. `datos` guarda lo que la persona confirmo, no lo que leyo la
-- IA: la fuente de verdad es lo revisado, y el PDF se puede regenerar de ahi.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.pc_lab_resultados (
  id             text primary key,
  clienteid      text not null,
  fecha          date,
  tipo           text not null default 'hemograma',
  laboratorio    text,
  datos          jsonb not null,
  original_path  text,
  original_mime  text,
  verificado_por text,
  creado         timestamptz default now()
);
alter table public.pc_lab_resultados enable row level security;
revoke all on public.pc_lab_resultados from anon;
grant select, insert, update, delete on public.pc_lab_resultados to authenticated;
create index if not exists pc_lab_resultados_cliente_idx on public.pc_lab_resultados (clienteid);
drop policy if exists "pc_personal" on public.pc_lab_resultados;
create policy "pc_personal" on public.pc_lab_resultados for all to authenticated
  using ((select public.pc_es_personal())) with check ((select public.pc_es_personal()));

-- Bucket privado, 10 MB, solo PDF e imagenes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('laboratorios','laboratorios', false, 10485760,
        array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
drop policy if exists "laboratorios personal lee" on storage.objects;
create policy "laboratorios personal lee" on storage.objects for select to authenticated
  using (bucket_id = 'laboratorios' and (select public.pc_es_personal()));
drop policy if exists "laboratorios personal sube" on storage.objects;
create policy "laboratorios personal sube" on storage.objects for insert to authenticated
  with check (bucket_id = 'laboratorios' and (select public.pc_es_personal()));
-- Sin politica de update/delete a proposito: un original subido no se sobrescribe
-- ni se borra desde la app.

-- Pendiente de Victor: guardar ANTHROPIC_API_KEY como secreto de Edge Functions
-- (Supabase > Edge Functions > Secrets). Sin ella lab-extraer responde 503 con un
-- mensaje claro y la pantalla lo muestra.
