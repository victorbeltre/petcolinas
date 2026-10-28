-- ─────────────────────────────────────────────────────────────────────────────
-- M26 · Ordenes de compra (29 oct 2026)
--
-- Seccion "Ordenes de compra" al estilo de Alegra: proveedor (identificacion y
-- telefono), fecha y fecha de entrega, lineas con concepto, precio, descuento,
-- impuesto, cantidad y observaciones, terminos, notas (salen impresas) y
-- comentarios (internos, NO salen impresos). Se envia al proveedor en PDF o por
-- WhatsApp y, al llegar la mercancia, "Recibir" la suma al inventario.
-- Solo-admin: lleva costos. Numero OC-0001 por secuencia de la base.
-- Sin datos de clientes ni proveedores en el archivo: solo estructura.
-- ─────────────────────────────────────────────────────────────────────────────
create sequence if not exists public.pc_ordenes_compra_numero_seq;

create table if not exists public.pc_ordenes_compra (
  id             bigint generated always as identity primary key,
  numero         bigint not null unique default nextval('public.pc_ordenes_compra_numero_seq'),
  fecha          date not null default current_date,
  entrega        date,
  proveedor      text not null,
  identificacion text,
  telefono       text,
  items          jsonb not null default '[]'::jsonb,
  subtotal       numeric(12,2) not null default 0,
  descuento      numeric(12,2) not null default 0,
  impuestos      numeric(12,2) not null default 0,
  total          numeric(12,2) not null default 0,
  terminos       text,
  notas          text,
  comentarios    text,
  estado         text not null default 'borrador'
                 check (estado in ('borrador', 'enviada', 'recibida', 'cancelada')),
  recibida_en    timestamptz,
  creado_por     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter sequence public.pc_ordenes_compra_numero_seq owned by public.pc_ordenes_compra.numero;
create index if not exists pc_ordenes_compra_fecha_idx on public.pc_ordenes_compra (fecha desc);

-- Regla Critica 6: RLS en la misma migracion. Solo el administrador (costos).
alter table public.pc_ordenes_compra enable row level security;
revoke all on public.pc_ordenes_compra from anon;
grant select, insert, update, delete on public.pc_ordenes_compra to authenticated;
grant usage on sequence public.pc_ordenes_compra_numero_seq to authenticated;
drop policy if exists pc_ordenes_compra_admin on public.pc_ordenes_compra;
create policy pc_ordenes_compra_admin on public.pc_ordenes_compra for all to authenticated
  using ((select public.pc_es_admin())) with check ((select public.pc_es_admin()));
