// Uvoz upitnika za početak (upitnik-start/) u bazu NOVOG klijenta — da konsultant ne prepisuje ručno.
// Pokreće se sa računara konsultantkinje, POSLIJE `npm run prvi-korisnik`:
//
//   npm run uvoz-start -- --fajl pilot-start-firma-2026-10-11.json            (samo pokaže šta bi uradio)
//   npm run uvoz-start -- --fajl pilot-start-firma-2026-10-11.json --upisi    (upiše)
//
// Sve ide u JEDNOJ transakciji (#35): bez --upisi se na kraju poništi, pa je ispis tačno ono što bi upis uradio.
// Ista pravila kao aplikacija: šifra zaposlenog iz sljedeciBroj (#34), granica artikla postaje pravilo (#39) i
// NIJE potvrđena (#5 — potvrđuje je čovjek u Šifarnicima), kupac bez telefona se ne upisuje (#4), PIB ciframa i
// jedinstven (#66), u lice samo broj i rok knjižice (#15), audit za svaki upis (#45). Nalozi se NE otvaraju —
// lozinke postavlja odgovorno lice u aplikaciji (#28). Ono što već postoji se preskače (može se pokrenuti ponovo).
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";
import { pool } from "../server/db.js";
import { logIzmjena, logKreiranje } from "../server/services/auditService.js";
import { sljedeciBroj } from "../server/services/brojeviService.js";
import { uskladiPravilaArtikla } from "../server/services/pravilaService.js";
import { kljucArtikla } from "../server/services/otpremnicaService.js";

function argument(naziv: string): string | undefined {
  const i = process.argv.indexOf(`--${naziv}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

type Red = Record<string, unknown>;
type Fajl = {
  format?: string;
  firma?: Red & { roba?: Red; odgovorno?: Red; direktor?: Red };
  rad?: Red & { dani?: Record<string, boolean> };
  nemaVozila?: boolean;
  nemaTermometra?: boolean;
  [lista: string]: unknown;
};

const t = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const cifre = (v: unknown) => t(v).replace(/[\s.\-/]/g, "");
const kljuc = (v: unknown) => t(v).toLowerCase().replace(/\s+/g, " ");
const oznakaVozila = (v: unknown) => t(v).toUpperCase().replace(/[\s-]/g, "");
const broj = (v: unknown) => {
  const s = t(v).replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};
const lista = (f: Fajl, ime: string): Red[] => (Array.isArray(f[ime]) ? (f[ime] as Red[]).filter((r) => r && typeof r === "object") : []);
// Isti režimi i pretpostavljene granice kao u aplikaciji (GRANICA_REZIMA) i u upitniku.
const PREDLOG: Record<string, [number, number]> = { rashladjeno: [0, 4], smrznuto: [-25, -18] };
const NAZIV_ULOGE: Record<string, string> = { magacioner: "magacioner", vozac: "vozač", odgovorno: "odgovorno lice", direktor: "direktor (Uprava — otvara konsultant)" };

/** Ishod jedne grupe: šta je novo, šta postoji, šta je odbijeno i zašto, i napomene za konsultanta. */
class Ishod {
  novi = 0;
  postoji = 0;
  dopunjeno = 0;
  odbijeno: string[] = [];
  napomene: string[] = [];
  constructor(readonly naziv: string) {}
  ispis() {
    const dijelovi = [
      this.novi && `${this.novi} ${this.novi === 1 ? "nov" : "novih"}`,
      this.dopunjeno && `${this.dopunjeno} dopunjeno`,
      this.postoji && `${this.postoji} već postoji — preskačem`,
      this.odbijeno.length && `${this.odbijeno.length} odbijeno`,
    ].filter(Boolean);
    console.log(`  ${this.naziv.padEnd(12)} ${dijelovi.length ? dijelovi.join(" · ") : "ništa"}`);
    for (const o of this.odbijeno) console.log(`      ✗ ${o}`);
    for (const n of this.napomene) console.log(`      · ${n}`);
  }
}

async function uvezi(klijent: PoolClient, f: Fajl, izvor: Record<string, unknown>) {
  const audit = (tip: string, id: string, vrijednosti: Red) => logKreiranje(klijent, { korisnikId: null, entitetTip: tip, entitetId: id, noveVrijednosti: { ...vrijednosti, ...izvor } });
  const ishodi: Ishod[] = [];
  const podsjetnik: string[] = [];

  // ── Firma: samo dopuna praznog; drugačiju postojeću vrijednost ne mijenja, nego kaže ──────────
  const firmaIshod = new Ishod("Firma");
  ishodi.push(firmaIshod);
  const firma = (await klijent.query<{ id: string; pib: string | null; adresa: string | null; grad: string | null; odgovorno_lice_ime: string | null }>(
    `select id, pib, adresa, grad, odgovorno_lice_ime from firma limit 1 for update`,
  )).rows[0];
  const ff = f.firma ?? {};
  const pibFirme = cifre(ff.pib);
  type KolonaFirme = "pib" | "adresa" | "grad" | "odgovorno_lice_ime";
  const zaFirmu: [KolonaFirme, string][] = [];
  if (pibFirme && !/^\d{8,13}$/.test(pibFirme)) firmaIshod.napomene.push(`PIB „${t(ff.pib)}“ nije ispravan — nije upisan.`);
  for (const [kolona, vrijednost] of [
    ["pib", /^\d{8,13}$/.test(pibFirme) ? pibFirme : ""],
    ["adresa", t(ff.adresa)],
    ["grad", t(ff.grad)],
    ["odgovorno_lice_ime", t(ff.odgovorno?.ime)],
  ] as [KolonaFirme, string][]) {
    if (!vrijednost) continue;
    const sada = t(firma[kolona]);
    if (!sada) zaFirmu.push([kolona, vrijednost]);
    else if (kljuc(sada) !== kljuc(vrijednost)) firmaIshod.napomene.push(`${kolona} u bazi („${sada}“) razlikuje se od upitnika („${vrijednost}“) — ne mijenjam.`);
  }
  if (zaFirmu.length) {
    await klijent.query(`update firma set ${zaFirmu.map(([k], i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() where id = $1`, [firma.id, ...zaFirmu.map(([, v]) => v)]);
    await logIzmjena(klijent, {
      korisnikId: null, entitetTip: "firma", entitetId: firma.id,
      stareVrijednosti: Object.fromEntries(zaFirmu.map(([k]) => [k, firma[k]])),
      noveVrijednosti: { ...Object.fromEntries(zaFirmu), ...izvor },
    });
    firmaIshod.dopunjeno = 1;
    firmaIshod.napomene.push(`dopunjeno: ${zaFirmu.map(([k]) => k.replace("odgovorno_lice_ime", "odgovorno lice")).join(", ")}`);
  }
  if (!f.firma?.direktorJeOdgovorno && t(ff.direktor?.ime)) podsjetnik.push(`Direktor ${t(ff.direktor?.ime)}: nalog „Uprava“ otvara konsultant (Ljudi).`);

  // ── Magacini: podrazumijevani prazni „Glavni magacin“ dobija ime i adresu prvog iz upitnika ──
  const magIshod = new Ishod("Magacini");
  ishodi.push(magIshod);
  const magacini = new Map((await klijent.query<{ id: string; naziv: string; adresa: string | null }>(`select id, naziv, adresa from skladiste`)).rows.map((s) => [kljuc(s.naziv), s]));
  const izFajla = lista(f, "magacini").filter((m) => t(m.naziv));
  const samoPodrazumijevani = magacini.size === 1 && magacini.has("glavni magacin");
  let preimenovan = "";
  if (samoPodrazumijevani && izFajla.length && !magacini.has(kljuc(izFajla[0].naziv))) {
    const korisceno = (await klijent.query<{ da: boolean }>(
      `select exists (select 1 from prijem) or exists (select 1 from isporuka) or exists (select 1 from mjerenje_temperature) or exists (select 1 from zapis) as da`,
    )).rows[0].da;
    if (!korisceno) {
      const glavni = magacini.get("glavni magacin")!;
      await klijent.query(`update skladiste set naziv = $2, adresa = coalesce(nullif($3, ''), adresa) where id = $1`, [glavni.id, t(izFajla[0].naziv), t(izFajla[0].adresa)]);
      await logIzmjena(klijent, { korisnikId: null, entitetTip: "skladiste", entitetId: glavni.id, stareVrijednosti: { naziv: glavni.naziv, adresa: glavni.adresa }, noveVrijednosti: { naziv: t(izFajla[0].naziv), adresa: t(izFajla[0].adresa) || glavni.adresa, ...izvor } });
      magacini.delete("glavni magacin");
      magacini.set(kljuc(izFajla[0].naziv), { ...glavni, naziv: t(izFajla[0].naziv) });
      magIshod.dopunjeno += 1;
      preimenovan = kljuc(izFajla[0].naziv);
      magIshod.napomene.push(`„Glavni magacin“ (prazan, napravljen sam) preimenovan u „${t(izFajla[0].naziv)}“.`);
    }
  }
  for (const m of izFajla) {
    if (magacini.has(kljuc(m.naziv))) {
      if (kljuc(m.naziv) !== preimenovan) magIshod.postoji += 1;
      continue;
    }
    const r = await klijent.query<{ id: string }>(`insert into skladiste (naziv, adresa) values ($1, $2) returning id`, [t(m.naziv), t(m.adresa) || null]);
    await audit("skladiste", r.rows[0].id, { naziv: t(m.naziv), adresa: t(m.adresa) });
    magacini.set(kljuc(m.naziv), { id: r.rows[0].id, naziv: t(m.naziv), adresa: t(m.adresa) });
    magIshod.novi += 1;
  }
  const komore = lista(f, "komore").filter((k) => t(k.naziv));
  if (komore.length) {
    podsjetnik.push(
      `Komore (${komore.length}) — upisati u HACCP plan (kontrolne tačke i plan monitoringa): ` +
        komore.map((k) => `${t(k.naziv)} [${t(k.magacin) || "?"}, ${t(k.rezim)}${PREDLOG[t(k.rezim)] || t(k.rezim) === "drugo" ? ` ${t(k.min)}…${t(k.max)} °C` : ""}]`).join("; "),
    );
  }

  // ── Vozila ──────────────────────────────────────────────────────────────────────────────────
  const vozIshod = new Ishod("Vozila");
  ishodi.push(vozIshod);
  if (f.nemaVozila) vozIshod.napomene.push("Nemaju svoja vozila — dogovoriti kako roba ide do kupca (roba pod režimom samo rashladnim vozilom).");
  const vozila = new Set((await klijent.query<{ registarski_broj: string }>(`select registarski_broj from vozilo`)).rows.map((v) => oznakaVozila(v.registarski_broj)));
  for (const v of lista(f, "vozila")) {
    const oznaka = t(v.oznaka);
    if (!oznaka) continue;
    if (vozila.has(oznakaVozila(oznaka))) {
      vozIshod.postoji += 1;
      continue;
    }
    let min: number | null = null;
    let max: number | null = null;
    if (v.rashladno) {
      min = broj(v.min);
      max = broj(v.max);
      if (min === null || max === null || Number.isNaN(min) || Number.isNaN(max) || min >= max) {
        [min, max] = PREDLOG.rashladjeno;
        vozIshod.napomene.push(`${oznaka}: granica nije ispravna — upisano 0 do 4 °C, provjeriti (Vozila).`);
      }
    }
    const r = await klijent.query<{ id: string }>(
      `insert into vozilo (registarski_broj, tip, temp_kontrolisano, temp_min, temp_max) values ($1, $2, $3, $4, $5) returning id`,
      [oznaka, t(v.tip) || null, !!v.rashladno, min, max],
    );
    await audit("vozilo", r.rows[0].id, { registarskiBroj: oznaka, rashladno: !!v.rashladno, min, max });
    vozila.add(oznakaVozila(oznaka));
    vozIshod.novi += 1;
  }

  // ── Zaposleni → lice (bez naloga); postojećem licu se dopuni prazna knjižica i radno mjesto ─────
  const ljudiIshod = new Ishod("Zaposleni");
  ishodi.push(ljudiIshod);
  const lica = new Map((await klijent.query<{ id: string; ime: string; radno_mjesto: string | null; sanitarna_knjizica_broj: string | null; sanitarna_knjizica_rok: string | null }>(
    `select id, ime, radno_mjesto, sanitarna_knjizica_broj, to_char(sanitarna_knjizica_rok, 'YYYY-MM-DD') as sanitarna_knjizica_rok from lice`,
  )).rows.map((l) => [kljuc(l.ime), l]));
  const nalozi: string[] = [];
  for (const z of lista(f, "zaposleni")) {
    const ime = t(z.ime);
    if (!ime) continue;
    const rukuje = z.rukujeHranom !== false;
    let rok: string | null = t(z.knjizicaRok) || null;
    if (rok && !/^\d{4}-\d{2}-\d{2}$/.test(rok)) {
      ljudiIshod.napomene.push(`${ime}: rok knjižice „${rok}“ nije datum — nije upisan.`);
      rok = null;
    }
    const brojKnj = t(z.knjizicaBroj) || null;
    if (rukuje && (!brojKnj || !rok)) ljudiIshod.napomene.push(`${ime}: rukuje hranom, a fali ${!brojKnj ? "broj" : "rok"} sanitarne knjižice.`);
    if (t(z.nalog) && NAZIV_ULOGE[t(z.nalog)] && t(z.nalog) !== "odgovorno") nalozi.push(`${ime} — ${NAZIV_ULOGE[t(z.nalog)]}${t(z.magacin) ? `, ${t(z.magacin)}` : ""}`);
    const postojece = lica.get(kljuc(ime));
    if (postojece) {
      const dopuna: Record<string, string> = {};
      if (!postojece.sanitarna_knjizica_broj && brojKnj) dopuna.sanitarna_knjizica_broj = brojKnj;
      if (!postojece.sanitarna_knjizica_rok && rok) dopuna.sanitarna_knjizica_rok = rok;
      if (!postojece.radno_mjesto && t(z.radnoMjesto)) dopuna.radno_mjesto = t(z.radnoMjesto);
      if (Object.keys(dopuna).length) {
        const kolone = Object.keys(dopuna);
        await klijent.query(`update lice set ${kolone.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() where id = $1`, [postojece.id, ...Object.values(dopuna)]);
        await logIzmjena(klijent, {
          korisnikId: null, entitetTip: "lice", entitetId: postojece.id,
          stareVrijednosti: Object.fromEntries(kolone.map((k) => [k, (postojece as Red)[k] ?? null])),
          noveVrijednosti: { ...dopuna, ...izvor },
        });
        ljudiIshod.dopunjeno += 1;
      } else ljudiIshod.postoji += 1;
      continue;
    }
    const sifra = await sljedeciBroj(klijent, "lice", "M", 2);
    const r = await klijent.query<{ id: string }>(
      `insert into lice (ime, radno_mjesto, rukuje_hranom, sifra, sanitarna_knjizica_broj, sanitarna_knjizica_rok) values ($1, $2, $3, $4, $5, $6) returning id`,
      [ime, t(z.radnoMjesto) || null, rukuje, sifra, brojKnj, rok],
    );
    await audit("lice", r.rows[0].id, { ime, radnoMjesto: t(z.radnoMjesto), rukujeHranom: rukuje, sanitarnaKnjizicaBroj: brojKnj, sanitarnaKnjizicaRok: rok });
    lica.set(kljuc(ime), { id: r.rows[0].id, ime, radno_mjesto: t(z.radnoMjesto) || null, sanitarna_knjizica_broj: brojKnj, sanitarna_knjizica_rok: rok });
    ljudiIshod.novi += 1;
  }
  if (nalozi.length) podsjetnik.push(`Nalozi za telefon (Ljudi → „Otvori nalog“, lozinku daje odgovorno lice): ${nalozi.join("; ")}.`);

  // ── Dobavljači ──────────────────────────────────────────────────────────────────────────────
  const dobIshod = new Ishod("Dobavljači");
  ishodi.push(dobIshod);
  const dobavljaci = (await klijent.query<{ id: string; naziv: string; pib: string | null }>(`select id, naziv, pib from dobavljac`)).rows;
  const dobPoNazivu = new Map(dobavljaci.map((d) => [kljuc(d.naziv), d.id]));
  const dobPoPibu = new Map(dobavljaci.filter((d) => t(d.pib)).map((d) => [cifre(d.pib), d.id]));
  for (const d of lista(f, "dobavljaci")) {
    const naziv = t(d.naziv);
    if (!naziv) continue;
    const pib = cifre(d.pib);
    const ispravanPib = /^\d{8,13}$/.test(pib) ? pib : null;
    const postoji = (ispravanPib && dobPoPibu.get(ispravanPib)) || dobPoNazivu.get(kljuc(naziv));
    if (postoji) {
      dobPoNazivu.set(kljuc(naziv), postoji);
      dobIshod.postoji += 1;
      continue;
    }
    if (pib && !ispravanPib) dobIshod.napomene.push(`${naziv}: PIB „${t(d.pib)}“ nije ispravan — upisan bez PIB-a.`);
    const r = await klijent.query<{ id: string }>(`insert into dobavljac (naziv, pib, telefon, adresa) values ($1, $2, $3, $4) returning id`, [naziv, ispravanPib, t(d.telefon) || null, t(d.mjesto) || null]);
    await audit("dobavljac", r.rows[0].id, { naziv, pib: ispravanPib, telefon: t(d.telefon), mjesto: t(d.mjesto) });
    dobPoNazivu.set(kljuc(naziv), r.rows[0].id);
    if (ispravanPib) dobPoPibu.set(ispravanPib, r.rows[0].id);
    dobIshod.novi += 1;
  }

  // ── Kupci: bez telefona se ne upisuje (povlačenje počinje telefonom, #4) ────────────────────
  const kupIshod = new Ishod("Kupci");
  ishodi.push(kupIshod);
  const kupci = (await klijent.query<{ naziv: string; pib: string | null }>(`select naziv, pib from kupac`)).rows;
  const kupPoNazivu = new Set(kupci.map((k) => kljuc(k.naziv)));
  const kupPoPibu = new Set(kupci.filter((k) => t(k.pib)).map((k) => cifre(k.pib)));
  for (const k of lista(f, "kupci")) {
    const naziv = t(k.naziv);
    if (!naziv) continue;
    const pib = cifre(k.pib);
    const ispravanPib = /^\d{8,13}$/.test(pib) ? pib : null;
    if ((ispravanPib && kupPoPibu.has(ispravanPib)) || kupPoNazivu.has(kljuc(naziv))) {
      kupIshod.postoji += 1;
      continue;
    }
    if (cifre(k.telefon).replace(/^\+/, "").length < 6) {
      kupIshod.odbijeno.push(`${naziv}: nema telefon — upisati ga u Šifarnicima kad se sazna (povlačenje počinje telefonom).`);
      continue;
    }
    if (pib && !ispravanPib) kupIshod.napomene.push(`${naziv}: PIB „${t(k.pib)}“ nije ispravan — upisan bez PIB-a.`);
    const r = await klijent.query<{ id: string }>(
      `insert into kupac (naziv, telefon, pib, adresa, adresa_isporuke) values ($1, $2, $3, $4, $5) returning id`,
      [naziv, t(k.telefon), ispravanPib, t(k.adresa) || null, t(k.adresaIsporuke) || null],
    );
    await audit("kupac", r.rows[0].id, { naziv, telefon: t(k.telefon), pib: ispravanPib, adresa: t(k.adresa), adresaIsporuke: t(k.adresaIsporuke) });
    kupPoNazivu.add(kljuc(naziv));
    if (ispravanPib) kupPoPibu.add(ispravanPib);
    kupIshod.novi += 1;
  }

  // ── Artikli: granica postaje pravilo (#39), NIJE potvrđena (#5); šifra kod dobavljača se pamti ──
  const artIshod = new Ishod("Artikli");
  ishodi.push(artIshod);
  const artikli = new Set((await klijent.query<{ naziv: string }>(`select naziv from artikal`)).rows.map((a) => kljuc(a.naziv)));
  let podRezimom = 0;
  let sifara = 0;
  for (const a of lista(f, "artikli")) {
    const naziv = t(a.naziv);
    if (!naziv) continue;
    if (artikli.has(kljuc(naziv))) {
      artIshod.postoji += 1;
      continue;
    }
    const rezim = t(a.rezim) || "rashladjeno";
    const kontrolisano = rezim === "rashladjeno" || rezim === "smrznuto" || rezim === "drugo";
    let min: number | null = null;
    let max: number | null = null;
    if (kontrolisano) {
      min = broj(a.min);
      max = broj(a.max);
      const ispravna = min !== null && max !== null && !Number.isNaN(min) && !Number.isNaN(max) && min < max;
      if (!ispravna) {
        if (!PREDLOG[rezim]) {
          artIshod.odbijeno.push(`${naziv}: drugi režim bez ispravne granice od–do — upisati u Šifarnicima.`);
          continue;
        }
        [min, max] = PREDLOG[rezim];
        artIshod.napomene.push(`${naziv}: granica nije ispravna — upisana ${min} do ${max} °C.`);
      }
    }
    const r = await klijent.query<{ id: string }>(
      `insert into artikal (naziv, jedinica_mjere, temp_kontrolisano, temp_min, temp_max, granica_potvrdio, rok_obavezan)
       values ($1, $2, $3, $4, $5, false, $6) returning id`,
      [naziv, (t(a.jedinica) || "kom").slice(0, 20), kontrolisano, min, max, a.rok !== false],
    );
    const id = r.rows[0].id;
    await audit("artikal", id, { naziv, jedinica: t(a.jedinica) || "kom", rezim, min, max, rokObavezan: a.rok !== false, granicaPotvrdio: false });
    await uskladiPravilaArtikla(klijent, id, null);
    if (kontrolisano) podRezimom += 1;
    const dobavljacId = t(a.dobavljac) ? dobPoNazivu.get(kljuc(a.dobavljac)) : undefined;
    if (t(a.dobavljac) && !dobavljacId) artIshod.napomene.push(`${naziv}: dobavljač „${t(a.dobavljac)}“ nije na spisku — veza nije upamćena.`);
    if (dobavljacId && t(a.sifra)) {
      // Isti ključ kao kad magacioner potvrdi stavku sa otpremnice — sljedeća otpremnica se prepozna sama.
      await klijent.query(
        `insert into artikal_dobavljaca (dobavljac_id, kljuc, sifra, naziv, artikal_id) values ($1, $2, $3, $4, $5)
         on conflict (dobavljac_id, kljuc) do nothing`,
        [dobavljacId, kljucArtikla(t(a.sifra), naziv), t(a.sifra), naziv, id],
      );
      sifara += 1;
    }
    artikli.add(kljuc(naziv));
    artIshod.novi += 1;
  }
  if (podRezimom) podsjetnik.push(`Granice ${podRezimom} artikala pod režimom su PRETPOSTAVLJENE — potvrditi u Šifarnicima (dok nisu potvrđene, van granice je samo upozorenje, roba se ne zadržava).`);
  if (sifara) artIshod.napomene.push(`${sifara} šifara kod dobavljača upamćeno — otpremnica ih prepoznaje sama.`);

  // ── Termometri (provjera i kalibracija se upisuju u aplikaciji, uz sertifikat) ─────────────────
  const termIshod = new Ishod("Termometri");
  ishodi.push(termIshod);
  if (f.nemaTermometra) termIshod.napomene.push("Još nemaju termometar — bez njega nema mjerenja na prijemu i isporuci.");
  const termometri = new Set((await klijent.query<{ naziv: string; oznaka: string | null }>(`select naziv, oznaka from mjerni_uredjaj`)).rows.map((u) => `${kljuc(u.naziv)}|${kljuc(u.oznaka)}`));
  for (const u of lista(f, "termometri")) {
    const naziv = t(u.naziv);
    if (!naziv) continue;
    if (termometri.has(`${kljuc(naziv)}|${kljuc(u.oznaka)}`)) {
      termIshod.postoji += 1;
      continue;
    }
    const r = await klijent.query<{ id: string }>(`insert into mjerni_uredjaj (naziv, oznaka, lokacija) values ($1, $2, $3) returning id`, [naziv, t(u.oznaka) || null, t(u.gdje) || null]);
    await audit("mjerni_uredjaj", r.rows[0].id, { naziv, oznaka: t(u.oznaka), lokacija: t(u.gdje) });
    if (t(u.kalibracijaBroj)) termIshod.napomene.push(`${naziv}: kalibracija ${t(u.kalibracijaBroj)}${t(u.kalibracijaDatum) ? ` od ${t(u.kalibracijaDatum)}` : ""} — upisati u HACCP plan → Termometri uz sertifikat.`);
    termometri.add(`${kljuc(naziv)}|${kljuc(u.oznaka)}`);
    termIshod.novi += 1;
  }
  podsjetnik.push("Svaki termometar prvo provjeriti (HACCP plan → Termometri) — mjerenje neprovjerenim termometrom nema vrijednost.");

  // ── Ritam rada — za plan monitoringa ────────────────────────────────────────────────────────
  const rad = f.rad ?? {};
  const dani = Object.entries(rad.dani ?? {}).filter(([, da]) => da).map(([d]) => d.replace("cet", "čet")).join(", ");
  if (dani || t(rad.prijema) || t(rad.isporuka) || t(rad.napomena)) {
    podsjetnik.push(`Ritam rada za plan monitoringa: dani ${dani || "—"}; prijema dnevno ${t(rad.prijema) || "—"}, isporuka ${t(rad.isporuka) || "—"}${t(rad.napomena) ? `; ${t(rad.napomena)}` : ""}.`);
  }

  return { ishodi, podsjetnik };
}

async function main() {
  const putanja = argument("fajl");
  const upisi = process.argv.includes("--upisi");
  if (!putanja) {
    console.error('Upotreba: npm run uvoz-start -- --fajl pilot-start-<firma>-<datum>.json [--upisi]');
    process.exit(1);
  }
  let f: Fajl;
  try {
    f = JSON.parse(fs.readFileSync(path.resolve(putanja), "utf8"));
  } catch (e) {
    console.error(`Fajl se ne može pročitati: ${(e as Error).message}`);
    process.exit(1);
  }
  if (f.format !== "pilot-upitnik-start") {
    console.error("Ovo nije fajl upitnika za početak (upitnik-start) — fali oznaka „pilot-upitnik-start“.");
    process.exit(1);
  }

  const adresa = new URL(process.env.DATABASE_URL!);
  console.log(`Baza: ${adresa.hostname} · korisnik ${decodeURIComponent(adresa.username)} · ${adresa.pathname.slice(1) || "postgres"}`);
  console.log(`Fajl: ${path.basename(putanja)} — ${t(f.firma?.naziv) || "bez naziva firme"}${upisi ? "" : "   (PROBA — ništa se ne upisuje)"}\n`);

  const klijent = await pool.connect();
  try {
    const tabele = (await klijent.query<{ ima: string | null }>(`select to_regclass('public.korisnik')::text as ima`)).rows[0].ima;
    if (!tabele) throw new Error("U bazi još nema tabela — sačekajte prvi deploy na Renderu (server sam pravi tabele) ili pokrenite npm run migriraj.");
    const stanje = (await klijent.query<{ demo: boolean; firma: string | null; vodstvo: number }>(
      `select exists (select 1 from korisnik where id::text like '11000000-0000-0000-0000-%') as demo,
              (select naziv from firma limit 1) as firma,
              (select count(*)::int from korisnik where uloga in ('bzr', 'izvodjac') and aktivan) as vodstvo`,
    )).rows[0];
    if (stanje.demo) throw new Error("Ovo je DEMO baza (demo nalozi) — upitnik klijenta se uvozi samo u njegovu bazu. Provjerite DATABASE_URL.");
    if (!stanje.firma || !stanje.vodstvo) throw new Error("Prvo napravite prve naloge: npm run prvi-korisnik -- --firma … --ime … --korisnik … --konsultant …");
    if (t(f.firma?.naziv) && kljuc(f.firma?.naziv) !== kljuc(stanje.firma)) {
      console.log(`Pažnja: firma u bazi je „${stanje.firma}“, a u fajlu „${t(f.firma?.naziv)}“ — provjerite da je prava baza.\n`);
    }

    await klijent.query("begin");
    await klijent.query(`select pg_advisory_xact_lock(hashtext('uvoz-start'))`);
    const { ishodi, podsjetnik } = await uvezi(klijent, f, { izvor: "alati/uvoz-start", fajl: path.basename(putanja) });
    for (const i of ishodi) i.ispis();
    if (podsjetnik.length) {
      console.log("\nZa konsultanta, posle uvoza:");
      for (const p of podsjetnik) console.log(`  • ${p}`);
    }
    if (upisi) {
      await klijent.query("commit");
      console.log("\nUpisano.");
    } else {
      await klijent.query("rollback");
      console.log(`\nNišta nije upisano. Ako je sve u redu: npm run uvoz-start -- --fajl ${path.basename(putanja)} --upisi`);
    }
  } catch (greska) {
    await klijent.query("rollback").catch(() => undefined);
    console.error(`\n${(greska as Error).message}\nNišta nije upisano.`);
    process.exitCode = 1;
  } finally {
    klijent.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
