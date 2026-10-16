// Testovi ekrana na telefonu (talas 6): pravi pregledač (Chrome, bez prozora) u veličini telefona
// 375 × 812, svih pet uloga, izgrađena aplikacija kao na Renderu (service worker, paket po stranama).
//
// npm run test:ekrani            — sopstvena čista baza + izgrađena aplikacija (testovi/izolovano.mjs --ekrani)
// node testovi/ekrani/pokreni.mjs bez_mreze — samo scenariji čiji naziv fajla sadrži "bez_mreze", na serveru
//                                  iz APP_URL (produkcijska gradnja — inače nema service workera)
//
// Pregledač se ne preuzima — koristi se instaliran Chrome (PW_KANAL=msedge za Edge).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { APP_URL, pool, provjeriDemoBazu, noviRezultati } from "../pomoc.mjs";
import { pokreniPregledac, zatvoriPregledac } from "./telefon.mjs";

const folder = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2];

try {
  const z = await fetch(`${APP_URL}/api/zdravlje`).catch(() => null);
  if (!z || z.status !== 200) throw new Error(`Server na ${APP_URL} ne odgovara na /api/zdravlje.`);
  await provjeriDemoBazu();
  await pokreniPregledac();
} catch (e) {
  console.error(e.message);
  await pool.end();
  process.exit(2);
}

const fajlovi = (await fs.readdir(folder)).filter((f) => f.endsWith(".ekran.mjs") && (!filter || f.includes(filter))).sort();
const sazetak = [];
for (const fajl of fajlovi) {
  const { lista, provjeri } = noviRezultati();
  try {
    // Uvoz u try: fajl sa greškom (npr. sintaksa) je pao test, ne pad cijelog prolaza.
    const modul = await import(pathToFileURL(path.join(folder, fajl)).href);
    console.log(`\n▶ ${modul.naziv ?? fajl}`);
    await modul.pokreni({ provjeri });
  } catch (e) {
    lista.push({ naziv: "test se srušio", ok: false });
    console.log(`  ✗ test se srušio: ${e.stack ?? e}`);
  }
  sazetak.push({ fajl, ukupno: lista.length, pali: lista.filter((r) => !r.ok).length });
}

await zatvoriPregledac();
await pool.end();

console.log("\n──────── Sažetak (ekrani) ────────");
for (const s of sazetak) console.log(`${s.pali === 0 ? "✓" : "✗"} ${s.fajl.padEnd(32)} ${s.ukupno - s.pali}/${s.ukupno}`);
const pali = sazetak.reduce((z, s) => z + s.pali, 0);
const ukupno = sazetak.reduce((z, s) => z + s.ukupno, 0);
console.log(`\n${ukupno - pali}/${ukupno} provjera prošlo.`);
process.exit(pali === 0 ? 0 : 1);
