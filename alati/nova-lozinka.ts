// Nova privremena lozinka za postojeći nalog — kad konsultant zaboravi svoju (29.10.2026: u aplikaciji je niko ne može
// postaviti — vlasnica ne smije dirati nalog konsultanta, #13, a lozinka se čuva samo kao heš, #28).
// Pokreće se sa računara konsultantkinje (pristup bazi je već dokaz ovlašćenja):
//   npm run nova-lozinka -- --korisnik konsultant
// Baza: DATABASE_URL iz .env (za drugog klijenta: DATABASE_URL=... npm run nova-lozinka -- --korisnik ...).
// Lozinka se ispiše JEDNOM, samo u terminalu; privremena je (mijenja se pri prvoj prijavi). Prekida sve prijave tog
// naloga i upisuje se u audit. Vlasnici i zaposlenima novu lozinku postavlja konsultant u aplikaciji (Ljudi → Nalozi).
import "dotenv/config";
import crypto from "node:crypto";
import { Pool } from "pg";
import { hashLozinke, MINIMALNA_DUZINA_LOZINKE } from "../server/lozinke.js";

function argument(naziv: string): string | undefined {
  const i = process.argv.indexOf(`--${naziv}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const NAZIV_ULOGE: Record<string, string> = { izvodjac: "konsultant", bzr: "vlasnica", operater: "zaposleni" };
const novaLozinka = () => crypto.randomBytes(12).toString("base64url").slice(0, MINIMALNA_DUZINA_LOZINKE + 4);

async function main() {
  const korisnickoIme = argument("korisnik")?.trim().toLowerCase();
  if (!korisnickoIme) {
    console.error("Upotreba: npm run nova-lozinka -- --korisnik korisnicko.ime");
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL nije podešen u .env.");
  const adresa = new URL(url);
  console.log(`Baza: ${adresa.hostname} · korisnik ${decodeURIComponent(adresa.username)} · ${adresa.pathname.slice(1) || "postgres"}`);

  const pool = new Pool({ connectionString: url, ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false } });
  const klijent = await pool.connect();
  let lozinka = "";
  let k: { id: string; uloga: string; aktivan: boolean; dva_koraka: boolean } | undefined;
  try {
    await klijent.query("begin");
    k = (await klijent.query<{ id: string; uloga: string; aktivan: boolean; dva_koraka: boolean }>(
      `select id, uloga::text as uloga, aktivan, (totp_ukljucen_at is not null) as dva_koraka from korisnik where korisnicko_ime = $1 for update`,
      [korisnickoIme],
    )).rows[0];
    if (!k) {
      const postoje = (await klijent.query<{ korisnicko_ime: string; uloga: string }>(
        `select korisnicko_ime, uloga::text as uloga from korisnik where aktivan order by uloga, korisnicko_ime limit 12`,
      )).rows;
      throw new Error(`Nalog „${korisnickoIme}“ ne postoji u ovoj bazi. Nalozi: ${postoje.map((x) => `${x.korisnicko_ime} (${NAZIV_ULOGE[x.uloga] ?? x.uloga})`).join(", ") || "nema ih"}.`);
    }
    if (!k.aktivan) throw new Error(`Nalog „${korisnickoIme}“ je deaktiviran — prvo ga treba ponovo aktivirati.`);
    lozinka = novaLozinka();
    await klijent.query(
      `update korisnik set lozinka_hash = $1, lozinka_stanje = 'privremena', mora_promijeniti_lozinku = true, updated_at = now() where id = $2`,
      [await hashLozinke(lozinka), k.id],
    );
    await klijent.query(`delete from sesija_prijave where korisnik_id = $1`, [k.id]);
    await klijent.query(`delete from prijava_izazov where korisnik_id = $1`, [k.id]);
    await klijent.query(
      `insert into audit_log (korisnik_id, akcija, entitet_tip, entitet_id, nove_vrijednosti) values (null, 'SIGURNOST', 'korisnik', $1, $2)`,
      [k.id, JSON.stringify({ radnja: "postavljena nova privremena lozinka alatom konsultanta", izvor: "alati/nova-lozinka" })],
    );
    await klijent.query("commit");
  } catch (greska) {
    await klijent.query("rollback").catch(() => undefined);
    console.error(`\n${(greska as Error).message}\nNišta nije promijenjeno.\n`);
    process.exitCode = 1;
    return;
  } finally {
    klijent.release();
    await pool.end();
  }

  console.log(`\nNova privremena lozinka (${NAZIV_ULOGE[k.uloga] ?? k.uloga}) — mijenja se pri prvoj prijavi:`);
  console.log(`  ${korisnickoIme.padEnd(22)} ${lozinka}`);
  console.log("\nLozinka se više neće prikazati. Stara lozinka više ne važi, a sve prijave tog naloga su prekinute.");
  if (k.dva_koraka) console.log(`Nalog ima potvrdu u dva koraka — uz lozinku traži i kod sa telefona (izgubljen telefon: npm run iskljuci-2fa -- --korisnik ${korisnickoIme}).`);
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
