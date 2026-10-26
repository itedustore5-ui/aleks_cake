// Povlačenje (čl. 28) od početka do zatvaranja, u ateljeu: serija sastojka je sporna → spisak kupaca iz stvarno
// PREDATIH torti, torta u izradi dobija „Ne predajte tortu“, lot odmah blokiran za nove torte, ne zatvara se dok
// svi nisu obaviješteni, zadatak se zatvara sam. Pravi svoj artikal i lot (ne dira demo serije) i briše sve.
import { pool, prijava, NALOZI, danasCG, rokZaDana } from "./pomoc.mjs";

export const naziv = "Povlačenje od početka do zatvaranja (serija → torte → kupci)";

const OZNAKA = `E2E-PV-${Date.now().toString(36)}`;

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const marko = await prijava(NALOZI.marko);
  const trag = { artikal: null, prijem: null, lot: null, porudzbine: [], povlacenjeId: null, ncId: null, kontakti: [] };

  try {
    // Sastojak sa alergenom i jedna njegova serija (kao poslije prijema i odluke „prihvati“).
    const art = await ana("/artikli", { telo: { naziv: `${OZNAKA} Jaja L`, jedinicaMjere: "kom", alergeni: ["JAJA"] } });
    trag.artikal = art.tijelo?.id;
    const dobavljac = (await pool.query(`select id from dobavljac where aktivan order by naziv limit 1`)).rows[0].id;
    trag.prijem = (await pool.query(`insert into prijem (dobavljac_id, broj_dokumenta, datum_prijema, status, primio_korisnik_id) values ($1, $2, $3, 'PRIHVACEN', $4) returning id`, [dobavljac, OZNAKA, danasCG(), NALOZI.marko.id])).rows[0].id;
    trag.lot = (await pool.query(
      `insert into lot (artikal_id, dobavljac_id, prijem_id, broj_lota, rok_trajanja, status, primljena_kolicina, prihvacena_kolicina) values ($1, $2, $3, $4, $5, 'PRIHVACEN', 60, 60) returning id`,
      [trag.artikal, dobavljac, trag.prijem, `${OZNAKA}-L1`, rokZaDana(20)],
    )).rows[0].id;
    await pool.query(`insert into zaliha (lot_id, artikal_id, kolicina, status) values ($1, $2, 60, 'DOSTUPNO')`, [trag.lot, trag.artikal]);

    // Dvije torte sa tom serijom: jedna predata (kupac se zove), jedna još u izradi (ne smije se predati).
    const torta = async (kupacIme, telefon) => {
      const p = await marko("/porudzbine", { telo: { kupacIme: `${OZNAKA} ${kupacIme}`, kupacTelefon: telefon, preuzimanjeDatum: danasCG(), preuzimanjeVrijeme: "23:30", opis: "Torta sa kremom od jaja" } });
      trag.porudzbine.push(p.tijelo?.id);
      await marko(`/porudzbine/${p.tijelo.id}/lotovi`, { telo: { lotId: trag.lot } });
      return p.tijelo;
    };
    const predata = await torta("Jovana Ivanović", "067 111 222");
    const uIzradi = await torta("Kafe Ugao", "068 333 444");
    await marko(`/porudzbine/${predata.id}/alergeni`, { telo: { alergeni: ["JAJA", "GLUTEN"] } });
    await marko(`/porudzbine/${uIzradi.id}/alergeni`, { telo: { alergeni: ["JAJA"] } });
    const predaja = await marko(`/porudzbine/${predata.id}/predaja`, { telo: { preuzeoIme: "Jovana" } });
    provjeri("Torta sa serijom je predata kupcu", predaja.status === 200 && predaja.tijelo?.status === "PREDATA", JSON.stringify(predaja.tijelo));

    // Povlačenje serije
    provjeri("Zaposleni ne može pokrenuti povlačenje (403)", (await marko(`/sledljivost/lot/${trag.lot}/povlacenje`, { telo: { razlog: "E2E" } })).status === 403);
    const pv = await ana(`/sledljivost/lot/${trag.lot}/povlacenje`, { telo: { razlog: "E2E: sumnja na salmonelu" } });
    trag.povlacenjeId = pv.tijelo?.id;
    trag.ncId = pv.tijelo?.neusaglasenostId;
    provjeri("Vlasnica pokreće povlačenje — jedan kupac za poziv (predata torta)", pv.status === 201 && pv.tijelo.brojKontakata === 1, JSON.stringify(pv.tijelo));

    const d = (await ana(`/povlacenja/${trag.povlacenjeId}`)).tijelo;
    trag.kontakti = d.kontakti.map((k) => k.id);
    const nas = d.kontakti.find((k) => k.porudzbina_id === predata.id);
    provjeri("Spisak kupaca izvučen iz predatih torti, sa telefonom", nas && nas.kupac_telefon === "067 111 222" && nas.kupac_naziv.includes("Jovana Ivanović"), nas?.kupac_naziv);
    provjeri("Torta u izradi NIJE na spisku za poziv", !d.kontakti.some((k) => k.porudzbina_id === uIzradi.id));
    const neDaj = (await pool.query(`select korisnik_id, naslov from obavjestenje where izvor_tip = 'porudzbina' and izvor_id = $1`, [uIzradi.id])).rows;
    provjeri("…nego onaj ko ju je upisao dobija „Ne predajte tortu“", neDaj.some((o) => o.korisnik_id === NALOZI.marko.id && o.naslov.startsWith("Ne predajte tortu")), neDaj.map((o) => o.naslov).join(" | "));
    const zaustavljena = await marko(`/porudzbine/${uIzradi.id}/predaja`, { telo: {} });
    provjeri("Torta sa povučenom serijom se ne predaje (409)", zaustavljena.status === 409 && zaustavljena.tijelo?.error?.code === "SASTOJAK_ZADRZAN", zaustavljena.tijelo?.error?.code);

    const lotPosle = (await pool.query(`select status from lot where id = $1`, [trag.lot])).rows[0].status;
    const dostupno = (await pool.query(`select coalesce(sum(kolicina), 0) as n from zaliha where lot_id = $1 and status = 'DOSTUPNO'`, [trag.lot])).rows[0].n;
    provjeri("Lot pod povlačenjem je na HOLD-u, zaliha u karantinu", lotPosle === "HOLD" && Number(dostupno) === 0, `${lotPosle}, dostupno ${dostupno}`);
    const nova = await marko("/porudzbine", { telo: { kupacIme: `${OZNAKA} Treći`, kupacTelefon: "069 000 111", preuzimanjeDatum: danasCG(), preuzimanjeVrijeme: "23:45", opis: "Treća torta" } });
    trag.porudzbine.push(nova.tijelo?.id);
    const uTortu = await marko(`/porudzbine/${nova.tijelo.id}/lotovi`, { telo: { lotId: trag.lot } });
    provjeri("Serija pod povlačenjem više ne ide u tortu (409)", uTortu.status === 409, uTortu.tijelo?.error?.code);

    provjeri("Zadatak 'Obavijesti sve kupce' je kod vlasnice", (await ana("/zadaci?moji=1")).tijelo.some((z) => z.izvor_id === trag.povlacenjeId));
    provjeri("Vlasnica dobija obavještenje o povlačenju", (await ana("/obavjestenja")).tijelo.some((o) => o.izvor_id === trag.povlacenjeId));

    const rano = await ana(`/povlacenja/${trag.povlacenjeId}/zavrsi`, { method: "PATCH" });
    provjeri("Ne zatvara se dok svi kupci nisu obaviješteni (409)", rano.status === 409, rano.tijelo?.error?.message);
    for (const k of d.kontakti) await ana(`/povlacenja/${trag.povlacenjeId}/kontakt/${k.id}`, { method: "PATCH", telo: { napomena: "E2E pozvana" } });
    const kraj = await ana(`/povlacenja/${trag.povlacenjeId}/zavrsi`, { method: "PATCH" });
    provjeri("Kad su svi obaviješteni — povlačenje se zatvara", kraj.status === 204, `${kraj.status} ${JSON.stringify(kraj.tijelo)}`);
    const status = (await pool.query(`select status from povlacenje where id = $1`, [trag.povlacenjeId])).rows[0].status;
    provjeri("Povlačenje ima status ZAVRSENO", status === "ZAVRSENO", status);
    const zadaci = (await pool.query(`select status from zadatak where izvor_id = $1`, [trag.povlacenjeId])).rows.map((r) => r.status);
    provjeri("Zadatak povlačenja se zatvorio sam", zadaci.length > 0 && zadaci.every((st) => st === "ZAVRSEN"), zadaci.join(","));
  } finally {
    const k = await pool.connect();
    try {
      await k.query("begin");
      const porudzbine = trag.porudzbine.filter(Boolean);
      const pravila = trag.artikal ? (await k.query(`select id from pravilo_kontrole where artikal_id = $1`, [trag.artikal])).rows.map((r) => r.id) : [];
      const sve = [...porudzbine, ...pravila, trag.artikal, trag.prijem, trag.lot, trag.povlacenjeId, trag.ncId, ...trag.kontakti].filter(Boolean);
      await k.query(`delete from obavjestenje where izvor_id = any($1)`, [sve]);
      await k.query(`delete from audit_log where entitet_id = any($1)`, [sve]);
      if (trag.lot) await k.query(`delete from kretanje_zalihe where lot_id = $1`, [trag.lot]);
      if (trag.povlacenjeId) {
        await k.query(`delete from zadatak where izvor_id = $1`, [trag.povlacenjeId]);
        await k.query(`delete from povlacenje_kontakt where povlacenje_id = $1`, [trag.povlacenjeId]);
      }
      if (trag.ncId) {
        await k.query(`delete from zadatak where izvor_id = $1`, [trag.ncId]);
        await k.query(`delete from korektivna_mjera where neusaglasenost_id = $1`, [trag.ncId]);
        await k.query(`delete from neusaglasenost where id = $1`, [trag.ncId]);
      }
      if (trag.povlacenjeId) await k.query(`delete from povlacenje where id = $1`, [trag.povlacenjeId]);
      await k.query(`delete from porudzbina_lot where porudzbina_id = any($1)`, [porudzbine]);
      await k.query(`delete from porudzbina where id = any($1)`, [porudzbine]);
      if (trag.lot) {
        await k.query(`delete from zaliha where lot_id = $1`, [trag.lot]);
        await k.query(`delete from lot where id = $1`, [trag.lot]);
      }
      if (trag.prijem) await k.query(`delete from prijem where id = $1`, [trag.prijem]);
      await k.query(`delete from pravilo_kontrole where id = any($1)`, [pravila]);
      if (trag.artikal) await k.query(`delete from artikal where id = $1`, [trag.artikal]);
      await k.query("commit");
    } catch (e) {
      await k.query("rollback");
      throw new Error(`Čišćenje nije uspjelo: ${e.message} ${JSON.stringify(trag)}`);
    } finally {
      k.release();
    }
  }
}
