// Obavještenja u ateljeu, zadaci (automatski, dodjela, samozatvaranje), temperatura torte pri predaji (KKT 3, P3),
// zatvaranje neusaglašenosti do kraja. Briše sve što napravi.
import { pool, prijava, NALOZI, danasCG, glavnoSkladiste, rokZaDana } from "./pomoc.mjs";

export const naziv = "Obavještenja, zadaci, temperatura torte pri predaji";

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const marko = await prijava(NALOZI.marko);
  const idMarko = marko.id;
  const trag = { porudzbinaId: null, ncIds: [], zadatakIds: [], prijemId: null, lotIds: [], mjerenjeIds: [] };
  const brojObavj = async (k) => (await k("/obavjestenja")).tijelo;

  try {
    // ── 1. Torta sa dostavom: predaja bez temperature odbijena; sa 8,6 °C → FAIL, NC, zadatak ──
    const nova = await marko("/porudzbine", { telo: { kupacIme: "E2E-OBAVJ Kupac", kupacTelefon: "067 555 111", preuzimanjeDatum: danasCG(), preuzimanjeVrijeme: "23:00", nacin: "DOSTAVA", adresaDostave: "E2E ulica 1, Bar", opis: "E2E-OBAVJ torta" } });
    trag.porudzbinaId = nova.tijelo?.id;
    provjeri("Zaposleni upisuje tortu sa dostavom", nova.status === 201, `${nova.status} ${nova.tijelo?.error?.message ?? ""}`);
    const potvrda = await marko(`/porudzbine/${trag.porudzbinaId}/alergeni`, { telo: { alergeni: ["GLUTEN", "JAJA", "MLIJEKO"] } });
    provjeri("Alergeni potvrđeni prije predaje (P1)", potvrda.status === 200, `${potvrda.status} ${potvrda.tijelo?.error?.message ?? ""}`);
    const bezTemp = await marko(`/porudzbine/${trag.porudzbinaId}/predaja`, { telo: {} });
    provjeri("Dostava bez temperature se ne predaje (400)", bezTemp.status === 400 && bezTemp.tijelo.error.code === "TEMPERATURA_OBAVEZNA", bezTemp.tijelo?.error?.message);
    const sa = await marko(`/porudzbine/${trag.porudzbinaId}/predaja`, { telo: { temperatura: 8.6, preuzeoIme: "E2E kupac" } });
    provjeri("Predaja sa 8,6 °C prolazi (torta je kod kupca) i javlja FAIL po pravilu KKT 3", sa.status === 200 && sa.tijelo.status === "PREDATA" && sa.tijelo.rezultat === "FAIL", JSON.stringify(sa.tijelo));
    const mj = (await pool.query(`select m.id, m.rezultat, kt.sifra from porudzbina p join mjerenje_temperature m on m.id = p.mjerenje_id join kontrolna_tacka kt on kt.id = m.kontrolna_tacka_id where p.id = $1`, [trag.porudzbinaId])).rows;
    trag.mjerenjeIds = mj.map((m) => m.id);
    provjeri("Mjerenje na KKT3, FAIL, vezano za porudžbinu", mj.length === 1 && mj[0].sifra === "KKT3" && mj[0].rezultat === "FAIL");
    const nc = (await pool.query(`select id, broj, opis from neusaglasenost where id = $1`, [sa.tijelo.neusaglasenostId])).rows[0];
    trag.ncIds.push(nc?.id);
    provjeri("Otvorena neusaglašenost sa brojem porudžbine u opisu", nc && nc.opis.includes(nova.tijelo.broj), nc?.opis);
    provjeri("Vlasnica dobija obavještenje o temperaturi", (await brojObavj(ana)).some((o) => o.izvor_id === nc.id));

    // ── 2. Zadaci: vlasnica vidi nedodijeljen, sa izvorom; dodjeljuje zaposlenom ──
    const anaMoji = (await ana("/zadaci?moji=1")).tijelo;
    const zadatak = anaMoji.find((z) => z.izvor_id === nc.id);
    trag.zadatakIds.push(zadatak?.id);
    provjeri("Vlasnica u 'Moji zadaci' vidi nedodijeljen automatski zadatak", zadatak && zadatak.dodijeljeno_korisnik_id === null, zadatak?.naslov);
    provjeri("Zadatak nosi oznaku izvora (broj NC)", zadatak?.izvor_oznaka === nc.broj, zadatak?.izvor_oznaka);
    provjeri("Zaposleni NE vidi nedodijeljen zadatak", !(await marko("/zadaci?moji=1")).tijelo.some((z) => z.id === zadatak.id));
    provjeri("Zaposleni ne vidi ni sve zadatke bez ?moji", !(await marko("/zadaci")).tijelo.some((z) => z.id === zadatak.id));
    const sebi = await marko(`/zadaci/${zadatak.id}`, { method: "PATCH", telo: { dodijeljenoKorisnikId: idMarko } });
    provjeri("Zaposleni ne može dodjeljivati zadatke (403)", sebi.status === 403);
    const dodjela = await ana(`/zadaci/${zadatak.id}`, { method: "PATCH", telo: { dodijeljenoKorisnikId: idMarko } });
    provjeri("Vlasnica dodjeljuje zadatak Marku", dodjela.status === 204);
    const obavjMarko = await brojObavj(marko);
    provjeri("Marko dobija obavještenje o zadatku", obavjMarko.some((o) => o.izvor_id === zadatak.id), obavjMarko[0]?.naslov);
    provjeri("Marko sad vidi zadatak u 'Moji zadaci'", (await marko("/zadaci?moji=1")).tijelo.some((z) => z.id === zadatak.id));
    const markoStatus = await marko(`/zadaci/${zadatak.id}`, { method: "PATCH", telo: { status: "U_TOKU" } });
    provjeri("Marko mijenja status svog zadatka (U_TOKU)", markoStatus.status === 204, `${markoStatus.status} ${JSON.stringify(markoStatus.tijelo)}`);

    // ── 3. Korektivna mjera Marku → obavještenje; zatvaranje NC → zadatak se zatvara sam ──
    const mjera = await ana(`/neusaglasenosti/${nc.id}/korektivna-mjera`, { telo: { opis: "E2E: dostava u rashladnoj torbi, kraći put", dodijeljenoKorisnikId: idMarko } });
    provjeri("Vlasnica dodaje korektivnu mjeru Marku", mjera.status === 201);
    provjeri("Marko dobija obavještenje o korektivnoj mjeri", (await brojObavj(marko))[0]?.naslov.includes(nc.broj), (await brojObavj(marko))[0]?.naslov);
    provjeri("Marko završava mjeru", (await marko(`/korektivne-mjere/${mjera.tijelo.id}/zavrsi`, { telo: { rezultat: "Kupljena rashladna torba" } })).status === 200);
    // P3: torta je kod kupca — ponovno mjerenje ne postoji, pa se ne traži (stoFaliZaZatvaranje).
    const ver = await ana(`/neusaglasenosti/${nc.id}/verifikacija`, { telo: { korektivnaMjeraId: mjera.tijelo.id, rezultat: "POTVRDJENO", napomena: "Torba provjerena." } });
    provjeri("Vlasnica verifikuje bez ponovnog mjerenja → NC zatvorena", ver.status === 200 && ver.tijelo.status === "ZATVORENA", `${ver.status} ${JSON.stringify(ver.tijelo)}`);
    const zStatus = (await pool.query(`select status from zadatak where id = $1`, [zadatak.id])).rows[0].status;
    provjeri("Zadatak se zatvorio sam", zStatus === "ZAVRSEN", zStatus);
    provjeri("Marko (predao tortu) saznaje da je NC zatvorena", (await brojObavj(marko)).some((o) => o.izvor_id === nc.id && o.naslov.includes("zatvorena")));

    // ── 5. Prijem: HOLD jednog lota → Marko obaviješten; cio prijem riješen → sažetak ──
    const artikli = (await ana("/artikli")).tijelo;
    const dob = (await ana("/dobavljaci")).tijelo[0];
    const brasno = artikli.find((a) => !a.temp_kontrolisano) ?? artikli[0];
    const pr = await marko("/prijem", { telo: { dobavljacId: dob.id, brojDokumenta: "E2E-TEST", datumPrijema: danasCG(), skladisteId: await glavnoSkladiste(marko), stavke: [
      { artikalId: brasno.id, brojLota: "E2E-A", primljenaKolicina: 5, rokTrajanja: rokZaDana(3) },
      { artikalId: brasno.id, brojLota: "E2E-B", primljenaKolicina: 3, rokTrajanja: rokZaDana(3) },
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
      const ids = [trag.porudzbinaId, trag.prijemId, ...trag.ncIds, ...trag.zadatakIds, ...trag.lotIds, ...trag.mjerenjeIds].filter(Boolean);
      const ncIds = trag.ncIds.filter(Boolean);
      const mjere = ncIds.length ? (await k.query(`select id from korektivna_mjera where neusaglasenost_id = any($1)`, [ncIds])).rows.map((r) => r.id) : [];
      const sve = [...ids, ...mjere];
      await k.query(`delete from obavjestenje where izvor_id = any($1)`, [sve]);
      await k.query(`delete from audit_log where entitet_id = any($1)`, [sve]);
      if (ncIds.length) {
        await k.query(`delete from verifikacija where neusaglasenost_id = any($1)`, [ncIds]);
        await k.query(`delete from korektivna_mjera where neusaglasenost_id = any($1)`, [ncIds]);
        await k.query(`delete from zadatak where izvor_id = any($1)`, [ncIds]);
        await k.query(`delete from neusaglasenost where id = any($1)`, [ncIds]);
      }
      if (trag.porudzbinaId) {
        await k.query(`delete from porudzbina_lot where porudzbina_id = $1`, [trag.porudzbinaId]);
        await k.query(`delete from porudzbina where id = $1`, [trag.porudzbinaId]);
      }
      if (trag.mjerenjeIds.length) await k.query(`delete from mjerenje_temperature where id = any($1)`, [trag.mjerenjeIds]);
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
