# Reclutamiento: sonografista veterinario (nov 2026)

Campaña de clientes potenciales en Meta (borrador): **PC | Reclutamiento | Sonografista | 2026-11**.
Categoría especial **Empleo** (obligatoria en Meta para anuncios de trabajo), US$3 al día del
24 nov al 8 dic, 40 km alrededor de PetColinas (Gran Santo Domingo).

Modalidad: **por encargo / por estudio** (viene cuando hay sonografías agendadas).

## 1. Formulario instantáneo (crearlo en Ads Manager)

La herramienta de Meta que usa Claude no puede crear formularios; se hace una vez a mano.
Lo más rápido: **Herramientas para clientes potenciales → Formularios → duplicar el de
veterinario de julio** y cambiarle nombre y preguntas. Así conserva la política de privacidad.

- **Nombre del formulario:** `Sonografista veterinario 2026-11`
  (el nombre debe llevar "sonografista": la app lo usa para poner al candidato en esa vacante).
- **Tipo:** Mayor intención (agrega un paso para revisar los datos; llegan menos curiosos).
- **Introducción:**
  - Título: `Se busca sonografista veterinario`
  - Texto: `PetColinas, clínica veterinaria en Plaza Las Colinas (Prol. 27 de Febrero, Santo Domingo
    Oeste), busca sonografista para hacer estudios por encargo en perros y gatos. Pago por estudio.
    Toma 2 minutos.`

### Datos de contacto (prellenados)
- Nombre completo
- Número de teléfono (WhatsApp)
- Correo electrónico

### Preguntas (en este orden)
1. **¿Eres médico veterinario?** (opción múltiple)
   - Sí, graduado con exequátur
   - Sí, graduado, exequátur en trámite
   - Soy estudiante de veterinaria
   - No, soy técnico o sonografista de humanos
2. **¿Cuántos años de experiencia tienes haciendo sonografías en perros y gatos?** (opción múltiple)
   - Más de 3 años
   - 1 a 3 años
   - Menos de 1 año
   - Ninguna en animales todavía
3. **¿Qué estudios haces con seguridad?** (respuesta corta)
   Ej.: abdominal completo, gestación, vejiga y riñones, ecocardiografía.
4. **¿Tienes equipo de sonografía propio?** (opción múltiple)
   - Sí, portátil
   - No, trabajaría con el de la clínica
5. **¿Entregas informe escrito con imágenes el mismo día?** (opción múltiple)
   - Sí, siempre
   - A veces
   - No
6. **¿Qué días y horarios podrías venir cuando haya estudios agendados?** (respuesta corta)
7. **¿En qué sector vives?** (respuesta corta)
8. **¿Cuánto cobras por estudio abdominal, incluyendo el informe? (RD$)** (respuesta corta)

- **Pantalla final:** `¡Gracias! Revisaremos tu información y te escribiremos por WhatsApp.`
  Botón: ver la página de Instagram/Facebook.

## 2. Conectar a la hoja de candidatos

Igual que las de veterinario y groomer: en la integración de clientes potenciales que llena la
hoja de Google publicada (la de `CAND_SHEET_URL` en la app), **agregar este formulario nuevo**
(debe traer la columna con el nombre del formulario). La app relee la hoja cada 2 minutos,
detecta "sonografista" en el nombre del formulario y lo guarda en **Candidatos → 🔊 Sonografista**,
con aviso en el Dashboard cuando llega alguien nuevo.

Si la integración no trae el nombre del formulario, los candidatos entrarían como "groomer"
(la vacante por defecto de esa hoja): avisar a Claude para fijarlo.

## 3. Cómo se elige (lo que Claude revisa en cada candidato)

- **Prioridad alta:** veterinario con exequátur + más de 3 años en animales + informe el mismo día.
- **Plus:** equipo portátil propio, ecocardiografía, vive cerca y puede venir con 1 día de aviso.
- **Descartar o "a futuro":** sin experiencia en animales, o sin informe escrito.
- **Pago:** comparar lo que cobra por estudio con el precio de venta de la ecografía en la clínica.

La pestaña Candidatos tiene la guía de entrevista de sonografista (8 preguntas con lo que
debería responder).
