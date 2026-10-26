// Poruke (po grupi, pojedinačno, svima, ko je pročitao), ručni zadaci, više skladišta (prijem, matično skladište,
// deaktivacija). Atelje ima jednog demo zaposlenog — drugog otvara test (drugiZaposleni). Briše sve što napravi.
import { pool, prijava, NALOZI, danasCG, rokZaDana, drugiZaposleni, obrisiZaposlenog } from "./pomoc.mjs";

export const naziv = "Poruke, ručni zadaci, više skladišta";

export async function pokreni({ provjeri }) {
  const danas = danasCG();
  const ana = await prijava(NALOZI.ana);
  const marko = await prijava(NALOZI.marko);
  const konsultant = await prijava(NALOZI.konsultant);
  const [idAna, idMarko, idKonsultant] = [ana.id, marko.id, konsultant.id];
  const obavj = async (k) => (await k("/obavjestenja")).tijelo;

  const trag = { poruke: [], zadaci: [], prijemi: [], skladista: [], markoMaticno: null, nina: null };

  try {
    trag.nina = await drugiZaposleni(ana, "E2E Nina Poruke");
    const nina = trag.nina.k;
    const idNina = trag.nina.id;
    // ── Jedno skladište: ništa se ne bira ──
    // Demo baza može imati i skladišta unesena ručno kroz aplikaciju. Ona se ne diraju; provjere
    // koje traže da je Atelje JEDINO aktivno tada se preskaču (i to se ispiše).
    const skl0 = (await marko("/skladista")).tijelo;
    trag.markoMaticno = skl0.maticno;
    const aktivna = skl0.skladista.filter((s) => s.aktivan);
    const glavno = aktivna.find((s) => s.naziv === "Atelje") ?? aktivna[0];
    const jedino = aktivna.length === 1;
    const preskoci = (opis) => console.log(`  · preskočeno: ${opis} — u demo bazi ima ${aktivna.length} aktivnih skladišta`);
    provjeri("Postoji aktivno skladište Atelje", !!glavno, aktivna.map((s) => s.naziv).join(", "));
    if (skl0.maticno) await ana(`/nalozi/${idMarko}/skladiste`, { method: "PATCH", telo: { skladisteId: null } });
    const dob = (await ana("/dobavljaci")).tijelo[0];
    const brasno = (await ana("/artikli")).tijelo.find((a) => !a.temp_kontrolisano);
    // Rok je obavezan pri prijemu (R-17) — dodaje se svakoj stavci.
    const prijem = (tijelo) =>
      marko("/prijem", { telo: { dobavljacId: dob.id, brojDokumenta: "E2E-SKL", datumPrijema: danas, ...tijelo, stavke: tijelo.stavke.map((s) => ({ rokTrajanja: rokZaDana(3), ...s })) } });
    const p1 = await prijem({ ...(jedino ? {} : { skladisteId: glavno.id }), stavke: [{ artikalId: brasno.id, brojLota: "E2E-G1", primljenaKolicina: 4 }] });
    trag.prijemi.push(p1.tijelo?.id);
    const p1Skl = (await pool.query(`select skladiste_id from prijem where id = $1`, [p1.tijelo?.id])).rows[0]?.skladiste_id;
    if (jedino) provjeri("Prijem bez izbora ide u jedino skladište", p1.status === 201 && p1Skl === glavno.id);
    else provjeri("Prijem ide u izabrano skladište", p1.status === 201 && p1Skl === glavno.id);

    // ── Drugo skladište ──
    const novo = await ana("/skladista", { telo: { naziv: "E2E Magacin Bar", adresa: "Luka bb, Bar" } });
    trag.skladista.push(novo.tijelo?.id);
    const bar = novo.tijelo?.id;
    provjeri("Ana dodaje drugo skladište", novo.status === 201);
    provjeri("Isti naziv se odbija (409)", (await ana("/skladista", { telo: { naziv: "E2E Magacin Bar" } })).status === 409);
    provjeri("Zaposleni ne može dodati skladište (403)", (await marko("/skladista", { telo: { naziv: "E2E X" } })).status === 403);
    const p2 = await prijem({ stavke: [{ artikalId: brasno.id, brojLota: "E2E-B1", primljenaKolicina: 6 }] });
    provjeri("Sa dva skladišta, bez izbora i bez matičnog → traži izbor (400)", p2.status === 400 && p2.tijelo.error.code === "SKLADISTE_OBAVEZNO", p2.tijelo?.error?.message);
    const p3 = await prijem({ skladisteId: bar, stavke: [{ artikalId: brasno.id, brojLota: "E2E-B1", primljenaKolicina: 6 }] });
    trag.prijemi.push(p3.tijelo?.id);
    provjeri("Zaposleni prima robu u drugo skladište", p3.status === 201);
    const lotBar = (await pool.query(`select id from lot where prijem_id = $1`, [p3.tijelo.id])).rows[0].id;
    await ana(`/prijem/${p3.tijelo.id}/lot/${lotBar}/odluka`, { method: "PATCH", telo: { odluka: "PRIHVATI", kolicina: 6 } });
    const zal = (await marko("/zaliha")).tijelo.find((z) => z.lot_id === lotBar);
    provjeri("Zaliha nosi skladište lota", zal?.skladiste_id === bar && zal?.skladiste_naziv === "E2E Magacin Bar", zal?.skladiste_naziv);
    const lista = (await marko("/prijem")).tijelo.find((p) => p.id === p3.tijelo.id);
    provjeri("Lista prijema nosi naziv skladišta", lista?.skladiste_naziv === "E2E Magacin Bar");

    // ── Matično skladište ──
    provjeri("Zaposleni ne može podešavati matično skladište (403)", (await nina(`/nalozi/${idMarko}/skladiste`, { method: "PATCH", telo: { skladisteId: bar } })).status === 403);
    provjeri("Ana ne može podesiti matično konsultantu (403)", (await ana(`/nalozi/${idKonsultant}/skladiste`, { method: "PATCH", telo: { skladisteId: bar } })).status === 403);
    provjeri("Ana podešava Marku matično = Bar", (await ana(`/nalozi/${idMarko}/skladiste`, { method: "PATCH", telo: { skladisteId: bar } })).status === 204);
    provjeri("Marko vidi svoje matično u /skladista", (await marko("/skladista")).tijelo.maticno === bar);
    const p4 = await prijem({ stavke: [{ artikalId: brasno.id, brojLota: "E2E-B2", primljenaKolicina: 1 }] });
    trag.prijemi.push(p4.tijelo?.id);
    const p4Skl = (await pool.query(`select skladiste_id from prijem where id = $1`, [p4.tijelo?.id])).rows[0]?.skladiste_id;
    provjeri("Prijem bez izbora ide u matično skladište", p4.status === 201 && p4Skl === bar);
    const p5 = await prijem({ skladisteId: glavno.id, stavke: [{ artikalId: brasno.id, brojLota: "E2E-G2", primljenaKolicina: 1 }] });
    trag.prijemi.push(p5.tijelo?.id);
    provjeri("…ali po potrebi radi i u drugom skladištu", p5.status === 201);

    // ── Deaktivacija ──
    provjeri("Deaktivacija Bara prolazi dok je Atelje aktivan", (await ana(`/skladista/${bar}`, { method: "PATCH", telo: { naziv: "E2E Magacin Bar", aktivan: false } })).status === 204);
    // Samo kad je Atelje zaista posljednji — inače bi ga ovaj poziv ugasio.
    if (jedino) {
      const posljednje = await ana(`/skladista/${glavno.id}`, { method: "PATCH", telo: { naziv: glavno.naziv, aktivan: false } });
      provjeri("Posljednje aktivno skladište se ne može ugasiti (409)", posljednje.status === 409, posljednje.tijelo?.error?.message);
    } else preskoci("posljednje aktivno skladište se ne može ugasiti");
    const p6 = await prijem({ skladisteId: bar, stavke: [{ artikalId: brasno.id, brojLota: "E2E-X", primljenaKolicina: 1 }] });
    provjeri("U neaktivno skladište se ne prima (400)", p6.status === 400);
    const p7 = await prijem({ stavke: [{ artikalId: brasno.id, brojLota: "E2E-G3", primljenaKolicina: 1 }] });
    trag.prijemi.push(p7.tijelo?.id);
    const p7Skl = (await pool.query(`select skladiste_id from prijem where id = $1`, [p7.tijelo?.id])).rows[0]?.skladiste_id;
    if (jedino) provjeri("Matično neaktivno → ide u jedino aktivno", p7.status === 201 && p7Skl === glavno.id);
    else provjeri("Matično neaktivno, više aktivnih → traži izbor (400)", p7.status === 400, `${p7.status}`);

    // ── Poruke ──
    // Poruke šalju svi zaposleni jedni drugima; poruke između zaposlenih vide samo pošiljalac i primaoci.
    const odNine = await nina("/poruke", { telo: { naslov: "E2E: nestalo pavlake za krem", primaoci: { nacin: "pojedinacno", korisnici: [idMarko] } } });
    trag.poruke.push(odNine.tijelo?.id);
    provjeri("Zaposlena šalje poruku kolegi", odNine.status === 201 && odNine.tijelo.brojPrimalaca === 1);
    const markovo = (await marko("/obavjestenja")).tijelo.find((o) => o.izvor_id === odNine.tijelo.id);
    provjeri("Kolega je dobija, sa imenom pošiljaoca za „Odgovori“", markovo?.posiljalac_korisnik_id === idNina && !!markovo.posiljalac);
    const odgovorMarka = await marko("/poruke", { telo: { naslov: "Odg: E2E: nestalo pavlake za krem", primaoci: { nacin: "pojedinacno", korisnici: [idNina] } } });
    trag.poruke.push(odgovorMarka.tijelo?.id);
    provjeri("Kolega odgovara", odgovorMarka.status === 201);
    provjeri("Pošiljalac vidi svoju poslatu poruku i ko je pročitao", (await nina("/poruke")).tijelo.some((p) => p.id === odNine.tijelo.id) && (await nina(`/poruke/${odNine.tijelo.id}/primaoci`)).status === 200);
    provjeri("Poruku između zaposlenih vlasnica ne vidi na listi", !(await ana("/poruke")).tijelo.some((p) => p.id === odNine.tijelo.id));
    provjeri("…ni ko ju je pročitao (404)", (await ana(`/poruke/${odNine.tijelo.id}/primaoci`)).status === 404);
    const pr1 = await ana("/poruke", { telo: { naslov: "E2E: torte za vikend od 7h", tekst: "Od subote.", primaoci: { nacin: "uloge", uloge: ["operater"] } } });
    trag.poruke.push(pr1.tijelo?.id);
    provjeri("Vlasnica šalje poruku zaposlenima", pr1.status === 201 && pr1.tijelo.primaoci === "Zaposleni", JSON.stringify(pr1.tijelo));
    const nObavj = (await obavj(nina)).find((o) => o.izvor_id === pr1.tijelo.id);
    provjeri("Zaposlena dobija poruku sa imenom pošiljaoca", nObavj?.posiljalac === "Ana Backović" && nObavj?.poruka === "Od subote.", nObavj?.posiljalac);
    provjeri("Konsultant ne dobija poruku za zaposlene", !(await obavj(konsultant)).some((o) => o.izvor_id === pr1.tijelo.id));
    const pr2 = await konsultant("/poruke", { telo: { naslov: "E2E: svima", vazno: true, primaoci: { nacin: "svi" } } });
    trag.poruke.push(pr2.tijelo?.id);
    const primaociSvi = (await pool.query(`select korisnik_id, ozbiljnost from obavjestenje where izvor_id = $1`, [pr2.tijelo?.id])).rows;
    provjeri("Konsultant šalje svima — svi aktivni osim pošiljaoca, važno = VISOK",
      pr2.status === 201 && !primaociSvi.some((r) => r.korisnik_id === idKonsultant) && primaociSvi.some((r) => r.korisnik_id === idAna) && primaociSvi.every((r) => r.ozbiljnost === "VISOK"),
      `${primaociSvi.length} primalaca`);
    const pr3 = await ana("/poruke", { telo: { naslov: "E2E: samo Marko", primaoci: { nacin: "pojedinacno", korisnici: [idMarko] } } });
    trag.poruke.push(pr3.tijelo?.id);
    provjeri("Pojedinačna poruka ide samo izabranoj osobi", pr3.tijelo?.brojPrimalaca === 1 && (await obavj(marko)).some((o) => o.izvor_id === pr3.tijelo.id) && !(await obavj(nina)).some((o) => o.izvor_id === pr3.tijelo.id));
    provjeri("Prazna grupa se odbija (400)", (await ana("/poruke", { telo: { naslov: "E2E prazno", primaoci: { nacin: "pojedinacno", korisnici: [idAna] } } })).status === 400);
    await nina(`/obavjestenja/${nObavj.id}/procitano`, { method: "PATCH" });
    const poslata = (await ana("/poruke")).tijelo.find((p) => p.id === pr1.tijelo.id);
    provjeri("Vlasnica vidi 'pročitalo 1 od 2'", poslata?.procitalo === 1 && poslata?.broj_primalaca === 2, `${poslata?.procitalo} / ${poslata?.broj_primalaca}`);
    const citaoci = (await konsultant(`/poruke/${pr1.tijelo.id}/primaoci`)).tijelo;
    provjeri("Konsultant (vodstvo) vidi ko je pročitao poruke vlasnice", citaoci.length === 2 && citaoci.some((c) => c.procitano_at), citaoci.map((c) => c.ime).join(", "));

    // ── Ručni zadaci ──
    provjeri("Zaposleni ne pravi zadatke (403)", (await marko("/zadaci", { telo: { naslov: "E2E x" } })).status === 403);
    const z1 = await ana("/zadaci", { telo: { naslov: "E2E: očistiti vitrinu", dodijeljenoKorisnikId: idNina, prioritet: "VISOK", rok: danas } });
    trag.zadaci.push(z1.tijelo?.id);
    provjeri("Vlasnica pravi ručni zadatak zaposlenoj", z1.status === 201);
    const zNina = (await nina("/zadaci?moji=1")).tijelo.find((z) => z.id === z1.tijelo.id);
    provjeri("Zaposlena ga vidi u 'Moji zadaci'", !!zNina);
    provjeri("Kolega ne vidi tuđi zadatak", !(await marko("/zadaci")).tijelo.some((z) => z.id === z1.tijelo.id));
    const rok = (await pool.query(`select to_char(rok_at at time zone 'Europe/Podgorica', 'YYYY-MM-DD HH24:MI') as r, izvor_tip from zadatak where id = $1`, [z1.tijelo.id])).rows[0];
    provjeri("Rok je kraj dana po podgoričkom vremenu", rok.r === `${danas} 23:59` && rok.izvor_tip === "rucno", rok.r);
    provjeri("Zaposlena dobija obavještenje o zadatku", (await obavj(nina)).some((o) => o.izvor_id === z1.tijelo.id));
    provjeri("Kolega ne zatvara tuđi zadatak (403)", (await marko(`/zadaci/${z1.tijelo.id}`, { method: "PATCH", telo: { status: "ZAVRSEN" } })).status === 403);
    provjeri("Zaposlena zatvara svoj zadatak", (await nina(`/zadaci/${z1.tijelo.id}`, { method: "PATCH", telo: { status: "ZAVRSEN" } })).status === 204);
    const z2 = await ana("/zadaci", { telo: { naslov: "E2E: nedodijeljen" } });
    trag.zadaci.push(z2.tijelo?.id);
    provjeri("Nedodijeljen ručni zadatak vidi Ana", (await ana("/zadaci?moji=1")).tijelo.some((z) => z.id === z2.tijelo.id));
  } finally {
    const k = await pool.connect();
    try {
      await k.query("begin");
      const prijemi = trag.prijemi.filter(Boolean);
      const lotovi = prijemi.length ? (await k.query(`select id from lot where prijem_id = any($1)`, [prijemi])).rows.map((r) => r.id) : [];
      const sve = [...prijemi, ...lotovi, ...trag.poruke.filter(Boolean), ...trag.zadaci.filter(Boolean), ...trag.skladista.filter(Boolean), idMarko, idKonsultant];
      await k.query(`delete from obavjestenje where izvor_id = any($1)`, [sve.filter((x) => x !== idMarko && x !== idKonsultant)]);
      await k.query(`delete from audit_log where entitet_id = any($1) and created_at > now() - interval '1 hour' and (entitet_tip <> 'korisnik' or nove_vrijednosti ? 'skladisteId')`, [sve]);
      await k.query(`delete from zadatak where id = any($1)`, [trag.zadaci.filter(Boolean)]);
      await k.query(`delete from poruka where id = any($1)`, [trag.poruke.filter(Boolean)]);
      if (prijemi.length) {
        await k.query(`delete from kretanje_zalihe where lot_id = any($1)`, [lotovi]);
        await k.query(`delete from zaliha where lot_id = any($1)`, [lotovi]);
        await k.query(`delete from prijem_stavka where prijem_id = any($1)`, [prijemi]);
        await k.query(`delete from lot where prijem_id = any($1)`, [prijemi]);
        await k.query(`delete from prijem where id = any($1)`, [prijemi]);
      }
      await k.query(`update korisnik set skladiste_id = $2 where id = $1`, [idMarko, trag.markoMaticno]);
      await k.query(`update skladiste set aktivan = true where naziv = 'Atelje'`);
      await obrisiZaposlenog(k, trag.nina);
      await k.query(`delete from skladiste where id = any($1)`, [trag.skladista.filter(Boolean)]);
      await k.query("commit");
    } catch (e) {
      await k.query("rollback");
      throw new Error(`Čišćenje nije uspjelo: ${e.message} ${JSON.stringify(trag)}`);
    } finally {
      k.release();
    }
  }
}
