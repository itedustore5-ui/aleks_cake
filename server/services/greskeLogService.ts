import { pool } from "../db.js";

// Dnevnik grešaka (talas 5, invarijanta #80): greška servera (500), pad ekrana u pregledaču i neuhvaćena
// greška procesa idu u greska_log — u bazi klijenta, bez spoljnog servisa. Konsultant ih vidi u
// `npm run dnevni-pregled` i na /api/greske. Upis NIKAD ne obara zahtjev: ako ne uspije, samo konzola.

type Izvor = "server" | "pregledac" | "proces";
export type ZapisGreske = {
  izvor: Izvor;
  poruka: string;
  metod?: string | null;
  putanja?: string | null;
  status?: number | null;
  kod?: string | null;
  detalji?: string | null;
  korisnikId?: string | null;
};

const IZDANJE = process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? "lokalno";
/** Najviše ovoliko upisa u minuti za cijeli server — petlja grešaka ne smije zatrpati bazu. */
const NAJVISE_U_MINUTI = 30;
let prozorOd = 0;
let uProzoru = 0;
let preskoceno = 0;

const skrati = (t: string | null | undefined, n: number) => (t == null ? null : String(t).slice(0, n));

export async function zapisiGresku(z: ZapisGreske): Promise<void> {
  const sada = Date.now();
  if (sada - prozorOd > 60_000) {
    if (preskoceno > 0) console.error(`Dnevnik grešaka: ${preskoceno} upisa preskočeno (više od ${NAJVISE_U_MINUTI} u minuti).`);
    prozorOd = sada;
    uProzoru = 0;
    preskoceno = 0;
  }
  if (uProzoru >= NAJVISE_U_MINUTI) {
    preskoceno++;
    return;
  }
  uProzoru++;
  try {
    await pool.query(
      `insert into greska_log (izvor, metod, putanja, status, kod, poruka, detalji, korisnik_id, izdanje)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [z.izvor, skrati(z.metod, 10), skrati(z.putanja, 300), z.status ?? null, skrati(z.kod, 60), skrati(z.poruka, 1000) ?? "(bez poruke)", skrati(z.detalji, 6000), z.korisnikId ?? null, IZDANJE],
    );
  } catch (e) {
    console.error("Dnevnik grešaka: upis nije uspio —", (e as Error).message);
  }
}

/** Opis greške za dnevnik: poruka + stek, bez podataka iz zahtjeva (lozinke, lični podaci). */
export function opisGreske(greska: unknown): { poruka: string; detalji: string | null } {
  if (greska instanceof Error) return { poruka: greska.message || greska.name, detalji: greska.stack ?? null };
  return { poruka: String(greska), detalji: null };
}

export async function posljednjeGreske(sati = 72, limit = 100) {
  return (
    await pool.query(
      `select id, vrijeme, izvor, metod, putanja, status, kod, poruka, detalji, korisnik_id, izdanje
       from greska_log where vrijeme > now() - $1 * interval '1 hour' order by vrijeme desc limit $2`,
      [sati, limit],
    )
  ).rows;
}

/** Jednom dnevno: brisanje starijih od 90 dana. */
export function pokreniCiscenjeGresaka() {
  const ocisti = () => pool.query(`delete from greska_log where vrijeme < now() - interval '90 days'`).catch(() => undefined);
  setTimeout(ocisti, 60_000).unref();
  setInterval(ocisti, 24 * 60 * 60 * 1000).unref();
}
