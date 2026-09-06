/**
 * PetColinas - Google Apps Script
 * Vincula el Google Form de registro al CRM (Supabase pc_clientes)
 *
 * INSTALACIÓN:
 * 1. En script.google.com (o Extensiones → Apps Script desde la hoja),
 *    crea un proyecto y pega todo este código.
 * 2. En el menú: Ejecutar → configurarTrigger (solo la primera vez)
 * 3. Autoriza los permisos cuando se solicite.
 *
 * NOTA (6 sep 2026): este script ya NO escribe directo en Supabase con la
 * llave anon (que es pública). Ahora llama a la Edge Function `form-intake`,
 * que valida un secreto compartido y escribe con la llave de servicio.
 *
 * Del lado de Supabase ya está todo listo: la función está desplegada y el
 * secreto guardado (tabla pc_secretos, invisible para la app). Aquí solo hace
 * falta pegar este archivo. Para comprobarlo: Ejecutar → diagnostico.
 *
 * NOTA (22 ago 2026): este proyecto vive como script SUELTO en Drive, no
 * pegado dentro de la hoja de respuestas. Por eso el trigger se engancha a
 * la hoja por ID (SPREADSHEET_ID) en vez de usar
 * SpreadsheetApp.getActiveSpreadsheet(), que solo funciona si el script se
 * abre desde Extensiones → Apps Script DENTRO de esa hoja. Con el ID fijo
 * funciona igual sin tener que mover el proyecto.
 */

// ─── CONFIGURACIÓN ──────────────────────────────────────────────────────────
var SUPA_URL = "https://ulrzzddovkioxeaarnjk.supabase.co";

// Este script YA NO usa la llave anon de Supabase.
//
// Antes escribía directo en la API REST con esa llave, que es pública (va
// dentro de index.html, y cualquiera que abra la app se la puede copiar). Para
// que funcionara hubo que abrirle permiso de escritura al rol anónimo sobre
// pc_clientes — o sea, cualquiera podía meter fichas falsas en el CRM.
//
// Ahora llama a la Edge Function `form-intake`, que valida un secreto que solo
// conoce este script y escribe con la llave de servicio del lado del servidor.
// Es el mismo patrón que ya usa el cobro con tarjeta (pagadito-cobro).
var FUNCION_URL = SUPA_URL + "/functions/v1/form-intake";

// El MISMO texto que está guardado en Supabase, en la tabla pc_secretos
// (fila FORM_INTAKE_SECRET). Si los dos no coinciden, la función responde 401
// y no se guarda nada. Para rotarlo: cambiarlo en los dos sitios.
var FORM_SECRET = "1H5Evyq7fabCDJY90GVrmjaoZmTnUie_";

// ID de "Ficha de Ingreso — PetColinas (respuestas)". Se saca de su URL:
// https://docs.google.com/spreadsheets/d/ESTE_PEDAZO/edit
var SPREADSHEET_ID = "15FJq5GZNtl_T_qy7aq29dyLY9Ox-um49uEA6GXirEV0";

/**
 * MAPEO DE CAMPOS DEL FORMULARIO
 *
 * Las claves son las preguntas REALES de "Ficha de Ingreso — PetColinas",
 * normalizadas (minúsculas, sin tildes, sin el asterisco de obligatorio).
 * Se comparan de forma EXACTA.
 *
 * Antes esto hacía coincidencia por subcadena y se quedaba con el valor más
 * largo, lo que rompía las fichas de forma silenciosa (6 sep 2026):
 *   · "¿Autorizas a PetColinas a publicar fotos de tu MASCOTA...?" contenía
 *     "mascota", así que "✅ Sí, autorizo" terminaba guardado como el NOMBRE
 *     de la mascota — pisando el nombre real por ser más largo.
 *   · "Fecha de Nacimiento de mascota" hacía lo mismo.
 *   · "Nombre y TELÉFONO del contacto de emergencia" pisaba el teléfono real.
 * De 12 fichas que entraron así, 8 quedaron con la mascota llamada
 * "✅ Sí, autorizo". Por eso ahora la coincidencia es exacta y sin adivinar.
 */
var CAMPO_FORM = {
  // ── Dueño ────────────────────────────────────────────────────────────────
  "nombre completo":                        "nombrepropietario",
  "cedula / pasaporte":                     "cedula",
  "telefono / whatsapp":                    "telefono",
  "correo electronico":                     "email",
  "direccion":                              "direccion",

  // ── Mascota ──────────────────────────────────────────────────────────────
  "nombre de la mascota":                   "nombremascota",
  "especie":                                "especie",
  "raza":                                   "raza",
  "fecha de nacimiento de mascota":         "fechanacimiento",
  "sexo":                                   "sexo",
  "¿esta castrado/a?":                      "esterilizado",
  "color / senas particulares":             "color",
  "alergias conocidas":                     "alergias",
  "condiciones medicas / medicacion actual": "condiciones",
  "veterinario de cabecera (si tiene)":     "veterinarioexterno",

  // ── Van al campo de notas, no tienen columna propia ───────────────────────
  "¿como nos conociste?":                   "_como_conocio",
  "¿que servicio deseas hoy?":              "_servicio",
  "nombre del contacto de emergencia":      "_emergencia_nombre",
  "nombre y telefono del contacto de emergencia": "_emergencia_tel",
  "peso aproximado (kg)":                   "_peso",
  "¿vacunas al dia?":                       "_vacunas",
  "observaciones o solicitudes especiales": "_observaciones",

  // ── Se ignoran a proposito ───────────────────────────────────────────────
  // "Fecha de nacimiento" a secas es la del DUEÑO, no la de la mascota.
  "marca temporal":                         "_ignorar",
  "fecha de nacimiento":                    "_ignorar",
  "¿autorizas a petcolinas a publicar fotos de tu mascota en redes sociales?": "_fotos",
  "autorizacion y terminos de servicio":    "_ignorar",
};

/** Quita tildes, el asterisco de obligatorio y espacios de sobra. */
function normalizarPregunta(texto) {
  return String(texto || "")
    .replace(/\*/g, " ")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // á → a
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ─── TRIGGER (ejecutar solo una vez) ────────────────────────────────────────
function configurarTrigger() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // Elimina triggers existentes para evitar duplicados
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "onFormSubmit") {
      ScriptApp.deleteTrigger(t);
    }
  });
  // Crear nuevo trigger on form submit, enganchado por ID (no por "hoja activa")
  ScriptApp.newTrigger("onFormSubmit")
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();
  Logger.log("✅ Trigger configurado correctamente sobre: " + ss.getName());
}

// ─── HANDLER PRINCIPAL ──────────────────────────────────────────────────────
function onFormSubmit(e) {
  try {
    var respuestas = e.namedValues; // { "Pregunta": ["valor"], ... }
    var cliente = parsearRespuestas(respuestas);

    // Validación mínima
    if (!cliente.nombremascota && !cliente.nombrepropietario) {
      Logger.log("⚠️ Respuesta sin nombre de mascota ni propietario, ignorada.");
      return;
    }

    // Insertar en Supabase
    var resultado = insertarEnCRM(cliente);
    Logger.log("✅ Cliente insertado: " + cliente.nombremascota + " | Respuesta: " + resultado);

  } catch (err) {
    Logger.log("❌ Error en onFormSubmit: " + err.toString());
    // Enviar email de error al admin (opcional)
    // MailApp.sendEmail("petcolinasrd@gmail.com", "Error Form→CRM", err.toString());
  }
}

// ─── PARSEAR RESPUESTAS ──────────────────────────────────────────────────────
function parsearRespuestas(namedValues) {
  var cliente = {};
  var extra = {};          // lo que no tiene columna propia y va a notas
  var sinMapear = [];      // preguntas nuevas del form que nadie mapeo aun

  Object.keys(namedValues).forEach(function(pregunta) {
    var valor = (namedValues[pregunta] || [""])[0] || "";
    valor = valor.toString().trim();
    if (!valor) return;

    // Coincidencia EXACTA sobre la pregunta normalizada. Nada de subcadenas:
    // ahi estaba el bug que llenaba las fichas de "✅ Sí, autorizo".
    var campoCRM = CAMPO_FORM[normalizarPregunta(pregunta)];

    if (!campoCRM) { sinMapear.push(pregunta); return; }
    if (campoCRM === "_ignorar") return;

    if (campoCRM.charAt(0) === "_") {          // va a notas
      extra[campoCRM] = valor;
    } else if (campoCRM === "esterilizado") {
      cliente[campoCRM] = /^s[ií]\b/i.test(valor);   // "Sí" sí, "No sé" no
    } else if (campoCRM === "fechanacimiento") {
      cliente[campoCRM] = parsearFecha(valor) || valor;  // si no se entiende, se guarda tal cual
    } else if (campoCRM === "especie") {
      cliente[campoCRM] = normalizarEspecie(valor);
    } else if (!cliente[campoCRM]) {
      // El PRIMERO gana. Antes ganaba el mas largo, y por eso el texto de
      // autorizacion (largo) pisaba el nombre real de la mascota (corto).
      cliente[campoCRM] = valor;
    }
  });

  // Notas: lo que no tiene columna propia pero la doctora necesita leer.
  var notas = ["Nos conocio"];
  if (extra._como_conocio)   notas.push("via: " + extra._como_conocio);
  if (extra._servicio)       notas.push("Servicio: " + extra._servicio);
  if (extra._peso)           notas.push("Peso: " + extra._peso);
  if (extra._vacunas)        notas.push("Vacunas: " + extra._vacunas);
  var emerg = extra._emergencia_tel || extra._emergencia_nombre;
  if (emerg)                 notas.push("Emergencia: " + emerg);
  if (extra._observaciones)  notas.push("Obs: " + extra._observaciones);
  if (extra._fotos && /^\u274c|no autorizo/i.test(extra._fotos)) {
    notas.push("NO autoriza fotos en redes");
  }
  cliente.notas = notas.join(" | ");

  cliente.fecharegistro = Utilities.formatDate(new Date(), "America/Santo_Domingo", "yyyy-MM-dd");

  // Si alguien agrega una pregunta al formulario y nadie actualiza CAMPO_FORM,
  // el dato se perderia en silencio. Queda avisado en el registro.
  if (sinMapear.length > 0) {
    Logger.log("\u26a0\ufe0f Preguntas sin mapear (su respuesta NO se guardo): " + sinMapear.join(" ; "));
  }
  return cliente;
}

// ─── INSERTAR EN SUPABASE (vía Edge Function) ───────────────────────────────
function insertarEnCRM(cliente) {
  var response = UrlFetchApp.fetch(FUNCION_URL, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ secreto: FORM_SECRET, cliente: cliente }),
    muteHttpExceptions: true
  });
  var code = response.getResponseCode();
  var texto = response.getContentText();

  if (code !== 200 && code !== 201) {
    throw new Error("form-intake " + code + ": " + texto);
  }
  // 200 con duplicado = la ficha ya existía (misma mascota y teléfono).
  // No es un error: alguien llenó el formulario dos veces.
  try {
    var r = JSON.parse(texto);
    if (r && r.duplicado) return "HTTP 200 (ya existía, id " + r.id + ")";
    if (r && r.id) return "HTTP " + code + " (id " + r.id + ")";
  } catch (e) { /* respuesta sin JSON */ }
  return "HTTP " + code;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function normalizarEspecie(val) {
  var v = val.toLowerCase();
  if (v.includes("perro") || v.includes("dog") || v.includes("can")) return "Perro";
  if (v.includes("gato") || v.includes("cat") || v.includes("fel")) return "Gato";
  return val; // Dejar el valor original si no es perro/gato
}

function parsearFecha(val) {
  if (!val) return null;
  // Intenta DD/MM/YYYY → YYYY-MM-DD
  var m = val.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return m[3] + "-" + m[2].padStart(2,"0") + "-" + m[1].padStart(2,"0");
  // Si ya es YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  return null;
}

/**
 * FUNCIÓN DE PRUEBA
 * Ejecuta esta función para probar sin necesitar un envío real del form.
 */
function probarConDatosFicticios() {
  var datosTest = {
    "Nombre de la mascota":     ["Luna Test"],
    "Especie":                  ["Perro"],
    "Nombre completo":          ["Maria Rodriguez"],
    "Teléfono / WhatsApp":      ["829-555-1234"],
    "¿Cómo nos conociste?":     ["Instagram"]
  };
  onFormSubmit({ namedValues: datosTest });
}

/**
 * DIAGNÓSTICO
 *
 * No imprime la llave (el registro también la enmascara, así que mostrarla no
 * prueba nada). En vez de eso mide cosas que el enmascarado no puede falsear:
 * cuántos caracteres se salen del alfabeto de un JWT, y la huella SHA-256.
 * Si la huella coincide, la llave es idéntica byte por byte a la buena.
 */
function diagnostico() {
  Logger.log("1. Largo del secreto: " + FORM_SECRET.length + "   (debe ser 32)");

  var invalidos = 0, ejemplos = [];
  for (var i = 0; i < FORM_SECRET.length; i++) {
    var c = FORM_SECRET.charAt(i), n = FORM_SECRET.charCodeAt(i);
    var ok = (n >= 48 && n <= 57) || (n >= 65 && n <= 90) ||
             (n >= 97 && n <= 122) || c === "-" || c === "_";
    if (!ok) {
      invalidos++;
      if (ejemplos.length < 5) ejemplos.push("posicion " + i + " = codigo " + n);
    }
  }
  Logger.log("2. Caracteres invalidos: " + invalidos + "   (debe ser 0)");
  if (invalidos > 0) {
    Logger.log("   >>> SECRETO DAÑADO. " + ejemplos.join(" | "));
    Logger.log("   >>> Codigo 8226 = bullets (•): se pego un texto ya enmascarado.");
  }

  // Huella del secreto: el registro tambien puede enmascarar el texto, asi que
  // se compara por hash en vez de a ojo.
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, FORM_SECRET, Utilities.Charset.UTF_8);
  var hex = "";
  for (var j = 0; j < bytes.length; j++) {
    var b = bytes[j] < 0 ? bytes[j] + 256 : bytes[j];
    hex += (b < 16 ? "0" : "") + b.toString(16);
  }
  Logger.log("3. Huella del secreto: " + hex.substring(0, 16) + "   (debe ser f4c7a48b2654afa2)");

  // Prueba real contra la funcion, con un secreto a proposito equivocado:
  // debe contestar 401. Si contesta otra cosa, algo esta mal configurado.
  var r = UrlFetchApp.fetch(FUNCION_URL, {
    method: "post", contentType: "application/json",
    payload: JSON.stringify({ secreto: "no-es-el-secreto", cliente: { nombremascota: "x" } }),
    muteHttpExceptions: true
  });
  Logger.log("4. La funcion responde: HTTP " + r.getResponseCode() + "   (debe ser 401)");
  if (r.getResponseCode() === 500) {
    Logger.log("   >>> 500 = la funcion no encuentra la fila FORM_INTAKE_SECRET en pc_secretos.");
  }

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  Logger.log("5. Hoja encontrada: " + ss.getName());
}
