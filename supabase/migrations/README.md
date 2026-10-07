# Migraciones de Supabase — PetColinas

Aquí vive, en orden de fecha, **todo el SQL que se ha aplicado al proyecto de
producción** (`ulrzzddovkioxeaarnjk`). Hasta septiembre de 2026 los cambios de
esquema se hacían a mano en el editor del dashboard y no quedaba rastro: nadie
podía saber por qué una tabla tenía una política u otra, ni reconstruir el
proyecto desde cero. Por eso ahora **toda** modificación de esquema pasa por un
archivo de esta carpeta, aunque se haya ejecutado desde el conector.

## Reglas

1. **Un archivo por cambio**, con nombre `AAAAMMDD_descripcion.sql`.
2. **Idempotente**: `create table if not exists`, `drop policy if exists` antes
   de `create policy`, `on conflict do nothing` en las semillas. Tiene que poder
   correrse dos veces sin romper nada.
3. **RLS en la misma migración** que crea la tabla (Regla Crítica 6 del
   `CLAUDE.md`). Una tabla nueva sin RLS es legible con la llave pública que va
   dentro de `index.html`.
4. **Sin datos de clientes.** Nada de nombres, teléfonos ni direcciones en estos
   archivos: quedan en el historial de git para siempre.
5. **Comentar el porqué, no el qué.** El SQL ya dice qué hace; lo que se pierde
   es la razón (qué se rompió, qué se intentó antes y no sirvió).
6. Al terminar, correr `get_advisors(type=security)` del conector de Supabase.
   Cualquier `rls_disabled_in_public` es un bloqueo, no una advertencia.
7. **`create or replace view` REINICIA las opciones de la vista.** Después de
   cada recreación hay que volver a poner `security_invoker`, o la vista pasa a
   leer con los permisos de quien la creó y se salta la RLS. Pasó al montar M18
   y lo cazó `get_advisors` como ERROR, no como aviso.
8. El conector de Supabase **se cuelga en cualquier `DROP`** (probado seis veces
   con `execute_sql` y `apply_migration`). Si hace falta borrar una vista, o se
   le vacía el cuerpo con `create or replace ... where false`, o se borra a mano
   desde el panel de Supabase.
9. Al crear una función, `revoke ... from public, anon` **no alcanza**:
   Supabase le otorga `EXECUTE` a `authenticated` por privilegios por defecto,
   así que hay que nombrarlo. Y en Postgres toda función nace con `EXECUTE`
   para `PUBLIC`, que `anon` hereda aunque se le revoque a él solo.

## Cómo verificar un cambio antes de darlo por bueno

Las políticas se evalúan con el rol de quien pide, así que probar como
`postgres` desde el editor no prueba nada. Se simula el JWT real dentro de un
bloque que al final se revierte solo:

```sql
do $$
declare v_resultado text;
begin
  perform set_config('request.jwt.claims',
    '{"email":"veterinaria@petcolinas.com","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  -- ... lo que se quiera probar, incluidos los inserts ...

  -- El raise aborta el bloque: nada de lo de arriba se guarda.
  raise exception 'RESULTADO -> %', v_resultado;
end $$;
```

Correos por rol: `admin@petcolinas.com` (admin), `naylan@petcolinas.com` y
`valentina@petcolinas.com` (vet), `alexander@petcolinas.com` (groomer),
`veterinaria@petcolinas.com` (caja).

## Qué hay aquí

| Archivo | Qué hizo |
|---|---|
| `20260906_m3_roles_rls.sql` | Bajó la separación de roles del navegador a Postgres: `pc_usuarios_rol`, `pc_rol()`, y una política por tabla según el rol. Antes las 18 tablas tenían `using(true)` y que caja "no viera las finanzas" era una cortina en JavaScript. |
| `20260906_m3_revertir.sql` | Vuelta atrás de la anterior. Solo para emergencias (un rol se queda sin poder trabajar). |
| `20260906_tablas_faltantes.sql` | Creó tablas que la app llevaba meses usando y que nunca existieron. |
| `20260906_m4_secreto_formulario.sql` | `pc_secretos` (RLS activo y **ninguna** política: solo `service_role` entra) para que el Google Form escriba por la Edge Function `form-intake` en vez de con la llave pública. |
| `20260906_reparar_fichas_formulario.sql` | Arregló las fichas que el formulario había guardado mal mientras el mapeo de preguntas estaba roto. |
| `20260907_m16_ncf.sql` | Comprobante fiscal: `pc_config`, `pc_ncf_secuencias`, columnas de NCF en `pc_facturas` y `pc_asignar_ncf(tipo)`, que entrega el siguiente número de forma atómica. |
| `20260908_m13_punto_equilibrio.sql` | El punto de equilibrio deja de estar escrito a mano en el código (estaba en tres sitios y con dos valores distintos). |
| `20260908_m10_comisiones.sql` | Los porcentajes de comisión (12/30/40/5) salen del código, donde estaban repetidos en quince sitios. |
| `20260908_m8_procesos_programados.sql` | `pg_cron`, la bitácora `pc_tareas_log` y la primera tarea (`pc_resumen_diario`, cada día a las 5:30). Base para los recordatorios de la lista 2. Ninguna tarea manda mensajes a clientes. |
| `20261007_m18_caja_diaria.sql` | Flujo de caja: `pc_caja_dia` (arqueo), `pc_caja_movimientos` (lo que no es venta ni gasto) y la vista `pc_caja_libro`, que arma el libro sobre lo que ya existe en vez de duplicarlo. Incluye `pc_metodo_pago()`, que normaliza las 60 variantes de `formapago`, y los agregados `pc_caja_resumen(fecha)` y `pc_caja_reporte(desde, hasta, metodo, categoria)`: ambos `SECURITY DEFINER` y solo totales, porque `pc_gastos` es solo-admin y si caja sumara lo que ella ve, las salidas le saldrían en cero. |
| `20261007_m19_cuentas_y_traslados.sql` | El dinero que NO está en la gaveta (el 69% del total): `pc_cuentas`, `pc_traslados`, `pc_cuenta_saldos`, la vista `pc_cuenta_libro` y `pc_cuentas_estado(fecha)`. Añade el concepto que faltaba, el TRASLADO: ni ingreso ni gasto, la misma plata cambiando de sitio. La comisión de tarjeta no se estima, se mide de la liquidación real. Todo solo-admin, pero `pc_caja_resumen` se extendió para que el arqueo de caja siga cuadrando sin verlo. |
| `20260910_m17_wa_seguimientos.sql` | Seguimientos por WhatsApp: plantillas, cola con aprobación, opt-out y la tarea de las 5:45 que **propone** (no manda). Puesta en marcha en `docs/whatsapp-puesta-en-marcha.md`. |

## Lo que NO está aquí

Las Edge Functions viven en `supabase/functions/` y se despliegan aparte. Los
interruptores del dashboard de Supabase (por ejemplo la protección contra
contraseñas filtradas) no se pueden expresar en SQL: están anotados en
`CLAUDE.md`, en "Pendientes que solo Victor puede hacer".
