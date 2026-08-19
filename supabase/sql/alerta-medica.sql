-- ============================================================================
--  PetColinas · ALERTA MEDICA EN LA FICHA DE LA MASCOTA
--  Una linea con lo que hay que saber ANTES de tocar a la mascota
--  (ej: "Es epileptico - no usar secadora ruidosa").
--
--  La app la muestra en un recuadro rojo en: Ventas, Factura nueva, el modal
--  de la Agenda, la ficha y la lista del CRM, y el facturador de los portales
--  de empleado. Junto a ella se muestran las alergias y las condiciones
--  cronicas que ya estaban en la ficha.
--
--  YA APLICADO en el proyecto de produccion (ulrzzddovkioxeaarnjk).
--  Se puede correr varias veces sin romper nada.
-- ============================================================================

alter table public.pc_clientes
  add column if not exists alertamedica text;

comment on column public.pc_clientes.alertamedica is
  'Alerta medica critica de la mascota, en una linea. Se muestra en rojo al facturar, registrar venta, abrir cita y en la ficha del CRM. Ej: "Es epileptico - no usar secadora ruidosa".';
