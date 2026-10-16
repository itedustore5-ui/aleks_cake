// Dorada posle probe vlasnice (01.10.2026):
//   • D1 se traži samo za vozilo koje tog dana vozi — vozaču ne stoji crveno za kamion koji ne vozi,
//     a posle kontrole se skida; spisak vozila zna „danas vozi“;
//   • vozač dobija obavještenje i kad mu isporuka ODE (drugom vozaču / bez vozača) i kad se izmijeni;
//   • temperatura sa prijema se vidi uz stavku (vrijednost, granica, ocjena, termometar);
//   • neusaglašenost unaprijed kaže šta fali za zatvaranje i da li treba izuzetak „bez četiri oka“;
//   • „Riješeno je“ (03.10.2026): mjera + provjera + zatvaranje jednim upisom, uz ista pravila
//     (četiri oka, ponovna kontrola, povlačenje mora biti završeno);
//   • poruke: primljene na jednom mjestu, po vremenu;
//   • izvještaji i audit: filter po vremenu i po kategorijama (isti za pregled i CSV);
//   • pitanje firme na koje se već odgovaralo mijenja se kao nova verzija.
import { pool, prijava, NALOZI, danasCG, glavnoSkladiste, rokZaDana } from "./pomoc.mjs";

export const naziv = "Dorada: D1 po danu vožnje, vozač i izmjena isporuke, temperatura prijema, provjera NC, poruke, filteri";

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const marko = await prijava(NALOZI.marko);
  const petar = await prijava(NALOZI.petar);
  const konsultant = await prijava(NALOZI.konsultant);
  const oznaka = `E2E-DO-${Date.now().toString(36)}`;
  const t = { artikli: [], prijemi: [], vozilo: null, isporuke: [], plan: null, tacka: null, uredjaj: null, nc: [], pitanja: [], poruke: [], kljucevi: [], povlacenje: null };
  const K = (s) => {
    const k = `${oznaka}-${s}`;
    t.kljucevi.push(k);
    return k;
  };
  const sutra = rokZaDana(1);

  try {
    const dobavljac = (await ana("/dobavljaci")).tijelo[0];
    const kupac = (await ana("/kupci")).tijelo[0];
    const skladisteId = await glavnoSkladiste(marko);

    // ── Termometar i komora (prijem pod režimom, mjerenje za NC) ─────────────────────────────
    const ur = await ana("/mjerni-uredjaji", { telo: { naziv: `${oznaka} termometar`, intervalProvjereMjeseci: 1 } });
    t.uredjaj = ur.tijelo?.id;
    await marko(`/mjerni-uredjaji/${t.uredjaj}/provjera`, { telo: { datum: danasCG(), vrsta: "INTERNA", referentna: 0, izmjereno: 0 } });

    // ── Temperatura uz stavku prijema ────────────────────────────────────────────────────────
    const hladno = await ana("/artikli", { telo: { naziv: `${oznaka} jogurt`, tempKontrolisano: true, tempMin: 0, tempMax: 4, granicaPotvrdio: true } });
    const suho = await ana("/artikli", { telo: { naziv: `${oznaka} keks`, tempKontrolisano: false } });
    t.artikli.push(hladno.tijelo?.id, suho.tijelo?.id);
    const p = await marko("/prijem", {
      telo: {
        dobavljacId: dobavljac.id, brojDokumenta: oznaka, datumPrijema: danasCG(), skladisteId, mjerniUredjajId: t.uredjaj,
        stavke: [
          { artikalId: hladno.tijelo.id, brojLota: `${oznaka}-H`, primljenaKolicina: 10, rokTrajanja: rokZaDana(20), temperaturaPrijema: 3.5 },
          { artikalId: suho.tijelo.id, brojLota: `${oznaka}-S`, primljenaKolicina: 10, rokTrajanja: rokZaDana(90) },
        ],
      },
      zaglavlja: { "x-kljuc-zahtjeva": K("prijem") },
    });
    t.prijemi.push(p.tijelo?.id);
    const detalj = (await ana(`/prijem/${p.tijelo?.id}`)).tijelo;
    const sH = detalj?.stavke?.find((s) => s.broj_lota.endsWith("-H"));
    const sS = detalj?.stavke?.find((s) => s.broj_lota.endsWith("-S"));
    provjeri(
      "Prijem: uz stavku pod režimom vidi se izmjereno, granica, ocjena i termometar",
      p.status === 201 && Number(sH?.temp_izmjereno) === 3.5 && sH?.temp_rezultat === "PASS" && Number(sH?.temp_min) === 0 && Number(sH?.temp_max) === 4 && sH?.temp_termometar === `${oznaka} termometar`,
      `${p.status} ${p.tijelo?.error?.message ?? ""} ${JSON.stringify(sH && { t: sH.temp_izmjereno, r: sH.temp_rezultat, min: sH.temp_min, max: sH.temp_max, u: sH.temp_termometar })}`,
    );
    provjeri("…roba bez režima nema temperaturu (i to se zna)", sS?.temp_kontrolisano === false && sS?.temp_izmjereno == null);
    for (const s of detalj?.stavke ?? []) await ana(`/prijem/${p.tijelo.id}/lot/${s.lot_id}/odluka`, { method: "PATCH", telo: { odluka: "PRIHVATI", kolicina: 10 } });
    const lotKeks = sS?.lot_id;

    // ── Istekao rok na prijemu (02.10.2026): čitljiv datum i put do ispravke ────────────────────
    const prijemX = await marko("/prijem", {
      telo: { dobavljacId: dobavljac.id, brojDokumenta: `${oznaka}-2`, datumPrijema: danasCG(), skladisteId, stavke: [{ artikalId: suho.tijelo.id, brojLota: `${oznaka}-X`, primljenaKolicina: 5, rokTrajanja: rokZaDana(-1) }] },
      zaglavlja: { "x-kljuc-zahtjeva": K("prijem2") },
    });
    t.prijemi.push(prijemX.tijelo?.id);
    const lotX = (await pool.query(`select id from lot where prijem_id = $1`, [prijemX.tijelo?.id])).rows[0]?.id;
    const odbijeno = await ana(`/prijem/${prijemX.tijelo?.id}/lot/${lotX}/odluka`, { method: "PATCH", telo: { odluka: "PRIHVATI", kolicina: 5 } });
    provjeri(
      "Istekao rok: ne prihvata se, poruka ima datum kako se čita (dd.mm.gggg.) i kaže kako se ispravlja pogrešan rok",
      odbijeno.status === 409 && odbijeno.tijelo.error.code === "ROK_ISTEKAO" && /\d{2}\.\d{2}\.\d{4}\./.test(odbijeno.tijelo.error.message) && /Izmijeni/.test(odbijeno.tijelo.error.message),
      odbijeno.tijelo?.error?.message,
    );
    const ispravka = await ana(`/prijem/${prijemX.tijelo?.id}/lot/${lotX}`, { method: "PATCH", telo: { rokTrajanja: rokZaDana(30) } });
    const prihvaceno = await ana(`/prijem/${prijemX.tijelo?.id}/lot/${lotX}/odluka`, { method: "PATCH", telo: { odluka: "PRIHVATI", kolicina: 5 } });
    provjeri("…pogrešno ukucan rok se ispravi na stavci, pa se roba prihvata", ispravka.status < 300 && prihvaceno.status < 300, `${ispravka.status} ${prihvaceno.status} ${prihvaceno.tijelo?.error?.message ?? ""}`);

    // ── D1 samo za vozilo koje danas vozi ────────────────────────────────────────────────────
    const v = await ana("/vozila", { telo: { registarskiBroj: `E2E-${oznaka.slice(-7)}`, tip: "kombi", tempKontrolisano: false } });
    t.vozilo = v.tijelo?.id;
    const plan = await ana("/plan-monitoringa", { telo: { naziv: `${oznaka} D1`, vrsta: "kontrola_vozila", voziloId: t.vozilo, ucestalost: "RADNIM_DANIMA", uloga: "vozac" } });
    t.plan = plan.tijelo?.id;
    const stavkaD1 = async (k) => (await k("/monitoring/danas")).tijelo.stavke.find((s) => s.id === t.plan);
    provjeri("D1: vozilo bez današnje isporuke — nije na spisku „šta danas fali“ (ni kod vodstva ni kod vozača)", plan.status === 201 && !(await stavkaD1(ana)) && !(await stavkaD1(petar)), `${plan.status}`);
    const vozilaPrije = (await petar("/vozila")).tijelo.find((x) => x.id === t.vozilo);
    provjeri("…a spisak vozila kaže „danas ne vozi“", vozilaPrije?.vozi_danas === false);

    const nova = (telo, kljuc) => ana("/isporuke", { telo: { kupacId: kupac.id, skladisteId, napomena: oznaka, ...telo }, zaglavlja: { "x-kljuc-zahtjeva": K(kljuc) } });
    const i1 = await nova({ datumIsporuke: danasCG(), vozilId: t.vozilo, vozacKorisnikId: NALOZI.petar.id, stavke: [{ lotId: lotKeks, planiranaKolicina: 1 }] }, "i1");
    t.isporuke.push(i1.tijelo?.id);
    const sAna = await stavkaD1(ana);
    const sPetar = await stavkaD1(petar);
    provjeri("D1: vozilo sa današnjom isporukom — fali kod vodstva i kod vozača te isporuke", i1.status === 201 && sAna?.fali === 1 && sPetar?.fali === 1, `${i1.status} ${i1.tijelo?.error?.message ?? ""} ${sAna?.fali} ${sPetar?.fali}`);
    provjeri("…spisak vozila: „danas vozi“", (await petar("/vozila")).tijelo.find((x) => x.id === t.vozilo)?.vozi_danas === true);
    await petar("/kontrole-vozila", { telo: { vozilId: t.vozilo, cistoca: true, opremaOk: true, vrataOk: true } });
    provjeri("…posle kontrole crveno se skida (fali 0, ko je uradio)", (await stavkaD1(petar))?.fali === 0 && (await stavkaD1(petar))?.uradili?.length === 1);

    // ── Vozač i izmjena isporuke ─────────────────────────────────────────────────────────────
    const brojI1 = (await pool.query(`select broj from isporuka where id = $1`, [i1.tijelo?.id])).rows[0]?.broj ?? "—";
    const obavj = async (k) => (await k("/obavjestenja")).tijelo.filter((o) => (o.naslov ?? "").includes(brojI1));
    const iz = (telo) => {
      const tijelo = { datumIsporuke: danasCG(), vozilId: t.vozilo, vozacKorisnikId: NALOZI.petar.id, stavke: [{ lotId: lotKeks, planiranaKolicina: 1 }], ...telo };
      if (tijelo.vozacKorisnikId === null) delete tijelo.vozacKorisnikId; // „bez vozača“ = polje se ne šalje
      return ana(`/isporuke/${i1.tijelo.id}`, { method: "PATCH", telo: tijelo });
    };
    const promjena = await iz({ stavke: [{ lotId: lotKeks, planiranaKolicina: 2 }] });
    provjeri("Vozač: isporuka izmijenjena dok je njegova — dobija „izmijenjena“ i šta je promijenjeno", promjena.status < 300 && (await obavj(petar)).some((o) => o.naslov.includes("izmijenjena") && /roba ili količina/.test(o.poruka ?? "")), `${promjena.status}`);
    const skinut = await iz({ vozacKorisnikId: null, stavke: [{ lotId: lotKeks, planiranaKolicina: 2 }] });
    provjeri("Vozač: isporuka mu je oduzeta — dobija „više nije vaša“", skinut.status < 300 && (await obavj(petar)).some((o) => o.naslov.includes("više nije vaša")), `${skinut.status}`);
    provjeri("…i ne vidi je više na svom spisku", !(await petar("/isporuke")).tijelo.some((x) => x.id === i1.tijelo.id));

    // ── Neusaglašenost: šta fali i ko provjerava — unaprijed ────────────────────────────────
    const kt = await ana("/kontrolne-tacke", { telo: { sifra: `E2ED${String(Date.now()).slice(-6)}`, naziv: `${oznaka} komora` } });
    t.tacka = kt.tijelo?.id;
    await ana("/pravila-kontrole", { telo: { kontrolnaTackaId: t.tacka, naziv: "E2E 0–5 °C", minVrijednost: 0, maxVrijednost: 5, ozbiljnost: "VISOK" } });
    const fail = await marko("/mjerenja", { telo: { kontrolnaTackaId: t.tacka, vrijednost: 9, mjerniUredjajId: t.uredjaj } });
    const ncId = fail.tijelo?.neusaglasenostId;
    t.nc.push(ncId);
    const mjera = await ana(`/neusaglasenosti/${ncId}/korektivna-mjera`, { telo: { opis: "Premještena roba, servis komore" } });
    await ana(`/korektivne-mjere/${mjera.tijelo?.id}/zavrsi`, { telo: { rezultat: "Servis došao, komora radi" } });
    const d1 = (await ana(`/neusaglasenosti/${ncId}`)).tijelo;
    const jednoBzr = (await pool.query(`select count(*)::int as n from korisnik where uloga = 'bzr' and aktivan`)).rows[0].n === 1;
    provjeri(
      "NC: prije zatvaranja ekran zna šta fali (novo mjerenje) i gdje se radi",
      d1?.status === "CEKA_VERIFIKACIJU" && /izmjerite ponovo/.test(d1?.provjera?.fali ?? "") && d1?.provjera?.faliGdje === "/haccp",
      JSON.stringify(d1?.provjera),
    );
    provjeri(
      jednoBzr ? "…i da je mjera njena, a pošto je jedino odgovorno lice — izuzetak „bez četiri oka“ se nudi odmah" : "…i da je mjera njena — provjerava drugo odgovorno lice",
      d1?.provjera?.svojaMjera === true && d1?.provjera?.izuzetakMoguc === jednoBzr,
      JSON.stringify(d1?.provjera),
    );
    const zaKonsultanta = (await konsultant(`/neusaglasenosti/${ncId}`)).tijelo?.provjera;
    provjeri("…konsultant nije uradio mjeru — on smije provjeriti", zaKonsultanta?.svojaMjera === false);
    await marko("/mjerenja", { telo: { kontrolnaTackaId: t.tacka, vrijednost: 3, mjerniUredjajId: t.uredjaj } });
    provjeri("…posle novog mjerenja u granici ništa ne fali", (await ana(`/neusaglasenosti/${ncId}`)).tijelo?.provjera?.fali === null);

    // ── NC u jednom koraku: „Riješeno je“ (proba 03.10.2026) ────────────────────────────────
    const nc2 = (await marko("/neusaglasenosti", { telo: { opis: `${oznaka} vrata komore ne dihtuju` } })).tijelo?.id;
    t.nc.push(nc2);
    const st2 = (await ana(`/neusaglasenosti/${nc2}`)).tijelo?.provjera;
    provjeri(
      "Riješeno je: ekran unaprijed zna da li odgovorno lice zatvara samo (jedino je) i da ništa ne fali",
      st2?.samaZatvara === jednoBzr && st2?.fali === null && st2?.svojaMjera === false,
      JSON.stringify(st2),
    );
    if (jednoBzr) {
      const bez = await ana(`/neusaglasenosti/${nc2}/rijesi`, { telo: { uradjeno: "Zamijenjena guma na vratima" } });
      const kratko = await ana(`/neusaglasenosti/${nc2}/rijesi`, { telo: { uradjeno: "Zamijenjena guma na vratima", izuzetak: true, napomena: "ok" } });
      const mjera2 = (await pool.query(`select count(*)::int as n from korektivna_mjera where neusaglasenost_id = $1`, [nc2])).rows[0].n;
      provjeri(
        "…jedino odgovorno lice bez kvačice ili obrazloženja — kaže šta fali, ništa se ne upisuje",
        bez.status === 400 && bez.tijelo.error.code === "IZUZETAK_POTREBAN" && kratko.status === 400 && kratko.tijelo.error.code === "OBRAZLOZENJE_OBAVEZNO" && mjera2 === 0,
        `${bez.status} ${bez.tijelo?.error?.code} ${kratko.status} ${kratko.tijelo?.error?.code} mjera: ${mjera2}`,
      );
      const zatvori = await ana(`/neusaglasenosti/${nc2}/rijesi`, { telo: { uradjeno: "Zamijenjena guma na vratima", izuzetak: true, napomena: "Vrata zatvaraju, komora drži 3 °C" } });
      const v2 = (await ana(`/neusaglasenosti/${nc2}`)).tijelo;
      provjeri(
        "…sa kvačicom i obrazloženjem — JEDAN upis: mjera urađena, provjereno, zatvoreno, oznaka „bez četiri oka“",
        zatvori.status === 200 && zatvori.tijelo.status === "ZATVORENA" && v2?.status === "ZATVORENA" && v2?.korektivneMjere?.length === 1 &&
          v2.korektivneMjere[0].status === "ZAVRSENA" && v2?.verifikacije?.[0]?.izuzetak_cetiri_oka === true,
        `${zatvori.status} ${JSON.stringify(zatvori.tijelo)}`,
      );
      provjeri(
        "…magacioner (prijavio) zna da je zatvoreno, konsultant zna da je bez četiri oka",
        (await marko("/obavjestenja")).tijelo.some((o) => o.izvor_id === nc2 && /zatvorena/.test(o.naslov)) &&
          (await konsultant("/obavjestenja")).tijelo.some((o) => o.izvor_id === nc2 && /bez četiri oka/.test(o.naslov)),
      );
    } else {
      const r2 = await ana(`/neusaglasenosti/${nc2}/rijesi`, { telo: { uradjeno: "Zamijenjena guma na vratima", izuzetak: true, napomena: "Vrata zatvaraju, komora drži 3 °C" } });
      provjeri(
        "…sa drugim odgovornim licem: upisano, čeka NJEGOVU provjeru (četiri oka) — kvačica ne pomaže",
        r2.status === 200 && r2.tijelo.status === "CEKA_VERIFIKACIJU" && /četiri oka/.test(r2.tijelo.razlog ?? ""),
        JSON.stringify(r2.tijelo),
      );
    }

    const nc3 = (await marko("/neusaglasenosti", { telo: { opis: `${oznaka} prosuto mlijeko u hodniku` } })).tijelo?.id;
    t.nc.push(nc3);
    const r3 = await konsultant(`/neusaglasenosti/${nc3}/rijesi`, { telo: { uradjeno: "Očišćeno i dezinfikovano", izuzetak: true, napomena: "Konsultant ne zatvara sam" } });
    provjeri(
      "Riješeno je (konsultant): upisano, a zatvara odgovorno lice — dobija obavještenje „čeka vašu provjeru“",
      r3.status === 200 && r3.tijelo.status === "CEKA_VERIFIKACIJU" && (await ana("/obavjestenja")).tijelo.some((o) => o.izvor_id === nc3 && /čeka vašu provjeru/.test(o.naslov)),
      JSON.stringify(r3.tijelo),
    );
    const p3 = await ana(`/neusaglasenosti/${nc3}/verifikacija`, { telo: { rezultat: "POTVRDJENO", napomena: "Pregledan hodnik" } });
    provjeri("…odgovorno lice provjerava tuđu mjeru i zatvara", p3.status === 200 && p3.tijelo.status === "ZATVORENA", JSON.stringify(p3.tijelo));

    const nc4 = (await marko("/mjerenja", { telo: { kontrolnaTackaId: t.tacka, vrijednost: 11, mjerniUredjajId: t.uredjaj } })).tijelo?.neusaglasenostId;
    t.nc.push(nc4);
    const r4 = await ana(`/neusaglasenosti/${nc4}/rijesi`, { telo: { uradjeno: "Roba premještena, servis pozvan", izuzetak: true, napomena: "Komora pregledana" } });
    provjeri(
      "Riješeno je (iz mjerenja): mjera upisana odmah, zatvaranje čeka novo mjerenje — i kaže to",
      r4.status === 200 && r4.tijelo.status === "CEKA_VERIFIKACIJU" && /izmjerite ponovo/.test(r4.tijelo.razlog ?? "") &&
        (await pool.query(`select count(*)::int as n from verifikacija where neusaglasenost_id = $1`, [nc4])).rows[0].n === 0,
      JSON.stringify(r4.tijelo),
    );
    provjeri("…drugi „Riješeno je“ za istu neusaglašenost se ne prima (409)", (await ana(`/neusaglasenosti/${nc4}/rijesi`, { telo: { uradjeno: "opet isto" } })).status === 409);

    const nc5 = (await marko("/neusaglasenosti", { telo: { opis: `${oznaka} oštećena paleta` } })).tijelo?.id;
    t.nc.push(nc5);
    await ana(`/neusaglasenosti/${nc5}/korektivna-mjera`, { telo: { opis: "Zamijeniti paletu", dodijeljenoKorisnikId: NALOZI.marko.id } });
    const r5 = await ana(`/neusaglasenosti/${nc5}/rijesi`, { telo: { uradjeno: "Paleta zamijenjena", izuzetak: true, napomena: "Pregledala paletu i robu" } });
    const m5 = (await ana(`/neusaglasenosti/${nc5}`)).tijelo?.korektivneMjere;
    provjeri(
      "Riješeno je dok je mjera kod magacionera: ta mjera se završava, ne pravi se nova",
      r5.status === 200 && m5?.length === 1 && m5[0].status === "ZAVRSENA" && m5[0].rezultat === "Paleta zamijenjena",
      `${r5.status} ${JSON.stringify(r5.tijelo)} ${JSON.stringify(m5?.map((m) => [m.status, m.rezultat]))}`,
    );

    // Povlačenje: neusaglašenost se ne zatvara dok povlačenje traje (čl. 28).
    const pv = await ana(`/sledljivost/lot/${lotX}/povlacenje`, { telo: { razlog: `${oznaka} proba povlačenja` } });
    t.povlacenje = pv.tijelo?.id;
    const nc6 = pv.tijelo?.neusaglasenostId;
    t.nc.push(nc6);
    const st6 = (await ana(`/neusaglasenosti/${nc6}`)).tijelo?.provjera;
    provjeri(
      "NC iz povlačenja: ne zatvara se dok povlačenje nije završeno — ekran kaže šta fali i vodi pravo na to povlačenje",
      pv.status === 201 && /mora biti završeno/.test(st6?.fali ?? "") && st6?.faliGdje === "/sledljivost" && st6?.povlacenjeId === t.povlacenje,
      `${pv.status} ${pv.tijelo?.error?.message ?? ""} ${JSON.stringify(st6)}`,
    );
    const r6 = await ana(`/neusaglasenosti/${nc6}/rijesi`, { telo: { uradjeno: "Roba vraćena dobavljaču", izuzetak: true, napomena: "Karantin prazan, lot zadržan" } });
    provjeri("…„Riješeno je“ upisuje mjeru, zatvaranje čeka kraj povlačenja", r6.status === 200 && r6.tijelo.status === "CEKA_VERIFIKACIJU" && /povlačenje/.test(r6.tijelo.razlog ?? ""), JSON.stringify(r6.tijelo));
    await ana(`/povlacenja/${t.povlacenje}/zavrsi`, { method: "PATCH", telo: {} });
    provjeri("…posle „Završi povlačenje“ ništa ne fali", (await ana(`/neusaglasenosti/${nc6}`)).tijelo?.provjera?.fali === null);

    // ── Poruke: primljene, po vremenu ────────────────────────────────────────────────────────
    for (const [i, naslov] of [`${oznaka} prva`, `${oznaka} druga`].entries()) {
      const r = await marko("/poruke", { telo: { naslov, primaoci: { nacin: "pojedinacno", korisnici: [NALOZI.petar.id] } } });
      t.poruke.push(r.tijelo?.id);
      if (i === 0) await new Promise((ok) => setTimeout(ok, 30));
    }
    const primljene = (await petar("/poruke/primljene")).tijelo.filter((x) => x.naslov.startsWith(oznaka));
    provjeri(
      "Poruke: primalac ih vidi na strani Poruke, najnovija prva, sa pošiljaocem i da li je pročitao",
      primljene.length === 2 && primljene[0].naslov.endsWith("druga") && primljene[0].posiljalac && primljene[0].procitano_at === null,
      JSON.stringify(primljene.map((x) => x.naslov)),
    );

    // ── Izvještaji: filter po vremenu i po kategoriji (pregled = CSV) ───────────────────────
    const danas = await konsultant(`/izvoz/prijemi/pregled?od=${danasCG()}&do=${danasCG()}`);
    const buducnost = await konsultant(`/izvoz/prijemi/pregled?od=${sutra}`);
    provjeri(
      "Izvještaj: filter po vremenu (danas — ima današnji prijem; od sutra — ništa)",
      danas.status === 200 && danas.tijelo.datumKolona === "datum_prijema" && danas.tijelo.redovi.some((r) => r.broj_dokumenta === oznaka) && buducnost.tijelo.ukupno === 0,
      `${danas.status} ${danas.tijelo?.datumKolona} ${buducnost.tijelo?.ukupno}`,
    );
    const lotovi = await konsultant(`/izvoz/lotovi/pregled`);
    const status = await konsultant(`/izvoz/lotovi/pregled?f_status=PRIHVACEN`);
    provjeri(
      "…i po kategoriji (status lota) — spisak vrijednosti dolazi sa servera",
      Array.isArray(lotovi.tijelo.filteri?.status) && status.tijelo.redovi.length > 0 && status.tijelo.redovi.every((r) => r.status === "PRIHVACEN"),
      JSON.stringify(lotovi.tijelo.filteri?.status),
    );
    const csv = await fetch(`${process.env.APP_URL}/api/izvoz/prijemi.csv?od=${sutra}`, { headers: { "x-zahtjev-app": "1", cookie: konsultant.kolacic } }).then((r) => r.text());
    provjeri("…CSV poštuje isti filter (od sutra — samo zaglavlje)", csv.trim().split("\n").length === 1, `${csv.trim().split("\n").length} redova`);
    provjeri("…nepoznata kolona u filteru se ne koristi (bez greške)", (await konsultant(`/izvoz/lotovi/pregled?f_lozinka_hash=x`)).status === 200);

    // ── Audit: filteri ───────────────────────────────────────────────────────────────────────
    const f = (await ana("/audit/filteri")).tijelo;
    const samoAna = (await ana(`/audit?korisnikId=${NALOZI.ana.id}&akcija=KREIRANJE&od=${danasCG()}`)).tijelo;
    const trazi = (await ana(`/audit?q=${encodeURIComponent(oznaka)}`)).tijelo;
    provjeri(
      "Audit: filteri (ko, radnja, od dana, tekst) — spiskovi sa servera",
      f.akcije.includes("KREIRANJE") && f.korisnici.some((k) => k.id === NALOZI.ana.id) &&
        samoAna.length > 0 && samoAna.every((a) => a.korisnik_id === NALOZI.ana.id && a.akcija === "KREIRANJE") && trazi.length > 0,
      `${samoAna.length} ${trazi.length}`,
    );
    provjeri("…budući period — prazno", (await ana(`/audit?od=${sutra}`)).tijelo.length === 0);

    // ── Pitanje firme: nova verzija ──────────────────────────────────────────────────────────
    const pit = { tema: "Prijem", tekst: `${oznaka} Na kojoj temperaturi se prima jogurt?`, ponudjeniOdgovori: ["0–4 °C", "8–10 °C"], tacanIndeks: 0 };
    const p1 = await ana("/pitanja-firme", { telo: pit });
    t.pitanja.push(p1.tijelo?.id);
    const p2 = await ana(`/pitanja-firme/${p1.tijelo?.id}/nova-verzija`, { telo: { ...pit, tekst: `${oznaka} Do koje temperature se prima jogurt?` } });
    t.pitanja.push(p2.tijelo?.id);
    const svaPitanja = (await ana("/pitanja-firme")).tijelo;
    provjeri(
      "Pitanje firme: nova verzija — staro isključeno (ostaje u rezultatima), novo u upotrebi",
      p2.status === 201 && svaPitanja.find((x) => x.id === p1.tijelo.id)?.aktivno === false && svaPitanja.find((x) => x.id === p2.tijelo.id)?.aktivno === true,
      `${p2.status}`,
    );
  } finally {
    const k = await pool.connect();
    try {
      await k.query("begin");
      const art = t.artikli.filter(Boolean);
      const lotovi = (await k.query(`select id from lot where artikal_id = any($1)`, [art])).rows.map((r) => r.id);
      const isporuke = t.isporuke.filter(Boolean);
      const mjerenja = (await k.query(`select id from mjerenje_temperature where kontrolna_tacka_id = $1 or lot_id = any($2)`, [t.tacka, lotovi])).rows.map((r) => r.id);
      const kontrole = t.vozilo ? (await k.query(`select id from kontrola_vozila where vozilo_id = $1`, [t.vozilo])).rows.map((r) => r.id) : [];
      const povlacenja = (await k.query(`select id from povlacenje where lot_id = any($1)`, [lotovi])).rows.map((r) => r.id);
      const ncIds = (await k.query(`select id from neusaglasenost where id = any($1) or izvor_id = any($2)`, [t.nc.filter(Boolean), [...mjerenja, ...kontrole, ...isporuke, ...lotovi, ...povlacenja]])).rows.map((r) => r.id);
      const pravila = (await k.query(`select id from pravilo_kontrole where kontrolna_tacka_id = $1 or artikal_id = any($2)`, [t.tacka, art])).rows.map((r) => r.id);
      const provjere = t.uredjaj ? (await k.query(`select id from provjera_uredjaja where uredjaj_id = $1`, [t.uredjaj])).rows.map((r) => r.id) : [];
      const poruke = t.poruke.filter(Boolean);
      const pitanja = t.pitanja.filter(Boolean);
      const sve = [...art, ...lotovi, ...isporuke, ...mjerenja, ...kontrole, ...ncIds, ...povlacenja, ...pravila, ...provjere, ...poruke, ...pitanja, ...t.prijemi.filter(Boolean), t.vozilo, t.plan, t.tacka, t.uredjaj].filter(Boolean);
      await k.query(`delete from obavjestenje where izvor_id = any($1) or naslov like $2 or poruka like $2`, [sve, `%${oznaka}%`]);
      await k.query(`delete from zadatak where izvor_id = any($1)`, [sve]);
      await k.query(`delete from audit_log where entitet_id = any($1)`, [sve]);
      await k.query(`delete from verifikacija where neusaglasenost_id = any($1)`, [ncIds]);
      await k.query(`delete from korektivna_mjera where neusaglasenost_id = any($1)`, [ncIds]);
      await k.query(`delete from neusaglasenost where id = any($1)`, [ncIds]);
      await k.query(`delete from povlacenje_kontakt where povlacenje_id = any($1)`, [povlacenja]);
      await k.query(`delete from povlacenje where id = any($1)`, [povlacenja]);
      await k.query(`delete from mjerenje_temperature where id = any($1)`, [mjerenja]);
      await k.query(`delete from isporuka_stavka where isporuka_id = any($1)`, [isporuke]);
      await k.query(`delete from isporuka where id = any($1)`, [isporuke]);
      await k.query(`delete from kontrola_vozila where id = any($1)`, [kontrole]);
      if (t.plan) await k.query(`delete from plan_monitoringa where id = $1`, [t.plan]);
      if (t.vozilo) await k.query(`delete from vozilo where id = $1`, [t.vozilo]);
      await k.query(`delete from kretanje_zalihe where lot_id = any($1)`, [lotovi]);
      await k.query(`delete from zaliha where lot_id = any($1)`, [lotovi]);
      await k.query(`delete from prijem_stavka where prijem_id = any($1)`, [t.prijemi.filter(Boolean)]);
      await k.query(`delete from lot where id = any($1)`, [lotovi]);
      await k.query(`delete from prijem where id = any($1)`, [t.prijemi.filter(Boolean)]);
      await k.query(`delete from pravilo_kontrole where id = any($1)`, [pravila]);
      await k.query(`delete from artikal where id = any($1)`, [art]);
      await k.query(`delete from provjera_uredjaja where id = any($1)`, [provjere]);
      if (t.uredjaj) await k.query(`delete from mjerni_uredjaj where id = $1`, [t.uredjaj]);
      if (t.tacka) await k.query(`delete from kontrolna_tacka where id = $1`, [t.tacka]);
      await k.query(`delete from poruka where id = any($1)`, [poruke]);
      await k.query(`delete from pitanje where id = any($1)`, [pitanja]);
      await k.query(`delete from kljuc_zahtjeva where kljuc = any($1)`, [t.kljucevi]);
      await k.query("commit");
    } catch (e) {
      await k.query("rollback");
      throw new Error(`Čišćenje nije uspjelo: ${e.message} ${JSON.stringify(t)}`);
    } finally {
      k.release();
    }
  }
}
