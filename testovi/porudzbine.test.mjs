// Porudžbina torte (poslastičarnica, dopuna 39): kupac sa telefonom (#4), alergeni iz sastojaka i potvrda prije
// predaje (P1), serije sastojaka u torti (P2), predaja sa temperaturom kod dostave (P3), zadržan sastojak
// zaustavlja predaju, sledljivost lot → torte → kupci i povlačenje koje zove kupce torti. Pravi svoje
// artikle, lotove i termometar i briše sve što napravi.
import { pool, prijava, NALOZI, danasCG, rokZaDana } from "./pomoc.mjs";

export const naziv = "Porudžbine torti: alergeni, sastojci po seriji, predaja, sledljivost i povlačenje";

const OZNAKA = `E2E-PRD-${Date.now().toString(36)}`;

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const marko = await prijava(NALOZI.marko);
  const konsultant = await prijava(NALOZI.konsultant);
  const trag = { artikli: [], prijem: null, lotovi: [], porudzbine: [], uredjaj: null, povlacenje: null, nc: [], kljuc: `${OZNAKA}-kljuc-1` };

  try {
    // ── Alergeni na artiklu (dopuna 38) ──
    const jaja = await ana("/artikli", { telo: { naziv: `${OZNAKA} Jaja M`, jedinicaMjere: "kom", alergeni: ["JAJA"] } });
    const pavlaka = await ana("/artikli", { telo: { naziv: `${OZNAKA} Pavlaka 35%`, jedinicaMjere: "l", alergeni: ["MLIJEKO"] } });
    const secer = await ana("/artikli", { telo: { naziv: `${OZNAKA} Šećer`, jedinicaMjere: "kg" } });
    trag.artikli.push(jaja.tijelo?.id, pavlaka.tijelo?.id, secer.tijelo?.id);
    provjeri("Artikal se upisuje sa alergenima", jaja.status === 201 && pavlaka.status === 201 && secer.status === 201);
    const artikli = (await ana("/artikli")).tijelo;
    const aj = artikli.find((a) => a.id === jaja.tijelo.id);
    const as = artikli.find((a) => a.id === secer.tijelo.id);
    provjeri("…alergeni upisani (Jaja), a bez spiska — „nisu upisani“", aj?.alergeni_upisani === true && aj.alergeni.join() === "JAJA" && as?.alergeni_upisani === false, JSON.stringify([aj?.alergeni, as?.alergeni_upisani]));
    const los = await ana("/artikli", { telo: { naziv: `${OZNAKA} Loš`, alergeni: ["KAKAO"] } });
    provjeri("Alergen van spiska od 14 se ne prima (400)", los.status === 400);
    provjeri("Spisak 14 alergena vide svi prijavljeni", (await marko("/alergeni")).tijelo?.length === 14);

    // Lotovi sastojaka (kao poslije prijema i odluke): tri prihvaćena, istekao i zadržan.
    const dobavljac = (await pool.query(`select id from dobavljac where aktivan order by naziv limit 1`)).rows[0].id;
    trag.prijem = (await pool.query(`insert into prijem (dobavljac_id, broj_dokumenta, datum_prijema, status, primio_korisnik_id) values ($1, $2, $3, 'PRIHVACEN', $4) returning id`, [dobavljac, OZNAKA, danasCG(), NALOZI.marko.id])).rows[0].id;
    const lot = async (artikalId, broj, rok, status = "PRIHVACEN") => {
      const id = (await pool.query(
        `insert into lot (artikal_id, dobavljac_id, prijem_id, broj_lota, rok_trajanja, status, primljena_kolicina, prihvacena_kolicina) values ($1, $2, $3, $4, $5, $6, 30, 30) returning id`,
        [artikalId, dobavljac, trag.prijem, broj, rok, status],
      )).rows[0].id;
      await pool.query(`insert into zaliha (lot_id, artikal_id, kolicina, status) values ($1, $2, 30, $3)`, [id, artikalId, status === "HOLD" ? "KARANTIN" : "DOSTUPNO"]);
      trag.lotovi.push(id);
      return id;
    };
    const lotJaja = await lot(jaja.tijelo.id, `${OZNAKA}-J1`, rokZaDana(10));
    const lotPavlaka = await lot(pavlaka.tijelo.id, `${OZNAKA}-P1`, rokZaDana(5));
    const lotSecer = await lot(secer.tijelo.id, `${OZNAKA}-S1`, rokZaDana(300));
    const lotIstekao = await lot(jaja.tijelo.id, `${OZNAKA}-J0`, rokZaDana(-1));
    const lotZadrzan = await lot(pavlaka.tijelo.id, `${OZNAKA}-P0`, rokZaDana(5), "HOLD");

    // ── Porudžbina ──
    const sutra = rokZaDana(1);
    const osnova = { kupacIme: `${OZNAKA} Marija Petrović`, kupacTelefon: "067 123 456", preuzimanjeDatum: sutra, preuzimanjeVrijeme: "16:30", nacin: "DOSTAVA", adresaDostave: "Sala Montenegro, Bar", opis: "Svadbena torta, 3 sprata, krem od vanile, malina" };
    const bezTel = await marko("/porudzbine", { telo: { ...osnova, kupacTelefon: "" } });
    provjeri("#4: porudžbina bez telefona kupca se ne upisuje (400)", bezTel.status === 400, bezTel.tijelo?.error?.message);
    const bezAdrese = await marko("/porudzbine", { telo: { ...osnova, adresaDostave: " " } });
    provjeri("Dostava bez adrese se ne upisuje (400)", bezAdrese.status === 400 && bezAdrese.tijelo?.error?.code === "ADRESA_OBAVEZNA", bezAdrese.tijelo?.error?.code);
    const staro = await marko("/porudzbine", { telo: { ...osnova, preuzimanjeDatum: rokZaDana(-3) } });
    provjeri("#9: zaposleni ne upisuje porudžbinu od prije 3 dana (400)", staro.status === 400 && staro.tijelo?.error?.code === "DATUM_VAN_PROZORA");

    const nova = await marko("/porudzbine", { telo: osnova, zaglavlja: { "x-kljuc-zahtjeva": trag.kljuc } });
    trag.porudzbine.push(nova.tijelo?.id);
    provjeri("Zaposleni upisuje porudžbinu — broj PRD-…", nova.status === 201 && /^PRD-\d{6}-\d{3}$/.test(nova.tijelo?.broj ?? ""), JSON.stringify(nova.tijelo));
    const ponovo = await marko("/porudzbine", { telo: osnova, zaglavlja: { "x-kljuc-zahtjeva": trag.kljuc } });
    provjeri("#52: isti ključ zahtjeva — ista porudžbina, ne druga", ponovo.status === 201 && ponovo.tijelo?.id === nova.tijelo.id);
    const id = nova.tijelo.id;

    provjeri("Konsultant vidi porudžbine ateljea", (await konsultant("/porudzbine")).tijelo?.some((p) => p.id === id));
    const lista = (await ana("/porudzbine")).tijelo;
    const red = lista.find((p) => p.id === id);
    provjeri("P5: odgovorno lice vidi porudžbinu koju je upisao zaposleni, sa danom i vremenom", red?.dan === sutra && red.vrijeme === "16:30", JSON.stringify(red && { dan: red.dan, vrijeme: red.vrijeme }));

    const sastojci = (await marko("/porudzbine/sastojci")).tijelo.map((l) => l.lot_id);
    provjeri("Za izbor se nude prihvaćeni lotovi, ne istekao ni zadržan", sastojci.includes(lotJaja) && !sastojci.includes(lotIstekao) && !sastojci.includes(lotZadrzan));
    const istekao = await marko(`/porudzbine/${id}/lotovi`, { telo: { lotId: lotIstekao } });
    provjeri("Istekao sastojak ne ide u tortu (409)", istekao.status === 409 && istekao.tijelo?.error?.code === "ROK_ISTEKAO", istekao.tijelo?.error?.message);
    const zadrzan = await marko(`/porudzbine/${id}/lotovi`, { telo: { lotId: lotZadrzan } });
    provjeri("Zadržan sastojak ne ide u tortu (409)", zadrzan.status === 409 && zadrzan.tijelo?.error?.code === "LOT_NIJE_PRIHVACEN");
    await marko(`/porudzbine/${id}/lotovi`, { telo: { lotId: lotJaja } });
    await marko(`/porudzbine/${id}/lotovi`, { telo: { lotId: lotSecer } });
    let detalj = (await marko(`/porudzbine/${id}`)).tijelo;
    provjeri("P2: torta ima dvije serije sastojaka", detalj.lotovi?.length === 2);
    provjeri("Predlog alergena dolazi iz sastojaka (Jaja)", detalj.predlog?.join() === "JAJA", detalj.predlog?.join());
    provjeri("…i kaže koji sastojak nema upisane alergene (Šećer)", detalj.sastojciBezAlergena?.some((s) => s.includes("Šećer")));

    const rano = await marko(`/porudzbine/${id}/predaja`, { telo: { temperatura: 3 } });
    provjeri("P1: predaja bez potvrđenih alergena se ne prima (409)", rano.status === 409 && rano.tijelo?.error?.code === "ALERGENI_NISU_POTVRDJENI", rano.tijelo?.error?.code);
    const izostavljen = await marko(`/porudzbine/${id}/alergeni`, { telo: { alergeni: ["MLIJEKO"] } });
    provjeri("P1: alergen iz sastojka (Jaja) se ne može izostaviti (409)", izostavljen.status === 409 && izostavljen.tijelo?.error?.code === "ALERGEN_IZ_SASTOJKA" && /Jaja/.test(izostavljen.tijelo.error.message), izostavljen.tijelo?.error?.message);
    const potvrda = await marko(`/porudzbine/${id}/alergeni`, { telo: { alergeni: ["ORASASTI", "JAJA"] } });
    provjeri("Zaposleni potvrđuje alergene (i dodaje orašaste iz dekoracije)", potvrda.status === 200 && potvrda.tijelo?.alergeni?.join() === "JAJA,ORASASTI", JSON.stringify(potvrda.tijelo));

    const dodata = await marko(`/porudzbine/${id}/lotovi`, { telo: { lotId: lotPavlaka } });
    provjeri("Nov sastojak sa novim alergenom (Mlijeko) poništava potvrdu", dodata.tijelo?.potvrdaPonistena === true && dodata.tijelo.noviAlergeni?.join() === "MLIJEKO", JSON.stringify(dodata.tijelo));
    const posleDodavanja = await marko(`/porudzbine/${id}/predaja`, { telo: { temperatura: 3 } });
    provjeri("…pa se predaja ne prima dok se ponovo ne potvrdi (409)", posleDodavanja.status === 409 && posleDodavanja.tijelo?.error?.code === "ALERGENI_NISU_POTVRDJENI");
    await marko(`/porudzbine/${id}/alergeni`, { telo: { alergeni: ["JAJA", "MLIJEKO", "ORASASTI"] } });

    // Termometar (#60) — ispravan, samo za ovaj test.
    const ur = await ana("/mjerni-uredjaji", { telo: { naziv: `${OZNAKA} termometar`, oznaka: "T-PRD", intervalProvjereMjeseci: 1 } });
    trag.uredjaj = ur.tijelo?.id;
    await marko(`/mjerni-uredjaji/${trag.uredjaj}/provjera`, { telo: { datum: danasCG(), vrsta: "INTERNA", referentna: 0, izmjereno: 0.1 } });

    const bezTemp = await marko(`/porudzbine/${id}/predaja`, { telo: { mjerniUredjajId: trag.uredjaj } });
    provjeri("Dostava bez temperature pri predaji se ne prima (400)", bezTemp.status === 400 && bezTemp.tijelo?.error?.code === "TEMPERATURA_OBAVEZNA", bezTemp.tijelo?.error?.code);
    const bezTermometra = await marko(`/porudzbine/${id}/predaja`, { telo: { temperatura: 3 } });
    provjeri("#60: temperatura bez termometra se ne prima kad firma ima termometar (400)", bezTermometra.status === 400 && bezTermometra.tijelo?.error?.code === "TERMOMETAR_OBAVEZAN");
    const predaja = await marko(`/porudzbine/${id}/predaja`, { telo: { temperatura: 3, mjerniUredjajId: trag.uredjaj, preuzeoIme: "Jovan, menadžer sale" } });
    provjeri(
      "Predaja sa temperaturom — PREDATA, ocijenjeno po pravilu KKT 3",
      predaja.status === 200 && predaja.tijelo?.status === "PREDATA" && (["PASS", "WARNING"].includes(predaja.tijelo.rezultat) || predaja.tijelo.bezGranice === true),
      JSON.stringify(predaja.tijelo),
    );
    detalj = (await ana(`/porudzbine/${id}`)).tijelo;
    provjeri("…potpis je ime: ko je predao, kome, termometar i mjerenje uz porudžbinu", detalj.status === "PREDATA" && detalj.predao && detalj.preuzeo_ime === "Jovan, menadžer sale" && detalj.termometar && (detalj.mjerenje_id || predaja.tijelo.bezGranice));
    const dvaput = await marko(`/porudzbine/${id}/predaja`, { telo: { temperatura: 3, mjerniUredjajId: trag.uredjaj } });
    provjeri("Predata se ne predaje dvaput (409)", dvaput.status === 409 && dvaput.tijelo?.error?.code === "PORUDZBINA_PREDATA");
    const izmjenaPredate = await marko(`/porudzbine/${id}`, { method: "PATCH", telo: osnova });
    provjeri("Predata se ne mijenja (409)", izmjenaPredate.status === 409);

    // ── Sledljivost i povlačenje ──
    const lanac = (await ana(`/sledljivost/lot/${lotJaja}/porudzbine`)).tijelo;
    provjeri("Sledljivost: serija jaja → torta → kupac sa telefonom", lanac.some((t) => t.porudzbina_id === id && t.kupac_telefon === "067 123 456"));
    provjeri("Pretraga po telefonu kupca nalazi tortu", (await ana(`/porudzbine/pretraga?q=${encodeURIComponent("123 456")}`)).tijelo.some((p) => p.id === id));

    // Druga torta sa istim jajima, još u izradi — povlačenje je zaustavlja.
    const druga = await marko("/porudzbine", { telo: { ...osnova, kupacIme: `${OZNAKA} Petar Marković`, kupacTelefon: "069 555 777", nacin: "PREUZIMA", adresaDostave: undefined, opis: "Rođendanska, čokolada" } });
    trag.porudzbine.push(druga.tijelo?.id);
    await marko(`/porudzbine/${druga.tijelo.id}/lotovi`, { telo: { lotId: lotJaja } });
    await marko(`/porudzbine/${druga.tijelo.id}/alergeni`, { telo: { alergeni: ["JAJA"] } });
    provjeri("Zaposleni počinje izradu", (await marko(`/porudzbine/${druga.tijelo.id}/izrada`, { telo: {} })).status === 204);

    const pv = await ana(`/sledljivost/lot/${lotJaja}/povlacenje`, { telo: { razlog: `${OZNAKA}: sumnja na salmonelu` } });
    trag.povlacenje = pv.tijelo?.id;
    if (pv.tijelo?.neusaglasenostId) trag.nc.push(pv.tijelo.neusaglasenostId);
    provjeri("Povlačenje serije jaja", pv.status === 201, JSON.stringify(pv.tijelo));
    const kontakti = (await ana(`/povlacenja/${trag.povlacenje}`)).tijelo?.kontakti ?? [];
    const kontakt = kontakti.find((k) => k.porudzbina_id === id);
    provjeri("Povlačenje zove kupca PREDATE torte, sa telefonom i brojem porudžbine", kontakt?.kupac_telefon === "067 123 456" && kontakt.porudzbina_broj === nova.tijelo.broj, JSON.stringify(kontakt));
    provjeri("…a tortu u izradi ne broji kao kupca (još nije otišla)", !kontakti.some((k) => k.porudzbina_id === druga.tijelo.id));
    const obavjestenja = (await marko("/obavjestenja")).tijelo;
    provjeri("Ko je upisao tortu u izradi dobija „Ne predajte tortu“", obavjestenja.some((o) => o.izvor_id === druga.tijelo.id && o.naslov.startsWith("Ne predajte tortu")));
    const zaustavljena = await marko(`/porudzbine/${druga.tijelo.id}/predaja`, { telo: {} });
    provjeri("Torta sa zadržanim sastojkom se ne predaje (409)", zaustavljena.status === 409 && zaustavljena.tijelo?.error?.code === "SASTOJAK_ZADRZAN", zaustavljena.tijelo?.error?.message);

    const bezRazloga = await marko(`/porudzbine/${druga.tijelo.id}/otkaz`, { telo: { razlog: "ne" } });
    provjeri("Otkaz bez razloga se ne prima (400)", bezRazloga.status === 400);
    provjeri("Otkaz uz razlog", (await marko(`/porudzbine/${druga.tijelo.id}/otkaz`, { telo: { razlog: "Sastojak pod povlačenjem, kupac obaviješten" } })).status === 204);
    provjeri("Otkazana se ne predaje (409)", (await marko(`/porudzbine/${druga.tijelo.id}/predaja`, { telo: {} })).tijelo?.error?.code === "PORUDZBINA_OTKAZANA");

    // ── Reklamacija, izvoz, audit ──
    const rekl = await marko("/neusaglasenosti", { telo: { opis: `${OZNAKA}: kupac javio da je krem bio kiseo`, izvorTip: "porudzbina", izvorId: id } });
    if (rekl.tijelo?.id) trag.nc.push(rekl.tijelo.id);
    provjeri("Reklamacija na torti je neusaglašenost vezana za porudžbinu", rekl.status === 201, JSON.stringify(rekl.tijelo));
    const izvoz = (await konsultant("/izvoz/porudzbine/pregled")).tijelo?.redovi ?? [];
    const uIzvozu = izvoz.find((r) => r.Broj === nova.tijelo.broj);
    provjeri("Izvoz: porudžbina sa alergenima i serijama sastojaka", uIzvozu?.Alergeni === "Jaja, Mlijeko, Orašasti plodovi" && /lot/.test(uIzvozu["Sastojci po seriji"] ?? ""), JSON.stringify(uIzvozu));
    const audit = (await pool.query(`select akcija from audit_log where entitet_tip = 'porudzbina' and entitet_id = $1`, [id])).rows.map((r) => r.akcija);
    provjeri("Audit: upis, sastojci, potvrda alergena i predaja", audit.includes("KREIRANJE") && audit.includes("IZMJENA") && audit.includes("PROMJENA_STATUSA"), audit.join(","));
  } finally {
    const k = await pool.connect();
    try {
      await k.query("begin");
      const porudzbine = trag.porudzbine.filter(Boolean);
      const mjerenja = (await k.query(`select id from mjerenje_temperature where mjerni_uredjaj_id = $1 or id in (select mjerenje_id from porudzbina where id = any($2))`, [trag.uredjaj, porudzbine])).rows.map((r) => r.id);
      const nc = [...new Set([...trag.nc, ...(await k.query(`select id from neusaglasenost where izvor_id = any($1)`, [[...mjerenja, ...porudzbine, trag.povlacenje].filter(Boolean)])).rows.map((r) => r.id)])];
      const zadaci = (await k.query(`select id from zadatak where izvor_id = any($1)`, [[...nc, trag.povlacenje].filter(Boolean)])).rows.map((r) => r.id);
      const provjere = trag.uredjaj ? (await k.query(`select id from provjera_uredjaja where uredjaj_id = $1`, [trag.uredjaj])).rows.map((r) => r.id) : [];
      const pravila = (await k.query(`select id from pravilo_kontrole where artikal_id = any($1)`, [trag.artikli.filter(Boolean)])).rows.map((r) => r.id);
      const sve = [...trag.artikli, ...trag.lotovi, ...porudzbine, ...mjerenja, ...nc, ...zadaci, ...provjere, ...pravila, trag.prijem, trag.uredjaj, trag.povlacenje].filter(Boolean);
      await k.query(`delete from obavjestenje where izvor_id = any($1)`, [sve]);
      await k.query(`delete from obavjestenje where naslov like 'Ne predajte tortu%' and poruka like $1`, [`%${OZNAKA}%`]);
      await k.query(`delete from audit_log where entitet_id = any($1)`, [sve]);
      await k.query(`delete from zadatak where id = any($1)`, [zadaci]);
      await k.query(`delete from verifikacija where neusaglasenost_id = any($1)`, [nc]);
      await k.query(`delete from korektivna_mjera where neusaglasenost_id = any($1)`, [nc]);
      await k.query(`delete from neusaglasenost where id = any($1)`, [nc]);
      if (trag.povlacenje) {
        await k.query(`delete from povlacenje_kontakt where povlacenje_id = $1`, [trag.povlacenje]);
        await k.query(`delete from povlacenje where id = $1`, [trag.povlacenje]);
      }
      await k.query(`delete from porudzbina_lot where porudzbina_id = any($1)`, [porudzbine]);
      await k.query(`update porudzbina set mjerenje_id = null where id = any($1)`, [porudzbine]);
      await k.query(`delete from mjerenje_temperature where id = any($1)`, [mjerenja]);
      await k.query(`delete from porudzbina where id = any($1)`, [porudzbine]);
      await k.query(`delete from kljuc_zahtjeva where kljuc = $1`, [trag.kljuc]);
      await k.query(`delete from kretanje_zalihe where lot_id = any($1)`, [trag.lotovi]);
      await k.query(`delete from zaliha where lot_id = any($1)`, [trag.lotovi]);
      await k.query(`delete from lot where id = any($1)`, [trag.lotovi]);
      if (trag.prijem) await k.query(`delete from prijem where id = $1`, [trag.prijem]);
      await k.query(`delete from pravilo_kontrole where id = any($1)`, [pravila]);
      await k.query(`delete from provjera_uredjaja where id = any($1)`, [provjere]);
      if (trag.uredjaj) await k.query(`delete from mjerni_uredjaj where id = $1`, [trag.uredjaj]);
      await k.query(`delete from artikal where id = any($1) or naziv like $2`, [trag.artikli.filter(Boolean), `${OZNAKA}%`]);
      await k.query("commit");
    } catch (e) {
      await k.query("rollback");
      throw new Error(`Čišćenje nije uspjelo: ${e.message} ${JSON.stringify(trag)}`);
    } finally {
      k.release();
    }
  }
}
