// Podaci za testove ekrana na terenu: sopstveni artikal (bez režima), prijem sa jednim lotom, vozilo i
// isporuka za vozača Petra; za magacionera sopstvena komora i provjeren termometar. Sve se briše posle.
import { pool, prijava, NALOZI, danasCG, glavnoSkladiste, rokZaDana } from "../pomoc.mjs";

export async function napraviTeren(oznaka) {
  const ana = await prijava(NALOZI.ana);
  const marko = await prijava(NALOZI.marko);
  const trag = { oznaka, artikal: null, prijem: null, vozilo: null, isporuke: [], zapisi: [], tacka: null, uredjaj: null, pocetak: new Date() };
  const dobavljac = (await ana("/dobavljaci")).tijelo[0];
  const kupac = (await ana("/kupci")).tijelo[0];
  const skladisteId = await glavnoSkladiste(marko);
  const a = await ana("/artikli", { telo: { naziv: `${oznaka} keks`, tempKontrolisano: false } });
  trag.artikal = a.tijelo?.id;
  const p = await marko("/prijem", {
    telo: { dobavljacId: dobavljac.id, brojDokumenta: oznaka, datumPrijema: danasCG(), skladisteId, stavke: [{ artikalId: trag.artikal, brojLota: `${oznaka}-L`, primljenaKolicina: 10, rokTrajanja: rokZaDana(60) }] },
    zaglavlja: { "x-kljuc-zahtjeva": `${oznaka}-prijem` },
  });
  trag.prijem = p.tijelo?.id;
  const lot = (await pool.query(`select id from lot where prijem_id = $1`, [trag.prijem])).rows[0]?.id;
  await ana(`/prijem/${trag.prijem}/lot/${lot}/odluka`, { method: "PATCH", telo: { odluka: "PRIHVATI", kolicina: 10 } });
  const registarski = `E2E-${oznaka.slice(-7)}`;
  const v = await ana("/vozila", { telo: { registarskiBroj: registarski, tip: "kombi", tempKontrolisano: false } });
  trag.vozilo = v.tijelo?.id;
  const i = await ana("/isporuke", {
    telo: { kupacId: kupac.id, skladisteId, datumIsporuke: danasCG(), napomena: oznaka, vozilId: trag.vozilo, vozacKorisnikId: NALOZI.petar.id, stavke: [{ lotId: lot, planiranaKolicina: 2 }] },
    zaglavlja: { "x-kljuc-zahtjeva": `${oznaka}-isporuka` },
  });
  if (i.tijelo?.id) trag.isporuke.push(i.tijelo.id);
  const broj = (await pool.query(`select broj from isporuka where id = $1`, [i.tijelo?.id])).rows[0]?.broj;
  if (!trag.artikal || !trag.prijem || !trag.vozilo || !broj) {
    throw new Error(`Priprema terena nije uspjela: artikal ${a.status}, prijem ${p.status}, vozilo ${v.status}, isporuka ${i.status} ${i.tijelo?.error?.message ?? ""}`);
  }
  return { trag, registarski, isporukaId: i.tijelo.id, broj };
}

/** Komora sa pravilom 0–5 °C i provjeren termometar — za mjerenje sa telefona magacionera. */
export async function napraviKomoru(trag) {
  const ana = await prijava(NALOZI.ana);
  const marko = await prijava(NALOZI.marko);
  const kt = await ana("/kontrolne-tacke", { telo: { sifra: `E2EK${String(Date.now()).slice(-6)}`, naziv: `${trag.oznaka} komora` } });
  trag.tacka = kt.tijelo?.id;
  await ana("/pravila-kontrole", { telo: { kontrolnaTackaId: trag.tacka, naziv: "E2E komora 0–5 °C", minVrijednost: 0, maxVrijednost: 5, ozbiljnost: "VISOK" } });
  const ur = await ana("/mjerni-uredjaji", { telo: { naziv: `${trag.oznaka} termometar`, intervalProvjereMjeseci: 1 } });
  trag.uredjaj = ur.tijelo?.id;
  await marko(`/mjerni-uredjaji/${trag.uredjaj}/provjera`, { telo: { datum: danasCG(), vrsta: "INTERNA", referentna: 0, izmjereno: 0 } });
  if (!trag.tacka || !trag.uredjaj) throw new Error(`Komora ili termometar nisu napravljeni: ${kt.status} ${ur.status}`);
}

export async function ocisti(trag) {
  const k = await pool.connect();
  try {
    await k.query("begin");
    const lotovi = trag.artikal ? (await k.query(`select id from lot where artikal_id = $1`, [trag.artikal])).rows.map((r) => r.id) : [];
    const isporuke = trag.isporuke.filter(Boolean);
    const mjerenja = trag.tacka ? (await k.query(`select id from mjerenje_temperature where kontrolna_tacka_id = $1`, [trag.tacka])).rows.map((r) => r.id) : [];
    const kontrole = trag.vozilo ? (await k.query(`select id from kontrola_vozila where vozilo_id = $1`, [trag.vozilo])).rows.map((r) => r.id) : [];
    // Zapisi koje je test upisao kroz ekran (scenario ih pamti čim ih upiše).
    const zapisi = trag.zapisi.filter(Boolean);
    const ncIds = (
      await k.query(`select id from neusaglasenost where izvor_id = any($1) or opis like $2`, [[...mjerenja, ...kontrole, ...zapisi, ...isporuke, ...lotovi], `%${trag.oznaka}%`])
    ).rows.map((r) => r.id);
    const pravila = (await k.query(`select id from pravilo_kontrole where kontrolna_tacka_id = $1 or artikal_id = $2`, [trag.tacka, trag.artikal])).rows.map((r) => r.id);
    const provjere = trag.uredjaj ? (await k.query(`select id from provjera_uredjaja where uredjaj_id = $1`, [trag.uredjaj])).rows.map((r) => r.id) : [];
    const sve = [trag.tacka, trag.uredjaj, trag.artikal, trag.prijem, trag.vozilo, ...lotovi, ...isporuke, ...mjerenja, ...kontrole, ...zapisi, ...ncIds, ...pravila, ...provjere].filter(Boolean);
    await k.query(`delete from obavjestenje where izvor_id = any($1) or naslov like $2 or poruka like $2`, [sve, `%${trag.oznaka}%`]);
    await k.query(`delete from zadatak where izvor_id = any($1)`, [sve]);
    await k.query(`delete from audit_log where entitet_id = any($1)`, [sve]);
    await k.query(`delete from van_mreze_odbijeno where opis like $1`, [`%${trag.oznaka}%`]);
    await k.query(`delete from verifikacija where neusaglasenost_id = any($1)`, [ncIds]);
    await k.query(`delete from korektivna_mjera where neusaglasenost_id = any($1)`, [ncIds]);
    await k.query(`delete from neusaglasenost where id = any($1)`, [ncIds]);
    await k.query(`delete from zapis where id = any($1)`, [zapisi]);
    await k.query(`delete from mjerenje_temperature where id = any($1)`, [mjerenja]);
    await k.query(`delete from isporuka_stavka where isporuka_id = any($1)`, [isporuke]);
    await k.query(`delete from isporuka where id = any($1)`, [isporuke]);
    await k.query(`delete from kontrola_vozila where id = any($1)`, [kontrole]);
    if (trag.vozilo) await k.query(`delete from vozilo where id = $1`, [trag.vozilo]);
    await k.query(`delete from kretanje_zalihe where lot_id = any($1)`, [lotovi]);
    await k.query(`delete from zaliha where lot_id = any($1)`, [lotovi]);
    if (trag.prijem) await k.query(`delete from prijem_stavka where prijem_id = $1`, [trag.prijem]);
    await k.query(`delete from lot where id = any($1)`, [lotovi]);
    if (trag.prijem) await k.query(`delete from prijem where id = $1`, [trag.prijem]);
    await k.query(`delete from pravilo_kontrole where id = any($1)`, [pravila]);
    if (trag.artikal) await k.query(`delete from artikal where id = $1`, [trag.artikal]);
    await k.query(`delete from provjera_uredjaja where id = any($1)`, [provjere]);
    if (trag.uredjaj) await k.query(`delete from mjerni_uredjaj where id = $1`, [trag.uredjaj]);
    if (trag.tacka) await k.query(`delete from kontrolna_tacka where id = $1`, [trag.tacka]);
    await k.query(`delete from kljuc_zahtjeva where kljuc like $1 or created_at >= $2 and korisnik_id = any($3) and radnja like 'vm:%'`, [
      `${trag.oznaka}%`,
      trag.pocetak,
      [NALOZI.petar.id, NALOZI.marko.id],
    ]);
    await k.query("commit");
  } catch (e) {
    await k.query("rollback");
    throw new Error(`Čišćenje nije uspjelo: ${e.message} ${JSON.stringify(trag)}`);
  } finally {
    k.release();
  }
}
