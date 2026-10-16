// Plan monitoringa kad firma ima više magacina i više magacionera (#77): obaveza je MAGACINA, ne osobe.
// Ono što je izmjerio jedan magacioner više ne stoji drugome; mjerenje u jednom magacinu ne „pokriva“
// drugi; mjerenje i zapis pamte magacin; vidi se ko je uradio.
import { pool, prijava, NALOZI, danasCG, glavnoSkladiste } from "./pomoc.mjs";

export const naziv = "Plan monitoringa po magacinu: urađeno važi za sve u magacinu, ne za drugi magacin; ko je uradio";

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const marko = await prijava(NALOZI.marko);
  const konsultant = await prijava(NALOZI.konsultant);
  const oznaka = String(Date.now()).slice(-6);
  const trag = { tacka: null, magacinB: null, uredjaj: null, planovi: [], zapisi: [] };

  try {
    const magacinA = await glavnoSkladiste(marko);
    const b = await ana("/skladista", { telo: { naziv: `E2E Magacin B ${oznaka}` } });
    trag.magacinB = b.tijelo?.id;
    const kt = await ana("/kontrolne-tacke", { telo: { sifra: `E2EM${oznaka}`, naziv: `E2E komora ${oznaka}` } });
    trag.tacka = kt.tijelo?.id;
    await ana("/pravila-kontrole", { telo: { kontrolnaTackaId: trag.tacka, naziv: "E2E komora 0–5 °C", minVrijednost: 0, maxVrijednost: 5, ozbiljnost: "VISOK" } });
    // Mjerenje nosi termometar (R-23) — test ima svoj, provjeren.
    const ur = await ana("/mjerni-uredjaji", { telo: { naziv: `E2E termometar magacini ${oznaka}`, intervalProvjereMjeseci: 1 } });
    trag.uredjaj = ur.tijelo?.id;
    await marko(`/mjerni-uredjaji/${trag.uredjaj}/provjera`, { telo: { datum: danasCG(), vrsta: "INTERNA", referentna: 0, izmjereno: 0 } });

    const planA = await ana("/plan-monitoringa", {
      telo: { naziv: `E2E komora ${oznaka} — A`, vrsta: "mjerenje", kontrolnaTackaId: trag.tacka, ucestalost: "DNEVNO", puta: 1, uloga: "operater", skladisteId: magacinA },
    });
    const planB = await ana("/plan-monitoringa", {
      telo: { naziv: `E2E komora ${oznaka} — B`, vrsta: "mjerenje", kontrolnaTackaId: trag.tacka, ucestalost: "DNEVNO", puta: 1, uloga: "operater", skladisteId: trag.magacinB },
    });
    trag.planovi.push(planA.tijelo?.id, planB.tijelo?.id);
    provjeri("Plan: ista komora u dva magacina — dvije stavke", planA.status === 201 && planB.status === 201, `${planA.status} ${planB.status}`);

    const stavka = async (k, id) => (await k("/monitoring/danas")).tijelo.stavke.find((s) => s.id === id);
    const a0 = await stavka(ana, planA.tijelo.id);
    provjeri("Prije mjerenja: u magacinu A fali 1", a0?.uradjeno === 0 && a0.fali === 1, JSON.stringify(a0 && { u: a0.uradjeno, f: a0.fali }));

    // Magacioner mjeri u magacinu A.
    const m = await marko("/mjerenja", { telo: { kontrolnaTackaId: trag.tacka, vrijednost: 3.2, mjerniUredjajId: trag.uredjaj, skladisteId: magacinA } });
    provjeri("Mjerenje u magacinu A upisano", m.status === 201, `${m.status} ${m.tijelo?.error?.message ?? ""}`);
    const upisano = (await pool.query(`select skladiste_id from mjerenje_temperature where kontrolna_tacka_id = $1`, [trag.tacka])).rows;
    provjeri("…mjerenje pamti magacin", upisano.length === 1 && upisano[0].skladiste_id === magacinA);

    const aOdg = await stavka(ana, planA.tijelo.id);
    const aKons = await stavka(konsultant, planA.tijelo.id);
    const ime = (await pool.query(`select coalesce(l.ime, k.korisnicko_ime) as ime from korisnik k left join lice l on l.id = k.lice_id where k.id = $1`, [NALOZI.marko.id])).rows[0].ime;
    provjeri(
      "Drugi u firmi vidi da je u magacinu A urađeno — obaveza je magacina, ne osobe",
      aOdg?.uradjeno === 1 && aOdg.fali === 0 && aKons?.fali === 0,
      JSON.stringify({ odg: aOdg && [aOdg.uradjeno, aOdg.fali], kons: aKons && [aKons.uradjeno, aKons.fali] }),
    );
    provjeri("…i ko je uradio i kad („Marko, 08:14“)", aOdg?.uradili?.[0]?.ime === ime && /^\d{2}:\d{2}$/.test(aOdg?.uradili?.[0]?.vrijeme ?? ""), JSON.stringify(aOdg?.uradili));
    const bPosle = await stavka(ana, planB.tijelo.id);
    provjeri("Mjerenje u magacinu A NE pokriva magacin B — tamo i dalje fali", bPosle?.uradjeno === 0 && bPosle.fali === 1, JSON.stringify(bPosle && { u: bPosle.uradjeno, f: bPosle.fali }));

    await marko("/mjerenja", { telo: { kontrolnaTackaId: trag.tacka, vrijednost: 2.9, mjerniUredjajId: trag.uredjaj, skladisteId: trag.magacinB } });
    const bKraj = await stavka(ana, planB.tijelo.id);
    provjeri("Mjerenje u magacinu B zatvara stavku B", bKraj?.uradjeno === 1 && bKraj.fali === 0);

    // Dnevni zapis pamti magacin; ispravka ostaje u istom magacinu.
    const z = await marko("/zapisi", { telo: { obrazacKod: "P9", datum: danasCG(), podaci: { kante_zatvorene: true, izneseno: true }, skladisteId: trag.magacinB } });
    trag.zapisi.push(z.tijelo?.id);
    const isp = await marko("/zapisi", { telo: { obrazacKod: "P9", datum: danasCG(), podaci: { kante_zatvorene: true, izneseno: true }, ispravljaId: z.tijelo?.id } });
    trag.zapisi.push(isp.tijelo?.id);
    const zapisi = (await pool.query(`select id, skladiste_id from zapis where id = any($1)`, [trag.zapisi.filter(Boolean)])).rows;
    provjeri(
      "Zapis pamti magacin; ispravka ostaje u istom magacinu",
      zapisi.length === 2 && zapisi.every((r) => r.skladiste_id === trag.magacinB),
      JSON.stringify(zapisi),
    );
    provjeri("Nepostojeći magacin — odbijeno (400)", (await marko("/mjerenja", { telo: { kontrolnaTackaId: trag.tacka, vrijednost: 3, mjerniUredjajId: trag.uredjaj, skladisteId: "00000000-0000-0000-0000-000000000000" } })).status === 400);
  } finally {
    const k = await pool.connect();
    try {
      await k.query("begin");
      const zapisi = trag.zapisi.filter(Boolean);
      const mjerenja = trag.tacka ? (await k.query(`select id from mjerenje_temperature where kontrolna_tacka_id = $1`, [trag.tacka])).rows.map((r) => r.id) : [];
      const pravila = trag.tacka ? (await k.query(`select id from pravilo_kontrole where kontrolna_tacka_id = $1`, [trag.tacka])).rows.map((r) => r.id) : [];
      const provjere = trag.uredjaj ? (await k.query(`select id from provjera_uredjaja where uredjaj_id = $1`, [trag.uredjaj])).rows.map((r) => r.id) : [];
      const sve = [...zapisi, ...mjerenja, ...pravila, ...provjere, ...trag.planovi.filter(Boolean), trag.tacka, trag.magacinB, trag.uredjaj].filter(Boolean);
      await k.query(`delete from obavjestenje where izvor_id = any($1)`, [sve]);
      await k.query(`delete from audit_log where entitet_id = any($1)`, [sve]);
      await k.query(`delete from zapis where id = any($1)`, [zapisi]);
      await k.query(`delete from mjerenje_temperature where id = any($1)`, [mjerenja]);
      await k.query(`delete from plan_monitoringa where id = any($1)`, [trag.planovi.filter(Boolean)]);
      await k.query(`delete from pravilo_kontrole where id = any($1)`, [pravila]);
      await k.query(`delete from provjera_uredjaja where id = any($1)`, [provjere]);
      if (trag.uredjaj) await k.query(`delete from mjerni_uredjaj where id = $1`, [trag.uredjaj]);
      if (trag.tacka) await k.query(`delete from kontrolna_tacka where id = $1`, [trag.tacka]);
      if (trag.magacinB) await k.query(`delete from skladiste where id = $1`, [trag.magacinB]);
      await k.query("commit");
    } catch (e) {
      await k.query("rollback");
      throw new Error(`Čišćenje nije uspjelo: ${e.message} ${JSON.stringify(trag)}`);
    } finally {
      k.release();
    }
  }
}
