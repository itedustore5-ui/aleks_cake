// Nove lozinke za pet demo naloga na DEMO bazi (talas 5): repozitorijum je od 20. do 29.09.2026. bio
// javan, a početne demo lozinke stoje u kodu — svako je mogao ući u demo kao konsultant.
//   npm run demo-lozinke
// Radi SAMO na demo bazi (pet demo naloga sa fiksnim ID-jevima). Nove lozinke upiše u .env
// (DEMO_LOZINKA_*, za npm run test:e2e) i ispiše ih jednom. Sve prijave demo naloga se prekidaju.
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { hashLozinke } from "../server/lozinke.js";

const DEMO = [
  { kljuc: "KONSULTANT", ime: "konsultant", id: "11000000-0000-0000-0000-000000000001" },
  { kljuc: "ANA", ime: "ana.b", id: "11000000-0000-0000-0000-000000000002" },
  { kljuc: "MARKO", ime: "marko.v", id: "11000000-0000-0000-0000-000000000003" },
  { kljuc: "PETAR", ime: "petar.j", id: "11000000-0000-0000-0000-000000000004" },
  { kljuc: "DIREKTOR", ime: "direktor", id: "11000000-0000-0000-0000-000000000005" },
];

/** 14 znakova, čitljivo (bez 0/O, 1/l/I), uz crticu u sredini — lako se prekuca na sastanku. */
function novaLozinka() {
  const znakovi = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const b = crypto.randomBytes(14);
  const s = [...b].map((x) => znakovi[x % znakovi.length]).join("");
  return `${s.slice(0, 7)}-${s.slice(7, 14)}`;
}

function upisiUEnv(vrijednosti: Record<string, string>) {
  const fajl = path.resolve(".env");
  let tekst = fs.existsSync(fajl) ? fs.readFileSync(fajl, "utf8") : "";
  for (const [kljuc, vrijednost] of Object.entries(vrijednosti)) {
    const red = `${kljuc}=${vrijednost}`;
    const re = new RegExp(`^${kljuc}=.*$`, "m");
    tekst = re.test(tekst) ? tekst.replace(re, red) : `${tekst.replace(/\n?$/, "\n")}${red}\n`;
  }
  fs.writeFileSync(fajl, tekst, "utf8");
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL nije podešen u .env.");
  const pool = new Pool({ connectionString: url, ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false } });
  try {
    const r = await pool.query<{ n: number }>(
      `select count(*)::int as n from korisnik where (id::text, korisnicko_ime) in (select * from unnest($1::text[], $2::text[]))`,
      [DEMO.map((d) => d.id), DEMO.map((d) => d.ime)],
    );
    if (r.rows[0].n !== DEMO.length) {
      console.error("Ovo NIJE demo baza (nema svih pet demo naloga) — ništa nije promijenjeno.");
      process.exit(1);
    }
    const nove: Record<string, string> = {};
    const klijent = await pool.connect();
    try {
      await klijent.query("begin");
      for (const d of DEMO) {
        const lozinka = novaLozinka();
        nove[`DEMO_LOZINKA_${d.kljuc}`] = lozinka;
        await klijent.query(`update korisnik set lozinka_hash = $1, mora_promijeniti_lozinku = false, updated_at = now() where id = $2`, [await hashLozinke(lozinka), d.id]);
        await klijent.query(`delete from sesija_prijave where korisnik_id = $1`, [d.id]);
      }
      await klijent.query("commit");
    } catch (e) {
      await klijent.query("rollback");
      throw e;
    } finally {
      klijent.release();
    }
    upisiUEnv(nove);
    console.log("\nNove lozinke demo naloga (upisane i u .env kao DEMO_LOZINKA_*):");
    for (const d of DEMO) console.log(`  ${d.ime.padEnd(12)} ${nove[`DEMO_LOZINKA_${d.kljuc}`]}`);
    console.log("\nSve prijave demo naloga su prekinute. Ove lozinke nigdje ne objavljujte.\n");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
