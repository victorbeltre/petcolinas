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
