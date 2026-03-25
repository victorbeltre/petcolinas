/**
 * PetColinas - Google Apps Script
 * Vincula el Google Form de registro al CRM (Supabase pc_clientes)
 *
 * INSTALACIÓN:
 * 1. Abre el Google Sheet vinculado al formulario
 * 2. Extensiones → Apps Script
 * 3. Pega todo este código y guarda
 * 4. En el menú: Ejecutar → configurarTrigger (solo la primera vez)
 * 5. Autoriza los permisos cuando se solicite
 */

// ─── CONFIGURACIÓN ──────────────────────────────────────────────────────────
var SUPA_URL = "https://ulrzzddovkioxeaarnjk.supabase.co";
var SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVscnp6ZGRvdmtpb3hlYWFybmprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMjc3MDEsImV4cCI6MjA4ODYwMzcwMX0.mX3cei5kKAID3WhmMAojhk2QOMs8gDF1LFbYHKXrfUM";

/**
 * MAPEO DE CAMPOS DEL FORMULARIO
 *
 * Ajusta los textos de la izquierda para que coincidan EXACTAMENTE
 * con las preguntas de tu Google Form (sin importar mayúsculas).
 *
 * Cada entrada es: "texto de la pregunta en el form" → campo del CRM
 */
var CAMPO_FORM = {
  // Datos de la mascota
  "nombre de la mascota":    "nombremascota",
  "nombre mascota":          "nombremascota",
  "mascota":                 "nombremascota",
  "especie":                 "especie",
  "tipo de mascota":         "especie",
  "raza":                    "raza",
  "sexo":                    "sexo",
  "color":                   "color",
  "fecha de nacimiento":     "fechanacimiento",
  "tamaño":                  "tamano",
  "tamano":                  "tamano",
  "esterilizado":            "esterilizado",
  "esterilizada":            "esterilizado",
  "castrado":                "esterilizado",
  "alergias":                "alergias",
  "condiciones":             "condiciones",
  "medicamentos":            "medicamentos",
  "veterinario externo":     "veterinarioexterno",
  "veterinario anterior":    "veterinarioexterno",

  // Datos del dueño
  "nombre del propietario":  "nombrepropietario",
  "nombre del dueño":        "nombrepropietario",
  "nombre del dueno":        "nombrepropietario",
  "propietario":             "nombrepropietario",
  "dueño":                   "nombrepropietario",
  "nombre completo":         "nombrepropietario",
  "telefono":                "telefono",
  "teléfono":                "telefono",
  "celular":                 "telefono",
  "whatsapp":                "telefono",
  "correo":                  "email",
  "email":                   "email",
  "correo electrónico":      "email",
  "dirección":               "direccion",
  "direccion":               "direccion",
  "instagram":               "instagram",

  // Campos especiales
  "¿cómo nos conociste?":    "_como_conocio",
  "como nos conociste":      "_como_conocio",
  "¿cómo nos conoció?":      "_como_conocio",
  "como nos conocio":        "_como_conocio",
  "¿cómo se enteró?":        "_como_conocio",
  "servicio que busca":      "_servicio",
  "servicio deseado":        "_servicio",
  "tipo de servicio":        "_servicio",
  "servicio":                "_servicio",
  "¿qué servicio busca?":    "_servicio",
  "que servicio busca":      "_servicio",
};

// ─── TRIGGER (ejecutar solo una vez) ────────────────────────────────────────
function configurarTrigger() {
  // Elimina triggers existentes para evitar duplicados
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "onFormSubmit") {
      ScriptApp.deleteTrigger(t);
    }
  });
  // Crear nuevo trigger on form submit
  ScriptApp.newTrigger("onFormSubmit")
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onFormSubmit()
    .create();
  Logger.log("✅ Trigger configurado correctamente.");
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
  var comoConoci = "";
  var servicio = "";

  Object.keys(namedValues).forEach(function(pregunta) {
    var valor = (namedValues[pregunta] || [""])[0] || "";
    valor = valor.toString().trim();
    if (!valor) return;

    var campoKey = pregunta.toLowerCase().trim();
    var campoCRM = CAMPO_FORM[campoKey];

    // Búsqueda parcial si no hay coincidencia exacta
    if (!campoCRM) {
      Object.keys(CAMPO_FORM).forEach(function(k) {
        if (!campoCRM && (campoKey.includes(k) || k.includes(campoKey))) {
          campoCRM = CAMPO_FORM[k];
        }
      });
    }

    if (!campoCRM) return; // Campo del form no mapeado, ignorar

    if (campoCRM === "_como_conocio") {
      comoConoci = valor;
    } else if (campoCRM === "_servicio") {
      servicio = valor;
    } else if (campoCRM === "esterilizado" || campoCRM === "castrado") {
      cliente[campoCRM] = /s[ií]|yes|true/i.test(valor);
    } else if (campoCRM === "fechanacimiento") {
      cliente[campoCRM] = parsearFecha(valor);
    } else {
      // Para especie, normalizar a Perro/Gato/Otro
      if (campoCRM === "especie") {
        valor = normalizarEspecie(valor);
      }
      // Si ya existe el campo (por preguntas duplicadas), priorizar el más largo
      if (!cliente[campoCRM] || valor.length > cliente[campoCRM].length) {
        cliente[campoCRM] = valor;
      }
    }
  });

  // Construir campo notas (requerido para que aparezca en Notificaciones)
  var notasParts = ["Nos conocio"];
  if (comoConoci) notasParts.push("via: " + comoConoci);
  if (servicio)   notasParts.push("Servicio: " + servicio);
  cliente.notas = notasParts.join(" | ");

  // Fecha de registro = hoy
  cliente.fecharegistro = Utilities.formatDate(new Date(), "America/Santo_Domingo", "yyyy-MM-dd");

  return cliente;
}

// ─── INSERTAR EN SUPABASE ────────────────────────────────────────────────────
function insertarEnCRM(cliente) {
  var url = SUPA_URL + "/rest/v1/pc_clientes";
  var payload = JSON.stringify(cliente);

  var options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "apikey": SUPA_KEY,
      "Authorization": "Bearer " + SUPA_KEY,
      "Prefer": "return=minimal,resolution=merge-duplicates"
    },
    payload: payload,
    muteHttpExceptions: true
  };

  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();

  if (code !== 200 && code !== 201) {
    throw new Error("Supabase error " + code + ": " + response.getContentText());
  }

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
 * Ajusta los valores de prueba abajo según tus campos reales.
 */
function probarConDatosFicticios() {
  var datosTest = {
    "Nombre de la mascota":     ["Luna Test"],
    "Especie":                  ["Perro"],
    "Raza":                     ["Shih Tzu"],
    "Nombre del propietario":   ["Maria Rodriguez"],
    "Teléfono":                 ["829-555-1234"],
    "Correo electrónico":       ["maria@test.com"],
    "¿Cómo nos conociste?":     ["Instagram"],
    "Servicio que busca":       ["Baño y corte"]
  };
  onFormSubmit({ namedValues: datosTest });
}
