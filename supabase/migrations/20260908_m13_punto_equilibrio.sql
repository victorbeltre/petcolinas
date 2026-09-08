-- ============================================================================
--  M13 · El punto de equilibrio deja de estar escrito a mano (8 sep 2026)
--
--  Estaba en el codigo, en tres sitios, y con DOS valores distintos: el
--  Dashboard media contra 203.739 (el real) y Reportes contra 125.000. O sea
--  que la pestaña de Reportes felicitaba por "superar el punto de equilibrio"
--  meses que en realidad iban casi 80 mil por debajo — justo la pantalla que
--  se mira para decidir.
--
--  Ahora hay un solo numero y vive aqui, para poder cambiarlo cuando cambie el
--  alquiler o la nomina sin tocar una linea de codigo.
-- ============================================================================

insert into public.pc_config (clave, valor, nota) values
  ('punto_equilibrio', '203739',
   'Lo que hay que vender al mes para no perder dinero. Reportes y Dashboard miden contra esto.')
on conflict (clave) do nothing;
