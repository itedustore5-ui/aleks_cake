import type { PoolClient } from "pg";
import { pool } from "../db.js";

// Jedini dnevnik promjena (nalaz B4, faza 4). Tabela `dogadjaj` se više ne puni — stari redovi
// ostaju u bazi i u bekapu, a `audit_log.dogadjaj_id` je za nove redove prazan.

type ZabiljeziInput = {
  korisnikId?: string | null;
  akcija: string;
  entitetTip: string;
  entitetId: string;
  stareVrijednosti?: Record<string, unknown> | null;
  noveVrijednosti?: Record<string, unknown> | null;
  ipAdresa?: string | null;
  userAgent?: string | null;
};

async function zabiljezi(klijent: PoolClient | typeof pool, ulaz: ZabiljeziInput) {
  await klijent.query(
    `insert into audit_log (korisnik_id, akcija, entitet_tip, entitet_id, stare_vrijednosti, nove_vrijednosti, ip_adresa, user_agent)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      ulaz.korisnikId ?? null,
      ulaz.akcija,
      ulaz.entitetTip,
      ulaz.entitetId,
      ulaz.stareVrijednosti ? JSON.stringify(ulaz.stareVrijednosti) : null,
      ulaz.noveVrijednosti ? JSON.stringify(ulaz.noveVrijednosti) : null,
      ulaz.ipAdresa ?? null,
      ulaz.userAgent ?? null,
    ],
  );
}

export const logKreiranje = (klijent: PoolClient | typeof pool, ulaz: Omit<ZabiljeziInput, "akcija">) =>
  zabiljezi(klijent, { ...ulaz, akcija: "KREIRANJE" });

/** Izmjena bez „prije" ne govori ništa (nalaz R-06) — zato je stara vrijednost obavezna po tipu.
 * Za izmjenu reda tabele koristiti `logIzmjenaReda` (sama računa šta se promijenilo). */
export const logIzmjena = (klijent: PoolClient | typeof pool, ulaz: Omit<ZabiljeziInput, "akcija" | "stareVrijednosti"> & { stareVrijednosti: Record<string, unknown> }) =>
  zabiljezi(klijent, { ...ulaz, akcija: "IZMJENA" });

// Tabele čiji se red čita za audit. Spisak je zatvoren — naziv tabele ide u SQL.
const TABELE_AUDITA = [
  "artikal", "dobavljac", "kupac", "skladiste", "vozilo", "lice", "korisnik", "firma", "zadatak", "plan_obuke",
  "plan_monitoringa", "kontrolna_tacka", "mjerni_uredjaj", "pitanje", "sesija_znanja", "isporuka", "lot", "prijem_stavka",
] as const;
export type TabelaAudita = (typeof TABELE_AUDITA)[number];
// Ne ulazi u audit: tehnička polja i ono što se ne smije ni čuvati van svoje tabele.
// Tajne se ne pišu u audit: heš lozinke, sadržaj fajla, tajna i rezervni kodovi potvrde u dva koraka (#81).
const BEZ_AUDITA = new Set(["updated_at", "created_at", "lozinka_hash", "sadrzaj", "totp_tajna", "totp_rezervni", "totp_zadnji_korak"]);

/** Red tabele kao objekat — stanje „prije" ili „poslije" izmjene (R-06). `zakljucaj` = `for update`,
 * da se između čitanja i izmjene red ne promijeni. */
export async function stanjeReda(klijent: PoolClient, tabela: TabelaAudita, id: string, zakljucaj = false): Promise<Record<string, unknown> | null> {
  if (!TABELE_AUDITA.includes(tabela)) throw new Error(`Tabela ${tabela} nije na spisku za audit.`);
  const r = await klijent.query<{ red: Record<string, unknown> }>(`select to_jsonb(t) as red from ${tabela} t where id = $1${zakljucaj ? " for update" : ""}`, [id]);
  const red = r.rows[0]?.red;
  if (!red) return null;
  return Object.fromEntries(Object.entries(red).filter(([k]) => !BEZ_AUDITA.has(k)));
}

/** Upisuje samo ono što se promijenilo: `stare_vrijednosti` = prije, `nove_vrijednosti` = poslije,
 * po istim ključevima. `dodatno` ide uz nove (npr. razlog). Bez promjene i bez dodatnog — ništa. */
export async function logIzmjenaReda(
  klijent: PoolClient,
  ulaz: { korisnikId: string | null; entitetTip: string; entitetId: string; prije: Record<string, unknown> | null; poslije: Record<string, unknown> | null; dodatno?: Record<string, unknown> },
) {
  const prije = ulaz.prije ?? {};
  const poslije = ulaz.poslije ?? {};
  const kljucevi = Array.from(new Set([...Object.keys(prije), ...Object.keys(poslije)])).filter((k) => JSON.stringify(prije[k] ?? null) !== JSON.stringify(poslije[k] ?? null));
  if (kljucevi.length === 0 && !ulaz.dodatno) return;
  await logIzmjena(klijent, {
    korisnikId: ulaz.korisnikId,
    entitetTip: ulaz.entitetTip,
    entitetId: ulaz.entitetId,
    stareVrijednosti: Object.fromEntries(kljucevi.map((k) => [k, prije[k] ?? null])),
    noveVrijednosti: { ...Object.fromEntries(kljucevi.map((k) => [k, poslije[k] ?? null])), ...ulaz.dodatno },
  });
}

export const logPromjenaStatusa = (klijent: PoolClient | typeof pool, ulaz: Omit<ZabiljeziInput, "akcija">) =>
  zabiljezi(klijent, { ...ulaz, akcija: "PROMJENA_STATUSA" });

export const logOdluka = (klijent: PoolClient | typeof pool, ulaz: Omit<ZabiljeziInput, "akcija">) =>
  zabiljezi(klijent, { ...ulaz, akcija: "ODLUKA" });

export const logSigurnosniDogadjaj = (klijent: PoolClient | typeof pool, ulaz: Omit<ZabiljeziInput, "akcija">) =>
  zabiljezi(klijent, { ...ulaz, akcija: "SIGURNOST" });
