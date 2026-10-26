// Atelje — prijem bez broja serije (P4) i uređaji za čuvanje kao posebne kontrolne tačke (PLAN.md 8.4):
//   • broj serije nije obavezan kad ga roba nema, ali trag jeste: bez računa/otpremnice se ne prima (TRAG_OBAVEZAN);
//     lot dobija oznaku „bez serije · <dokument> · <datum>“, ide u tortu i nalazi se pretragom po dokumentu;
//   • artikal kome je serija obavezna (jaja) bez nje se ne prima (LOT_OBAVEZAN); nov artikal — serija je izbor;
//   • isti artikal bez serije dvaput u prijemu se odbija; serija se kasnije može dopisati, ali ne i obrisati;
//   • frižider, vitrina i zamrzivač su svaka svoja tačka: −19 °C u zamrzivaču prolazi, a „Predloži osnovni plan“
//     pravi dnevno mjerenje za svaki uređaj.
// Pravi svoje artikle, prijeme, termometar i porudžbinu, i sve briše.
import { pool, prijava, NALOZI, danasCG, glavnoSkladiste, rokZaDana } from "./pomoc.mjs";

export const naziv = "Atelje: prijem bez broja serije (P4), frižider, vitrina i zamrzivač kao posebne tačke";

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const marko = await prijava(NALOZI.marko);
  const oznaka = `E2E-P4-${Date.now().toString(36)}`;
  const pocetak = (await pool.query(`select now() as t`)).rows[0].t;
  const trag = { artikli: [], prijemi: [], porudzbine: [], uredjaj: null, mjerenja: [] };

  try {
    const dobavljac = (await ana("/dobavljaci")).tijelo[0];
    const skladisteId = await glavnoSkladiste(marko);
    const brasno = await ana("/artikli", { telo: { naziv: `${oznaka} brašno`, jedinicaMjere: "kg", alergeni: ["GLUTEN"] } });
    const jaja = await ana("/artikli", { telo: { naziv: `${oznaka} jaja`, jedinicaMjere: "kom", zahtijevaLot: true, alergeni: ["JAJA"] } });
    trag.artikli.push(brasno.tijelo?.id, jaja.tijelo?.id);
    const serijaObavezna = (await pool.query(`select id, zahtijeva_lot from artikal where id = any($1)`, [trag.artikli])).rows;
    provjeri(
      "Nov artikal: broj serije nije obavezan, osim kad se izričito traži (jaja)",
      serijaObavezna.find((r) => r.id === brasno.tijelo.id)?.zahtijeva_lot === false && serijaObavezna.find((r) => r.id === jaja.tijelo.id)?.zahtijeva_lot === true,
      JSON.stringify(serijaObavezna),
    );

    const prijem = async (stavke, brojDokumenta) => {
      const r = await marko("/prijem", { telo: { dobavljacId: dobavljac.id, ...(brojDokumenta ? { brojDokumenta } : {}), datumPrijema: danasCG(), skladisteId, stavke } });
      if (r.tijelo?.id) trag.prijemi.push(r.tijelo.id);
      return r;
    };
    const stavkaBrasna = { artikalId: brasno.tijelo.id, primljenaKolicina: 10, rokTrajanja: rokZaDana(200) };

    // ── P4: bez serije i bez dokumenta → nema traga ───────────────────────────────────────────
    const bezTraga = await prijem([stavkaBrasna]);
    provjeri("P4: roba bez broja serije i bez računa/otpremnice se ne prima (400 TRAG_OBAVEZAN)", bezTraga.status === 400 && bezTraga.tijelo?.error?.code === "TRAG_OBAVEZAN", `${bezTraga.status} ${bezTraga.tijelo?.error?.code}`);
    const jajaBezSerije = await prijem([{ artikalId: jaja.tijelo.id, primljenaKolicina: 30, rokTrajanja: rokZaDana(20) }], `${oznaka}-R1`);
    provjeri("P4: jaja bez oznake serije se ne primaju ni uz račun (400 LOT_OBAVEZAN)", jajaBezSerije.status === 400 && jajaBezSerije.tijelo?.error?.code === "LOT_OBAVEZAN", `${jajaBezSerije.status} ${jajaBezSerije.tijelo?.error?.message}`);
    const dvaput = await prijem([stavkaBrasna, { ...stavkaBrasna, primljenaKolicina: 2 }], `${oznaka}-R1`);
    provjeri("P4: isti artikal bez serije dvaput u istom prijemu se odbija (400 SERIJA_DVAPUT)", dvaput.status === 400 && dvaput.tijelo?.error?.code === "SERIJA_DVAPUT", `${dvaput.status} ${dvaput.tijelo?.error?.message}`);

    // ── P4: sa računom — prima se, lot nosi trag ──────────────────────────────────────────────
    const dokument = `${oznaka}-R1`;
    const p1 = await prijem([stavkaBrasna, { artikalId: jaja.tijelo.id, brojLota: `${oznaka}-J7`, primljenaKolicina: 30, rokTrajanja: rokZaDana(20) }], dokument);
    provjeri("P4: brašno bez serije uz račun i jaja sa serijom — prijem se prima", p1.status === 201, `${p1.status} ${p1.tijelo?.error?.message ?? ""}`);
    const lotovi = (await pool.query(`select id, artikal_id, broj_lota, bez_broja from lot where prijem_id = $1`, [p1.tijelo?.id])).rows;
    const lotBrasna = lotovi.find((l) => l.artikal_id === brasno.tijelo.id);
    const [g, m, d] = danasCG().split("-");
    provjeri(
      "P4: lot bez serije dobija oznaku „bez serije · <račun> · <datum>“ i oznaku u bazi; lot sa serijom ostaje kakav jeste",
      lotBrasna?.broj_lota === `bez serije · ${dokument} · ${d}.${m}.${g}.` && lotBrasna.bez_broja === true && lotovi.find((l) => l.artikal_id === jaja.tijelo.id)?.bez_broja === false,
      JSON.stringify(lotovi.map((l) => [l.broj_lota, l.bez_broja])),
    );
    const nadjeno = (await ana(`/sledljivost/pretraga?q=${encodeURIComponent(dokument)}`)).tijelo;
    provjeri("P4: sledljivost nalazi lot bez serije po broju računa", Array.isArray(nadjeno) && nadjeno.some((r) => r.lot_id === lotBrasna?.id));

    // Dopisana serija: lot dobija pravi broj; obrisati se ne može.
    const prazno = await marko(`/prijem/${p1.tijelo.id}/lot/${lotBrasna.id}`, { method: "PATCH", telo: { brojLota: " " } });
    provjeri("P4: broj serije se ne briše (400)", prazno.status === 400, `${prazno.status}`);
    const dopisano = await marko(`/prijem/${p1.tijelo.id}/lot/${lotBrasna.id}`, { method: "PATCH", telo: { brojLota: `${oznaka}-B33` } });
    const poslije = (await pool.query(`select broj_lota, bez_broja from lot where id = $1`, [lotBrasna.id])).rows[0];
    provjeri("P4: serija dopisana kasnije — lot više nije „bez serije“", dopisano.status === 204 && poslije?.broj_lota === `${oznaka}-B33` && poslije.bez_broja === false, JSON.stringify(poslije));

    // Lot bez serije ide u tortu kao i svaki drugi (P2).
    const p2 = await prijem([{ ...stavkaBrasna, primljenaKolicina: 5 }], `${oznaka}-R2`);
    const lot2 = (await pool.query(`select id from lot where prijem_id = $1`, [p2.tijelo?.id])).rows[0]?.id;
    await ana(`/prijem/${p2.tijelo.id}/lot/${lot2}/odluka`, { method: "PATCH", telo: { odluka: "PRIHVATI", kolicina: 5 } });
    const torta = await marko("/porudzbine", { telo: { kupacIme: `${oznaka} Kupac`, kupacTelefon: "067 909 808", preuzimanjeDatum: danasCG(), preuzimanjeVrijeme: "23:58", opis: "E2E torta" } });
    trag.porudzbine.push(torta.tijelo?.id);
    const uTortu = await marko(`/porudzbine/${torta.tijelo.id}/lotovi`, { telo: { lotId: lot2 } });
    provjeri("P4: prihvaćen lot bez serije ide u tortu (trag: račun)", uTortu.status < 300, `${uTortu.status} ${uTortu.tijelo?.error?.message ?? ""}`);

    // ── Uređaji: svaki svoja tačka i svoja granica ───────────────────────────────────────────
    const tacke = (await ana("/kontrolne-tacke")).tijelo;
    const zamrzivac = tacke.find((t) => t.sifra === "KKT2-Z");
    const vitrina = tacke.find((t) => t.sifra === "KKT2-V");
    const frizider = tacke.find((t) => t.sifra === "KKT2");
    provjeri("Frižider, vitrina i zamrzivač su posebne kontrolne tačke (demo ateljea)", !!zamrzivac && !!vitrina && !!frizider, tacke.map((t) => t.sifra).join(","));
    const ur = await ana("/mjerni-uredjaji", { telo: { naziv: `${oznaka} termometar`, intervalProvjereMjeseci: 1 } });
    trag.uredjaj = ur.tijelo?.id;
    await marko(`/mjerni-uredjaji/${trag.uredjaj}/provjera`, { telo: { datum: danasCG(), vrsta: "INTERNA", referentna: 0, izmjereno: 0 } });
    const mjeri = async (t, v) => {
      const r = await marko("/mjerenja", { telo: { kontrolnaTackaId: t.id, vrijednost: v, mjerniUredjajId: trag.uredjaj } });
      if (r.tijelo?.mjerenjeId) trag.mjerenja.push(r.tijelo.mjerenjeId);
      return r;
    };
    const z = await mjeri(zamrzivac, -19);
    const v = await mjeri(vitrina, 3.5);
    provjeri(
      "−19 °C u zamrzivaču prolazi (granica zamrzivača), 3,5 °C u vitrini prolazi (granica vitrine)",
      z.tijelo?.rezultat === "PASS" && v.tijelo?.rezultat === "PASS" && !z.tijelo?.neusaglasenostId,
      `${z.status} ${z.tijelo?.rezultat} · ${v.status} ${v.tijelo?.rezultat}`,
    );

    // „Predloži osnovni plan“ — dnevno mjerenje za svaki uređaj (šifra KKT2…). Samo kad plana još nema.
    const imaPlan = (await pool.query(`select 1 from plan_monitoringa where aktivan limit 1`)).rows.length > 0;
    if (imaPlan) console.log("  · preskočeno: osnovni plan po uređajima — plan monitoringa već postoji");
    else {
      const osnovni = await ana("/plan-monitoringa/osnovni", { method: "POST", telo: {} });
      const stavke = (await pool.query(
        `select kt.sifra, p.ucestalost, p.puta from plan_monitoringa p join kontrolna_tacka kt on kt.id = p.kontrolna_tacka_id where p.aktivan and kt.sifra like 'KKT2%'`,
      )).rows;
      provjeri(
        "Osnovni plan: dnevno mjerenje (2×) za frižider, vitrinu i zamrzivač — svaki posebno",
        osnovni.status === 201 && ["KKT2", "KKT2-V", "KKT2-Z"].every((s) => stavke.some((x) => x.sifra === s && x.ucestalost === "DNEVNO" && Number(x.puta) === 2)),
        JSON.stringify(stavke),
      );
    }
  } finally {
    const k = await pool.connect();
    try {
      await k.query("begin");
      const artikli = trag.artikli.filter(Boolean);
      const prijemi = trag.prijemi.filter(Boolean);
      const porudzbine = trag.porudzbine.filter(Boolean);
      const lotovi = (await k.query(`select id from lot where artikal_id = any($1)`, [artikli])).rows.map((r) => r.id);
      const pravila = (await k.query(`select id from pravilo_kontrole where artikal_id = any($1)`, [artikli])).rows.map((r) => r.id);
      const mjerenja = (await k.query(`select id from mjerenje_temperature where mjerni_uredjaj_id = $1 or lot_id = any($2)`, [trag.uredjaj, lotovi])).rows.map((r) => r.id);
      const ncIds = (await k.query(`select id from neusaglasenost where izvor_id = any($1)`, [[...mjerenja, ...lotovi, ...porudzbine]])).rows.map((r) => r.id);
      const provjere = trag.uredjaj ? (await k.query(`select id from provjera_uredjaja where uredjaj_id = $1`, [trag.uredjaj])).rows.map((r) => r.id) : [];
      const planovi = (await k.query(`select id from plan_monitoringa where created_by = $1 and created_at >= $2`, [NALOZI.ana.id, pocetak])).rows.map((r) => r.id);
      const sve = [...artikli, ...prijemi, ...porudzbine, ...lotovi, ...pravila, ...mjerenja, ...ncIds, ...provjere, ...planovi, trag.uredjaj].filter(Boolean);
      await k.query(`delete from obavjestenje where izvor_id = any($1)`, [sve]);
      await k.query(`delete from zadatak where izvor_id = any($1)`, [sve]);
      await k.query(`delete from audit_log where entitet_id = any($1)`, [sve]);
      await k.query(`delete from korektivna_mjera where neusaglasenost_id = any($1)`, [ncIds]);
      await k.query(`delete from neusaglasenost where id = any($1)`, [ncIds]);
      await k.query(`delete from porudzbina_lot where porudzbina_id = any($1)`, [porudzbine]);
      await k.query(`delete from porudzbina where id = any($1)`, [porudzbine]);
      await k.query(`delete from mjerenje_temperature where id = any($1)`, [mjerenja]);
      await k.query(`delete from plan_monitoringa where id = any($1)`, [planovi]);
      await k.query(`delete from kretanje_zalihe where lot_id = any($1)`, [lotovi]);
      await k.query(`delete from zaliha where lot_id = any($1)`, [lotovi]);
      await k.query(`delete from prijem_stavka where prijem_id = any($1)`, [prijemi]);
      await k.query(`delete from lot where id = any($1)`, [lotovi]);
      await k.query(`delete from prijem where id = any($1)`, [prijemi]);
      await k.query(`delete from pravilo_kontrole where id = any($1)`, [pravila]);
      await k.query(`delete from artikal where id = any($1)`, [artikli]);
      await k.query(`delete from provjera_uredjaja where id = any($1)`, [provjere]);
      if (trag.uredjaj) await k.query(`delete from mjerni_uredjaj where id = $1`, [trag.uredjaj]);
      await k.query("commit");
    } catch (e) {
      await k.query("rollback");
      throw new Error(`Čišćenje nije uspjelo: ${e.message} ${JSON.stringify(trag)}`);
    } finally {
      k.release();
    }
  }
}
