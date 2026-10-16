import type { PoolClient } from "pg";

// Ključ zahtjeva (nalaz R-10): pregledač šalje isti ključ dok je forma otvorena. Drugi zahtjev sa
// istim ključem (dupli klik, ponovljeno slanje kad je odgovor izgubljen) dobija PRVI rezultat
// umjesto drugog prijema ili druge isporuke. Radi u transakciji upisa — ako upis padne, ključ se
// oslobađa zajedno sa njim.

/** Zauzme ključ ili vrati rezultat ranijeg zahtjeva sa istim ključem (`undefined` = prvi put). */
export async function zauzmiKljuc(klijent: PoolClient, korisnikId: string, kljuc: string, radnja: string): Promise<Record<string, unknown> | undefined> {
  await klijent.query(`delete from kljuc_zahtjeva where created_at < now() - interval '2 days'`);
  // Drugi istovremeni zahtjev čeka ovdje dok se prvi ne završi, pa zatim čita njegov rezultat.
  const novo = await klijent.query(
    `insert into kljuc_zahtjeva (korisnik_id, kljuc, radnja) values ($1, $2, $3) on conflict do nothing returning kljuc`,
    [korisnikId, kljuc, radnja],
  );
  if (novo.rowCount) return undefined;
  const ranije = await klijent.query<{ rezultat: Record<string, unknown> | null }>(
    `select rezultat from kljuc_zahtjeva where korisnik_id = $1 and kljuc = $2`,
    [korisnikId, kljuc],
  );
  return ranije.rows[0]?.rezultat ?? undefined;
}

export async function upisiRezultatKljuca(klijent: PoolClient, korisnikId: string, kljuc: string, rezultat: Record<string, unknown>) {
  await klijent.query(`update kljuc_zahtjeva set rezultat = $3 where korisnik_id = $1 and kljuc = $2`, [korisnikId, kljuc, JSON.stringify(rezultat)]);
}

/** Ključ iz zaglavlja `x-kljuc-zahtjeva` — samo razuman tekst, inače se ne koristi. */
export function kljucIzZaglavlja(vrijednost: string | string[] | undefined): string | undefined {
  const k = Array.isArray(vrijednost) ? vrijednost[0] : vrijednost;
  return k && /^[A-Za-z0-9_-]{8,80}$/.test(k) ? k : undefined;
}
