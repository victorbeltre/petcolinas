-- ─────────────────────────────────────────────────────────────────────────────
-- M34 · Gastos: mes al que corresponde (4 nov 2026)
--
-- Un gasto tiene fecha de pago y mes de correspondencia. El alquiler de octubre
-- pagado el 1 de noviembre va a octubre; la nomina de octubre pagada el 1 de
-- noviembre tambien. Vacio = el mes de la fecha. Sin montos en este archivo.
-- pc_gastos ya tiene RLS (no se toca).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.pc_gastos add column if not exists mes_correspondiente text;
