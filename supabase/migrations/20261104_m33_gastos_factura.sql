-- ─────────────────────────────────────────────────────────────────────────────
-- M33 · Factura de compra al contado en Gastos (4 nov 2026)
--
-- Gastos -> "Subir factura de compra al contado": desechables, papel, limpieza...
-- El archivo de la factura queda en el bucket privado `facturas-proveedores`
-- (el mismo de M28, solo-admin) y aqui solo se guarda su ruta y su tipo.
-- pc_gastos ya tiene RLS (no se toca). La app manda estas columnas solo si
-- existen, asi que el registro sigue funcionando si esta migracion no se ha corrido.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.pc_gastos
  add column if not exists archivo_path text,
  add column if not exists archivo_mime text;
