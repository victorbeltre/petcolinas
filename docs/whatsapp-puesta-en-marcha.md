# WhatsApp con IA — cómo se enciende

Todo el código está listo y probado. Falta conectar el número, y eso son pasos
en Meta que solo puedes hacer tú.

> **Cambio importante (11 sep 2026).** La primera versión de este documento
> decía que migrar el número lo sacaba del teléfono para siempre. **Eso ya no
> es cierto.** Meta sacó *Coexistencia*, que permite tener el mismo número a la
> vez en la app del teléfono y en la Cloud API. Es el camino recomendado y es
> el que se explica aquí.

---

## La pregunta de fondo: ¿se pierde el número del teléfono?

**No, si usas Coexistencia.** Antes había que elegir: o el número estaba en la
app de WhatsApp Business del teléfono, o estaba en la API. Coexistencia rompe
esa disyuntiva:

- El 809-752-6806 **sigue funcionando igual en el teléfono**. Se contesta desde
  ahí como siempre.
- Y a la vez la app de PetColinas puede leer y escribir por ese mismo número.
- Se sincronizan hasta **6 meses** de conversaciones uno a uno (los grupos no).

### Lo que sí se pierde al activarla

Esto conviene mirarlo antes de decidir, porque son cosas de la app del teléfono
que dejan de estar:

| Se pierde o se limita | Detalle |
|---|---|
| **Listas de difusión** | Quedan de solo lectura. No se pueden crear nuevas. **Si usas difusión para promociones, este es el punto que más te afecta.** |
| Mensajes temporales, "ver una vez", ubicación en tiempo real | Se apagan en los chats individuales |
| Editar y eliminar mensajes enviados | Deja de funcionar |
| Grupos | Siguen en el teléfono, pero no se ven en la app de PetColinas |
| Llamadas de voz y video, estados | Solo en el teléfono |
| Dispositivos vinculados | Se desvinculan todos al activar. Se vuelven a vincular después |

Además: **hay que abrir la app del teléfono cada 10-14 días** o la conexión
caduca por seguridad. Con el uso normal de la clínica eso pasa solo.

Lo que **no** cambia: fuera de las 24 h desde el último mensaje del cliente
sigue haciendo falta una plantilla aprobada. Coexistencia no levanta esa regla.
Por eso el código de los seguimientos (M17) **funciona igual, sin tocar nada**.

---

## Sobre las otras ideas que planteaste

Vale la pena decir por qué no son el camino, para no perder tiempo ahí:

**n8n** es un orquestador: encadena pasos, no cambia tu relación con WhatsApp.
Acabaría llamando a la misma Cloud API (mismas reglas) o a una librería no
oficial (ver abajo). No resuelve el problema, añade una pieza más que mantener
y que ya tenemos resuelta con la Edge Function.

**Cloudflare** es hosting y red. Tampoco cambia cómo WhatsApp registra un
número. Nuestra función ya vive en Supabase y funciona.

**Meta Business Suite** tiene bandeja de WhatsApp, pero es para que la use una
persona. No expone una API para que la IA lea y escriba.

**"Dispositivo adicional" con librerías no oficiales** (Baileys,
whatsapp-web.js, WPPConnect, y lo que usan casi todos los tutoriales de "conecta
WhatsApp sin perder el número") — esto **sí** funciona técnicamente y sí deja el
número en el teléfono. Se conecta como si fuera WhatsApp Web. Pero:

- **Va contra los términos de servicio de WhatsApp.** El riesgo real es que
  baneen el número — justo lo que estás tratando de evitar. Y mandar
  seguimientos automáticos es exactamente el uso que más lo dispara.
- Necesita un servidor encendido todo el tiempo guardando la sesión. Las Edge
  Functions de Supabase no sirven (son efímeras) y Cloudflare Workers tampoco.
  Haría falta un VPS aparte.
- Se rompe cada vez que WhatsApp cambia el protocolo.

Con Coexistencia consigues lo mismo por la vía oficial. No vale la pena arriesgar
el número del negocio.

---

## Cómo se activa Coexistencia

El detalle incómodo: **Coexistencia solo se activa por el flujo "Embedded
Signup" de Meta**, que está pensado para plataformas que dan de alta a sus
clientes. No aparece en el alta normal de un número. Hay dos formas:

### Camino A — Nuestra propia app de Meta (recomendado)

Registramos la app de PetColinas como *Tech Provider* y corremos el Embedded
Signup una vez, para el propio PetColinas.

- ✅ Sin cuota mensual de nadie. Solo pagas a Meta por conversación.
- ✅ Los webhooks llegan directo a nuestra función. El código ya escrito sirve.
- ✅ Nadie más se sienta en medio de las conversaciones con tus clientes.
- ❌ Más trámite: verificación del negocio y revisión de la app en Meta.

### Camino B — Un proveedor (BSP) que soporte Coexistencia

Wati, 360dialog, respond.io y otros ya tienen el Embedded Signup montado.

- ✅ Se activa en pocos clics, sin revisión de app.
- ❌ Cuota mensual, y muchos cobran recargo sobre cada mensaje.
- ❌ Hay que reescribir la capa de envío: nuestra función hablaría con su API en
  vez de con la de Meta.
- ❌ Un tercero con acceso a las conversaciones de tus clientes.

**Mi recomendación: camino A.** El trámite es de una vez; la cuota del BSP es
para siempre, y no queremos otro intermediario con los datos de los clientes.
Si el trámite se atasca, el camino B siempre está ahí.

---

## Pasos, en orden

### 1. Verificar el negocio en Meta

[business.facebook.com](https://business.facebook.com) → Configuración del
negocio → Información del negocio → **Verificación**. Te pedirá RNC y
documentos. **Es lo que más tarda (a veces días). Empieza por aquí**, lo demás
son minutos.

### 2. Crear la app — una NUEVA, no la de Lead Ads

[developers.facebook.com](https://developers.facebook.com) → Mis apps → Crear
app → tipo **Empresa** → añadir el producto **WhatsApp**.

> **Por qué una app nueva y no la que ya existe.** PetColinas ya tiene una app
> de Meta para Lead Ads (la que alimenta `pc_candidatos` por la función
> `meta-leads`). Técnicamente se le podría añadir WhatsApp, pero no conviene:
>
> - Pedir acceso avanzado a `whatsapp_business_messaging` pone **esa** app en
>   revisión, y lo que queda en el aire es el reclutamiento que ya funciona.
> - Compartirían la clave secreta: rotarla por un motivo rompe las dos cosas.
> - No se ahorra nada. La verificación del negocio vive en el Business Manager,
>   no en la app, así que una app nueva la hereda.
> - Una app cuyo único propósito es mensajería de la clínica es un caso más
>   fácil de explicar en la revisión.
>
> Eso sí: la app nueva tiene que quedar **dentro del mismo Business Manager**
> ya verificado. Ponle un nombre que se distinga, tipo "PetColinas WhatsApp".

En **Configuración → Básica** apunta el **ID de la app** y la **Clave secreta**.

### 3. Ponerla como Tech Provider y pedir los permisos

En la app: **Casos de uso / Permisos**, solicita acceso avanzado a
`whatsapp_business_messaging` y `whatsapp_business_management`.

Aquí es donde te pueden pedir explicar para qué es. La respuesta honesta y
suficiente: *software propio de gestión de una clínica veterinaria, para
atender a sus propios clientes y enviarles recordatorios de citas y vacunas.*

### 4. Los secretos en Supabase

Supabase → **Edge Functions** → **Secrets**:

| Secreto | De dónde sale |
|---|---|
| `WA_APP_ID` | El ID de la app del paso 2 |
| `WA_APP_SECRET` | La clave secreta del paso 2 |
| `WA_VERIFY_TOKEN` | Te lo inventas tú. Cualquier texto largo. Se repite en el paso 7 |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API Keys. **Se cobra por uso: ponle límite mensual** |

El token de WhatsApp y el Phone number ID **no van aquí**: los guarda solo el
alta del paso 6. Copiarlos a mano es justo donde se cuela una errata que luego
cuesta media hora encontrar.

### 5. Desplegar la función

Me avisas y la despliego yo. Es un comando. Tiene que estar desplegada **antes**
del paso 6, porque el alta le habla a ella.

### 6. Correr el Embedded Signup

La página ya está hecha: **`meta-signup.html`**, en el repo. Se abre con los dos
ids en la dirección (así no hay que editar ni volver a subir nada):

```
https://victorbeltre.github.io/petcolinas/meta-signup.html?app=EL_APP_ID&config=EL_CONFIG_ID
```

- El **App ID** está en Meta → tu app → Configuración → Básica.
- El **Config ID** sale al crear la configuración de Embedded Signup, en la
  sección de WhatsApp de la app.
- En Meta → Configuración → Básica → **Dominios de la app**, añade
  `victorbeltre.github.io`, o el botón no arranca.

Le das a **Conectar con Meta** y en la ventana que abre eliges **«usar mi cuenta
de WhatsApp Business existente»** — *esa* es la opción que activa la
coexistencia — y aceptas sincronizar el historial.

Al terminar, la página guarda el token sola y te dice el número conectado.

> Ojo: al activar se desvinculan los dispositivos vinculados (WhatsApp Web y
> similares). Se vuelven a vincular después sin problema.

### 7. Enganchar el webhook

Meta → tu app → WhatsApp → Configuración → Webhooks:

- **URL:** `https://ulrzzddovkioxeaarnjk.supabase.co/functions/v1/whatsapp-bot`
- **Token de verificación:** el mismo `WA_VERIFY_TOKEN` del paso 5.

Suscríbete a **`messages`** y también a **`message_echoes`**.

`message_echoes` no es opcional en coexistencia, y esta es la razón: cuando la
doctora contesta **desde su teléfono**, el eco es lo único que se lo dice al
bot. Sin eso, el bot no se entera, contesta también, y el cliente recibe dos
respuestas distintas a la misma pregunta. Con el eco, escribir desde el teléfono
apaga el bot en ese chat automáticamente.

### 8. Las tres plantillas

Los seguimientos van fuera de la ventana de 24 h, así que necesitan plantilla
aprobada. En **WhatsApp Manager → Plantillas de mensaje → Crear**. El nombre y
el idioma tienen que ser **exactos** o el envío falla con error 132001:

| Nombre | Idioma | Categoría |
|---|---|---|
| `cita_recordatorio` | Español (`es`) | Utilidad |
| `vacuna_recordatorio` | Español (`es`) | Utilidad |
| `reactivacion` | Español (`es`) | **Marketing** |

**cita_recordatorio**
```
Hola {{1}} 👋 Le recordamos la cita de {{2}} en PetColinas: {{3}} a las {{4}}. Si no puede asistir, respóndanos por aquí y la movemos. ¡Le esperamos!
```

**vacuna_recordatorio**
```
Hola {{1}} 👋 A {{2}} le toca {{3}} ({{4}}). Respóndanos por aquí y le buscamos cita en PetColinas.
```

**reactivacion**
```
Hola {{1}} 👋 Hace tiempo que no vemos a {{2}} por PetColinas. Si quiere agendar un baño o una consulta, respóndanos por aquí y buscamos el día que mejor le quede.
```

Ejemplos de variables para que Meta las apruebe: `Viannesa`, `Shayna`, `11/09`,
`10:00`.

> **Costo:** Meta cobra por conversación y **marketing cuesta bastante más que
> utilidad**. Cita y vacuna son utilidad; reactivación es marketing. Mira la
> tarifa vigente para República Dominicana en la
> [lista de precios](https://business.whatsapp.com/products/platform-pricing)
> antes de subir el tope diario de reactivaciones.

---

## Si prefieres no tocar el número: segundo número

Sigue siendo una opción válida y la más rápida: un número nuevo solo para el
bot, alta normal en Cloud API (sin Coexistencia, sin Embedded Signup, sin
revisión de app). El 809-752-6806 no se toca.

El costo es que el cliente ve otro número, y que las respuestas a los
seguimientos llegan ahí en vez de al teléfono de siempre. Dímelo y adapto la
configuración.

---

## Cómo queda funcionando

**Lo que el cliente escribe** → la IA contesta sola con los datos reales de la
clínica (tarifas, agenda, la ficha de su mascota) y puede agendar citas
respetando el horario. Todo queda en la pestaña WhatsApp → Conversaciones. Si
alguien de PetColinas escribe en ese chat —desde la app **o desde el teléfono**—
el bot se calla ahí para no pisarse.

**Lo que salimos a mandar nosotros** → cada mañana a las 5:45 la base arma sola
la lista de seguimientos y la deja en WhatsApp → **Seguimientos**, esperando.
Nadie recibe nada hasta que alguien marca y le da a enviar.

Los frenos que trae puestos, y por qué:

- **Nada sale sin aprobación.** El interruptor `wa_auto` de `pc_config` está en
  `no`. Se enciende cuando lleve semanas proponiendo bien, no antes.
- **Tope de 15 reactivaciones al día** (`wa_max_reactivacion_dia`). La primera
  prueba en seco propuso **83 de una sentada**.
- **Una por casa**, no una por mascota.
- **Reactivación solo entre 90 y 400 días sin venir**, y como mucho cada 60 días.
- **Vacuna hasta 30 días después de vencida.** Más atrás ya no es recordar.
- **Teléfonos mal formados no se proponen.** Un número incompleto es el número
  de otra persona.
- **`pc_wa_optout`**: quien diga "no me escriban más" se mete ahí por teléfono y
  no vuelve a entrar en ninguna lista.

## Antes de mandar el primero

Manda **uno solo, a tu propio número**, y míralo en tu teléfono. La vista previa
enseña el texto exacto, pero verlo llegar es otra cosa.

## Si Meta bloquea el número

Business Manager → Calidad del número te dice el estado (verde/amarillo/rojo).
Si se pone amarillo: para las reactivaciones, deja solo citas y vacunas, y
avísame.
