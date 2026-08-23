# Prompt de arranque para Codex (o cualquier otro asistente) — VetMake

Este archivo existe para que Victor pueda seguir trabajando en VetMake con
**cualquier asistente de código** (Codex, otra sesión de Claude, lo que
sea) sin perder contexto cuando se le acaben los tokens de uno. Pégalo tal
cual al arrancar una sesión nueva en Codex.

---

## El prompt (copiar y pegar)

```
Estás retomando el desarrollo de VetMake, un SaaS de gestión para
veterinarias derivado del código de PetColinas. Antes de tocar nada, lee
en este orden:

1. docs/saas/PLAN.md — el plan completo: decisiones de negocio ya
   tomadas, arquitectura, roadmap de fases, qué se descartó y por qué.
2. vetmake/PROVENANCE.md — de dónde salió el código semilla.
3. vetmake/supabase/README.md — el patrón de base de datos multi-tenant,
   ya diseñado, aplicado y probado.

Regla que no se negocia, la más importante de todas: TODO lo de VetMake
vive dentro de la carpeta vetmake/ y en docs/saas/, en la rama
saas/plan-inicial. NUNCA toques index.html en la raíz del repo, ni nada
en supabase/functions/, ni form-to-crm.gs — eso es la app en vivo de
PetColinas, un negocio real que funciona todos los días, y no es parte de
este trabajo bajo ninguna circunstancia. Si algo parece requerir tocar
esos archivos, para y pregúntale a Victor primero.

Trabaja en la rama saas/plan-inicial del repo victorbeltre/petcolinas
(nunca en main). Commitea con mensajes claros en español, en el mismo
estilo que ya tiene el historial de esa rama, y haz push a
saas/plan-inicial cuando termines cada pieza de trabajo.

Estado actual (revisa docs/saas/PLAN.md para el detalle completo y qué
sesión hizo qué):
- Fase 0 (nombre de marca, código semilla congelado): completa.
- Fase 1 (multi-tenancy en Supabase): el patrón está diseñado, aplicado
  y probado con dos negocios ficticios en un proyecto de Supabase de
  prueba separado (vetmake-dev). Falta replicar el mismo patrón mecánico
  al resto de las tablas pc_* — pc_ventas, pc_facturas, pc_inventario,
  pc_nomina, pc_gastos, pc_citas.
- Fase 2 en adelante: no empezada.

Antes de crear o modificar cualquier infraestructura real (un proyecto
de Supabase nuevo, un dominio, cualquier cosa con costo o ligada a la
cuenta de Victor), pídele confirmación explícita primero — no asumas
autorización solo porque el plan lo menciona como paso futuro.

Continúa desde donde se quedó: [pega aquí qué quieres que haga ahora,
por ejemplo "replica el patrón de negocio_id a pc_ventas siguiendo el
mismo README"].
```

---

## Lo demás que necesita Codex para poder trabajar de verdad

El prompt de arriba le da el contexto, pero para que pueda *ejecutar*
trabajo (no solo leerlo) necesita acceso a dos cosas por separado — dale
esto en la configuración propia de Codex, **nunca pegado dentro del
prompt de chat**, para que no quede escrito en un historial de
conversación:

### 1. Acceso al repo de GitHub
- Repo: `victorbeltre/petcolinas`
- Rama de trabajo: `saas/plan-inicial`
- Si Codex tiene su propia integración de GitHub (login/token), conéctala
  ahí. Si necesita clonar por HTTPS con un token, genera uno con permiso
  de `repo` desde GitHub → Settings → Developer settings → Personal
  access tokens, y ponlo en la configuración de credenciales de Codex —
  no en el chat.

### 2. Acceso a Supabase (solo si le vas a pedir que corra o pruebe SQL)
Dos proyectos existen, son completamente independientes:

| Proyecto | Ref | Para qué |
|---|---|---|
| PetColinas (en vivo) | `ulrzzddovkioxeaarnjk` | **Codex nunca debe tocar este.** Es el negocio real. |
| `vetmake-dev` (prueba) | `couzqdicmxrypacgrqcn` | Aquí sí — es donde se probó el patrón multi-tenant, gratis, sin datos reales de nadie. |

Si quieres que Codex pueda ejecutar SQL directo contra `vetmake-dev`
(para seguir probando el patrón en más tablas), la forma segura es:
1. Entra al dashboard de Supabase → proyecto `vetmake-dev` → Settings →
   API, y copia el `service_role key` o la cadena de conexión de
   Postgres desde ahí.
2. Ponlo como variable de entorno o secreto en la configuración de Codex
   (cada herramienta tiene su propio lugar para esto — nunca lo pegues
   en el prompt ni en un mensaje de chat).
3. Dile a Codex que use esa variable, sin escribir la llave en ningún
   archivo del repo.

Si Codex tiene su propio MCP de Supabase (igual que esta sesión), mejor
aún — solo dale acceso a la organización `dkrbqtxyzgujplgeezbh` y déjalo
listar los proyectos desde ahí mismo.

---

## Qué NO va en este archivo

A propósito, este documento no tiene ninguna llave, contraseña, ni
`service_role key`. Son secretos reales — si algún día alguien los
llegara a pegar en un archivo del repo por error, avísale a Victor de
inmediato para rotarlos, no solo borrar el archivo (queda en el
historial de git).
