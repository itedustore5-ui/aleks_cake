import { pool, tabelaPostoji } from "../db.js";
import { ApiGreska } from "../greske.js";

export const IZVORI_IZVOZA = [
  { kod: "sledljivost", naziv: "Sledljivost", izvor: "v_izvoz_sledljivost" },
  { kod: "lica", naziv: "Zaposleni", izvor: "v_lica" },
  { kod: "plan_obuke", naziv: "Plan obuke", izvor: "v_plan_obuke" },
  { kod: "prijemi", naziv: "Prijemi", izvor: "v_izvoz_prijemi" },
  { kod: "lotovi", naziv: "Lotovi", izvor: "lot" },
  { kod: "isporuke", naziv: "Isporuke", izvor: "v_izvoz_isporuke" },
  { kod: "isporuke_stavke", naziv: "Stavke isporuka", izvor: "isporuka_stavka" },
  // Nalaz R-20: bez ovih izvora inspektor nije dobijao D1, provjere mjera, termometre, verifikaciju
  // sistema ni dnevnik kretanja zaliha — sve je bilo u bazi, ali ne i u izvozu.
  { kod: "kontrole_vozila", naziv: "Kontrole vozila (D1)", izvor: "v_izvoz_kontrole_vozila" },
  { kod: "kretanja_zalihe", naziv: "Kretanja zaliha", izvor: "v_izvoz_kretanja_zalihe" },
  { kod: "neusaglasenosti", naziv: "Neusaglašenosti", izvor: "neusaglasenost" },
  { kod: "korektivne_mjere", naziv: "Korektivne mjere", izvor: "korektivna_mjera" },
  { kod: "provjere_nc", naziv: "Provjere neusaglašenosti", izvor: "v_izvoz_provjere_nc" },
  { kod: "mjerenja", naziv: "Temperaturna mjerenja", izvor: "mjerenje_temperature" },
  { kod: "termometri", naziv: "Provjere termometara", izvor: "v_izvoz_termometri" },
  { kod: "verifikacija_sistema", naziv: "Verifikacija sistema", izvor: "v_izvoz_verifikacija_sistema" },
  { kod: "zapisi", naziv: "Dnevni zapisi", izvor: "v_trag_ispravki" },
  { kod: "povlacenja", naziv: "Povlačenja", izvor: "povlacenje" },
  { kod: "povlacenje_kontakti", naziv: "Kontakti povlačenja", izvor: "povlacenje_kontakt" },
  { kod: "audit", naziv: "Audit log", izvor: "audit_log" },
] as const;

// ─── Filteri izvještaja (01.10.2026: „svaki izvještaj treba filter po vremenu i po drugim linijama“) ──
// Isti filter važi za pregled na ekranu, štampu i CSV — ono što se vidi je ono što se preuzme.
// Kolona za vrijeme: prva koja postoji u izvoru, ovim redom (dan radnje prije trenutka upisa).
const DATUMSKE = ["datum", "datum_prijema", "datum_isporuke", "planirani_datum", "izmjereno_at", "izvrseno_at", "pokrenuto_at", "verifikovano_at", "created_at"];
// Kolone po kojima se bira sa spiska (status, magacin, obrazac…) — samo one koje izvor stvarno ima.
const KATEGORIJSKE = [
  "status", "ukupan_status", "lot_status", "rezultat", "ozbiljnost", "obrazac_kod", "skladiste_naziv", "magacin",
  "dobavljac", "dobavljac_naziv", "kupac", "kupac_naziv", "registarski_broj", "izvrsilac", "akcija", "entitet_tip",
  "tip", "vrsta", "izvor_tip", "radno_mjesto", "artikal", "artikal_naziv", "tema",
];
// Izvori bez smislenog datuma (spisak zaposlenih) — filter po vremenu se ne nudi.
const BEZ_DATUMA = new Set(["lica"]);
const PG_DATE = 1082;
const PG_TIMESTAMP = 1114;
const PG_TIMESTAMPTZ = 1184;
const DAN = /^\d{4}-\d{2}-\d{2}$/;

export type FilterIzvoza = { od?: string; do?: string; polja?: Record<string, string> };

const ime = (kolona: string) => `"${kolona.replace(/"/g, '""')}"`;

/** Kolone izvora i koja je za vrijeme / kategorije. */
async function opisIzvora(kod: string, izvor: string) {
  const prazno = await pool.query(`select * from ${izvor} limit 0`);
  const kolone = prazno.fields.map((f) => f.name);
  const tip = new Map(prazno.fields.map((f) => [f.name, f.dataTypeID]));
  const datumKolona = BEZ_DATUMA.has(kod) ? null : DATUMSKE.find((k) => kolone.includes(k) && [PG_DATE, PG_TIMESTAMP, PG_TIMESTAMPTZ].includes(tip.get(k) ?? 0)) ?? null;
  return { kolone, tip, datumKolona, kategorije: KATEGORIJSKE.filter((k) => kolone.includes(k)) };
}

/** WHERE za filter: dan po Podgorici (#11) za trenutke, kategorije kao tekst — sve kroz parametre. */
function uslovFiltera(opis: Awaited<ReturnType<typeof opisIzvora>>, filter: FilterIzvoza) {
  const uslovi: string[] = [];
  const parametri: unknown[] = [];
  if (opis.datumKolona && (filter.od || filter.do)) {
    const k = ime(opis.datumKolona);
    const t = opis.tip.get(opis.datumKolona);
    const dan = t === PG_TIMESTAMPTZ ? `(${k} at time zone 'Europe/Podgorica')::date` : `${k}::date`;
    if (filter.od && DAN.test(filter.od)) {
      parametri.push(filter.od);
      uslovi.push(`${dan} >= $${parametri.length}::date`);
    }
    if (filter.do && DAN.test(filter.do)) {
      parametri.push(filter.do);
      uslovi.push(`${dan} <= $${parametri.length}::date`);
    }
  }
  for (const [kolona, vrijednost] of Object.entries(filter.polja ?? {})) {
    if (!opis.kategorije.includes(kolona) || !vrijednost) continue;
    parametri.push(vrijednost);
    uslovi.push(`${ime(kolona)}::text = $${parametri.length}`);
  }
  return { where: uslovi.length ? `where ${uslovi.join(" and ")}` : "", parametri };
}

/** Trenutak po podgoričkom vremenu, „2026-09-28 14:05:09“ — inspektor čita lokalni sat, ne UTC (#11). */
const PODGORICA = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Podgorica", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});

/** Ćelija CSV-a. Tekst koji počinje sa = + - @ (ili tab/CR) Excel izvršava kao formulu — napomena
 * „=HYPERLINK(…)“ iz aplikacije bi se izvršila kod konsultanta (talas 5). Takvom tekstu ide apostrof
 * ispred; broj ostaje broj („-18,5“ je temperatura, ne formula). */
export function csvVrijednost(v: unknown): string {
  if (v === null || v === undefined) return "";
  let tekst = v instanceof Date ? PODGORICA.format(v) : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(tekst) && !/^[+-]?\d+([.,]\d+)?$/.test(tekst)) tekst = `'${tekst}`;
  if (/[",\n;]/.test(tekst)) return `"${tekst.replace(/"/g, '""')}"`;
  return tekst;
}

/** `sveKolone`: nazivi kolona iz upita — prazna tabela se izvozi SA zaglavljem, ne kao prazan fajl
 * (inspektor inače ne vidi ni koje se kolone vode). */
export function nizUCsv(redovi: Record<string, unknown>[], sveKolone?: string[]): string {
  const kolone = sveKolone ?? (redovi[0] ? Object.keys(redovi[0]) : []);
  if (kolone.length === 0) return "";
  const zaglavlje = kolone.join(";");
  const tijelo = redovi.map((red) => kolone.map((k) => csvVrijednost(red[k])).join(";")).join("\n");
  return `﻿${zaglavlje}\n${tijelo}`;
}

export async function izvezi(kod: string, filter: FilterIzvoza = {}): Promise<{ naziv: string; csv: string; redova: number }> {
  const stavka = IZVORI_IZVOZA.find((i) => i.kod === kod);
  if (!stavka) throw new ApiGreska(404, "IZVOZ_NEPOZNAT", "Traženi izvor izvoza ne postoji.");
  const postoji = await tabelaPostoji(stavka.izvor);
  if (!postoji) {
    throw new ApiGreska(409, "IZVOR_NEDOSTAJE", `Izvor "${stavka.naziv}" trenutno nije dostupan u bazi. Pokrenite migracije (npm run migriraj) pa pokušajte ponovo.`, {
      izvor: stavka.izvor,
    });
  }
  const opis = await opisIzvora(stavka.kod, stavka.izvor);
  const { where, parametri } = uslovFiltera(opis, filter);
  const rezultat = await pool.query(`select * from ${stavka.izvor} ${where} order by 1`, parametri);
  return { naziv: stavka.naziv, csv: nizUCsv(rezultat.rows, rezultat.fields.map((f) => f.name)), redova: rezultat.rows.length };
}

/** Ne smije da padne zbog jednog nedostajućeg izvora — nedostajući se prijavi poimence,
 * ostalo se izveze normalno (invarijanta #30). */
export async function izveziSve(): Promise<{ podaci: Record<string, Record<string, unknown>[]>; nedostaje: { kod: string; naziv: string; razlog: string }[] }> {
  const podaci: Record<string, Record<string, unknown>[]> = {};
  const nedostaje: { kod: string; naziv: string; razlog: string }[] = [];
  for (const stavka of IZVORI_IZVOZA) {
    const postoji = await tabelaPostoji(stavka.izvor);
    if (!postoji) {
      nedostaje.push({ kod: stavka.kod, naziv: stavka.naziv, razlog: `relation "${stavka.izvor}" does not exist` });
      continue;
    }
    const rezultat = await pool.query(`select * from ${stavka.izvor} order by 1`);
    podaci[stavka.kod] = rezultat.rows;
  }
  return { podaci, nedostaje };
}

/** Pregled prije preuzimanja ili štampe: najnovijih `limit` redova, sa ukupnim brojem. Isti izvor
 * i ista provjera kao CSV — ono što se vidi na ekranu je ono što se preuzme. */
export async function pregled(kod: string, filter: FilterIzvoza = {}, limit = 500) {
  const stavka = IZVORI_IZVOZA.find((i) => i.kod === kod);
  if (!stavka) throw new ApiGreska(404, "IZVOZ_NEPOZNAT", "Traženi izvor izvoza ne postoji.");
  if (!(await tabelaPostoji(stavka.izvor))) {
    throw new ApiGreska(409, "IZVOR_NEDOSTAJE", `Izvor "${stavka.naziv}" trenutno nije dostupan u bazi. Pokrenite migracije (npm run migriraj) pa pokušajte ponovo.`);
  }
  const opis = await opisIzvora(stavka.kod, stavka.izvor);
  const kolone = opis.kolone;
  const poredak = opis.datumKolona ? `${ime(opis.datumKolona)} desc` : kolone.includes("created_at") ? "created_at desc" : "1";
  const { where, parametri } = uslovFiltera(opis, filter);
  const [redovi, ukupno, ...vrijednosti] = await Promise.all([
    pool.query(`select * from ${stavka.izvor} ${where} order by ${poredak} limit $${parametri.length + 1}`, [...parametri, limit]),
    pool.query<{ n: number }>(`select count(*)::int as n from ${stavka.izvor} ${where}`, parametri),
    // Vrijednosti za spiskove filtera — iz cijelog izvora, da se izbor ne „izgubi“ kad se suzi vrijeme.
    ...opis.kategorije.map((k) => pool.query<{ v: string }>(`select distinct ${ime(k)}::text as v from ${stavka.izvor} where ${ime(k)} is not null order by 1 limit 60`)),
  ]);
  const filteri = Object.fromEntries(
    opis.kategorije.map((k, i) => [k, vrijednosti[i].rows.map((r) => r.v)] as const).filter(([, v]) => v.length > 1 && v.length < 60),
  );
  return { naziv: stavka.naziv, kolone, redovi: redovi.rows, ukupno: ukupno.rows[0].n, datumKolona: opis.datumKolona, filteri };
}

/** Spisak izvora sa oznakom koji nedostaje u bazi (invarijanta #30) — da ekran to kaže unaprijed. */
export async function spisakIzvora() {
  return Promise.all(
    IZVORI_IZVOZA.map(async ({ kod, naziv, izvor }) => ((await tabelaPostoji(izvor)) ? { kod, naziv } : { kod, naziv, nedostaje: true, razlog: `relation "${izvor}" does not exist` })),
  );
}
