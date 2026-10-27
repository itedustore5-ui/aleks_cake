// Alati sa računara konsultantkinje (04.10.2026):
//   • prvi-korisnik na NOVOJ, praznoj bazi pravi odgovorno lice i konsultantski nalog (jedna transakcija, audit,
//     privremene lozinke), a bazu koja već ima odgovorno lice ili konsultanta odbija (npr. demo iz .env);
//   • dnevni-pregled javlja veličinu baze i upozorava kad je blizu granice besplatnog Supabase-a;
//   • uvoz-start upisuje fajl iz upitnika ateljea (upitnik-start/) u novu bazu: proba ne upisuje ništa, upis jednom, ponovo —
//     ništa novo; uređaji postaju kontrolne tačke sa svojom granicom i mjerenjem u planu; sastojci sa alergenima i serijom;
//     kupac bez telefona i sastojak bez granice se odbijaju; granice nisu potvrđene; demo baza i distributerski upitnik se odbijaju;
//   • nova baza ima kontrolne tačke KKT 1–3 (dopuna 36 / prvi-korisnik), osnovni plan i predložene granice — bez njih prijem i
//     predaja ne ocjenjuju temperaturu, a frižider se ne može ni izmjeriti.
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

// Upitnik ateljea (27.10.2026): dva frižidera, zamrzivač sa svojom granicom, BEZ vitrine; sastojci sa alergenima
// (šifre ih upitnik računa sam) i jaja sa obaveznom serijom.
const UPITNIK = {
  format: "pilot-upitnik-start", vrsta: "atelje", verzija: 2, sacuvano: "2026-10-27T08:00:00.000Z",
  firma: { naziv: "Nova d.o.o.", pib: "02999888", adresa: "Obala 13. jula bb", grad: "Bar", registracija: "", odgovorno: { ime: "Jelena Nović", telefon: "067 555 111", email: "" } },
  rad: { dani: { pon: true, uto: true, sri: true, cet: true, pet: true, sub: true, ned: false }, porudzbina: "15", dostava: true, napomena: "" },
  nemaTermometra: false,
  uredjaji: [
    { naziv: "Frižider za kremove", vrsta: "frizider", min: "0", max: "4" },
    { naziv: "Frižider za torte", vrsta: "frizider", min: "1", max: "5" },
    { naziv: "Zamrzivač", vrsta: "zamrzivac", min: "-22", max: "-18" },
  ],
  zaposleni: [
    { ime: "Jelena Nović", radnoMjesto: "vlasnica", rukujeHranom: true, knjizicaBroj: "SK-1", knjizicaRok: "2027-05-31", nalog: "vlasnica" },
    { ime: "Marko Marković", radnoMjesto: "poslastičar", rukujeHranom: true, knjizicaBroj: "SK-2", knjizicaRok: "2027-01-31", nalog: "zaposleni" },
    { ime: "Petar Nović", radnoMjesto: "dostava", rukujeHranom: false, knjizicaBroj: "", knjizicaRok: "", nalog: "" },
  ],
  dobavljaci: [{ naziv: "Mljekara d.o.o.", pib: "02123456", telefon: "040 123 456", mjesto: "Nikšić", roba: "pavlaka" }, { naziv: "Pekara", pib: "12", telefon: "", mjesto: "", roba: "" }],
  kupci: [{ naziv: "Kafe Centar", telefon: "067 123 456", pib: "03012345", adresa: "", kontakt: "" }, { naziv: "Kiosk bez telefona", telefon: "", pib: "", adresa: "", kontakt: "" }],
  artikli: [
    { naziv: "Slatka pavlaka 35% 1 l", jedinica: "kom", rezim: "rashladjeno", min: "0", max: "4", rok: true, serija: false, alergeni: "mlijeko", alergeniSifre: ["MLIJEKO"], alergeniUpisani: true, dobavljac: "Mljekara d.o.o.", sifra: "1001" },
    { naziv: "Jaja M 30 kom", jedinica: "kom", rezim: "rashladjeno", min: "", max: "", rok: true, serija: true, alergeni: "jaja", alergeniSifre: ["JAJA"], alergeniUpisani: true, dobavljac: "", sifra: "" },
    { naziv: "Maline smrznute 1 kg", jedinica: "kg", rezim: "smrznuto", min: "", max: "", rok: true, serija: false, alergeni: "nema", alergeniSifre: [], alergeniUpisani: true, dobavljac: "", sifra: "" },
    { naziv: "Šećer 1 kg", jedinica: "kg", rezim: "sobna", min: "", max: "", rok: true, serija: false, alergeni: "", alergeniSifre: [], alergeniUpisani: false, dobavljac: "", sifra: "" },
    { naziv: "Krem na ledu", jedinica: "kg", rezim: "drugo", min: "", max: "", rok: true, serija: false, alergeni: "", alergeniSifre: [], alergeniUpisani: false, dobavljac: "", sifra: "" },
  ],
  termometri: [{ naziv: "Ubodni", oznaka: "T-01", gdje: "frižideri", kalibracijaBroj: "K-55", kalibracijaDatum: "2026-01-10" }],
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
  const artPoslije = (await pool.query(`select count(*)::int as n from artikal where naziv = 'Krem na ledu' or naziv = 'Maline smrznute 1 kg'`)).rows[0].n;
  provjeri("uvoz-start: demo baza se odbija (upitnik klijenta ide samo u njegovu bazu), ništa se ne upisuje", demoUvoz.kod === 1 && /DEMO baza/.test(demoUvoz.izlaz) && artPoslije === 0, demoUvoz.izlaz.trim().slice(0, 200));
  const fajlDistributera = path.join(os.tmpdir(), `pilot-start-distributer-${Date.now().toString(36)}.json`);
  fs.writeFileSync(fajlDistributera, JSON.stringify({ ...UPITNIK, vrsta: undefined, verzija: 1 }));
  const distributer = await alat("alati/uvoz-start.ts", ["--fajl", fajlDistributera], { DATABASE_URL: URL_TESTA });
  fs.rmSync(fajlDistributera, { force: true });
  provjeri("uvoz-start: distributerski upitnik (magacini, vozila) se ne prima — kaže da se popuni upitnik ateljea", distributer.kod === 1 && /distributerski upitnik/.test(distributer.izlaz), distributer.izlaz.trim().slice(0, 200));

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
        const tacke = (await k.query(`select sifra from kontrolna_tacka`)).rows.map((x) => x.sifra).sort().join(",");
        provjeri(
          "Nova baza posle prvi-korisnik ima kontrolne tačke KKT 1–3, a za čuvanje svaki uređaj svoju (frižider, vitrina, zamrzivač)",
          tacke === "KKT1,KKT2,KKT2-V,KKT2-Z,KKT3",
          tacke,
        );
        const skladista = (await k.query(`select naziv from skladiste`)).rows.map((x) => x.naziv).join(",");
        provjeri("…i jedino, prazno skladište se zove „Atelje“ (ne „Glavni magacin“)", skladista === "Atelje", skladista);
        const granice = (await k.query(
          `select kt.sifra, p.min_vrijednost::float as min, p.max_vrijednost::float as max from pravilo_kontrole p join kontrolna_tacka kt on kt.id = p.kontrolna_tacka_id
           where p.artikal_id is null and p.aktivan order by kt.sifra`,
        )).rows.map((x) => `${x.sifra} ${x.min}..${x.max}`).join(", ");
        const planStavki = (await k.query(`select count(*)::int as n from plan_monitoringa where aktivan`)).rows[0].n;
        provjeri(
          "…i odmah osnovni plan monitoringa sa predloženim granicama (frižider, vitrina 0–4, zamrzivač −25..−18, predaja 0–6) — zaposleni može da mjeri od prvog dana",
          granice === "KKT2 0..4, KKT2-V 0..4, KKT2-Z -25..-18, KKT3 0..6" && planStavki >= 8 && /Osnovni plan monitoringa: \d+ stavki; predložene granice: 4/.test(r.izlaz),
          `${granice} · plan ${planStavki}`,
        );

        // ── uvoz-start ──
        const broj = async (sql) => (await k.query(sql)).rows[0].n;
        const proba = await alat("alati/uvoz-start.ts", ["--fajl", fajlUpitnika], { DATABASE_URL: nova });
        provjeri(
          "uvoz-start bez --upisi: kaže šta bi uradio (sastojci 4 nova, 1 odbijen; kupac bez telefona odbijen), a ništa ne upiše",
          proba.kod === 0 && /PROBA/.test(proba.izlaz) && /Sastojci\s+4 novih · 1 odbijeno/.test(proba.izlaz) && /Kiosk bez telefona: nema telefon/.test(proba.izlaz) &&
            (await broj(`select count(*)::int as n from artikal`)) === 0 && (await broj(`select count(*)::int as n from kupac`)) === 0 &&
            (await broj(`select count(*)::int as n from kontrolna_tacka where sifra = 'KKT2-F2'`)) === 0,
          proba.izlaz.trim().slice(0, 600),
        );
        const upis = await alat("alati/uvoz-start.ts", ["--fajl", fajlUpitnika, "--upisi"], { DATABASE_URL: nova });
        const jelena = (await k.query(`select sanitarna_knjizica_broj as b, to_char(sanitarna_knjizica_rok, 'YYYY-MM-DD') as r from lice where ime = 'Jelena Nović'`)).rows[0];
        const firma2 = (await k.query(`select pib, adresa, grad from firma`)).rows[0];
        provjeri(
          "uvoz-start --upisi: Jelena dopunjena knjižicom, 2 nova zaposlena; firma dopunjena; skladište ostaje „Atelje“",
          upis.kod === 0 && /Upisano/.test(upis.izlaz) &&
            jelena?.b === "SK-1" && jelena?.r === "2027-05-31" && (await broj(`select count(*)::int as n from lice`)) === 3 &&
            firma2.pib === "02999888" && firma2.adresa === "Obala 13. jula bb" && firma2.grad === "Bar" &&
            (await broj(`select count(*)::int as n from skladiste where naziv = 'Atelje'`)) === 1,
          `${upis.kod} ${JSON.stringify(jelena)} ${JSON.stringify(firma2)} | ${upis.izlaz.trim().slice(0, 300)}`,
        );
        const uredjaji = (await k.query(
          `select kt.sifra, kt.naziv, kt.aktivan, p.min_vrijednost::float as min, p.max_vrijednost::float as max, p.verzija,
                  (select count(*)::int from plan_monitoringa pm where pm.kontrolna_tacka_id = kt.id and pm.aktivan) as u_planu,
                  (select pm.naziv from plan_monitoringa pm where pm.kontrolna_tacka_id = kt.id and pm.aktivan limit 1) as plan_naziv
           from kontrolna_tacka kt left join pravilo_kontrole p on p.kontrolna_tacka_id = kt.id and p.artikal_id is null and p.aktivan
           where kt.sifra like 'KKT2%' order by kt.sifra`,
        )).rows;
        const u = Object.fromEntries(uredjaji.map((x) => [x.sifra, x]));
        provjeri(
          "…uređaji: prvi frižider preuzima KKT2 (ime iz upitnika, i u planu), drugi postaje KKT2-F2 sa svojom granicom u planu, zamrzivač dobija granicu iz upitnika (nova verzija), vitrine nema — isključena",
          u.KKT2?.naziv === "Frižider za kremove" && u.KKT2.plan_naziv === "Temperatura — Frižider za kremove (KKT2)" && u.KKT2.min === 0 && u.KKT2.max === 4 &&
            u["KKT2-F2"]?.naziv === "Frižider za torte" && u["KKT2-F2"].min === 1 && u["KKT2-F2"].max === 5 && u["KKT2-F2"].u_planu === 1 &&
            u["KKT2-Z"]?.min === -22 && u["KKT2-Z"].max === -18 && u["KKT2-Z"].verzija === 2 &&
            u["KKT2-V"]?.aktivan === false && u["KKT2-V"].u_planu === 0 && /Uređaji\s+1 nov · 2 dopunjeno/.test(upis.izlaz),
          JSON.stringify(uredjaji),
        );
        const sastojci = Object.fromEntries((await k.query(
          `select naziv, temp_min::float as min, temp_max::float as max, granica_potvrdio, zahtijeva_lot, alergeni, alergeni_upisani from artikal`,
        )).rows.map((x) => [x.naziv, x]));
        provjeri(
          "…sastojci: alergeni iz upitnika (prazno = nije upisano), jaja sa obaveznom serijom, granica NIJE potvrđena i ima pravilo na KKT 1 i KKT 3; kupci samo sa telefonom; šifra kod dobavljača; termometar",
          sastojci["Slatka pavlaka 35% 1 l"]?.alergeni.join() === "MLIJEKO" && sastojci["Slatka pavlaka 35% 1 l"].alergeni_upisani === true &&
            sastojci["Jaja M 30 kom"]?.zahtijeva_lot === true && sastojci["Jaja M 30 kom"].min === 0 && sastojci["Jaja M 30 kom"].max === 4 &&
            sastojci["Slatka pavlaka 35% 1 l"].zahtijeva_lot === false && sastojci["Maline smrznute 1 kg"]?.min === -25 && sastojci["Maline smrznute 1 kg"].alergeni_upisani === true &&
            sastojci["Šećer 1 kg"]?.alergeni_upisani === false && !sastojci["Krem na ledu"] &&
            Object.values(sastojci).every((x) => x.granica_potvrdio === false) &&
            (await broj(`select count(*)::int as n from pravilo_kontrole p join kontrolna_tacka kt on kt.id = p.kontrolna_tacka_id where kt.sifra in ('KKT1', 'KKT3') and p.artikal_id is not null and p.aktivan`)) === 6 &&
            (await broj(`select count(*)::int as n from kupac`)) === 1 && (await broj(`select count(*)::int as n from dobavljac where naziv = 'Pekara' and pib is null`)) === 1 &&
            (await broj(`select count(*)::int as n from artikal_dobavljaca where kljuc = 's:1001'`)) === 1 && (await broj(`select count(*)::int as n from mjerni_uredjaj`)) === 1,
          JSON.stringify(sastojci),
        );
        provjeri(
          "…svaki upis u audit, a nalozi se NE otvaraju (samo podsjetnik za one koji ga još nemaju; sastojci bez alergena)",
          (await broj(`select count(*)::int as n from audit_log where nove_vrijednosti->>'izvor' = 'alati/uvoz-start'`)) >= 15 && (await broj(`select count(*)::int as n from korisnik`)) === 2 &&
            /Marko Marković — Zaposleni/.test(upis.izlaz) && !/Jelena Nović — Vlasnica/.test(upis.izlaz) && /PRETPOSTAVLJENE/.test(upis.izlaz) && /1 sastojak bez upisanih alergena/.test(upis.izlaz),
          upis.izlaz.trim().slice(-600),
        );
        const ponovo = await alat("alati/uvoz-start.ts", ["--fajl", fajlUpitnika, "--upisi"], { DATABASE_URL: nova });
        provjeri(
          "…ponovni uvoz istog fajla: ništa novo (sve „već postoji“), bez duplikata tačaka, pravila i stavki plana",
          ponovo.kod === 0 && /Sastojci\s+4 već postoji/.test(ponovo.izlaz) && /Uređaji\s+3 već postoji/.test(ponovo.izlaz) && (await broj(`select count(*)::int as n from artikal`)) === 4 &&
            (await broj(`select count(*)::int as n from kontrolna_tacka where sifra like 'KKT2%'`)) === 4 && (await broj(`select count(*)::int as n from lice`)) === 3 &&
            (await broj(`select count(*)::int as n from pravilo_kontrole where artikal_id is null and aktivan`)) === 5 &&
            (await broj(`select count(*)::int as n from plan_monitoringa where aktivan and kontrolna_tacka_id is not null`)) === uredjaji.reduce((s, x) => s + x.u_planu, 0) + 2,
          ponovo.izlaz.trim().slice(0, 400),
        );
      } finally {
        await k.end();
        await pool.query(`drop database if exists ${ime} with (force)`).catch(() => undefined);
      }
    }

    // ── Prvo samo konsultant (27.10.2026): firma, „Atelje“ i tačke se prave; vlasnicu otvara u aplikaciji ──
    const ime2 = `pilot_kons_${Date.now().toString(36)}`;
    let napravljena2 = false;
    try {
      await pool.query(`create database ${ime2}`);
      napravljena2 = true;
    } catch (e) {
      provjeri(`prvi-korisnik samo konsultant · preskočeno (nova baza se ne može napraviti: ${e.message})`, true);
    }
    if (napravljena2) {
      const url2 = new URL(URL_TESTA);
      url2.pathname = `/${ime2}`;
      const nova2 = url2.toString();
      await alat("db/migriraj.ts", [], { DATABASE_URL: nova2 });
      const bezFirme = await alat("alati/prvi-korisnik.ts", ["--konsultant", "konsultantkinja"], { DATABASE_URL: nova2 });
      const samo = await alat("alati/prvi-korisnik.ts", ["--firma", "Proba atelje", "--konsultant", "konsultantkinja"], { DATABASE_URL: nova2 });
      const k2 = new pg.Client({ connectionString: nova2 });
      await k2.connect();
      try {
        const nalozi = (await k2.query(`select korisnicko_ime, uloga::text as uloga, mora_promijeniti_lozinku from korisnik`)).rows;
        const firma = (await k2.query(`select naziv, odgovorno_lice_ime from firma`)).rows;
        const tacke = (await k2.query(`select sifra from kontrolna_tacka`)).rows.map((x) => x.sifra).sort().join(",");
        const skladista = (await k2.query(`select naziv from skladiste`)).rows.map((x) => x.naziv).join(",");
        provjeri(
          "prvi-korisnik samo sa --konsultant na praznoj bazi: traži --firma, ništa ne upiše",
          bezFirme.kod === 1 && /nema firmu/.test(bezFirme.izlaz),
          bezFirme.izlaz.trim().slice(0, 160),
        );
        provjeri(
          "--firma + --konsultant: samo konsultantski nalog (privremena lozinka), firma bez odgovornog lica, „Atelje“, KKT 1–3 sa uređajima",
          samo.kod === 0 && nalozi.length === 1 && nalozi[0].uloga === "izvodjac" && nalozi[0].mora_promijeniti_lozinku === true &&
            firma.length === 1 && firma[0].naziv === "Proba atelje" && firma[0].odgovorno_lice_ime === null &&
            tacke === "KKT1,KKT2,KKT2-V,KKT2-Z,KKT3" && skladista === "Atelje" && /Ljudi → Novo lice/.test(samo.izlaz),
          `${samo.kod} ${JSON.stringify(nalozi)} ${JSON.stringify(firma)} ${tacke} ${skladista} | ${samo.izlaz.trim().slice(0, 200)}`,
        );
      } finally {
        await k2.end();
        await pool.query(`drop database if exists ${ime2} with (force)`).catch(() => undefined);
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
