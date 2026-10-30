// Kolači iz vitrine (dopuna 42): serija kolača sa serijama sastojaka (kao torta, P2), prodaja „Prodat 1“ i više, otpis uz
// razlog, zbir nikad preko napravljenog, rok, poništavanje pogrešnog dodira (svoj u 10 min, stariji — odgovorno lice uz
// razlog), istorija po danima (zaposleni od juče), Kontrolni centar „skloniti“, povlačenje → „Skloni iz vitrine“ i prodaja
// odbijena, sledljivost lot → kolači, izvoz po danu. Pravi svoje artikle i lotove i briše sve što napravi.
import { pool, prijava, NALOZI, danasCG, rokZaDana } from "./pomoc.mjs";

export const naziv = "Vitrina: kolači po seriji sastojaka, prodaja i otpis po danu, zadržan sastojak, sledljivost";

const OZNAKA = `E2E-VIT-${Date.now().toString(36)}`;

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const marko = await prijava(NALOZI.marko);
  const konsultant = await prijava(NALOZI.konsultant);
  const trag = { artikli: [], prijem: null, lotovi: [], serije: [], povlacenje: null, nc: [], kljuc: `${OZNAKA}-kljuc-1` };
  const dd = (dan) => `${dan.slice(8, 10)}.${dan.slice(5, 7)}.`;

  try {
    // Sastojci (lotovi kao poslije prijema i odluke): prihvaćeni, istekao i zadržan.
    const jaja = await ana("/artikli", { telo: { naziv: `${OZNAKA} Jaja M`, jedinicaMjere: "kom", alergeni: ["JAJA"] } });
    const maskarpone = await ana("/artikli", { telo: { naziv: `${OZNAKA} Maskarpone`, jedinicaMjere: "kg", alergeni: ["MLIJEKO"] } });
    const kakao = await ana("/artikli", { telo: { naziv: `${OZNAKA} Kakao`, jedinicaMjere: "kg" } });
    trag.artikli.push(jaja.tijelo?.id, maskarpone.tijelo?.id, kakao.tijelo?.id);
    const dobavljac = (await pool.query(`select id from dobavljac where aktivan order by naziv limit 1`)).rows[0].id;
    trag.prijem = (await pool.query(`insert into prijem (dobavljac_id, broj_dokumenta, datum_prijema, status, primio_korisnik_id) values ($1, $2, $3, 'PRIHVACEN', $4) returning id`, [dobavljac, OZNAKA, rokZaDana(-2), NALOZI.marko.id])).rows[0].id;
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
    const lotMaskarpone = await lot(maskarpone.tijelo.id, `${OZNAKA}-M1`, rokZaDana(5));
    const lotKakao = await lot(kakao.tijelo.id, `${OZNAKA}-K1`, rokZaDana(200));
    const lotIstekao = await lot(jaja.tijelo.id, `${OZNAKA}-J0`, rokZaDana(-1));
    const lotZadrzan = await lot(maskarpone.tijelo.id, `${OZNAKA}-M0`, rokZaDana(5), "HOLD");

    // ── Napravljeno ──
    const osnova = { naziv: `${OZNAKA} Tiramisu`, komada: 10, rok: rokZaDana(2), lotIds: [lotJaja, lotMaskarpone, lotKakao] };
    const bezNaziva = await marko("/vitrina", { telo: { ...osnova, naziv: " " } });
    provjeri("Kolač bez naziva se ne upisuje (400)", bezNaziva.status === 400);
    const rokPrije = await marko("/vitrina", { telo: { ...osnova, rok: rokZaDana(-1) } });
    provjeri("Rok prije dana izrade se ne prima (400)", rokPrije.status === 400 && rokPrije.tijelo?.error?.code === "ROK_PRIJE_IZRADE", rokPrije.tijelo?.error?.code);
    const staro = await marko("/vitrina", { telo: { ...osnova, datum: rokZaDana(-3), rok: rokZaDana(-1) } });
    provjeri("#9: zaposleni ne upisuje kolač napravljen prije 3 dana (400)", staro.status === 400 && staro.tijelo?.error?.code === "DATUM_VAN_PROZORA", staro.tijelo?.error?.code);
    const istekaoLot = await marko("/vitrina", { telo: { ...osnova, lotIds: [lotIstekao] } });
    provjeri("P2: istekao sastojak ne ide u kolač (409)", istekaoLot.status === 409 && istekaoLot.tijelo?.error?.code === "ROK_ISTEKAO", istekaoLot.tijelo?.error?.message);
    const zadrzanLot = await marko("/vitrina", { telo: { ...osnova, lotIds: [lotZadrzan] } });
    provjeri("P2: zadržan sastojak ne ide u kolač (409)", zadrzanLot.status === 409 && zadrzanLot.tijelo?.error?.code === "LOT_NIJE_PRIHVACEN");
    provjeri("…odbijen upis ne ostavlja kolač u bazi", (await pool.query(`select count(*)::int as n from serija_vitrine where naziv like $1`, [`${OZNAKA}%`])).rows[0].n === 0);

    const nova = await marko("/vitrina", { telo: osnova, zaglavlja: { "x-kljuc-zahtjeva": trag.kljuc } });
    trag.serije.push(nova.tijelo?.id);
    provjeri("Zaposleni upisuje „Napravljeno“ — broj VIT-…", nova.status === 201 && /^VIT-\d{6}-\d{3}$/.test(nova.tijelo?.broj ?? ""), JSON.stringify(nova.tijelo));
    const ponovo = await marko("/vitrina", { telo: osnova, zaglavlja: { "x-kljuc-zahtjeva": trag.kljuc } });
    provjeri("#52: isti ključ zahtjeva — isti kolač, ne drugi", ponovo.status === 201 && ponovo.tijelo?.id === nova.tijelo.id);
    const id = nova.tijelo.id;

    let vitrina = (await ana("/vitrina")).tijelo;
    let k = vitrina.serije.find((s) => s.id === id);
    provjeri(
      "P5: vlasnica vidi kolač koji je upisao zaposleni — 10 u vitrini, alergeni iz sastojaka, Kakao bez upisanih alergena",
      k?.ostalo === 10 && k.alergeni.join() === "JAJA,MLIJEKO" && k.bezAlergena.some((a) => a.includes("Kakao")) && k.sastojci.length === 3,
      JSON.stringify(k && { ostalo: k.ostalo, alergeni: k.alergeni, bez: k.bezAlergena }),
    );
    provjeri("Forma dobija naziv sa rokom kao prošli put (2 dana) i artiklima", vitrina.nazivi.some((n) => n.naziv === osnova.naziv && n.rok_dana === 2 && n.artikli.length === 3));
    provjeri("Konsultant vidi vitrinu", (await konsultant("/vitrina")).tijelo?.serije?.some((s) => s.id === id));

    // ── Prodaja i otpis ──
    const p1 = await marko(`/vitrina/${id}/promet`, { telo: { prodato: 1 } });
    provjeri("„Prodat 1“ — u vitrini ostaje 9", p1.status === 200 && p1.tijelo?.ostalo === 9, JSON.stringify(p1.tijelo));
    const p3 = await marko(`/vitrina/${id}/promet`, { telo: { prodato: 3 } });
    provjeri("„Upiši više“ (3) — ostaje 6", p3.tijelo?.ostalo === 6);
    const previse = await marko(`/vitrina/${id}/promet`, { telo: { prodato: 7 } });
    provjeri("Ne prodaje se više nego što je u vitrini (409, kaže koliko je ostalo)", previse.status === 409 && previse.tijelo?.error?.code === "NEMA_U_VITRINI" && /ostalo 6/.test(previse.tijelo.error.message), previse.tijelo?.error?.message);
    const nula = await marko(`/vitrina/${id}/promet`, { telo: { prodato: 0, otpisano: 0 } });
    provjeri("Upis bez komada se ne prima (400)", nula.status === 400 && nula.tijelo?.error?.code === "KOLICINA_OBAVEZNA");
    const otpisBez = await marko(`/vitrina/${id}/promet`, { telo: { otpisano: 1 } });
    provjeri("Otpis bez razloga se ne prima (400)", otpisBez.status === 400 && otpisBez.tijelo?.error?.code === "RAZLOG_OBAVEZAN");
    const otpis = await marko(`/vitrina/${id}/promet`, { telo: { otpisano: 1, razlog: "Oštećen pri slaganju" } });
    provjeri("Otpis uz razlog — ostaje 5", otpis.tijelo?.ostalo === 5);
    const sutra = await marko(`/vitrina/${id}/promet`, { telo: { prodato: 1, datum: rokZaDana(1) } });
    provjeri("Prodaja za sutra se ne prima (400)", sutra.status === 400 && sutra.tijelo?.error?.code === "DATUM_U_BUDUCNOSTI");
    const prijeIzrade = await ana(`/vitrina/${id}/promet`, { telo: { prodato: 1, datum: rokZaDana(-1) } });
    provjeri("Prodaja prije dana izrade se ne prima (400)", prijeIzrade.status === 400 && prijeIzrade.tijelo?.error?.code === "DATUM_PRIJE_IZRADE", prijeIzrade.tijelo?.error?.code);

    // ── Poništavanje (#1: upis se ne mijenja — pogrešan dodir se poništava, uz trag u auditu) ──
    k = (await marko("/vitrina")).tijelo.serije.find((s) => s.id === id);
    provjeri("Kartica nudi „Poništi“ za posljednji svoj upis (otpis 1)", k?.ponisti_id === otpis.tijelo.id && k.ponisti_otpisano === 1, JSON.stringify(k && { p: k.ponisti_id, o: k.ponisti_otpisano }));
    const tudjiBez = await ana(`/vitrina/promet/${otpis.tijelo.id}/ponisti`, { telo: {} });
    provjeri("Odgovorno lice tuđi upis poništava samo uz razlog (400)", tudjiBez.status === 400 && tudjiBez.tijelo?.error?.code === "RAZLOG_OBAVEZAN");
    const svoj = await marko(`/vitrina/promet/${otpis.tijelo.id}/ponisti`, { telo: {} });
    provjeri("Zaposleni poništava svoj svjež upis bez pitanja — ostaje 6", svoj.status === 200 && svoj.tijelo?.ostalo === 6, JSON.stringify(svoj.tijelo));
    provjeri("Poništen upis se ne poništava dvaput (404)", (await marko(`/vitrina/promet/${otpis.tijelo.id}/ponisti`, { telo: {} })).status === 404);
    await pool.query(`update serija_vitrine_promet set created_at = now() - interval '20 minutes' where id = $1`, [p1.tijelo.id]);
    const kasno = await marko(`/vitrina/promet/${p1.tijelo.id}/ponisti`, { telo: {} });
    provjeri("Upis stariji od 10 minuta zaposleni ne poništava — to radi odgovorno lice (403)", kasno.status === 403 && kasno.tijelo?.error?.code === "PONISTAVA_ODGOVORNO_LICE", kasno.tijelo?.error?.code);
    const vodstvo = await ana(`/vitrina/promet/${p1.tijelo.id}/ponisti`, { telo: { razlog: "Upisano greškom, nije prodato" } });
    provjeri("…odgovorno lice ga poništava uz razlog — ostaje 7", vodstvo.status === 200 && vodstvo.tijelo?.ostalo === 7);
    const ponistenja = (await pool.query(`select count(*)::int as n from audit_log where entitet_id = $1 and nove_vrijednosti->>'ponisteno' is not null`, [id])).rows[0].n;
    provjeri("Audit pamti oba poništena upisa (šta, ko, zašto)", ponistenja === 2, String(ponistenja));
    const det = (await marko(`/vitrina/${id}`)).tijelo;
    provjeri("Detalj: prodato 3, u vitrini 7, jedan upis — svoj svjež, smije se poništiti", det.prodato === 3 && det.ostalo === 7 && det.promet.length === 1 && det.promet[0].mozePonistiti === true && det.promet[0].trebaRazlog === false, JSON.stringify(det.promet));

    // ── Sastojci i ispravka ──
    const skini = await marko(`/vitrina/${id}/lotovi/${lotKakao}`, { method: "DELETE" });
    provjeri("Sastojak prodavanog kolača se ne skida (409 — povlačenje ne smije izostaviti kolač)", skini.status === 409 && skini.tijelo?.error?.code === "SASTOJAK_OSTAJE");
    const manje = await marko(`/vitrina/${id}`, { method: "PATCH", telo: { naziv: osnova.naziv, komada: 2, rok: osnova.rok } });
    provjeri("Napravljeno ne može biti manje od prodatog (409)", manje.status === 409 && manje.tijelo?.error?.code === "KOMADA_MANJE");
    const ispravka = await marko(`/vitrina/${id}`, { method: "PATCH", telo: { naziv: osnova.naziv, komada: 12, rok: osnova.rok } });
    provjeri("Ispravka broja komada (12) — u vitrini 9", ispravka.status === 204 && (await marko(`/vitrina/${id}`)).tijelo.ostalo === 9);
    const izmjena = (await pool.query(`select stare_vrijednosti, nove_vrijednosti from audit_log where entitet_id = $1 and akcija = 'IZMJENA' and nove_vrijednosti ? 'komada'`, [id])).rows[0];
    provjeri("Audit pamti „bilo → sada“ (10 → 12)", Number(izmjena?.stare_vrijednosti?.komada) === 10 && Number(izmjena?.nove_vrijednosti?.komada) === 12, JSON.stringify(izmjena));

    const bezSastojaka = await marko("/vitrina", { telo: { naziv: `${OZNAKA} Čokoladni mousse`, komada: 6, rok: rokZaDana(1), lotIds: [] } });
    trag.serije.push(bezSastojaka.tijelo?.id);
    const id2 = bezSastojaka.tijelo?.id;
    provjeri("Kolač bez sastojaka se prima (kartica kaže da fale)", bezSastojaka.status === 201 && (await marko("/vitrina")).tijelo.serije.find((s) => s.id === id2)?.sastojci.length === 0);
    const dodat = await marko(`/vitrina/${id2}/lotovi`, { telo: { lotId: lotMaskarpone } });
    const dvaput = await marko(`/vitrina/${id2}/lotovi`, { telo: { lotId: lotMaskarpone } });
    provjeri("Zaboravljen sastojak se dopisuje (drugi put — ništa novo)", dodat.tijelo?.dodato === true && dvaput.tijelo?.dodato === false);
    provjeri("Dok se nije prodavao, pogrešan sastojak se skida", (await marko(`/vitrina/${id2}/lotovi/${lotMaskarpone}`, { method: "DELETE" })).status === 204);
    await marko(`/vitrina/${id2}/lotovi`, { telo: { lotId: lotJaja } });
    await marko(`/vitrina/${id2}/promet`, { telo: { prodato: 2 } });

    // ── Rok istekao i Kontrolni centar ──
    const stara = await ana("/vitrina", { telo: { naziv: `${OZNAKA} Krempita`, komada: 4, datum: rokZaDana(-1), rok: rokZaDana(-1), lotIds: [lotKakao] } });
    trag.serije.push(stara.tijelo?.id);
    const id3 = stara.tijelo?.id;
    provjeri("Odgovorno lice upisuje jučerašnji kolač (prozor 7 dana)", stara.status === 201, JSON.stringify(stara.tijelo));
    provjeri("Kartica: rok istekao", (await marko("/vitrina")).tijelo.serije.find((s) => s.id === id3)?.istekao === true);
    const posleRoka = await marko(`/vitrina/${id3}/promet`, { telo: { prodato: 1 } });
    provjeri("Posle roka se ne prodaje (409)", posleRoka.status === 409 && posleRoka.tijelo?.error?.code === "ROK_ISTEKAO", posleRoka.tijelo?.error?.message);
    const juceProdato = await marko(`/vitrina/${id3}/promet`, { telo: { prodato: 1, datum: rokZaDana(-1) } });
    provjeri("…ali se jučerašnja prodaja (do roka) upisuje", juceProdato.status === 200 && juceProdato.tijelo?.ostalo === 3);
    let tabla = (await ana("/tabla")).tijelo;
    let lista = (await ana("/tabla/detalj/vitrina")).tijelo?.redovi ?? [];
    provjeri("Kontrolni centar: „Vitrina: skloniti“ broji kolač sa isteklim rokom, lista kaže zašto", tabla.kriticno.vitrinaSkloniti >= 1 && lista.some((r) => r.broj === stara.tijelo.broj && r.razlog === "istekao rok"), JSON.stringify(lista));
    provjeri("…i „Vitrina danas“: napravljeno i prodato danas", tabla.operativno.vitrinaDanas.napravljeno >= 18 && tabla.operativno.vitrinaDanas.prodato >= 5, JSON.stringify(tabla.operativno.vitrinaDanas));
    const otpisRoka = await marko(`/vitrina/${id3}/promet`, { telo: { otpisano: 3, razlog: "Istekao rok" } });
    lista = (await ana("/tabla/detalj/vitrina")).tijelo?.redovi ?? [];
    provjeri("Otpis ostatka — kolač više nije na listi „skloniti“", otpisRoka.tijelo?.ostalo === 0 && !lista.some((r) => r.broj === stara.tijelo.broj));
    provjeri("Rasprodat kolač nije u vitrini (osim za „Poništi“ onome ko je upisao)", !(await ana("/vitrina")).tijelo.serije.some((s) => s.id === id3) && (await marko("/vitrina")).tijelo.serije.find((s) => s.id === id3)?.rasprodato === true);

    // ── Istorija po danima ──
    const ist = (await marko(`/vitrina/istorija?od=${rokZaDana(-1)}&do=${danasCG()}`)).tijelo;
    const danas = ist?.dani?.find((d) => d.dan === danasCG());
    const juce = ist?.dani?.find((d) => d.dan === rokZaDana(-1));
    provjeri(
      "Istorija: danas napravljeno Tiramisu i Mousse, prodato 5, otpis 3 (Istekao rok); juče napravljena Krempita, prodata 1",
      danas?.napravljeno.some((n) => n.id === id) && danas.napravljeno.some((n) => n.id === id2) &&
        danas.promet.filter((p) => [id, id2, id3].includes(p.id)).reduce((z, p) => z + p.prodato, 0) === 5 &&
        danas.promet.some((p) => p.id === id3 && p.otpisano === 3 && p.razlozi === "Istekao rok") &&
        juce?.napravljeno.some((n) => n.id === id3) && juce.promet.some((p) => p.id === id3 && p.prodato === 1),
      JSON.stringify({ danas, juce }),
    );
    const daleko = await marko(`/vitrina/istorija?od=${rokZaDana(-10)}&do=${rokZaDana(-5)}`);
    provjeri("#6: zaposleni ne vidi istoriju stariju od juče (400)", daleko.status === 400 && daleko.tijelo?.error?.code === "PERIOD_VAN_PROZORA", daleko.tijelo?.error?.code);
    provjeri("Odgovorno lice vidi i 30 dana", (await ana(`/vitrina/istorija?od=${rokZaDana(-30)}`)).status === 200);

    // ── Povlačenje serije jaja: „Skloni iz vitrine“, prodaja zaustavljena ──
    const pv = await ana(`/sledljivost/lot/${lotJaja}/povlacenje`, { telo: { razlog: `${OZNAKA}: sumnja na salmonelu` } });
    trag.povlacenje = pv.tijelo?.id;
    if (pv.tijelo?.neusaglasenostId) trag.nc.push(pv.tijelo.neusaglasenostId);
    provjeri("Povlačenje kaže koliko je komada prodato iz vitrine kupcima bez imena (3 + 2)", pv.status === 201 && pv.tijelo?.vitrinaProdato === 5, JSON.stringify(pv.tijelo));
    const markova = (await marko("/obavjestenja")).tijelo;
    provjeri(
      "Zaposleni dobija „Skloni iz vitrine“ za oba kolača sa jajima koja su još u vitrini",
      markova.some((o) => o.izvor_id === id && o.naslov.startsWith("Skloni iz vitrine")) && markova.some((o) => o.izvor_id === id2 && o.naslov.startsWith("Skloni iz vitrine")),
      markova.filter((o) => o.naslov.startsWith("Skloni")).map((o) => o.naslov).join(" | "),
    );
    const anina = (await ana("/obavjestenja")).tijelo;
    provjeri("…ko je pokrenuo povlačenje ne dobija „Skloni“, ali zna koliko je prodato iz vitrine", !anina.some((o) => o.naslov.startsWith("Skloni iz vitrine") && [id, id2].includes(o.izvor_id)) && anina.some((o) => o.izvor_id === trag.povlacenje && /Iz vitrine je prodato 5 kom/.test(o.poruka ?? "")));
    const zaustavljeno = await marko(`/vitrina/${id}/promet`, { telo: { prodato: 1 } });
    provjeri("Kolač sa zadržanim sastojkom se ne prodaje (409)", zaustavljeno.status === 409 && zaustavljeno.tijelo?.error?.code === "SASTOJAK_ZADRZAN", zaustavljeno.tijelo?.error?.message);
    const ranije = await marko(`/vitrina/${id}/promet`, { telo: { prodato: 1, prijeZadrzavanja: true } });
    provjeri("…prodaja PRIJE zadržavanja se upisuje samo uz izričitu potvrdu — i ostaje u auditu", ranije.status === 200 && (await pool.query(`select count(*)::int as n from audit_log where entitet_id = $1 and nove_vrijednosti->>'prijeZadrzavanja' = 'true'`, [id])).rows[0].n === 1);
    tabla = (await ana("/tabla")).tijelo;
    lista = (await ana("/tabla/detalj/vitrina")).tijelo?.redovi ?? [];
    provjeri("Kontrolni centar: kolač sa zadržanim sastojkom je na listi „skloniti“", lista.some((r) => r.broj === nova.tijelo.broj && r.razlog.startsWith("zadržan sastojak")), JSON.stringify(lista));

    // ── Sledljivost i izvoz ──
    const lanac = (await ana(`/sledljivost/lot/${lotJaja}/vitrina`)).tijelo;
    const uLancu = lanac.find((s) => s.id === id);
    provjeri("Sledljivost: serija jaja → kolači iz vitrine, prodato po danima", uLancu?.prodato === 4 && uLancu.prodato_po_danima === `${dd(danasCG())} — 4 kom.` && lanac.some((s) => s.id === id2), JSON.stringify(lanac));
    provjeri("Sledljivost kroz kolače vidi vodstvo, ne zaposleni (403)", (await marko(`/sledljivost/lot/${lotJaja}/vitrina`)).status === 403);
    const izvoz = (await konsultant("/izvoz/vitrina/pregled")).tijelo?.redovi ?? [];
    const uIzvozu = izvoz.find((r) => r.Broj === nova.tijelo.broj);
    provjeri(
      "Izvoz: po seriji — napravljeno 12, prodato 4, promet sabran po danu, sastojci i alergeni nazivima",
      uIzvozu?.Napravljeno === 12 && uIzvozu.Prodato === 4 && uIzvozu["U vitrini"] === 8 && uIzvozu["Promet po danima"] === `${dd(danasCG())}: prodato 4` && uIzvozu.Alergeni === "Jaja, Mlijeko" && /lot/.test(uIzvozu["Sastojci po seriji"] ?? ""),
      JSON.stringify(uIzvozu),
    );
  } finally {
    const k = await pool.connect();
    try {
      await k.query("begin");
      const serije = [...new Set([...trag.serije.filter(Boolean), ...(await k.query(`select id from serija_vitrine where naziv like $1`, [`${OZNAKA}%`])).rows.map((r) => r.id)])];
      const nc = [...new Set([...trag.nc, ...(await k.query(`select id from neusaglasenost where izvor_id = any($1)`, [[trag.povlacenje].filter(Boolean)])).rows.map((r) => r.id)])];
      const zadaci = (await k.query(`select id from zadatak where izvor_id = any($1)`, [[...nc, trag.povlacenje].filter(Boolean)])).rows.map((r) => r.id);
      const pravila = (await k.query(`select id from pravilo_kontrole where artikal_id = any($1)`, [trag.artikli.filter(Boolean)])).rows.map((r) => r.id);
      const sve = [...trag.artikli, ...trag.lotovi, ...serije, ...nc, ...zadaci, ...pravila, trag.prijem, trag.povlacenje].filter(Boolean);
      await k.query(`delete from obavjestenje where izvor_id = any($1)`, [sve]);
      await k.query(`delete from audit_log where entitet_id = any($1)`, [sve]);
      await k.query(`delete from zadatak where id = any($1)`, [zadaci]);
      await k.query(`delete from verifikacija where neusaglasenost_id = any($1)`, [nc]);
      await k.query(`delete from korektivna_mjera where neusaglasenost_id = any($1)`, [nc]);
      await k.query(`delete from neusaglasenost where id = any($1)`, [nc]);
      if (trag.povlacenje) {
        await k.query(`delete from povlacenje_kontakt where povlacenje_id = $1`, [trag.povlacenje]);
        await k.query(`delete from povlacenje where id = $1`, [trag.povlacenje]);
      }
      await k.query(`delete from serija_vitrine_promet where serija_id = any($1)`, [serije]);
      await k.query(`delete from serija_vitrine_lot where serija_id = any($1)`, [serije]);
      await k.query(`delete from serija_vitrine where id = any($1)`, [serije]);
      await k.query(`delete from kljuc_zahtjeva where kljuc = $1`, [trag.kljuc]);
      await k.query(`delete from kretanje_zalihe where lot_id = any($1)`, [trag.lotovi]);
      await k.query(`delete from zaliha where lot_id = any($1)`, [trag.lotovi]);
      await k.query(`delete from lot where id = any($1)`, [trag.lotovi]);
      if (trag.prijem) await k.query(`delete from prijem where id = $1`, [trag.prijem]);
      await k.query(`delete from pravilo_kontrole where id = any($1)`, [pravila]);
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
