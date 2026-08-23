# Base de datos de VetMake — Fase 1

## Estado: diseño listo, sin aplicar en ningún lado

Estas migraciones **no se han corrido en ningún proyecto de Supabase
real**. No existe todavía un proyecto de Supabase para VetMake — el de
PetColinas (`ulrzzddovkioxeaarnjk`) sigue siendo solo de PetColinas, sin
tocar.

Provisionar un proyecto nuevo (aunque sea de prueba) es una decisión que
le toca a Victor antes de seguir: tiene costo potencial y crea
infraestructura real ligada a su cuenta. Cuando la dé, el siguiente paso
es aplicar `0001` y luego `0002` ahí, no en el de PetColinas.

## Los archivos

| Archivo | Qué hace |
|---|---|
| `migrations/0001_negocios_y_membresia.sql` | La fundación: tabla `negocios`, tabla `usuarios_negocio`, función `mi_negocio()`. Se aplica una sola vez. |
| `migrations/0002_negocio_id_pc_clientes_ejemplo.sql` | El patrón completo — agregar `negocio_id`, quitar las políticas de un solo negocio, crear las 4 políticas multi-tenant (select/insert/update/delete) — aplicado a `pc_clientes` como ejemplo trabajado. |

## El patrón a repetir

`0002` se hizo sobre `pc_clientes` porque es la tabla que ya se conoce a
fondo (el diagnóstico del bug de RLS del 23 ago). Para el resto de las
tablas de PetColinas (`pc_ventas`, `pc_facturas`, `pc_inventario`,
`pc_nomina`, `pc_gastos`, `pc_citas`, ...) el patrón es mecánico:

1. `alter table X add column negocio_id uuid references negocios(id);`
2. Backfill si hay datos, luego `set not null`.
3. `create index on X (negocio_id);`
4. `drop policy` de la política de un solo negocio que exista hoy.
5. Crear las políticas `select` / `insert` / `update` / `delete` con
   `using (negocio_id = mi_negocio())` (y `with check` en insert/update).

No se hizo tabla por tabla todavía porque no vale la pena escribir 15
archivos casi idénticos antes de probar el patrón una vez con datos
reales — mejor validarlo con `pc_clientes` primero (ver siguiente
sección) y automatizar el resto solo si el patrón aguanta la prueba.

## La prueba obligatoria antes de vender nada

Esto es lo que dice `docs/saas/PLAN.md` sección 3, hecho concreto: crear
dos negocios de prueba y confirmar que ninguno ve datos del otro. No es
opcional ni se reemplaza con una revisión de código.

```sql
-- 1. Dos negocios de prueba
insert into negocios (nombre, slug) values
  ('Clínica de Prueba A', 'prueba-a'),
  ('Clínica de Prueba B', 'prueba-b');

-- 2. Dos usuarios de Supabase Auth (crear desde el dashboard o la API,
--    no por SQL) — luego membresía de cada uno a SU negocio:
-- insert into usuarios_negocio (usuario_id, negocio_id, rol) values
--   ('<uuid-usuario-A>', '<uuid-negocio-A>', 'admin'),
--   ('<uuid-usuario-B>', '<uuid-negocio-B>', 'admin');

-- 3. Un cliente en cada negocio
-- (autenticado como usuario A) insert into pc_clientes (..., negocio_id) values (..., '<uuid-negocio-A>');
-- (autenticado como usuario B) insert into pc_clientes (..., negocio_id) values (..., '<uuid-negocio-B>');

-- 4. La prueba real: autenticado como usuario A, esto DEBE devolver
--    solo el cliente del negocio A, nunca el de B.
select * from pc_clientes;
```

Si el usuario A ve, edita o borra algo del negocio B con esto puesto,
**no se avanza a la Fase 2** hasta arreglarlo — es exactamente el tipo de
bug que el 23 ago costó horas de diagnóstico en un solo negocio; acá
significaría una fuga de datos médicos entre clínicas de verdad.
