// Provjera znanja do Priloga 14: radi je PRIJAVLJENI zaposleni, SVOJOM šifrom (invarijanta #32) —
// tuđa šifra se ne može upisati, tuđa provjera se ne može odgovarati ni završiti; rezultat se ne
// može naduvati; evidencija osposobljavanja. Briše sve što napravi.
import { pool, prijava, anonimno, NALOZI } from "./pomoc.mjs";

export const naziv = "Provjera znanja do Priloga 14";

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const marko = await prijava(NALOZI.marko);
  const petar = await prijava(NALOZI.petar);
  const direktor = await prijava(NALOZI.direktor);
  const anon = anonimno();
  const trag = { sesijaId: null };
  const pocetak = new Date();

  try {
    const sesija = await ana("/provjera-znanja/sesije", { telo: { naziv: "E2E provjera", brojPitanja: 3, cuvaImena: true } });
    trag.sesijaId = sesija.tijelo?.id;
    provjeri("Ana otvara provjeru znanja (3 pitanja)", sesija.status === 201);

    const lica = (await ana("/lica")).tijelo;
    const lice = lica.find((l) => l.sifra && l.aktivan !== false && /Marko/.test(l.ime));
    const petrovo = lica.find((l) => l.sifra && l.aktivan !== false && /Petar/.test(l.ime));
    if (!lice) throw new Error("U demo bazi nema Markove šifre na spisku zaposlenih.");

    // Ulaz se nudi na početnoj strani prijavljenog (ne na strani za prijavu).
    const mojPrije = (await marko("/provjera-znanja/moj-termin")).tijelo;
    provjeri("Magacioner na svojoj strani vidi otvoren termin (bez šifre — ne treba mu)", mojPrije?.otvoren === true && mojPrije.naziv === "E2E provjera" && mojPrije.vezan === true && !("sifra" in mojPrije) && mojPrije.zavrseno === false, JSON.stringify(mojPrije));

    // Direktor (Đorđe Perović) ne rukuje hranom — provjera mu se ne nudi i ne prima (#20).
    const dirTermin = (await direktor("/provjera-znanja/moj-termin")).tijelo;
    const dirUlaz = await direktor("/provjera-znanja/uci", { telo: { lozinka: NALOZI.direktor.lozinka } });
    provjeri(
      "Ko ne rukuje hranom (direktor): bez kartice na početnoj strani, ulaz odbijen (403 PROVJERA_NIJE_ZA_VAS)",
      dirTermin?.otvoren === false && dirUlaz.status === 403 && dirUlaz.tijelo?.error?.code === "PROVJERA_NIJE_ZA_VAS",
      `${JSON.stringify(dirTermin)} ${dirUlaz.status} ${dirUlaz.tijelo?.error?.code}`,
    );

    provjeri("Bez prijave se ne ulazi, ni sa tačnom šifrom (401)", (await anon("/provjera-znanja/uci", { telo: { sifra: lice.sifra } })).status === 401);

    // Na Markovom nalogu provjeru ne može početi neko drugi: traži se Markova lozinka.
    const bezLozinke = await marko("/provjera-znanja/uci", { telo: {} });
    provjeri("Bez lozinke se ne počinje (400)", bezLozinke.status === 400);
    const pogresna = await marko("/provjera-znanja/uci", { telo: { lozinka: "neka-pogresna-lozinka" } });
    provjeri("Pogrešna lozinka se odbija (403)", pogresna.status === 403 && pogresna.tijelo.error.code === "POGRESNA_LOZINKA");
    const tudjaLozinka = await marko("/provjera-znanja/uci", { telo: { lozinka: NALOZI.petar.lozinka } });
    provjeri("Ni lozinka drugog zaposlenog ne pušta na Markovom nalogu (403)", tudjaLozinka.status === 403);
    // Tuđa šifra u zahtjevu se ne gleda — zaposleni je onaj čiji je nalog.
    const ulaz = await marko("/provjera-znanja/uci", { telo: { lozinka: NALOZI.marko.lozinka, sifra: petrovo?.sifra ?? "M-99" } });
    const ciji = ulaz.status === 200 ? (await pool.query(`select lice_id from ucesnik_znanja where id = $1`, [ulaz.tijelo.ucesnikId])).rows[0]?.lice_id : null;
    provjeri("Ulazi prijavljeni, kao on sam (tuđa šifra iz zahtjeva se ne gleda; šifra se ne vraća)", ulaz.status === 200 && ciji === lice.id && !("sifra" in ulaz.tijelo) && ulaz.tijelo.pitanja.length === 3, `${ulaz.status} ${ulaz.tijelo?.error?.message ?? ""}`);
    if (ulaz.status !== 200) return;
    provjeri("Pitanja ne otkrivaju tačan odgovor", ulaz.tijelo.pitanja.every((p) => !("tacan_indeks" in p)));
    const { ucesnikId, pitanja } = ulaz.tijelo;

    const tacni = Object.fromEntries(
      (await pool.query(`select id, tacan_indeks from pitanje where id = any($1)`, [pitanja.map((p) => p.id)])).rows.map((r) => [r.id, r.tacan_indeks]),
    );
    const odgovor = (p, tacno) => ({ ucesnikId, pitanjeId: p.id, datIndeks: tacno ? tacni[p.id] : (tacni[p.id] + 1) % p.ponudjeni_odgovori.length });
    const tudji = await petar("/provjera-znanja/odgovor", { telo: odgovor(pitanja[0], true) });
    provjeri("Drugi zaposleni ne može odgovarati na tuđu provjeru (403)", tudji.status === 403 && tudji.tijelo.error.code === "TUDJA_PROVJERA", `${tudji.status}`);

    await marko("/provjera-znanja/odgovor", { telo: odgovor(pitanja[0], true) });
    const dupli = await marko("/provjera-znanja/odgovor", { telo: odgovor(pitanja[0], true) });
    provjeri("Drugi odgovor na isto pitanje se odbija (409) — rezultat se ne može naduvati", dupli.status === 409 && dupli.tijelo.error.code === "VEC_ODGOVORENO", `${dupli.status}`);
    await marko("/provjera-znanja/odgovor", { telo: odgovor(pitanja[1], false) });
    await marko("/provjera-znanja/odgovor", { telo: odgovor(pitanja[2], true) });

    provjeri("Drugi zaposleni ne može završiti tuđu provjeru (403)", (await petar("/provjera-znanja/zavrsi", { telo: { ucesnikId } })).status === 403);
    const kraj = await marko("/provjera-znanja/zavrsi", { telo: { ucesnikId } });
    provjeri("Rezultat: 2 od 3", kraj.status === 200 && kraj.tijelo.brojTacnih === 2 && kraj.tijelo.brojPitanja === 3, JSON.stringify(kraj.tijelo));
    const poslije = await marko("/provjera-znanja/odgovor", { telo: odgovor(pitanja[1], true) });
    provjeri("Poslije završetka se ne odgovara (409)", poslije.status === 409 && poslije.tijelo.error.code === "VEC_ZAVRSENO");
    const mojPoslije = (await marko("/provjera-znanja/moj-termin")).tijelo;
    provjeri("…a na svojoj strani piše da je završio", mojPoslije?.zavrseno === true, JSON.stringify(mojPoslije));
    const opet = await marko("/provjera-znanja/zavrsi", { telo: { ucesnikId } });
    provjeri("Ponovljeno 'završi' vraća isti rezultat", opet.tijelo?.brojTacnih === 2 && opet.tijelo?.brojPitanja === 3);
    provjeri("Ponovni ulazak se odbija (409)", (await marko("/provjera-znanja/uci", { telo: { lozinka: NALOZI.marko.lozinka } })).tijelo?.error?.code === "VEC_ZAVRSENO");

    const ev = (await ana("/evidencija-osposobljavanja")).tijelo.find((e) => e.lice_id === lice.id);
    provjeri("Evidencija (Prilog 14) nosi rezultat i naziv provjere", ev && ev.posljednji_broj_tacnih === 2 && ev.posljednji_broj_pitanja === 3 && ev.posljednja_sesija === "E2E provjera", JSON.stringify(ev));

    provjeri("Ana zatvara provjeru", (await ana(`/provjera-znanja/sesije/${trag.sesijaId}/zatvori`, { method: "PATCH" })).status === 204);
    const otvoren = (await pool.query(`select otvoren from sesija_znanja where id = $1`, [trag.sesijaId])).rows[0].otvoren;
    provjeri("Provjera je zatvorena", otvoren === false);
  } finally {
    // Sigurnosni događaji pogrešnih lozinki iz ovog testa.
    await pool.query(`delete from audit_log where akcija = 'SIGURNOST' and entitet_id = $1 and created_at >= $2`, [NALOZI.marko.id, pocetak]);
    if (trag.sesijaId) {
      await pool.query(`delete from odgovor_znanja where ucesnik_id in (select id from ucesnik_znanja where sesija_id = $1)`, [trag.sesijaId]);
      await pool.query(`delete from ucesnik_znanja where sesija_id = $1`, [trag.sesijaId]);
      await pool.query(`delete from sesija_znanja where id = $1`, [trag.sesijaId]);
    }
  }
}
