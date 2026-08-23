# PetColinas — traspaso de sesión

> **Empieza por aquí.** Este documento es el estado del trabajo al
> **23 de agosto de 2026**. Si necesitas el detalle exacto de cualquier
> conversación, todo está archivado en `conversacion-completa.md`
> (1.9 MB, 150 mensajes de Victor + 430 respuestas), navegable con `INDICE.md`.

---

## 0. Lo primero: el conector de Supabase

Proyecto Supabase: `ulrzzddovkioxeaarnjk`

Durante buena parte de la sesión el conector reportó `connected: true` pero
`enabledInChat: false`, y sus herramientas no cargaron — todo el SQL se corrió
a mano desde el navegador. **Al final de la sesión volvió y funcionó**
(se leyeron y editaron políticas sin problema).

Es intermitente: si se cae, prenderlo a mitad de conversación **no** lo
recupera; hay que abrir una conversación nueva con él ya encendido.
Verifica con ToolSearch que `mcp__Supabase__execute_sql` responda antes de
prometerle a Victor que puedes tocar la base.

---

## 1. Qué es este proyecto

App de gestión para **PetColinas** — veterinaria + grooming + farmacia, Plaza
Las Colinas, Santo Domingo Oeste, RD. Dueño: **Victor Ballas**.

### Arquitectura

| Pieza | Qué es |
|---|---|
| `index.html` | SPA de React en **un solo archivo**, ~18,400 líneas, >1 MB, 16 pestañas. Servido por GitHub Pages desde `main`. **Es la app en vivo.** |
| Supabase | Postgres + Auth + Realtime (proyecto `ulrzzddovkioxeaarnjk`) |
| `supabase/functions/` | 8 Edge Functions en Deno |
| `form-to-crm.gs` | Google Apps Script — vive en Google, no en GitHub |
| `.github/scripts/` | `validate-index.js`, `render-check.js`, `sellar-version.js` |
| `supabase/sql/` | 4 archivos de SQL |

### Las 8 Edge Functions

`calendar-sync` · `meta-leads` · `pagadito-cobro` · `pagadito-diag` ·
`pagadito-retorno` · `vapi-tools` · `vapi-trigger` · `whatsapp-bot`

### Convención de base de datos — importante

Todas las tablas usan `enable row level security` + `for all to authenticated`
+ grants a `authenticated`. **El rol `anon` no escribe en ninguna tabla.**
La app funciona porque el personal inicia sesión. Ver
`supabase/sql/00-pendiente-todo.sql`.

Esto es exactamente lo que rompe el formulario (sección 3).

---

## 2. Qué ya está construido

### Cobros y facturación
- **Pagadito** (tarjeta). Protocolo **SOAP RPC/encoded (WSPG)** — NO es REST;
  la documentación pública describe una API que no existe. Recargo del 6% al
  cliente, calculado en el servidor. Cobro disponible desde el registro de
  venta, desde la factura y desde el portal de la doctora.
- **Cobros** — pestaña propia, facturas vencidas por antigüedad con mensajes de
  WhatsApp graduados. Destrabó ~RD$101,314 sin cobrar.
- **Abonos a plazos**, devuelta en efectivo, abonos impresos en factura/PDF/WhatsApp.
- **Fondo de depósito** del cliente, ajustable después de emitida la factura.
- **Blindaje de facturas** — triggers `security definer` en Postgres, tabla de
  auditoría inmutable + aviso al dueño cuando alguien edita o borra.

### CRM y retención
- **Planes prepagados** (`pc_paquetes`) — paquetes de baños con canje en venta.
- **Lealtad** — cuenta solo baños, fuente única; excluye pet shop y mascotas
  de la casa.
- **Próxima cita automática** al facturar, según tipo de servicio, con enlace de
  Google Calendar. Pregunta manualmente cuando no hay cadencia definida.
- **Reactivación** — a quién escribirle primero, por frialdad y valor histórico.
- **Chequeo gratis de 5 puntos** — venta cruzada, hallazgos impresos en factura.
- **Seguimientos** por área (veterinaria / farmacia / grooming) con descarte
  automático al facturar.
- **Recompra de antiparasitarios y antipulgas** con avisos.
- **Mascotas de la casa** y cortesías por área.

### Integraciones
- **WhatsApp Business Cloud API** — bot con Claude (`claude-opus-5`) + bandeja
  de entrada en la app, con toma de control manual por el personal.
- **Vapi "Sofía"** — llamadas salientes (`vapi-trigger`) y tool calls en llamada
  (`vapi-tools`): consultar cliente y agendar cita, con candado de horario real
  (martes solo veterinaria, domingo hasta la 1pm, citas de 45 min). Voz fija
  `es-DO-RamonaNeural` para que nunca caiga a un fallback en inglés.
- **Google Calendar** — sincronización bidireccional (`calendar-sync`), cuenta
  de servicio, conflicto = último cambio gana.
- **Meta Lead Ads** — `meta-leads`, webhook de candidatos a `pc_candidatos`.
- **Google Forms → CRM** — `form-to-crm.gs`. **← ESTO ES LO QUE ESTÁ ROTO.**
- **Supabase Realtime** — sincronización en vivo entre dispositivos.

### Operación interna
- 16 pestañas. Portales restringidos: caja/doctora (sin ver el negocio),
  groomer, veterinaria (rosado). Sesión independiente por pestaña.
- **Boost Engine** — comisiones por día (lun 2X, mié 3X, vie suerte, sáb 1.5X)
  y boosts manuales de hasta 5X desde Nómina.
- Cierre de caja, nómina congelada al pagar, respaldo automático diario.
- Flujo de venta de empleados con aprobación del admin.

---

## 3. TRABAJO EN CURSO: el formulario de inscripción

**Síntoma:** las inscripciones del Google Form no llegan al CRM desde marzo
2026. Decenas de clientes potenciales quedaron solo en la hoja de Google —
nunca entraron a la app ni a Notificaciones.

### Las piezas

| Pieza | Estado |
|---|---|
| Google Form "Ficha de Ingreso — PetColinas" | ✅ La gente lo llena |
| Hoja de respuestas `15FJq5GZNtl_T_qy7aq29dyLY9Ox-um49uEA6GXirEV0` | ✅ Recibe todo |
| Apps Script (el puente hoja → Supabase) | ❌ Lo roto |

Proyecto de Apps Script correcto ("Proyecto sin título"):
`https://script.google.com/u/0/home/projects/1MaaQk1GZvkB5BjdytEu0mB663rRzUonWUo0aqNfc_0uW6vS6vGdU-Dcv/edit`

⚠️ Puede existir un **segundo proyecto viejo** ("formulario clientes nuevos
petcolinas", creado el 12 mar 2026). Hay que revisar el panel de Disparadores
de ambos: si los dos quedan con trigger sobre la misma hoja, **cada inscripción
se insertaría dos veces**.

### Dos fallas independientes, no una

1. ✅ **ARREGLADO — el trigger nunca se enganchó.** El script vive suelto en
   Drive, y `SpreadsheetApp.getActiveSpreadsheet()` no resuelve nada ahí.
   Ahora usa `openById(SPREADSHEET_ID)`.
2. ✅ **ARREGLADO — RLS bloqueaba la escritura.** El rol `anon` no tenía
   política de INSERT en `pc_clientes`:
   ```
   401 {"code":"42501","message":"new row violates row-level security
        policy for table \"pc_clientes\""}
   ```
   La app sí puede porque el personal inicia sesión (`authenticated`); el Apps
   Script llega como `anon`.

   Estado verificado en la base el 23 ago 2026:

   | Política | Comando | Rol |
   |---|---|---|
   | `pc_auth_all` | ALL | `authenticated` |
   | `pc_clientes insert formulario web` | INSERT | `anon` |

   Había una tercera duplicada (`pc_clientes insert publico`, idéntica) que
   **ya se eliminó**. Si reaparece, sobra: dejar solo una.

### ⛔ YA DESCARTADO — no volver a investigar

**La llave anon NO está corrupta.** `diagnostico()` da: largo 208 ✓,
0 caracteres inválidos ✓, 2 puntos separadores ✓, SHA-256 `c54e8196784bb60b` ✓,
idéntica a la de `index.html`.

Se perdieron varios intentos con una hipótesis falsa: que el editor de Apps
Script había guardado bullets (`•`) en vez de la llave. **Es falsa.** La llave
es válida y Supabase la acepta — lo que rechaza es el permiso, no la credencial.
La prueba por huella SHA-256 existe justamente para cerrar esa puerta.

### ✅ ARREGLADO (23 ago 2026, sesión 2) — tercera falla real: el upsert pedía permiso que `anon` no tiene

Victor corrió `probarConDatosFicticios` con las dos correcciones de arriba ya
puestas y **igual dio 401 RLS** en `pc_clientes`. Parecía que la política
seguía sin funcionar, pero no era eso: son dos bugs nuevos, distintos de los
dos ya arreglados.

1. **`insertarEnCRM` mandaba `Prefer: return=minimal,resolution=merge-duplicates`.**
   `resolution=merge-duplicates` convierte el INSERT en un
   `INSERT ... ON CONFLICT DO UPDATE` (upsert). Para resolver el conflicto,
   Postgres necesita poder **leer** la fila existente — permiso de SELECT.
   `anon` solo tiene política de INSERT, nunca de SELECT. Por eso el 401
   dice "row-level security" aunque la política de INSERT esté perfecta:
   Postgres nunca llega a evaluarla, se cae antes por el SELECT implícito
   del upsert. Comprobado con SQL crudo como rol `anon`: el mismo INSERT sin
   `ON CONFLICT` pasa limpio; con `ON CONFLICT DO UPDATE` (sin tocar nada
   más) falla con el mismo 401.

   La solución NO es darle SELECT a `anon` — eso dejaría que cualquiera con
   la llave pública (está en `index.html`) lea todo el CRM. La solución es
   quitar `resolution=merge-duplicates`: una inscripción del form siempre es
   un INSERT nuevo, nunca hay razón real para hacer upsert aquí.

2. **La columna `id` de `pc_clientes` es `numeric NOT NULL` sin default ni
   identity.** El payload de Apps Script nunca la mandaba. La app real
   (`index.html:12522`) genera `id: Date.now()` en JS antes de insertar —
   por eso el flujo normal (usuarios `authenticated`) nunca lo notó. El
   formulario tiene que hacer lo mismo.

Las dos correcciones ya están en `form-to-crm.gs` (`cliente.id = Date.now()`
en `parsearRespuestas`, y `Prefer` sin `resolution=merge-duplicates` en
`insertarEnCRM`). Verificado con SQL directo como rol `anon` simulando
exactamente ese INSERT (id numérico tipo epoch-ms, sin ON CONFLICT,
`Prefer: return=minimal`): pasa limpio.

### 👉 SIGUIENTE PASO INMEDIATO

**Pegar el `form-to-crm.gs` actualizado en el proyecto de Apps Script y
correr `probarConDatosFicticios` de nuevo.** Debe dar `HTTP 201`.

Ahora sí las tres fallas están arregladas, pero **nunca se ha probado con las
tres correcciones puestas a la vez**. Al 23 ago 2026 no existe ninguna fila
`Luna Test` real en `pc_clientes` (se insertaron y se borraron varias filas
de prueba directo por SQL durante el diagnóstico, ninguna se dejó). Hasta que
el `Ejecutar` desde el editor de Apps Script dé 201, no se puede dar por vivo.

Si falla, el error dirá exactamente qué falta; no volver a sospechar de la
llave (ver la sección tachada de arriba).

### Después, en orden

1. Correr `configurarTrigger` en el proyecto correcto.
2. Revisar Disparadores en **ambos** proyectos y eliminar duplicados.
3. **Aclarar por dónde entran hoy las inscripciones.** El 22 ago se
   registraron clientes reales (Diamond Nuñez, Sally Fulcar, Lily Maldonado…)
   con notas del tipo
   `"Nos conocio por: … | Cedula: … | Peso: … | Guardado en CRM: …"`.
   Ese formato **no** es el que genera `form-to-crm.gs` (que produce
   `"Nos conocio | via: … | Servicio: …"`), y trae campos que ni siquiera
   están en `CAMPO_FORM`. O sea: hay **otro camino** metiendo inscripciones
   al CRM — casi seguro la pestaña de "clientes nuevos" de la app, guardados
   a mano. Averiguar cómo funciona ese camino **antes** de escribir la
   recuperación: cambia cuántas inscripciones faltan de verdad, y hay riesgo
   real de duplicar clientes que ya están.
4. **Recuperación** (no escrita aún): una función que recorra la hoja completa
   y suba las inscripciones de marzo a junio que sigan faltando. El trigger
   solo dispara con envíos **nuevos**; las viejas no entran solas.
5. **Blindaje**: sacar el Apps Script del rol `anon` → Edge Function con
   `service_role` como secret + secreto compartido, igual que `pagadito-cobro`.
   Después **eliminar la política `pc_clientes insert formulario web`**.

   Por qué importa: esa política deja que cualquiera con la llave pública (está
   en `index.html`) meta filas basura en el CRM — solo insertar, no leer, editar
   ni borrar. Riesgo bajo y aceptable para destrabar, pero **rompe la convención
   `to authenticated`** del resto del esquema y contradice el blindaje de RLS
   que ya se hizo. Es deuda, no solución.

---

## 4. Otros pendientes

### De CLAUDE.md, fechados el 20 mar 2026 — verificar si siguen vigentes
Ya es agosto; es probable que varios estén hechos y nadie actualizó la lista.

1. Botón rojo de ventas pendientes en el header de admin
2. Verificar que Top Servicios se vea en el Dashboard de Aylein
3. Confirmar que Vacunas muestra todos los registros de Aylein
4. Crear usuarios de Supabase Auth para Alexander y Valentina
   (Valentina sigue sin acceso)

### SQL sin confirmar si está aplicado
`supabase/sql/00-pendiente-todo.sql` (pc_paquetes, pc_pagos_online, realtime) y
`supabase/sql/blindaje-facturas.sql`. Verificar contra la base real cuando el
conector esté disponible.

---

## 5. Estado del repo

- Rama de trabajo: `claude/peaceful-ramanujan-beyjbl`
- Último commit de código: `6fb99c0` — *form-to-crm.gs: partir SUPA_KEY en
  pedazos y diagnostico por huella SHA-256*
- `origin/main`: `7ba2366` (sin commits nuevos de Laura al último fetch)

### Trampas conocidas

- **`form-to-crm.gs` tiene la llave partida en 4 pedazos A PROPÓSITO.** Pegada
  de una sola pieza, el editor de Google la detecta como token y la enmascara.
  **No volver a juntarla.**
- **Antes de tocar `index.html`:** `node .github/scripts/validate-index.js`.
  Debe tener 16 pestañas, los 5 componentes clave, pesar >1 MB y `PC_BUILD`
  igual a `version.txt`. El workflow `validate-app.yml` bloquea el merge si falla.
- **Laura abre PRs a `main` en paralelo** desde otras sesiones. SIEMPRE
  `git fetch origin main` antes de trabajar, y avisarle a Victor si se movió.
- Rama de respaldo: `respaldo-2026-08-19-antes-de-laura` (commit `02a5ca0`).

---

## 6. Cómo trabaja Victor

- Escribe en español; responderle en español.
- Está en República Dominicana. Suele trabajar de noche, desde el teléfono o
  una tablet además de la computadora — **no siempre puede descargar archivos**
  ni abrir formatos raros. Cuando necesite código para pegar en Apps Script,
  dárselo en un bloque de texto en el chat, no como archivo adjunto.
- Prefiere explicaciones que digan **qué se rompió y por qué**, no solo el
  arreglo.

---

## 7. Aparte, ya entregado

PDF con las **30 funciones** construidas para PetColinas, organizadas en 6
áreas, para el currículum / LinkedIn de Victor. Sin acción pendiente.
