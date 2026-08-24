# Semilla de VetMake — procedencia

`index.html` en esta carpeta comenzó como una copia congelada del
`index.html` en vivo de PetColinas. Esa copia es la procedencia del producto;
desde entonces se ha convertido en el frontend de VetMake y contiene los
cambios de generalización, identidad por negocio y onboarding comercial de
esta rama. El `index.html` en la raíz sigue siendo la app de PetColinas y no
se modifica como parte de este trabajo.

| Campo | Valor |
|---|---|
| Copiado el | 23 ago 2026 |
| Commit de origen (`main`) | `71f59aeb90db72d0a2c27fc5768667ce178a94b0` |
| Fecha de ese commit | 22 ago 2026 17:27 UTC |
| `version.txt` de origen | `2026-08-22 17:27Z` |
| Validación de origen | `node .github/scripts/validate-index.js` → ✅ válido (1,631,389 bytes, 16 pestañas, 5 componentes, sintaxis JS OK) |
| Validación actual | Sintaxis del script VetMake, `git diff --check` y comprobaciones de aislamiento/flags → ✅ pasan |
| SHA-256 de origen | `b3cb6f8c2f07c5368dc096e4d74e07097708f2d99be7866c49d39e5dd1198d53` |
| SHA-256 actual de `vetmake/index.html` | `5af57dd2d47c30ae29bac4eec4e94b31e4cc9c6881b6bf9fcc5b59806146e581` |
| Idéntico al `index.html` de PetColinas en esta rama | No: la copia ya contiene la implementación de VetMake |

## Qué significa esto

Esta es la línea que separa "planeación" de "código real" en el proyecto
VetMake. Cualquier cambio dentro de `vetmake/` es ingeniería del SaaS (Fase 1
en adelante del plan) — nunca debe volver a mezclarse con `index.html` en la
raíz del repo, que sigue siendo la app en vivo de PetColinas.

Estado actual: la rama ya contiene la identidad generalizada del negocio, el
panel de Configuración para perfil/equipo/comisiones, catálogos sin defaults
heredados, portales que consumen empleados y tarifas del tenant, la
migración `0007_configuracion_negocio_y_empleados.sql` aplicada en
`vetmake-dev`, la Edge Function `vetmake-admin` para invitación/vinculación
Auth y el callback frontend para establecer/recuperar contraseñas. La
procedencia original sigue siendo el commit indicado arriba; la
implementación posterior se registra en el historial de esta rama.

## Próximo cambio real sobre este archivo

El siguiente bloque será completar correo/dominio de Auth y credenciales de
integraciones por negocio. Cualquier otro cambio de este archivo debe
conservar la frontera con PetColinas y actualizar esta nota si altera su
procedencia o su validación.
