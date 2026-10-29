// Uvoz upitnika za početak (upitnik-start/) u bazu NOVOG ateljea — da konsultant ne prepisuje ručno.
// Pokreće se sa računara konsultantkinje, POSLIJE `npm run prvi-korisnik`:
//
//   npm run uvoz-start -- --fajl pilot-start-atelje-2026-10-27.json            (samo pokaže šta bi uradio)
//   npm run uvoz-start -- --fajl pilot-start-atelje-2026-10-27.json --upisi    (upiše)
//
// Sve ide u JEDNOJ transakciji (#35): bez --upisi se na kraju poništi, pa je ispis tačno ono što bi upis uradio.
// Ista pravila kao aplikacija: šifra zaposlenog iz sljedeciBroj (#34), granica sastojka postaje pravilo (#39) i
// NIJE potvrđena (#5 — potvrđuje je čovjek u Šifarnicima), kupac bez telefona se ne upisuje (#4), PIB ciframa i
// jedinstven (#66), u lice samo broj i rok knjižice (#15), audit za svaki upis (#45). Nalozi se NE otvaraju —
// lozinke postavlja konsultant ili vlasnica u aplikaciji (#28). Ono što već postoji se preskače (može se ponovo).
//
// Atelje (27.10.2026): frižider, vitrina i zamrzivač iz upitnika postaju kontrolne tačke (KKT2, KKT2-V, KKT2-Z, pa
// KKT2-F2…) sa svojim opštim pravilom i dnevnim mjerenjem u planu; sastojci nose alergene i „serija obavezna“
// (P1, P4). Distributerski upitnik (magacini, vozila, direktor) se ne prima.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";
import { pool } from "../server/db.js";
import { urediAlergene } from "../server/alergeni.js";
import { logIzmjena, logKreiranje } from "../server/services/auditService.js";
import { sljedeciBroj } from "../server/services/brojeviService.js";
import { uskladiPravilaArtikla } from "../server/services/pravilaService.js";
import { kljucArtikla } from "../server/services/otpremnicaService.js";
import { UREDJAJI, type VrstaUredjaja } from "../server/services/haccpPredlog.js";

function argument(naziv: string): string | undefined {
  const i = process.argv.indexOf(`--${naziv}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

type Red = Record<string, unknown>;
type Fajl = {
  format?: string;
  vrsta?: string;
  firma?: Red & { odgovorno?: Red };
  rad?: Red & { dani?: Record<string, boolean> };
  nemaTermometra?: boolean;
  [lista: string]: unknown;
};

const t = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const cifre = (v: unknown) => t(v).replace(/[\s.\-/]/g, "");
const kljuc = (v: unknown) => t(v).toLowerCase().replace(/\s+/g, " ");
const broj = (v: unknown) => {
  const s = t(v).replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};
const ispravnaGranica = (min: number | null, max: number | null): [number, number] | null =>
  min !== null && max !== null && !Number.isNaN(min) && !Number.isNaN(max) && min < max ? [min, max] : null;
const lista = (f: Fajl, ime: string): Red[] => (Array.isArray(f[ime]) ? (f[ime] as Red[]).filter((r) => r && typeof r === "object") : []);
// Isti režimi i pretpostavljene granice kao u aplikaciji (GRANICA_REZIMA) i u upitniku.
const PREDLOG: Record<string, [number, number]> = { rashladjeno: [0, 4], smrznuto: [-25, -18] };
// Uređaji za čuvanje: prvi svake vrste je tačka koju pravi `prvi-korisnik` (KKT2, KKT2-V, KKT2-Z), svaki sljedeći nova
// (KKT2-F2, KKT2-V2…). Šifre, opis i predložene granice — isti izvor kao aplikacija (server/services/haccpPredlog.ts).
const UREDJAJ = UREDJAJI;
const NAZIV_ULOGE: Record<string, string> = { zaposleni: "Zaposleni", vlasnica: "Vlasnica — odgovorno lice" };

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

  // ── Frižideri, vitrina, zamrzivač → kontrolne tačke sa svojom granicom i dnevnim mjerenjem ─────
  const uredIshod = new Ishod("Uređaji");
  ishodi.push(uredIshod);
  type Tacka = { id: string; sifra: string; naziv: string; aktivan: boolean };
  const tacke = (await klijent.query<Tacka>(`select id, sifra, naziv, aktivan from kontrolna_tacka where sifra like 'KKT2%'`)).rows;
  const poSifri = new Map(tacke.map((x) => [x.sifra, x]));
  const poNazivu = new Map(tacke.map((x) => [kljuc(x.naziv), x]));
  const mjereno = async (id: string) =>
    (await klijent.query<{ da: boolean }>(`select exists (select 1 from mjerenje_temperature where kontrolna_tacka_id = $1) as da`, [id])).rows[0].da;
  const imaPlan = (await klijent.query<{ da: boolean }>(`select exists (select 1 from plan_monitoringa where aktivan) as da`)).rows[0].da;
  const uredjaji = lista(f, "uredjaji").filter((u) => t(u.naziv) && t(u.vrsta) in UREDJAJ);
  const redniPoVrsti: Partial<Record<VrstaUredjaja, number>> = {};
  let uPlan = 0;
  for (const u of uredjaji) {
    const vrsta = t(u.vrsta) as VrstaUredjaja;
    const cfg = UREDJAJ[vrsta];
    const naziv = t(u.naziv);
    let granica = ispravnaGranica(broj(u.min), broj(u.max));
    if (!granica) {
      granica = [cfg.granica[0], cfg.granica[1]];
      uredIshod.napomene.push(`${naziv}: granica nije ispravna — upisana ${granica[0]} do ${granica[1]} °C, provjeriti (HACCP plan).`);
    }
    const redni = (redniPoVrsti[vrsta] = (redniPoVrsti[vrsta] ?? 0) + 1);
    let tacka = poNazivu.get(kljuc(naziv));
    let ishodTacke: "postoji" | "dopunjeno" | "novi" = "postoji";
    // Prvi uređaj vrste preuzima tačku koju je napravio prvi-korisnik — ime iz upitnika, ali samo dok se njome ne mjeri.
    const osnovna = poSifri.get(cfg.osnovna);
    if (!tacka && redni === 1 && osnovna && !(await mjereno(osnovna.id))) {
      await klijent.query(`update kontrolna_tacka set naziv = $2, aktivan = true where id = $1`, [osnovna.id, naziv]);
      await klijent.query(`update plan_monitoringa set naziv = $3, updated_at = now() where kontrolna_tacka_id = $1 and naziv = $2`, [
        osnovna.id, `Temperatura — ${osnovna.naziv} (${osnovna.sifra})`, `Temperatura — ${naziv} (${osnovna.sifra})`,
      ]);
      await logIzmjena(klijent, { korisnikId: null, entitetTip: "kontrolna_tacka", entitetId: osnovna.id, stareVrijednosti: { naziv: osnovna.naziv }, noveVrijednosti: { naziv, ...izvor } });
      uredIshod.napomene.push(`„${osnovna.naziv}“ (${osnovna.sifra}) → „${naziv}“.`);
      poNazivu.delete(kljuc(osnovna.naziv));
      osnovna.naziv = naziv;
      osnovna.aktivan = true;
      poNazivu.set(kljuc(naziv), osnovna);
      tacka = osnovna;
      ishodTacke = "dopunjeno";
    }
    if (!tacka) {
      let sifra: string = cfg.osnovna;
      for (let n = 2; poSifri.has(sifra); n++) sifra = `${cfg.prefiks}${n}`;
      const r = await klijent.query<{ id: string }>(`insert into kontrolna_tacka (sifra, naziv, opis) values ($1, $2, $3) returning id`, [sifra, naziv, cfg.opis]);
      await audit("kontrolna_tacka", r.rows[0].id, { sifra, naziv, vrsta });
      tacka = { id: r.rows[0].id, sifra, naziv, aktivan: true };
      poSifri.set(sifra, tacka);
      poNazivu.set(kljuc(naziv), tacka);
      ishodTacke = "novi";
    }
    // Opšte pravilo tačke = granica uređaja (#39). Predlog (prvi-korisnik) se zamjenjuje dok se tačkom ne mjeri.
    const pravilo = (await klijent.query<{ id: string; verzija: number; min: number | null; max: number | null }>(
      `select id, verzija, min_vrijednost::float as min, max_vrijednost::float as max from pravilo_kontrole
       where kontrolna_tacka_id = $1 and artikal_id is null and aktivan for update`,
      [tacka.id],
    )).rows[0];
    const isto = pravilo && pravilo.min === granica[0] && pravilo.max === granica[1];
    if (pravilo && !isto && (await mjereno(tacka.id))) {
      uredIshod.napomene.push(`${naziv}: granica u bazi ${pravilo.min} do ${pravilo.max} °C, u upitniku ${granica[0]} do ${granica[1]} °C — tačkom se već mjeri, ne mijenjam (HACCP plan).`);
    } else if (!isto) {
      if (pravilo) await klijent.query(`update pravilo_kontrole set aktivan = false, vazi_do = now() where id = $1`, [pravilo.id]);
      const r = await klijent.query<{ id: string }>(
        `insert into pravilo_kontrole (kontrolna_tacka_id, naziv, min_vrijednost, max_vrijednost, jedinica, ozbiljnost, verzija) values ($1, $2, $3, $4, '°C', 'VISOK', $5) returning id`,
        [tacka.id, naziv, granica[0], granica[1], (pravilo?.verzija ?? 0) + 1],
      );
      await audit("pravilo_kontrole", r.rows[0].id, { tacka: tacka.sifra, min: granica[0], max: granica[1], ...(pravilo ? { prethodno: { min: pravilo.min, max: pravilo.max } } : {}) });
      if (ishodTacke === "postoji") ishodTacke = "dopunjeno";
    }
    // Dnevno mjerenje — kad plan već postoji (prvi-korisnik ga pravi), uređaj iz upitnika ulazi u njega.
    if (imaPlan) {
      const uPlanu = (await klijent.query(`select 1 from plan_monitoringa where kontrolna_tacka_id = $1 and aktivan limit 1`, [tacka.id])).rows[0];
      if (!uPlanu) {
        const r = await klijent.query<{ id: string }>(
          `insert into plan_monitoringa (naziv, vrsta, kontrolna_tacka_id, ucestalost, puta, uloga, napomena) values ($1, 'mjerenje', $2, 'DNEVNO', 2, 'operater', 'Jutro i popodne.') returning id`,
          [`Temperatura — ${naziv} (${tacka.sifra})`, tacka.id],
        );
        await audit("plan_monitoringa", r.rows[0].id, { naziv, tacka: tacka.sifra, ucestalost: "DNEVNO", puta: 2 });
        uPlan += 1;
      }
    }
    uredIshod[ishodTacke] += 1;
  }
  // Vitrina ili zamrzivač iz prvi-korisnik kojih u upitniku nema — isključuju se (dok se njima nije mjerilo), inače bi
  // „danas fali“ svaki dan tražio mjerenje uređaja koji ne postoji.
  if (uredjaji.length) {
    for (const vrsta of ["vitrina", "zamrzivac"] as const) {
      if (redniPoVrsti[vrsta]) continue;
      const osnovna = poSifri.get(UREDJAJ[vrsta].osnovna);
      if (!osnovna || !osnovna.aktivan || (await mjereno(osnovna.id))) continue;
      await klijent.query(`update kontrolna_tacka set aktivan = false where id = $1`, [osnovna.id]);
      await klijent.query(`update plan_monitoringa set aktivan = false, updated_at = now() where kontrolna_tacka_id = $1 and aktivan`, [osnovna.id]);
      await logIzmjena(klijent, { korisnikId: null, entitetTip: "kontrolna_tacka", entitetId: osnovna.id, stareVrijednosti: { aktivan: true }, noveVrijednosti: { aktivan: false, ...izvor } });
      uredIshod.napomene.push(`„${osnovna.naziv}“ (${osnovna.sifra}) isključena — nema je u upitniku.`);
    }
  } else podsjetnik.push("Uređaji: upitnik ih nema — u HACCP planu provjeriti frižider, vitrinu i zamrzivač i njihove granice.");
  if (uPlan) uredIshod.napomene.push(`${uPlan} ${uPlan === 1 ? "uređaj dodat" : "uređaja dodato"} u plan monitoringa (dnevno, 2×).`);
  if (uredjaji.length && !imaPlan) podsjetnik.push("Plan monitoringa još ne postoji — HACCP plan → „Predloži osnovni plan“ uvrštava sve uređaje.");

  // ── Zaposleni → lice (bez naloga); postojećem licu se dopuni prazna knjižica i radno mjesto ─────
  const ljudiIshod = new Ishod("Zaposleni");
  ishodi.push(ljudiIshod);
  const lica = new Map((await klijent.query<{ id: string; ime: string; radno_mjesto: string | null; sanitarna_knjizica_broj: string | null; sanitarna_knjizica_rok: string | null }>(
    `select id, ime, radno_mjesto, sanitarna_knjizica_broj, to_char(sanitarna_knjizica_rok, 'YYYY-MM-DD') as sanitarna_knjizica_rok from lice`,
  )).rows.map((l) => [kljuc(l.ime), l]));
  const saNalogom = new Set((await klijent.query<{ ime: string }>(`select l.ime from lice l join korisnik k on k.lice_id = l.id`)).rows.map((l) => kljuc(l.ime)));
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
    if (NAZIV_ULOGE[t(z.nalog)] && !saNalogom.has(kljuc(ime))) nalozi.push(`${ime} — ${NAZIV_ULOGE[t(z.nalog)]}`);
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
  if (nalozi.length) podsjetnik.push(`Nalozi za telefon (Ljudi → lice → „Otvori nalog“; vlasnicu otvara konsultant, zaposlene i vlasnica): ${nalozi.join("; ")}.`);

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

  // ── Stalni kupci: bez telefona se ne upisuje (povlačenje počinje telefonom, #4) ───────────────
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
    await audit("kupac", r.rows[0].id, { naziv, telefon: t(k.telefon), pib: ispravanPib, adresa: t(k.adresa) });
    kupPoNazivu.add(kljuc(naziv));
    if (ispravanPib) kupPoPibu.add(ispravanPib);
    kupIshod.novi += 1;
  }

  // ── Sastojci: granica postaje pravilo (#39), NIJE potvrđena (#5); alergeni (P1) i serija (P4) ──
  const artIshod = new Ishod("Sastojci");
  ishodi.push(artIshod);
  const artikli = new Set((await klijent.query<{ naziv: string }>(`select naziv from artikal`)).rows.map((a) => kljuc(a.naziv)));
  let podRezimom = 0;
  let sifara = 0;
  let bezAlergena = 0;
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
      const granica = ispravnaGranica(broj(a.min), broj(a.max));
      if (granica) [min, max] = granica;
      else {
        if (!PREDLOG[rezim]) {
          artIshod.odbijeno.push(`${naziv}: drugi režim bez ispravne granice od–do — upisati u Šifarnicima.`);
          continue;
        }
        [min, max] = PREDLOG[rezim];
        artIshod.napomene.push(`${naziv}: granica nije ispravna — upisana ${min} do ${max} °C.`);
      }
    }
    // Šifre iz upitnika (alergeniSifre) — samo sa spiska; „upisani“ samo kad je upitnik sve prepoznao.
    const alergeni = urediAlergene(Array.isArray(a.alergeniSifre) ? (a.alergeniSifre as unknown[]).filter((x): x is string => typeof x === "string") : []);
    const upisani = a.alergeniUpisani === true;
    if (!upisani) bezAlergena += 1;
    const serija = a.serija === true;
    const r = await klijent.query<{ id: string }>(
      `insert into artikal (naziv, jedinica_mjere, temp_kontrolisano, temp_min, temp_max, granica_potvrdio, rok_obavezan, zahtijeva_lot, alergeni, alergeni_upisani)
       values ($1, $2, $3, $4, $5, false, $6, $7, $8::varchar(20)[], $9) returning id`,
      [naziv, (t(a.jedinica) || "kom").slice(0, 20), kontrolisano, min, max, a.rok !== false, serija, alergeni, upisani],
    );
    const id = r.rows[0].id;
    await audit("artikal", id, { naziv, jedinica: t(a.jedinica) || "kom", rezim, min, max, rokObavezan: a.rok !== false, zahtijevaLot: serija, alergeni, alergeniUpisani: upisani, granicaPotvrdio: false });
    await uskladiPravilaArtikla(klijent, id, null);
    if (kontrolisano) podRezimom += 1;
    const dobavljacId = t(a.dobavljac) ? dobPoNazivu.get(kljuc(a.dobavljac)) : undefined;
    if (t(a.dobavljac) && !dobavljacId) artIshod.napomene.push(`${naziv}: dobavljač „${t(a.dobavljac)}“ nije na spisku — veza nije upamćena.`);
    if (dobavljacId && t(a.sifra)) {
      // Isti ključ kao kad zaposleni potvrdi stavku sa otpremnice — sljedeća otpremnica se prepozna sama.
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
  if (podRezimom) podsjetnik.push(`Granice ${podRezimom} sastojaka pod režimom su PRETPOSTAVLJENE — potvrditi u Šifarnicima (dok nisu potvrđene, van granice je samo upozorenje, roba se ne zadržava).`);
  if (bezAlergena) podsjetnik.push(`${bezAlergena} ${bezAlergena === 1 ? "sastojak" : "sastojaka"} bez upisanih alergena — vlasnica ih upisuje u Šifarnicima (do tada aplikacija upozorava kad sastojak ide u tortu).`);
  if (sifara) artIshod.napomene.push(`${sifara} šifara kod dobavljača upamćeno — otpremnica ih prepoznaje sama.`);

  // ── Termometri (provjera i kalibracija se upisuju u aplikaciji, uz sertifikat) ─────────────────
  const termIshod = new Ishod("Termometri");
  ishodi.push(termIshod);
  if (f.nemaTermometra) termIshod.napomene.push("Još nemaju termometar — bez njega nema mjerenja frižidera, prijema ni dostave.");
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
  if (dani || t(rad.porudzbina) || rad.dostava || t(rad.napomena)) {
    podsjetnik.push(
      `Ritam rada za plan monitoringa: dani ${dani || "—"}; torti sedmično ${t(rad.porudzbina) || "—"}; dostava ${rad.dostava ? "da (predaja torte — KKT 3)" : "ne"}${t(rad.napomena) ? `; ${t(rad.napomena)}` : ""}.`,
    );
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
  if (f.vrsta !== "atelje") {
    console.error("Ovo je distributerski upitnik (magacini, vozila, direktor) — za atelje vlasnica popunjava novi upitnik-start/Upitnik-za-pocetak.html.");
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
    if (!stanje.firma || !stanje.vodstvo) throw new Error("Prvo napravite prve naloge: npm run prvi-korisnik -- --firma … --konsultant …");
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
