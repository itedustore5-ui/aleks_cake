// Talas 3 popravki posle revizije 25.09.2026, u ateljeu (rezervacija, otkaz isporuke i otpremnica — R-14, R-15,
// R-21 — uklonjeni su sa isporukama, PLAN.md 8.3):
//   R-17 rok obavezan po artiklu; serija jednom po prijemu; ista serija sa drugim rokom — upozorenje;
//        povlačenje ide po SERIJI (svi prijemi istog lota) i zove kupce torti iz PRVOG prijema;
//   R-28 PIB kupca, jedinstven PIB kupca i dobavljača.
// Test pravi svoje artikle, dobavljača i kupce, pa sve briše po njima.
import { pool, prijava, NALOZI, danasCG, glavnoSkladiste, rokZaDana } from "./pomoc.mjs";

export const naziv = "Talas 3: serija i rok, povlačenje serije, PIB";

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const marko = await prijava(NALOZI.marko);
  const sufiks = Date.now().toString(36).toUpperCase();
  const oznaka = `E2E-T3-${sufiks}`;
  // PIB od 8 cifara, jedinstven za ovaj prolaz.
  const pib = (n) => String(90000000 + ((Date.now() + n) % 9999999)).slice(0, 8);
  const trag = { artikli: [], dobavljaci: [], kupci: [], prijemi: [], porudzbine: [], povlacenja: [] };

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

    // Torta sa serijom iz prvog prijema, predata kupcu — da povlačenje ima koga da zove.
    const torta = await marko("/porudzbine", { telo: { kupacIme: `${oznaka} Kupac torte`, kupacTelefon: "067 444 555", preuzimanjeDatum: danasCG(), preuzimanjeVrijeme: "23:40", opis: "E2E torta sa keksom" } });
    trag.porudzbine.push(torta.tijelo?.id);
    await marko(`/porudzbine/${torta.tijelo.id}/lotovi`, { telo: { lotId: lotR } });
    await marko(`/porudzbine/${torta.tijelo.id}/alergeni`, { telo: { alergeni: [], bezAlergena: true } });
    const predaja = await marko(`/porudzbine/${torta.tijelo.id}/predaja`, { telo: { preuzeoIme: "E2E kupac" } });
    provjeri("Priprema: torta sa serijom R predata", predaja.status === 200, `${predaja.status} ${predaja.tijelo?.error?.message ?? ""}`);

    // ── R-17: ista serija opet, drugi rok; povlačenje cijele serije ─────────────────────────
    const p2 = await prijem([{ artikalId: a.tijelo.id, brojLota: `${oznaka}-R`, primljenaKolicina: 4, rokTrajanja: rokZaDana(90) }]);
    provjeri("R-17: ista serija, drugi rok — prima se, uz upozorenje", p2.status === 201 && p2.tijelo.upozorenja?.length === 1, JSON.stringify(p2.tijelo?.upozorenja));
    provjeri("R-17: …odgovorno lice dobija obavještenje", (await ana("/obavjestenja")).tijelo.some((o) => o.izvor_id === p2.tijelo.id && o.naslov.startsWith("Ista serija")));
    const lotR2 = (await lotoviPrijema(p2.tijelo.id))[`${oznaka}-R`];
    await prihvati(p2.tijelo.id, lotR2, 4);
    const pov = await ana(`/sledljivost/lot/${lotR2}/povlacenje`, { telo: { razlog: "E2E serija sporna" } });
    trag.povlacenja.push(pov.tijelo?.id);
    provjeri("R-17: povlačenje iz drugog prijema obuhvata cijelu seriju (2 lota)", pov.status === 201 && pov.tijelo.lotovaUSeriji === 2, JSON.stringify(pov.tijelo));
    provjeri("R-17: …i kupca kome je otišla torta sa lotom iz PRVOG prijema", pov.tijelo.brojKontakata === 1, `${pov.tijelo?.brojKontakata}`);
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
      const porudzbine = trag.porudzbine.filter(Boolean);
      const povlacenja = trag.povlacenja.filter(Boolean);
      const nc = (await k.query(`select id from neusaglasenost where izvor_id = any($1)`, [[...povlacenja, ...porudzbine, ...lotovi]])).rows.map((r) => r.id);
      const pravila = (await k.query(`select id from pravilo_kontrole where artikal_id = any($1)`, [artikli])).rows.map((r) => r.id);
      const sve = [...artikli, ...lotovi, ...prijemi, ...porudzbine, ...povlacenja, ...nc, ...pravila, ...trag.kupci.filter(Boolean), ...trag.dobavljaci.filter(Boolean)];
      await k.query(`delete from obavjestenje where izvor_id = any($1)`, [sve]);
      await k.query(`delete from audit_log where entitet_id = any($1)`, [sve]);
      await k.query(`delete from zadatak where izvor_id = any($1)`, [sve]);
      await k.query(`delete from verifikacija where neusaglasenost_id = any($1)`, [nc]);
      await k.query(`delete from korektivna_mjera where neusaglasenost_id = any($1)`, [nc]);
      await k.query(`delete from neusaglasenost where id = any($1)`, [nc]);
      await k.query(`delete from povlacenje_kontakt where povlacenje_id = any($1)`, [povlacenja]);
      await k.query(`delete from povlacenje where id = any($1)`, [povlacenja]);
      await k.query(`delete from porudzbina_lot where porudzbina_id = any($1)`, [porudzbine]);
      await k.query(`delete from porudzbina where id = any($1)`, [porudzbine]);
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
