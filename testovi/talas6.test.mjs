// Talas 6 — rad bez interneta u ateljeu (invarijanta #85): zaposleni u hladnoj komori ili na dostavi torte. Upis
// koji je čekao na telefonu stiže kasnije, sa ključem zahtjeva i vremenom kad je stvarno urađen (`x-uradjeno-at`):
//   • isti upis poslat dvaput (izgubljen odgovor) → jedan zapis, isti odgovor; neuspio upis ne zauzima ključ;
//   • vrijeme radnje = vrijeme sa telefona, zapis nosi oznaku „bez mreže“; budućnost i starije od 36 h se ne primaju;
//   • predaja torte bez mreže: vrijeme predaje sa telefona, sa oznakom; ponovljeno slanje — isti odgovor;
//   • upis koji server odbije čuva se i javlja vlasnici.
// (D1 i predaja isporuke po danu — uklonjeni sa vozilima i isporukama, PLAN.md 8.3.)
// Test pravi svoju kontrolnu tačku, termometar, artikal, prijem i porudžbine, i sve briše.
import { pool, prijava, NALOZI, danasCG, glavnoSkladiste, rokZaDana } from "./pomoc.mjs";

export const naziv = "Talas 6: rad bez interneta — ključ, vrijeme sa telefona, predaja torte, odbijeni upisi";

const prije = (ms) => new Date(Date.now() - ms).toISOString();
/** Isti sadržaj bez obzira na redoslijed ključeva (sačuvan odgovor je jsonb — ključevi se preslože). */
const sredi = (x) => (Array.isArray(x) ? x.map(sredi) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sredi(x[k])])) : x);
const isto = (a, b) => JSON.stringify(sredi(a)) === JSON.stringify(sredi(b));
const blizu = (a, b, ms = 2000) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= ms;

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const marko = await prijava(NALOZI.marko);
  const oznaka = `E2E-T6-${Date.now().toString(36)}`;
  const kljucevi = [];
  const K = (s) => {
    const k = `${oznaka}-${s}`;
    if (!kljucevi.includes(k)) kljucevi.push(k);
    return k;
  };
  const trag = { tacka: null, uredjaj: null, artikal: null, prijem: null, porudzbine: [], zapisi: [] };

  try {
    // ── Priprema: komora sa pravilom 0–5 °C i provjeren termometar (R-23) ─────────────────────────
    const kt = await ana("/kontrolne-tacke", { telo: { sifra: `E2E6${String(Date.now()).slice(-6)}`, naziv: `${oznaka} komora` } });
    trag.tacka = kt.tijelo?.id;
    await ana("/pravila-kontrole", { telo: { kontrolnaTackaId: trag.tacka, naziv: "E2E6 komora 0–5 °C", minVrijednost: 0, maxVrijednost: 5, ozbiljnost: "VISOK" } });
    const ur = await ana("/mjerni-uredjaji", { telo: { naziv: `${oznaka} termometar`, intervalProvjereMjeseci: 1 } });
    trag.uredjaj = ur.tijelo?.id;
    await marko(`/mjerni-uredjaji/${trag.uredjaj}/provjera`, { telo: { datum: danasCG(), vrsta: "INTERNA", referentna: 0, izmjereno: 0 } });
    provjeri("Priprema: komora i ispravan termometar", !!trag.tacka && !!trag.uredjaj, `${kt.status} ${ur.status}`);
    const mjeri = (vrijednost, zaglavlja) => marko("/mjerenja", { telo: { kontrolnaTackaId: trag.tacka, vrijednost, mjerniUredjajId: trag.uredjaj }, zaglavlja });

    // ── Mjerenje sa telefona: vrijeme, oznaka, isti ključ ─────────────────────────────────────────
    const prije2h = prije(2 * 3600e3);
    const m1 = await mjeri(3.1, { "x-kljuc-zahtjeva": K("m1"), "x-uradjeno-at": prije2h });
    const m2 = await mjeri(3.1, { "x-kljuc-zahtjeva": K("m1"), "x-uradjeno-at": prije2h });
    provjeri(
      "Isti upis poslat dvaput (odgovor se izgubio) → isti odgovor",
      m1.status === 201 && m2.status === 201 && m1.tijelo.mjerenjeId === m2.tijelo.mjerenjeId,
      `${m1.status} ${m2.status} ${m1.tijelo?.error?.message ?? ""}`,
    );
    const mjerenja = (await pool.query(`select id, izmjereno_at, van_mreze, created_at from mjerenje_temperature where kontrolna_tacka_id = $1`, [trag.tacka])).rows;
    provjeri("…u bazi je jedno mjerenje", mjerenja.length === 1, `${mjerenja.length}`);
    provjeri(
      "Vrijeme mjerenja je vrijeme sa telefona, zapis nosi oznaku „bez mreže“, a stigao je sada",
      blizu(mjerenja[0]?.izmjereno_at, prije2h) && mjerenja[0]?.van_mreze === true && blizu(mjerenja[0]?.created_at, new Date(), 60_000),
      JSON.stringify(mjerenja[0]),
    );
    const obicno = await mjeri(3.3);
    const obicnoRed = (await pool.query(`select izmjereno_at, van_mreze from mjerenje_temperature where id = $1`, [obicno.tijelo?.mjerenjeId])).rows[0];
    provjeri("Običan upis: bez oznake, vrijeme servera", obicno.status === 201 && obicnoRed?.van_mreze === false && blizu(obicnoRed.izmjereno_at, new Date(), 60_000));

    // ── Vrijeme koje se ne prima ─────────────────────────────────────────────────────────────────
    const buducnost = await mjeri(3, { "x-uradjeno-at": new Date(Date.now() + 10 * 60e3).toISOString() });
    provjeri("Vrijeme u budućnosti se ne prima (sat na telefonu žuri) — 400", buducnost.status === 400 && buducnost.tijelo.error.code === "VRIJEME_U_BUDUCNOSTI", `${buducnost.status} ${buducnost.tijelo?.error?.code}`);
    const staro = await mjeri(3, { "x-uradjeno-at": prije(40 * 3600e3) });
    provjeri("Upis stariji od 36 sati se ne prima — 400", staro.status === 400 && staro.tijelo.error.code === "VAN_MREZE_PRESTARO", `${staro.status} ${staro.tijelo?.error?.code}`);
    const lose = await mjeri(3, { "x-uradjeno-at": "sinoc oko pet" });
    provjeri("Neispravno vrijeme — 400", lose.status === 400 && lose.tijelo.error.code === "NEISPRAVNO_VRIJEME", `${lose.status} ${lose.tijelo?.error?.code}`);

    // ── Neuspio upis ne zauzima ključ; ključ u obradi; zaglavljena rezervacija ──────────────────
    const bezTermometra = await marko("/mjerenja", { telo: { kontrolnaTackaId: trag.tacka, vrijednost: 3 }, zaglavlja: { "x-kljuc-zahtjeva": K("m4") } });
    provjeri("Upis koji server odbije (bez termometra) → 4xx", bezTermometra.status >= 400 && bezTermometra.status < 500, `${bezTermometra.status}`);
    const ispravljeno = await mjeri(3.2, { "x-kljuc-zahtjeva": K("m4") });
    provjeri("…isti ključ posle ispravke se prima (neuspjeh ne zauzima ključ)", ispravljeno.status === 201, `${ispravljeno.status} ${ispravljeno.tijelo?.error?.message ?? ""}`);
    await pool.query(`insert into kljuc_zahtjeva (korisnik_id, kljuc, radnja) values ($1, $2, 'vm:mjerenje')`, [NALOZI.marko.id, K("m5")]);
    const uToku = await mjeri(3, { "x-kljuc-zahtjeva": K("m5") });
    provjeri("Isti ključ dok je prvi upis još u obradi → 409 U_TOKU (telefon pokušava kasnije)", uToku.status === 409 && uToku.tijelo.error.code === "U_TOKU", `${uToku.status}`);
    await pool.query(`update kljuc_zahtjeva set created_at = now() - interval '11 minutes' where korisnik_id = $1 and kljuc = $2`, [NALOZI.marko.id, K("m5")]);
    const posleZastoja = await mjeri(3, { "x-kljuc-zahtjeva": K("m5") });
    provjeri("Rezervacija bez rezultata starija od 10 min (pao proces) se oslobađa", posleZastoja.status === 201, `${posleZastoja.status}`);

    // ── Van granice bez mreže → neusaglašenost sa oznakom ───────────────────────────────────────
    const van = await mjeri(9, { "x-kljuc-zahtjeva": K("m6"), "x-uradjeno-at": prije2h });
    const ncVan = (await pool.query(`select van_mreze from neusaglasenost where izvor_tip = 'mjerenje_temperature' and izvor_id = $1`, [van.tijelo?.mjerenjeId])).rows[0];
    provjeri("Mjerenje van granice bez mreže → FAIL i neusaglašenost sa oznakom „bez mreže“", van.tijelo?.rezultat === "FAIL" && ncVan?.van_mreze === true, `${van.status} ${van.tijelo?.rezultat} ${JSON.stringify(ncVan)}`);

    // ── Dnevni zapis i prijava problema ─────────────────────────────────────────────────────────
    const zapis = { obrazacKod: "P9", datum: danasCG(), podaci: { kante_zatvorene: true, izneseno: true } };
    const z1 = await marko("/zapisi", { telo: zapis, zaglavlja: { "x-kljuc-zahtjeva": K("z1"), "x-uradjeno-at": prije2h } });
    const z2 = await marko("/zapisi", { telo: zapis, zaglavlja: { "x-kljuc-zahtjeva": K("z1"), "x-uradjeno-at": prije2h } });
    trag.zapisi.push(z1.tijelo?.id);
    const zRed = (await pool.query(`select van_mreze from zapis where id = $1`, [z1.tijelo?.id])).rows[0];
    provjeri("Dnevni zapis bez mreže: jedan, sa oznakom", z1.status === 201 && z2.tijelo?.id === z1.tijelo?.id && zRed?.van_mreze === true, `${z1.status} ${z2.status}`);
    const problem = { opis: `${oznaka} vrata hladne komore ne dihtuju`, ozbiljnost: "NIZAK" };
    const nc1 = await marko("/neusaglasenosti", { telo: problem, zaglavlja: { "x-kljuc-zahtjeva": K("nc1"), "x-uradjeno-at": prije2h } });
    const nc2 = await marko("/neusaglasenosti", { telo: problem, zaglavlja: { "x-kljuc-zahtjeva": K("nc1"), "x-uradjeno-at": prije2h } });
    const ncRedovi = (await pool.query(`select van_mreze from neusaglasenost where opis = $1`, [problem.opis])).rows;
    provjeri(
      "Prijava problema bez mreže: jedna neusaglašenost, sa oznakom",
      nc1.status === 201 && nc2.tijelo?.broj === nc1.tijelo?.broj && ncRedovi.length === 1 && ncRedovi[0].van_mreze === true,
      `${nc1.status} ${ncRedovi.length}`,
    );

    // ── Predaja torte sa telefona ───────────────────────────────────────────────────────────────
    const dobavljac = (await ana("/dobavljaci")).tijelo[0];
    const skladisteId = await glavnoSkladiste(marko);
    const a = await ana("/artikli", { telo: { naziv: `${oznaka} keks (bez režima)`, tempKontrolisano: false, alergeni: ["GLUTEN"] } });
    trag.artikal = a.tijelo?.id;
    const p = await marko("/prijem", {
      telo: {
        dobavljacId: dobavljac.id,
        brojDokumenta: oznaka,
        datumPrijema: danasCG(),
        skladisteId,
        stavke: ["A", "B"].map((s) => ({ artikalId: trag.artikal, brojLota: `${oznaka}-${s}`, primljenaKolicina: 10, rokTrajanja: rokZaDana(60) })),
      },
      zaglavlja: { "x-kljuc-zahtjeva": K("prijem") },
    });
    trag.prijem = p.tijelo?.id;
    const lotovi = (await pool.query(`select id, broj_lota from lot where prijem_id = $1`, [trag.prijem])).rows;
    const lot = Object.fromEntries(lotovi.map((l) => [l.broj_lota.slice(-1), l.id]));
    for (const l of lotovi) await ana(`/prijem/${trag.prijem}/lot/${l.id}/odluka`, { method: "PATCH", telo: { odluka: "PRIHVATI", kolicina: 10 } });
    const torta = async (ime, lotId) => {
      const r = await marko("/porudzbine", { telo: { kupacIme: `${oznaka} ${ime}`, kupacTelefon: "067 777 888", preuzimanjeDatum: danasCG(), preuzimanjeVrijeme: "23:55", opis: "E2E torta" } });
      if (r.tijelo?.id) trag.porudzbine.push(r.tijelo.id);
      await marko(`/porudzbine/${r.tijelo.id}/lotovi`, { telo: { lotId } });
      return r;
    };
    const tA = await torta("Kupac A", lot.A);
    const tB = await torta("Kupac B", lot.B);
    await marko(`/porudzbine/${tA.tijelo.id}/alergeni`, { telo: { alergeni: ["GLUTEN"] } });
    provjeri("Priprema: dvije torte sa sastojcima", tA.status === 201 && tB.status === 201, `${tA.status} ${tB.status}`);
    const predaja = (id, zaglavlja) => marko(`/porudzbine/${id}/predaja`, { telo: { preuzeoIme: "E2E kupac" }, zaglavlja });

    const prije30 = prije(30 * 60e3);
    const pA = await predaja(tA.tijelo.id, { "x-kljuc-zahtjeva": K("pA"), "x-uradjeno-at": prije30 });
    const pA2 = await predaja(tA.tijelo.id, { "x-kljuc-zahtjeva": K("pA"), "x-uradjeno-at": prije30 });
    provjeri("Predaja torte bez mreže se prima", pA.status === 200, `${pA.status} ${pA.tijelo?.error?.message ?? ""}`);
    provjeri("…ponovljeno slanje vraća isti odgovor, ne 409 „već predata“", pA2.status === 200 && isto(pA2.tijelo, pA.tijelo), `${pA2.status}`);
    const redA = (await pool.query(`select predato_at, predaja_van_mreze from porudzbina where id = $1`, [tA.tijelo.id])).rows[0];
    provjeri("…vrijeme predaje je vrijeme sa telefona, sa oznakom", blizu(redA?.predato_at, prije30) && redA?.predaja_van_mreze === true, JSON.stringify(redA));

    // Torta B: alergeni nisu potvrđeni — server odbija predaju koja je čekala na telefonu.
    const pB0 = await predaja(tB.tijelo.id, { "x-kljuc-zahtjeva": K("pB0"), "x-uradjeno-at": prije30 });
    provjeri("Predaja sa telefona bez potvrđenih alergena se odbija (409)", pB0.status === 409 && pB0.tijelo.error.code === "ALERGENI_NISU_POTVRDJENI", `${pB0.status} ${pB0.tijelo?.error?.code}`);

    // ── Upis koji server nije primio se ne gubi ─────────────────────────────────────────────────
    const odb = await marko("/van-mreze/odbijeno", {
      telo: { putanja: `/porudzbine/${tB.tijelo.id}/predaja`, opis: `${oznaka} predaja torte`, telo: {}, greskaKod: "ALERGENI_NISU_POTVRDJENI", greskaPoruka: pB0.tijelo?.error?.message, uradjenoAt: prije30 },
    });
    provjeri("Upis bez mreže koji server nije primio čuva se na serveru (201)", odb.status === 201, `${odb.status} ${odb.tijelo?.error?.message ?? ""}`);
    const obavjestenje = (await ana("/obavjestenja")).tijelo.find((o) => (o.naslov ?? "").includes(oznaka) || (o.poruka ?? "").includes(oznaka));
    provjeri("…vlasnica dobija obavještenje", !!obavjestenje);
    const spisak = (await ana("/van-mreze/odbijeno")).tijelo;
    provjeri("…i vidi ga na spisku, sa imenom ko ga je upisao", spisak.some((x) => x.id === odb.tijelo?.id && x.ko && x.greska_kod === "ALERGENI_NISU_POTVRDJENI"));
    provjeri("…zaposleni ne vidi spisak (403)", (await marko("/van-mreze/odbijeno")).status === 403);
  } finally {
    const k = await pool.connect();
    try {
      await k.query("begin");
      const lotovi = trag.artikal ? (await k.query(`select id from lot where artikal_id = $1`, [trag.artikal])).rows.map((r) => r.id) : [];
      const porudzbine = trag.porudzbine.filter(Boolean);
      const mjerenja = trag.tacka ? (await k.query(`select id from mjerenje_temperature where kontrolna_tacka_id = $1`, [trag.tacka])).rows.map((r) => r.id) : [];
      const zapisi = trag.zapisi.filter(Boolean);
      const ncIds = (
        await k.query(`select id from neusaglasenost where izvor_id = any($1) or opis like $2`, [[...mjerenja, ...zapisi, ...porudzbine, ...lotovi], `${oznaka}%`])
      ).rows.map((r) => r.id);
      const pravila = (await k.query(`select id from pravilo_kontrole where kontrolna_tacka_id = $1 or artikal_id = $2`, [trag.tacka, trag.artikal])).rows.map((r) => r.id);
      const provjere = trag.uredjaj ? (await k.query(`select id from provjera_uredjaja where uredjaj_id = $1`, [trag.uredjaj])).rows.map((r) => r.id) : [];
      const sve = [trag.tacka, trag.uredjaj, trag.artikal, trag.prijem, ...lotovi, ...porudzbine, ...mjerenja, ...zapisi, ...ncIds, ...pravila, ...provjere].filter(Boolean);
      await k.query(`delete from obavjestenje where izvor_id = any($1) or naslov like $2 or poruka like $2`, [sve, `%${oznaka}%`]);
      await k.query(`delete from zadatak where izvor_id = any($1)`, [sve]);
      await k.query(`delete from audit_log where entitet_id = any($1)`, [sve]);
      await k.query(`delete from van_mreze_odbijeno where opis like $1`, [`${oznaka}%`]);
      await k.query(`delete from verifikacija where neusaglasenost_id = any($1)`, [ncIds]);
      await k.query(`delete from korektivna_mjera where neusaglasenost_id = any($1)`, [ncIds]);
      await k.query(`delete from neusaglasenost where id = any($1)`, [ncIds]);
      await k.query(`delete from zapis where id = any($1)`, [zapisi]);
      await k.query(`delete from mjerenje_temperature where id = any($1)`, [mjerenja]);
      await k.query(`delete from porudzbina_lot where porudzbina_id = any($1)`, [porudzbine]);
      await k.query(`delete from porudzbina where id = any($1)`, [porudzbine]);
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
      await k.query(`delete from kljuc_zahtjeva where kljuc = any($1)`, [kljucevi]);
      await k.query("commit");
    } catch (e) {
      await k.query("rollback");
      throw new Error(`Čišćenje nije uspjelo: ${e.message} ${JSON.stringify(trag)}`);
    } finally {
      k.release();
    }
  }
}
