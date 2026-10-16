// Obavještenja za teren, zadaci (automatski, dodjela, samozatvaranje), temperatura pri predaji (KKT 3),
// zatvaranje neusaglašenosti do kraja. Briše sve što napravi i vraća zalihu.
import { pool, prijava, NALOZI, danasCG, glavnoSkladiste, nijeIstekao, rashladnoVozilo, d1Prolazi, rokZaDana, slobodno } from "./pomoc.mjs";

export const naziv = "Obavještenja, zadaci, temperatura pri predaji";

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const petar = await prijava(NALOZI.petar);
  const marko = await prijava(NALOZI.marko);
  const idPetar = petar.id, idMarko = marko.id;
  const trag = { isporukaId: null, ncIds: [], zadatakIds: [], prijemId: null, lotIds: [], mjerenjeIds: [], zalihaPrije: null, lotIsporuke: null, kontrole: [], vozilo: null };
  const brojObavj = async (k) => (await k("/obavjestenja")).tijelo;

  try {
    // ── 1. Isporuka dodijeljena vozaču → obavještenje ──
    const kupac = (await ana("/kupci")).tijelo[0];
    // Jogurt/mlijeko idu samo rashladnim vozilom (R-05).
    const vozilo = await rashladnoVozilo(ana);
    if (vozilo) trag.vozilo = { id: vozilo.id, status: vozilo.status };
    // D1 prije utovara — predaja bez današnje kontrole vozila se ne potvrđuje.
    const d1 = async () => {
      const id = await d1Prolazi(petar, vozilo);
      trag.kontrole.push(id);
      return { status: id ? 201 : 500 };
    };
    const lot = (await ana("/lotovi?status=PRIHVACEN")).tijelo.find((l) => /Jogurt|Mlijeko/.test(l.artikal_naziv) && slobodno(l) >= 1 && nijeIstekao(l));
    trag.lotIsporuke = lot.id;
    trag.zalihaPrije = (await pool.query(`select id, kolicina from zaliha where lot_id = $1 and status = 'DOSTUPNO'`, [lot.id])).rows[0];
    const obavjPetarPrije = (await brojObavj(petar)).length;
    const nova = await ana("/isporuke", { telo: { kupacId: kupac.id, vozilId: vozilo?.id, vozacKorisnikId: idPetar, skladisteId: lot.skladiste_id ?? undefined, datumIsporuke: danasCG(), napomena: "E2E-TEST", stavke: [{ lotId: lot.id, planiranaKolicina: 1 }] } });
    trag.isporukaId = nova.tijelo?.id;
    provjeri("Ana pravi isporuku sa vozačem Petrom", nova.status === 201, `status ${nova.status}`);
    const obavjPetar = await brojObavj(petar);
    const zaIsporuku = obavjPetar.find((o) => o.izvor_id === trag.isporukaId);
    provjeri("Petar dobija obavještenje o isporuci", !!zaIsporuku, zaIsporuku?.naslov + " | " + zaIsporuku?.poruka);

    // ── 2. Potvrda bez temperature → odbijena; sa 8.6 °C → FAIL, NC, zadatak, lot NIJE na HOLD-u ──
    provjeri("Vozač radi D1 prije utovara", (await d1()).status === 201);
    const detalj = (await petar(`/isporuke/${trag.isporukaId}`)).tijelo;
    const stavka = detalj.stavke[0];
    provjeri("Detalj isporuke nosi temp. granicu artikla", stavka.temp_kontrolisano === true && stavka.temp_max !== undefined, `${stavka.artikal_naziv} ${stavka.temp_min}–${stavka.temp_max}, potvrđena=${stavka.granica_potvrdio}`);
    const bezTemp = await petar(`/isporuke/${trag.isporukaId}/potvrda`, { telo: { stavke: [{ stavkaId: stavka.id, isporucenaKolicina: 1 }] } });
    provjeri("Potvrda bez temperature se odbija (400)", bezTemp.status === 400 && bezTemp.tijelo.error.code === "TEMPERATURA_OBAVEZNA", bezTemp.tijelo?.error?.message);
    const obavjAnaPrije = (await brojObavj(ana)).length;
    const sa = await petar(`/isporuke/${trag.isporukaId}/potvrda`, { telo: { stavke: [{ stavkaId: stavka.id, isporucenaKolicina: 1, temperaturaPredaje: 8.6 }] } });
    provjeri("Potvrda sa 8.6 °C prolazi i javlja 1 van granice", sa.status === 200 && sa.tijelo.vanGranice === 1, JSON.stringify(sa.tijelo));
    const temp = (await pool.query(`select temperatura_predaje from isporuka_stavka where id = $1`, [stavka.id])).rows[0];
    provjeri("Temperatura sačuvana na stavci", Number(temp.temperatura_predaje) === 8.6);
    const mj = (await pool.query(`select m.id, m.rezultat, m.vozilo_id, kt.sifra from mjerenje_temperature m join kontrolna_tacka kt on kt.id = m.kontrolna_tacka_id where m.napomena like $1`, [`%${detalj.broj}%`])).rows;
    trag.mjerenjeIds = mj.map((m) => m.id);
    provjeri("Mjerenje na KKT3, FAIL, vezano za vozilo", mj.length === 1 && mj[0].sifra === "KKT3" && mj[0].rezultat === "FAIL" && (mj[0].vozilo_id === (vozilo?.id ?? null)));
    const lotStatus = (await pool.query(`select status from lot where id = $1`, [lot.id])).rows[0].status;
    provjeri("Lot u magacinu NIJE stavljen na HOLD", lotStatus === "PRIHVACEN", lotStatus);
    const nc = (await pool.query(`select id, broj, opis, prijavio_korisnik_id from neusaglasenost where izvor_id = $1`, [mj[0]?.id])).rows[0];
    trag.ncIds.push(nc.id);
    provjeri("Otvorena neusaglašenost sa brojem isporuke u opisu", nc && nc.opis.includes(detalj.broj), nc?.opis);
    provjeri("Ana dobija obavještenje o temperaturi", (await brojObavj(ana)).some((o) => o.izvor_id === nc.id));

    // ── 3. Zadaci: Ana vidi nedodijeljen, sa izvorom; dodjeljuje Marku ──
    const anaMoji = (await ana("/zadaci?moji=1")).tijelo;
    const zadatak = anaMoji.find((z) => z.izvor_id === nc.id);
    trag.zadatakIds.push(zadatak?.id);
    provjeri("Ana u 'Moji zadaci' vidi nedodijeljen automatski zadatak", zadatak && zadatak.dodijeljeno_korisnik_id === null, zadatak?.naslov);
    provjeri("Zadatak nosi oznaku izvora (broj NC)", zadatak?.izvor_oznaka === nc.broj, zadatak?.izvor_oznaka);
    provjeri("Marko NE vidi nedodijeljen zadatak", !(await marko("/zadaci?moji=1")).tijelo.some((z) => z.id === zadatak.id));
    provjeri("Marko ne vidi ni sve zadatke bez ?moji", !(await marko("/zadaci")).tijelo.some((z) => z.id === zadatak.id));
    const petarDodjela = await petar(`/zadaci/${zadatak.id}`, { method: "PATCH", telo: { dodijeljenoKorisnikId: idPetar } });
    provjeri("Vozač ne može dodjeljivati zadatke (403)", petarDodjela.status === 403);
    const obavjMarkoPrije = (await brojObavj(marko)).length;
    const dodjela = await ana(`/zadaci/${zadatak.id}`, { method: "PATCH", telo: { dodijeljenoKorisnikId: idMarko } });
    provjeri("Ana dodjeljuje zadatak Marku", dodjela.status === 204);
    const obavjMarko = await brojObavj(marko);
    provjeri("Marko dobija obavještenje o zadatku", obavjMarko.some((o) => o.izvor_id === zadatak.id), obavjMarko[0]?.naslov);
    provjeri("Marko sad vidi zadatak u 'Moji zadaci'", (await marko("/zadaci?moji=1")).tijelo.some((z) => z.id === zadatak.id));
    provjeri("Petar ne može zatvoriti Markov zadatak (403)", (await petar(`/zadaci/${zadatak.id}`, { method: "PATCH", telo: { status: "ZAVRSEN" } })).status === 403);

    const markoStatus = await marko(`/zadaci/${zadatak.id}`, { method: "PATCH", telo: { status: "U_TOKU" } });
    provjeri("Marko mijenja status svog zadatka (U_TOKU)", markoStatus.status === 204, `${markoStatus.status} ${JSON.stringify(markoStatus.tijelo)}`);

    // ── 4. Korektivna mjera Marku → obavještenje; zatvaranje NC → zadatak se zatvara sam, Petar obaviješten ──
    const mjera = await ana(`/neusaglasenosti/${nc.id}/korektivna-mjera`, { telo: { opis: "E2E: provjeriti rashladni uređaj vozila", dodijeljenoKorisnikId: idMarko } });
    provjeri("Ana dodaje korektivnu mjeru Marku", mjera.status === 201);
    provjeri("Marko dobija obavještenje o korektivnoj mjeri", (await brojObavj(marko))[0]?.naslov.includes(nc.broj), (await brojObavj(marko))[0]?.naslov);
    provjeri("Marko završava mjeru", (await marko(`/korektivne-mjere/${mjera.tijelo.id}/zavrsi`, { telo: { rezultat: "Urađeno" } })).status === 200);
    const obavjPetarPrijeZ = (await brojObavj(petar)).length;
    // Temperatura van granice u vozilu: zatvara se tek kad vozilo prođe NOVU kontrolu (R-22).
    const bezD1 = await ana(`/neusaglasenosti/${nc.id}/verifikacija`, { telo: { rezultat: "POTVRDJENO", napomena: "Uređaj popravljen." } });
    provjeri("Zatvaranje bez nove D1 vozila se odbija (409)", bezD1.status === 409 && bezD1.tijelo.error.code === "PONOVNA_KONTROLA_POTREBNA", bezD1.tijelo?.error?.message);
    await d1();
    const ver = await ana(`/neusaglasenosti/${nc.id}/verifikacija`, { telo: { korektivnaMjeraId: mjera.tijelo.id, rezultat: "POTVRDJENO", napomena: "Uređaj popravljen." } });
    provjeri("Ana verifikuje → NC zatvorena", ver.status === 200 && ver.tijelo.status === "ZATVORENA", `${ver.status} ${JSON.stringify(ver.tijelo)}`);
    const zStatus = (await pool.query(`select status from zadatak where id = $1`, [zadatak.id])).rows[0].status;
    provjeri("Zadatak se zatvorio sam", zStatus === "ZAVRSEN", zStatus);
    const pObavj = await brojObavj(petar);
    provjeri("Petar (prijavio) saznaje da je NC zatvorena", pObavj.some((o) => o.izvor_id === nc.id && o.naslov.includes("zatvorena")), pObavj[0]?.naslov);

    // ── 5. Prijem: HOLD jednog lota → Marko obaviješten; cio prijem riješen → sažetak ──
    const artikli = (await ana("/artikli")).tijelo;
    const dob = (await ana("/dobavljaci")).tijelo[0];
    const hljeb = artikli.find((a) => !a.temp_kontrolisano) ?? artikli[0];
    const pr = await marko("/prijem", { telo: { dobavljacId: dob.id, brojDokumenta: "E2E-TEST", datumPrijema: danasCG(), skladisteId: await glavnoSkladiste(marko), stavke: [
      { artikalId: hljeb.id, brojLota: "E2E-A", primljenaKolicina: 5, rokTrajanja: rokZaDana(3) },
      { artikalId: hljeb.id, brojLota: "E2E-B", primljenaKolicina: 3, rokTrajanja: rokZaDana(3) },
    ] } });
    trag.prijemId = pr.tijelo?.id;
    provjeri("Marko upisuje prijem sa 2 stavke", pr.status === 201);
    trag.lotIds = (await pool.query(`select id, broj_lota from lot where prijem_id = $1 order by broj_lota`, [trag.prijemId])).rows.map((r) => r.id);
    const mPrije = (await brojObavj(marko)).length;
    await ana(`/prijem/${trag.prijemId}/lot/${trag.lotIds[0]}/odluka`, { method: "PATCH", telo: { odluka: "HOLD", kolicina: 5, napomena: "oštećena ambalaža" } });
    const m1 = await brojObavj(marko);
    provjeri("Marko dobija 'Zadržano' odmah, prijem još nije riješen", m1.some((o) => o.izvor_id === trag.lotIds[0] && o.naslov.startsWith("Zadržano")) && !m1.some((o) => o.izvor_id === trag.prijemId), m1[0]?.naslov + " | " + m1[0]?.poruka);
    await ana(`/prijem/${trag.prijemId}/lot/${trag.lotIds[1]}/odluka`, { method: "PATCH", telo: { odluka: "PRIHVATI", kolicina: 3 } });
    const m2 = await brojObavj(marko);
    provjeri("Prihvatanje ne javlja pojedinačno, nego sažetak prijema", m2.some((o) => o.izvor_id === trag.prijemId && o.naslov.includes("odluka donesena")) && !m2.some((o) => o.izvor_id === trag.lotIds[1]), m2[0]?.naslov + " | " + m2[0]?.poruka);

    // ── 6. Pročitano + tabla ──
    provjeri("Označi sve kao pročitano", (await marko("/obavjestenja/procitano-sve", { method: "PATCH" })).status === 204 && (await brojObavj(marko)).every((o) => o.procitano_at));
    const tabla = (await ana("/tabla")).tijelo;
    provjeri("Tabla vraća broj otvorenih zadataka", typeof tabla.kriticno.zadaciOtvoreni === "number", `otvoreno ${tabla.kriticno.zadaciOtvoreni}`);
  } finally {
    // ── Čišćenje: samo redovi koje je ovaj test napravio ──
    const k = await pool.connect();
    try {
      await k.query("begin");
      const ids = [trag.isporukaId, trag.prijemId, ...trag.ncIds, ...trag.zadatakIds, ...trag.lotIds, ...trag.mjerenjeIds].filter(Boolean);
      const mjere = trag.ncIds.length ? (await k.query(`select id from korektivna_mjera where neusaglasenost_id = any($1)`, [trag.ncIds])).rows.map((r) => r.id) : [];
      const stavkeIsp = trag.isporukaId ? (await k.query(`select id from isporuka_stavka where isporuka_id = $1`, [trag.isporukaId])).rows.map((r) => r.id) : [];
      const sve = [...ids, ...mjere, ...stavkeIsp];
      await k.query(`delete from obavjestenje where izvor_id = any($1)`, [sve]);
      await k.query(`delete from audit_log where entitet_id = any($1)`, [sve]);
      await k.query(`delete from dogadjaj where entitet_id = any($1)`, [sve]);
      if (trag.ncIds.length) {
        await k.query(`delete from verifikacija where neusaglasenost_id = any($1)`, [trag.ncIds]);
        await k.query(`delete from korektivna_mjera where neusaglasenost_id = any($1)`, [trag.ncIds]);
        await k.query(`delete from zadatak where izvor_id = any($1)`, [trag.ncIds]);
        await k.query(`delete from neusaglasenost where id = any($1)`, [trag.ncIds]);
      }
      if (trag.mjerenjeIds.length) await k.query(`delete from mjerenje_temperature where id = any($1)`, [trag.mjerenjeIds]);
      if (trag.isporukaId) {
        await k.query(`delete from kretanje_zalihe where referenca_id = $1`, [trag.isporukaId]);
        await k.query(`delete from isporuka_stavka where isporuka_id = $1`, [trag.isporukaId]);
        await k.query(`delete from isporuka where id = $1`, [trag.isporukaId]);
      }
      if (trag.zalihaPrije) await k.query(`update zaliha set kolicina = $1 where id = $2`, [trag.zalihaPrije.kolicina, trag.zalihaPrije.id]);
      if (trag.kontrole.length) {
        await k.query(`delete from audit_log where entitet_id = any($1)`, [trag.kontrole]);
        await k.query(`delete from kontrola_vozila where id = any($1)`, [trag.kontrole]);
      }
      if (trag.vozilo) await k.query(`update vozilo set status = $1 where id = $2`, [trag.vozilo.status, trag.vozilo.id]);
      if (trag.prijemId) {
        await k.query(`delete from kretanje_zalihe where lot_id = any($1)`, [trag.lotIds]);
        await k.query(`delete from zaliha where lot_id = any($1)`, [trag.lotIds]);
        await k.query(`delete from prijem_stavka where prijem_id = $1`, [trag.prijemId]);
        await k.query(`delete from lot where prijem_id = $1`, [trag.prijemId]);
        await k.query(`delete from prijem where id = $1`, [trag.prijemId]);
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
