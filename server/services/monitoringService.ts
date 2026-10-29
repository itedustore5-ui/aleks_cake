// Plan monitoringa (nalaz H5): šta se radi, koliko često i ko — i iz toga "šta danas fali" i
// pregled rupa unazad. To je dokaz koji se prodaje: zapisi nastaju svakog dana, ne noć pred inspekciju.
//
// Sve se broji iz postojećih zapisa (mjerenja, obrasci) po PODGORIČKOM danu (invarijanta #11); plan
// ništa ne upisuje sam. Poslastičarnica nema vozila: stavke vrste „kontrola_vozila“ (D1 distributera)
// se ne čitaju, iako vrijednost u bazi postoji.
import type { PoolClient } from "pg";
import { upit } from "../db.js";
import { danasCG } from "../vrijeme.js";
import { logKreiranje } from "./auditService.js";
import { predlogGranice, predlogTeksta } from "./haccpPredlog.js";

export const UCESTALOSTI = ["DNEVNO", "RADNIM_DANIMA", "SEDMICNO", "MJESECNO", "PO_DOGADJAJU"] as const;
export type Ucestalost = (typeof UCESTALOSTI)[number];
export type VrstaPlana = "mjerenje" | "obrazac";

export type StavkaPlana = {
  id: string;
  naziv: string;
  vrsta: VrstaPlana;
  kontrolna_tacka_id: string | null;
  kontrolna_tacka_naziv: string | null;
  kontrolna_tacka_sifra: string | null;
  obrazac_kod: string | null;
  ucestalost: Ucestalost;
  puta: number;
  uloga: string | null;
  skladiste_id: string | null;
  skladiste_naziv: string | null;
  vazi_od: string;
  aktivan: boolean;
  napomena: string | null;
};

// ─── Datumi (YYYY-MM-DD, bez vremenskih zona — sve je već podgorički dan) ───────────────────────
const uDatum = (s: string) => new Date(`${s}T12:00:00Z`);
const izDatuma = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
export const dodajDane = (s: string, n: number) => {
  const d = uDatum(s);
  d.setUTCDate(d.getUTCDate() + n);
  return izDatuma(d);
};
const jeNedjelja = (s: string) => uDatum(s).getUTCDay() === 0;

/** Period kome pripada dan: dan, sedmica (pon–ned) ili mjesec. Nedjelja nije radni dan. */
export function period(ucestalost: Ucestalost, dan: string): { od: string; do: string; obavezno: boolean; rok: string } | null {
  switch (ucestalost) {
    case "DNEVNO":
      return { od: dan, do: dan, obavezno: true, rok: "danas" };
    case "RADNIM_DANIMA":
      return { od: dan, do: dan, obavezno: !jeNedjelja(dan), rok: "danas" };
    case "SEDMICNO": {
      const pomak = (uDatum(dan).getUTCDay() + 6) % 7; // 0 = ponedjeljak
      const od = dodajDane(dan, -pomak);
      return { od, do: dodajDane(od, 6), obavezno: true, rok: "do nedjelje" };
    }
    case "MJESECNO": {
      const d = uDatum(dan);
      const od = izDatuma(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 12)));
      const doDan = izDatuma(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12)));
      return { od, do: doDan, obavezno: true, rok: "do kraja mjeseca" };
    }
    default:
      return null; // PO_DOGADJAJU — sprovodi se pri samom unosu (temperatura obavezna)
  }
}

const SELECT_PLANA = `
  select p.id, p.naziv, p.vrsta, p.kontrolna_tacka_id, kt.naziv as kontrolna_tacka_naziv, kt.sifra as kontrolna_tacka_sifra,
         p.obrazac_kod, p.ucestalost, p.puta, p.uloga::text as uloga,
         p.skladiste_id, s.naziv as skladiste_naziv, to_char(p.vazi_od, 'YYYY-MM-DD') as vazi_od, p.aktivan, p.napomena
  from plan_monitoringa p
  left join kontrolna_tacka kt on kt.id = p.kontrolna_tacka_id
  left join skladiste s on s.id = p.skladiste_id
  where p.vrsta in ('mjerenje', 'obrazac')`;

export async function stavkePlana(samoAktivne = true): Promise<StavkaPlana[]> {
  const r = await upit<StavkaPlana>(
    `${SELECT_PLANA} ${samoAktivne ? "and p.aktivan" : ""}
     order by p.aktivan desc, case p.ucestalost when 'PO_DOGADJAJU' then 0 when 'DNEVNO' then 1 when 'RADNIM_DANIMA' then 2 when 'SEDMICNO' then 3 else 4 end, p.naziv`,
  );
  return r.rows;
}

// Ko je šta uradio se NE gleda: stavka plana je obaveza magacina, ne osobe — kad je jedan magacioner
// izmjeri, drugome više ne stoji kao obaveza (#77). Stavka vezana za magacin broji samo unose iz tog
// magacina (i stare, bez magacina); stavka bez magacina broji sve.
function izvorStavke(s: StavkaPlana) {
  const uMagacinu = s.skladiste_id ? "and (x.skladiste_id = $4 or x.skladiste_id is null)" : "";
  if (s.vrsta === "mjerenje") {
    return {
      kljuc: s.kontrolna_tacka_id,
      iz: `from mjerenje_temperature x join korisnik k on k.id = x.izmjerio_korisnik_id left join lice l on l.id = k.lice_id
           where x.kontrolna_tacka_id = $1 and (x.izmjereno_at at time zone 'Europe/Podgorica')::date between $2 and $3 ${uMagacinu}`,
      dan: `(x.izmjereno_at at time zone 'Europe/Podgorica')::date`,
      vrijeme: "x.izmjereno_at",
      ime: "coalesce(l.ime, k.korisnicko_ime)",
    };
  }
  // Obrazac. Ispravka ne broji dvaput — broji se prvi unos (ispravlja_id je prazan samo kod njega).
  return {
    kljuc: s.obrazac_kod,
    iz: `from zapis x where x.obrazac_kod = $1 and x.ispravlja_id is null and x.datum between $2 and $3 ${uMagacinu}`,
    dan: "x.datum",
    vrijeme: "x.created_at",
    ime: "x.izvrsilac",
  };
}
const parametri = (s: StavkaPlana, kljuc: string | null, od: string, doDan: string) =>
  s.skladiste_id ? [kljuc, od, doDan, s.skladiste_id] : [kljuc, od, doDan];

/** Broj urađenih po danu za jednu stavku plana, u rasponu [od, do]. */
async function poDanima(s: StavkaPlana, od: string, doDan: string): Promise<Map<string, number>> {
  const i = izvorStavke(s);
  const r = await upit<{ dan: string; n: number }>(
    `select to_char(${i.dan}, 'YYYY-MM-DD') as dan, count(*)::int as n ${i.iz} group by 1`,
    parametri(s, i.kljuc, od, doDan),
  );
  return new Map(r.rows.map((x) => [x.dan, x.n]));
}

export type Uradio = { ime: string; vrijeme: string; dan: string };

/** Ko je u periodu već uradio stavku (posljednja tri) — da drugi magacioner vidi „Marko, 08:14“. */
async function koJeUradio(s: StavkaPlana, od: string, doDan: string): Promise<Uradio[]> {
  const i = izvorStavke(s);
  const r = await upit<Uradio>(
    `select ${i.ime} as ime,
            to_char(${i.vrijeme} at time zone 'Europe/Podgorica', 'HH24:MI') as vrijeme,
            to_char(${i.dan}, 'DD.MM.') as dan
     ${i.iz} order by ${i.vrijeme} desc limit 3`,
    parametri(s, i.kljuc, od, doDan),
  );
  return r.rows;
}

const zbir = (m: Map<string, number>, od: string, doDan: string) => {
  let n = 0;
  for (const [dan, broj] of m) if (dan >= od && dan <= doDan) n += broj;
  return n;
};

export type StanjeStavke = StavkaPlana & { od: string; do: string; rok: string; uradjeno: number; fali: number; uradili?: Uradio[] };

/** Šta u tekućem periodu (danas / ova sedmica / ovaj mjesec) još nije urađeno, i šta je juče
 * propušteno. Terenska uloga dobija samo svoje stavke (i one bez zadate uloge). */
export async function stanjeDanas(filter: { uloga?: string; skladisteId?: string | null } = {}) {
  const danas = danasCG();
  const juce = dodajDane(danas, -1);
  const stavke = (await stavkePlana()).filter(
    (s) =>
      s.ucestalost !== "PO_DOGADJAJU" &&
      s.vazi_od <= danas &&
      (!filter.uloga || !s.uloga || s.uloga === filter.uloga) &&
      (!filter.skladisteId || !s.skladiste_id || s.skladiste_id === filter.skladisteId),
  );
  const danasStanje: StanjeStavke[] = [];
  const juceP: StanjeStavke[] = [];
  for (const s of stavke) {
    const p = period(s.ucestalost, danas)!;
    const pJuce = period(s.ucestalost, juce)!;
    const od = pJuce.od < p.od ? pJuce.od : p.od;
    const brojevi = await poDanima(s, od, danas);
    if (p.obavezno) {
      const uradjeno = zbir(brojevi, p.od, danas);
      const uradili = uradjeno > 0 ? await koJeUradio(s, p.od, danas) : [];
      danasStanje.push({ ...s, od: p.od, do: p.do, rok: p.rok, uradjeno, fali: Math.max(0, s.puta - uradjeno), uradili });
    }
    // "Juče propušteno" samo za dnevne stavke — sedmica i mjesec se ocjenjuju kad se završe.
    if ((s.ucestalost === "DNEVNO" || s.ucestalost === "RADNIM_DANIMA") && pJuce.obavezno && s.vazi_od <= juce) {
      const uradjeno = zbir(brojevi, juce, juce);
      if (uradjeno < s.puta) juceP.push({ ...s, od: juce, do: juce, rok: "juče", uradjeno, fali: s.puta - uradjeno });
    }
  }
  return { danas, stavke: danasStanje, juce: juceP };
}

/** Pregled rupa unazad: koliko završenih perioda je bilo i u kojima nije urađeno koliko treba. */
export async function pregledRupa(dana: number) {
  const danas = danasCG();
  return pregledPlana(dodajDane(danas, -dana), dodajDane(danas, -1));
}

/** Isto za izabrani period [od, do] — HACCP plan (30 dana) i inspekcijski paket čitaju isto (#43).
 * Ocjenjuju se samo ZAVRŠENI periodi: tekući dan (sedmica, mjesec) se ne broji kao propušten. */
export async function pregledPlana(odDan: string, doDan: string) {
  const juce = dodajDane(danasCG(), -1);
  const kraj = doDan < juce ? doDan : juce;
  const rezultat = [];
  for (const s of (await stavkePlana()).filter((x) => x.ucestalost !== "PO_DOGADJAJU")) {
    const od = s.vazi_od > odDan ? s.vazi_od : odDan;
    if (od > kraj) {
      rezultat.push({ ...s, periodaUkupno: 0, propusteno: [] as { od: string; do: string; uradjeno: number }[] });
      continue;
    }
    const brojevi = await poDanima(s, od, kraj);
    // Završeni periodi u rasponu: kraj perioda je najkasnije juče i ne poslije kraja izabranog perioda.
    const periodi: { od: string; do: string }[] = [];
    let dan = od;
    while (dan <= kraj) {
      const p = period(s.ucestalost, dan)!;
      if (p.obavezno && p.do <= kraj) periodi.push({ od: p.od < od ? od : p.od, do: p.do });
      dan = dodajDane(p.do, 1);
    }
    const propusteno = periodi
      .map((p) => ({ ...p, uradjeno: zbir(brojevi, p.od, p.do) }))
      .filter((p) => p.uradjeno < s.puta);
    rezultat.push({ ...s, periodaUkupno: periodi.length, propusteno });
  }
  return { od: odDan, do: kraj, stavke: rezultat };
}

/** Osnovni plan za atelje — konsultant ga zatim prilagodi (stvarni frižideri, vitrina, radni dani).
 * Samo kad plan još ne postoji. */
// Predložena granica i tekst (haccpPredlog) upisuju se SAMO uz „Predloži osnovni plan“ (i `prvi-korisnik`), i samo
// gdje je prazno — konsultant ih provjerava u HACCP planu. Ocjena i dalje čita samo pravilo (P3, #39).
export async function osnovniPlan(klijent: PoolClient, korisnikId: string): Promise<{ broj: number; granice: number }> {
  const postoji = await klijent.query(`select 1 from plan_monitoringa where aktivan limit 1`);
  if (postoji.rows[0]) return { broj: 0, granice: 0 };
  const sveTacke = (await klijent.query<{ sifra: string; id: string; naziv: string }>(`select sifra, id, naziv from kontrolna_tacka where aktivan order by sifra`)).rows;
  const tacke = new Map(sveTacke.map((r) => [r.sifra, r.id]));
  type Nova = { naziv: string; vrsta: VrstaPlana; kt?: string; obrazac?: string; ucestalost: Ucestalost; puta?: number; uloga: string; napomena?: string };
  const nove: Nova[] = [];
  if (tacke.get("KKT1")) nove.push({ naziv: "Temperatura sastojaka pri prijemu (KKT 1)", vrsta: "mjerenje", kt: tacke.get("KKT1"), ucestalost: "PO_DOGADJAJU", uloga: "operater", napomena: "Uz svaki prijem jaja, mliječnog i ostalog pod temperaturnim režimom — bez temperature se prijem ne snima." });
  // Čuvanje: svaki frižider, vitrina i zamrzivač je svoja tačka sa svojom granicom (šifra počinje sa KKT2).
  for (const t of sveTacke.filter((x) => x.sifra.startsWith("KKT2"))) {
    nove.push({ naziv: `Temperatura — ${t.naziv} (${t.sifra})`, vrsta: "mjerenje", kt: t.id, ucestalost: "DNEVNO", puta: 2, uloga: "operater", napomena: "Jutro i popodne." });
  }
  if (tacke.get("KKT3")) nove.push({ naziv: "Temperatura torte pri predaji (KKT 3)", vrsta: "mjerenje", kt: tacke.get("KKT3"), ucestalost: "PO_DOGADJAJU", uloga: "operater", napomena: "Uz svaku dostavu — bez temperature se predaja ne prima." });
  nove.push(
    { naziv: "Čišćenje i dezinfekcija (P3)", vrsta: "obrazac", obrazac: "P3", ucestalost: "RADNIM_DANIMA", uloga: "operater" },
    { naziv: "Lična higijena i zdravstveno stanje (P8)", vrsta: "obrazac", obrazac: "P8", ucestalost: "RADNIM_DANIMA", uloga: "operater" },
    { naziv: "Kontrola otpada (P9)", vrsta: "obrazac", obrazac: "P9", ucestalost: "RADNIM_DANIMA", uloga: "operater" },
    { naziv: "Kontrola štetočina (P7)", vrsta: "obrazac", obrazac: "P7", ucestalost: "SEDMICNO", uloga: "operater" },
    { naziv: "Kontrola pribora i opreme (P10)", vrsta: "obrazac", obrazac: "P10", ucestalost: "SEDMICNO", uloga: "operater" },
  );
  for (const n of nove) {
    await klijent.query(
      `insert into plan_monitoringa (naziv, vrsta, kontrolna_tacka_id, obrazac_kod, ucestalost, puta, uloga, napomena, created_by)
       values ($1, $2, $3, $4, $5, $6, $7::uloga_t, $8, $9)`,
      [n.naziv, n.vrsta, n.kt ?? null, n.obrazac ?? null, n.ucestalost, n.puta ?? 1, n.uloga, n.napomena ?? null, korisnikId],
    );
  }
  // Bez opšteg pravila zaposleni ne može ni da izmjeri frižider (PRAVILO_NE_POSTOJI), a predaja se ne ocjenjuje (P3).
  let granice = 0;
  for (const t of sveTacke) {
    const g = predlogGranice(t.sifra);
    if (!g) continue;
    const ima = await klijent.query(`select 1 from pravilo_kontrole where kontrolna_tacka_id = $1 and artikal_id is null and aktivan limit 1`, [t.id]);
    if (ima.rows[0]) continue;
    const r = await klijent.query<{ id: string }>(
      `insert into pravilo_kontrole (kontrolna_tacka_id, naziv, min_vrijednost, max_vrijednost, jedinica, ozbiljnost) values ($1, $2, $3, $4, '°C', 'VISOK') returning id`,
      [t.id, g.naziv, g.min, g.max],
    );
    await logKreiranje(klijent, { korisnikId, entitetTip: "pravilo_kontrole", entitetId: r.rows[0].id, noveVrijednosti: { tacka: t.sifra, naziv: g.naziv, min: g.min, max: g.max, predlog: true } });
    granice += 1;
  }
  // Tekst za HACCP plan (opasnost, mjera, verifikacija) — samo tamo gdje je prazan; štampa inače piše „— upisati —“.
  for (const t of sveTacke) {
    const p = predlogTeksta(t.sifra);
    await klijent.query(
      `update kontrolna_tacka set opasnost = coalesce(opasnost, $2), korektivna_mjera = coalesce(korektivna_mjera, $3), verifikacija = coalesce(verifikacija, $4)
       where id = $1 and (opasnost is null or korektivna_mjera is null or verifikacija is null)`,
      [t.id, p.opasnost, p.korektivnaMjera, p.verifikacija],
    );
  }
  return { broj: nove.length, granice };
}
