// Isključuje potvrdu u dva koraka nalogu koji je izgubio telefon I rezervne kodove (#81).
// Pokreće se sa računara konsultantkinje (pristup bazi je već dokaz ovlašćenja):
//   npm run iskljuci-2fa -- --korisnik ana.b
// Baza: DATABASE_URL iz .env (za drugog klijenta: DATABASE_URL=... npm run iskljuci-2fa -- --korisnik ...).
// Prekida sve prijave tog naloga i upisuje se u audit. Poslije: korisnik se prijavi lozinkom i odmah
// ponovo uključi potvrdu na Mojoj strani.
import "dotenv/config";
import { Pool } from "pg";

function argument(naziv: string): string | undefined {
  const i = process.argv.indexOf(`--${naziv}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const korisnickoIme = argument("korisnik")?.trim().toLowerCase();
  if (!korisnickoIme) {
    console.error("Upotreba: npm run iskljuci-2fa -- --korisnik korisnicko.ime");
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL nije podešen u .env.");
  const pool = new Pool({ connectionString: url, ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false } });
  const klijent = await pool.connect();
  try {
    await klijent.query("begin");
    const k = (await klijent.query<{ id: string; ukljuceno: boolean }>(
      `select id, totp_ukljucen_at is not null or totp_tajna is not null as ukljuceno from korisnik where korisnicko_ime = $1 for update`, [korisnickoIme],
    )).rows[0];
    if (!k) {
      console.error(`Nalog "${korisnickoIme}" ne postoji u ovoj bazi.`);
      process.exit(1);
    }
    if (!k.ukljuceno) {
      console.log(`Nalog "${korisnickoIme}" nema uključenu potvrdu u dva koraka — ništa se ne mijenja.`);
      await klijent.query("rollback");
      return;
    }
    await klijent.query(`update korisnik set totp_tajna = null, totp_ukljucen_at = null, totp_zadnji_korak = null, totp_rezervni = '{}' where id = $1`, [k.id]);
    await klijent.query(`delete from sesija_prijave where korisnik_id = $1`, [k.id]);
    await klijent.query(`delete from prijava_izazov where korisnik_id = $1`, [k.id]);
    await klijent.query(
      `insert into audit_log (korisnik_id, akcija, entitet_tip, entitet_id, nove_vrijednosti) values (null, 'SIGURNOST', 'korisnik', $1, $2)`,
      [k.id, JSON.stringify({ radnja: "potvrda u dva koraka isključena alatom konsultanta (izgubljen telefon)" })],
    );
    await klijent.query("commit");
    console.log(`Potvrda u dva koraka je isključena za "${korisnickoIme}", sve prijave su prekinute. Neka se prijavi i odmah je ponovo uključi (Moja strana).`);
  } catch (e) {
    await klijent.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    klijent.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
