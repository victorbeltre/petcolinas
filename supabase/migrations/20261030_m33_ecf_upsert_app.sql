-- ============================================================================
--  M33 · e-CF compatible con el guardado de la app (30 oct 2026)
--
--  La app guarda facturas con upsert (INSERT ... ON CONFLICT DO UPDATE). En
--  Postgres el trigger BEFORE INSERT corre ANTES de detectar el conflicto, así
--  que volver a guardar una factura que ya tiene e-NCF (por ejemplo, al cambiar
--  sus notas) chocaba con «El e-NCF lo asigna el servidor». Ahora:
--    · el trigger de insert deja pasar la fila si ya existe (el de update la
--      protege: conserva el e-NCF y su estado);
--    · las líneas se comparan como JSON y no como texto, para que el mismo
--      contenido escrito con otro formato no se tome como un cambio.
-- ============================================================================
create or replace function public.pc_proteger_factura_ecf_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('pc.ecf_servidor', true), '') <> '1'
     and (new.ncf like 'E%' or new.ecf_estado is not null)
     and not exists (select 1 from public.pc_facturas x where x.id = new.id) then
    raise exception using errcode = '42501', message = 'El e-NCF lo asigna el servidor.';
  end if;
  return new;
end $$;
revoke all on function public.pc_proteger_factura_ecf_insert() from public, anon, authenticated;

create or replace function public.pc_items_json(p text)
returns jsonb language plpgsql immutable set search_path = '' as $$
begin
  return coalesce(nullif(p, ''), '[]')::jsonb;
exception when others then return to_jsonb(p);
end $$;
revoke all on function public.pc_items_json(text) from public, anon;

create or replace function public.pc_proteger_factura_ecf()
returns trigger language plpgsql set search_path = '' as $$
declare v_servidor boolean := coalesce(current_setting('pc.ecf_servidor', true), '') = '1';
begin
  if v_servidor then return new; end if;
  if old.ncf is not null and old.ncf <> '' then
    -- El comprobante ya entregado no se cambia ni se borra desde la app.
    new.ncf := old.ncf; new.ncftipo := old.ncftipo; new.rnccliente := old.rnccliente;
  end if;
  if old.ncf like 'E%' then
    new.ecf_estado := old.ecf_estado; new.ecf_origen := old.ecf_origen;
    new.ecf_codigo_seguridad := old.ecf_codigo_seguridad; new.ecf_qr_url := old.ecf_qr_url;
    new.ecf_fecha_firma := old.ecf_fecha_firma; new.ecf_track_id := old.ecf_track_id;
    new.ecf_mensaje := old.ecf_mensaje; new.ecf_intentos := old.ecf_intentos; new.ecf_actualizado := old.ecf_actualizado;
    if coalesce(old.ecf_estado, '') <> 'rechazado'
       and (public.pc_items_json(new.items) is distinct from public.pc_items_json(old.items)
            or new.total is distinct from old.total
            or new.subtotal is distinct from old.subtotal or new.itbisamt is distinct from old.itbisamt
            or new.fecha is distinct from old.fecha or new.itbis is distinct from old.itbis) then
      raise exception using errcode = '22023',
        message = 'Esta factura ya tiene comprobante electrónico: no se cambian líneas, montos ni fecha. Para corregirla emite una nota de crédito.',
        hint = 'pc_ecf_inmutable';
    end if;
    -- Mismas líneas en otro formato: se conserva el texto original. Lo que no
    -- es fiscal (notas, teléfono) sí se guarda.
    if coalesce(old.ecf_estado, '') <> 'rechazado' then new.items := old.items; end if;
  elsif new.ncf like 'E%' then
    -- Nadie se inventa un e-NCF desde el navegador.
    raise exception using errcode = '42501', message = 'El e-NCF lo asigna el servidor.';
  end if;
  return new;
end $$;
revoke all on function public.pc_proteger_factura_ecf() from public, anon, authenticated;
