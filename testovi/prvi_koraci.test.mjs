// „Prvi koraci“ (29.10.2026): vlasnica sama podešava atelje, bez upitnika i konsultantovog uvoza.
//   • spisak koraka dolazi iz baze (ne kvačicom), zaposleni ga ne vidi;
//   • frižider, vitrina, zamrzivač bez šifara: server bira šifru KKT2…, granica postaje pravilo (verzije), tekst za HACCP
//     plan i dnevno mjerenje u planu idu sami; ime i granica se mijenjaju, uređaj se isključuje i vraća;
//   • podaci ateljea: vlasnica ih upisuje, prazno polje je „fali“, ime odgovornog lica se više ne briše pri čuvanju.
// Pravi svoj uređaj, vraća podatke firme i briše sve što je napravio.
import { pool, prijava, NALOZI, drugiZaposleni, obrisiZaposlenog } from "./pomoc.mjs";

export const naziv = "Prvi koraci: spisak iz baze, uređaji bez šifara (granica, plan, tekst), podaci ateljea — vlasnica sama";

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const marko = await prijava(NALOZI.marko);
  const oznaka = `E2E-PK-${Date.now().toString(36)}`;
  const pocetak = new Date();
  const trag = { tacke: [], firma: (await pool.query(`select id, naziv, pib, adresa, grad, telefon, email, odgovorno_lice_ime from firma limit 1`)).rows[0] };
  const broj = async (sql, p = []) => (await pool.query(sql, p)).rows[0].n;

  try {
    // ── Ko smije ──────────────────────────────────────────────────────────────────────────────
    const z1 = await marko("/prvi-koraci");
    const z2 = await marko("/uredjaji-cuvanja", { telo: { naziv: `${oznaka} zabrana`, vrsta: "frizider", min: 0, max: 4 } });
    provjeri("Zaposleni ne vidi prve korake i ne dodaje uređaje (403)", z1.status === 403 && z2.status === 403, `${z1.status} ${z2.status}`);

    // ── Spisak koraka ─────────────────────────────────────────────────────────────────────────
    const pk = await ana("/prvi-koraci");
    const koraci = pk.tijelo?.koraci ?? [];
    const po = Object.fromEntries(koraci.map((k) => [k.kod, k]));
    const obavezniUradjeni = koraci.filter((k) => k.gotovo === true && !k.opciono).length;
    provjeri(
      "Spisak: deset koraka redom; rješenje bez provjere iz baze, stalni kupci nisu obavezni; „urađeno“ broji samo obavezne",
      pk.status === 200 && koraci.map((k) => k.kod).join() === "firma,plan,uredjaji,termometar,zaposleni,dobavljaci,sastojci,kupci,rjesenje,telefon" &&
        po.rjesenje.gotovo === null && po.kupci.opciono === true && pk.tijelo.ukupno === 8 && pk.tijelo.uradjeno === obavezniUradjeni &&
        koraci.every((k) => k.naslov && k.opis && k.stanje),
      `${pk.status} ${koraci.map((k) => `${k.kod}:${k.gotovo}`).join(" ")} · ${pk.tijelo?.uradjeno}/${pk.tijelo?.ukupno}`,
    );

    // ── Uređaji iz demoa ──────────────────────────────────────────────────────────────────────
    const lista = (await ana("/uredjaji-cuvanja")).tijelo ?? [];
    const sifra = (s) => lista.find((u) => u.sifra === s);
    provjeri(
      "Uređaji: frižider, vitrina i zamrzivač — svaki sa svojom vrstom i granicom (bez šifara u ekranu, server ih zna)",
      sifra("KKT2")?.vrsta === "frizider" && sifra("KKT2-V")?.vrsta === "vitrina" && sifra("KKT2-Z")?.vrsta === "zamrzivac" &&
        sifra("KKT2-Z").min === -25 && sifra("KKT2-Z").max === -18 && sifra("KKT2").max === 4,
      JSON.stringify(lista.map((u) => [u.sifra, u.vrsta, u.min, u.max])),
    );

    // ── Plan (korak 2) — demo ga nema; test ga pravi kao vlasnica i na kraju briše ────────────
    if (!(await broj(`select count(*)::int as n from plan_monitoringa where aktivan`))) {
      const plan = await ana("/plan-monitoringa/osnovni", { method: "POST", telo: {} });
      const korak = (await ana("/prvi-koraci")).tijelo?.koraci?.find((k) => k.kod === "plan");
      provjeri("Korak „Plan“: jedan klik pravi plan i korak se sam označi kao urađen", plan.status === 201 && korak?.gotovo === true, `${plan.status} ${JSON.stringify(korak)}`);
    }

    // ── Nov frižider ──────────────────────────────────────────────────────────────────────────
    const imaPlan = (await broj(`select count(*)::int as n from plan_monitoringa where aktivan`)) > 0;
    const nov = await ana("/uredjaji-cuvanja", { telo: { naziv: `${oznaka} Frižider za torte`, vrsta: "frizider", min: 1, max: 5 } });
    trag.tacke.push(nov.tijelo?.id);
    const tacka = (await pool.query(`select sifra, naziv, opasnost, korektivna_mjera, aktivan from kontrolna_tacka where id = $1`, [nov.tijelo?.id])).rows[0];
    const pravilo = (await pool.query(`select min_vrijednost::float as min, max_vrijednost::float as max, verzija from pravilo_kontrole where kontrolna_tacka_id = $1 and artikal_id is null and aktivan`, [nov.tijelo?.id])).rows;
    const uPlanu = await broj(`select count(*)::int as n from plan_monitoringa where kontrolna_tacka_id = $1 and aktivan and ucestalost = 'DNEVNO' and puta = 2`, [nov.tijelo?.id]);
    provjeri(
      "Nov frižider bez šifre: server bira KKT2-F…, granica 1–5 je pravilo, tekst za HACCP plan upisan, mjerenje 2× dnevno u planu (kad plan postoji)",
      nov.status === 201 && /^KKT2-F\d+$/.test(tacka?.sifra ?? "") && pravilo.length === 1 && pravilo[0].min === 1 && pravilo[0].max === 5 &&
        /frižider/i.test(tacka.opasnost ?? "") && !!tacka.korektivna_mjera && uPlanu === (imaPlan ? 1 : 0) && nov.tijelo.uPlanu === imaPlan,
      `${nov.status} ${JSON.stringify(nov.tijelo)} ${JSON.stringify(tacka)} ${JSON.stringify(pravilo)} plan ${uPlanu} (ima plan: ${imaPlan})`,
    );
    const dupli = await ana("/uredjaji-cuvanja", { telo: { naziv: `${oznaka} frižider ZA torte`, vrsta: "frizider", min: 0, max: 4 } });
    const obrnuto = await ana("/uredjaji-cuvanja", { telo: { naziv: `${oznaka} Obrnuto`, vrsta: "zamrzivac", min: -18, max: -25 } });
    const tackaKkt1 = (await pool.query(`select id from kontrolna_tacka where sifra = 'KKT1'`)).rows[0]?.id;
    const nijeUredjaj = await ana(`/uredjaji-cuvanja/${tackaKkt1}`, { method: "PATCH", telo: { naziv: "Prijem" } });
    provjeri(
      "Isto ime dvaput → 409 sa predlogom drugog imena; granica „od“ iznad „do“ → 400; prijem (KKT 1) nije uređaj → 404",
      dupli.status === 409 && dupli.tijelo?.error?.code === "UREDJAJ_POSTOJI" && obrnuto.status === 400 && nijeUredjaj.status === 404,
      `${dupli.status} ${dupli.tijelo?.error?.code} · ${obrnuto.status} · ${nijeUredjaj.status}`,
    );

    // ── Izmjena: ime i granica ────────────────────────────────────────────────────────────────
    const izm = await ana(`/uredjaji-cuvanja/${nov.tijelo?.id}`, { method: "PATCH", telo: { naziv: `${oznaka} Torte`, min: 2, max: 6 } });
    const verzije = (await pool.query(
      `select verzija, aktivan, vazi_do is not null as zatvorena, min_vrijednost::float as min, max_vrijednost::float as max from pravilo_kontrole where kontrolna_tacka_id = $1 and artikal_id is null order by verzija`,
      [nov.tijelo?.id],
    )).rows;
    const nazivPlana = (await pool.query(`select naziv from plan_monitoringa where kontrolna_tacka_id = $1 and aktivan`, [nov.tijelo?.id])).rows[0]?.naziv;
    provjeri(
      "Nova granica = nova verzija pravila (stara zatvorena, ostaje); novo ime ide i u stavku plana koju zaposleni vidi",
      izm.status === 204 && verzije.length === 2 && verzije[0].aktivan === false && verzije[0].zatvorena && verzije[1].aktivan && verzije[1].min === 2 && verzije[1].max === 6 &&
        (!imaPlan || nazivPlana === `Temperatura — ${oznaka} Torte (${tacka.sifra})`),
      `${izm.status} ${JSON.stringify(verzije)} „${nazivPlana}“`,
    );

    // ── Isključi i vrati ──────────────────────────────────────────────────────────────────────
    const isk = await ana(`/uredjaji-cuvanja/${nov.tijelo?.id}`, { method: "PATCH", telo: { aktivan: false } });
    const poslijeIsk = (await pool.query(`select aktivan from kontrolna_tacka where id = $1`, [nov.tijelo?.id])).rows[0];
    const planIsk = await broj(`select count(*)::int as n from plan_monitoringa where kontrolna_tacka_id = $1 and aktivan`, [nov.tijelo?.id]);
    const vrati = await ana(`/uredjaji-cuvanja/${nov.tijelo?.id}`, { method: "PATCH", telo: { aktivan: true } });
    const planVrati = await broj(`select count(*)::int as n from plan_monitoringa where kontrolna_tacka_id = $1 and aktivan`, [nov.tijelo?.id]);
    provjeri(
      "„Nemamo ga“: uređaj i njegovo mjerenje u planu se isključe (ne briše se ništa); „Vrati“ ga vraća u plan",
      isk.status === 204 && poslijeIsk.aktivan === false && planIsk === 0 && vrati.status === 204 && planVrati === (imaPlan ? 1 : 0),
      `${isk.status} ${JSON.stringify(poslijeIsk)} plan ${planIsk} → ${vrati.status} plan ${planVrati}`,
    );
    const predlog = await ana(`/kontrolne-tacke/predlog-teksta?sifra=KKT2-Z5`);
    provjeri("„Predloži tekst“ dolazi sa servera — drugi zamrzivač dobija tekst zamrzivača", predlog.status === 200 && /zamrz/i.test(predlog.tijelo?.korektivnaMjera ?? ""), JSON.stringify(predlog.tijelo).slice(0, 120));

    // ── Vlasnica otvorena kao „Zaposleni“ → konsultant joj mijenja ulogu (Aleks Cake, 29.10.2026) ──
    const konsultant = await prijava(NALOZI.konsultant);
    trag.zaposleni = await drugiZaposleni(ana, `${oznaka} Vlasnica greškom zaposlena`);
    const anaPokusaj = await ana(`/nalozi/${trag.zaposleni.id}/uloga`, { method: "PATCH", telo: { uloga: "bzr" } });
    const promjena = await konsultant(`/nalozi/${trag.zaposleni.id}/uloga`, { method: "PATCH", telo: { uloga: "bzr" } });
    const novaUloga = (await pool.query(`select uloga::text as uloga from korisnik where id = $1`, [trag.zaposleni.id])).rows[0]?.uloga;
    const staraSesija = await trag.zaposleni.k("/lica/ja");
    provjeri(
      "Konsultant mijenja ulogu „Zaposleni“ → „Vlasnica“ (vlasnica ne može sebi ravnog, #13); stara prijava tog naloga prestaje (#27)",
      anaPokusaj.status === 403 && promjena.status < 300 && novaUloga === "bzr" && staraSesija.status === 401,
      `${anaPokusaj.status} ${promjena.status} ${novaUloga} sesija ${staraSesija.status}`,
    );

    // ── Podaci ateljea ────────────────────────────────────────────────────────────────────────
    const f = await ana("/firma", { method: "PATCH", telo: { naziv: trag.firma.naziv, pib: "", adresa: `${oznaka} Obala bb`, grad: "Bar", telefon: "", email: "", odgovornoLiceIme: "Ana Backović" } });
    const firmaPoslije = (await pool.query(`select pib, adresa, odgovorno_lice_ime from firma limit 1`)).rows[0];
    const korakFirma = (await ana("/prvi-koraci")).tijelo?.koraci?.find((k) => k.kod === "firma");
    provjeri(
      "Vlasnica upisuje podatke ateljea; prazan PIB je „fali“ (ne prazan tekst), ime odgovornog lica se čuva (ranija forma ga je brisala)",
      f.status === 204 && firmaPoslije.pib === null && firmaPoslije.adresa === `${oznaka} Obala bb` && firmaPoslije.odgovorno_lice_ime === "Ana Backović" &&
        korakFirma?.gotovo === false && /PIB/.test(korakFirma?.stanje ?? ""),
      `${f.status} ${JSON.stringify(firmaPoslije)} ${JSON.stringify(korakFirma)}`,
    );
  } finally {
    const k = await pool.connect();
    try {
      await k.query("begin");
      const tacke = trag.tacke.filter(Boolean);
      if (tacke.length) {
        const pravila = (await k.query(`select id from pravilo_kontrole where kontrolna_tacka_id = any($1)`, [tacke])).rows.map((r) => r.id);
        const plan = (await k.query(`select id from plan_monitoringa where kontrolna_tacka_id = any($1)`, [tacke])).rows.map((r) => r.id);
        await k.query(`delete from audit_log where entitet_id = any($1)`, [[...tacke, ...pravila, ...plan]]);
        await k.query(`delete from plan_monitoringa where id = any($1)`, [plan]);
        await k.query(`delete from pravilo_kontrole where id = any($1)`, [pravila]);
        await k.query(`delete from kontrolna_tacka where id = any($1)`, [tacke]);
      }
      await obrisiZaposlenog(k, trag.zaposleni);
      // Plan koji je test napravio (osnovni plan i stavke uređaja) — demo ostaje bez plana, kao i prije.
      const planovi = (await k.query(`select id from plan_monitoringa where created_by = $1 and created_at >= $2`, [NALOZI.ana.id, pocetak])).rows.map((r) => r.id);
      await k.query(`delete from audit_log where entitet_id = any($1)`, [planovi]);
      await k.query(`delete from plan_monitoringa where id = any($1)`, [planovi]);
      if (trag.firma) {
        const s = trag.firma;
        await k.query(`update firma set pib = $2, adresa = $3, grad = $4, telefon = $5, email = $6, odgovorno_lice_ime = $7 where id = $1`, [s.id, s.pib, s.adresa, s.grad, s.telefon, s.email, s.odgovorno_lice_ime]);
        await k.query(`delete from audit_log where entitet_tip = 'firma' and entitet_id = $1 and created_at >= $2`, [s.id, pocetak]);
      }
      await k.query("commit");
    } catch (e) {
      await k.query("rollback");
      throw e;
    } finally {
      k.release();
    }
  }
}
