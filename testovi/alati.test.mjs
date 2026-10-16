// Alati sa računara konsultantkinje (04.10.2026):
//   • prvi-korisnik na NOVOJ, praznoj bazi pravi odgovorno lice i konsultantski nalog (jedna transakcija, audit,
//     privremene lozinke), a bazu koja već ima odgovorno lice ili konsultanta odbija (npr. demo iz .env);
//   • dnevni-pregled javlja veličinu baze i upozorava kad je blizu granice besplatnog Supabase-a;
//   • uvoz-start upisuje fajl iz upitnika (upitnik-start/) u novu bazu: proba ne upisuje ništa, upis jednom, ponovo — ništa
//     novo; kupac bez telefona i artikal bez granice se odbijaju; granice nisu potvrđene; demo baza se odbija;
//   • nova baza ima kontrolne tačke KKT 1–3 (dopuna 36 / prvi-korisnik) — bez njih prijem i predaja ne ocjenjuju temperaturu.
// Nova baza se pravi samo na LOKALNOM klasteru (npm test / CI) i briše na kraju; na demo bazi se ta provjera preskače.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { pool } from "./pomoc.mjs";

export const naziv = "Alati: prvi nalozi (odgovorno lice + konsultant) na novoj bazi, zaštita od pogrešne baze, veličina baze u dnevnom pregledu";

const KORIJEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const URL_TESTA = process.env.DATABASE_URL ?? "";

/** Pokreni alat kao zaseban proces (isto kao `npm run …`), sa datom bazom. */
function alat(skripta, argumenti, env) {
  return new Promise((ok) => {
    const p = spawn(process.execPath, ["--import", "tsx", skripta, ...argumenti], { cwd: KORIJEN, env: { ...process.env, ...env } });
    let izlaz = "";
    p.stdout.on("data", (d) => (izlaz += d));
    p.stderr.on("data", (d) => (izlaz += d));
    p.on("close", (kod) => ok({ kod, izlaz }));
  });
}

const UPITNIK = {
  format: "pilot-upitnik-start", verzija: 1, sacuvano: "2026-10-11T08:00:00.000Z",
  firma: {
    naziv: "Nova d.o.o.", pib: "02999888", adresa: "Cetinjski put bb", grad: "Podgorica", registracija: "",
    roba: { rashladjeno: true, smrznuto: true, sobna: true }, drugaRoba: "",
    odgovorno: { ime: "Jelena Nović", telefon: "067 555 111", email: "" }, direktor: { ime: "Petar Nović", telefon: "", email: "" }, direktorJeOdgovorno: false,
  },
  rad: { dani: { pon: true, uto: true, sri: true, cet: true, pet: true, sub: true, ned: false }, prijema: "4", isporuka: "25", napomena: "" },
  nemaVozila: false, nemaTermometra: false,
  magacini: [{ naziv: "Magacin Podgorica", adresa: "Cetinjski put bb" }, { naziv: "Magacin Bar", adresa: "" }],
  komore: [{ naziv: "Komora 1", magacin: "Magacin Podgorica", rezim: "rashladjeno", min: "0", max: "4" }],
  vozila: [{ oznaka: "PG AB-123", tip: "kombi", rashladno: true, min: "0", max: "4" }, { oznaka: "PG XY-9", tip: "kamion", rashladno: true, min: "", max: "" }],
  zaposleni: [
    { ime: "Jelena Nović", radnoMjesto: "odgovorno lice", rukujeHranom: true, knjizicaBroj: "SK-1", knjizicaRok: "2027-05-31", nalog: "odgovorno", magacin: "Magacin Podgorica" },
    { ime: "Marko Marković", radnoMjesto: "magacioner", rukujeHranom: true, knjizicaBroj: "SK-2", knjizicaRok: "2027-01-31", nalog: "magacioner", magacin: "Magacin Podgorica" },
    { ime: "Petar Nović", radnoMjesto: "direktor", rukujeHranom: false, knjizicaBroj: "", knjizicaRok: "", nalog: "direktor", magacin: "" },
  ],
  dobavljaci: [{ naziv: "Mljekara d.o.o.", pib: "02123456", telefon: "040 123 456", mjesto: "Nikšić", roba: "mlijeko" }, { naziv: "Pekara", pib: "12", telefon: "", mjesto: "", roba: "" }],
  kupci: [{ naziv: "Market Centar", telefon: "067 123 456", pib: "03012345", adresa: "", adresaIsporuke: "", kontakt: "" }, { naziv: "Kiosk bez telefona", telefon: "", pib: "", adresa: "", adresaIsporuke: "", kontakt: "" }],
  artikli: [
    { naziv: "Mlijeko 2,8% 1 l", jedinica: "kom", rezim: "rashladjeno", min: "0", max: "4", rok: true, dobavljac: "Mljekara d.o.o.", sifra: "1001" },
    { naziv: "Sladoled vanila 1 l", jedinica: "kom", rezim: "smrznuto", min: "", max: "", rok: true, dobavljac: "", sifra: "" },
    { naziv: "Keks 200 g", jedinica: "kom", rezim: "sobna", min: "", max: "", rok: true, dobavljac: "", sifra: "" },
    { naziv: "Riba na ledu", jedinica: "kg", rezim: "drugo", min: "", max: "", rok: true, dobavljac: "", sifra: "" },
  ],
  termometri: [{ naziv: "Ubodni", oznaka: "T-01", gdje: "prijem", kalibracijaBroj: "K-55", kalibracijaDatum: "2026-01-10" }],
};

export async function pokreni({ provjeri }) {
  const fajlUpitnika = path.join(os.tmpdir(), `pilot-start-proba-${Date.now().toString(36)}.json`);
  fs.writeFileSync(fajlUpitnika, JSON.stringify(UPITNIK));
  // ── Zaštita: baza koja nije nova (ovdje — test baza sa demo nalozima) ───────────────────────────
  const prije = (await pool.query(`select count(*)::int as n from korisnik`)).rows[0].n;
  const bzr = await alat("alati/prvi-korisnik.ts", ["--firma", "Proba d.o.o.", "--ime", "Proba Probić", "--korisnik", "proba.bzr"], { DATABASE_URL: URL_TESTA });
  const kons = await alat("alati/prvi-korisnik.ts", ["--konsultant", "proba.konsultant"], { DATABASE_URL: URL_TESTA });
  const posle = (await pool.query(`select count(*)::int as n from korisnik`)).rows[0].n;
  provjeri(
    "prvi-korisnik: baza koja već ima odgovorno lice / konsultanta se odbija (npr. demo iz .env) — i kaže u koju bazu je htio",
    bzr.kod === 1 && /već ima odgovorno lice/.test(bzr.izlaz) && /^Baza: /m.test(bzr.izlaz) && kons.kod === 1 && /već ima konsultantski nalog/.test(kons.izlaz) && prije === posle,
    `${bzr.kod} ${bzr.izlaz.trim().slice(0, 160)} | ${kons.kod} ${kons.izlaz.trim().slice(0, 120)} | ${prije}→${posle}`,
  );

  const demoUvoz = await alat("alati/uvoz-start.ts", ["--fajl", fajlUpitnika, "--upisi"], { DATABASE_URL: URL_TESTA });
  const artPoslije = (await pool.query(`select count(*)::int as n from artikal where naziv = 'Riba na ledu' or naziv = 'Sladoled vanila 1 l'`)).rows[0].n;
  provjeri("uvoz-start: demo baza se odbija (upitnik klijenta ide samo u njegovu bazu), ništa se ne upisuje", demoUvoz.kod === 1 && /DEMO baza/.test(demoUvoz.izlaz) && artPoslije === 0, demoUvoz.izlaz.trim().slice(0, 200));

  // ── Nova, prazna baza: dopune pa prvi nalozi ─────────────────────────────────────────────────
  if (!URL_TESTA.includes("localhost")) {
    provjeri("prvi-korisnik na novoj bazi · preskočeno (nije lokalni klaster)", true);
  } else {
    const ime = `pilot_prvi_${Date.now().toString(36)}`;
    let napravljena = false;
    try {
      await pool.query(`create database ${ime}`);
      napravljena = true;
    } catch (e) {
      provjeri(`prvi-korisnik na novoj bazi · preskočeno (nova baza se ne može napraviti: ${e.message})`, true);
    }
    if (napravljena) {
      const url = new URL(URL_TESTA);
      url.pathname = `/${ime}`;
      const nova = url.toString();
      const bezTabela = await alat("alati/prvi-korisnik.ts", ["--firma", "Nova d.o.o.", "--ime", "Jelena Nović", "--korisnik", "jelena.n"], { DATABASE_URL: nova });
      provjeri("prvi-korisnik prije prvog deploy-a (baza bez tabela): kaže da se sačeka deploy", bezTabela.kod === 1 && /još nema tabela/.test(bezTabela.izlaz), bezTabela.izlaz.trim().slice(0, 160));

      const m = await alat("db/migriraj.ts", [], { DATABASE_URL: nova });
      const r = await alat("alati/prvi-korisnik.ts", ["--firma", "Nova d.o.o.", "--ime", "Jelena Nović", "--korisnik", "jelena.n", "--konsultant", "konsultant.cg"], { DATABASE_URL: nova });
      const k = new pg.Client({ connectionString: nova });
      await k.connect();
      try {
        const nalozi = (await k.query(
          `select k.korisnicko_ime, k.uloga::text as uloga, k.mora_promijeniti_lozinku, l.ime from korisnik k left join lice l on l.id = k.lice_id order by k.uloga`,
        )).rows;
        const firma = (await k.query(`select naziv, odgovorno_lice_ime from firma`)).rows;
        const audit = (await k.query(`select count(*)::int as n from audit_log where entitet_tip = 'korisnik' and akcija = 'KREIRANJE'`)).rows[0].n;
        const b = nalozi.find((x) => x.uloga === "bzr");
        const i = nalozi.find((x) => x.uloga === "izvodjac");
        provjeri(
          "prvi-korisnik na novoj bazi: odgovorno lice (sa licem) i konsultant (bez lica), obje lozinke privremene, firma, audit",
          m.kod === 0 && r.kod === 0 && nalozi.length === 2 && b?.korisnicko_ime === "jelena.n" && b?.ime === "Jelena Nović" && i?.korisnicko_ime === "konsultant.cg" && !i?.ime &&
            nalozi.every((x) => x.mora_promijeniti_lozinku) && firma.length === 1 && firma[0].naziv === "Nova d.o.o." && audit === 2,
          `${m.kod} ${r.kod} ${JSON.stringify(nalozi)} ${JSON.stringify(firma)} audit ${audit} | ${r.izlaz.trim().slice(0, 200)}`,
        );
        provjeri("…lozinke se ispišu jednom (dvije, po 14 znakova), šifra zaposlenog se ne ispisuje (#17)", (r.izlaz.match(/^\s+(odgovorno lice|konsultant)\s+\S+\s+\S{14}$/gm) ?? []).length === 2 && !/Šifra/.test(r.izlaz), r.izlaz.trim());
        const opet = await alat("alati/prvi-korisnik.ts", ["--konsultant", "drugi.konsultant"], { DATABASE_URL: nova });
        provjeri("…drugi konsultant u istoj bazi se odbija (jedan po bazi)", opet.kod === 1 && /već ima konsultantski nalog/.test(opet.izlaz), opet.izlaz.trim().slice(0, 160));
        const tacke = (await k.query(`select sifra from kontrolna_tacka order by sifra`)).rows.map((x) => x.sifra).join(",");
        provjeri("Nova baza posle prvi-korisnik ima kontrolne tačke KKT 1–3 (bez njih nema ocjene temperature)", tacke === "KKT1,KKT2,KKT3", tacke);

        // ── uvoz-start ──
        const broj = async (sql) => (await k.query(sql)).rows[0].n;
        const proba = await alat("alati/uvoz-start.ts", ["--fajl", fajlUpitnika], { DATABASE_URL: nova });
        provjeri(
          "uvoz-start bez --upisi: kaže šta bi uradio (artikli 3 nova, 1 odbijen; kupac bez telefona odbijen), a ništa ne upiše",
          proba.kod === 0 && /PROBA/.test(proba.izlaz) && /Artikli\s+3 novih · 1 odbijeno/.test(proba.izlaz) && /Kiosk bez telefona: nema telefon/.test(proba.izlaz) &&
            (await broj(`select count(*)::int as n from artikal`)) === 0 && (await broj(`select count(*)::int as n from kupac`)) === 0,
          proba.izlaz.trim().slice(0, 600),
        );
        const upis = await alat("alati/uvoz-start.ts", ["--fajl", fajlUpitnika, "--upisi"], { DATABASE_URL: nova });
        const magacini = (await k.query(`select naziv, adresa from skladiste order by naziv`)).rows;
        const jelena = (await k.query(`select sanitarna_knjizica_broj as b, to_char(sanitarna_knjizica_rok, 'YYYY-MM-DD') as r from lice where ime = 'Jelena Nović'`)).rows[0];
        const sladoled = (await k.query(`select temp_min::float as min, temp_max::float as max, granica_potvrdio from artikal where naziv = 'Sladoled vanila 1 l'`)).rows[0];
        const firma2 = (await k.query(`select pib, adresa, grad from firma`)).rows[0];
        provjeri(
          "uvoz-start --upisi: prazni „Glavni magacin“ preimenovan + drugi magacin; vozila; Jelena dopunjena knjižicom, 2 nova zaposlena; firma dopunjena",
          upis.kod === 0 && /Upisano/.test(upis.izlaz) &&
            JSON.stringify(magacini) === JSON.stringify([{ naziv: "Magacin Bar", adresa: null }, { naziv: "Magacin Podgorica", adresa: "Cetinjski put bb" }]) &&
            (await broj(`select count(*)::int as n from vozilo`)) === 2 && (await broj(`select count(*)::int as n from vozilo where registarski_broj = 'PG XY-9' and temp_min = 0 and temp_max = 4`)) === 1 &&
            jelena?.b === "SK-1" && jelena?.r === "2027-05-31" && (await broj(`select count(*)::int as n from lice`)) === 3 &&
            firma2.pib === "02999888" && firma2.adresa === "Cetinjski put bb" && firma2.grad === "Podgorica",
          `${upis.kod} ${JSON.stringify(magacini)} ${JSON.stringify(jelena)} ${JSON.stringify(firma2)} | ${upis.izlaz.trim().slice(0, 300)}`,
        );
        provjeri(
          "…kupci samo sa telefonom; dobavljač sa lošim PIB-om upisan bez PIB-a; artikli sa granicom koja NIJE potvrđena i pravilom na KKT 1 i KKT 3; šifra kod dobavljača upamćena; termometar",
          (await broj(`select count(*)::int as n from kupac`)) === 1 && (await broj(`select count(*)::int as n from dobavljac where naziv = 'Pekara' and pib is null`)) === 1 &&
            (await broj(`select count(*)::int as n from artikal`)) === 3 && sladoled?.min === -25 && sladoled?.max === -18 && sladoled?.granica_potvrdio === false &&
            (await broj(`select count(*)::int as n from artikal where granica_potvrdio`)) === 0 &&
            (await broj(`select count(*)::int as n from pravilo_kontrole p join kontrolna_tacka kt on kt.id = p.kontrolna_tacka_id where kt.sifra in ('KKT1', 'KKT3') and p.artikal_id is not null and p.aktivan`)) === 4 &&
            (await broj(`select count(*)::int as n from artikal_dobavljaca where kljuc = 's:1001'`)) === 1 && (await broj(`select count(*)::int as n from mjerni_uredjaj`)) === 1,
          JSON.stringify(sladoled),
        );
        provjeri(
          "…svaki upis u audit, a nalozi se NE otvaraju (samo podsjetnik: magacioner, direktor)",
          (await broj(`select count(*)::int as n from audit_log where nove_vrijednosti->>'izvor' = 'alati/uvoz-start'`)) >= 15 && (await broj(`select count(*)::int as n from korisnik`)) === 2 &&
            /Marko Marković — magacioner/.test(upis.izlaz) && /PRETPOSTAVLJENE/.test(upis.izlaz),
          upis.izlaz.trim().slice(-500),
        );
        const ponovo = await alat("alati/uvoz-start.ts", ["--fajl", fajlUpitnika, "--upisi"], { DATABASE_URL: nova });
        provjeri(
          "…ponovni uvoz istog fajla: ništa novo (sve „već postoji“), bez duplikata",
          ponovo.kod === 0 && /Artikli\s+3 već postoji/.test(ponovo.izlaz) && (await broj(`select count(*)::int as n from artikal`)) === 3 && (await broj(`select count(*)::int as n from skladiste`)) === 2 && (await broj(`select count(*)::int as n from lice`)) === 3,
          ponovo.izlaz.trim().slice(0, 400),
        );
      } finally {
        await k.end();
        await pool.query(`drop database if exists ${ime} with (force)`).catch(() => undefined);
      }
    }
  }

  fs.rmSync(fajlUpitnika, { force: true });

  // ── Dnevni pregled: veličina baze i upozorenje ────────────────────────────────────────────────
  // KLIJENTI_FAJL na nepostojeći fajl → gleda samo DATABASE_URL (test bazu), ne prave klijente ni demo iz .env.
  const env = { DATABASE_URL: URL_TESTA, KLIJENTI_FAJL: path.join(KORIJEN, ".testbaza", "nema-klijenata.txt") };
  const obicno = await alat("alati/dnevni-pregled.ts", [], env);
  const blizu = await alat("alati/dnevni-pregled.ts", [], { ...env, BAZA_UPOZORENJE_MB: "1" });
  provjeri(
    "dnevni-pregled: javlja veličinu baze (i koliko su otpremnice); preko granice upozorenja — upozorenje i izlazni kod 1",
    /baza \d+ MB \(otpremnice \d+ MB\)/.test(obicno.izlaz) && !/BAZA \d+ MB/.test(obicno.izlaz) && blizu.kod === 1 && /BAZA \d+ MB \(granica upozorenja 1 MB\)/.test(blizu.izlaz),
    `${obicno.izlaz.trim().slice(0, 200)} | ${blizu.kod} ${blizu.izlaz.trim().slice(0, 200)}`,
  );
}
