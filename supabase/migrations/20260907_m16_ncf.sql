-- ============================================================================
--  M16 · Comprobante fiscal (NCF) en las facturas (7 sep 2026)
--
--  Hasta ahora la factura de PetColinas era un papel bonito pero no un
--  comprobante fiscal: sin RNC del emisor y sin NCF, el cliente empresa no
--  puede deducir el gasto y el 606/607 hay que armarlo a mano fuera de la app.
--
--  Tres piezas:
--    pc_config            datos fiscales del negocio (RNC, razon social...).
--                         Antes vivian en window._petcolinasRNC, o sea que se
--                         escribian en Ajustes y se perdian al recargar.
--    pc_ncf_secuencias    los rangos que autorizo la DGII, uno por tipo.
--    pc_asignar_ncf(tipo) entrega el siguiente numero de forma ATOMICA.
--
--  Por que una funcion y no contar en el navegador: el update con RETURNING
--  bloquea la fila, asi que dos personas facturando al mismo tiempo reciben
--  numeros distintos. Contando en JavaScript (leer, sumar, guardar) las dos
--  verian el mismo, y un NCF repetido tumba el 607 completo — que es algo que
--  no se descubre hasta el dia 20 del mes siguiente.
--
--  Idempotente. Este archivo documenta lo que ya esta aplicado en produccion.
-- ============================================================================

-- 1) Datos fiscales del negocio ---------------------------------------------
create table if not exists public.pc_config (
  clave       text primary key,
  valor       text,
  nota        text,
  actualizado timestamptz default now()
);
alter table public.pc_config enable row level security;

insert into public.pc_config (clave, valor, nota) values
  ('rnc',           '133-71409-4',                            'RNC de PetColinas SRL. Sale impreso en la factura.'),
  ('razon_social',  'PetColinas SRL',                         'Nombre fiscal, para el comprobante.'),
  ('direccion',     'Plaza Las Colinas, Santo Domingo Oeste',  'Direccion fiscal.'),
  ('telefono',      '809-752-6806',                           'Telefono que sale en la factura.')
on conflict (clave) do nothing;

-- Todo el personal lee (la factura la emite caja, no solo el admin); escribir
-- los datos fiscales del negocio es cosa del admin.
drop policy if exists pc_config_leer on public.pc_config;
create policy pc_config_leer on public.pc_config for select to authenticated
  using ((select public.pc_es_personal()));
drop policy if exists pc_config_admin on public.pc_config;
create policy pc_config_admin on public.pc_config for all to authenticated
  using ((select public.pc_es_admin())) with check ((select public.pc_es_admin()));

-- 2) Rangos autorizados por la DGII -----------------------------------------
-- Una fila por tipo: la DGII autoriza un rango a la vez para cada comprobante.
create table if not exists public.pc_ncf_secuencias (
  tipo        text primary key check (tipo in ('B01','B02','B04','B14','B15')),
  descripcion text,
  desde       bigint not null,
  hasta       bigint not null,
  siguiente   bigint not null,
  vence       date,           -- fecha de vencimiento de la autorizacion
  activa      boolean default true,
  actualizado timestamptz default now(),
  check (siguiente >= desde)
);
alter table public.pc_ncf_secuencias enable row level security;

drop policy if exists pc_ncf_leer on public.pc_ncf_secuencias;
create policy pc_ncf_leer on public.pc_ncf_secuencias for select to authenticated
  using ((select public.pc_es_personal()));
drop policy if exists pc_ncf_admin on public.pc_ncf_secuencias;
create policy pc_ncf_admin on public.pc_ncf_secuencias for all to authenticated
  using ((select public.pc_es_admin())) with check ((select public.pc_es_admin()));

-- Regla Critica 6: ninguna tabla nueva queda alcanzable con la llave publica.
-- RLS ya la protege (no hay politica para anon), pero el grant sobraba.
revoke all on public.pc_config from anon;
revoke all on public.pc_ncf_secuencias from anon;

-- 3) El comprobante en la factura -------------------------------------------
alter table public.pc_facturas add column if not exists ncf        text;
alter table public.pc_facturas add column if not exists ncftipo    text;
alter table public.pc_facturas add column if not exists rnccliente text;
-- Un mismo NCF no puede aparecer en dos facturas. El indice es parcial porque
-- la inmensa mayoria de las facturas historicas no tienen comprobante y null
-- no debe chocar con null.
create unique index if not exists pc_facturas_ncf_unico
  on public.pc_facturas (ncf) where (ncf is not null and ncf <> '');

-- 4) Asignar el siguiente numero --------------------------------------------
create or replace function public.pc_asignar_ncf(p_tipo text)
returns text language plpgsql security definer set search_path = public as $$
declare v_sig bigint; v_hasta bigint; v_vence date; v_activa boolean;
begin
  if not public.pc_es_personal() then
    raise exception 'No autorizado para asignar NCF';
  end if;

  -- Este update bloquea la fila. Si dos personas facturan a la vez, cada una
  -- recibe un numero distinto. Hacerlo en el navegador (leer, sumar, guardar)
  -- habria entregado el mismo NCF dos veces, que ante la DGII es un problema.
  update public.pc_ncf_secuencias
     set siguiente = siguiente + 1, actualizado = now()
   where tipo = p_tipo
   returning siguiente - 1, hasta, vence, activa
   into v_sig, v_hasta, v_vence, v_activa;

  -- Cualquier raise de aqui en adelante revierte el incremento de arriba: la
  -- subtransaccion se deshace entera, asi que no queda hueco en la secuencia.
  if v_sig is null then
    raise exception 'No hay secuencia configurada para el tipo %', p_tipo;
  end if;
  if not v_activa then
    raise exception 'La secuencia % esta desactivada', p_tipo;
  end if;
  if v_sig > v_hasta then
    raise exception 'Se acabaron los NCF del tipo %. Hay que pedir una secuencia nueva a la DGII.', p_tipo;
  end if;
  if v_vence is not null and v_vence < current_date then
    raise exception 'La autorizacion de los NCF % vencio el %', p_tipo, v_vence;
  end if;

  return p_tipo || lpad(v_sig::text, 8, '0');
end $$;

-- Toda funcion nace con EXECUTE para PUBLIC (ver M3): hay que quitarselo.
revoke all on function public.pc_asignar_ncf(text) from public, anon;
grant execute on function public.pc_asignar_ncf(text) to authenticated, service_role;

-- ── Lo que falta y NO se puede hacer por SQL ────────────────────────────────
-- Cargar el rango REAL autorizado por la DGII. Se hace desde la app
-- (Dashboard → Datos fiscales → "Registrar un rango nuevo") con los numeros
-- que salen de la Oficina Virtual. Inventarlos aqui seria emitir comprobantes
-- que la DGII no reconoce, que es peor que no emitir ninguno.
