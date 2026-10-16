import type { PoolClient } from "pg";
import { logKreiranje } from "./auditService.js";

/** Kontrolne tačke na kojima se roba ocjenjuje po granici SVOG artikla: prijem i predaja kupcu.
 * KKT 2 (skladištenje) se ocjenjuje po komori, ne po artiklu. */
const TACKE_PO_ARTIKLU = ["KKT1", "KKT3"];

/** Jedan izvor granica (ostatak nalaza H4): granica se unosi u Šifarnicima, na artiklu, a ocjenjuje
 * se UVIJEK po pravilu (pravilo_kontrole). Ova funkcija drži pravila KKT 1 i KKT 3 u skladu sa
 * artiklom — nova verzija pravila kad se granica promijeni, gašenje kad artikal više nije pod
 * režimom. Stara verzija ostaje (vazi_do), da se vidi po čemu je ocijenjeno ranije mjerenje.
 * Zove se u transakciji izmjene artikla. */
export async function uskladiPravilaArtikla(klijent: PoolClient, artikalId: string, korisnikId: string | null) {
  const a = (
    await klijent.query<{ naziv: string; temp_kontrolisano: boolean; temp_min: string | null; temp_max: string | null }>(
      `select naziv, temp_kontrolisano, temp_min, temp_max from artikal where id = $1`,
      [artikalId],
    )
  ).rows[0];
  if (!a) return;
  const imaGranicu = a.temp_kontrolisano && (a.temp_min !== null || a.temp_max !== null);
  const tacke = (await klijent.query<{ id: string }>(`select id from kontrolna_tacka where sifra = any($1)`, [TACKE_PO_ARTIKLU])).rows;
  const isti = (x: string | null, y: string | null) => (x === null ? y === null : y !== null && Number(x) === Number(y));

  for (const t of tacke) {
    const aktivno = (
      await klijent.query<{ id: string; verzija: number; min_vrijednost: string | null; max_vrijednost: string | null }>(
        `select id, verzija, min_vrijednost, max_vrijednost from pravilo_kontrole
         where kontrolna_tacka_id = $1 and artikal_id = $2 and aktivan for update`,
        [t.id, artikalId],
      )
    ).rows[0];
    if (aktivno && imaGranicu && isti(aktivno.min_vrijednost, a.temp_min) && isti(aktivno.max_vrijednost, a.temp_max)) continue;
    if (aktivno) await klijent.query(`update pravilo_kontrole set aktivan = false, vazi_do = now() where id = $1`, [aktivno.id]);
    if (!imaGranicu) continue;
    const novo = await klijent.query<{ id: string }>(
      `insert into pravilo_kontrole (kontrolna_tacka_id, artikal_id, naziv, min_vrijednost, max_vrijednost, jedinica, ozbiljnost, verzija)
       values ($1, $2, $3, $4, $5, '°C', 'VISOK', $6) returning id`,
      [t.id, artikalId, `Granica artikla — ${a.naziv}`, a.temp_min, a.temp_max, (aktivno?.verzija ?? 0) + 1],
    );
    await logKreiranje(klijent, {
      korisnikId,
      entitetTip: "pravilo_kontrole",
      entitetId: novo.rows[0].id,
      noveVrijednosti: { artikalId, min: a.temp_min, max: a.temp_max, izvor: "sifarnik artikla" },
    });
  }
}
