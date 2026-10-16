// Faza 3 — HACCP kao sistem:
//   H5 plan monitoringa → "šta danas fali", "juče propušteno", pregled rupa unazad;
//   H6 termometri (interna provjera, kalibracija, neispravan → neusaglašenost), verifikacija sistema,
//      HACCP plan za štampu;
//   H7 četiri oka u firmi sa jednim odgovornim licem — izuzetak uz obrazloženje i trag;
//   H4 jedan izvor granica: granica iz Šifarnika postaje pravilo KKT 1 / KKT 3;
//   KKT 1: bez temperature se ne prima roba pod režimom.
// Test pravi svoju kontrolnu tačku, termometar i artikal, pa se brojevi ne miješaju sa demo podacima.
import { pool, prijava, NALOZI, danasCG, glavnoSkladiste } from "./pomoc.mjs";

export const naziv = "Faza 3: plan monitoringa, termometri, verifikacija sistema, HACCP plan, četiri oka, jedan izvor granica";

const pomjeri = (dana) => {
  const d = new Date(`${danasCG()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dana);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const marko = await prijava(NALOZI.marko);
  const petar = await prijava(NALOZI.petar);
  const direktor = await prijava(NALOZI.direktor);
  const konsultant = await prijava(NALOZI.konsultant);
  const pocetak = (await pool.query(`select now() as t`)).rows[0].t;
  const trag = { artikal: null, tacka: null, uredjaj: null, zapisi: [], nc: [], verifikacije: [] };
  const sifraTacke = `E2E${Date.now() % 100000}`;

  try {
    // ── H4: jedan izvor granica ─────────────────────────────────────────────────────────────
    const art = await ana("/artikli", { telo: { naziv: "E2E Faza3 kajmak", tempKontrolisano: true, tempMin: 0, tempMax: 4, granicaPotvrdio: true } });
    trag.artikal = art.tijelo?.id;
    const pravila = async () =>
      (await pool.query(
        `select kt.sifra, p.min_vrijednost::float as min, p.max_vrijednost::float as max, p.verzija, p.aktivan from pravilo_kontrole p
         join kontrolna_tacka kt on kt.id = p.kontrolna_tacka_id where p.artikal_id = $1 order by kt.sifra, p.verzija`,
        [trag.artikal],
      )).rows;
    const p1 = await pravila();
    provjeri("H4: granica iz Šifarnika je pravilo i za prijem (KKT 1) i za predaju (KKT 3)", p1.filter((p) => p.aktivan && p.max === 4).map((p) => p.sifra).join(",") === "KKT1,KKT3", JSON.stringify(p1));
    await ana(`/artikli/${trag.artikal}`, { method: "PATCH", telo: { tempMax: 6 } });
    const p2 = await pravila();
    provjeri("H4: izmjena granice pravi novu verziju pravila, stara ostaje kao istorija", p2.filter((p) => p.aktivan).every((p) => p.max === 6 && p.verzija === 2) && p2.filter((p) => !p.aktivan).length === 2);

    // ── KKT 1: temperatura obavezna ─────────────────────────────────────────────────────────
    const dobavljac = (await ana("/dobavljaci")).tijelo[0];
    const bezTemp = await marko("/prijem", {
      telo: { dobavljacId: dobavljac.id, datumPrijema: danasCG(), skladisteId: await glavnoSkladiste(marko), stavke: [{ artikalId: trag.artikal, brojLota: "E2E-F3", primljenaKolicina: 5, rokTrajanja: pomjeri(30) }] },
    });
    provjeri("KKT 1: roba pod režimom bez temperature se ne prima (400)", bezTemp.status === 400 && bezTemp.tijelo.error.code === "TEMPERATURA_OBAVEZNA", bezTemp.tijelo?.error?.message);
    await ana(`/artikli/${trag.artikal}`, { method: "PATCH", telo: { tempKontrolisano: false } });
    provjeri("H4: artikal van režima — njegova pravila se gase", (await pravila()).every((p) => !p.aktivan));

    // ── Kontrolna tačka ─────────────────────────────────────────────────────────────────────
    const kkt = await ana("/kontrolne-tacke", { telo: { sifra: sifraTacke, naziv: "E2E komora 9", opasnost: "Rast bakterija na temperaturi iznad 5 °C", korektivnaMjera: "Premjestiti robu u ispravnu komoru, pozvati servis", verifikacija: "Sedmični pregled zapisa" } });
    trag.tacka = kkt.tijelo?.id;
    provjeri("Nova kontrolna tačka (komora) sa tekstom za HACCP plan", kkt.status === 201);
    provjeri("Ista šifra dvaput — odbijeno (409)", (await ana("/kontrolne-tacke", { telo: { sifra: sifraTacke, naziv: "duplikat" } })).status === 409);
    const kkt1 = (await ana("/kontrolne-tacke")).tijelo.find((k) => k.sifra === "KKT1");
    provjeri("KKT 1 se ne može isključiti — na njoj stoji prijem (409)", (await ana(`/kontrolne-tacke/${kkt1.id}`, { method: "PATCH", telo: { aktivan: false } })).status === 409);
    await ana("/pravila-kontrole", { telo: { kontrolnaTackaId: trag.tacka, naziv: "E2E komora 0–5 °C", minVrijednost: 0, maxVrijednost: 5, ozbiljnost: "VISOK" } });

    // ── Plan monitoringa ────────────────────────────────────────────────────────────────────
    const imaPlan = (await pool.query(`select 1 from plan_monitoringa where aktivan limit 1`)).rows.length > 0;
    const osnovni = await ana("/plan-monitoringa/osnovni", { method: "POST", telo: {} });
    provjeri(
      imaPlan ? "Osnovni plan se ne pravi preko postojećeg (409)" : "Osnovni plan jednim klikom",
      imaPlan ? osnovni.status === 409 : osnovni.status === 201 && osnovni.tijelo.broj >= 7,
      `${osnovni.status} ${osnovni.tijelo?.broj ?? osnovni.tijelo?.error?.code ?? ""}`,
    );
    if (!imaPlan) provjeri("…drugi put — 409", (await ana("/plan-monitoringa/osnovni", { method: "POST", telo: {} })).status === 409);
    const stavka = await ana("/plan-monitoringa", {
      telo: { naziv: "E2E temperatura komore 9", vrsta: "mjerenje", kontrolnaTackaId: trag.tacka, ucestalost: "DNEVNO", puta: 2, uloga: "operater" },
    });
    const obr = await ana("/plan-monitoringa", { telo: { naziv: "E2E otpad (P9)", vrsta: "obrazac", obrazacKod: "P9", ucestalost: "SEDMICNO", uloga: "operater" } });
    provjeri("Stavka plana bez kontrolne tačke — odbijena (400)", (await ana("/plan-monitoringa", { telo: { naziv: "E2E bez tačke", vrsta: "mjerenje", ucestalost: "DNEVNO" } })).status === 400);

    const danasZa = async (k, id) => (await k("/monitoring/danas")).tijelo.stavke.find((s) => s.id === id);
    const s0 = await danasZa(marko, stavka.tijelo.id);
    provjeri("Magacioner vidi šta danas fali: 0 od 2 mjerenja", s0?.uradjeno === 0 && s0.fali === 2, JSON.stringify(s0 && { u: s0.uradjeno, f: s0.fali }));
    provjeri("Vozač ne vidi magacinsku stavku", !(await danasZa(petar, stavka.tijelo.id)));
    const t0 = (await direktor("/tabla")).tijelo.kriticno;
    const d0 = (await direktor("/tabla/detalj/monitoring")).tijelo;
    provjeri("Kontrolni centar: kartica „danas fali\" i lista iza nje", t0.monitoringFali >= 1 && d0.redovi.some((r) => r.sta === "E2E temperatura komore 9"));
    // Mjerenje nosi termometar (R-23): test ima svoj, provjeren — ne zavisi od stanja demo baze.
    const pomocni = await ana("/mjerni-uredjaji", { telo: { naziv: "E2E-F3 pomoćni termometar", intervalProvjereMjeseci: 1 } });
    trag.pomocniUredjaj = pomocni.tijelo?.id;
    await marko(`/mjerni-uredjaji/${trag.pomocniUredjaj}/provjera`, { telo: { datum: danasCG(), vrsta: "INTERNA", referentna: 0, izmjereno: 0 } });
    const mjeri = (v) => marko("/mjerenja", { telo: { kontrolnaTackaId: trag.tacka, vrijednost: v, mjerniUredjajId: trag.pomocniUredjaj } });
    await mjeri(3.1);
    await mjeri(3.4);
    const s1 = await danasZa(marko, stavka.tijelo.id);
    provjeri("Posle dva mjerenja — stavka je urađena", s1?.uradjeno === 2 && s1.fali === 0);
    const zp = await marko("/zapisi", { telo: { obrazacKod: "P9", datum: danasCG(), podaci: { kante_zatvorene: true, izneseno: true } } });
    trag.zapisi.push(zp.tijelo?.id);
    const o1 = await danasZa(marko, obr.tijelo.id);
    provjeri("Sedmična stavka: jedan zapis ove sedmice je dovoljan", o1?.uradjeno >= 1 && o1.fali === 0 && o1.rok === "do nedjelje");

    // Rupe unazad: stavka "važi" od prije 5 dana, a mjerenja tada nije bilo.
    await pool.query(`update plan_monitoringa set vazi_od = $1 where id = $2`, [pomjeri(-5), stavka.tijelo.id]);
    const juce = (await ana("/monitoring/danas")).tijelo.juce.find((s) => s.id === stavka.tijelo.id);
    provjeri("„Juče propušteno\": 0 od 2", juce?.uradjeno === 0 && juce.fali === 2);
    const pregled = (await direktor("/monitoring/pregled?dana=7")).tijelo.stavke.find((s) => s.id === stavka.tijelo.id);
    provjeri("Pregled rupa: 5 propuštenih dana, svaki sa datumom", pregled?.periodaUkupno === 5 && pregled.propusteno.length === 5 && pregled.propusteno[0].od === pomjeri(-5), JSON.stringify(pregled?.propusteno?.map((p) => p.od)));
    provjeri("Magacioner ne mijenja plan (403)", (await marko("/plan-monitoringa", { telo: { naziv: "x", vrsta: "obrazac", obrazacKod: "P3", ucestalost: "DNEVNO" } })).status === 403);

    // ── Termometri ──────────────────────────────────────────────────────────────────────────
    const ur = await ana("/mjerni-uredjaji", { telo: { naziv: "E2E ubodni termometar", oznaka: "T-99", intervalProvjereMjeseci: 1, intervalKalibracijeMjeseci: 12 } });
    trag.uredjaj = ur.tijelo?.id;
    const stanjeUr = async () => (await ana("/mjerni-uredjaji")).tijelo.find((u) => u.id === trag.uredjaj);
    provjeri("Nov termometar bez provjere — rok istekao", (await stanjeUr())?.stanje === "ISTEKLA");
    const ledena = await marko(`/mjerni-uredjaji/${trag.uredjaj}/provjera`, { telo: { datum: danasCG(), vrsta: "INTERNA", referentna: 0, izmjereno: 0.3 } });
    provjeri("Ledena voda 0 °C, pokazao 0,3 — ispravan (računa server)", ledena.status === 201 && ledena.tijelo.rezultat === "ISPRAVAN");
    provjeri("…ali kalibracija još nije rađena — i dalje istekao", (await stanjeUr())?.stanje === "ISTEKLA");
    provjeri("Kalibracija bez broja sertifikata — odbijena (400)", (await ana(`/mjerni-uredjaji/${trag.uredjaj}/provjera`, { telo: { datum: danasCG(), vrsta: "KALIBRACIJA", rezultat: "ISPRAVAN" } })).status === 400);
    await ana(`/mjerni-uredjaji/${trag.uredjaj}/provjera`, { telo: { datum: danasCG(), vrsta: "KALIBRACIJA", rezultat: "ISPRAVAN", brojSertifikata: "E2E-LAB-2026/77" } });
    const vazi = await stanjeUr();
    provjeri("Posle kalibracije — važi, sa rokovima", vazi?.stanje === "VAZI" && vazi.provjera_do > danasCG() && vazi.kalibracija_do?.slice(0, 4) === String(Number(danasCG().slice(0, 4)) + 1), JSON.stringify({ p: vazi?.provjera_do, k: vazi?.kalibracija_do }));
    const los = await marko(`/mjerni-uredjaji/${trag.uredjaj}/provjera`, { telo: { datum: danasCG(), vrsta: "INTERNA", referentna: 0, izmjereno: 1.2 } });
    provjeri("Pokazao 1,2 umjesto 0 — neispravan, otvorena neusaglašenost", los.tijelo.rezultat === "NEISPRAVAN" && !!los.tijelo.neusaglasenost);
    provjeri("…stanje NEISPRAVAN, odgovorno lice obaviješteno", (await stanjeUr())?.stanje === "NEISPRAVAN" && (await ana("/obavjestenja")).tijelo.some((o) => o.izvor_id === trag.uredjaj));
    provjeri("…i vidi se u HACCP rokovima na Kontrolnom centru", (await direktor("/tabla/detalj/rokovi")).tijelo.redovi.some((r) => r.sta.includes("E2E ubodni termometar") && r.stanje === "NEISPRAVAN"));
    provjeri("Vozač ne upisuje provjeru termometra (403)", (await petar(`/mjerni-uredjaji/${trag.uredjaj}/provjera`, { telo: { datum: danasCG(), vrsta: "INTERNA", referentna: 0, izmjereno: 0 } })).status === 403);

    // ── Verifikacija sistema ────────────────────────────────────────────────────────────────
    provjeri("Revizija sa praznim nalazom — odbijena (400)", (await ana("/verifikacija-sistema", { telo: { vrsta: "REVIZIJA_PLANA", datum: danasCG(), nalaz: "ok", zakljucak: "USAGLASENO" } })).status === 400);
    provjeri("Revizija unaprijed — odbijena (400)", (await ana("/verifikacija-sistema", { telo: { vrsta: "REVIZIJA_PLANA", datum: pomjeri(3), nalaz: "E2E planirana revizija", zakljucak: "USAGLASENO" } })).status === 400);
    const rev = await ana("/verifikacija-sistema", {
      telo: { vrsta: "REVIZIJA_PLANA", datum: danasCG(), nalaz: "E2E pregledane sve KKT i granice; dodati komoru 9 u plan", zakljucak: "POTREBNE_IZMJENE" },
    });
    trag.verifikacije.push(rev.tijelo?.id);
    provjeri("Revizija upisana, sljedeća za godinu dana", rev.status === 201 && rev.tijelo.sljedecaDo.slice(0, 4) === String(Number(danasCG().slice(0, 4)) + 1));
    provjeri("„Potrebne izmjene\" otvaraju zadatak", (await pool.query(`select 1 from zadatak where izvor_tip = 'verifikacija_sistema' and izvor_id = $1`, [rev.tijelo.id])).rows.length === 1);
    const stanjeRev = (await direktor("/verifikacija-sistema")).tijelo.stanje.find((s) => s.vrsta === "REVIZIJA_PLANA");
    provjeri("Direktor vidi stanje revizije: važi", stanjeRev?.stanje === "VAZI");
    provjeri("Magacioner ne upisuje reviziju (403)", (await marko("/verifikacija-sistema", { telo: { vrsta: "INTERNI_AUDIT", datum: danasCG(), nalaz: "E2E pokušaj magacionera", zakljucak: "USAGLASENO" } })).status === 403);

    // ── HACCP plan za štampu ────────────────────────────────────────────────────────────────
    const plan = await direktor("/haccp-plan");
    const t9 = plan.tijelo?.kontrolneTacke?.find((t) => t.id === trag.tacka);
    provjeri("HACCP plan: tačka sa opasnošću, granicom, monitoringom i mjerom", !!t9?.opasnost && Number(t9.opstaGranica?.max_vrijednost) === 5 && t9.monitoring.some((m) => m.id === stavka.tijelo.id) && !!t9.korektivna_mjera);
    provjeri("HACCP plan: termometri i verifikacija sistema", plan.tijelo.uredjaji.some((u) => u.id === trag.uredjaj) && plan.tijelo.verifikacija.length === 3);
    provjeri("Magacioner ne otvara HACCP plan (403)", (await marko("/haccp-plan")).status === 403);

    // ── H7: četiri oka u firmi sa jednim odgovornim licem ───────────────────────────────────
    const nc = await marko("/neusaglasenosti", { telo: { opis: "E2E-F3 vrata komore ne dihtuju", ozbiljnost: "NIZAK" } });
    trag.nc.push(nc.tijelo?.id);
    const mjera = await ana(`/neusaglasenosti/${nc.tijelo.id}/korektivna-mjera`, { telo: { opis: "E2E zamijeniti gumu na vratima", dodijeljenoKorisnikId: ana.id } });
    await ana(`/korektivne-mjere/${mjera.tijelo.id}/zavrsi`, { telo: { rezultat: "E2E guma zamijenjena, vrata dihtuju" } });
    const bez = await ana(`/neusaglasenosti/${nc.tijelo.id}/verifikacija`, { telo: { rezultat: "POTVRDJENO" } });
    provjeri("Sama uradila mjeru — obična provjera odbijena, ali se nudi izuzetak", bez.status === 409 && bez.tijelo.error.code === "VERIFIKACIJA_NIJE_NEZAVISNA" && bez.tijelo.error.details.izuzetakMoguc === true);
    const kratko = await ana(`/neusaglasenosti/${nc.tijelo.id}/verifikacija`, { telo: { rezultat: "POTVRDJENO", izuzetak: true, napomena: "ok" } });
    provjeri("Izuzetak bez obrazloženja — odbijen (400)", kratko.status === 400 && kratko.tijelo.error.code === "OBRAZLOZENJE_OBAVEZNO");
    const sa = await ana(`/neusaglasenosti/${nc.tijelo.id}/verifikacija`, { telo: { rezultat: "POTVRDJENO", izuzetak: true, napomena: "E2E jedino odgovorno lice; pregledala vrata i zapis" } });
    provjeri("Izuzetak uz obrazloženje — zatvoreno", sa.status === 200 && sa.tijelo.status === "ZATVORENA");
    provjeri("…zapis provjere nosi oznaku „bez četiri oka\"", (await pool.query(`select izuzetak_cetiri_oka from verifikacija where neusaglasenost_id = $1`, [nc.tijelo.id])).rows[0]?.izuzetak_cetiri_oka === true);
    provjeri("…konsultant dobija obavještenje da to pogleda", (await konsultant("/obavjestenja")).tijelo.some((o) => o.izvor_id === nc.tijelo.id && o.naslov.includes("bez četiri oka")));

    const nc2 = await marko("/neusaglasenosti", { telo: { opis: "E2E-F3 konsultant sam sebi", ozbiljnost: "NIZAK" } });
    trag.nc.push(nc2.tijelo?.id);
    const m2 = await konsultant(`/neusaglasenosti/${nc2.tijelo.id}/korektivna-mjera`, { telo: { opis: "E2E konsultantova mjera", dodijeljenoKorisnikId: konsultant.id } });
    await konsultant(`/korektivne-mjere/${m2.tijelo.id}/zavrsi`, { telo: { rezultat: "E2E urađeno" } });
    const kon = await konsultant(`/neusaglasenosti/${nc2.tijelo.id}/verifikacija`, { telo: { rezultat: "POTVRDJENO", izuzetak: true, napomena: "E2E pokušaj izuzetka konsultanta" } });
    provjeri("Izuzetak nije za konsultanta — tu je odgovorno lice (409)", kon.status === 409 && kon.tijelo.error.code === "IZUZETAK_NIJE_DOZVOLJEN");
  } finally {
    const k = await pool.connect();
    try {
      await k.query("begin");
      const planovi = (await k.query(`select id from plan_monitoringa where created_by = $1 and created_at >= $2`, [NALOZI.ana.id, pocetak])).rows.map((r) => r.id);
      const nc = [...trag.nc.filter(Boolean)];
      if (trag.uredjaj) nc.push(...(await k.query(`select id from neusaglasenost where izvor_tip = 'mjerni_uredjaj' and izvor_id = $1`, [trag.uredjaj])).rows.map((r) => r.id));
      const mjere = nc.length ? (await k.query(`select id from korektivna_mjera where neusaglasenost_id = any($1)`, [nc])).rows.map((r) => r.id) : [];
      const mjerenja = trag.tacka ? (await k.query(`select id from mjerenje_temperature where kontrolna_tacka_id = $1`, [trag.tacka])).rows.map((r) => r.id) : [];
      const pravila = (await k.query(`select id from pravilo_kontrole where artikal_id = $1 or kontrolna_tacka_id = $2`, [trag.artikal, trag.tacka])).rows.map((r) => r.id);
      const uredjaji = [trag.uredjaj, trag.pomocniUredjaj].filter(Boolean);
      const provjere = (await k.query(`select id from provjera_uredjaja where uredjaj_id = any($1)`, [uredjaji])).rows.map((r) => r.id);
      const verif = trag.verifikacije.filter(Boolean);
      const zapisi = trag.zapisi.filter(Boolean);
      const sve = [...planovi, ...nc, ...mjere, ...mjerenja, ...pravila, ...provjere, ...verif, ...zapisi, trag.artikal, trag.tacka, ...uredjaji].filter(Boolean);
      await k.query(`delete from obavjestenje where izvor_id = any($1)`, [sve]);
      await k.query(`delete from zadatak where izvor_id = any($1)`, [sve]);
      await k.query(`delete from audit_log where entitet_id = any($1)`, [sve]);
      await k.query(`delete from dogadjaj where entitet_id = any($1)`, [sve]);
      await k.query(`delete from verifikacija where neusaglasenost_id = any($1)`, [nc]);
      await k.query(`delete from korektivna_mjera where neusaglasenost_id = any($1)`, [nc]);
      await k.query(`delete from neusaglasenost where id = any($1)`, [nc]);
      await k.query(`delete from plan_monitoringa where id = any($1)`, [planovi]);
      await k.query(`delete from mjerenje_temperature where id = any($1)`, [mjerenja]);
      await k.query(`delete from pravilo_kontrole where id = any($1)`, [pravila]);
      await k.query(`delete from provjera_uredjaja where id = any($1)`, [provjere]);
      await k.query(`delete from mjerni_uredjaj where id = any($1)`, [uredjaji]);
      await k.query(`delete from verifikacija_sistema where id = any($1)`, [verif]);
      await k.query(`delete from zapis where id = any($1)`, [zapisi]);
      await k.query(`delete from kontrolna_tacka where id = $1`, [trag.tacka]);
      await k.query(`delete from artikal where id = $1`, [trag.artikal]);
      await k.query("commit");
    } catch (e) {
      await k.query("rollback");
      throw new Error(`Čišćenje nije uspjelo: ${e.message} ${JSON.stringify(trag)}`);
    } finally {
      k.release();
    }
  }
}
