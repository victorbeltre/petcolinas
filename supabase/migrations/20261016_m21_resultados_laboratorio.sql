-- ─────────────────────────────────────────────────────────────────────────────
-- M21 · Resultados de laboratorio (hemograma) en la Evolucion del paciente
--
-- Se sube el informe del laboratorio (PDF o foto) y se le pone la marca de PetColinas
-- ENCIMA. Los resultados NO se leen ni se reescriben: el documento se usa como
-- IMAGEN (cada numero son los pixeles del laboratorio), asi que no hay forma de
-- que un valor cambie. Solo se recorta el fondo, se CUBRE el logo del laboratorio
-- con un recuadro blanco y, opcionalmente, se tiñe el texto de azul marino.
--
-- Una version anterior leia el documento (IA, luego OCR) y reescribia los valores:
-- al probarla con una foto cambio resultados. Se elimino por completo; una prueba
-- de render-check falla si reaparece cualquier lectura.
--
-- Todo es solo-personal (admin, vet, groomer, caja), igual que pc_historias.
-- Se guardan DOS archivos en un bucket PRIVADO (enlace firmado de 5 minutos, nunca
-- publico): el original tal cual y el PDF PetColinas ya generado. El PDF no se
-- regenera: lo que se guardo es lo que se vio. `datos` solo anota que se hizo
-- (paginas, si se cubrio el logo, si se tiño, si se recorto).
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.pc_lab_resultados (  -- pdf_path se anade abajo
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
alter table public.pc_lab_resultados add column if not exists pdf_path text;
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

-- La Edge Function `lab-extraer` (primera version, con IA) sigue DESPLEGADA pero
-- huerfana: nadie la llama. Borrarla desde Supabase > Edge Functions.
