// Faza 1 — HACCP rupe koje su bile otvorene:
//   H1 zadržan lot (HOLD) se pušta ili odbija, sa razlogom i tragom u dnevniku kretanja;
//   H2 neusaglašenost se provjerava tek kad je mjera urađena, i ne provjerava je ko ju je uradio;
//   H3 odstupanje upisano u dnevni obrazac otvara neusaglašenost koja čeka provjeru;
//   H4 nepotvrđena granica artikla ne zadržava robu — samo upozorava odgovorno lice.
// Test pravi svoja dva artikla, pa sve što nastane (lotovi, zaliha, kretanja) briše po njima.
import { pool, prijava, NALOZI, danasCG, glavnoSkladiste, rokZaDana } from "./pomoc.mjs";

export const naziv = "Faza 1: HOLD, provjera mjere, odstupanje iz obrasca, nepotvrđena granica";

const zaliha = async (lotId) =>
  Object.fromEntries((await pool.query(`select status, kolicina::float as k from zaliha where lot_id = $1`, [lotId])).rows.map((r) => [r.status, r.k]));
const kretanja = async (lotId) =>
  (await pool.query(`select tip, kolicina_delta::float as d from kretanje_zalihe where lot_id = $1 order by created_at`, [lotId])).rows;
const lotStatus = async (lotId) => (await pool.query(`select status from lot where id = $1`, [lotId])).rows[0]?.status;

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const marko = await prijava(NALOZI.marko);
  const konsultant = await prijava(NALOZI.konsultant);
  const trag = { artikli: [], pravila: [], prijemi: [], zapisi: [], povlacenja: [] };
  const obavj = async (k) => (await k("/obavjestenja")).tijelo;
  const odluka = (lot, telo) => ana(`/prijem/${lot.prijem}/lot/${lot.id}/odluka`, { method: "PATCH", telo });

  try {
    const dobavljac = (await ana("/dobavljaci")).tijelo[0];
    const kkt1 = (await ana("/kontrolne-tacke")).tijelo.find((k) => k.sifra === "KKT1");
    const noviArtikal = async (naziv, potvrdjeno) => {
      const a = await ana("/artikli", { telo: { naziv, tempKontrolisano: true, tempMin: 0, tempMax: 4, granicaPotvrdio: potvrdjeno } });
      trag.artikli.push(a.tijelo.id);
      const p = await ana("/pravila-kontrole", { telo: { kontrolnaTackaId: kkt1.id, artikalId: a.tijelo.id, naziv: "E2E prijem 0–4 °C", minVrijednost: 0, maxVrijednost: 4, ozbiljnost: "VISOK" } });
      trag.pravila.push(p.tijelo.id);
      return a.tijelo.id;
    };
    const potvrdjen = await noviArtikal("E2E Faza1 jogurt (granica potvrđena)", true);
    const nepotvrdjen = await noviArtikal("E2E Faza1 sir (granica NIJE potvrđena)", false);

    const primi = async (artikalId, stavke) => {
      const r = await marko("/prijem", {
        telo: { dobavljacId: dobavljac.id, brojDokumenta: "E2E-F1", datumPrijema: danasCG(), skladisteId: await glavnoSkladiste(marko), stavke: stavke.map((s) => ({ artikalId, primljenaKolicina: 10, rokTrajanja: rokZaDana(30), ...s })) },
      });
      trag.prijemi.push(r.tijelo?.id);
      const lotovi = (await pool.query(`select id, broj_lota from lot where prijem_id = $1`, [r.tijelo.id])).rows;
      return stavke.map((s) => ({ id: lotovi.find((l) => l.broj_lota === s.brojLota).id, prijem: r.tijelo.id }));
    };

    // ── H4: nepotvrđena granica ─────────────────────────────────────────────────────────────
    const [sir] = await primi(nepotvrdjen, [{ brojLota: "E2E-F1-SIR", temperaturaPrijema: 9 }]);
    const mjSir = (await pool.query(`select id, rezultat, napomena from mjerenje_temperature where lot_id = $1`, [sir.id])).rows[0];
    provjeri("H4: 9 °C van NEPOTVRĐENE granice → upozorenje, ne pad", mjSir?.rezultat === "WARNING" && mjSir.napomena.includes("nepotvrđene"), mjSir?.rezultat);
    provjeri("H4: roba NIJE zadržana — čeka odluku odgovornog lica", (await lotStatus(sir.id)) === "PRIMLJEN");
    provjeri("H4: nema automatske neusaglašenosti", !(await pool.query(`select 1 from neusaglasenost where izvor_id = $1`, [mjSir.id])).rows[0]);
    provjeri("H4: odgovorno lice dobija obavještenje da odluči", (await obavj(ana)).some((o) => o.izvor_id === sir.id && o.naslov.includes("NEPOTVRĐENE")));

    // ── H1: HOLD pri prijemu → puštanje ─────────────────────────────────────────────────────
    const [topao, hladan] = await primi(potvrdjen, [
      { brojLota: "E2E-F1-TOPAO", temperaturaPrijema: 9 },
      { brojLota: "E2E-F1-HLADAN", temperaturaPrijema: 2 },
    ]);
    provjeri("H1: 9 °C van potvrđene granice → lot automatski zadržan", (await lotStatus(topao.id)) === "HOLD");
    provjeri("H1: ispravna stavka istog prijema čeka odluku normalno", (await lotStatus(hladan.id)) === "PRIMLJEN");
    const ncTemp = (await pool.query(
      `select nc.id, nc.status from neusaglasenost nc join mjerenje_temperature m on m.id = nc.izvor_id where m.lot_id = $1`,
      [topao.id],
    )).rows[0];
    provjeri("H1: otvorena neusaglašenost za temperaturu", ncTemp?.status === "OTVORENA");

    const dvaput = await odluka(topao, { odluka: "HOLD", kolicina: 10, napomena: "E2E" });
    provjeri("H1: zadržan lot se ne zadržava drugi put (409)", dvaput.status === 409 && dvaput.tijelo.error.code === "VEC_NA_HOLDU");
    const bezRazloga = await odluka(topao, { odluka: "PRIHVATI", kolicina: 10 });
    provjeri("H1: puštanje bez razloga — odbijeno (400)", bezRazloga.status === 400 && bezRazloga.tijelo.error.code === "RAZLOG_OBAVEZAN");
    const pusti = await odluka(topao, { odluka: "PRIHVATI", kolicina: 10, napomena: "E2E ponovljeno mjerenje 3,8 °C" });
    provjeri("H1: zadržana roba se pušta uz razlog", pusti.status === 200 && pusti.tijelo.status === "PRIHVACEN", `${pusti.status} ${pusti.tijelo?.error?.message ?? ""}`);
    provjeri("H1: …i tek tada ulazi u slobodnu zalihu", (await zaliha(topao.id)).DOSTUPNO === 10, JSON.stringify(await zaliha(topao.id)));
    provjeri("H1: …sa PRIJEMOM u dnevniku kretanja", (await kretanja(topao.id)).some((k) => k.tip === "PRIJEM" && k.d === 10));

    // ── H1: povlačenje blokira puštanje; odbijanje iz karantina je otpis ────────────────────
    const pov = await ana(`/sledljivost/lot/${topao.id}/povlacenje`, { telo: { razlog: "E2E povlačenje serije" } });
    trag.povlacenja.push(pov.tijelo?.id);
    provjeri("H1: povlačenje prebacuje zalihu u karantin", (await lotStatus(topao.id)) === "HOLD" && (await zaliha(topao.id)).KARANTIN === 10);
    const podPovlacenjem = await odluka(topao, { odluka: "PRIHVATI", kolicina: 10, napomena: "E2E pokušaj" });
    provjeri("H1: lot pod povlačenjem u toku se ne pušta (409)", podPovlacenjem.status === 409 && podPovlacenjem.tijelo.error.code === "LOT_POD_POVLACENJEM");
    const odbij = await odluka(topao, { odluka: "ODBIJI", kolicina: 0, napomena: "E2E uništeno po nalogu" });
    provjeri("H1: iz karantina se odbija", odbij.status === 200 && (await lotStatus(topao.id)) === "ODBIJEN");
    provjeri("H1: …karantin je prazan, a dnevnik ima OTPIS -10", (await zaliha(topao.id)).KARANTIN === 0 && (await kretanja(topao.id)).some((k) => k.tip === "OTPIS" && k.d === -10));

    // ── H1: odluka HOLD pri prijemu → karantin sa tragom → puštanje ─────────────────────────
    const zadrzi = await odluka(hladan, { odluka: "HOLD", kolicina: 10, napomena: "E2E ambalaža sumnjiva" });
    provjeri("H1: odluka HOLD stavlja robu u karantin", zadrzi.status === 200 && (await zaliha(hladan.id)).KARANTIN === 10);
    provjeri("H1: …i upisuje PRIJEM u dnevnik (ranije je izostajao)", (await kretanja(hladan.id)).some((k) => k.tip === "PRIJEM" && k.d === 10));
    const lotovi = (await ana("/lotovi")).tijelo.find((l) => l.id === hladan.id);
    provjeri("H1: lista lotova pokazuje količinu u karantinu", Number(lotovi?.karantin) === 10, `karantin=${lotovi?.karantin}`);
    await odluka(hladan, { odluka: "PRIHVATI", kolicina: 10, napomena: "E2E ambalaža pregledana, ispravna" });
    const z = await zaliha(hladan.id);
    provjeri("H1: puštanje iz karantina: karantin 0, slobodno 10", z.KARANTIN === 0 && z.DOSTUPNO === 10, JSON.stringify(z));
    provjeri("H1: …ukupna količina se ne mijenja — kretanje RELEASE 0", (await kretanja(hladan.id)).some((k) => k.tip === "RELEASE" && k.d === 0));

    // ── H2: provjera tek poslije urađene mjere, i ne od onog ko ju je uradio ────────────────
    const rano = await ana(`/neusaglasenosti/${ncTemp.id}/verifikacija`, { telo: { rezultat: "POTVRDJENO" } });
    provjeri("H2: otvorena neusaglašenost bez mjere se ne zatvara (409)", rano.status === 409 && rano.tijelo.error.code === "NIJE_SPREMNO_ZA_PROVJERU");
    const mjera = await ana(`/neusaglasenosti/${ncTemp.id}/korektivna-mjera`, { telo: { opis: "E2E: serija izdvojena i uništena", dodijeljenoKorisnikId: ana.id } });
    await ana(`/korektivne-mjere/${mjera.tijelo.id}/zavrsi`, { telo: { rezultat: "E2E: uništeno, zapisnik u fascikli" } });
    const sama = await ana(`/neusaglasenosti/${ncTemp.id}/verifikacija`, { telo: { rezultat: "POTVRDJENO" } });
    provjeri("H2: ko je uradio mjeru ne provjerava je — ni kad ne pošalje id mjere (409)", sama.status === 409 && sama.tijelo.error.code === "VERIFIKACIJA_NIJE_NEZAVISNA");
    const drugi = await konsultant(`/neusaglasenosti/${ncTemp.id}/verifikacija`, { telo: { rezultat: "POTVRDJENO", napomena: "E2E" } });
    provjeri("H2: drugo lice provjerava i zatvara", drugi.status === 200 && drugi.tijelo.status === "ZATVORENA");

    // ── H3: odstupanje u dnevnom obrascu ────────────────────────────────────────────────────
    const bez = await marko("/zapisi", { telo: { obrazacKod: "P7", datum: danasCG(), podaci: { tragovi: false, mjesto: "E2E rampa i komora 1" }, odstupanje: false } });
    trag.zapisi.push(bez.tijelo?.id);
    provjeri("H3: zapis bez odstupanja ne otvara ništa", bez.status === 201 && bez.tijelo.neusaglasenost === null);
    const sa = await marko("/zapisi", {
      telo: { obrazacKod: "P7", datum: danasCG(), podaci: { tragovi: true, mjesto: "E2E rampa" }, odstupanje: true, korektivnaMjera: "E2E postavljene klopke, rampa očišćena" },
    });
    trag.zapisi.push(sa.tijelo?.id);
    provjeri("H3: odstupanje otvara neusaglašenost", sa.status === 201 && !!sa.tijelo.neusaglasenost, sa.tijelo?.neusaglasenost);
    const ncZap = (await pool.query(`select id, status from neusaglasenost where izvor_tip = 'zapis' and izvor_id = $1`, [sa.tijelo.id])).rows[0];
    provjeri("H3: …koja odmah čeka provjeru — mjera je upisana uz zapis", ncZap?.status === "CEKA_VERIFIKACIJU");
    const mjeraZap = (await pool.query(`select status, zavrsio_korisnik_id from korektivna_mjera where neusaglasenost_id = $1`, [ncZap.id])).rows[0];
    provjeri("H3: mjera je urađena, potpisuje je magacioner", mjeraZap?.status === "ZAVRSENA" && mjeraZap.zavrsio_korisnik_id === marko.id);
    const naListi = (await ana("/neusaglasenosti")).tijelo.find((n) => n.id === ncZap.id);
    provjeri("H3: na listi piše iz kog obrasca je došla", naListi?.izvor_oznaka?.startsWith("Obrazac P7"), naListi?.izvor_oznaka);
    provjeri("H3: odgovorno lice dobija zadatak i obavještenje", (await ana("/zadaci?moji=1")).tijelo.some((z) => z.izvor_id === ncZap.id) && (await obavj(ana)).some((o) => o.izvor_id === ncZap.id));
    const isp = await marko("/zapisi", {
      telo: { obrazacKod: "P7", datum: danasCG(), podaci: { tragovi: true, mjesto: "E2E rampa i ulaz" }, odstupanje: true, korektivnaMjera: "E2E ispravljen opis", ispravljaId: sa.tijelo.id },
    });
    trag.zapisi.push(isp.tijelo?.id);
    provjeri("H3: ispravka istog zapisa ne otvara drugu neusaglašenost", isp.status === 201 && isp.tijelo.neusaglasenost === null);
    const zatvori = await ana(`/neusaglasenosti/${ncZap.id}/verifikacija`, { telo: { rezultat: "POTVRDJENO" } });
    provjeri("H3: odgovorno lice provjerava i zatvara", zatvori.status === 200 && zatvori.tijelo.status === "ZATVORENA");
    const zad = (await pool.query(`select status from zadatak where izvor_id = $1`, [ncZap.id])).rows;
    provjeri("H3: zadatak se zatvorio sam", zad.length > 0 && zad.every((r) => r.status === "ZAVRSEN"));
  } finally {
    const k = await pool.connect();
    try {
      await k.query("begin");
      const artikli = trag.artikli.filter(Boolean);
      const lotovi = artikli.length ? (await k.query(`select id from lot where artikal_id = any($1)`, [artikli])).rows.map((r) => r.id) : [];
      const mjerenja = lotovi.length ? (await k.query(`select id from mjerenje_temperature where lot_id = any($1)`, [lotovi])).rows.map((r) => r.id) : [];
      const zapisi = trag.zapisi.filter(Boolean);
      const povlacenja = trag.povlacenja.filter(Boolean);
      const izvori = [...mjerenja, ...zapisi, ...povlacenja];
      const ncIds = izvori.length ? (await k.query(`select id from neusaglasenost where izvor_id = any($1)`, [izvori])).rows.map((r) => r.id) : [];
      const mjere = ncIds.length ? (await k.query(`select id from korektivna_mjera where neusaglasenost_id = any($1)`, [ncIds])).rows.map((r) => r.id) : [];
      const prijemi = trag.prijemi.filter(Boolean);
      // Šifarnik sam pravi pravila za KKT 1 / KKT 3 iz granice artikla (pravilaService) — i njih.
      const pravila = artikli.length ? (await k.query(`select id from pravilo_kontrole where artikal_id = any($1)`, [artikli])).rows.map((r) => r.id) : [];
      const sve = [...artikli, ...pravila, ...lotovi, ...prijemi, ...izvori, ...ncIds, ...mjere];
      await k.query(`delete from obavjestenje where izvor_id = any($1)`, [sve]);
      await k.query(`delete from audit_log where entitet_id = any($1)`, [sve]);
      await k.query(`delete from dogadjaj where entitet_id = any($1)`, [sve]);
      await k.query(`delete from zadatak where izvor_id = any($1)`, [[...ncIds, ...povlacenja]]);
      await k.query(`delete from verifikacija where neusaglasenost_id = any($1)`, [ncIds]);
      await k.query(`delete from korektivna_mjera where neusaglasenost_id = any($1)`, [ncIds]);
      await k.query(`delete from neusaglasenost where id = any($1)`, [ncIds]);
      await k.query(`delete from povlacenje_kontakt where povlacenje_id = any($1)`, [povlacenja]);
      await k.query(`delete from povlacenje where id = any($1)`, [povlacenja]);
      await k.query(`delete from mjerenje_temperature where id = any($1)`, [mjerenja]);
      await k.query(`delete from kretanje_zalihe where lot_id = any($1)`, [lotovi]);
      await k.query(`delete from zaliha where lot_id = any($1)`, [lotovi]);
      await k.query(`delete from prijem_stavka where prijem_id = any($1)`, [prijemi]);
      await k.query(`delete from lot where id = any($1)`, [lotovi]);
      await k.query(`delete from prijem where id = any($1)`, [prijemi]);
      await k.query(`delete from zapis where id = any($1) and ispravlja_id is not null`, [zapisi]);
      await k.query(`delete from zapis where id = any($1)`, [zapisi]);
      await k.query(`delete from pravilo_kontrole where artikal_id = any($1)`, [artikli]);
      await k.query(`delete from artikal where id = any($1)`, [artikli]);
      await k.query("commit");
    } catch (e) {
      await k.query("rollback");
      throw new Error(`Čišćenje nije uspjelo: ${e.message} ${JSON.stringify(trag)}`);
    } finally {
      k.release();
    }
  }
}
