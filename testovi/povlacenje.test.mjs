// Povlačenje (čl. 28) od početka do zatvaranja: spisak kupaca iz stvarnih isporuka, lot odmah
// blokiran za dalju isporuku, ne zatvara se dok svi nisu obaviješteni, zadatak se zatvara sam.
// Briše sve što napravi i vraća lot i zalihu u stanje od prije.
import { pool, prijava, NALOZI, danasCG, nijeIstekao, rashladnoVozilo, d1Prolazi, slobodno } from "./pomoc.mjs";

export const naziv = "Povlačenje od početka do zatvaranja";

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const marko = await prijava(NALOZI.marko);
  const trag = { isporuke: [], povlacenjeId: null, ncId: null, kontakti: [], lotId: null, lotStatusPrije: null, zalihaPrije: [], mjerenja: [], kontrole: [], vozilo: null };

  try {
    const lot = (await ana("/lotovi?status=PRIHVACEN")).tijelo.find((l) => slobodno(l) >= 2 && nijeIstekao(l));
    if (!lot) throw new Error("U demo bazi nema prihvaćenog lota sa bar 2 komada na zalihi.");
    trag.lotId = lot.id;
    trag.lotStatusPrije = lot.status;
    trag.zalihaPrije = (await pool.query(`select id, status, kolicina from zaliha where lot_id = $1`, [lot.id])).rows;
    const kupac = (await ana("/kupci")).tijelo[0];
    // Demo lotovi su roba pod režimom — idu rashladnim vozilom, uz današnju D1.
    const vozilo = await rashladnoVozilo(ana);
    if (vozilo) {
      trag.vozilo = { id: vozilo.id, status: vozilo.status };
      trag.kontrole.push(await d1Prolazi(ana, vozilo));
    }

    // Isporuka jednog komada — da povlačenje ima kome da zove.
    const isp = await ana("/isporuke", { telo: { kupacId: kupac.id, vozilId: vozilo?.id, skladisteId: lot.skladiste_id ?? undefined, datumIsporuke: danasCG(), napomena: "E2E-POVLACENJE", stavke: [{ lotId: lot.id, planiranaKolicina: 1 }] } });
    trag.isporuke.push(isp.tijelo?.id);
    provjeri("Isporuka iz lota", isp.status === 201, `${isp.status}`);
    const detalj = (await ana(`/isporuke/${isp.tijelo.id}`)).tijelo;
    const s = detalj.stavke[0];
    const temperatura = s.temp_kontrolisano ? { temperaturaPredaje: s.temp_min !== null ? Number(s.temp_min) + 1 : 2 } : {};
    const potvrda = await ana(`/isporuke/${isp.tijelo.id}/potvrda`, { telo: { stavke: [{ stavkaId: s.id, isporucenaKolicina: 1, ...temperatura }] } });
    provjeri("Isporuka potvrđena", potvrda.status === 200, JSON.stringify(potvrda.tijelo));
    trag.mjerenja = (await pool.query(`select id from mjerenje_temperature where napomena = $1`, [`Pri predaji kupcu — ${detalj.broj}`])).rows.map((r) => r.id);

    provjeri("Magacioner ne može pokrenuti povlačenje (403)", (await marko(`/sledljivost/lot/${lot.id}/povlacenje`, { telo: { razlog: "E2E" } })).status === 403);
    const pv = await ana(`/sledljivost/lot/${lot.id}/povlacenje`, { telo: { razlog: "E2E: sumnja na listeriju" } });
    trag.povlacenjeId = pv.tijelo?.id;
    trag.ncId = pv.tijelo?.neusaglasenostId;
    provjeri("Ana pokreće povlačenje", pv.status === 201 && pv.tijelo.brojKontakata >= 1, JSON.stringify(pv.tijelo));

    const d = (await ana(`/povlacenja/${trag.povlacenjeId}`)).tijelo;
    trag.kontakti = d.kontakti.map((k) => k.id);
    const nas = d.kontakti.find((k) => k.isporuka_id === isp.tijelo.id);
    provjeri("Spisak kupaca izvučen iz isporuka, sa telefonom i količinom", nas && nas.kupac_telefon && Number(nas.kolicina) === 1, nas?.kupac_naziv);

    const lotPosle = (await pool.query(`select status from lot where id = $1`, [lot.id])).rows[0].status;
    const dostupno = (await pool.query(`select coalesce(sum(kolicina), 0) as n from zaliha where lot_id = $1 and status = 'DOSTUPNO'`, [lot.id])).rows[0].n;
    provjeri("Lot pod povlačenjem je na HOLD-u, zaliha u karantinu", lotPosle === "HOLD" && Number(dostupno) === 0, `${lotPosle}, dostupno ${dostupno}`);
    const druga = await ana("/isporuke", { telo: { kupacId: kupac.id, vozilId: vozilo?.id, skladisteId: lot.skladiste_id ?? undefined, datumIsporuke: danasCG(), stavke: [{ lotId: lot.id, planiranaKolicina: 1 }] } });
    if (druga.status === 201) trag.isporuke.push(druga.tijelo.id);
    provjeri("Lot pod povlačenjem se više ne može isporučiti (409)", druga.status === 409, druga.tijelo?.error?.message);

    provjeri("Zadatak 'Obavijesti sve kupce' je kod Ane", (await ana("/zadaci?moji=1")).tijelo.some((z) => z.izvor_id === trag.povlacenjeId));
    provjeri("Ana dobija obavještenje o povlačenju", (await ana("/obavjestenja")).tijelo.some((o) => o.izvor_id === trag.povlacenjeId));

    const rano = await ana(`/povlacenja/${trag.povlacenjeId}/zavrsi`, { method: "PATCH" });
    provjeri("Ne zatvara se dok svi kupci nisu obaviješteni (409)", rano.status === 409, rano.tijelo?.error?.message);
    for (const k of d.kontakti) await ana(`/povlacenja/${trag.povlacenjeId}/kontakt/${k.id}`, { method: "PATCH", telo: { napomena: "E2E pozvan" } });
    const kraj = await ana(`/povlacenja/${trag.povlacenjeId}/zavrsi`, { method: "PATCH" });
    provjeri("Kad su svi obaviješteni — povlačenje se zatvara", kraj.status === 204, `${kraj.status} ${JSON.stringify(kraj.tijelo)}`);
    const status = (await pool.query(`select status from povlacenje where id = $1`, [trag.povlacenjeId])).rows[0].status;
    provjeri("Povlačenje ima status ZAVRSENO", status === "ZAVRSENO", status);
    const zadaci = (await pool.query(`select status from zadatak where izvor_id = $1`, [trag.povlacenjeId])).rows.map((r) => r.status);
    provjeri("Zadatak povlačenja se zatvorio sam", zadaci.length > 0 && zadaci.every((st) => st === "ZAVRSEN"), zadaci.join(","));
  } finally {
    const k = await pool.connect();
    try {
      await k.query("begin");
      const isporuke = trag.isporuke.filter(Boolean);
      const stavke = isporuke.length ? (await k.query(`select id from isporuka_stavka where isporuka_id = any($1)`, [isporuke])).rows.map((r) => r.id) : [];
      const sve = [...isporuke, ...stavke, trag.povlacenjeId, trag.ncId, ...trag.kontakti, ...trag.mjerenja].filter(Boolean);
      await k.query(`delete from obavjestenje where izvor_id = any($1)`, [sve]);
      // „Ne predajte lot" ide i na TUĐE isporuke u pripremi sa istim lotom (demo baza ih ima) —
      // vezano je za njihov id, pa se briše po tekstu ovog testa.
      await k.query(`delete from obavjestenje where izvor_tip = 'isporuka' and naslov like 'Ne predajte lot%' and poruka like 'Pokrenuto povlačenje %: E2E%'`);
      await k.query(`delete from audit_log where entitet_id = any($1)`, [sve]);
      await k.query(`delete from dogadjaj where entitet_id = any($1)`, [sve]);
      await k.query(`delete from kretanje_zalihe where referenca_id = any($1)`, [sve]);
      if (trag.povlacenjeId) {
        await k.query(`delete from zadatak where izvor_id = $1`, [trag.povlacenjeId]);
        await k.query(`delete from povlacenje_kontakt where povlacenje_id = $1`, [trag.povlacenjeId]);
      }
      if (trag.ncId) await k.query(`delete from neusaglasenost where id = $1`, [trag.ncId]);
      if (trag.povlacenjeId) await k.query(`delete from povlacenje where id = $1`, [trag.povlacenjeId]);
      if (trag.mjerenja.length) await k.query(`delete from mjerenje_temperature where id = any($1)`, [trag.mjerenja]);
      if (isporuke.length) {
        await k.query(`delete from isporuka_stavka where isporuka_id = any($1)`, [isporuke]);
        await k.query(`delete from isporuka where id = any($1)`, [isporuke]);
      }
      if (trag.kontrole.length) {
        await k.query(`delete from audit_log where entitet_id = any($1)`, [trag.kontrole]);
        await k.query(`delete from kontrola_vozila where id = any($1)`, [trag.kontrole]);
      }
      if (trag.vozilo) await k.query(`update vozilo set status = $1 where id = $2`, [trag.vozilo.status, trag.vozilo.id]);
      if (trag.lotId) {
        await k.query(`update lot set status = $1 where id = $2`, [trag.lotStatusPrije, trag.lotId]);
        await k.query(`delete from zaliha where lot_id = $1 and not (id = any($2))`, [trag.lotId, trag.zalihaPrije.map((z) => z.id)]);
        for (const z of trag.zalihaPrije) await k.query(`update zaliha set status = $1, kolicina = $2 where id = $3`, [z.status, z.kolicina, z.id]);
      }
      await k.query("commit");
    } catch (e) {
      await k.query("rollback");
      throw new Error(`Čišćenje nije uspjelo: ${e.message} ${JSON.stringify(trag)}`);
    } finally {
      k.release();
    }
  }
}
