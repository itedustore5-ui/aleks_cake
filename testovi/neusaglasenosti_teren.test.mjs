// Neusaglašenost iz ateljea do kraja: zaposleni prijavi problem na porudžbini → vlasnica dobija zadatak i
// obavještenje → mjeru dodijeli zaposlenom → on je završava, uz opis → vlasnica provjeri i zatvori.
// Uz to: visoka ozbiljnost stiže vlasnici, a sve se vidi u „Aktivnosti uživo“ (zaposleni je ne vidi).
import { pool, prijava, NALOZI, danasCG } from "./pomoc.mjs";

export const naziv = "Neusaglašenost iz ateljea do kraja";

/** Današnja torta iz demo podataka (99_demo_atelje — u izradi, dostava). */
const DEMO_TORTA = "c0000000-0000-0000-0000-000000000002";

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const marko = await prijava(NALOZI.marko);
  const trag = { ncIds: [] };
  const obavj = async (k) => (await k("/obavjestenja")).tijelo;

  try {
    // 1. Zaposleni prijavljuje problem na porudžbini
    const nc = await marko("/neusaglasenosti", { telo: { opis: "E2E: krem se odvojio pri sastavljanju torte", ozbiljnost: "SREDNJI", izvorTip: "porudzbina", izvorId: DEMO_TORTA } });
    trag.ncIds.push(nc.tijelo?.id);
    provjeri("Zaposleni prijavljuje problem na porudžbini", nc.status === 201, `${nc.status} ${nc.tijelo?.broj ?? nc.tijelo?.error?.message}`);
    const lista = (await ana("/neusaglasenosti")).tijelo.find((n) => n.id === nc.tijelo.id);
    provjeri("Na listi piše sa koje je porudžbine i ko je prijavio", lista?.izvor_oznaka?.startsWith("Porudžbina PRD-") && lista?.prijavio === "Marko Vuković", `${lista?.izvor_oznaka} · ${lista?.prijavio}`);
    provjeri("Vlasnica dobija obavještenje", (await obavj(ana)).some((o) => o.izvor_id === nc.tijelo.id));
    provjeri("…i nedodijeljen zadatak", (await ana("/zadaci?moji=1")).tijelo.some((z) => z.izvor_id === nc.tijelo.id && !z.dodijeljeno_korisnik_id));

    // 2. Mjera zaposlenom
    const mjera = await ana(`/neusaglasenosti/${nc.tijelo.id}/korektivna-mjera`, { telo: { opis: "E2E: napraviti krem ponovo i zapisati temperaturu", dodijeljenoKorisnikId: marko.id, rok: danasCG() } });
    provjeri("Vlasnica dodjeljuje mjeru zaposlenom sa rokom", mjera.status === 201);
    provjeri("Zaposleni vidi 'mjera za vas'", (await marko("/neusaglasenosti")).tijelo.find((n) => n.id === nc.tijelo.id)?.mjera_za_mene === true);
    const prazno = await marko(`/korektivne-mjere/${mjera.tijelo.id}/zavrsi`, { telo: {} });
    provjeri("Bez opisa šta je urađeno — odbijeno (400)", prazno.status === 400 && prazno.tijelo.error.code === "REZULTAT_OBAVEZAN");
    const gotovo = await marko(`/korektivne-mjere/${mjera.tijelo.id}/zavrsi`, { telo: { rezultat: "Krem napravljen ponovo, 3,5 °C" } });
    provjeri("Zaposleni završava svoju mjeru", gotovo.status === 200);
    provjeri("Vlasnica dobija 'čeka vašu provjeru'", (await obavj(ana)).some((o) => o.izvor_id === nc.tijelo.id && o.naslov.includes("čeka vašu provjeru")));
    const detalj = (await marko(`/neusaglasenosti/${nc.tijelo.id}`)).tijelo;
    provjeri("Detalj: ko je dobio mjeru, ko ju je uradio i šta", detalj.korektivneMjere[0]?.dodijeljeno === "Marko Vuković" && detalj.korektivneMjere[0]?.rezultat === "Krem napravljen ponovo, 3,5 °C");

    // 3. Provjera i zatvaranje
    const ver = await ana(`/neusaglasenosti/${nc.tijelo.id}/verifikacija`, { telo: { korektivnaMjeraId: mjera.tijelo.id, rezultat: "POTVRDJENO", napomena: "E2E pregledano" } });
    provjeri("Vlasnica provjerava i zatvara", ver.status === 200 && ver.tijelo.status === "ZATVORENA", `${ver.status} ${ver.tijelo?.error?.message ?? ver.tijelo?.status}`);
    const zad = (await pool.query(`select status from zadatak where izvor_id = $1`, [nc.tijelo.id])).rows.map((r) => r.status);
    provjeri("Zadatak se zatvorio sam", zad.length > 0 && zad.every((s) => s === "ZAVRSEN"));
    provjeri("Zaposleni (prijavio) saznaje da je zatvoreno", (await obavj(marko)).some((o) => o.izvor_id === nc.tijelo.id && o.naslov.includes("zatvorena")));

    // 4. Visoka ozbiljnost; sve se vidi u aktivnosti
    const visoka = await marko("/neusaglasenosti", { telo: { opis: "E2E: vitrina pokazuje 11 °C", ozbiljnost: "VISOK" } });
    trag.ncIds.push(visoka.tijelo?.id);
    provjeri("Visoka ozbiljnost — obavještenje stiže vlasnici", (await obavj(ana)).some((o) => o.izvor_id === visoka.tijelo.id));
    const aktivnost = await ana("/aktivnost");
    provjeri("Vlasnica vidi aktivnost uživo, sa imenom", aktivnost.status === 200 && aktivnost.tijelo.some((a) => a.opis.includes("vitrina pokazuje 11") && a.ko === "Marko Vuković" && a.tezina === "problem"));
    provjeri("Zaposleni ne vidi aktivnost cijelog ateljea (403)", (await marko("/aktivnost")).status === 403);
  } finally {
    const k = await pool.connect();
    try {
      await k.query("begin");
      const ncIds = trag.ncIds.filter(Boolean);
      const mjere = ncIds.length ? (await k.query(`select id from korektivna_mjera where neusaglasenost_id = any($1)`, [ncIds])).rows.map((r) => r.id) : [];
      const sve = [...ncIds, ...mjere];
      await k.query(`delete from obavjestenje where izvor_id = any($1)`, [sve]);
      await k.query(`delete from audit_log where entitet_id = any($1)`, [sve]);
      if (ncIds.length) {
        await k.query(`delete from zadatak where izvor_id = any($1)`, [ncIds]);
        await k.query(`delete from verifikacija where neusaglasenost_id = any($1)`, [ncIds]);
        await k.query(`delete from korektivna_mjera where neusaglasenost_id = any($1)`, [ncIds]);
        await k.query(`delete from neusaglasenost where id = any($1)`, [ncIds]);
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
