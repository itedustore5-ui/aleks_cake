// Neusaglašenost sa terena do kraja: vozač prijavi problem na isporuci → odgovorno lice dobija
// zadatak i obavještenje → mjeru dodijeli vozaču → samo on je završava, uz opis → odgovorno lice
// provjeri i zatvori. Uz to: uprava dobija samo važne stvari, a sve vidi u "Aktivnosti uživo".
import { pool, prijava, NALOZI, danasCG, nijeIstekao, rashladnoVozilo, slobodno } from "./pomoc.mjs";

export const naziv = "Neusaglašenost sa terena do kraja";

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const petar = await prijava(NALOZI.petar);
  const marko = await prijava(NALOZI.marko);
  const direktor = await prijava(NALOZI.direktor);
  const trag = { isporukaId: null, ncIds: [] };
  const obavj = async (k) => (await k("/obavjestenja")).tijelo;

  try {
    const kupac = (await ana("/kupci")).tijelo[0];
    const lot = (await ana("/lotovi?status=PRIHVACEN")).tijelo.find((l) => slobodno(l) >= 1 && nijeIstekao(l));
    const vozilo = await rashladnoVozilo(ana);
    const isp = await ana("/isporuke", { telo: { kupacId: kupac.id, vozilId: vozilo?.id, vozacKorisnikId: petar.id, skladisteId: lot.skladiste_id ?? undefined, datumIsporuke: danasCG(), napomena: "E2E-NC", stavke: [{ lotId: lot.id, planiranaKolicina: 1 }] } });
    trag.isporukaId = isp.tijelo?.id;

    // 1. Vozač prijavljuje problem na isporuci
    const nc = await petar("/neusaglasenosti", { telo: { opis: "Oštećena roba ili ambalaža: E2E kutija probijena", ozbiljnost: "SREDNJI", izvorTip: "isporuka", izvorId: trag.isporukaId } });
    trag.ncIds.push(nc.tijelo?.id);
    provjeri("Vozač prijavljuje problem na isporuci", nc.status === 201, `${nc.status} ${nc.tijelo?.broj ?? nc.tijelo?.error?.message}`);
    const lista = (await ana("/neusaglasenosti")).tijelo.find((n) => n.id === nc.tijelo.id);
    provjeri("Na listi piše sa koje je isporuke i ko je prijavio", lista?.izvor_oznaka?.startsWith("Isporuka ISP-") && lista?.prijavio === "Petar Jovanović", `${lista?.izvor_oznaka} · ${lista?.prijavio}`);
    provjeri("Isporuka nosi oznaku otvorenog odstupanja", (await ana("/isporuke")).tijelo.find((i) => i.id === trag.isporukaId)?.otvorena_odstupanja === 1);
    provjeri("Odgovorno lice dobija obavještenje", (await obavj(ana)).some((o) => o.izvor_id === nc.tijelo.id));
    provjeri("…i nedodijeljen zadatak", (await ana("/zadaci?moji=1")).tijelo.some((z) => z.izvor_id === nc.tijelo.id && !z.dodijeljeno_korisnik_id));
    provjeri("Srednja ozbiljnost ne ide upravi", !(await obavj(direktor)).some((o) => o.izvor_id === nc.tijelo.id));

    // 2. Mjera vozaču
    const mjera = await ana(`/neusaglasenosti/${nc.tijelo.id}/korektivna-mjera`, { telo: { opis: "E2E: zamijeniti robu kupcu i zapisati", dodijeljenoKorisnikId: petar.id, rok: danasCG() } });
    provjeri("Ana dodjeljuje mjeru vozaču sa rokom", mjera.status === 201);
    provjeri("Vozač vidi 'mjera za vas'", (await petar("/neusaglasenosti")).tijelo.find((n) => n.id === nc.tijelo.id)?.mjera_za_mene === true);
    const tudja = await marko(`/korektivne-mjere/${mjera.tijelo.id}/zavrsi`, { telo: { rezultat: "E2E tuđa" } });
    provjeri("Magacioner ne može završiti vozačevu mjeru (403)", tudja.status === 403, tudja.tijelo?.error?.code);
    const prazno = await petar(`/korektivne-mjere/${mjera.tijelo.id}/zavrsi`, { telo: {} });
    provjeri("Bez opisa šta je urađeno — odbijeno (400)", prazno.status === 400 && prazno.tijelo.error.code === "REZULTAT_OBAVEZAN");
    const gotovo = await petar(`/korektivne-mjere/${mjera.tijelo.id}/zavrsi`, { telo: { rezultat: "Roba zamijenjena, kupac potpisao" } });
    provjeri("Vozač završava svoju mjeru", gotovo.status === 200);
    provjeri("Ana dobija 'čeka vašu provjeru'", (await obavj(ana)).some((o) => o.izvor_id === nc.tijelo.id && o.naslov.includes("čeka vašu provjeru")));
    const detalj = (await petar(`/neusaglasenosti/${nc.tijelo.id}`)).tijelo;
    provjeri("Detalj: ko je dobio mjeru, ko ju je uradio i šta", detalj.korektivneMjere[0]?.dodijeljeno === "Petar Jovanović" && detalj.korektivneMjere[0]?.rezultat === "Roba zamijenjena, kupac potpisao");

    // 3. Provjera i zatvaranje
    const ver = await ana(`/neusaglasenosti/${nc.tijelo.id}/verifikacija`, { telo: { korektivnaMjeraId: mjera.tijelo.id, rezultat: "POTVRDJENO", napomena: "E2E pregledano" } });
    provjeri("Ana provjerava i zatvara", ver.status === 200 && ver.tijelo.status === "ZATVORENA");
    const zad = (await pool.query(`select status from zadatak where izvor_id = $1`, [nc.tijelo.id])).rows.map((r) => r.status);
    provjeri("Zadatak se zatvorio sam", zad.length > 0 && zad.every((s) => s === "ZAVRSEN"));
    provjeri("Vozač (prijavio) saznaje da je zatvoreno", (await obavj(petar)).some((o) => o.izvor_id === nc.tijelo.id && o.naslov.includes("zatvorena")));

    // 4. Visoka ozbiljnost ide i upravi; sve se vidi u aktivnosti
    const visoka = await marko("/neusaglasenosti", { telo: { opis: "E2E: komora 2 pokazuje 11 °C", ozbiljnost: "VISOK" } });
    trag.ncIds.push(visoka.tijelo?.id);
    provjeri("Visoka ozbiljnost — obavještenje stiže i upravi", (await obavj(direktor)).some((o) => o.izvor_id === visoka.tijelo.id));
    const aktivnost = await direktor("/aktivnost");
    provjeri("Uprava vidi aktivnost uživo, sa imenom", aktivnost.status === 200 && aktivnost.tijelo.some((a) => a.opis.includes("komora 2 pokazuje 11") && a.ko === "Marko Vuković" && a.tezina === "problem"));
    provjeri("Magacioner ne vidi aktivnost cijele firme (403)", (await marko("/aktivnost")).status === 403);
  } finally {
    const k = await pool.connect();
    try {
      await k.query("begin");
      const ncIds = trag.ncIds.filter(Boolean);
      const mjere = ncIds.length ? (await k.query(`select id from korektivna_mjera where neusaglasenost_id = any($1)`, [ncIds])).rows.map((r) => r.id) : [];
      const stavke = trag.isporukaId ? (await k.query(`select id from isporuka_stavka where isporuka_id = $1`, [trag.isporukaId])).rows.map((r) => r.id) : [];
      const sve = [...ncIds, ...mjere, ...stavke, trag.isporukaId].filter(Boolean);
      await k.query(`delete from obavjestenje where izvor_id = any($1)`, [sve]);
      await k.query(`delete from audit_log where entitet_id = any($1)`, [sve]);
      await k.query(`delete from dogadjaj where entitet_id = any($1)`, [sve]);
      if (ncIds.length) {
        await k.query(`delete from zadatak where izvor_id = any($1)`, [ncIds]);
        await k.query(`delete from verifikacija where neusaglasenost_id = any($1)`, [ncIds]);
        await k.query(`delete from korektivna_mjera where neusaglasenost_id = any($1)`, [ncIds]);
        await k.query(`delete from neusaglasenost where id = any($1)`, [ncIds]);
      }
      if (trag.isporukaId) {
        await k.query(`delete from isporuka_stavka where isporuka_id = $1`, [trag.isporukaId]);
        await k.query(`delete from isporuka where id = $1`, [trag.isporukaId]);
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
