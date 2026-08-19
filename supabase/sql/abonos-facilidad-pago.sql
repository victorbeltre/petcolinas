-- ============================================================================
--  PetColinas · ABONOS (facilidad de pago) Y DEVUELTA EN EFECTIVO
--
--  El cliente puede pagar el servicio a plazos: deja una parte hoy y se apunta
--  la fecha en la que hay que escribirle para que termine de saldar.
--
--  El total de la venta NO se toca (es el precio del servicio). Lo que se mueve
--  es cuanto lleva abonado; el saldo es la resta.
--
--  Cada abono guarda SU fecha y SU forma de pago a proposito: el servicio pudo
--  ser el lunes y el abono entrar el viernes, y el efectivo del cajon tiene que
--  cuadrar con el cierre de caja del VIERNES, no con el del lunes.
--
--  YA APLICADO en el proyecto de produccion (ulrzzddovkioxeaarnjk).
--  Se puede correr varias veces sin romper nada.
-- ============================================================================

alter table public.pc_ventas add column if not exists abonos jsonb default '[]'::jsonb;
alter table public.pc_ventas add column if not exists abonado numeric default 0;
alter table public.pc_ventas add column if not exists fecharecordatorio text;

comment on column public.pc_ventas.abonos is
  'Historial de pagos parciales: [{fecha, monto, forma, banco, por}]. Cada abono entra al cierre de caja del dia en que se pago.';
comment on column public.pc_ventas.abonado is
  'Suma de los abonos. El saldo pendiente es total - abonado.';
comment on column public.pc_ventas.fecharecordatorio is
  'Fecha en la que hay que escribirle al cliente para que termine de saldar.';
