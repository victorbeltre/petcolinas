-- ─────────────────────────────────────────────────────────────────────────────
-- M27 · Cuentas por pagar (29 oct 2026)
--
-- Seccion "Cuentas por pagar" al estilo del reporte de Alegra: facturas de
-- proveedores pendientes de pago, con antiguedad (vencidas 1-30, 31-60, 61-90,
-- 91+ dias y no vencidas), total por pagar y detalle por documento.
-- Cada abono queda en `pagos` (jsonb) y suma en `pagado`. Al pagar, la app
-- puede anotar el pago como gasto (categoria "Proveedores") para que salga del
-- flujo de caja; NO como "Inventario", porque esa categoria crea productos.
-- `origen` enlaza con lo que la creo ("OC-0003", "compra:12") para no
-- registrar dos veces la misma compra.
-- Solo-admin: deudas y costos. Sin datos de proveedores en el archivo.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.pc_cuentas_pagar (
  id             bigint generated always as identity primary key,
  tipo           text not null default 'factura_proveedor'
                 check (tipo in ('factura_proveedor', 'servicio', 'prestamo', 'otro')),
  numero         text,
  ncf            text,
  proveedor      text not null,
  identificacion text,
  fecha          date not null default current_date,
  vence          date,
  total          numeric(12,2) not null check (total >= 0),
  pagado         numeric(12,2) not null default 0 check (pagado >= 0),
  pagos          jsonb not null default '[]'::jsonb,
  notas          text,
  origen         text,
  anulada        boolean not null default false,
  creado_por     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists pc_cuentas_pagar_vence_idx on public.pc_cuentas_pagar (vence);
create unique index if not exists pc_cuentas_pagar_origen_uk on public.pc_cuentas_pagar (origen) where origen is not null and not anulada;

-- Regla Critica 6: RLS en la misma migracion. Solo el administrador.
alter table public.pc_cuentas_pagar enable row level security;
revoke all on public.pc_cuentas_pagar from anon;
grant select, insert, update, delete on public.pc_cuentas_pagar to authenticated;
drop policy if exists pc_cuentas_pagar_admin on public.pc_cuentas_pagar;
create policy pc_cuentas_pagar_admin on public.pc_cuentas_pagar for all to authenticated
  using ((select public.pc_es_admin())) with check ((select public.pc_es_admin()));
