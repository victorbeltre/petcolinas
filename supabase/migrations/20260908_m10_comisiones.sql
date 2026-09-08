-- ============================================================================
--  M10 · Los porcentajes de comision salen del codigo (8 sep 2026)
--
--  Estaban escritos a mano en quince sitios de index.html. Subir la comision de
--  grooming un punto obligaba a encontrarlos todos y no olvidar ninguno — y
--  olvidar uno es pagarle mal a alguien y no enterarse hasta que reclame.
--
--  Se guardan como numero entero de porcentaje ("30" = 30%). La app tambien
--  entiende "0.30", porque es facil escribirlo asi.
--
--  OJO: cambiar estos valores NO recalcula lo ya pagado. Aplican a las ventas
--  que no traen comision propia, de aqui en adelante. Las comisiones que ya
--  estan escritas en cada venta (columna `comision`) mandan siempre.
-- ============================================================================

insert into public.pc_config (clave, valor, nota) values
  ('comision_grooming',       '12', 'Comision de grooming cuando la venta no trae la suya.'),
  ('comision_vet',            '30', 'Comision de veterinaria (Naylan y el historico de Aylein).'),
  ('comision_vet_valentina',  '40', 'Comision de la Dra. Valentina, que trabaja por llamado.'),
  ('comision_farmacia',        '5', 'Comision de farmacia, sobre la GANANCIA neta (precio - costo), no sobre la venta.')
on conflict (clave) do nothing;
