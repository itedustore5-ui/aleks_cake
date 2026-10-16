// npm run test:e2e              — svi testovi
// npm run test:e2e -- povlacenje — samo testovi čiji naziv fajla sadrži "povlacenje"
//
// Traži: server koji radi (APP_URL iz .env, podrazumijevano http://localhost:5000) i DEMO bazu u
// DATABASE_URL — istu bazu koju koristi taj server. Svaki test briše sve što je napravio.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { APP_URL, pool, provjeriDemoBazu, noviRezultati } from "./pomoc.mjs";

const folder = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2];

try {
  const zdravlje = await fetch(`${APP_URL}/api/zdravlje`).catch(() => null);
  if (!zdravlje || zdravlje.status !== 200) {
    console.error(`Server na ${APP_URL} ne odgovara na /api/zdravlje — pokrenite "npm run dev" ili postavite APP_URL.`);
    process.exit(2);
  }
  await provjeriDemoBazu();
} catch (e) {
  console.error(e.message);
  await pool.end();
  process.exit(2);
}

const fajlovi = (await fs.readdir(folder)).filter((f) => f.endsWith(".test.mjs") && (!filter || f.includes(filter))).sort();
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

await pool.end();

console.log("\n──────── Sažetak ────────");
for (const s of sazetak) console.log(`${s.pali === 0 ? "✓" : "✗"} ${s.fajl.padEnd(32)} ${s.ukupno - s.pali}/${s.ukupno}`);
const pali = sazetak.reduce((z, s) => z + s.pali, 0);
const ukupno = sazetak.reduce((z, s) => z + s.ukupno, 0);
console.log(`\n${ukupno - pali}/${ukupno} provjera prošlo.`);
process.exit(pali === 0 ? 0 : 1);
