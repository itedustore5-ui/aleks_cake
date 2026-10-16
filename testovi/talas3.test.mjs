// Talas 3 popravki posle revizije 25.09.2026:
//   R-14 rezervacija: isporuke u pripremi drže robu; slobodno = na zalihi − rezervisano;
//   R-15 otkaz isporuke prije predaje, uz razlog; kupac se može ispraviti dok je u pripremi;
//   R-17 rok obavezan po artiklu; serija jednom po prijemu; ista serija sa drugim rokom — upozorenje;
//        povlačenje ide po SERIJI (svi prijemi istog lota);
//   R-21 otpremnica za štampu; R-28 PIB kupca, jedinstven PIB kupca i dobavljača.
// Test pravi svoje artikle, dobavljača i kupce, pa sve briše po njima.
import { pool, prijava, NALOZI, danasCG, glavnoSkladiste, rokZaDana } from "./pomoc.mjs";

export const naziv = "Talas 3: rezervacija, otkaz, serija i rok, otpremnica, PIB";

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const marko = await prijava(NALOZI.marko);
  const petar = await prijava(NALOZI.petar);
  const direktor = await prijava(NALOZI.direktor);
  const sufiks = Date.now().toString(36).toUpperCase();
  const oznaka = `E2E-T3-${sufiks}`;
  // PIB od 8 cifara, jedinstven za ovaj prolaz.
  const pib = (n) => String(90000000 + ((Date.now() + n) % 9999999)).slice(0, 8);
  const trag = { artikli: [], dobavljaci: [], kupci: [], prijemi: [], isporuke: [], povlacenja: [] };

  try {
    const skladisteId = await glavnoSkladiste(marko);

    // ── R-28: PIB ───────────────────────────────────────────────────────────────────────────
    const losPib = await ana("/kupci", { telo: { naziv: `${oznaka} kupac`, telefon: "067111222", pib: "123" } });
    provjeri("R-28: PIB koji nije od cifara se odbija (400)", losPib.status === 400);
    const pibKupca = pib(1);
    const k1 = await ana("/kupci", { telo: { naziv: `${oznaka} kupac A`, telefon: "067111222", pib: pibKupca, adresa: "Bulevar 1, Podgorica", adresaIsporuke: "Magacin kupca, Zelenika bb" } });
    trag.kupci.push(k1.tijelo?.id);
    provjeri("R-28: kupac sa PIB-om i adresom isporuke", k1.status === 201);
    const k2dupli = await ana("/kupci", { telo: { naziv: `${oznaka} kupac B`, telefon: "067333444", pib: pibKupca } });
    if (k2dupli.tijelo?.id) trag.kupci.push(k2dupli.tijelo.id);
    provjeri("R-28: drugi kupac sa istim PIB-om se odbija (409)", k2dupli.status === 409 && k2dupli.tijelo.error.code === "PIB_POSTOJI");
    const k2 = await ana("/kupci", { telo: { naziv: `${oznaka} kupac B`, telefon: "067333444" } });
    trag.kupci.push(k2.tijelo?.id);
    const pibDob = pib(2);
    const dob = await ana("/dobavljaci", { telo: { naziv: `${oznaka} dobavljač`, pib: pibDob } });
    trag.dobavljaci.push(dob.tijelo?.id);
    const dobDupli = await ana("/dobavljaci", { telo: { naziv: `${oznaka} dobavljač 2`, pib: pibDob } });
    if (dobDupli.tijelo?.id) trag.dobavljaci.push(dobDupli.tijelo.id);
    provjeri("R-28: dobavljač sa istim PIB-om se odbija (409)", dobDupli.status === 409);

    // ── R-17: rok obavezan, serija jednom po prijemu ────────────────────────────────────────
    const a = await ana("/artikli", { telo: { naziv: `${oznaka} keks`, tempKontrolisano: false } });
    const bezRoka = await ana("/artikli", { telo: { naziv: `${oznaka} so (bez roka)`, tempKontrolisano: false, rokObavezan: false } });
    trag.artikli.push(a.tijelo?.id, bezRoka.tijelo?.id);
    const prijem = async (stavke) => {
      const r = await marko("/prijem", { telo: { dobavljacId: dob.tijelo.id, brojDokumenta: oznaka, datumPrijema: danasCG(), skladisteId, stavke } });
      if (r.tijelo?.id) trag.prijemi.push(r.tijelo.id);
      return r;
    };
    const lotoviPrijema = async (prijemId) => Object.fromEntries((await pool.query(`select broj_lota, id from lot where prijem_id = $1`, [prijemId])).rows.map((r) => [r.broj_lota, r.id]));
    const prihvati = (prijemId, lotId, kolicina) => ana(`/prijem/${prijemId}/lot/${lotId}/odluka`, { method: "PATCH", telo: { odluka: "PRIHVATI", kolicina } });

    const bezRokaUnos = await prijem([{ artikalId: a.tijelo.id, brojLota: `${oznaka}-R`, primljenaKolicina: 10 }]);
    provjeri("R-17: bez roka trajanja se ne prima (400)", bezRokaUnos.status === 400 && bezRokaUnos.tijelo.error.code === "ROK_OBAVEZAN", bezRokaUnos.tijelo?.error?.message);
    const dvaput = await prijem([
      { artikalId: a.tijelo.id, brojLota: `${oznaka}-R`, primljenaKolicina: 5, rokTrajanja: rokZaDana(60) },
      { artikalId: a.tijelo.id, brojLota: ` ${oznaka.toLowerCase()}-r `, primljenaKolicina: 5, rokTrajanja: rokZaDana(60) },
    ]);
    provjeri("R-17: ista serija dvaput u jednom prijemu se odbija (400)", dvaput.status === 400 && dvaput.tijelo.error.code === "SERIJA_DVAPUT");
    const izuzetak = await prijem([
      { artikalId: bezRoka.tijelo.id, brojLota: `${oznaka}-S1`, primljenaKolicina: 3 },
      { artikalId: bezRoka.tijelo.id, brojLota: `${oznaka}-S2`, primljenaKolicina: 3 },
    ]);
    provjeri("R-17: artikal izuzet od roka se prima bez roka", izuzetak.status === 201);
    const ls = await lotoviPrijema(izuzetak.tijelo.id);
    const uIstuSeriju = await marko(`/prijem/${izuzetak.tijelo.id}/lot/${ls[`${oznaka}-S2`]}`, { method: "PATCH", telo: { brojLota: `${oznaka}-S1` } });
    provjeri("R-17: ispravka stavke u seriju koja već postoji u prijemu (409)", uIstuSeriju.status === 409 && uIstuSeriju.tijelo.error.code === "SERIJA_DVAPUT");

    const p1 = await prijem([{ artikalId: a.tijelo.id, brojLota: `${oznaka}-R`, primljenaKolicina: 10, rokTrajanja: rokZaDana(60) }]);
    const lotR = (await lotoviPrijema(p1.tijelo.id))[`${oznaka}-R`];
    await prihvati(p1.tijelo.id, lotR, 10);

    // ── R-14: rezervacija ───────────────────────────────────────────────────────────────────
    const isporuka = async (k, stavke, dodatno = {}) => {
      const r = await k("/isporuke", { telo: { kupacId: k1.tijelo.id, skladisteId, datumIsporuke: danasCG(), napomena: oznaka, stavke, ...dodatno } });
      if (r.tijelo?.id) trag.isporuke.push(r.tijelo.id);
      return r;
    };
    const lotStanje = async () => (await ana("/lotovi")).tijelo.find((l) => l.id === lotR);
    const i1 = await isporuka(ana, [{ lotId: lotR, planiranaKolicina: 7 }]);
    provjeri("R-14: isporuka 7 od 10 se priprema", i1.status === 201);
    const previse = await isporuka(ana, [{ lotId: lotR, planiranaKolicina: 4 }]);
    provjeri("R-14: druga isporuka ne može uzeti rezervisano — slobodno je 3 (409)", previse.status === 409 && previse.tijelo.error.code === "NEDOVOLJNO_ZALIHE" && /rezerv|drže/.test(previse.tijelo.error.message), previse.tijelo?.error?.message);
    const i2 = await isporuka(ana, [{ lotId: lotR, planiranaKolicina: 3 }]);
    provjeri("R-14: …a slobodnih 3 može", i2.status === 201);
    const st = await lotStanje();
    provjeri("R-14: lot pokazuje rezervisano 10 od 10", Number(st?.rezervisano) === 10 && Number(st?.dostupno) === 10, JSON.stringify({ d: st?.dostupno, r: st?.rezervisano }));
    const vz = (await marko("/zaliha")).tijelo.find((z) => z.lot_id === lotR);
    provjeri("R-14: zaliha za formu isporuke: slobodno 0", Number(vz?.slobodno) === 0 && Number(vz?.rezervisano) === 10);
    const dvijeStavke = await isporuka(ana, [{ lotId: lotR, planiranaKolicina: 1 }, { lotId: lotR, planiranaKolicina: 1 }]);
    provjeri("R-14: dvije stavke istog lota se sabiraju (409)", dvijeStavke.status === 409);
    const izm = (kolicina, dodatno = {}) =>
      ana(`/isporuke/${i1.tijelo.id}`, { method: "PATCH", telo: { datumIsporuke: danasCG(), skladisteId, stavke: [{ lotId: lotR, planiranaKolicina: kolicina }], ...dodatno } });
    provjeri("R-14: izmjena ne može preko slobodnog (7 + 0 slobodno → 8 odbijeno)", (await izm(8)).status === 409);
    provjeri("R-14: izmjena u okviru svoje rezervacije prolazi (6)", (await izm(6)).status === 204);

    // ── R-15: izmjena kupca, otkaz ──────────────────────────────────────────────────────────
    const promjenaKupca = await izm(6, { kupacId: k2.tijelo.id });
    const ak = (await pool.query(`select stare_vrijednosti as s, nove_vrijednosti as n from audit_log where entitet_id = $1 and akcija = 'IZMJENA' order by created_at desc limit 1`, [i1.tijelo.id])).rows[0];
    provjeri("R-15: kupac se ispravlja dok je isporuka u pripremi, audit pamti starog", promjenaKupca.status === 204 && ak?.s?.kupac_id === k1.tijelo.id && ak?.n?.kupac_id === k2.tijelo.id);
    await izm(6, { kupacId: k1.tijelo.id });
    provjeri("R-15: magacioner ne otkazuje tuđu isporuku (403)", (await marko(`/isporuke/${i2.tijelo.id}/otkaz`, { telo: { razlog: "E2E pokušaj" } })).status === 403);
    provjeri("R-15: vozač ne otkazuje isporuku (403)", (await petar(`/isporuke/${i2.tijelo.id}/otkaz`, { telo: { razlog: "E2E pokušaj" } })).status === 403);
    provjeri("R-15: otkaz bez razloga se odbija (400)", (await ana(`/isporuke/${i2.tijelo.id}/otkaz`, { telo: { razlog: "ne" } })).status === 400);
    const otkaz = await ana(`/isporuke/${i2.tijelo.id}/otkaz`, { telo: { razlog: "E2E kupac otkazao narudžbu" } });
    const red = (await pool.query(`select status, razlog_otkaza, otkazano_at from isporuka where id = $1`, [i2.tijelo.id])).rows[0];
    provjeri("R-15: isporuka otkazana, sa razlogom i vremenom", otkaz.status === 200 && red?.status === "OTKAZANA" && red.razlog_otkaza === "E2E kupac otkazao narudžbu" && !!red.otkazano_at);
    provjeri("R-15: …i njena roba je ponovo slobodna (rezervisano 6)", Number((await lotStanje())?.rezervisano) === 6);
    provjeri("R-15: otkazana se ne otkazuje ponovo (409)", (await ana(`/isporuke/${i2.tijelo.id}/otkaz`, { telo: { razlog: "E2E opet" } })).status === 409);
    const s2 = (await pool.query(`select id from isporuka_stavka where isporuka_id = $1`, [i2.tijelo.id])).rows[0];
    provjeri("R-15: otkazana se ne potvrđuje (409)", (await ana(`/isporuke/${i2.tijelo.id}/potvrda`, { telo: { stavke: [{ stavkaId: s2.id, isporucenaKolicina: 3 }] } })).status === 409);
    provjeri("R-15: direktor vidi otkaz u aktivnosti", (await direktor("/aktivnost")).tijelo.some((x) => x.opis.startsWith("Isporuka otkazana") && x.opis.includes("E2E kupac otkazao")));

    // ── R-14: otpis ispod rezervacije → obavještenje ────────────────────────────────────────
    await marko(`/lotovi/${lotR}/otpis`, { telo: { kolicina: 5, razlog: "E2E razbijeno" } });
    provjeri("R-14: otpis ispod rezervisanog — ko je isporuku spremio dobija obavještenje", (await ana("/obavjestenja")).tijelo.some((o) => o.izvor_id === i1.tijelo.id && o.naslov.startsWith("Nema dovoljno robe")));
    await izm(5);

    // ── R-21: otpremnica ────────────────────────────────────────────────────────────────────
    const otp = await ana(`/isporuke/${i1.tijelo.id}/otpremnica`);
    provjeri(
      "R-21: otpremnica nosi firmu, PIB i adresu isporuke kupca, lot i rok",
      otp.status === 200 && !!otp.tijelo.firma && otp.tijelo.isporuka.kupac_pib === pibKupca && otp.tijelo.isporuka.kupac_adresa_isporuke?.includes("Zelenika") &&
        otp.tijelo.stavke[0]?.broj_lota === `${oznaka}-R` && !!otp.tijelo.stavke[0]?.rok_trajanja,
      JSON.stringify(otp.tijelo?.stavke?.[0]),
    );
    provjeri("R-21: vozač ne čita otpremnicu tuđe isporuke (404)", (await petar(`/isporuke/${i1.tijelo.id}/otpremnica`)).status === 404);

    // Predaja I1 — da povlačenje ima kupca.
    const s1 = (await pool.query(`select id from isporuka_stavka where isporuka_id = $1`, [i1.tijelo.id])).rows[0];
    const predaja = await ana(`/isporuke/${i1.tijelo.id}/potvrda`, { telo: { stavke: [{ stavkaId: s1.id, isporucenaKolicina: 5 }] } });
    provjeri("Priprema: isporuka predata", predaja.status === 200, `${predaja.status} ${predaja.tijelo?.error?.message ?? ""}`);

    // ── R-17: ista serija opet, drugi rok; povlačenje cijele serije ─────────────────────────
    const p2 = await prijem([{ artikalId: a.tijelo.id, brojLota: `${oznaka}-R`, primljenaKolicina: 4, rokTrajanja: rokZaDana(90) }]);
    provjeri("R-17: ista serija, drugi rok — prima se, uz upozorenje", p2.status === 201 && p2.tijelo.upozorenja?.length === 1, JSON.stringify(p2.tijelo?.upozorenja));
    provjeri("R-17: …odgovorno lice dobija obavještenje", (await ana("/obavjestenja")).tijelo.some((o) => o.izvor_id === p2.tijelo.id && o.naslov.startsWith("Ista serija")));
    const lotR2 = (await lotoviPrijema(p2.tijelo.id))[`${oznaka}-R`];
    await prihvati(p2.tijelo.id, lotR2, 4);
    const pov = await ana(`/sledljivost/lot/${lotR2}/povlacenje`, { telo: { razlog: "E2E serija sporna" } });
    trag.povlacenja.push(pov.tijelo?.id);
    provjeri("R-17: povlačenje iz drugog prijema obuhvata cijelu seriju (2 lota)", pov.status === 201 && pov.tijelo.lotovaUSeriji === 2, JSON.stringify(pov.tijelo));
    provjeri("R-17: …i kupca kome je otišla roba iz PRVOG prijema", pov.tijelo.brojKontakata >= 1);
    const statusi = (await pool.query(`select status from lot where id = any($1)`, [[lotR, lotR2]])).rows.map((r) => r.status);
    provjeri("R-17: oba lota serije su zadržana", statusi.length === 2 && statusi.every((s) => s === "HOLD"), statusi.join(","));
    const pusti = await ana(`/prijem/${p1.tijelo.id}/lot/${lotR}/odluka`, { method: "PATCH", telo: { odluka: "PRIHVATI", kolicina: 0, napomena: "E2E pokušaj puštanja" } });
    provjeri("R-17: lot serije se ne pušta dok je povlačenje u toku (409)", pusti.status === 409 && pusti.tijelo.error.code === "LOT_POD_POVLACENJEM");
  } finally {
    const k = await pool.connect();
    try {
      await k.query("begin");
      const artikli = trag.artikli.filter(Boolean);
      const lotovi = (await k.query(`select id from lot where artikal_id = any($1)`, [artikli])).rows.map((r) => r.id);
      const prijemi = trag.prijemi.filter(Boolean);
      const isporuke = trag.isporuke.filter(Boolean);
      const povlacenja = trag.povlacenja.filter(Boolean);
      const nc = (await k.query(`select id from neusaglasenost where izvor_id = any($1)`, [[...povlacenja, ...isporuke, ...lotovi]])).rows.map((r) => r.id);
      const pravila = (await k.query(`select id from pravilo_kontrole where artikal_id = any($1)`, [artikli])).rows.map((r) => r.id);
      const sve = [...artikli, ...lotovi, ...prijemi, ...isporuke, ...povlacenja, ...nc, ...pravila, ...trag.kupci.filter(Boolean), ...trag.dobavljaci.filter(Boolean)];
      await k.query(`delete from obavjestenje where izvor_id = any($1)`, [sve]);
      await k.query(`delete from audit_log where entitet_id = any($1)`, [sve]);
      await k.query(`delete from zadatak where izvor_id = any($1)`, [sve]);
      await k.query(`delete from verifikacija where neusaglasenost_id = any($1)`, [nc]);
      await k.query(`delete from korektivna_mjera where neusaglasenost_id = any($1)`, [nc]);
      await k.query(`delete from neusaglasenost where id = any($1)`, [nc]);
      await k.query(`delete from povlacenje_kontakt where povlacenje_id = any($1)`, [povlacenja]);
      await k.query(`delete from povlacenje where id = any($1)`, [povlacenja]);
      await k.query(`delete from isporuka_stavka where isporuka_id = any($1)`, [isporuke]);
      await k.query(`delete from isporuka where id = any($1)`, [isporuke]);
      await k.query(`delete from kretanje_zalihe where lot_id = any($1)`, [lotovi]);
      await k.query(`delete from zaliha where lot_id = any($1)`, [lotovi]);
      await k.query(`delete from mjerenje_temperature where lot_id = any($1)`, [lotovi]);
      await k.query(`delete from prijem_stavka where prijem_id = any($1)`, [prijemi]);
      await k.query(`delete from lot where id = any($1)`, [lotovi]);
      await k.query(`delete from prijem where id = any($1)`, [prijemi]);
      await k.query(`delete from pravilo_kontrole where id = any($1)`, [pravila]);
      await k.query(`delete from artikal where id = any($1)`, [artikli]);
      await k.query(`delete from kupac where id = any($1)`, [trag.kupci.filter(Boolean)]);
      await k.query(`delete from dobavljac where id = any($1)`, [trag.dobavljaci.filter(Boolean)]);
      await k.query("commit");
    } catch (e) {
      await k.query("rollback");
      throw new Error(`Čišćenje nije uspjelo: ${e.message} ${JSON.stringify(trag)}`);
    } finally {
      k.release();
    }
  }
}
