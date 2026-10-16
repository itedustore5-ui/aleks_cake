// Prvi nalozi u NOVOJ bazi klijenta — pokreće se sa računara konsultantkinje, posle prvog deploy-a
// (server pri pokretanju sam napravi tabele):
//
//   npm run prvi-korisnik -- --firma "Naziv d.o.o." --ime "Ime Prezime" --korisnik ime.prezime --konsultant moje.ime
//
// --firma/--ime/--korisnik — odgovorno lice za bezbjednost hrane (bzr), prvi nalog u firmi;
// --konsultant              — konsultantski nalog (izvodjac). Samo on otvara nalog direktoru (uprava), upisuje
//                             adresu i PIB firme (Podešavanje) i dobija obavještenje kad odgovorno lice samo zatvori
//                             neusaglašenost („bez četiri oka“, #41). Može i sam, kasnije: --konsultant moje.ime
//
// Zaštita (04.10.2026): ispisuje u koju bazu upisuje, odbija bazu koja već ima odgovorno lice ili konsultanta
// (npr. demo iz .env kad se zaboravi DATABASE_URL nove baze) i sve upisuje u JEDNOJ transakciji, sa auditom.
import "dotenv/config";
import crypto from "node:crypto";
import pg from "pg";
import { hashLozinke, MINIMALNA_DUZINA_LOZINKE } from "../server/lozinke.js";
import { sljedeciBroj } from "../server/services/brojeviService.js";

function argument(naziv: string): string | undefined {
  const indeks = process.argv.indexOf(`--${naziv}`);
  return indeks === -1 ? undefined : process.argv[indeks + 1];
}

const UPOTREBA = `Upotreba:
  npm run prvi-korisnik -- --firma "Naziv d.o.o." --ime "Ime Prezime" --korisnik ime.prezime [--konsultant moje.ime]
  npm run prvi-korisnik -- --konsultant moje.ime          (samo konsultantski nalog, u bazi koja već ima odgovorno lice)`;

const novaLozinka = () => crypto.randomBytes(12).toString("base64url").slice(0, MINIMALNA_DUZINA_LOZINKE + 4);

async function main() {
  const firmaNaziv = argument("firma");
  const ime = argument("ime");
  const korisnickoIme = argument("korisnik");
  const konsultant = argument("konsultant");
  const odgovorno = Boolean(firmaNaziv || ime || korisnickoIme);
  if ((odgovorno && (!firmaNaziv || !ime || !korisnickoIme)) || (!odgovorno && !konsultant)) {
    console.error(UPOTREBA);
    process.exit(1);
  }
  if (konsultant && konsultant === korisnickoIme) {
    console.error("Konsultant i odgovorno lice moraju imati različita korisnička imena.");
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL nije podešen — postavite adresu NOVE baze klijenta.");
  const adresa = new URL(connectionString);
  console.log(`Baza: ${adresa.hostname} · korisnik ${decodeURIComponent(adresa.username)} · ${adresa.pathname.slice(1) || "postgres"}`);

  const pool = new pg.Pool({ connectionString, ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: false } });
  const klijent = await pool.connect();
  const lozinke: { korisnik: string; uloga: string; lozinka: string }[] = [];
  try {
    const tabele = (await klijent.query<{ ima: string | null }>(`select to_regclass('public.korisnik')::text as ima`)).rows[0].ima;
    if (!tabele) {
      throw new Error("U bazi još nema tabela. Sačekajte da se prvi deploy na Renderu završi (server sam pravi tabele) ili pokrenite npm run migriraj.");
    }
    const postojeci = (await klijent.query<{ korisnicko_ime: string; uloga: string }>(
      `select korisnicko_ime, uloga::text as uloga from korisnik where uloga in ('bzr', 'izvodjac') order by uloga, korisnicko_ime`,
    )).rows;
    const bzr = postojeci.filter((k) => k.uloga === "bzr");
    const izvodjac = postojeci.filter((k) => k.uloga === "izvodjac");
    if (odgovorno && bzr.length) {
      throw new Error(`Ova baza već ima odgovorno lice (${bzr.map((k) => k.korisnicko_ime).join(", ")}) — nije nova. Provjerite DATABASE_URL (možda je ostala adresa iz .env).`);
    }
    if (konsultant && izvodjac.length) {
      throw new Error(`Ova baza već ima konsultantski nalog (${izvodjac.map((k) => k.korisnicko_ime).join(", ")}) — u jednoj bazi je jedan.`);
    }
    for (const ki of [korisnickoIme, konsultant].filter(Boolean) as string[]) {
      if ((await klijent.query(`select 1 from korisnik where korisnicko_ime = $1`, [ki])).rows.length) throw new Error(`Korisničko ime "${ki}" već postoji.`);
    }

    await klijent.query("begin");
    const audit = (id: string, vrijednosti: Record<string, unknown>) =>
      klijent.query(
        `insert into audit_log (korisnik_id, akcija, entitet_tip, entitet_id, nove_vrijednosti) values (null, 'KREIRANJE', 'korisnik', $1, $2)`,
        [id, JSON.stringify({ ...vrijednosti, izvor: "alati/prvi-korisnik" })],
      );

    if (odgovorno) {
      if (!(await klijent.query(`select 1 from firma limit 1`)).rows.length) {
        await klijent.query(`insert into firma (naziv, odgovorno_lice_ime) values ($1, $2)`, [firmaNaziv, ime]);
      }
      // Kontrolne tačke KKT 1–3 (vidi dopunu 36): bez njih prijem i predaja tiho preskaču ocjenu temperature.
      await klijent.query(
        `insert into kontrolna_tacka (sifra, naziv, opis)
         select v.sifra, v.naziv, v.opis from (values
           ('KKT1', 'Prijem robe', 'Kontrola temperature i ispravnosti pri prijemu'),
           ('KKT2', 'Skladištenje', 'Kontrola temperature rashladnih komora'),
           ('KKT3', 'Vozilo i isporuka', 'Kontrola vozila i temperature pri isporuci')
         ) as v (sifra, naziv, opis)
         where not exists (select 1 from kontrolna_tacka k where k.sifra = v.sifra)`,
      );
      // Šifra je unutrašnji evidencioni broj (#17) — zaposlenom ne treba, pa se ne ispisuje.
      const lice = await klijent.query<{ id: string }>(
        `insert into lice (ime, radno_mjesto, rukuje_hranom, sifra) values ($1, 'Odgovorno lice za bezbjednost hrane', true, $2) returning id`,
        [ime, await sljedeciBroj(klijent, "lice", "M", 2)],
      );
      const lozinka = novaLozinka();
      const k = await klijent.query<{ id: string }>(
        `insert into korisnik (korisnicko_ime, lozinka_hash, uloga, lice_id, mora_promijeniti_lozinku) values ($1, $2, 'bzr', $3, true) returning id`,
        [korisnickoIme, await hashLozinke(lozinka), lice.rows[0].id],
      );
      await audit(k.rows[0].id, { korisnicko_ime: korisnickoIme, uloga: "bzr", ime });
      lozinke.push({ korisnik: korisnickoIme!, uloga: "odgovorno lice", lozinka });
    }

    if (konsultant) {
      // Konsultant nije zaposleni firme — nalog bez lica (ime je korisničko ime).
      const lozinka = novaLozinka();
      const k = await klijent.query<{ id: string }>(
        `insert into korisnik (korisnicko_ime, lozinka_hash, uloga, mora_promijeniti_lozinku) values ($1, $2, 'izvodjac', true) returning id`,
        [konsultant, await hashLozinke(lozinka)],
      );
      await audit(k.rows[0].id, { korisnicko_ime: konsultant, uloga: "izvodjac" });
      lozinke.push({ korisnik: konsultant, uloga: "konsultant", lozinka });
    }
    await klijent.query("commit");
  } catch (greska) {
    await klijent.query("rollback").catch(() => undefined);
    console.error(`\n${(greska as Error).message}\n`);
    process.exitCode = 1;
    return;
  } finally {
    klijent.release();
    await pool.end();
  }

  console.log("\nNalozi napravljeni (privremene lozinke — mijenjaju se pri prvoj prijavi):");
  for (const l of lozinke) console.log(`  ${l.uloga.padEnd(15)} ${l.korisnik.padEnd(22)} ${l.lozinka}`);
  console.log("\nLozinke se više neće prikazati. Lozinku odgovornog lica predajte lično ili telefonom — ne mejlom.");
  console.log("Sljedeće:");
  if (konsultant) {
    console.log("  • prijavite se kao konsultant → Moja strana → potvrda u dva koraka; zatim na Renderu OBAVEZNA_2FA=izvodjac");
    console.log("  • Podešavanje → adresa i PIB firme; Ljudi → direktor i nalog (uloga Uprava)");
  }
  if (odgovorno) console.log("  • dodajte red u alati/klijenti.txt (Naziv = adresa baze) — bekap i dnevni pregled ga uzimaju sami");
  console.log("");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
