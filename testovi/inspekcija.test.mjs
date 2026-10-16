// Inspekcijski paket (04.10.2026): sve evidencije za period na jednom mjestu + podaci u ZIP-u.
// Provjerava da paket nosi ono što je stvarno upisano (prijem sa temperaturom, mjerenje van granice i
// njegovu neusaglašenost, naknadan zapis i ispravku), da kontinuitet broji naknadne upise, da se period
// provjerava na serveru i da je ZIP ispravan (svaki fajl prolazi kontrolni zbir).
import { inflateRawSync, crc32 } from "node:zlib";
import { pool, prijava, preuzmi, NALOZI, danasCG, glavnoSkladiste, rokZaDana } from "./pomoc.mjs";

export const naziv = "Inspekcijski paket: kontinuitet, evidencije za period, ZIP sa CSV";

const danaPrije = (n) => {
  const d = new Date(`${danasCG()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

/** ZIP → { ime: { tekst, crcOk } } — čita centralni direktorijum kao svaki program za raspakivanje. */
function raspakuj(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("nema kraja ZIP arhive");
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const fajlovi = {};
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`loš zapis u direktorijumu (${i})`);
    const metoda = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const komp = buf.readUInt32LE(p + 20);
    const duzImena = buf.readUInt16LE(p + 28);
    const dodatak = buf.readUInt16LE(p + 30);
    const komentar = buf.readUInt16LE(p + 32);
    const lokalno = buf.readUInt32LE(p + 42);
    const ime = buf.toString("utf8", p + 46, p + 46 + duzImena);
    if (buf.readUInt32LE(lokalno) !== 0x04034b50) throw new Error(`loše lokalno zaglavlje (${ime})`);
    const pocetak = lokalno + 30 + buf.readUInt16LE(lokalno + 26) + buf.readUInt16LE(lokalno + 28);
    const sirovo = buf.subarray(pocetak, pocetak + komp);
    const podaci = metoda === 8 ? inflateRawSync(sirovo) : sirovo;
    fajlovi[ime] = { tekst: podaci.toString("utf8"), crcOk: crc32(podaci) === crc };
    p += 46 + duzImena + dodatak + komentar;
  }
  return fajlovi;
}

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const marko = await prijava(NALOZI.marko);
  const direktor = await prijava(NALOZI.direktor);
  const oznaka = `E2E-INSP-${Date.now().toString(36)}`;
  const t = { artikal: null, prijem: null, tacka: null, uredjaj: null, zapisi: [], nc: [] };
  const danas = danasCG();
  const juce = danaPrije(1);

  try {
    const dobavljac = (await ana("/dobavljaci")).tijelo[0];
    const skladisteId = await glavnoSkladiste(marko);

    // ── Podaci u periodu ──────────────────────────────────────────────────────────────────────
    const ur = await ana("/mjerni-uredjaji", { telo: { naziv: `${oznaka} termometar`, intervalProvjereMjeseci: 1 } });
    t.uredjaj = ur.tijelo?.id;
    await marko(`/mjerni-uredjaji/${t.uredjaj}/provjera`, { telo: { datum: danas, vrsta: "INTERNA", referentna: 0, izmjereno: 0.2 } });

    const art = await ana("/artikli", { telo: { naziv: `${oznaka} jogurt`, tempKontrolisano: true, tempMin: 0, tempMax: 4, granicaPotvrdio: true } });
    t.artikal = art.tijelo?.id;
    const pr = await marko("/prijem", {
      telo: {
        dobavljacId: dobavljac.id, brojDokumenta: oznaka, datumPrijema: danas, skladisteId, mjerniUredjajId: t.uredjaj,
        stavke: [{ artikalId: t.artikal, brojLota: `${oznaka}-L`, primljenaKolicina: 12, rokTrajanja: rokZaDana(15), temperaturaPrijema: 2.5 }],
      },
      zaglavlja: { "x-kljuc-zahtjeva": `${oznaka}-prijem` },
    });
    t.prijem = pr.tijelo?.id;

    const kt = await ana("/kontrolne-tacke", { telo: { sifra: `E2EI${String(Date.now()).slice(-6)}`, naziv: `${oznaka} komora` } });
    t.tacka = kt.tijelo?.id;
    await ana("/pravila-kontrole", { telo: { kontrolnaTackaId: t.tacka, naziv: "E2E 0–5 °C", minVrijednost: 0, maxVrijednost: 5, ozbiljnost: "VISOK" } });
    const fail = await marko("/mjerenja", { telo: { kontrolnaTackaId: t.tacka, vrijednost: 9.5, mjerniUredjajId: t.uredjaj } });
    t.nc.push(fail.tijelo?.neusaglasenostId);

    // Zapis za JUČE, upisan danas (odgovorno lice smije 7 dana unazad) — mora nositi „naknadno +1“.
    const z1 = await ana("/zapisi", { telo: { obrazacKod: "P7", datum: juce, podaci: { tragovi: false, mjesto: `${oznaka} rampa` } } });
    t.zapisi.push(z1.tijelo?.id);
    const z2 = await ana("/zapisi", { telo: { obrazacKod: "P7", datum: juce, podaci: { tragovi: false, mjesto: `${oznaka} rampa i ulaz` }, ispravljaId: z1.tijelo?.id } });
    t.zapisi.push(z2.tijelo?.id);

    // ── Paket ─────────────────────────────────────────────────────────────────────────────────
    const r = await ana(`/inspekcija?od=${juce}&do=${danas}`);
    const p = r.tijelo;
    provjeri(
      "Paket: 200, period od–do, kalendar po danu (2 dana), firma i ko je izradio",
      r.status === 200 && p.period.od === juce && p.period.do === danas && p.period.dana === 2 && p.kalendar.length === 2 && !!p.firma?.naziv && !!p.izradjeno.izradio,
      `${r.status} ${r.tijelo?.error?.message ?? ""} ${JSON.stringify(p?.period)} ${p?.kalendar?.length}`,
    );
    const st = p.prijemi?.find((x) => x.broj_lota === `${oznaka}-L`);
    provjeri(
      "KKT 1: stavka prijema sa lotom, rokom, temperaturom, granicom iz pravila, ocjenom i termometrom",
      Number(st?.temperatura) === 2.5 && st?.temp_rezultat === "PASS" && Number(st?.temp_min) === 0 && Number(st?.temp_max) === 4 && st?.termometar === `${oznaka} termometar` && !!st?.rok && st?.naknadno_dana === 0,
      JSON.stringify(st),
    );
    const m = p.mjerenja?.find((x) => x.tacka === `${oznaka} komora`);
    provjeri(
      "Mjerenje van granice: ocjena FAIL, granica, termometar, ko je mjerio",
      Number(m?.vrijednost) === 9.5 && m?.rezultat === "FAIL" && Number(m?.granica_max) === 5 && m?.termometar === `${oznaka} termometar` && !!m?.izmjerio,
      JSON.stringify(m),
    );
    const brojNc = (await pool.query(`select broj from neusaglasenost where id = $1`, [t.nc[0]])).rows[0]?.broj;
    provjeri("…i njegova neusaglašenost je u paketu (otvorena)", p.neusaglasenosti?.some((n) => n.broj === brojNc && n.status !== "ZATVORENA" && /Temperatura/.test(n.izvor ?? "")), brojNc);
    const zStari = p.zapisi?.find((x) => /rampa$/.test(x.odgovori ?? "") && x.odgovori.includes(oznaka));
    const zNovi = p.zapisi?.find((x) => x.odgovori?.includes(`${oznaka} rampa i ulaz`));
    provjeri(
      "Dnevni obrazac upisan dan kasnije: „naknadno +1“, odgovori čitljivo, naziv obrasca",
      zStari?.naknadno_dana === 1 && /Ima li tragova štetočina\?: ne/.test(zStari?.odgovori ?? "") && zStari?.obrazac === "Kontrola štetočina",
      JSON.stringify(zStari),
    );
    provjeri("…ispravka: obje verzije u paketu — stara „zamijenjen ispravkom“, nova „ispravka“", zStari?.verzija === "zamijenjen ispravkom" && zNovi?.verzija === "ispravka", `${zStari?.verzija} · ${zNovi?.verzija}`);
    const obrasci = p.sazetak.grupe.find((g) => g.naziv === "Dnevni obrasci");
    const danasRed = p.kalendar.find((d) => d.dan === danas);
    provjeri(
      "Kontinuitet: naknadni upis se broji (ispravka se ne broji kao nov zapis), današnji dan ima mjerenje i prijem",
      obrasci?.naknadno >= 1 && p.sazetak.naknadno >= 1 && p.sazetak.osoba >= 2 && danasRed?.mjerenja >= 1 && danasRed?.prijemi >= 1 && p.kalendar.find((d) => d.dan === juce)?.zapisi >= 1,
      JSON.stringify({ grupe: p.sazetak.grupe, osoba: p.sazetak.osoba, danasRed }),
    );
    provjeri(
      "Termometar: provjera iz perioda i stanje danas",
      p.termometri.provjere.some((x) => x.uredjaj === `${oznaka} termometar` && x.rezultat === "ISPRAVAN") && p.termometri.stanje.some((x) => x.naziv === `${oznaka} termometar`),
    );
    provjeri("Plan monitoringa, verifikacija sistema i knjižice su u paketu", Array.isArray(p.plan?.stavke) && p.verifikacija?.stanje?.length === 3 && Array.isArray(p.knjizice));

    // ── Period se provjerava na serveru ───────────────────────────────────────────────────────
    const obrnuto = await ana(`/inspekcija?od=${danas}&do=${juce}`);
    const predugo = await ana(`/inspekcija?od=${danaPrije(400)}&do=${danas}`);
    const buducnost = await ana(`/inspekcija?od=${rokZaDana(3)}`);
    provjeri(
      "Period: početak poslije kraja, duže od godine i budućnost — 400 sa porukom šta da se uradi",
      obrnuto.status === 400 && obrnuto.tijelo.error.code === "PERIOD_NEISPRAVAN" && predugo.status === 400 && predugo.tijelo.error.code === "PERIOD_PREDUG" &&
        buducnost.status === 400 && buducnost.tijelo.error.code === "PERIOD_U_BUDUCNOSTI",
      `${obrnuto.status} ${predugo.status} ${buducnost.status}`,
    );
    const bezOd = await ana("/inspekcija");
    provjeri("…bez perioda: godinu dana unazad, zaključno sa danas", bezOd.status === 200 && bezOd.tijelo.period.do === danas && bezOd.tijelo.period.dana === 366, JSON.stringify(bezOd.tijelo?.period));
    provjeri("Direktor (uprava) izvlači paket sam", (await direktor(`/inspekcija?od=${juce}&do=${danas}`)).status === 200);

    // ── ZIP ───────────────────────────────────────────────────────────────────────────────────
    const zip = await preuzmi(ana, `/inspekcija/paket.zip?od=${juce}&do=${danas}`);
    let fajlovi = {};
    try {
      fajlovi = raspakuj(zip.sadrzaj);
    } catch (e) {
      fajlovi = { greska: { tekst: e.message, crcOk: false } };
    }
    const imena = Object.keys(fajlovi);
    provjeri(
      "ZIP: ispravna arhiva — svaki fajl prolazi kontrolni zbir; SADRZAJ.txt i CSV po izvoru, bez dnevnika izmjena (audit)",
      zip.status === 200 && /application\/zip/.test(zip.tip ?? "") && imena.includes("SADRZAJ.txt") && imena.length >= 10 &&
        Object.values(fajlovi).every((f) => f.crcOk) && !imena.some((i) => i.includes("audit")),
      `${zip.status} ${zip.tip} ${imena.join(", ")}`,
    );
    const csv = (kraj) => fajlovi[imena.find((i) => i.endsWith(kraj))]?.tekst ?? "";
    provjeri(
      "…isti period kao paket: prijemi.csv ima naš prijem, mjerenja.csv naše mjerenje, SADRZAJ kaže period i broj redova",
      csv("-prijemi.csv").includes(oznaka) && csv("-mjerenja.csv").includes("9.5") && fajlovi["SADRZAJ.txt"]?.tekst.includes(`${juce} – ${danas}`) && /redova|red\b/.test(fajlovi["SADRZAJ.txt"]?.tekst ?? ""),
      fajlovi["SADRZAJ.txt"]?.tekst.slice(0, 300),
    );
  } finally {
    const k = await pool.connect();
    try {
      await k.query("begin");
      const lotovi = (await k.query(`select id from lot where artikal_id = $1`, [t.artikal])).rows.map((r) => r.id);
      const mjerenja = (await k.query(`select id from mjerenje_temperature where kontrolna_tacka_id = $1 or lot_id = any($2)`, [t.tacka, lotovi])).rows.map((r) => r.id);
      const zapisi = t.zapisi.filter(Boolean);
      const ncIds = (await k.query(`select id from neusaglasenost where id = any($1) or izvor_id = any($2)`, [t.nc.filter(Boolean), [...mjerenja, ...zapisi, ...lotovi]])).rows.map((r) => r.id);
      const pravila = (await k.query(`select id from pravilo_kontrole where kontrolna_tacka_id = $1 or artikal_id = $2`, [t.tacka, t.artikal])).rows.map((r) => r.id);
      const provjere = t.uredjaj ? (await k.query(`select id from provjera_uredjaja where uredjaj_id = $1`, [t.uredjaj])).rows.map((r) => r.id) : [];
      const sve = [...lotovi, ...mjerenja, ...zapisi, ...ncIds, ...pravila, ...provjere, t.artikal, t.prijem, t.tacka, t.uredjaj].filter(Boolean);
      await k.query(`delete from obavjestenje where izvor_id = any($1) or naslov like $2 or poruka like $2`, [sve, `%${oznaka}%`]);
      await k.query(`delete from zadatak where izvor_id = any($1)`, [sve]);
      await k.query(`delete from audit_log where entitet_id = any($1)`, [sve]);
      await k.query(`delete from verifikacija where neusaglasenost_id = any($1)`, [ncIds]);
      await k.query(`delete from korektivna_mjera where neusaglasenost_id = any($1)`, [ncIds]);
      await k.query(`delete from neusaglasenost where id = any($1)`, [ncIds]);
      await k.query(`delete from mjerenje_temperature where id = any($1)`, [mjerenja]);
      // Ispravka pokazuje na original — prvo ispravka, pa original.
      for (const id of [...zapisi].reverse()) await k.query(`delete from zapis where id = $1`, [id]);
      await k.query(`delete from kretanje_zalihe where lot_id = any($1)`, [lotovi]);
      await k.query(`delete from zaliha where lot_id = any($1)`, [lotovi]);
      if (t.prijem) await k.query(`delete from prijem_stavka where prijem_id = $1`, [t.prijem]);
      await k.query(`delete from lot where id = any($1)`, [lotovi]);
      if (t.prijem) await k.query(`delete from prijem where id = $1`, [t.prijem]);
      await k.query(`delete from pravilo_kontrole where id = any($1)`, [pravila]);
      if (t.artikal) await k.query(`delete from artikal where id = $1`, [t.artikal]);
      await k.query(`delete from provjera_uredjaja where id = any($1)`, [provjere]);
      if (t.uredjaj) await k.query(`delete from mjerni_uredjaj where id = $1`, [t.uredjaj]);
      if (t.tacka) await k.query(`delete from kontrolna_tacka where id = $1`, [t.tacka]);
      await k.query(`delete from kljuc_zahtjeva where kljuc like $1`, [`${oznaka}%`]);
      await k.query("commit");
    } catch (e) {
      await k.query("rollback");
      throw new Error(`Čišćenje nije uspjelo: ${e.message} ${JSON.stringify(t)}`);
    } finally {
      k.release();
    }
  }
}
