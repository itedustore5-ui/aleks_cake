// Plan monitoringa (nalaz H5): šta se radi, koliko često i ko — i iz toga "šta danas fali" i
// pregled rupa unazad. To je dokaz koji se prodaje: zapisi nastaju svakog dana, ne noć pred inspekciju.
//
// Sve se broji iz postojećih zapisa (mjerenja, obrasci, kontrole vozila) po PODGORIČKOM danu
// (invarijanta #11); plan ništa ne upisuje sam.
import type { PoolClient } from "pg";
import { upit } from "../db.js";
import { danasCG } from "../vrijeme.js";

export const UCESTALOSTI = ["DNEVNO", "RADNIM_DANIMA", "SEDMICNO", "MJESECNO", "PO_DOGADJAJU"] as const;
export type Ucestalost = (typeof UCESTALOSTI)[number];
export type VrstaPlana = "mjerenje" | "obrazac" | "kontrola_vozila";

export type StavkaPlana = {
  id: string;
  naziv: string;
  vrsta: VrstaPlana;
  kontrolna_tacka_id: string | null;
  kontrolna_tacka_naziv: string | null;
  kontrolna_tacka_sifra: string | null;
  obrazac_kod: string | null;
  vozilo_id: string | null;
  vozilo_oznaka: string | null;
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
         p.obrazac_kod, p.vozilo_id, v.registarski_broj as vozilo_oznaka, p.ucestalost, p.puta, p.uloga::text as uloga,
         p.skladiste_id, s.naziv as skladiste_naziv, to_char(p.vazi_od, 'YYYY-MM-DD') as vazi_od, p.aktivan, p.napomena
  from plan_monitoringa p
  left join kontrolna_tacka kt on kt.id = p.kontrolna_tacka_id
  left join vozilo v on v.id = p.vozilo_id
  left join skladiste s on s.id = p.skladiste_id`;

export async function stavkePlana(samoAktivne = true): Promise<StavkaPlana[]> {
  const r = await upit<StavkaPlana>(
    `${SELECT_PLANA} ${samoAktivne ? "where p.aktivan" : ""}
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
  if (s.vrsta === "obrazac") {
    // Ispravka ne broji dvaput — broji se prvi unos (ispravlja_id je prazan samo kod njega).
    return {
      kljuc: s.obrazac_kod,
      iz: `from zapis x where x.obrazac_kod = $1 and x.ispravlja_id is null and x.datum between $2 and $3 ${uMagacinu}`,
      dan: "x.datum",
      vrijeme: "x.created_at",
      ime: "x.izvrsilac",
    };
  }
  return {
    kljuc: s.vozilo_id,
    iz: `from kontrola_vozila x join korisnik k on k.id = x.izvrsio_korisnik_id left join lice l on l.id = k.lice_id
         where x.vozilo_id = $1 and (x.izvrseno_at at time zone 'Europe/Podgorica')::date between $2 and $3`,
    dan: `(x.izvrseno_at at time zone 'Europe/Podgorica')::date`,
    vrijeme: "x.izvrseno_at",
    ime: "coalesce(l.ime, k.korisnicko_ime)",
  };
}
const parametri = (s: StavkaPlana, kljuc: string | null, od: string, doDan: string) =>
  s.skladiste_id && s.vrsta !== "kontrola_vozila" ? [kljuc, od, doDan, s.skladiste_id] : [kljuc, od, doDan];

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

/** D1 je kontrola PRIJE UTOVARA: dnevna obaveza važi samo za dan u kom vozilo vozi (ima isporuku koja
 * nije otkazana). Vozilo koje stoji ne traži D1 — inače je vozaču stajalo crveno „nije urađeno“ za kamion
 * koji tog dana ne vozi, i poslije njegove kontrole (odluka 01.10.2026). Za vozača: samo njegove isporuke. */
const dnevnaD1 = (s: StavkaPlana) => s.vrsta === "kontrola_vozila" && !!s.vozilo_id && (s.ucestalost === "DNEVNO" || s.ucestalost === "RADNIM_DANIMA");

async function daniVoznje(voziloId: string, od: string, doDan: string, korisnikId?: string | null): Promise<Set<string>> {
  const r = await upit<{ dan: string }>(
    `select distinct to_char(i.datum_isporuke, 'YYYY-MM-DD') as dan from isporuka i
     where i.vozilo_id = $1 and i.datum_isporuke between $2 and $3 and i.status::text <> 'OTKAZANA'
       and ($4::uuid is null or i.vozac_korisnik_id = $4 or (i.vozac_korisnik_id is null and i.uneo_korisnik_id = $4))`,
    [voziloId, od, doDan, korisnikId ?? null],
  );
  return new Set(r.rows.map((x) => x.dan));
}

export type StanjeStavke = StavkaPlana & { od: string; do: string; rok: string; uradjeno: number; fali: number; uradili?: Uradio[] };

/** Šta u tekućem periodu (danas / ova sedmica / ovaj mjesec) još nije urađeno, i šta je juče
 * propušteno. Terenska uloga dobija samo svoje stavke (i one bez zadate uloge). */
export async function stanjeDanas(filter: { uloga?: string; skladisteId?: string | null; korisnikId?: string | null } = {}) {
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
    const voznja = dnevnaD1(s) ? await daniVoznje(s.vozilo_id!, od, danas, filter.korisnikId) : null;
    const obaveznoDanas = voznja ? voznja.has(danas) : p.obavezno;
    const obaveznoJuce = voznja ? voznja.has(juce) : pJuce.obavezno;
    if (obaveznoDanas) {
      const uradjeno = zbir(brojevi, p.od, danas);
      const uradili = uradjeno > 0 ? await koJeUradio(s, p.od, danas) : [];
      danasStanje.push({ ...s, od: p.od, do: p.do, rok: p.rok, uradjeno, fali: Math.max(0, s.puta - uradjeno), uradili });
    }
    // "Juče propušteno" samo za dnevne stavke — sedmica i mjesec se ocjenjuju kad se završe.
    if ((s.ucestalost === "DNEVNO" || s.ucestalost === "RADNIM_DANIMA") && obaveznoJuce && s.vazi_od <= juce) {
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
    const voznja = dnevnaD1(s) ? await daniVoznje(s.vozilo_id!, od, kraj) : null;
    // Završeni periodi u rasponu: kraj perioda je najkasnije juče i ne poslije kraja izabranog perioda.
    const periodi: { od: string; do: string }[] = [];
    let dan = od;
    while (dan <= kraj) {
      const p = period(s.ucestalost, dan)!;
      const obavezno = voznja ? voznja.has(dan) : p.obavezno;
      if (obavezno && p.do <= kraj) periodi.push({ od: p.od < od ? od : p.od, do: p.do });
      dan = dodajDane(p.do, 1);
    }
    const propusteno = periodi
      .map((p) => ({ ...p, uradjeno: zbir(brojevi, p.od, p.do) }))
      .filter((p) => p.uradjeno < s.puta);
    rezultat.push({ ...s, periodaUkupno: periodi.length, propusteno });
  }
  return { od: odDan, do: kraj, stavke: rezultat };
}

/** Osnovni plan za distributera — konsultant ga zatim prilagodi. Samo kad plan još ne postoji. */
export async function osnovniPlan(klijent: PoolClient, korisnikId: string): Promise<number> {
  const postoji = await klijent.query(`select 1 from plan_monitoringa where aktivan limit 1`);
  if (postoji.rows[0]) return 0;
  const tacke = new Map(
    (await klijent.query<{ sifra: string; id: string }>(`select sifra, id from kontrolna_tacka where aktivan`)).rows.map((r) => [r.sifra, r.id]),
  );
  const vozila = (await klijent.query<{ id: string; registarski_broj: string }>(`select id, registarski_broj from vozilo where aktivan order by registarski_broj`)).rows;
  type Nova = { naziv: string; vrsta: VrstaPlana; kt?: string; obrazac?: string; vozilo?: string; ucestalost: Ucestalost; puta?: number; uloga: string; napomena?: string };
  const nove: Nova[] = [];
  if (tacke.get("KKT1")) nove.push({ naziv: "Temperatura robe pri prijemu (KKT 1)", vrsta: "mjerenje", kt: tacke.get("KKT1"), ucestalost: "PO_DOGADJAJU", uloga: "operater", napomena: "Uz svaki prijem robe pod temperaturnim režimom — bez temperature se prijem ne snima." });
  if (tacke.get("KKT2")) nove.push({ naziv: "Temperatura skladištenja — rashladne komore (KKT 2)", vrsta: "mjerenje", kt: tacke.get("KKT2"), ucestalost: "RADNIM_DANIMA", puta: 2, uloga: "operater", napomena: "Jutro i popodne, svaka komora." });
  if (tacke.get("KKT3")) nove.push({ naziv: "Temperatura robe pri predaji kupcu (KKT 3)", vrsta: "mjerenje", kt: tacke.get("KKT3"), ucestalost: "PO_DOGADJAJU", uloga: "vozac", napomena: "Uz svaku isporuku robe pod režimom — bez temperature se isporuka ne potvrđuje." });
  nove.push(
    { naziv: "Čišćenje i dezinfekcija (P3)", vrsta: "obrazac", obrazac: "P3", ucestalost: "RADNIM_DANIMA", uloga: "operater" },
    { naziv: "Lična higijena i zdravstveno stanje (P8)", vrsta: "obrazac", obrazac: "P8", ucestalost: "RADNIM_DANIMA", uloga: "operater" },
    { naziv: "Kontrola otpada (P9)", vrsta: "obrazac", obrazac: "P9", ucestalost: "RADNIM_DANIMA", uloga: "operater" },
    { naziv: "Kontrola štetočina (P7)", vrsta: "obrazac", obrazac: "P7", ucestalost: "SEDMICNO", uloga: "operater" },
    { naziv: "Kontrola pribora i opreme (P10)", vrsta: "obrazac", obrazac: "P10", ucestalost: "SEDMICNO", uloga: "operater" },
  );
  for (const v of vozila) nove.push({ naziv: `Kontrola vozila ${v.registarski_broj} prije utovara (D1)`, vrsta: "kontrola_vozila", vozilo: v.id, ucestalost: "RADNIM_DANIMA", uloga: "vozac" });
  for (const n of nove) {
    await klijent.query(
      `insert into plan_monitoringa (naziv, vrsta, kontrolna_tacka_id, obrazac_kod, vozilo_id, ucestalost, puta, uloga, napomena, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8::uloga_t, $9, $10)`,
      [n.naziv, n.vrsta, n.kt ?? null, n.obrazac ?? null, n.vozilo ?? null, n.ucestalost, n.puta ?? 1, n.uloga, n.napomena ?? null, korisnikId],
    );
  }
  return nove.length;
}
