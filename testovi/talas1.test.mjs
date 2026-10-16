// Talas 1 popravki posle revizije 25.09.2026:
//   R-01 predaja provjerava lot i zalihu U TRENUTKU PREDAJE (zadržan lot, otpisana roba), zaliha nikad u minusu;
//   R-02 lot kome je istekao rok se ne isporučuje, Kontrolni centar ga broji;
//   R-03 roba koja se vraća sa isporuke ide u karantin, odgovorno lice je pušta ili otpisuje;
//   R-04 magacioner i vozač rade samo sa svojim isporukama;
//   R-10 isti ključ zahtjeva ne pravi drugi upis;
//   R-11 ograničenje pokušaja prijave je po imenu, ne zaključava druge;
//   R-13 magacioner ne čita stare prijeme po adresi; stavka se mijenja samo u svom prijemu;
//   R-16 potvrda mora obuhvatiti sve stavke.
// Test pravi svoj artikal i jedan prijem sa četiri lota, pa sve što nastane briše po njima.
import { pool, prijava, anonimno, NALOZI, danasCG, glavnoSkladiste } from "./pomoc.mjs";

export const naziv = "Talas 1: predaja, rok, karantin, svoje isporuke, ključ zahtjeva";

const zaliha = async (lotId) =>
  Object.fromEntries((await pool.query(`select status, kolicina::float as k from zaliha where lot_id = $1`, [lotId])).rows.map((r) => [r.status, r.k]));
const kretanja = async (lotId) =>
  (await pool.query(`select tip, kolicina_delta::float as d, napomena from kretanje_zalihe where lot_id = $1 order by created_at`, [lotId])).rows;
const zaDana = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const marko = await prijava(NALOZI.marko);
  const petar = await prijava(NALOZI.petar);
  const direktor = await prijava(NALOZI.direktor);
  const pocetak = new Date();
  const oznaka = `E2E-T1-${Date.now().toString(36)}`;
  const kljucevi = [`${oznaka}-prijem`, `${oznaka}-isporuka`];
  const trag = { artikal: null, prijemi: [], isporuke: [], povlacenja: [], lotovi: [] };
  const obavj = async (k) => (await k("/obavjestenja")).tijelo;

  try {
    const dobavljac = (await ana("/dobavljaci")).tijelo[0];
    const kupac = (await ana("/kupci")).tijelo[0];
    const skladisteId = await glavnoSkladiste(marko);
    const a = await ana("/artikli", { telo: { naziv: `${oznaka} keks (bez režima)`, tempKontrolisano: false } });
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

    const isporuka = async (k, stavke, dodatno = {}) => {
      const r = await k("/isporuke", { telo: { kupacId: kupac.id, skladisteId, datumIsporuke: danasCG(), napomena: oznaka, stavke, ...dodatno.telo }, zaglavlja: dodatno.zaglavlja });
      if (r.tijelo?.id) trag.isporuke.push(r.tijelo.id);
      return r;
    };
    const stavkeIsporuke = async (id) => (await pool.query(`select id, lot_id from isporuka_stavka where isporuka_id = $1`, [id])).rows;
    const potvrdi = (k, id, stavke) => k(`/isporuke/${id}/potvrda`, { telo: { stavke } });

    // ── R-13: stari prijem po adresi, stavka tuđeg prijema ──────────────────────────────────
    const stari = "60000000-0000-0000-0000-000000000002";
    const staroMarko = await marko(`/prijem/${stari}`);
    provjeri("R-13: magacioner ne otvara prijem van svog prozora (404)", staroMarko.status === 404, `${staroMarko.status}`);
    provjeri("R-13: …odgovorno lice ga otvara", (await ana(`/prijem/${stari}`)).status === 200);
    const tudjaStavka = await marko(`/prijem/${stari}/lot/${lot.A}`, { method: "PATCH", telo: { primljenaKolicina: 11 } });
    provjeri("R-13: lot se ne mijenja preko adrese drugog prijema (404)", tudjaStavka.status === 404, `${tudjaStavka.status}`);

    // ── R-04: tuđa isporuka ─────────────────────────────────────────────────────────────────
    const iA = await isporuka(ana, [{ lotId: lot.A, planiranaKolicina: 6 }], { telo: { vozacKorisnikId: petar.id } });
    provjeri("Priprema: odgovorno lice sprema isporuku za vozača", iA.status === 201, `${iA.status} ${iA.tijelo?.error?.message ?? ""}`);
    const [sA] = await stavkeIsporuke(iA.tijelo.id);
    provjeri("R-04: magacioner ne čita tuđu isporuku po adresi (404)", (await marko(`/isporuke/${iA.tijelo.id}`)).status === 404);
    provjeri("R-04: …ni na listi", !(await marko("/isporuke")).tijelo.some((i) => i.id === iA.tijelo.id));
    const tudjaIzmjena = await marko(`/isporuke/${iA.tijelo.id}`, { method: "PATCH", telo: { datumIsporuke: danasCG(), stavke: [{ lotId: lot.A, planiranaKolicina: 1 }] } });
    provjeri("R-04: magacioner ne mijenja tuđu isporuku (403)", tudjaIzmjena.status === 403 && tudjaIzmjena.tijelo.error.code === "NIJE_VASA_ISPORUKA", `${tudjaIzmjena.status}`);
    const tudjaPotvrda = await potvrdi(marko, iA.tijelo.id, [{ stavkaId: sA.id, isporucenaKolicina: 6 }]);
    provjeri("R-04: magacioner ne potvrđuje isporuku dodijeljenu vozaču (403)", tudjaPotvrda.status === 403, `${tudjaPotvrda.status}`);
    provjeri("R-04: vozač kome je dodijeljena je vidi", (await petar(`/isporuke/${iA.tijelo.id}`)).status === 200);

    // ── R-03: povrat sa isporuke → karantin → pusti / otpiši ────────────────────────────────
    const pA = await potvrdi(petar, iA.tijelo.id, [{ stavkaId: sA.id, isporucenaKolicina: 3, odbijenaKolicina: 2, razlogOdbijanja: "E2E oštećena ambalaža" }]);
    provjeri("R-03: vozač potvrđuje djelimičnu predaju", pA.status === 200 && pA.tijelo.status === "DJELIMICNA", `${pA.status} ${pA.tijelo?.error?.message ?? ""}`);
    provjeri("R-03: nepredato (2 odbijeno + 1 nepredato) ide u karantin", pA.tijelo?.uKarantin === 3, `uKarantin=${pA.tijelo?.uKarantin}`);
    const zA = await zaliha(lot.A);
    provjeri("R-03: slobodno 10 − 3 predato − 3 vraćeno = 4, karantin 3", zA.DOSTUPNO === 4 && zA.KARANTIN === 3, JSON.stringify(zA));
    provjeri("R-03: dnevnik: ISPORUKA −3 i premještanje u karantin sa razlogom", (await kretanja(lot.A)).some((k) => k.tip === "ISPORUKA" && k.d === -3) && (await kretanja(lot.A)).some((k) => k.tip === "HOLD" && k.d === 0 && k.napomena.includes("oštećena")));
    provjeri("R-03: odgovorno lice dobija obavještenje o povratu", (await obavj(ana)).some((o) => o.izvor_id === lot.A && o.naslov.startsWith("Povrat u karantin")));
    provjeri("R-03: potvrđena isporuka se ne potvrđuje drugi put (409)", (await potvrdi(petar, iA.tijelo.id, [{ stavkaId: sA.id, isporucenaKolicina: 6 }])).status === 409);
    provjeri("R-03: lista lotova pokazuje karantin prihvaćenog lota", Number((await ana("/lotovi")).tijelo.find((l) => l.id === lot.A)?.karantin) === 3);
    const karantin = (k, id, telo) => k(`/lotovi/${id}/karantin`, { telo });
    provjeri("R-03: magacioner ne odlučuje o karantinu (403)", (await karantin(marko, lot.A, { odluka: "PUSTI", kolicina: 1, razlog: "E2E" })).status === 403);
    const previse = await karantin(ana, lot.A, { odluka: "PUSTI", kolicina: 5, razlog: "E2E pregledano" });
    provjeri("R-03: ne pušta se više nego što je u karantinu (409)", previse.status === 409 && previse.tijelo.error.code === "NEDOVOLJNO_U_KARANTINU");
    const pusti = await karantin(ana, lot.A, { odluka: "PUSTI", kolicina: 2, razlog: "E2E pregledano, ambalaža čitava" });
    const zA2 = await zaliha(lot.A);
    provjeri("R-03: pregledano se vraća u prodaju (RELEASE 0)", pusti.status === 204 && zA2.DOSTUPNO === 6 && zA2.KARANTIN === 1 && (await kretanja(lot.A)).some((k) => k.tip === "RELEASE" && k.d === 0), JSON.stringify(zA2));
    const otpisi = await karantin(ana, lot.A, { odluka: "OTPISI", kolicina: 1, razlog: "E2E probušeno pakovanje" });
    provjeri("R-03: oštećeno se otpisuje iz karantina (OTPIS −1)", otpisi.status === 204 && (await zaliha(lot.A)).KARANTIN === 0 && (await kretanja(lot.A)).some((k) => k.tip === "OTPIS" && k.d === -1));

    // ── R-16: sve stavke ────────────────────────────────────────────────────────────────────
    const iR = await isporuka(ana, [{ lotId: lot.A, planiranaKolicina: 1 }, { lotId: lot.B, planiranaKolicina: 1 }]);
    const [s1] = await stavkeIsporuke(iR.tijelo.id);
    const nepotpuna = await potvrdi(ana, iR.tijelo.id, [{ stavkaId: s1.id, isporucenaKolicina: 1 }]);
    provjeri("R-16: potvrda bez jedne stavke se odbija (400)", nepotpuna.status === 400 && nepotpuna.tijelo.error.code === "STAVKE_NEPOTPUNE");
    const dupla = await potvrdi(ana, iR.tijelo.id, [{ stavkaId: s1.id, isporucenaKolicina: 1 }, { stavkaId: s1.id, isporucenaKolicina: 1 }]);
    provjeri("R-16: …i ista stavka dvaput (400)", dupla.status === 400 && dupla.tijelo.error.code === "STAVKE_NEPOTPUNE");

    // ── R-01: otpisano između pripreme i predaje; zaliha nikad u minusu ──────────────────────
    const iB1 = await isporuka(marko, [{ lotId: lot.B, planiranaKolicina: 8 }], { zaglavlja: { "x-kljuc-zahtjeva": kljucevi[1] } });
    const iB2 = await isporuka(marko, [{ lotId: lot.B, planiranaKolicina: 8 }], { zaglavlja: { "x-kljuc-zahtjeva": kljucevi[1] } });
    provjeri("R-10: ista isporuka sa istim ključem — jedna", iB1.status === 201 && iB1.tijelo.id === iB2.tijelo?.id);
    const [sB] = await stavkeIsporuke(iB1.tijelo.id);
    await marko(`/lotovi/${lot.B}/otpis`, { telo: { kolicina: 5, razlog: "E2E razbijeno pri slaganju" } });
    const bezRobe = await potvrdi(marko, iB1.tijelo.id, [{ stavkaId: sB.id, isporucenaKolicina: 8 }]);
    provjeri("R-01: predaja više nego što je ostalo na zalihi se odbija (409)", bezRobe.status === 409 && bezRobe.tijelo.error.code === "NEDOVOLJNO_ZALIHE", `${bezRobe.status}`);
    provjeri("R-01: …zaliha je ostala 5, ne −3", (await zaliha(lot.B)).DOSTUPNO === 5);
    const ostatak = await potvrdi(marko, iB1.tijelo.id, [{ stavkaId: sB.id, isporucenaKolicina: 5 }]);
    provjeri("R-01: predaja onoga što postoji prolazi", ostatak.status === 200 && ostatak.tijelo.status === "DJELIMICNA" && (await zaliha(lot.B)).DOSTUPNO === 0);
    let minus = null;
    try {
      await pool.query(`update zaliha set kolicina = -1 where lot_id = $1 and status = 'DOSTUPNO'`, [lot.B]);
    } catch (e) {
      minus = e.code;
    }
    provjeri("R-01: baza sama odbija zalihu u minusu", minus === "23514", `${minus}`);

    // ── R-01: lot zadržan (povlačenje) dok je isporuka u pripremi ───────────────────────────
    const iC = await isporuka(marko, [{ lotId: lot.C, planiranaKolicina: 4 }], { telo: { vozacKorisnikId: petar.id } });
    const [sC] = await stavkeIsporuke(iC.tijelo.id);
    const pov = await ana(`/sledljivost/lot/${lot.C}/povlacenje`, { telo: { razlog: "E2E povlačenje serije" } });
    trag.povlacenja.push(pov.tijelo?.id);
    provjeri("Priprema: povlačenje zadržava lot C", pov.status === 201 || pov.status === 200, `${pov.status} ${pov.tijelo?.error?.message ?? ""}`);
    const upozorenje = (o) => o.izvor_id === iC.tijelo.id && o.naslov.startsWith("Ne predajte lot");
    provjeri("R-01: vozač dobija „Ne predajte lot“", (await obavj(petar)).some(upozorenje));
    provjeri("R-01: …i magacioner koji je isporuku spremio", (await obavj(marko)).some(upozorenje));
    const blokiran = await potvrdi(petar, iC.tijelo.id, [{ stavkaId: sC.id, isporucenaKolicina: 4 }]);
    provjeri("R-01: predaja zadržanog lota se odbija (409 LOT_BLOKIRAN)", blokiran.status === 409 && blokiran.tijelo.error.code === "LOT_BLOKIRAN", `${blokiran.status} ${blokiran.tijelo?.error?.code}`);
    const vraceno = await potvrdi(petar, iC.tijelo.id, [{ stavkaId: sC.id, isporucenaKolicina: 0, odbijenaKolicina: 0, razlogOdbijanja: "E2E lot pod povlačenjem" }]);
    const zC = await zaliha(lot.C);
    provjeri("R-01: sa 0 predato isporuka se zatvara kao odbijena", vraceno.status === 200 && vraceno.tijelo.status === "ODBIJENA", `${vraceno.status}`);
    provjeri("R-01: …roba ostaje u karantinu povlačenja, ništa u minusu", zC.KARANTIN === 10 && (zC.DOSTUPNO ?? 0) === 0, JSON.stringify(zC));

    // ── R-02: istekao rok ───────────────────────────────────────────────────────────────────
    const iD = await isporuka(ana, [{ lotId: lot.D, planiranaKolicina: 3 }]);
    const [sD] = await stavkeIsporuke(iD.tijelo.id);
    await pool.query(`update lot set rok_trajanja = (now() at time zone 'Europe/Podgorica')::date - 1 where id = $1`, [lot.D]);
    const nova = await isporuka(ana, [{ lotId: lot.D, planiranaKolicina: 1 }]);
    provjeri("R-02: nova isporuka isteklog lota se odbija (409)", nova.status === 409 && nova.tijelo.error.code === "ROK_ISTEKAO", `${nova.status}`);
    const istekaoPredaja = await potvrdi(ana, iD.tijelo.id, [{ stavkaId: sD.id, isporucenaKolicina: 3 }]);
    provjeri("R-02: predaja lota koji je istekao posle pripreme se odbija (409)", istekaoPredaja.status === 409 && istekaoPredaja.tijelo.error.code === "ROK_ISTEKAO");
    const nazad = await potvrdi(ana, iD.tijelo.id, [{ stavkaId: sD.id, isporucenaKolicina: 0, razlogOdbijanja: "E2E istekao rok" }]);
    provjeri("R-02: nepredata istekla roba ide u karantin", nazad.status === 200 && nazad.tijelo.uKarantin === 3 && (await zaliha(lot.D)).KARANTIN === 3);
    const tabla = (await ana("/tabla")).tijelo.kriticno;
    provjeri("R-02: Kontrolni centar broji lot sa isteklim rokom", tabla.robaIstekao >= 1, `robaIstekao=${tabla.robaIstekao}`);
    const detalj = (await direktor("/tabla/detalj/rok-robe")).tijelo;
    provjeri("R-02: direktor vidi listu iza broja", detalj.redovi?.some((r) => r.lot === `${oznaka}-D` && r.stanje === "ISTEKLA"));
    const pustiIstekao = await karantin(ana, lot.D, { odluka: "PUSTI", kolicina: 1, razlog: "E2E pokušaj" });
    provjeri("R-02: istekla roba se ne vraća iz karantina u prodaju (409)", pustiIstekao.status === 409 && pustiIstekao.tijelo.error.code === "ROK_ISTEKAO");

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
      const isporuke = [...new Set(trag.isporuke.filter(Boolean))];
      const povlacenja = trag.povlacenja.filter(Boolean);
      const ncIds = (await k.query(`select id from neusaglasenost where izvor_id = any($1)`, [[...povlacenja, ...lotovi, ...isporuke]])).rows.map((r) => r.id);
      const pravila = trag.artikal ? (await k.query(`select id from pravilo_kontrole where artikal_id = $1`, [trag.artikal])).rows.map((r) => r.id) : [];
      const sve = [trag.artikal, ...pravila, ...lotovi, ...prijemi, ...isporuke, ...povlacenja, ...ncIds].filter(Boolean);
      await k.query(`delete from obavjestenje where izvor_id = any($1)`, [sve]);
      await k.query(`delete from audit_log where entitet_id = any($1)`, [sve]);
      await k.query(`delete from zadatak where izvor_id = any($1)`, [sve]);
      await k.query(`delete from verifikacija where neusaglasenost_id = any($1)`, [ncIds]);
      await k.query(`delete from korektivna_mjera where neusaglasenost_id = any($1)`, [ncIds]);
      await k.query(`delete from neusaglasenost where id = any($1)`, [ncIds]);
      await k.query(`delete from povlacenje_kontakt where povlacenje_id = any($1)`, [povlacenja]);
      await k.query(`delete from povlacenje where id = any($1)`, [povlacenja]);
      await k.query(`delete from isporuka_stavka where isporuka_id = any($1)`, [isporuke]);
      await k.query(`delete from isporuka where id = any($1)`, [isporuke]);
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
