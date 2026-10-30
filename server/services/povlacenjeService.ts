import { transakcija, upit, pool } from "../db.js";
import { ApiGreska } from "../greske.js";
import { logKreiranje, logPromjenaStatusa } from "./auditService.js";
import { kreirajZadatak, obavijestiUlogu, zatvoriZadatkeIzvora } from "./zadaciService.js";
import { sljedeciBroj, sljedeciBrojNc, danasKratko } from "./brojeviService.js";
import { javiPorudzbineSaLotom, javiVitrinuSaLotom } from "./lotBlokadaService.js";
import { SERIJA_LOTA } from "./sqlDijelovi.js";

/** Povlačenje počinje telefonom (čl. 28) — kontakti se snimaju iz stvarno predatih torti, ne unose se
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

    // Kupci PREDATIH torti u kojima je bila serija (dopuna 39) — jedan kontakt po torti.
    // Torte koje još nisu predate ne idu u kontakte: predaju zaustavlja server, a ko ih pravi dobija obavještenje.
    const torte = await klijent.query<{ porudzbina_id: string; kupac_ime: string; kupac_telefon: string }>(
      `select distinct p.id as porudzbina_id, p.kupac_ime, p.kupac_telefon
       from porudzbina_lot pl join porudzbina p on p.id = pl.porudzbina_id
       where pl.lot_id = any($1) and p.status = 'PREDATA'`,
      [serija],
    );
    for (const t of torte.rows) {
      await klijent.query(
        `insert into povlacenje_kontakt (povlacenje_id, porudzbina_id, kupac_naziv, kupac_telefon) values ($1, $2, $3, $4)`,
        [povlacenjeId, t.porudzbina_id, t.kupac_ime, t.kupac_telefon],
      );
    }
    const brojKontakata = torte.rows.length;

    // Serija pod povlačenjem ne smije u tortu (čl. 28): lot na HOLD, sve što je od njega ostalo na
    // zalihi prelazi u karantin — više se ne nudi za porudžbinu, a torta sa njim se ne predaje.
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
      // Torte u izradi sa ovim lotom ne smiju kupcu — ko ih je upisao i vlasnica saznaju odmah; kolači iz vitrine se sklanjaju.
      await javiPorudzbineSaLotom(klijent, id, `Pokrenuto povlačenje ${broj}: ${razlog}`, korisnikId);
      await javiVitrinuSaLotom(klijent, id, `Pokrenuto povlačenje ${broj}: ${razlog}`, korisnikId);
    }

    // Kolači iz vitrine se prodaju kupcima bez imena (dopuna 42) — njih nema koga zvati, pa vlasnica mora znati koliko je
    // otišlo, da obavještenje stavi u radnju i na mreže.
    const vitrinaProdato = (
      await klijent.query<{ n: number }>(
        `select coalesce(sum(p.prodato), 0)::int as n from serija_vitrine_promet p
         where p.serija_id in (select sl.serija_id from serija_vitrine_lot sl where sl.lot_id = any($1))`,
        [serija],
      )
    ).rows[0].n;

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
    await obavijestiUlogu(klijent, "bzr", {
      naslov: "Pokrenuto povlačenje",
      poruka: `${broj} — ${brojKontakata} kupaca treba obavijestiti.${vitrinaProdato > 0 ? ` Iz vitrine je prodato ${vitrinaProdato} kom. kupcima bez imena — stavite obavještenje u radnji i na mrežama.` : ""}`,
      ozbiljnost: "VISOK",
      izvorTip: "povlacenje",
      izvorId: povlacenjeId,
    });

    await logKreiranje(klijent, { korisnikId, entitetTip: "povlacenje", entitetId: povlacenjeId, noveVrijednosti: { broj, lotId, razlog, lotovaUSeriji: serija.length } });

    return { id: povlacenjeId, broj, brojKontakata, lotovaUSeriji: serija.length, vitrinaProdato, neusaglasenostId: nc.rows[0].id };
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
