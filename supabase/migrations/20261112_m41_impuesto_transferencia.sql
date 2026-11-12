-- M41 (12 nov 2026): impuesto de 0.20% por transferencia bancaria.
--
-- Cada egreso registrado en pc_gastos con formapago = 'transferencia' lleva un
-- gasto "hermano" con el impuesto del banco (0.20% del monto), en la categoria
-- 'impuestos'. El hermano tiene id = 'imp' || id_del_gasto, asi que siempre se
-- puede localizar y no se duplica.
--
-- Va en un TRIGGER sobre pc_gastos (y no en la app) para que cubra todas las
-- vias por las que entra un egreso: Gastos, facturas de compra, gastos fijos,
-- cuentas por pagar y nomina. Al cambiar o borrar el gasto, el hermano se
-- actualiza o se borra solo.
--
-- No crea tablas nuevas, asi que no requiere RLS. La tasa vive aqui y en la
-- constante IMPUESTO_TRANSFERENCIA de index.html: si cambia, cambiar ambas.

create or replace function public.pc_gasto_impuesto_sync() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.categoria is distinct from 'impuestos' then
      delete from public.pc_gastos where id = 'imp' || old.id;
    end if;
    return old;
  end if;

  -- El propio impuesto no genera otro impuesto.
  if new.categoria = 'impuestos' then
    return new;
  end if;

  if lower(coalesce(new.formapago, '')) = 'transferencia' and coalesce(new.monto, 0) > 0 then
    insert into public.pc_gastos (id, fecha, categoria, descripcion, monto, formapago, proveedor, pagadopor, mes_correspondiente)
    values ('imp' || new.id, new.fecha, 'impuestos',
            'Impuesto 0.20% por transferencia — ' || coalesce(new.descripcion, ''),
            round(new.monto * 0.002, 2), 'transferencia', 'Banco',
            coalesce(new.pagadopor, 'Petcolinas'), new.mes_correspondiente)
    on conflict (id) do update set
      fecha = excluded.fecha,
      descripcion = excluded.descripcion,
      monto = excluded.monto,
      mes_correspondiente = excluded.mes_correspondiente;
  else
    -- Ya no es transferencia (o monto cero): el impuesto deja de aplicar.
    delete from public.pc_gastos where id = 'imp' || new.id;
  end if;
  return new;
end $$;

drop trigger if exists pc_gastos_impuesto_transferencia on public.pc_gastos;
create trigger pc_gastos_impuesto_transferencia
  after insert or update or delete on public.pc_gastos
  for each row execute function public.pc_gasto_impuesto_sync();
