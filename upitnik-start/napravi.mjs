// Pravi Upitnik-za-pocetak.html — fajl koji se šalje distributeru (otvara se dvoklikom, radi i bez interneta;
// sa internetom učita i slova aplikacije). Izvor je upitnik.html — on se objavljuje i kao stranica na claude.ai,
// gdje se omot (doctype, head) dodaje sam, pa ga ovdje dodajemo isti.
//
//   node upitnik-start/napravi.mjs
import fs from "node:fs";

const izvor = new URL("./upitnik.html", import.meta.url);
const cilj = new URL("./Upitnik-za-pocetak.html", import.meta.url);
const sadrzaj = fs.readFileSync(izvor, "utf8");
const omot =
  `<!doctype html><html lang="sr-Latn-ME"><head><meta charset="utf-8">` +
  `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">` +
  `<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}` +
  `body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>\n` +
  `${sadrzaj}\n</body></html>\n`;
fs.writeFileSync(cilj, omot);
console.log(`Napravljeno: ${cilj.pathname.split("/").pop()} (${Math.round(omot.length / 1024)} KB)`);
