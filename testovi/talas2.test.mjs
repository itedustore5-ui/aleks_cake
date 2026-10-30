// Talas 2 popravki posle revizije 25.09.2026:
//   (R-05 — D1 i vozila — uklonjeno sa vozilima u ateljeu, PLAN.md 8.3)
//   R-06 izmjena pamti „prije" (artikal, stavka prijema, zadatak);
//   R-07 ispravka zapisa: jednom, istog obrasca, svog zapisa; odstupanje uneseno ispravkom otvara neusaglašenost;
//   R-08 odstupanje slijedi iz odgovora u obrascu, ne samo iz kvačice;
//   R-09 ručno mjerenje lota po granici njegovog artikla;
//   R-20 izvoz: provjere neusaglašenosti, termometri, verifikacija sistema, kretanja zaliha;
//   R-22 neusaglašenost iz kontrole se zatvara tek kad ponovna kontrola prođe;
//   R-23 mjerenje pamti termometar; neispravan termometar se ne koristi, a njegova mjerenja su „upitna".
// Test pravi svoj artikal, termometar i kontrolnu tačku, pa sve briše po njima.
import { pool, prijava, NALOZI, danasCG, glavnoSkladiste, preuzmi, rokZaDana } from "./pomoc.mjs";

export const naziv = "Talas 2: audit prije, ispravka i odstupanje zapisa, mjerenje, termometar, ponovna kontrola, izvoz";

const zadnjiAudit = async (entitetId) =>
  (await pool.query(`select akcija, stare_vrijednosti as s, nove_vrijednosti as n from audit_log where entitet_id = $1 and akcija = 'IZMJENA' order by created_at desc limit 1`, [entitetId])).rows[0];

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const konsultant = await prijava(NALOZI.konsultant);
  const marko = await prijava(NALOZI.marko);
  const oznaka = `E2E-T2-${Date.now().toString(36).toUpperCase()}`;
  const trag = { artikal: null, uredjaj: null, tacka: null, prijemi: [], zapisi: [], nc: [], zadaci: [] };

  // Mjera → završava je drugo lice → provjera (četiri oka).
  const mjeraIZavrsi = async (ncId, izvrsilac) => {
    const m = await ana(`/neusaglasenosti/${ncId}/korektivna-mjera`, { telo: { opis: "E2E mjera", dodijeljenoKorisnikId: izvrsilac.id } });
    await izvrsilac(`/korektivne-mjere/${m.tijelo.id}/zavrsi`, { telo: { rezultat: "E2E urađeno" } });
  };
  const zatvori = (ncId) => ana(`/neusaglasenosti/${ncId}/verifikacija`, { telo: { rezultat: "POTVRDJENO", napomena: "E2E pregledano" } });

  try {
    const dobavljac = (await ana("/dobavljaci")).tijelo[0];
    const skladisteId = await glavnoSkladiste(marko);

    // ── R-23: termometar ────────────────────────────────────────────────────────────────────
    const ur = await ana("/mjerni-uredjaji", { telo: { naziv: `${oznaka} termometar`, oznaka: "T-E2E", intervalProvjereMjeseci: 1 } });
    trag.uredjaj = ur.tijelo?.id;
    await marko(`/mjerni-uredjaji/${trag.uredjaj}/provjera`, { telo: { datum: danasCG(), vrsta: "INTERNA", referentna: 0, izmjereno: 0.2 } });
    provjeri("R-23: termometar je na spisku za mjerenje (i za zaposlenog)", (await marko("/termometri")).tijelo.some((t) => t.id === trag.uredjaj));

    // Artikal pod režimom 0–4 °C, prijem sa termometrom (R-23): stavka A se prihvata, B čeka odluku.
    const a = await ana("/artikli", { telo: { naziv: `${oznaka} jogurt`, tempKontrolisano: true, tempMin: 0, tempMax: 4, granicaPotvrdio: true } });
    trag.artikal = a.tijelo?.id;
    const pr = await marko("/prijem", {
      telo: {
        dobavljacId: dobavljac.id, brojDokumenta: oznaka, datumPrijema: danasCG(), skladisteId, mjerniUredjajId: trag.uredjaj,
        stavke: [
          { artikalId: trag.artikal, brojLota: `${oznaka}-LA`, primljenaKolicina: 10, temperaturaPrijema: 2, rokTrajanja: rokZaDana(20) },
          { artikalId: trag.artikal, brojLota: `${oznaka}-LB`, primljenaKolicina: 5, temperaturaPrijema: 2, rokTrajanja: rokZaDana(20) },
        ],
      },
    });
    trag.prijemi.push(pr.tijelo?.id);
    const lotovi = (await pool.query(`select id, broj_lota from lot where prijem_id = $1`, [pr.tijelo.id])).rows;
    const lotA = lotovi.find((l) => l.broj_lota.endsWith("-LA")).id;
    const lotB = lotovi.find((l) => l.broj_lota.endsWith("-LB")).id;
    const kkt1Uredjaj = (await pool.query(`select mjerni_uredjaj_id from mjerenje_temperature where lot_id = $1`, [lotA])).rows[0]?.mjerni_uredjaj_id;
    provjeri("R-23: mjerenje pri prijemu pamti termometar", kkt1Uredjaj === trag.uredjaj);
    await ana(`/prijem/${pr.tijelo.id}/lot/${lotA}/odluka`, { method: "PATCH", telo: { odluka: "PRIHVATI", kolicina: 10 } });

    // ── R-06 za zadatak ─────────────────────────────────────────────────────────────────────
    const zad = await ana("/zadaci", { telo: { naslov: `${oznaka} provjeriti vitrinu` } });
    trag.zadaci.push(zad.tijelo?.id);
    await ana(`/zadaci/${zad.tijelo.id}`, { method: "PATCH", telo: { dodijeljenoKorisnikId: marko.id } });
    const az = await zadnjiAudit(zad.tijelo.id);
    provjeri("R-06: prebačen zadatak — audit pamti kome je bio i kome je sada", az?.s?.dodijeljeno_korisnik_id === null && az?.n?.dodijeljeno_korisnik_id === marko.id, JSON.stringify(az));

    // ── R-06: izmjene pamte „prije" ─────────────────────────────────────────────────────────
    await ana(`/artikli/${trag.artikal}`, { method: "PATCH", telo: { naziv: `${oznaka} jogurt 2,8%` } });
    const aa = await zadnjiAudit(trag.artikal);
    provjeri("R-06: izmjena artikla — stari naziv je sačuvan", aa?.s?.naziv === `${oznaka} jogurt` && aa?.n?.naziv === `${oznaka} jogurt 2,8%`);
    await marko(`/prijem/${pr.tijelo.id}/lot/${lotB}`, { method: "PATCH", telo: { brojLota: `${oznaka}-LB2`, primljenaKolicina: 4 } });
    const al = await zadnjiAudit(lotB);
    provjeri("R-06: ispravka stavke prijema — stari lot i količina", al?.s?.broj_lota === `${oznaka}-LB` && Number(al?.s?.primljena_kolicina) === 5 && Number(al?.n?.primljena_kolicina) === 4, JSON.stringify(al));
    const auditEkran = (await konsultant("/audit?entitetTip=artikal")).tijelo.find((r) => r.entitet_id === trag.artikal && r.akcija === "IZMJENA");
    provjeri("R-06: ekran audita dobija i staru vrijednost", auditEkran?.stare_vrijednosti?.naziv === `${oznaka} jogurt`);

    // ── R-09 + R-22 za mjerenje lota ────────────────────────────────────────────────────────
    const t = await ana("/kontrolne-tacke", { telo: { sifra: `E${Date.now().toString(36).slice(-5).toUpperCase()}`, naziv: `${oznaka} komora` } });
    trag.tacka = t.tijelo?.id;
    await ana("/pravila-kontrole", { telo: { kontrolnaTackaId: trag.tacka, naziv: "E2E komora opšte 0–8", minVrijednost: 0, maxVrijednost: 8 } });
    await ana("/pravila-kontrole", { telo: { kontrolnaTackaId: trag.tacka, artikalId: trag.artikal, naziv: "E2E jogurt 0–4", minVrijednost: 0, maxVrijednost: 4, ozbiljnost: "VISOK" } });
    const mjeri = (telo) => marko("/mjerenja", { telo: { kontrolnaTackaId: trag.tacka, vrijednost: 6, ...telo } });
    const bezTermometra = await mjeri({});
    provjeri("R-23: bez izbora termometra — odbijeno (400)", bezTermometra.status === 400 && bezTermometra.tijelo.error.code === "TERMOMETAR_OBAVEZAN");
    const prostor = await mjeri({ mjerniUredjajId: trag.uredjaj });
    provjeri("R-09: komora bez lota — opšta granica 0–8: 6 °C prolazi", prostor.tijelo?.rezultat === "PASS", prostor.tijelo?.rezultat);
    const lotMjerenje = await mjeri({ lotId: lotA, mjerniUredjajId: trag.uredjaj });
    provjeri("R-09: isti 6 °C za lot jogurta — granica ARTIKLA 0–4: pada", lotMjerenje.tijelo?.rezultat === "FAIL", lotMjerenje.tijelo?.rezultat);
    trag.nc.push(lotMjerenje.tijelo?.neusaglasenostId);
    await mjeraIZavrsi(lotMjerenje.tijelo.neusaglasenostId, marko);
    const ranoLot = await zatvori(lotMjerenje.tijelo.neusaglasenostId);
    provjeri("R-22: lot još u magacinu — ne zatvara se bez novog mjerenja (409)", ranoLot.status === 409 && ranoLot.tijelo.error.code === "PONOVNA_KONTROLA_POTREBNA", ranoLot.tijelo?.error?.message);
    const ponovo = await mjeri({ lotId: lotA, vrijednost: 3, mjerniUredjajId: trag.uredjaj });
    provjeri("R-22: novo mjerenje zadržanog lota u granici", ponovo.tijelo?.rezultat === "PASS");
    provjeri("R-22: …tek tada se zatvara", (await zatvori(lotMjerenje.tijelo.neusaglasenostId)).tijelo?.status === "ZATVORENA");

    // ── R-23: termometar padne na provjeri ──────────────────────────────────────────────────
    const los = await marko(`/mjerni-uredjaji/${trag.uredjaj}/provjera`, { telo: { datum: danasCG(), vrsta: "INTERNA", referentna: 0, izmjereno: 1.5 } });
    provjeri("R-23: neispravan termometar broji mjerenja od posljednje dobre provjere", los.tijelo?.rezultat === "NEISPRAVAN" && los.tijelo.upitnaMjerenja >= 5, `${los.tijelo?.upitnaMjerenja}`);
    const upitna = (await marko("/mjerenja")).tijelo.filter((m) => m.upitno && m.termometar === `${oznaka} termometar`);
    provjeri("R-23: ta mjerenja su na listi označena kao upitna", upitna.length >= 3, `${upitna.length}`);
    const neispravnim = await mjeri({ mjerniUredjajId: trag.uredjaj });
    provjeri("R-23: neispravnim termometrom se više ne mjeri (409)", neispravnim.status === 409 && neispravnim.tijelo.error.code === "UREDJAJ_NEISPRAVAN");
    const ncTerm = (await pool.query(`select id, opis from neusaglasenost where izvor_tip = 'mjerni_uredjaj' and izvor_id = $1`, [trag.uredjaj])).rows[0];
    trag.nc.push(ncTerm?.id);
    provjeri("R-23: neusaglašenost kaže koliko je mjerenja upitno", /upitna: \d+/.test(ncTerm?.opis ?? ""), ncTerm?.opis);
    await mjeraIZavrsi(ncTerm.id, marko);
    provjeri("R-22: termometar se ne zatvara bez nove ispravne provjere (409)", (await zatvori(ncTerm.id)).status === 409);
    await marko(`/mjerni-uredjaji/${trag.uredjaj}/provjera`, { telo: { datum: danasCG(), vrsta: "INTERNA", referentna: 0, izmjereno: 0.1 } });
    provjeri("R-22: …posle ispravne provjere se zatvara", (await zatvori(ncTerm.id)).tijelo?.status === "ZATVORENA");

    // ── R-08: odstupanje iz odgovora ────────────────────────────────────────────────────────
    const zapis = async (k, telo) => {
      const r = await k("/zapisi", { telo: { datum: danasCG(), ...telo } });
      if (r.tijelo?.id) trag.zapisi.push(r.tijelo.id);
      return r;
    };
    const nepoznato = await zapis(marko, { obrazacKod: "P7", podaci: { tragovi: false, mjesto: "rampa", temperatura: 3 } });
    provjeri("R-08: polje koje obrazac nema se odbija (400)", nepoznato.status === 400 && nepoznato.tijelo.error.code === "POLJE_NEPOZNATO");
    const neodgovoreno = await zapis(marko, { obrazacKod: "P7", podaci: { mjesto: "rampa" } });
    provjeri("R-08: da/ne pitanje bez odgovora se odbija (400)", neodgovoreno.status === 400 && neodgovoreno.tijelo.error.code === "POLJE_OBAVEZNO");
    const skriveno = await zapis(marko, { obrazacKod: "P7", podaci: { tragovi: true, mjesto: "rampa" }, odstupanje: false });
    provjeri("R-08: „tragovi štetočina: da\" bez kvačice i bez mjere — odbijeno (400)", skriveno.status === 400 && skriveno.tijelo.error.code === "MJERA_OBAVEZNA" && skriveno.tijelo.error.details.odstupanja.length === 1);
    const p8 = await zapis(marko, { obrazacKod: "P8", podaci: { radna_odjeca: true, zdravstveno_stanje: false }, korektivnaMjera: "E2E radnik poslat ljekaru, ne radi sa hranom" });
    provjeri("R-08: „bez simptoma: ne\" — odstupanje se upisuje samo, uz neusaglašenost", p8.status === 201 && p8.tijelo.odstupanje === true && !!p8.tijelo.neusaglasenost);
    const ncP8 = (await pool.query(`select id, opis from neusaglasenost where izvor_tip = 'zapis' and izvor_id = $1`, [p8.tijelo.id])).rows[0];
    trag.nc.push(ncP8?.id);
    provjeri("R-08: neusaglašenost kaže iz kog odgovora", ncP8?.opis.includes("Bez simptoma"), ncP8?.opis);

    // ── R-07: ispravka zapisa ───────────────────────────────────────────────────────────────
    const uredu = await zapis(marko, { obrazacKod: "P7", podaci: { tragovi: false, mjesto: "E2E rampa" } });
    provjeri("R-07: zapis bez odstupanja", uredu.status === 201 && uredu.tijelo.neusaglasenost === null);
    const drugiObrazac = await zapis(marko, { obrazacKod: "P9", podaci: { kante_zatvorene: true, izneseno: true }, ispravljaId: uredu.tijelo.id });
    provjeri("R-07: ispravka drugim obrascem se odbija (400)", drugiObrazac.status === 400 && drugiObrazac.tijelo.error.code === "ISPRAVKA_DRUGI_OBRAZAC");
    const ispravka = await zapis(marko, { obrazacKod: "P7", podaci: { tragovi: true, mjesto: "E2E rampa" }, korektivnaMjera: "E2E klopke postavljene", ispravljaId: uredu.tijelo.id });
    provjeri("R-07: ispravka koja unosi odstupanje otvara neusaglašenost", ispravka.status === 201 && !!ispravka.tijelo.neusaglasenost, JSON.stringify(ispravka.tijelo));
    trag.nc.push((await pool.query(`select id from neusaglasenost where izvor_tip = 'zapis' and izvor_id = $1`, [ispravka.tijelo.id])).rows[0]?.id);
    const opet = await zapis(marko, { obrazacKod: "P7", podaci: { tragovi: false, mjesto: "E2E rampa" }, ispravljaId: uredu.tijelo.id });
    provjeri("R-07: isti zapis se ne ispravlja dvaput (409)", opet.status === 409 && opet.tijelo.error.code === "ZAPIS_VEC_ISPRAVLJEN");
    const naIspravku = await zapis(marko, { obrazacKod: "P7", podaci: { tragovi: true, mjesto: "E2E rampa i ulaz" }, korektivnaMjera: "E2E klopke i na ulazu", ispravljaId: ispravka.tijelo.id });
    provjeri("R-07: ispravka posljednje verzije ne otvara drugu neusaglašenost", naIspravku.status === 201 && naIspravku.tijelo.neusaglasenost === null);
    const anin = await zapis(ana, { obrazacKod: "P7", podaci: { tragovi: false, mjesto: "E2E ured" } });
    const tudji = await zapis(marko, { obrazacKod: "P7", podaci: { tragovi: false, mjesto: "E2E ured" }, ispravljaId: anin.tijelo.id });
    provjeri("R-07: zaposleni ne ispravlja tuđi zapis (403)", tudji.status === 403 && tudji.tijelo.error.code === "NIJE_VAS_ZAPIS");

    // ── R-20: izvoz ─────────────────────────────────────────────────────────────────────────
    const izvori = (await konsultant("/izvoz/izvori")).tijelo.map((i) => i.kod);
    provjeri("R-20: izvori za izvoz", ["provjere_nc", "termometri", "verifikacija_sistema", "kretanja_zalihe", "porudzbine"].every((k) => izvori.includes(k)) && !izvori.includes("kontrole_vozila"), izvori.join(","));
    const pregled = async (kod) => (await konsultant(`/izvoz/${kod}/pregled`)).tijelo?.redovi ?? [];
    provjeri("R-20: provjere neusaglašenosti u izvozu", (await pregled("provjere_nc")).some((r) => r.provjera === "POTVRDJENO" && r.neusaglasenost));
    provjeri("R-20: provjere termometra u izvozu", (await pregled("termometri")).some((r) => r.uredjaj === `${oznaka} termometar` && r.rezultat === "NEISPRAVAN"));
    provjeri("R-20: kretanja zaliha u izvozu", (await pregled("kretanja_zalihe")).some((r) => r.lot === `${oznaka}-LA` && r.tip === "PRIJEM"));
    provjeri("R-20: CSV verifikacije sistema se preuzima", (await preuzmi(konsultant, "/izvoz/verifikacija_sistema.csv")).status === 200);
  } finally {
    const k = await pool.connect();
    try {
      await k.query("begin");
      const lotovi = trag.artikal ? (await k.query(`select id from lot where artikal_id = $1`, [trag.artikal])).rows.map((r) => r.id) : [];
      const prijemi = trag.prijemi.filter(Boolean);
      const mjerenja = (
        await k.query(`select id from mjerenje_temperature where lot_id = any($1) or kontrolna_tacka_id = $2 or mjerni_uredjaj_id = $3`, [lotovi, trag.tacka, trag.uredjaj])
      ).rows.map((r) => r.id);
      const zapisi = trag.zapisi.filter(Boolean);
      const izvori = [...mjerenja, ...zapisi, trag.uredjaj].filter(Boolean);
      const nc = [...new Set([...trag.nc.filter(Boolean), ...(await k.query(`select id from neusaglasenost where izvor_id = any($1)`, [izvori])).rows.map((r) => r.id)])];
      const zadaci = [...trag.zadaci.filter(Boolean), ...(nc.length ? (await k.query(`select id from zadatak where izvor_id = any($1)`, [nc])).rows.map((r) => r.id) : [])];
      const mjere = nc.length ? (await k.query(`select id from korektivna_mjera where neusaglasenost_id = any($1)`, [nc])).rows.map((r) => r.id) : [];
      const provjere = trag.uredjaj ? (await k.query(`select id from provjera_uredjaja where uredjaj_id = $1`, [trag.uredjaj])).rows.map((r) => r.id) : [];
      const pravila = (await k.query(`select id from pravilo_kontrole where artikal_id = $1 or kontrolna_tacka_id = $2`, [trag.artikal, trag.tacka])).rows.map((r) => r.id);
      const sve = [trag.artikal, trag.uredjaj, trag.tacka, ...lotovi, ...prijemi, ...mjerenja, ...zapisi, ...nc, ...zadaci, ...mjere, ...provjere, ...pravila].filter(Boolean);
      await k.query(`delete from obavjestenje where izvor_id = any($1)`, [sve]);
      await k.query(`delete from audit_log where entitet_id = any($1)`, [sve]);
      await k.query(`delete from zadatak where id = any($1)`, [zadaci]);
      await k.query(`delete from verifikacija where neusaglasenost_id = any($1)`, [nc]);
      await k.query(`delete from korektivna_mjera where neusaglasenost_id = any($1)`, [nc]);
      await k.query(`delete from neusaglasenost where id = any($1)`, [nc]);
      await k.query(`delete from mjerenje_temperature where id = any($1)`, [mjerenja]);
      await k.query(`delete from kretanje_zalihe where lot_id = any($1)`, [lotovi]);
      await k.query(`delete from zaliha where lot_id = any($1)`, [lotovi]);
      await k.query(`delete from prijem_stavka where prijem_id = any($1)`, [prijemi]);
      await k.query(`delete from lot where id = any($1)`, [lotovi]);
      await k.query(`delete from prijem where id = any($1)`, [prijemi]);
      await k.query(`delete from pravilo_kontrole where id = any($1)`, [pravila]);
      if (trag.tacka) await k.query(`delete from kontrolna_tacka where id = $1`, [trag.tacka]);
      await k.query(`delete from provjera_uredjaja where id = any($1)`, [provjere]);
      if (trag.uredjaj) await k.query(`delete from mjerni_uredjaj where id = $1`, [trag.uredjaj]);
      if (trag.artikal) await k.query(`delete from artikal where id = $1`, [trag.artikal]);
      // Ispravke prve: briše se zapis na koji niko ne pokazuje, dok ih ima.
      for (let i = 0; i < 6 && zapisi.length; i++) {
        await k.query(`delete from zapis z where z.id = any($1) and not exists (select 1 from zapis n where n.ispravlja_id = z.id)`, [zapisi]);
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
