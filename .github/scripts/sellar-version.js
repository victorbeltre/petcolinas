// Sella index.html y version.txt con la misma marca de compilación.
// Sirve para que la app detecte cuando el navegador está mostrando una copia
// vieja en caché y ofrezca recargar, en vez de que el usuario vea cambios que
// ya están desplegados pero no le llegan.
const fs = require("fs");
const marca = new Date().toISOString().slice(0, 16).replace("T", " ") + "Z";
let html = fs.readFileSync("index.html", "utf8");
if (!/const PC_BUILD = "[^"]*";/.test(html)) {
  console.error("No se encontró PC_BUILD en index.html");
  process.exit(1);
}
html = html.replace(/const PC_BUILD = "[^"]*";/, `const PC_BUILD = "${marca}";`);
fs.writeFileSync("index.html", html);
fs.writeFileSync("version.txt", marca + "\n");
console.log("Versión sellada:", marca);
