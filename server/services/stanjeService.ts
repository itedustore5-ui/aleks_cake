// „Stanje poslovanja“ — izvještaj za direktora (11.10.2026). Konsultant bira period (dan, sedmica, mjesec, kvartal,
// polugodište, godina) i šalje ga mejlom. Direktor za pet minuta treba da vidi: radi li firma (promet), vode li se
// zapisi svaki dan i na vrijeme, ima li problema sa temperaturom, otvorenih neusaglašenosti, povlačenja, isteklih
// knjižica — i šta treba uraditi. Svaki broj se poredi sa prethodnim periodom iste vrste.
//
// Samo čita. Isti izvori kao ostatak aplikacije: plan iz monitoringService (#43), termometri iz haccpPlanService,
// dan po Podgorici (#11). Mejl je HTML sa tabelama i stilovima u redu — grafikoni su stubići od tabela, ne slike,
// pa se vide u svakom programu za poštu (Gmail, Outlook, telefon) bez preuzimanja slika.
import nodemailer from "nodemailer";
import { upit } from "../db.js";
import { ApiGreska } from "../greske.js";
import { danasCG } from "../vrijeme.js";
import { dodajDane, pregledPlana } from "./monitoringService.js";
import { listaUredjaja } from "./haccpPlanService.js";

export const VRSTE = ["dan", "sedmica", "mjesec", "kvartal", "polugodiste", "godina"] as const;
export type Vrsta = (typeof VRSTE)[number];
const PG = (k: string) => `(${k} at time zone 'Europe/Podgorica')`;

// ─── Period ──────────────────────────────────────────────────────────────────────────────────────
const uDatum = (s: string) => new Date(`${s}T12:00:00Z`);
const izDatuma = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
const mjeseci = (g: number, m0: number, n: number) => ({ od: izDatuma(new Date(Date.UTC(g, m0, 1, 12))), do: izDatuma(new Date(Date.UTC(g, m0 + n, 0, 12))) });

export function granice(vrsta: Vrsta, dan: string): { od: string; do: string } {
  const d = uDatum(dan);
  const g = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (vrsta) {
    case "dan":
      return { od: dan, do: dan };
    case "sedmica": {
      const od = dodajDane(dan, -((d.getUTCDay() + 6) % 7));
      return { od, do: dodajDane(od, 6) };
    }
    case "mjesec":
      return mjeseci(g, m, 1);
    case "kvartal":
      return mjeseci(g, m - (m % 3), 3);
    case "polugodiste":
      return mjeseci(g, m < 6 ? 0 : 6, 6);
    case "godina":
      return mjeseci(g, 0, 12);
  }
}

const MJESECI = ["januar", "februar", "mart", "april", "maj", "jun", "jul", "avgust", "septembar", "oktobar", "novembar", "decembar"];
const DANI = ["nedjelja", "ponedjeljak", "utorak", "srijeda", "četvrtak", "petak", "subota"];
const citljivo = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}.`;
const kratko = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}.`;

export function nazivPerioda(vrsta: Vrsta, od: string, doDan: string): string {
  const d = uDatum(od);
  const g = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (vrsta) {
    case "dan":
      return `${DANI[d.getUTCDay()]}, ${citljivo(od)}`;
    case "sedmica":
      return `sedmica ${kratko(od)} – ${citljivo(doDan)}`;
    case "mjesec":
      return `${MJESECI[m]} ${g}.`;
    case "kvartal":
      return `${m / 3 + 1}. kvartal ${g}.`;
    case "polugodiste":
      return `${m < 6 ? 1 : 2}. polugodište ${g}.`;
    case "godina":
      return `${g}. godina`;
  }
}

/** Izabrani period; bez dana — posljednji ZAVRŠENI (juče, prošla sedmica, prošli mjesec…). */
export function period(vrsta: Vrsta, dan?: string) {
  const danas = danasCG();
  const p = dan ? granice(vrsta, dan) : granice(vrsta, dodajDane(granice(vrsta, danas).od, -1));
  if (p.od > danas) throw new ApiGreska(400, "PERIOD_U_BUDUCNOSTI", "Taj period još nije počeo — izaberite raniji.");
  const doDan = p.do > danas ? danas : p.do;
  const prethodni = granice(vrsta, dodajDane(p.od, -1));
  return {
    vrsta, od: p.od, do: doDan, tekuci: p.do > danas,
    naziv: nazivPerioda(vrsta, p.od, p.do) + (p.do > danas ? " (do danas)" : ""),
    prethodni: { ...prethodni, naziv: nazivPerioda(vrsta, prethodni.od, prethodni.do) },
    ranije: dodajDane(p.od, -1),
    kasnije: p.do < danas ? dodajDane(p.do, 1) : null,
  };
}

// ─── Pokazatelji ─────────────────────────────────────────────────────────────────────────────────
export type Pokazatelji = Awaited<ReturnType<typeof pokazatelji>>;

async function pokazatelji(od: string, doDan: string) {
  const p = [od, doDan];
  const [promet, zapisi, temp, nc, pov, d1, ljudi] = await Promise.all([
    upit<{ prijemi: number; lotovi: number; odbijeni_lotovi: number; isporuke: number; odbijene_isporuke: number; kupci: number; otpisi: number }>(
      `select
         (select count(*) from prijem where datum_prijema between $1 and $2)::int as prijemi,
         (select count(*) from lot l join prijem pr on pr.id = l.prijem_id where pr.datum_prijema between $1 and $2)::int as lotovi,
         (select count(*) from lot l join prijem pr on pr.id = l.prijem_id where pr.datum_prijema between $1 and $2 and l.status::text = 'ODBIJEN')::int as odbijeni_lotovi,
         (select count(*) from isporuka where datum_isporuke between $1 and $2 and status::text in ('POTVRDJENA', 'DJELIMICNA'))::int as isporuke,
         (select count(*) from isporuka where datum_isporuke between $1 and $2 and status::text = 'ODBIJENA')::int as odbijene_isporuke,
         (select count(distinct kupac_id) from isporuka where datum_isporuke between $1 and $2 and status::text in ('POTVRDJENA', 'DJELIMICNA'))::int as kupci,
         (select count(*) from kretanje_zalihe where tip::text = 'OTPIS' and ${PG("created_at")}::date between $1 and $2)::int as otpisi`,
      p,
    ),
    // Zapisi (dnevni obrasci — prvi unos, mjerenja, D1, prijemi): koliko ih je i koliko upisano naknadno (#10).
    upit<{ ukupno: number; naknadno: number; osoba: number }>(
      `select count(*)::int as ukupno, count(*) filter (where naknadno > 0)::int as naknadno, count(distinct ko)::int as osoba from (
         select (${PG("z.created_at")}::date - z.datum) as naknadno, z.uneo_korisnik_id as ko from zapis z where z.ispravlja_id is null and z.datum between $1 and $2
         union all select (${PG("m.created_at")}::date - ${PG("m.izmjereno_at")}::date), m.izmjerio_korisnik_id from mjerenje_temperature m where ${PG("m.izmjereno_at")}::date between $1 and $2
         union all select (${PG("k.created_at")}::date - ${PG("k.izvrseno_at")}::date), k.izvrsio_korisnik_id from kontrola_vozila k where ${PG("k.izvrseno_at")}::date between $1 and $2
         union all select (${PG("pr.created_at")}::date - pr.datum_prijema), pr.primio_korisnik_id from prijem pr where pr.datum_prijema between $1 and $2
       ) x`,
      p,
    ),
    upit<{ mjerenja: number; van: number; upozorenja: number }>(
      `select count(*)::int as mjerenja, count(*) filter (where rezultat::text = 'FAIL')::int as van, count(*) filter (where rezultat::text = 'WARNING')::int as upozorenja
       from mjerenje_temperature where ${PG("izmjereno_at")}::date between $1 and $2`,
      p,
    ),
    upit<{ nove: number; zatvorene: number; otvorene: number; otvorene_visok: number; otvorene_stare: number; dana: string | null }>(
      `select
         count(*) filter (where ${PG("created_at")}::date between $1 and $2)::int as nove,
         count(*) filter (where zatvoreno_at is not null and ${PG("zatvoreno_at")}::date between $1 and $2)::int as zatvorene,
         count(*) filter (where ${PG("created_at")}::date <= $2 and (zatvoreno_at is null or ${PG("zatvoreno_at")}::date > $2))::int as otvorene,
         count(*) filter (where ${PG("created_at")}::date <= $2 and (zatvoreno_at is null or ${PG("zatvoreno_at")}::date > $2) and ozbiljnost::text = 'VISOK')::int as otvorene_visok,
         count(*) filter (where ${PG("created_at")}::date <= $2::date - 7 and (zatvoreno_at is null or ${PG("zatvoreno_at")}::date > $2))::int as otvorene_stare,
         round((avg(extract(epoch from (zatvoreno_at - created_at)) / 86400) filter (where zatvoreno_at is not null and ${PG("zatvoreno_at")}::date between $1 and $2))::numeric, 1)::text as dana
       from neusaglasenost`,
      p,
    ),
    upit<{ pokrenuta: number; u_toku: number }>(
      `select count(*) filter (where ${PG("pokrenuto_at")}::date between $1 and $2)::int as pokrenuta,
              count(*) filter (where ${PG("pokrenuto_at")}::date <= $2 and (zavrseno_at is null or ${PG("zavrseno_at")}::date > $2))::int as u_toku
       from povlacenje`,
      p,
    ),
    upit<{ kontrola: number; palo: number }>(
      `select count(*)::int as kontrola, count(*) filter (where ukupan_status <> 'PROSAO')::int as palo from kontrola_vozila where ${PG("izvrseno_at")}::date between $1 and $2`,
      p,
    ),
    // Knjižice na KRAJ perioda (Zakon o zaštiti stanovništva od zaraznih bolesti, čl. 31) i obuka koja kasni.
    upit<{ istekla: number; istice: number; bez_roka: number; obuka_kasni: number; rukuje: number }>(
      `select
         count(*) filter (where rukuje_hranom and sanitarna_knjizica_rok < $1::date)::int as istekla,
         count(*) filter (where rukuje_hranom and sanitarna_knjizica_rok between $1::date and $1::date + 30)::int as istice,
         count(*) filter (where rukuje_hranom and sanitarna_knjizica_rok is null)::int as bez_roka,
         count(*) filter (where rukuje_hranom)::int as rukuje,
         (select count(*) from plan_obuke po join lice li on li.id = po.lice_id
           where li.aktivan and po.planirani_datum <= $1::date and (po.obavljeno_datum is null or po.obavljeno_datum > $1::date))::int as obuka_kasni
       from lice where aktivan`,
      [doDan], // samo kraj perioda
    ),
  ]);
  const juce = dodajDane(danasCG(), -1);
  const plan = await pregledPlana(od, doDan < juce ? doDan : juce);
  const planPerioda = plan.stavke.reduce((z, s) => z + s.periodaUkupno, 0);
  const planPropusteno = plan.stavke.reduce((z, s) => z + s.propusteno.length, 0);
  const z = zapisi.rows[0];
  const t = temp.rows[0];
  return {
    promet: promet.rows[0],
    zapisi: { ...z, naVrijeme: z.ukupno ? Math.round((100 * (z.ukupno - z.naknadno)) / z.ukupno) : null },
    plan: { perioda: planPerioda, uradjeno: planPerioda - planPropusteno, posto: planPerioda ? Math.round((100 * (planPerioda - planPropusteno)) / planPerioda) : null },
    temperatura: { ...t, posto: t.mjerenja ? Math.round((1000 * (t.mjerenja - t.van)) / t.mjerenja) / 10 : null },
    nc: { ...nc.rows[0], dana: nc.rows[0].dana === null ? null : Number(nc.rows[0].dana) },
    povlacenja: pov.rows[0],
    d1: d1.rows[0],
    ljudi: ljudi.rows[0],
  };
}

// ─── Serije za grafikone ────────────────────────────────────────────────────────────────────────
type Stub = { oznaka: string; od: string; do: string; isporuke: number; mjerenja: number; obrasci: number; d1: number; ncNove: number; ncZatvorene: number; radniBezZapisa: number };

async function serije(vrsta: Vrsta, od: string, doDan: string): Promise<{ naslov: string; stubovi: Stub[] }> {
  // Dan sam za sebe ne pokazuje trend — za dnevni izvještaj grafikon je posljednjih 14 dana.
  const sOd = vrsta === "dan" ? dodajDane(doDan, -13) : od;
  const dani = (await upit<{ dan: string; dow: number; isporuke: number; mjerenja: number; obrasci: number; d1: number; prijemi: number; nc_nove: number; nc_zatvorene: number }>(
    `select to_char(d.dan, 'YYYY-MM-DD') as dan, extract(isodow from d.dan)::int as dow,
            (select count(*) from isporuka i where i.datum_isporuke = d.dan and i.status::text in ('POTVRDJENA', 'DJELIMICNA'))::int as isporuke,
            (select count(*) from mjerenje_temperature m where ${PG("m.izmjereno_at")}::date = d.dan)::int as mjerenja,
            (select count(*) from zapis z where z.datum = d.dan and z.ispravlja_id is null)::int as obrasci,
            (select count(*) from kontrola_vozila k where ${PG("k.izvrseno_at")}::date = d.dan)::int as d1,
            (select count(*) from prijem pr where pr.datum_prijema = d.dan)::int as prijemi,
            (select count(*) from neusaglasenost n where ${PG("n.created_at")}::date = d.dan)::int as nc_nove,
            (select count(*) from neusaglasenost n where n.zatvoreno_at is not null and ${PG("n.zatvoreno_at")}::date = d.dan)::int as nc_zatvorene
     from (select g::date as dan from generate_series($1::date, $2::date, interval '1 day') g) d order by d.dan`,
    [sOd, doDan],
  )).rows;
  const grupa = vrsta === "kvartal" ? "sedmica" : vrsta === "polugodiste" || vrsta === "godina" ? "mjesec" : "dan";
  const stubovi: Stub[] = [];
  for (const d of dani) {
    const kljuc = grupa === "dan" ? d.dan : grupa === "sedmica" ? granice("sedmica", d.dan).od : d.dan.slice(0, 7);
    let s = stubovi[stubovi.length - 1];
    if (!s || s.od !== (grupa === "mjesec" ? `${kljuc}-01` : kljuc)) {
      const oznaka = grupa === "dan" ? d.dan.slice(8, 10).replace(/^0/, "") : grupa === "sedmica" ? kratko(kljuc) : MJESECI[Number(kljuc.slice(5, 7)) - 1].slice(0, 3);
      s = { oznaka, od: grupa === "mjesec" ? `${kljuc}-01` : kljuc, do: d.dan, isporuke: 0, mjerenja: 0, obrasci: 0, d1: 0, ncNove: 0, ncZatvorene: 0, radniBezZapisa: 0 };
      stubovi.push(s);
    }
    s.do = d.dan;
    s.isporuke += d.isporuke;
    s.mjerenja += d.mjerenja;
    s.obrasci += d.obrasci;
    s.d1 += d.d1;
    s.ncNove += d.nc_nove;
    s.ncZatvorene += d.nc_zatvorene;
    if (d.dow !== 7 && d.mjerenja + d.obrasci + d.d1 + d.prijemi === 0) s.radniBezZapisa += 1;
  }
  const naslov = vrsta === "dan" ? "posljednjih 14 dana" : grupa === "dan" ? "po danu" : grupa === "sedmica" ? "po sedmici" : "po mjesecu";
  return { naslov, stubovi };
}

// ─── Ocjena: semafor i šta treba uraditi ────────────────────────────────────────────────────────
type Nivo = "zeleno" | "zuto" | "crveno";
const mn = (n: number, jedan: string, vise: string) => `${n} ${n === 1 ? jedan : vise}`;
/** Oblik imenice uz broj: 1 kupac, 2 kupca, 5 kupaca (21 kupac, 12 kupaca). */
const oblik = (n: number, jedan: string, dva: string, pet: string) => {
  const d = n % 10;
  const s = n % 100;
  return d === 1 && s !== 11 ? jedan : d >= 2 && d <= 4 && (s < 12 || s > 14) ? dva : pet;
};

function ocjena(k: Pokazatelji, termometri: { neispravni: number; istekli: number }) {
  const stavke: { nivo: Nivo; tekst: string }[] = [];
  if (k.povlacenja.u_toku) stavke.push({ nivo: "crveno", tekst: `Povlačenje robe je u toku (${k.povlacenja.u_toku}) — svi kupci moraju biti obaviješteni, pa povlačenje zatvoreno.` });
  if (k.nc.otvorene_visok) stavke.push({ nivo: "crveno", tekst: `${mn(k.nc.otvorene_visok, "neusaglašenost visoke ozbiljnosti je otvorena", "neusaglašenosti visoke ozbiljnosti su otvorene")} — tražiti rok za korektivnu mjeru.` });
  if (k.ljudi.istekla) stavke.push({ nivo: "crveno", tekst: `${mn(k.ljudi.istekla, "zaposleni radi", "zaposlenih radi")} sa hranom sa isteklom sanitarnom knjižicom — obnoviti odmah (kazna 2.500–20.000 €).` });
  if (termometri.neispravni) stavke.push({ nivo: "crveno", tekst: `${mn(termometri.neispravni, "termometar je neispravan", "termometra su neispravna")} — zamijeniti; mjerenja njime nisu pouzdana.` });
  if (k.plan.posto !== null && k.plan.posto < 80) stavke.push({ nivo: "crveno", tekst: `Urađeno je samo ${k.plan.posto} % obaveza po planu kontrola — zapisi ne nastaju svaki dan.` });
  else if (k.plan.posto !== null && k.plan.posto < 95) stavke.push({ nivo: "zuto", tekst: `Urađeno je ${k.plan.posto} % obaveza po planu kontrola — propušteno ${k.plan.perioda - k.plan.uradjeno}.` });
  if (k.zapisi.ukupno && k.zapisi.naknadno / k.zapisi.ukupno > 0.1) stavke.push({ nivo: "zuto", tekst: `${k.zapisi.naknadno} od ${k.zapisi.ukupno} zapisa upisano naknadno — zapis treba da nastaje u trenutku rada.` });
  if (k.nc.otvorene_stare) stavke.push({ nivo: "zuto", tekst: `${mn(k.nc.otvorene_stare, "neusaglašenost je otvorena", "neusaglašenosti su otvorene")} duže od 7 dana.` });
  if (k.temperatura.van) stavke.push({ nivo: "zuto", tekst: `${mn(k.temperatura.van, "mjerenje je bilo", "mjerenja su bila")} van granice temperature (svako je otvorilo neusaglašenost).` });
  if (k.ljudi.istice) stavke.push({ nivo: "zuto", tekst: `${mn(k.ljudi.istice, "sanitarna knjižica ističe", "sanitarnih knjižica ističe")} u narednih 30 dana — zakazati pregled.` });
  if (termometri.istekli) stavke.push({ nivo: "zuto", tekst: `${mn(termometri.istekli, "termometru je istekla", "termometrima je istekla")} provjera ili kalibracija.` });
  if (k.ljudi.obuka_kasni) stavke.push({ nivo: "zuto", tekst: `Obuka po godišnjem planu kasni (${k.ljudi.obuka_kasni}) — zakazati.` });
  if (k.d1.palo) stavke.push({ nivo: "zuto", tekst: `${mn(k.d1.palo, "kontrola vozila nije prošla", "kontrole vozila nisu prošle")} prije utovara.` });
  const red: Record<Nivo, number> = { crveno: 0, zuto: 1, zeleno: 2 };
  stavke.sort((a, b) => red[a.nivo] - red[b.nivo]);
  const nivo: Nivo = stavke.some((s) => s.nivo === "crveno") ? "crveno" : stavke.length ? "zuto" : "zeleno";
  const poruka = nivo === "crveno" ? "Potrebna je vaša odluka" : nivo === "zuto" ? "Uglavnom u redu — ima stvari za pažnju" : "Sve pod kontrolom";
  return { nivo, poruka, stavke: stavke.slice(0, 7) };
}

// ─── Izvještaj ───────────────────────────────────────────────────────────────────────────────────
export async function izvjestaj(vrsta: Vrsta, dan?: string) {
  const per = period(vrsta, dan);
  const [firma, sada, prije, grafikon, uredjaji] = await Promise.all([
    upit<{ naziv: string; izvjestaj_primaoci: string | null; email: string | null }>(`select naziv, izvjestaj_primaoci, email from firma limit 1`),
    pokazatelji(per.od, per.do),
    pokazatelji(per.prethodni.od, per.prethodni.do),
    serije(vrsta, per.od, per.do),
    listaUredjaja(true),
  ]);
  const termometri = { neispravni: uredjaji.filter((u) => u.stanje === "NEISPRAVAN").length, istekli: uredjaji.filter((u) => u.stanje === "ISTEKLA").length };
  const o = ocjena(sada, termometri);
  const f = firma.rows[0];
  return {
    period: per,
    firma: f?.naziv ?? "Firma",
    primaoci: f?.izvjestaj_primaoci ?? "",
    predlogPrimalaca: f?.email ?? "",
    pokazatelji: sada,
    prethodni: prije,
    ocjena: o,
    termometri,
    grafikon,
    html: htmlIzvjestaja(f?.naziv ?? "Firma", per, sada, prije, o, grafikon, termometri),
  };
}

// ─── Pregled za direktora (Kontrolni centar uprave, 11.10.2026) ─────────────────────────────────
/** Direktoru ne trebaju operativne kartice odgovornog lica — treba mu odgovor „jesmo li u redu i šta traži moju
 * odluku“. Isti semafor i pokazatelji kao „Stanje poslovanja“ (#93), za posljednjih 7 dana (sa danas) prema
 * prethodnih 7; grafikon zapisa za 14 dana; povlačenja u toku sa brojem obaviještenih kupaca. Samo čita. */
export async function pregledDirektora() {
  const danas = danasCG();
  const od = dodajDane(danas, -6);
  const [sada, prije, grafikon, uredjaji, povlacenja, firma, posljednji] = await Promise.all([
    pokazatelji(od, danas),
    pokazatelji(dodajDane(danas, -13), dodajDane(danas, -7)),
    serije("dan", danas, danas),
    listaUredjaja(true),
    upit<{ id: string; broj: string; artikal: string; broj_lota: string; pokrenuto_at: string; kupaca: number; obavijesteno: number }>(
      `select p.id, p.broj, a.naziv as artikal, l.broj_lota, p.pokrenuto_at,
              count(k.id)::int as kupaca, count(k.id) filter (where k.kontaktiran)::int as obavijesteno
       from povlacenje p join lot l on l.id = p.lot_id join artikal a on a.id = l.artikal_id
       left join povlacenje_kontakt k on k.povlacenje_id = p.id
       where p.status = 'U_TOKU' group by p.id, a.naziv, l.broj_lota order by p.pokrenuto_at`,
    ),
    upit<{ odgovorno_lice_ime: string | null }>(`select odgovorno_lice_ime from firma limit 1`),
    upit<{ vrsta: Vrsta; od: string; do: string; created_at: string }>(
      `select vrsta, to_char(period_od, 'YYYY-MM-DD') as od, to_char(period_do, 'YYYY-MM-DD') as do, created_at
       from izvjestaj_poslat order by created_at desc limit 1`,
    ),
  ]);
  const termometri = { neispravni: uredjaji.filter((u) => u.stanje === "NEISPRAVAN").length, istekli: uredjaji.filter((u) => u.stanje === "ISTEKLA").length };
  const p = posljednji.rows[0];
  return {
    period: { od, do: danas },
    ocjena: ocjena(sada, termometri),
    pokazatelji: sada,
    prethodni: prije,
    grafikon,
    povlacenja: povlacenja.rows,
    odgovornoLice: firma.rows[0]?.odgovorno_lice_ime ?? null,
    posljednjiIzvjestaj: p ? { naziv: nazivPerioda(p.vrsta, p.od, p.do), poslat: p.created_at } : null,
  };
}

// ─── HTML za mejl (tabele i stilovi u redu — tako ga čita svaki program za poštu) ────────────────
const BOJE = { tekst: "#182431", sivo: "#5d6c7a", linija: "#dfe6ee", plava: "#2459da", zelena: "#18815e", narandzasta: "#a8641a", crvena: "#bd3c45", pozadina: "#f2f5f9" };
const SEMAFOR: Record<Nivo, { boja: string; pozadina: string }> = {
  zeleno: { boja: "#18815e", pozadina: "#e3f4ec" },
  zuto: { boja: "#8a5212", pozadina: "#fcf0de" },
  crveno: { boja: "#bd3c45", pozadina: "#fbe9ea" },
};
const e = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const broj = (n: number | null) => (n === null ? "—" : n.toLocaleString("sr-Latn-ME"));

/** „↑ 12 % u odnosu na …“ — boja po tome da li je promjena dobra (bolje = zelena), neutralna za promet. */
function trend(sada: number | null, prije: number | null, smjer: "vise" | "manje" | "neutralno", postotni = false) {
  if (sada === null || prije === null) return `<span style="color:${BOJE.sivo}">—</span>`;
  const razlika = sada - prije;
  if (razlika === 0) return `<span style="color:${BOJE.sivo}">kao prethodni period</span>`;
  const gore = razlika > 0;
  const boja = smjer === "neutralno" ? BOJE.sivo : (gore ? smjer === "vise" : smjer === "manje") ? BOJE.zelena : BOJE.crvena;
  const iznos = postotni ? `${Math.abs(Math.round(razlika * 10) / 10)} p.p.` : prije > 0 && Math.abs(razlika) >= 1 ? `${Math.round((Math.abs(razlika) / prije) * 100)} %` : broj(Math.abs(razlika));
  return `<span style="color:${boja}">${gore ? "▲" : "▼"} ${iznos}</span>`;
}

function kartica(naslov: string, vrijednost: string, opis: string, trendHtml: string, rijecima = false) {
  return `<td width="33%" valign="top" class="kpi" style="padding:6px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BOJE.linija};border-radius:10px">
      <tr><td style="padding:12px 12px 10px">
        <div style="font-size:12px;color:${BOJE.sivo};line-height:1.3;overflow-wrap:break-word;word-wrap:break-word">${e(naslov)}</div>
        <div class="${rijecima ? "kpi-r" : "kpi-v"}" style="font-size:${rijecima ? 18 : 26}px;font-weight:bold;color:${BOJE.tekst};line-height:1.2;margin-top:4px">${vrijednost}</div>
        <div style="font-size:11.5px;color:${BOJE.sivo};line-height:1.35;margin-top:2px">${opis}</div>
        <div style="font-size:11.5px;margin-top:4px">${trendHtml}</div>
      </td></tr>
    </table></td>`;
}

/** Stubići od tabela: svaki stub je ćelija sa obojenim slojevima (vrijednost → visina u px). */
function stubici(naslov: string, podnaslov: string, stubovi: Stub[], slojevi: { k: keyof Stub; boja: string; naziv: string }[], oznaciPrazne = false) {
  const VISINA = 110;
  const max = Math.max(1, ...stubovi.map((s) => slojevi.reduce((z, l) => z + Number(s[l.k]), 0)));
  const korak = stubovi.length > 16 ? Math.ceil(stubovi.length / 8) : 1;
  const kolone = stubovi
    .map((s) => {
      const ukupno = slojevi.reduce((z, l) => z + Number(s[l.k]), 0);
      const djelovi = slojevi
        .filter((l) => Number(s[l.k]) > 0)
        .reverse()
        .map((l) => `<div style="height:${Math.max(2, Math.round((Number(s[l.k]) / max) * VISINA))}px;background:${l.boja};font-size:0;line-height:0">&nbsp;</div>`)
        .join("");
      const prazno = !ukupno ? `<div style="height:3px;background:${oznaciPrazne && s.radniBezZapisa ? BOJE.crvena : BOJE.linija};font-size:0;line-height:0">&nbsp;</div>` : "";
      return `<td valign="bottom" style="vertical-align:bottom;padding:0 1px" title="${e(`${s.od === s.do ? citljivo(s.od) : `${kratko(s.od)}–${citljivo(s.do)}`}: ${ukupno}`)}">${djelovi}${prazno}</td>`;
    })
    .join("");
  const oznake = stubovi.map((s, i) => `<td align="center" style="font-size:10px;color:${BOJE.sivo};padding-top:3px">${i % korak === 0 ? e(s.oznaka) : ""}</td>`).join("");
  const legenda = slojevi.map((l) => `<span style="display:inline-block;margin-right:12px"><span style="display:inline-block;width:10px;height:10px;background:${l.boja};border-radius:2px;vertical-align:middle"></span> ${e(l.naziv)}</span>`).join("");
  return `<tr><td style="padding:14px 18px 4px">
    <div style="font-size:15px;font-weight:bold;color:${BOJE.tekst}">${e(naslov)} <span style="font-weight:normal;color:${BOJE.sivo};font-size:12px">— ${e(podnaslov)}, najviše ${broj(max)}</span></div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;table-layout:fixed">
      <tr style="height:${VISINA}px">${kolone}</tr>
      <tr>${oznake}</tr>
    </table>
    <div style="font-size:11.5px;color:${BOJE.sivo};margin-top:6px">${legenda}</div>
  </td></tr>`;
}

function htmlIzvjestaja(firma: string, per: ReturnType<typeof period>, k: Pokazatelji, p: Pokazatelji, o: ReturnType<typeof ocjena>, g: { naslov: string; stubovi: Stub[] }, term: { neispravni: number; istekli: number }) {
  const s = SEMAFOR[o.nivo];
  const prethodni = `prethodni period — ${per.prethodni.naziv.replace(/\.$/, "")}`;
  const red = (celije: string[]) => `<tr><td class="kpi-red" style="padding:0 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${celije.join("")}</tr></table></td></tr>`;
  const naslovOdjeljka = (t: string) => `<tr><td style="padding:16px 18px 2px;font-size:12px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:${BOJE.plava}">${e(t)}</td></tr>`;
  const stavke = o.stavke.length
    ? `<ul style="margin:8px 0 0;padding-left:18px">${o.stavke.map((x) => `<li style="margin:4px 0;color:${x.nivo === "crveno" ? BOJE.crvena : BOJE.tekst}">${e(x.tekst)}</li>`).join("")}</ul>`
    : `<p style="margin:8px 0 0">Zapisi se vode redovno, nema otvorenih problema koji traže vašu odluku.</p>`;
  const generisano = new Date().toLocaleString("sr-Latn-ME", { timeZone: "Europe/Podgorica", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return `<!doctype html><html lang="sr-Latn-ME"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stanje poslovanja — ${e(firma)} — ${e(per.naziv)}</title>
<style>
  /* Telefon: kartice jedna ispod druge (Gmail, iPhone Mail). Program bez podrške ostaje na tri kolone. */
  @media only screen and (max-width: 480px) {
    .okvir { padding: 8px 4px !important; }
    .kpi-red { padding: 0 12px !important; }
    .kpi { display: block !important; width: 100% !important; box-sizing: border-box; padding: 4px 0 !important; }
    .kpi-v { font-size: 24px !important; }
  }
  /* PDF / štampa (dugme „Sačuvaj PDF“): A4, bez sive pozadine, boje stubića i semafora ostaju, blok ne puca na dvije strane. */
  @page { size: A4; margin: 12mm; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @media print {
    body, .pozadina { background: #ffffff !important; }
    .okvir { padding: 0 !important; }
    .list { border: 0 !important; }
    tr { page-break-inside: avoid; break-inside: avoid; }
  }
</style></head>
<body style="margin:0;padding:0;background:${BOJE.pozadina};font-family:Arial,Helvetica,sans-serif;color:${BOJE.tekst};font-size:14px;line-height:1.45">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="pozadina" style="background:${BOJE.pozadina}"><tr><td align="center" class="okvir" style="padding:16px 8px">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" class="list" style="max-width:640px;width:100%;background:#ffffff;border:1px solid ${BOJE.linija};border-radius:12px">
  <tr><td style="padding:20px 18px 6px">
    <div style="font-size:12px;color:${BOJE.sivo}">Stanje poslovanja · bezbjednost hrane</div>
    <div style="font-size:22px;font-weight:bold;color:#173452;margin-top:2px">${e(firma)}</div>
    <div style="font-size:15px;color:${BOJE.tekst};margin-top:2px">${e(per.naziv)}</div>
  </td></tr>
  <tr><td style="padding:10px 18px 4px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${s.pozadina};border-radius:10px"><tr><td style="padding:12px 14px">
      <div style="font-size:17px;font-weight:bold;color:${s.boja}">● ${e(o.poruka)}</div>
      ${stavke}
    </td></tr></table>
  </td></tr>

  ${naslovOdjeljka("Poslovanje")}
  ${red([
    kartica("Isporuke kupcima", broj(k.promet.isporuke), `${broj(k.promet.kupci)} ${oblik(k.promet.kupci, "kupac", "kupca", "kupaca")}${k.promet.odbijene_isporuke ? ` · odbijeno ${k.promet.odbijene_isporuke}` : ""}`, trend(k.promet.isporuke, p.promet.isporuke, "neutralno")),
    kartica("Prijemi robe", broj(k.promet.prijemi), `${broj(k.promet.lotovi)} ${oblik(k.promet.lotovi, "lot", "lota", "lotova")}${k.promet.odbijeni_lotovi ? ` · odbijeno ${k.promet.odbijeni_lotovi}` : ""}`, trend(k.promet.prijemi, p.promet.prijemi, "neutralno")),
    kartica("Otpis robe", broj(k.promet.otpisi), "upisanih otpisa", trend(k.promet.otpisi, p.promet.otpisi, "manje")),
  ])}

  ${naslovOdjeljka("Bezbjednost hrane")}
  ${red([
    kartica("Kontrole po planu", k.plan.posto === null ? "—" : `${k.plan.posto} %`, k.plan.perioda ? `urađeno ${k.plan.uradjeno} od ${k.plan.perioda}` : "plan nije podešen", trend(k.plan.posto, p.plan.posto, "vise", true)),
    kartica("Zapisi na vrijeme", k.zapisi.naVrijeme === null ? "—" : `${k.zapisi.naVrijeme} %`, `${broj(k.zapisi.ukupno)} ${oblik(k.zapisi.ukupno, "zapis", "zapisa", "zapisa")} · upisuje ${broj(k.zapisi.osoba)} ${k.zapisi.osoba % 10 >= 2 && k.zapisi.osoba % 10 <= 4 && (k.zapisi.osoba % 100 < 12 || k.zapisi.osoba % 100 > 14) ? "osobe" : "osoba"}`, trend(k.zapisi.naVrijeme, p.zapisi.naVrijeme, "vise", true)),
    kartica("Temperatura u granici", k.temperatura.posto === null ? "—" : `${String(k.temperatura.posto).replace(".", ",")} %`, `${broj(k.temperatura.mjerenja)} ${oblik(k.temperatura.mjerenja, "mjerenje", "mjerenja", "mjerenja")} · van granice ${broj(k.temperatura.van)}`, k.temperatura.mjerenja ? trend(k.temperatura.van, p.temperatura.van, "manje") : trend(null, null, "manje")),
  ])}
  ${red([
    kartica("Neusaglašenosti otvorene", broj(k.nc.otvorene), `nove ${broj(k.nc.nove)} · zatvorene ${broj(k.nc.zatvorene)}${k.nc.dana !== null ? ` · zatvaranje prosječno ${String(k.nc.dana).replace(".", ",")} d` : ""}`, trend(k.nc.otvorene, p.nc.otvorene, "manje")),
    kartica("Povlačenja", broj(k.povlacenja.pokrenuta), k.povlacenja.u_toku ? `${k.povlacenja.u_toku} u toku` : "nijedno u toku", trend(k.povlacenja.pokrenuta, p.povlacenja.pokrenuta, "manje")),
    kartica("Kontrola vozila (D1)", broj(k.d1.kontrola), k.d1.palo ? `nije prošlo ${k.d1.palo}` : "sve prošle", trend(k.d1.palo, p.d1.palo, "manje")),
  ])}

  ${naslovOdjeljka("Grafički pregled")}
  ${stubici("Isporuke kupcima", g.naslov, g.stubovi, [{ k: "isporuke", boja: BOJE.plava, naziv: "isporuke" }])}
  ${stubici("Zapisi i kontrole", `${g.naslov}; crvena crta = radni dan bez ijednog zapisa`, g.stubovi, [
    { k: "mjerenja", boja: BOJE.plava, naziv: "mjerenja temperature" },
    { k: "obrasci", boja: BOJE.zelena, naziv: "dnevni obrasci" },
    { k: "d1", boja: BOJE.narandzasta, naziv: "kontrole vozila" },
  ], true)}
  ${stubici("Neusaglašenosti", g.naslov, g.stubovi, [
    { k: "ncNove", boja: BOJE.crvena, naziv: "nove" },
    { k: "ncZatvorene", boja: BOJE.zelena, naziv: "zatvorene" },
  ])}

  ${naslovOdjeljka("Ljudi i oprema")}
  ${red([
    kartica("Sanitarne knjižice", k.ljudi.istekla ? `<span style="color:${BOJE.crvena}">${k.ljudi.istekla} ${oblik(k.ljudi.istekla, "istekla", "istekle", "isteklo")}</span>` : "u redu", `rukuje hranom: ${broj(k.ljudi.rukuje)} · ističe u 30 dana: ${broj(k.ljudi.istice)}${k.ljudi.bez_roka ? ` · bez roka ${k.ljudi.bez_roka}` : ""}`, "", true),
    kartica("Obuka", k.ljudi.obuka_kasni ? `<span style="color:${BOJE.narandzasta}">kasni: ${k.ljudi.obuka_kasni}</span>` : "po planu", "godišnji plan obuke", "", true),
    kartica("Termometri", term.neispravni ? `<span style="color:${BOJE.crvena}">${term.neispravni} neispravno</span>` : term.istekli ? `<span style="color:${BOJE.narandzasta}">${term.istekli} istekla provjera</span>` : "ispravni", "stanje danas", "", true),
  ])}

  <tr><td style="padding:16px 18px 18px;font-size:11.5px;color:${BOJE.sivo};line-height:1.5;border-top:1px solid ${BOJE.linija}">
    Poređenje: ${e(prethodni)}. Brojevi su iz aplikacije PILOT (zapisi se upisuju u trenutku rada; naknadni upis je označen).
    Detalji — u aplikaciji, Kontrolni centar. Pripremljeno ${generisano}.
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/** Kratak tekst za programe pošte koji ne prikazuju HTML. */
function tekstIzvjestaja(firma: string, iz: Awaited<ReturnType<typeof izvjestaj>>) {
  const k = iz.pokazatelji;
  return [
    `Stanje poslovanja — ${firma} — ${iz.period.naziv}`,
    "",
    iz.ocjena.poruka,
    ...iz.ocjena.stavke.map((s) => `- ${s.tekst}`),
    "",
    `Isporuke: ${k.promet.isporuke} (${k.promet.kupci} ${oblik(k.promet.kupci, "kupac", "kupca", "kupaca")}) · Prijemi: ${k.promet.prijemi}`,
    `Kontrole po planu: ${k.plan.posto ?? "—"} % · Zapisi na vrijeme: ${k.zapisi.naVrijeme ?? "—"} % · Temperatura van granice: ${k.temperatura.van}`,
    `Neusaglašenosti otvorene: ${k.nc.otvorene} · Povlačenja u toku: ${k.povlacenja.u_toku}`,
  ].join("\n");
}

// ─── Primaoci i slanje ───────────────────────────────────────────────────────────────────────────
const MEJL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
export function procitajPrimaoce(tekst: string): string[] {
  const lista = tekst.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const losi = lista.filter((x) => !MEJL.test(x));
  if (losi.length) throw new ApiGreska(400, "MEJL_NEISPRAVAN", `Adresa nije ispravna: ${losi.join(", ")}.`);
  if (lista.length > 10) throw new ApiGreska(400, "PREVISE_PRIMALACA", "Najviše 10 primalaca.");
  return [...new Set(lista.map((x) => x.toLowerCase()))];
}

export async function sacuvajPrimaoce(klijent: import("pg").PoolClient, tekst: string) {
  const lista = procitajPrimaoce(tekst);
  const prije = (await klijent.query<{ id: string; izvjestaj_primaoci: string | null }>(`select id, izvjestaj_primaoci from firma limit 1 for update`)).rows[0];
  if (!prije) throw new ApiGreska(409, "FIRMA_NE_POSTOJI", "Firma nije upisana — prvo npm run prvi-korisnik.");
  await klijent.query(`update firma set izvjestaj_primaoci = $2, updated_at = now() where id = $1`, [prije.id, lista.join(", ") || null]);
  return { id: prije.id, prije: prije.izvjestaj_primaoci, poslije: lista.join(", ") };
}

/** Mejl ide preko SMTP naloga konsultanta (env na ovom serveru). Bez podešavanja — jasna poruka, ništa se ne šalje. */
export function slanjePodeseno() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_KORISNIK && process.env.SMTP_LOZINKA);
}

export async function posalji(vrsta: Vrsta, dan: string | undefined) {
  if (!slanjePodeseno()) {
    throw new ApiGreska(409, "SLANJE_NIJE_PODESENO", "Slanje mejla nije podešeno na ovom serveru (SMTP_HOST, SMTP_KORISNIK, SMTP_LOZINKA). Do tada: „Sačuvaj PDF“ i pošaljite ga kao prilog.");
  }
  const iz = await izvjestaj(vrsta, dan);
  const primaoci = procitajPrimaoce(iz.primaoci);
  if (!primaoci.length) throw new ApiGreska(400, "NEMA_PRIMALACA", "Upišite kome se šalje (npr. mejl direktora) i sačuvajte.");
  const port = Number(process.env.SMTP_PORT) || 465;
  const posta = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_KORISNIK, pass: process.env.SMTP_LOZINKA },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  const od = process.env.SMTP_POSILJALAC || process.env.SMTP_KORISNIK!;
  try {
    await posta.sendMail({
      from: od,
      to: primaoci.join(", "),
      replyTo: od,
      subject: `Stanje poslovanja — ${iz.firma} — ${iz.period.naziv}`,
      html: iz.html,
      text: tekstIzvjestaja(iz.firma, iz),
    });
  } catch (greska) {
    throw new ApiGreska(502, "SLANJE_NIJE_USPJELO", `Mejl nije poslat: ${(greska as Error).message}. Provjerite SMTP podešavanje (za Gmail: lozinka za aplikacije, port 465).`);
  }
  return { iz, primaoci };
}
