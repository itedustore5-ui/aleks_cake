import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

// Jedno mjesto za dopune baze (db/NN_*.sql): koristi ga `npm run migriraj` i server pri pokretanju.
// Talas 5: 27.09.2026 je kod otišao na Render prije dopune 31 i mjerenja su padala sa „column does
// not exist“ — sada server u produkciji sam primijeni ono što fali prije nego što primi prvi zahtjev,
// a /api/zdravlje kaže koja dopuna nije primijenjena (invarijanta #79).

const DB_FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "db");
const DEMO = "13_demo_cg.sql";
/** Ključ za pg_advisory_lock — dva procesa (npr. deploy i `npm run migriraj` u isto vrijeme) ne
 * primjenjuju istu dopunu dvaput. */
const KLJUC_ZAKLJUCAVANJA = 72_010_033;

let fajloviKes: string[] | null = null;

/** Dopune koje server očekuje (bez demo podataka — oni se primjenjuju samo na demo bazu). */
export async function ocekivaneMigracije(): Promise<string[]> {
  fajloviKes ??= (await fs.readdir(DB_FOLDER)).filter((f) => /^\d{2}_.*\.sql$/.test(f) && f !== DEMO).sort();
  return fajloviKes;
}

/** Dopune koje još nisu primijenjene na ovu bazu. */
export async function migracijeNaCekanju(pool: Pool): Promise<string[]> {
  const ocekivane = await ocekivaneMigracije();
  const postoji = await pool.query<{ postoji: boolean }>(`select to_regclass('public.schema_migracije') is not null as postoji`);
  if (!postoji.rows[0].postoji) return ocekivane;
  const primijenjene = new Set((await pool.query<{ fajl: string }>(`select fajl from schema_migracije`)).rows.map((r) => r.fajl));
  return ocekivane.filter((f) => !primijenjene.has(f));
}

/** Primijeni sve dopune koje fale, po redu. Svaki fajl je jedna naredba (jedna transakcija): ako
 * padne, ništa iz njega ne ostaje, a fajl se ne upisuje kao primijenjen. */
export async function primijeniMigracije(pool: Pool, opcije: { demo?: boolean; ispis?: (red: string) => void } = {}): Promise<string[]> {
  const ispis = opcije.ispis ?? (() => undefined);
  const klijent = await pool.connect();
  const primijenjeno: string[] = [];
  try {
    await klijent.query(`select pg_advisory_lock($1)`, [KLJUC_ZAKLJUCAVANJA]);
    await klijent.query(`create table if not exists schema_migracije (fajl varchar(100) primary key, primijenjeno_at timestamptz not null default now())`);
    const svi = (await fs.readdir(DB_FOLDER)).filter((f) => /^\d{2}_.*\.sql$/.test(f)).sort();
    for (const fajl of svi) {
      if (fajl === DEMO && !opcije.demo) continue;
      const vec = await klijent.query(`select 1 from schema_migracije where fajl = $1`, [fajl]);
      if (vec.rows.length > 0) {
        ispis(`✓ ${fajl} (već primijenjeno)`);
        continue;
      }
      ispis(`→ primjenjujem ${fajl}...`);
      await klijent.query(await fs.readFile(path.join(DB_FOLDER, fajl), "utf8"));
      await klijent.query(`insert into schema_migracije (fajl) values ($1)`, [fajl]);
      primijenjeno.push(fajl);
      ispis(`✓ ${fajl}`);
    }
  } finally {
    await klijent.query(`select pg_advisory_unlock($1)`, [KLJUC_ZAKLJUCAVANJA]).catch(() => undefined);
    klijent.release();
  }
  return primijenjeno;
}
