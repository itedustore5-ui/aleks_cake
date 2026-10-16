import { Pool, types, type PoolClient } from "pg";

// pg inače parsira `date` kolone u JS Date na lokalnu ponoć pa ih JSON.stringify prebacuje u
// UTC — blizu granice dana to pomjeri prikazani datum za jedan dan (isto GRESKA kao
// toISOString() za datum, invarijanta #11). Kolona ostaje sirov "YYYY-MM-DD" string.
types.setTypeParser(types.builtins.DATE, (vrijednost) => vrijednost);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL mora biti podešen (Supabase Session pooler, port 5432).");
}

export const pool = new Pool({
  connectionString,
  ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: false },
  // Nedostupna baza: zahtjev dobija grešku posle 10 s umjesto da visi beskonačno.
  connectionTimeoutMillis: 10_000,
});

export const upit = <T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
) => pool.query<T>(text, params);

// Prekinuta veza (Supabase pooler je zatvori, mreža pukne) ne smije oboriti cijeli server. Za veze
// u mirovanju grešku javlja pool; veza izdata za transakciju nema svoj osluškivač (pg ga skida pri
// izdavanju) — zato ga transakcija dodaje sama. Bez ovoga je jedan prekid rušio proces
// ("Connection terminated unexpectedly", Unhandled 'error' event).
pool.on("error", (greska) => {
  console.error("Baza: veza u mirovanju je prekinuta —", greska.message);
});

export async function transakcija<T>(rad: (klijent: PoolClient) => Promise<T>): Promise<T> {
  const klijent = await pool.connect();
  let prekinuta: Error | null = null;
  const naPrekid = (greska: Error) => {
    prekinuta = greska;
    console.error("Baza: veza je prekinuta usred transakcije —", greska.message);
  };
  klijent.on("error", naPrekid);
  try {
    await klijent.query("BEGIN");
    const rezultat = await rad(klijent);
    await klijent.query("COMMIT");
    return rezultat;
  } catch (greska) {
    // Na prekinutoj vezi ROLLBACK ne može proći — transakciju je baza već poništila.
    if (!prekinuta) await klijent.query("ROLLBACK").catch(() => undefined);
    throw greska;
  } finally {
    klijent.off("error", naPrekid);
    // Prekinuta veza se ne vraća u pool, nego zatvara.
    klijent.release(prekinuta ?? undefined);
  }
}

export async function tabelaPostoji(naziv: string): Promise<boolean> {
  const rezultat = await upit<{ regclass: string | null }>("select to_regclass($1) as regclass", [naziv]);
  return rezultat.rows[0]?.regclass !== null;
}

/** Tabele koje aplikacija NE vidi zbog RLS-a (dopuna 32, R-12): RLS bez politika propušta samo vlasnika
 * tabele. Ako aplikacija radi kao drugi korisnik baze (npr. DATABASE_URL na Renderu ≠ onaj iz kog su
 * pokrenute migracije), upiti vraćaju prazno umjesto greške — prijava bi javljala „pogrešna lozinka“.
 * Zato ovo provjerava /api/zdravlje (503 sa spiskom), da se vidi odmah poslije deploya. */
export async function tabeleBezPristupa(): Promise<string[]> {
  const rezultat = await upit<{ naziv: string }>(`
    select c.relname as naziv
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
      and (c.relforcerowsecurity or not pg_has_role(current_user, c.relowner, 'USAGE'))
      and not exists (select 1 from pg_roles r where r.rolname = current_user and (r.rolsuper or r.rolbypassrls))
    order by 1`);
  return rezultat.rows.map((r) => r.naziv);
}
