-- ─────────────────────────────────────────────────────────────────────────────
-- M25 · Cotizaciones (29 oct 2026)
--
-- Seccion "Cotizaciones" al estilo de Alegra: cliente, fecha de creacion y de
-- vencimiento, lineas de productos o servicios (cantidad, precio, descuento,
-- ITBIS), retenciones, notas y terminos. Se descarga en PDF, se envia por
-- WhatsApp y, si el cliente acepta, se convierte en venta (pendiente de cobro).
--
-- El numero (COT-0001, COT-0002...) lo pone la BASE con una secuencia, para que
-- dos personas creando cotizaciones a la vez no saquen el mismo.
-- Sin datos de clientes en el archivo: solo estructura.
-- ─────────────────────────────────────────────────────────────────────────────
create sequence if not exists public.pc_cotizaciones_numero_seq;

create table if not exists public.pc_cotizaciones (
  id             bigint generated always as identity primary key,
  numero         bigint not null unique default nextval('public.pc_cotizaciones_numero_seq'),
  fecha          date not null default current_date,
  vence          date,
  cliente_id     text,
  cliente_nombre text not null,
  telefono       text,
  mascota        text,
  items          jsonb not null default '[]'::jsonb,
  retenciones    jsonb not null default '[]'::jsonb,
  subtotal       numeric(12,2) not null default 0,
  descuento      numeric(12,2) not null default 0,
  impuestos      numeric(12,2) not null default 0,
  retenido       numeric(12,2) not null default 0,
  total          numeric(12,2) not null default 0,
  notas          text,
  terminos       text,
  estado         text not null default 'borrador'
                 check (estado in ('borrador', 'enviada', 'aceptada', 'rechazada', 'facturada')),
  venta_id       text,
  creado_por     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter sequence public.pc_cotizaciones_numero_seq owned by public.pc_cotizaciones.numero;
create index if not exists pc_cotizaciones_fecha_idx on public.pc_cotizaciones (fecha desc);

-- Regla Critica 6: RLS en la misma migracion. Todo el personal; anon nada.
alter table public.pc_cotizaciones enable row level security;
revoke all on public.pc_cotizaciones from anon;
grant select, insert, update, delete on public.pc_cotizaciones to authenticated;
grant usage on sequence public.pc_cotizaciones_numero_seq to authenticated;
drop policy if exists pc_cotizaciones_personal on public.pc_cotizaciones;
create policy pc_cotizaciones_personal on public.pc_cotizaciones for all to authenticated
  using ((select public.pc_es_personal())) with check ((select public.pc_es_personal()));
