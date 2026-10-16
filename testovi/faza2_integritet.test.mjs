// Faza 2 — integritet, plus tri stvari koje je vlasnica prijavila:
//   B1 brojevi dokumenata se ne sudaraju kad više ljudi upisuje u isto vrijeme;
//   A2 upis u više koraka je jedna transakcija (nalog sa zauzetim imenom ne ostavlja lice bez naloga);
//   B2 baza prima samo poznate izvore (izvor_tip);
//   U1 terenske uloge ne čitaju ono što im ne treba;
//   + nalog i početna lozinka odmah pri unosu zaposlenog, "nova lozinka" za zaboravljenu;
//   + kartice Kontrolnog centra kod direktora otvaraju listu.
import { pool, prijava, NALOZI } from "./pomoc.mjs";

export const naziv = "Faza 2: brojevi, transakcije, izvori, čitanje po ulogama, nalozi";

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const marko = await prijava(NALOZI.marko);
  const petar = await prijava(NALOZI.petar);
  const direktor = await prijava(NALOZI.direktor);
  const trag = { nc: [], lica: [], korisnici: [] };

  try {
    // ── B1: pet prijava u istom trenutku ────────────────────────────────────────────────────
    const paralelno = await Promise.all(
      [1, 2, 3, 4, 5].map((i) => marko("/neusaglasenosti", { telo: { opis: `E2E-F2 paralelna prijava ${i}`, ozbiljnost: "NIZAK" } })),
    );
    paralelno.forEach((r) => trag.nc.push(r.tijelo?.id));
    const brojevi = paralelno.map((r) => r.tijelo?.broj);
    provjeri("B1: pet istovremenih prijava — sve upisane", paralelno.every((r) => r.status === 201), paralelno.map((r) => r.status).join(","));
    provjeri("B1: pet različitih brojeva, istog oblika NC-YYMMDD-NNN", new Set(brojevi).size === 5 && brojevi.every((b) => /^NC-\d{6}-\d{3}$/.test(b)), brojevi.join(" "));

    const lica = await Promise.all([1, 2, 3].map((i) => ana("/lica", { telo: { ime: `E2E F2 Radnik ${i}`, radnoMjesto: "magacioner" } })));
    lica.forEach((r) => trag.lica.push(r.tijelo?.id));
    const sifre = lica.map((r) => r.tijelo?.sifra);
    provjeri("B1: tri istovremena unosa zaposlenih — tri različite šifre", lica.every((r) => r.status === 201) && new Set(sifre).size === 3, sifre.join(" "));

    // ── Novo lice + nalog + početna lozinka u jednom koraku ─────────────────────────────────
    const ime = `e2e.f2.${Date.now() % 100000}`;
    const saNalogom = await ana("/lica", {
      telo: { ime: "E2E F2 Vozač Novi", radnoMjesto: "vozač", nalog: { korisnickoIme: ime, uloga: "vozac", lozinka: "Durmitor-2026" } },
    });
    trag.lica.push(saNalogom.tijelo?.id);
    provjeri("Ana unosi zaposlenog i odmah mu otvara nalog sa svojom početnom lozinkom", saNalogom.status === 201 && saNalogom.tijelo.nalog?.privremenaLozinka === "Durmitor-2026", `${saNalogom.status} ${saNalogom.tijelo?.error?.message ?? ""}`);
    const nalogRed = (await pool.query(`select id, lice_id, uloga, mora_promijeniti_lozinku from korisnik where korisnicko_ime = $1`, [ime])).rows[0];
    trag.korisnici.push(nalogRed?.id);
    provjeri("Nalog je vezan za to lice, uloga vozač, lozinka se mora promijeniti", nalogRed?.lice_id === saNalogom.tijelo.id && nalogRed.uloga === "vozac" && nalogRed.mora_promijeniti_lozinku === true);
    const novi = await prijava({ ime, lozinka: "Durmitor-2026", id: nalogRed.id });
    provjeri("Novi vozač se prijavljuje tom lozinkom", (await novi("/auth/ja")).tijelo?.korisnik?.mora_promijeniti_lozinku === true);

    // A2: zauzeto korisničko ime → ni lice ni nalog
    const prijeBroj = (await pool.query(`select count(*)::int as n from lice`)).rows[0].n;
    const zauzeto = await ana("/lica", { telo: { ime: "E2E F2 Duplikat", nalog: { korisnickoIme: ime, uloga: "operater" } } });
    const poslijeBroj = (await pool.query(`select count(*)::int as n from lice`)).rows[0].n;
    provjeri("A2: zauzeto korisničko ime — odbijeno (409) sa jasnom porukom", zauzeto.status === 409 && zauzeto.tijelo.error.code === "KORISNICKO_IME_ZAUZETO", zauzeto.tijelo?.error?.message);
    provjeri("A2: …i lice NIJE ostalo upisano bez naloga (transakcija)", prijeBroj === poslijeBroj, `${prijeBroj} → ${poslijeBroj}`);
    const kratka = await ana("/lica", { telo: { ime: "E2E F2 Kratka", nalog: { korisnickoIme: `${ime}.k`, uloga: "operater", lozinka: "kratka" } } });
    provjeri("Lozinka kraća od 10 znakova — odbijena (400)", kratka.status === 400 && kratka.tijelo.error.code === "LOZINKA_KRATKA");
    const bzrNalog = await ana("/lica", { telo: { ime: "E2E F2 Drugi BZR", nalog: { korisnickoIme: `${ime}.b`, uloga: "bzr" } } });
    provjeri("Odgovorno lice ne otvara nalog sebi ravnom (403, invarijanta #13)", bzrNalog.status === 403);
    provjeri("…i ni tada ne ostaje lice bez naloga", (await pool.query(`select count(*)::int as n from lice`)).rows[0].n === poslijeBroj);

    // Nova lozinka za zaboravljenu
    const reset = await ana(`/nalozi/${nalogRed.id}/lozinka`, { method: "PATCH", telo: { lozinka: "Lovcen-4411x" } });
    provjeri("Ana postavlja novu lozinku za zaboravljenu", reset.status === 200 && reset.tijelo.privremenaLozinka === "Lovcen-4411x");
    provjeri("…stara prijava tog naloga prestaje da važi (401)", (await novi("/auth/ja")).status === 401);
    const ponovo = await prijava({ ime, lozinka: "Lovcen-4411x", id: nalogRed.id });
    provjeri("…nova radi i opet traži promjenu", (await ponovo("/auth/ja")).tijelo?.korisnik?.mora_promijeniti_lozinku === true);
    const tudji = await ana(`/nalozi/${NALOZI.direktor.id}/lozinka`, { method: "PATCH", telo: {} });
    provjeri("Ana ne mijenja lozinku direktoru (403)", tudji.status === 403);
    const svoja = await ana(`/nalozi/${NALOZI.ana.id}/lozinka`, { method: "PATCH", telo: {} });
    provjeri("Svoju lozinku ne mijenja preko tuđeg ekrana (409)", svoja.status === 409);

    // ── U1: čitanje po ulogama ──────────────────────────────────────────────────────────────
    provjeri("U1: magacioner ne čita cijeli spisak zaposlenih i knjižica (403)", (await marko("/lica")).status === 403);
    const mojeLice = await marko("/lica/ja");
    provjeri("U1: …ali vidi svoje lice (šifra, knjižica)", mojeLice.status === 200 && mojeLice.tijelo?.ime === "Marko Vuković", mojeLice.tijelo?.ime);
    provjeri("U1: vozač ne čita prijeme ni obrasce (403)", (await petar("/prijem")).status === 403 && (await petar("/zapisi")).status === 403);
    provjeri("U1: terenske uloge ne čitaju Kontrolni centar (403)", (await marko("/tabla")).status === 403 && (await petar("/tabla")).status === 403);
    const petrova = await petar("/neusaglasenosti", { telo: { opis: "E2E-F2 vozač prijavljuje", ozbiljnost: "NIZAK" } });
    trag.nc.push(petrova.tijelo?.id);
    provjeri("U1: magacioner ne vidi vozačevu prijavu", !(await marko("/neusaglasenosti")).tijelo.some((n) => n.id === petrova.tijelo.id));
    provjeri("U1: …ni kad je traži po broju (404)", (await marko(`/neusaglasenosti/${petrova.tijelo.id}`)).status === 404);
    provjeri("U1: vozač vidi svoju, odgovorno lice vidi sve", (await petar("/neusaglasenosti")).tijelo.some((n) => n.id === petrova.tijelo.id) && (await ana("/neusaglasenosti")).tijelo.some((n) => n.id === petrova.tijelo.id));

    // ── Kontrolni centar kod direktora ──────────────────────────────────────────────────────
    const tabla = (await direktor("/tabla")).tijelo;
    const detalj = await direktor("/tabla/detalj/neusaglasenosti");
    provjeri("Direktor: klik na karticu daje listu", detalj.status === 200 && Array.isArray(detalj.tijelo.redovi), `${detalj.status}`);
    provjeri("Direktor: dužina liste = broj na kartici", detalj.tijelo.redovi.length === tabla.kriticno.neusaglasenostiOtvorene, `${detalj.tijelo.redovi.length} / ${tabla.kriticno.neusaglasenostiOtvorene}`);
    for (const kartica of ["temperature", "vozila", "knjizice", "prijemi", "isporuke", "zapisi"]) {
      const r = await direktor(`/tabla/detalj/${kartica}`);
      if (r.status !== 200) provjeri(`Direktor: kartica ${kartica}`, false, `${r.status}`);
    }
    provjeri("Direktor: svih šest ostalih kartica otvara listu", true);
    provjeri("Direktor čita povlačenja (Sledljivost), ali ih ne zatvara (403)", (await direktor("/povlacenja")).status === 200 && (await direktor("/povlacenja/00000000-0000-0000-0000-000000000000/zavrsi", { method: "PATCH", telo: {} })).status === 403);
    provjeri("Nepoznata kartica — 404", (await direktor("/tabla/detalj/nesto")).status === 404);

    // ── B2: baza prima samo poznate izvore ──────────────────────────────────────────────────
    const k = await pool.connect();
    try {
      await k.query("begin");
      let odbijeno = false;
      try {
        await k.query(`insert into obavjestenje (korisnik_id, naslov, izvor_tip) values ($1, 'E2E', 'neusaglasenostt')`, [NALOZI.ana.id]);
      } catch (e) {
        odbijeno = e.code === "23514";
      }
      provjeri("B2: obavještenje sa pogrešno ukucanim izvorom — baza odbija", odbijeno);
    } finally {
      await k.query("rollback");
      k.release();
    }
    const potvrdjena = (await pool.query(`select conname, convalidated from pg_constraint where conname like 'chk_%_izvor_tip' order by 1`)).rows;
    provjeri("B2: tri ograničenja postoje", potvrdjena.length === 3, potvrdjena.map((c) => `${c.conname}${c.convalidated ? "" : " (samo novi redovi)"}`).join(", "));
  } finally {
    const k = await pool.connect();
    try {
      await k.query("begin");
      const nc = trag.nc.filter(Boolean);
      const korisnici = trag.korisnici.filter(Boolean);
      const lica = trag.lica.filter(Boolean);
      const sve = [...nc, ...lica, ...korisnici];
      await k.query(`delete from obavjestenje where izvor_id = any($1) or korisnik_id = any($2)`, [sve, korisnici]);
      await k.query(`delete from zadatak where izvor_id = any($1)`, [nc]);
      await k.query(`delete from audit_log where entitet_id = any($1) or korisnik_id = any($2)`, [sve, korisnici]);
      await k.query(`delete from dogadjaj where entitet_id = any($1) or korisnik_id = any($2)`, [sve, korisnici]);
      await k.query(`delete from korektivna_mjera where neusaglasenost_id = any($1)`, [nc]);
      await k.query(`delete from neusaglasenost where id = any($1)`, [nc]);
      await k.query(`delete from sesija_prijave where korisnik_id = any($1)`, [korisnici]);
      await k.query(`delete from korisnik where id = any($1)`, [korisnici]);
      await k.query(`delete from lice where id = any($1)`, [lica]);
      await k.query("commit");
    } catch (e) {
      await k.query("rollback");
      throw new Error(`Čišćenje nije uspjelo: ${e.message} ${JSON.stringify(trag)}`);
    } finally {
      k.release();
    }
  }
}
