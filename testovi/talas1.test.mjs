// Talas 1 popravki posle revizije 25.09.2026, u ateljeu (isporuke, vozač i karantin povrata su uklonjeni — PLAN.md 8.3):
//   R-10 isti ključ zahtjeva ne pravi drugi upis (prijem);
//   R-13 zaposleni ne čita stare prijeme po adresi; stavka se mijenja samo u svom prijemu;
//   R-01 zaliha nikad u minusu (CHECK u bazi), otpis ne ide preko zalihe;
//   R-02 lot kome je istekao rok ne ide u tortu, Kontrolni centar ga broji;
//   R-11 ograničenje pokušaja prijave je po imenu, ne zaključava druge.
// Test pravi svoj artikal i jedan prijem sa četiri lota, pa sve što nastane briše po njima.
import { pool, prijava, anonimno, NALOZI, danasCG, glavnoSkladiste } from "./pomoc.mjs";

export const naziv = "Talas 1: ključ zahtjeva, stari prijem, zaliha, istekao rok, prijava";

const zaliha = async (lotId) =>
  Object.fromEntries((await pool.query(`select status, kolicina::float as k from zaliha where lot_id = $1`, [lotId])).rows.map((r) => [r.status, r.k]));
const zaDana = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const marko = await prijava(NALOZI.marko);
  const pocetak = new Date();
  const oznaka = `E2E-T1-${Date.now().toString(36)}`;
  const kljucevi = [`${oznaka}-prijem`];
  const trag = { artikal: null, prijemi: [], lotovi: [], porudzbine: [] };

  try {
    const dobavljac = (await ana("/dobavljaci")).tijelo[0];
    const skladisteId = await glavnoSkladiste(marko);
    const a = await ana("/artikli", { telo: { naziv: `${oznaka} keks (bez režima)`, tempKontrolisano: false, alergeni: ["GLUTEN"] } });
    trag.artikal = a.tijelo?.id;

    // ── R-10: isti ključ — jedan prijem ─────────────────────────────────────────────────────
    const lotoviPrijema = ["A", "B", "C", "D"].map((s) => ({ artikalId: trag.artikal, brojLota: `${oznaka}-${s}`, primljenaKolicina: 10, rokTrajanja: zaDana(60) }));
    const prijemTelo = { dobavljacId: dobavljac.id, brojDokumenta: oznaka, datumPrijema: danasCG(), skladisteId, stavke: lotoviPrijema };
    const p1 = await marko("/prijem", { telo: prijemTelo, zaglavlja: { "x-kljuc-zahtjeva": kljucevi[0] } });
    trag.prijemi.push(p1.tijelo?.id);
    const p2 = await marko("/prijem", { telo: prijemTelo, zaglavlja: { "x-kljuc-zahtjeva": kljucevi[0] } });
    trag.prijemi.push(p2.tijelo?.id);
    provjeri("R-10: drugi prijem sa istim ključem vraća PRVI", p1.status === 201 && p2.status === 201 && p1.tijelo.id === p2.tijelo.id, `${p1.tijelo?.id} / ${p2.tijelo?.id}`);
    const brojPrijema = (await pool.query(`select count(*)::int as n from prijem where broj_dokumenta = $1`, [oznaka])).rows[0].n;
    provjeri("R-10: …u bazi je jedan prijem", brojPrijema === 1, `${brojPrijema}`);

    const lotovi = (await pool.query(`select id, broj_lota from lot where prijem_id = $1`, [p1.tijelo.id])).rows;
    const lot = Object.fromEntries(lotovi.map((l) => [l.broj_lota.slice(-1), l.id]));
    trag.lotovi = lotovi.map((l) => l.id);
    for (const id of trag.lotovi) await ana(`/prijem/${p1.tijelo.id}/lot/${id}/odluka`, { method: "PATCH", telo: { odluka: "PRIHVATI", kolicina: 10 } });
    provjeri("Priprema: četiri lota prihvaćena, po 10 na zalihi", (await Promise.all(trag.lotovi.map(zaliha))).every((z) => z.DOSTUPNO === 10));

    // ── R-13: stari prijem po adresi (demo prijem od prije 2 dana), stavka tuđeg prijema ──────
    const stari = "60000000-0000-0000-0000-000000000002";
    const staroMarko = await marko(`/prijem/${stari}`);
    provjeri("R-13: zaposleni ne otvara prijem van svog prozora (404)", staroMarko.status === 404, `${staroMarko.status}`);
    provjeri("R-13: …vlasnica ga otvara", (await ana(`/prijem/${stari}`)).status === 200);
    const tudjaStavka = await marko(`/prijem/${stari}/lot/${lot.A}`, { method: "PATCH", telo: { primljenaKolicina: 11 } });
    provjeri("R-13: lot se ne mijenja preko adrese drugog prijema (404)", tudjaStavka.status === 404, `${tudjaStavka.status}`);

    // ── R-01: otpis i zaliha nikad u minusu ─────────────────────────────────────────────────
    const otpis = await marko(`/lotovi/${lot.B}/otpis`, { telo: { kolicina: 4, razlog: "E2E pao pri slaganju" } });
    provjeri("Otpis dijela lota", (otpis.status === 200 || otpis.status === 201 || otpis.status === 204) && (await zaliha(lot.B)).DOSTUPNO === 6, `${otpis.status} ${JSON.stringify(await zaliha(lot.B))}`);
    const previse = await marko(`/lotovi/${lot.B}/otpis`, { telo: { kolicina: 7, razlog: "E2E više nego što ima" } });
    provjeri("R-01: otpis više nego što je na zalihi se odbija (4xx)", previse.status >= 400 && previse.status < 500 && (await zaliha(lot.B)).DOSTUPNO === 6, `${previse.status}`);
    let minus = null;
    try {
      await pool.query(`update zaliha set kolicina = -1 where lot_id = $1 and status = 'DOSTUPNO'`, [lot.B]);
    } catch (e) {
      minus = e.code;
    }
    provjeri("R-01: baza sama odbija zalihu u minusu", minus === "23514", `${minus}`);

    // ── R-02: istekao rok — ne ide u tortu ──────────────────────────────────────────────────
    await pool.query(`update lot set rok_trajanja = (now() at time zone 'Europe/Podgorica')::date - 1 where id = $1`, [lot.D]);
    const ponuda = (await marko("/porudzbine/sastojci")).tijelo.map((l) => l.lot_id);
    provjeri("R-02: istekao lot se ne nudi za tortu", ponuda.includes(lot.C) && !ponuda.includes(lot.D));
    const torta = await marko("/porudzbine", { telo: { kupacIme: `${oznaka} Kupac`, kupacTelefon: "067 222 333", preuzimanjeDatum: danasCG(), preuzimanjeVrijeme: "23:50", opis: "E2E torta" } });
    trag.porudzbine.push(torta.tijelo?.id);
    const uTortu = await marko(`/porudzbine/${torta.tijelo.id}/lotovi`, { telo: { lotId: lot.D } });
    provjeri("R-02: istekao lot se ne dodaje u tortu (409)", uTortu.status === 409 && uTortu.tijelo.error.code === "ROK_ISTEKAO", `${uTortu.status} ${uTortu.tijelo?.error?.code}`);
    const tabla = (await ana("/tabla")).tijelo.kriticno;
    provjeri("R-02: Kontrolni centar broji lot sa isteklim rokom", tabla.robaIstekao >= 1, `robaIstekao=${tabla.robaIstekao}`);
    const detalj = (await ana("/tabla/detalj/rok-robe")).tijelo;
    provjeri("R-02: vlasnica vidi listu iza broja", detalj.redovi?.some((r) => r.lot === `${oznaka}-D` && r.stanje === "ISTEKLA"));

    // ── R-11: tuđi pogrešni pokušaji ne zaključavaju druge ──────────────────────────────────
    const gost = anonimno();
    const lazno = `e2e-${oznaka.toLowerCase()}`;
    let posljednji = null;
    for (let i = 0; i < 9; i++) posljednji = (await gost("/auth/prijava", { telo: { korisnickoIme: lazno, lozinka: "pogresna-lozinka" } })).status;
    provjeri("R-11: posle 8 pogrešnih pokušaja to ime je zaključano (429)", posljednji === 429, `${posljednji}`);
    const anaOpet = await gost("/auth/prijava", { telo: { korisnickoIme: NALOZI.ana.ime, lozinka: NALOZI.ana.lozinka } });
    provjeri("R-11: …a drugi nalog sa iste adrese se prijavljuje", anaOpet.status === 200, `${anaOpet.status}`);
  } finally {
    const k = await pool.connect();
    try {
      await k.query("begin");
      const lotovi = trag.artikal ? (await k.query(`select id from lot where artikal_id = $1`, [trag.artikal])).rows.map((r) => r.id) : [];
      const prijemi = [...new Set(trag.prijemi.filter(Boolean))];
      const porudzbine = trag.porudzbine.filter(Boolean);
      const pravila = trag.artikal ? (await k.query(`select id from pravilo_kontrole where artikal_id = $1`, [trag.artikal])).rows.map((r) => r.id) : [];
      const sve = [trag.artikal, ...pravila, ...lotovi, ...prijemi, ...porudzbine].filter(Boolean);
      await k.query(`delete from obavjestenje where izvor_id = any($1)`, [sve]);
      await k.query(`delete from audit_log where entitet_id = any($1)`, [sve]);
      await k.query(`delete from zadatak where izvor_id = any($1)`, [sve]);
      await k.query(`delete from porudzbina_lot where porudzbina_id = any($1)`, [porudzbine]);
      await k.query(`delete from porudzbina where id = any($1)`, [porudzbine]);
      await k.query(`delete from kretanje_zalihe where lot_id = any($1)`, [lotovi]);
      await k.query(`delete from zaliha where lot_id = any($1)`, [lotovi]);
      await k.query(`delete from prijem_stavka where prijem_id = any($1)`, [prijemi]);
      await k.query(`delete from lot where id = any($1)`, [lotovi]);
      await k.query(`delete from prijem where id = any($1)`, [prijemi]);
      await k.query(`delete from pravilo_kontrole where artikal_id = $1`, [trag.artikal]);
      await k.query(`delete from artikal where id = $1`, [trag.artikal]);
      await k.query(`delete from kljuc_zahtjeva where kljuc = any($1)`, [kljucevi]);
      // Neuspjele prijave nepostojećeg imena iz ovog testa (sigurnosni događaji bez naloga).
      await k.query(`delete from audit_log where akcija = 'SIGURNOST' and entitet_id = '00000000-0000-0000-0000-000000000000' and created_at >= $1`, [pocetak]);
      await k.query("commit");
    } catch (e) {
      await k.query("rollback");
      throw new Error(`Čišćenje nije uspjelo: ${e.message} ${JSON.stringify(trag)}`);
    } finally {
      k.release();
    }
  }
}
