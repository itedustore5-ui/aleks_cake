import { transakcija, upit, pool } from "../db.js";
import { ApiGreska } from "../greske.js";
import { logKreiranje, logPromjenaStatusa } from "./auditService.js";
import { kreirajZadatak, obavijestiUlogu, zatvoriZadatkeIzvora } from "./zadaciService.js";
import { sljedeciBroj, sljedeciBrojNc, danasKratko } from "./brojeviService.js";
import { javiIsporukeSaLotom } from "./lotBlokadaService.js";
import { SERIJA_LOTA } from "./sqlDijelovi.js";

/** Povlačenje počinje telefonom (čl. 28) — kontakti se snimaju iz stvarnih isporuka, ne unose se
 * ručno, da se niko ne izostavi. Povlači se SERIJA (R-17): isti dobavljač, artikal i broj lota kroz
 * sve prijeme — ista serija primljena dvaput je ista roba. Automatski otvara i neusaglašenost
 * visoke ozbiljnosti, jer je povlačenje uvijek ozbiljan nalaz. */
export async function pokreniPovlacenje(lotId: string, razlog: string, korisnikId: string) {
  const lotRed = await upit<{ id: string }>(`select id from lot where id = $1`, [lotId]);
  if (!lotRed.rows[0]) throw new ApiGreska(404, "LOT_NE_POSTOJI", "Lot nije pronađen.");

  return transakcija(async (klijent) => {
    const broj = await sljedeciBroj(klijent, "povlacenje", `PVL-${danasKratko()}`);
    const povlacenje = await klijent.query<{ id: string }>(
      `insert into povlacenje (broj, lot_id, razlog, pokrenuo_korisnik_id) values ($1, $2, $3, $4) returning id`,
      [broj, lotId, razlog, korisnikId],
    );
    const povlacenjeId = povlacenje.rows[0].id;
    const serija = (await klijent.query<{ id: string }>(SERIJA_LOTA, [lotId])).rows.map((r) => r.id);

    const isporuke = await klijent.query<{ isporuka_id: string; kupac_naziv: string; kupac_telefon: string; kolicina: string }>(
      `select ist.isporuka_id, k.naziv as kupac_naziv, k.telefon as kupac_telefon, ist.isporucena_kolicina as kolicina
       from isporuka_stavka ist
       join isporuka i on i.id = ist.isporuka_id
       join kupac k on k.id = i.kupac_id
       where ist.lot_id = any($1) and ist.isporucena_kolicina > 0`,
      [serija],
    );
    for (const red of isporuke.rows) {
      await klijent.query(
        `insert into povlacenje_kontakt (povlacenje_id, isporuka_id, kupac_naziv, kupac_telefon, kolicina) values ($1, $2, $3, $4, $5)`,
        [povlacenjeId, red.isporuka_id, red.kupac_naziv, red.kupac_telefon, red.kolicina],
      );
    }

    // Serija pod povlačenjem ne smije dalje u isporuku (čl. 28): lot na HOLD, sve što je od njega
    // ostalo u magacinu prelazi u karantin. Bez ovoga je sporni lot i dalje bio ponuđen za isporuku.
    for (const id of serija) {
      const status = (await klijent.query<{ status: string }>(`select status from lot where id = $1 for update`, [id])).rows[0]?.status;
      if (status === "ODBIJEN") continue;
      await klijent.query(`update lot set status = 'HOLD', updated_at = now() where id = $1`, [id]);
      await klijent.query(
        `insert into zaliha (lot_id, artikal_id, kolicina, status)
         select lot_id, artikal_id, kolicina, 'KARANTIN' from zaliha where lot_id = $1 and status = 'DOSTUPNO' and kolicina > 0
         on conflict (lot_id, status) do update set kolicina = zaliha.kolicina + excluded.kolicina, updated_at = now()`,
        [id],
      );
      await klijent.query(`update zaliha set kolicina = 0, updated_at = now() where lot_id = $1 and status = 'DOSTUPNO'`, [id]);
      await klijent.query(
        `insert into kretanje_zalihe (lot_id, artikal_id, kolicina_delta, tip, referenca_tip, referenca_id, izvrsio_korisnik_id, napomena)
         select $1, artikal_id, 0, 'HOLD', 'povlacenje', $2, $3, $4 from lot where id = $1`,
        [id, povlacenjeId, korisnikId, id === lotId ? "HOLD zbog povlačenja" : "HOLD zbog povlačenja serije (isti lot iz drugog prijema)"],
      );
      if (status !== "HOLD") await logPromjenaStatusa(klijent, { korisnikId, entitetTip: "lot", entitetId: id, stareVrijednosti: { status }, noveVrijednosti: { status: "HOLD", povlacenje: broj } });
      // Isporuke već pripremljene sa ovim lotom ne smiju krenuti — vozač i magacioner saznaju odmah (R-01).
      await javiIsporukeSaLotom(klijent, id, `Pokrenuto povlačenje ${broj}: ${razlog}`, korisnikId);
    }

    const brojNc = await sljedeciBrojNc(klijent);
    const nc = await klijent.query<{ id: string }>(
      `insert into neusaglasenost (broj, ozbiljnost, status, izvor_tip, izvor_id, opis, prijavio_korisnik_id)
       values ($1, 'VISOK', 'OTVORENA', 'povlacenje', $2, $3, $4) returning id`,
      [brojNc, povlacenjeId, `Pokrenuto povlačenje ${broj}: ${razlog}`, korisnikId],
    );
    await kreirajZadatak(klijent, {
      naslov: `Obavijesti sve kupce — povlačenje ${broj}`,
      opis: razlog,
      prioritet: "VISOK",
      izvorTip: "povlacenje",
      izvorId: povlacenjeId,
    });
    // Važno za upravu: vidi i direktor, ne samo odgovorno lice.
    for (const uloga of ["bzr", "uprava"]) await obavijestiUlogu(klijent, uloga, {
      naslov: "Pokrenuto povlačenje robe",
      poruka: `${broj} — ${isporuke.rows.length} kupaca treba obavijestiti.`,
      ozbiljnost: "VISOK",
      izvorTip: "povlacenje",
      izvorId: povlacenjeId,
    });

    await logKreiranje(klijent, { korisnikId, entitetTip: "povlacenje", entitetId: povlacenjeId, noveVrijednosti: { broj, lotId, razlog, lotovaUSeriji: serija.length } });

    return { id: povlacenjeId, broj, brojKontakata: isporuke.rows.length, lotovaUSeriji: serija.length, neusaglasenostId: nc.rows[0].id };
  });
}

export async function oznaciKontaktiran(kontaktId: string, napomena: string | undefined, korisnikId: string) {
  return transakcija(async (klijent) => {
    const rezultat = await klijent.query<{ povlacenje_id: string }>(
      `update povlacenje_kontakt set kontaktiran = true, kontaktiran_at = now(), napomena = coalesce($1, napomena) where id = $2 returning povlacenje_id`,
      [napomena ?? null, kontaktId],
    );
    if (!rezultat.rows[0]) throw new ApiGreska(404, "KONTAKT_NE_POSTOJI", "Kontakt nije pronađen.");
    await logPromjenaStatusa(klijent, { korisnikId, entitetTip: "povlacenje_kontakt", entitetId: kontaktId, noveVrijednosti: { kontaktiran: true } });
    return rezultat.rows[0].povlacenje_id;
  });
}

/** Zatvaranje, zadaci i trag u jednoj transakciji — ranije je povlačenje moglo ostati zatvoreno
 * sa otvorenim zadatkom "obavijesti kupce" ako drugi korak padne. */
export async function zavrsiPovlacenje(povlacenjeId: string, korisnikId: string) {
  await transakcija(async (klijent) => {
    const povlacenje = await klijent.query(`select 1 from povlacenje where id = $1 and status = 'U_TOKU' for update`, [povlacenjeId]);
    if (!povlacenje.rows[0]) throw new ApiGreska(404, "POVLACENJE_NE_POSTOJI", "Povlačenje nije pronađeno ili je već zatvoreno.");
    const nekontaktirani = await klijent.query<{ broj: string }>(
      `select count(*) as broj from povlacenje_kontakt where povlacenje_id = $1 and not kontaktiran`,
      [povlacenjeId],
    );
    if (Number(nekontaktirani.rows[0].broj) > 0) {
      throw new ApiGreska(409, "NISU_SVI_KONTAKTIRANI", "Povlačenje se ne može zatvoriti dok svi kupci nisu obaviješteni.");
    }
    await klijent.query(`update povlacenje set status = 'ZAVRSENO', zavrseno_at = now(), zavrsio_korisnik_id = $1 where id = $2`, [korisnikId, povlacenjeId]);
    await zatvoriZadatkeIzvora(klijent, "povlacenje", povlacenjeId);
    await logPromjenaStatusa(klijent, { korisnikId, entitetTip: "povlacenje", entitetId: povlacenjeId, noveVrijednosti: { status: "ZAVRSENO" } });
  });
}
