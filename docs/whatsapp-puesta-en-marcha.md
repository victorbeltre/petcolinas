# WhatsApp con IA — cómo se enciende

Todo el código está listo y probado. Lo que falta es conectar el número, y eso
son pasos en Meta que solo puedes hacer tú. Este documento es el orden exacto.

**Léete primero el punto 1.** Tiene una consecuencia que conviene entender antes
de empezar, porque después no hay vuelta atrás fácil.

---

## 1. Lo que hay que decidir antes de tocar nada

Para que la IA pueda leer y contestar mensajes, el número tiene que estar en la
**WhatsApp Cloud API** de Meta. Y aquí está el detalle importante:

> Cuando un número se migra a la Cloud API, **deja de funcionar en la app de
> WhatsApp Business del teléfono**. Los mensajes ya no llegan al celular: llegan
> a la pestaña WhatsApp de la app de PetColinas, y desde ahí se contestan.

No es un problema técnico que se pueda evitar: es cómo funciona. Un número está
en la app del teléfono **o** en la API, nunca en las dos.

Qué significa en la práctica para PetColinas:

- Quien atiende WhatsApp deja de hacerlo desde el celular y pasa a hacerlo desde
  la app, en la computadora o en el teléfono con el navegador.
- Se pierden los chats viejos que hay en el teléfono. Meta migra el número, no
  el historial. **Exporta las conversaciones que te importen antes.**
- Los estados de WhatsApp Business, el catálogo y los mensajes de difusión de la
  app del teléfono ya no están disponibles igual.

**Si eso no te conviene**, la alternativa es usar un número nuevo solo para el
bot y dejar el 809-752-6806 tal como está. El costo es que el cliente ve dos
números; la ventaja es que no cambias nada de lo que ya funciona. Dímelo y
adapto la configuración.

El resto de este documento asume que sigues adelante con el 809-752-6806.

---

## 2. Crear la app en Meta

1. Entra a [business.facebook.com](https://business.facebook.com) con la cuenta
   de PetColinas y verifica el negocio si no lo está (te pedirá RNC y
   documentos: **es lo que más tarda, a veces días**; empieza por aquí).
2. Ve a [developers.facebook.com](https://developers.facebook.com) → **Mis apps**
   → **Crear app** → tipo **Empresa**.
3. Dentro de la app, añade el producto **WhatsApp**.
4. En WhatsApp → **Configuración de la API**, añade el número 809-752-6806.
   Meta te va a pedir confirmar por SMS o llamada. **Ese es el momento en que el
   número deja de funcionar en el teléfono.**
5. Apunta el **Identificador del número de teléfono** (`Phone number ID`). Es un
   número largo, no el teléfono.

## 3. El token permanente

El token que Meta te enseña al principio caduca en 24 horas y no sirve. Hace
falta uno permanente:

1. Business Manager → **Configuración del negocio** → **Usuarios** →
   **Usuarios del sistema** → crear uno (rol: Administrador).
2. **Agregar activos** → tu app de WhatsApp → control total.
3. **Generar nuevo token** → elige la app → marca los permisos
   `whatsapp_business_messaging` y `whatsapp_business_management` →
   **caducidad: nunca**.
4. Cópialo. **Solo se enseña una vez.**

## 4. Las tres plantillas

Esto no es opcional y conviene entender por qué:

> Meta solo deja mandar texto libre **dentro de las 24 horas siguientes al
> último mensaje del cliente**. Un recordatorio de vacuna es, por definición,
> fuera de esa ventana. Así que los seguimientos van con plantillas que Meta
> revisa y aprueba una por una.

Por eso la IA **no redacta** los seguimientos: rellena los huecos de una
plantilla aprobada. Donde sí escribe libre es contestando, que ahí sí estamos
dentro de la ventana.

En **WhatsApp Manager → Plantillas de mensaje → Crear**, crea estas tres. El
nombre y el idioma tienen que ser **exactos** o el envío falla con error 132001:

| Nombre | Idioma | Categoría |
|---|---|---|
| `cita_recordatorio` | Español (`es`) | Utilidad |
| `vacuna_recordatorio` | Español (`es`) | Utilidad |
| `reactivacion` | Español (`es`) | **Marketing** |

Los textos, copiados tal cual (el `{{1}}`, `{{2}}`… los pone Meta con el botón
de añadir variable):

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

Meta pide ejemplos de las variables para aprobarlas. Usa: `Viannesa`, `Shayna`,
`11/09`, `10:00`.

La aprobación suele tardar de minutos a un día. Si rechaza alguna, dime el
motivo que dé y la reescribo.

> **Sobre el costo:** Meta cobra por conversación y **marketing cuesta bastante
> más que utilidad**. Las de cita y vacuna son utilidad; la de reactivación es
> marketing. Mira la tarifa vigente para República Dominicana en la
> [lista de precios de Meta](https://business.whatsapp.com/products/platform-pricing)
> antes de subir el tope diario de reactivaciones.

## 5. Los secretos en Supabase

Supabase → **Edge Functions** → **Secrets**. Añade:

| Secreto | De dónde sale |
|---|---|
| `WA_TOKEN` | El token permanente del paso 3 |
| `WA_PHONE_NUMBER_ID` | El Phone number ID del paso 2.5 |
| `WA_VERIFY_TOKEN` | Te lo inventas tú. Cualquier texto largo. Lo vuelves a usar en el paso 7 |
| `WA_APP_SECRET` | Meta → tu app → Configuración → Básica → "Clave secreta de la app" |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API Keys. **Se cobra por uso**, ponle un límite de gasto mensual |

## 6. Desplegar la función

Desde esta conversación, cuando me digas que ya están los secretos. Es un
comando y lo corro yo.

## 7. Enganchar el webhook

Meta → tu app → **WhatsApp** → **Configuración** → **Webhooks** → Editar:

- **URL de devolución de llamada:**
  `https://ulrzzddovkioxeaarnjk.supabase.co/functions/v1/whatsapp-bot`
- **Token de verificación:** el mismo `WA_VERIFY_TOKEN` que pusiste en Supabase.

Dale a **Verificar y guardar**. Si da error, la función no está desplegada o el
token no coincide.

Después, en **Campos del webhook**, suscríbete a **`messages`**. Sin eso el bot
no se entera de nada.

---

## Cómo queda funcionando

**Lo que el cliente escribe** → la IA contesta sola con los datos reales de la
clínica (tarifas, agenda, la ficha de su mascota) y puede agendar citas
respetando el horario. Todo queda en la pestaña WhatsApp → Conversaciones. Si
alguien de PetColinas escribe en un chat, el bot se calla en ese chat para no
pisarse.

**Lo que salimos a mandar nosotros** → cada mañana a las 5:45 la base arma sola
la lista de seguimientos y la deja en WhatsApp → **Seguimientos**, esperando.
Nadie recibe nada hasta que alguien marca y le da a enviar.

Los frenos que trae puestos, y por qué:

- **Nada sale sin aprobación.** El interruptor `wa_auto` de `pc_config` está en
  `no`. Se enciende cuando lleve semanas proponiendo bien, no antes.
- **Tope de 15 reactivaciones al día** (`wa_max_reactivacion_dia`). La primera
  prueba en seco propuso **83 de una sentada**: aprobar eso de golpe en un
  número recién migrado es la forma más rápida de que Meta lo bloquee.
- **Una por casa**, no una por mascota.
- **Reactivación solo a quien lleva entre 90 y 400 días sin venir**, y como
  mucho una vez cada 60 días.
- **Recordatorio de vacuna hasta 30 días después de vencida.** Más atrás ya no
  es recordar, es perseguir a la gente.
- **Teléfonos mal formados no se proponen.** Un número incompleto es el número
  de otra persona.
- **`pc_wa_optout`**: quien diga "no me escriban más" se mete ahí por teléfono y
  no vuelve a entrar en ninguna lista.

## Antes de mandar el primero

Manda **uno solo, a tu propio número**, y míralo en tu teléfono. La vista previa
de la app enseña exactamente el texto que va a salir, pero verlo llegar es otra
cosa.

## Si Meta bloquea el número

Pasa cuando mucha gente reporta los mensajes. Business Manager → Calidad del
número te dice el estado (verde/amarillo/rojo). Si se pone amarillo: para las
reactivaciones, deja solo citas y vacunas, y avísame.
