import { transakcija } from "../db.js";
import { ApiGreska } from "../greske.js";
import { logKreiranje, logOdluka } from "./auditService.js";
import { javiManjakRezervacije } from "./lotBlokadaService.js";

export type OtpisUlaz = { kolicina: number; razlog: string };

/** Otpis je jedini dozvoljeni način da količina na zalihi ide dolje bez isporuke —
 * uvijek kroz kretanje_zalihe (tip OTPIS), nikad direktan update. Bez toga bi lot
 * mogao da "nestane" sa zalihe bez traga zašto (invarijanta sledljivosti, čl. 27). */
export async function otpisiZalihu(lotId: string, ulaz: OtpisUlaz, korisnikId: string) {
  return transakcija(async (klijent) => {
    const zaliha = await klijent.query<{ id: string; kolicina: string; artikal_id: string }>(
      `select id, kolicina, artikal_id from zaliha where lot_id = $1 and status = 'DOSTUPNO' for update`,
      [lotId],
    );
    const red = zaliha.rows[0];
    if (!red) throw new ApiGreska(404, "ZALIHA_NE_POSTOJI", "Za ovaj lot nema dostupne zalihe.");

    const dostupno = Number(red.kolicina);
    if (ulaz.kolicina > dostupno) {
      throw new ApiGreska(409, "NEDOVOLJNO_ZALIHE", `Na zalihi je dostupno samo ${dostupno} za izabrani lot.`);
    }

    await klijent.query(`update zaliha set kolicina = kolicina - $1, updated_at = now() where id = $2`, [ulaz.kolicina, red.id]);

    const kretanje = await klijent.query<{ id: string }>(
      `insert into kretanje_zalihe (lot_id, artikal_id, kolicina_delta, tip, referenca_tip, izvrsio_korisnik_id, napomena)
       values ($1, $2, $3, 'OTPIS', 'otpis', $4, $5) returning id`,
      [lotId, red.artikal_id, -ulaz.kolicina, korisnikId, ulaz.razlog],
    );
    const kretanjeId = kretanje.rows[0].id;

    await logKreiranje(klijent, {
      korisnikId,
      entitetTip: "kretanje_zalihe",
      entitetId: kretanjeId,
      noveVrijednosti: { lotId, kolicina: ulaz.kolicina, razlog: ulaz.razlog, tip: "OTPIS" },
    });
    await javiManjakRezervacije(klijent, lotId, korisnikId);
  });
}

export type KarantinUlaz = { odluka: "PUSTI" | "OTPISI"; kolicina: number; razlog: string };

/** Roba vraćena sa isporuke stoji u KARANTINU prihvaćenog lota dok je odgovorno lice ne pregleda
 * (nalaz R-03): pusti je nazad u slobodnu zalihu ili je otpiše. Lot na HOLD-u se ne rješava ovdje
 * nego odlukom o cijelom lotu (Zalihe → Pusti / Odbij). */
export async function odlukaOKarantinu(lotId: string, ulaz: KarantinUlaz, korisnikId: string) {
  return transakcija(async (klijent) => {
    const lot = await klijent.query<{ status: string; broj_lota: string; artikal_id: string; istekao: boolean | null }>(
      `select status, broj_lota, artikal_id, rok_trajanja < (now() at time zone 'Europe/Podgorica')::date as istekao from lot where id = $1 for update`,
      [lotId],
    );
    const l = lot.rows[0];
    if (!l) throw new ApiGreska(404, "LOT_NE_POSTOJI", "Lot nije pronađen.");
    if (l.status !== "PRIHVACEN") {
      throw new ApiGreska(409, "LOT_NIJE_PRIHVACEN", "Lot nije prihvaćen — o zadržanom lotu se odlučuje u cjelini (Zalihe → Pusti / Odbij).");
    }
    const karantin = Number(
      (await klijent.query<{ kolicina: string }>(`select kolicina from zaliha where lot_id = $1 and status = 'KARANTIN' for update`, [lotId])).rows[0]?.kolicina ?? 0,
    );
    if (ulaz.kolicina > karantin) throw new ApiGreska(409, "NEDOVOLJNO_U_KARANTINU", `U karantinu je samo ${karantin} za lot ${l.broj_lota}.`);
    if (ulaz.odluka === "PUSTI" && l.istekao) {
      throw new ApiGreska(409, "ROK_ISTEKAO", `Lot ${l.broj_lota} je istekao — ne vraća se u slobodnu zalihu. Otpišite ga.`);
    }

    await klijent.query(`update zaliha set kolicina = kolicina - $1, updated_at = now() where lot_id = $2 and status = 'KARANTIN'`, [ulaz.kolicina, lotId]);
    if (ulaz.odluka === "PUSTI") {
      await klijent.query(
        `insert into zaliha (lot_id, artikal_id, kolicina, status) values ($1, $2, $3, 'DOSTUPNO')
         on conflict (lot_id, status) do update set kolicina = zaliha.kolicina + excluded.kolicina, updated_at = now()`,
        [lotId, l.artikal_id, ulaz.kolicina],
      );
    }
    // Puštanje je premještanje (razlika 0), otpis smanjuje ukupnu količinu — kao i u ostatku dnevnika.
    const kretanje = await klijent.query<{ id: string }>(
      `insert into kretanje_zalihe (lot_id, artikal_id, kolicina_delta, tip, referenca_tip, izvrsio_korisnik_id, napomena)
       values ($1, $2, $3, $4, 'karantin', $5, $6) returning id`,
      [lotId, l.artikal_id, ulaz.odluka === "PUSTI" ? 0 : -ulaz.kolicina, ulaz.odluka === "PUSTI" ? "RELEASE" : "OTPIS", korisnikId, `Iz karantina (${ulaz.kolicina}): ${ulaz.razlog}`],
    );
    await logOdluka(klijent, {
      korisnikId,
      entitetTip: "lot",
      entitetId: lotId,
      noveVrijednosti: { karantin: ulaz.odluka, kolicina: ulaz.kolicina, razlog: ulaz.razlog, kretanjeId: kretanje.rows[0].id },
    });
  });
}
