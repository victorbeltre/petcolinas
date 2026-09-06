# Semilla de VetMake — procedencia

`index.html` en esta carpeta es una **copia congelada, sin editar**, del
`index.html` en vivo de PetColinas. Es el punto de partida del código de
VetMake — nada más se ha tocado todavía.

| Campo | Valor |
|---|---|
| Copiado el | 23 ago 2026 |
| Commit de origen (`main`) | `71f59aeb90db72d0a2c27fc5768667ce178a94b0` |
| Fecha de ese commit | 22 ago 2026 17:27 UTC |
| `version.txt` de origen | `2026-08-22 17:27Z` |
| Validación | `node .github/scripts/validate-index.js` → ✅ válido (1,631,389 bytes, 16 pestañas, 5 componentes, sintaxis JS OK) |
| SHA-256 | `b3cb6f8c2f07c5368dc096e4d74e07097708f2d99be7866c49d39e5dd1198d53` |
| Idéntico al `index.html` de PetColinas en esta rama | Sí (`diff` vacío) |

## Cambio M1 (6 sep 2026): datos personales fuera del archivo

Esta copia **ya no es idéntica byte a byte** al commit de origen. Se le aplicó
exactamente la misma transformación que a `index.html` en la raíz (M1 de la
lista de mejoras): el archivo, que es público, llevaba incrustados ~316
propietarios, 477 teléfonos, 150 correos y 34 aspirantes a empleo con perfil
completo. Nada de eso puede vivir en el código de un producto que se va a
entregar a otras clínicas.

| Qué se quitó | Cómo |
|---|---|
| `VENTAS_SEED`, `GASTOS_SEED`, `CLIENTES_SEED`, `SEGUIMIENTOS_SEED`, `FACTURAS_SEED`, `INVENTARIO_SEED` | Quedan como `[]`. `useSupabase` ya contempla semilla vacía. La numeración de facturas pasa a la constante `FACTURAS_HIST_COUNT = 131`. |
| ~67 clientes muertos incrustados en el `return` de `useClientesConSeed` | Eliminados; la función devuelve `[val, setVal]`. |
| `CANDIDATOS_VET` / `CANDIDATOS_GROOMER` | Quedan como `[]`. El componente `Candidatos` lee todo de `pc_candidatos` (en PetColinas los 34 perfiles se migraron con `origen = 'estatico'`). |
| Portal: sondeo de ventas/clientes | Ahora corre una vez al montar y luego cada 60 s (antes, sin semilla, un dispositivo nuevo veía vacío un minuto). |

| Campo | Valor tras M1 |
|---|---|
| Tamaño | 1,274,467 bytes (antes 1,620,042) |
| SHA-256 | `095e9ccbcd92a1f0b7ffb3297a586e0d093b672f2fc4922247297d18a2ea01e3` |
| Validación | `validate-index.js` ✅ y `render-check.js` ✅ (15 vistas) |

Para reconstruir el estado original exacto: `git show 71f59aeb90db72d0a2c27fc5768667ce178a94b0:index.html`.
Ojo: ese historial **sigue conteniendo los datos personales**; purgarlo del
repo (`git filter-repo`) es una decisión de Victor, no se hizo aquí.

## Qué significa esto

Esta es la línea que separa "planeación" de "código real" en el proyecto
VetMake. A partir de aquí, cualquier cambio dentro de `vetmake/` es
ingeniería del SaaS (Fase 1 en adelante del plan) — nunca debe volver a
mezclarse con `index.html` en la raíz del repo, que sigue siendo la app en
vivo de PetColinas.

## Próximo cambio real sobre este archivo

Fase 1 del plan (`docs/saas/PLAN.md`, sección 3): agregar la tabla
`negocios`, la columna `negocio_id` y reescribir las políticas RLS —
trabajo de base de datos antes que de `index.html`. El primer cambio en
este archivo probablemente sea sacar las referencias hardcodeadas a
"PetColinas" a un objeto de configuración por negocio.
