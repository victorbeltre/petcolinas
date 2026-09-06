-- Vuelve al estado anterior a M3: una sola politica using(true) para
-- authenticated en cada tabla. Solo para emergencias (p.ej. un rol se quedo
-- sin poder trabajar). No borra pc_usuarios_rol ni las funciones.
do $$
declare t text;
begin
  foreach t in array array['pc_clientes','pc_citas','pc_seguimientos','pc_inventario',
                           'pc_tarifas','pc_historias','pc_fichas_clinicas','pc_depositos',
                           'pc_ventas','pc_facturas','pc_llamadas','pc_gastos','pc_empleados',
                           'pc_candidatos','pc_ventas_blocklist','pc_pagos','pc_auditoria']
  loop
    execute format('drop policy if exists pc_personal on public.%I', t);
    execute format('drop policy if exists pc_solo_admin on public.%I', t);
    execute format('drop policy if exists pc_pagos_admin on public.%I', t);
    execute format('drop policy if exists pc_pagos_propios on public.%I', t);
    execute format('drop policy if exists pc_auditoria_insertar on public.%I', t);
    execute format('drop policy if exists pc_auditoria_admin on public.%I', t);
    execute format('drop policy if exists pc_auth_all on public.%I', t);
    execute format('create policy pc_auth_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
drop policy if exists pc_pagos_online_leer on public.pc_pagos_online;
create policy pc_pagos_online_leer on public.pc_pagos_online for select to authenticated
  using (lower(coalesce((select auth.jwt() ->> 'email'), '')) = any (array['admin@petcolinas.com','petcolinasrd@gmail.com']));
