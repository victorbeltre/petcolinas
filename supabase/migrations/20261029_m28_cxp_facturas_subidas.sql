-- ─────────────────────────────────────────────────────────────────────────────
-- M28 · Cuentas por pagar: subir la factura del proveedor (29 oct 2026)
--
-- Victor pidio poder SUBIR la factura (foto o PDF) en Cuentas por pagar y que se
-- registren todos sus datos, sin olvidar la fecha de VENCIMIENTO. La Edge
-- Function `factura-proveedor` (la misma de Inventario, M23) lee proveedor, RNC,
-- numero, NCF, fecha, vencimiento, plazo de credito, subtotal, ITBIS, total y
-- conceptos; el admin lo revisa y guarda. La factura original queda guardada
-- para consultarla despues (bucket privado, enlace firmado de 5 minutos).
--
-- Requiere M27 (pc_cuentas_pagar). Solo-admin, igual que M27: son deudas y costos.
-- Sin datos de proveedores en el archivo: solo estructura.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.pc_cuentas_pagar add column if not exists subtotal     numeric(12,2);
alter table public.pc_cuentas_pagar add column if not exists itbis        numeric(12,2);
alter table public.pc_cuentas_pagar add column if not exists condiciones  text;
alter table public.pc_cuentas_pagar add column if not exists items        jsonb not null default '[]'::jsonb;
alter table public.pc_cuentas_pagar add column if not exists archivo_path text;
alter table public.pc_cuentas_pagar add column if not exists archivo_mime text;

-- Regla Critica 6: la tabla ya tiene RLS (M27); se repite por si acaso.
alter table public.pc_cuentas_pagar enable row level security;

-- Bucket privado, 10 MB, solo PDF e imagenes. Solo el admin lee y sube.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('facturas-proveedores', 'facturas-proveedores', false, 10485760,
        array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
drop policy if exists "facturas proveedores admin lee" on storage.objects;
create policy "facturas proveedores admin lee" on storage.objects for select to authenticated
  using (bucket_id = 'facturas-proveedores' and (select public.pc_es_admin()));
drop policy if exists "facturas proveedores admin sube" on storage.objects;
create policy "facturas proveedores admin sube" on storage.objects for insert to authenticated
  with check (bucket_id = 'facturas-proveedores' and (select public.pc_es_admin()));
-- Sin update/delete a proposito: una factura subida no se sobrescribe ni se
-- borra desde la app (es el soporte del gasto).
