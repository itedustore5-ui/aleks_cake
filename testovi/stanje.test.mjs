// „Stanje poslovanja“ (11.10.2026): konsultantov izvještaj direktoru — period (dan … godina), pokazatelji i
// semafor, primaoci, i slanje mejlom. Mejl ide na LAŽNI SMTP server ovog testa (port 54327, samo lokalno);
// pravi mejl se nikad ne šalje — ako server ima drugo SMTP podešavanje, slanje se preskače.
import net from "node:net";
import { pool, prijava, preuzmi, NALOZI, danasCG } from "./pomoc.mjs";

export const naziv = "Stanje poslovanja: periodi, pokazatelji, primaoci, slanje mejlom (lažni SMTP)";

const PORT_POSTE = 54327;

/** Najmanji SMTP server: prima EHLO, AUTH (PLAIN/LOGIN), MAIL, RCPT, DATA. `odbijRcpt` → 550 na primaoca. */
function laznaPosta() {
  const stanje = { poruke: [], prijave: [], odbijRcpt: false };
  const server = net.createServer((s) => {
    s.setEncoding("utf8");
    let bafer = "";
    let uData = false;
    let cekaPrijavu = 0;
    let tekuca = { od: null, za: [], podaci: "" };
    const pisi = (red) => s.write(`${red}\r\n`);
    s.on("error", () => undefined);
    pisi("220 lazna.posta ESMTP");
    s.on("data", (d) => {
      bafer += d;
      let i;
      while ((i = bafer.indexOf("\r\n")) >= 0) {
        const red = bafer.slice(0, i);
        bafer = bafer.slice(i + 2);
        if (uData) {
          if (red === ".") {
            uData = false;
            stanje.poruke.push(tekuca);
            tekuca = { od: null, za: [], podaci: "" };
            pisi("250 2.0.0 primljeno");
          } else tekuca.podaci += `${red.startsWith("..") ? red.slice(1) : red}\n`;
          continue;
        }
        if (cekaPrijavu > 0) {
          stanje.prijave.push(Buffer.from(red, "base64").toString("utf8"));
          cekaPrijavu -= 1;
          pisi(cekaPrijavu ? "334 UGFzc3dvcmQ6" : "235 2.7.0 prijavljen");
          continue;
        }
        const kom = red.toUpperCase();
        if (kom.startsWith("EHLO")) {
          pisi("250-lazna.posta");
          pisi("250-AUTH PLAIN LOGIN");
          pisi("250 8BITMIME");
        } else if (kom.startsWith("HELO")) pisi("250 lazna.posta");
        else if (/^AUTH PLAIN \S+/.test(kom)) {
          stanje.prijave.push(Buffer.from(red.slice(11), "base64").toString("utf8"));
          pisi("235 2.7.0 prijavljen");
        } else if (kom === "AUTH PLAIN") {
          cekaPrijavu = 1;
          pisi("334 ");
        } else if (kom.startsWith("AUTH LOGIN")) {
          cekaPrijavu = 2;
          pisi("334 VXNlcm5hbWU6");
        } else if (kom.startsWith("MAIL FROM")) {
          tekuca.od = red.slice(10);
          pisi("250 2.1.0 ok");
        } else if (kom.startsWith("RCPT TO")) {
          if (stanje.odbijRcpt) pisi("550 5.1.1 primalac ne postoji");
          else {
            tekuca.za.push(red.slice(8).replace(/[<>]/g, "").trim().toLowerCase());
            pisi("250 2.1.5 ok");
          }
        } else if (kom === "DATA") {
          uData = true;
          pisi("354 kraj sa <CRLF>.<CRLF>");
        } else if (kom === "QUIT") {
          pisi("221 2.0.0 zdravo");
          s.end();
        } else pisi("250 ok"); // RSET, NOOP
      }
    });
  });
  return {
    stanje,
    pokreni: () => new Promise((ok, ne) => server.once("error", ne).listen(PORT_POSTE, "127.0.0.1", ok)),
    ugasi: () => new Promise((ok) => server.close(() => ok())),
  };
}

const danaOd = (dan, n) => {
  const d = new Date(`${dan}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export async function pokreni({ provjeri }) {
  const konsultant = await prijava(NALOZI.konsultant);
  const ana = await prijava(NALOZI.ana);
  const direktor = await prijava(NALOZI.direktor);
  const marko = await prijava(NALOZI.marko);
  const oznaka = `E2E-STANJE-${Date.now().toString(36)}`;
  const pocetak = new Date();
  const t = { nc: [], poslati: [], primaociPrije: null };
  const danas = danasCG();
  let posta = null;

  try {
    // ── Ko smije ──────────────────────────────────────────────────────────────────────────────
    const zabrane = await Promise.all([ana, direktor, marko].map((k) => k("/stanje-poslovanja?vrsta=mjesec")));
    provjeri("Odgovorno lice, direktor i magacioner ne otvaraju izvještaj (403) — pravi ga i šalje konsultant", zabrane.every((r) => r.status === 403), zabrane.map((r) => r.status).join(","));
    const slanjeAna = await ana("/stanje-poslovanja/posalji", { telo: { vrsta: "mjesec" } });
    provjeri("Odgovorno lice ne šalje izvještaj (403)", slanjeAna.status === 403, String(slanjeAna.status));

    // ── Periodi: granice, naziv i grafikon (2025 — cijela godina je prošla) ──────────────────────
    const OCEKIVANO = {
      dan: { od: "2025-05-14", do: "2025-05-14", naziv: "srijeda, 14.05.2025.", stubova: 14 },
      sedmica: { od: "2025-05-12", do: "2025-05-18", naziv: "sedmica 12.05. – 18.05.2025.", stubova: 7 },
      mjesec: { od: "2025-05-01", do: "2025-05-31", naziv: "maj 2025.", stubova: 31 },
      kvartal: { od: "2025-04-01", do: "2025-06-30", naziv: "2. kvartal 2025.", stubova: 14 },
      polugodiste: { od: "2025-01-01", do: "2025-06-30", naziv: "1. polugodište 2025.", stubova: 6 },
      godina: { od: "2025-01-01", do: "2025-12-31", naziv: "2025. godina", stubova: 12 },
    };
    const losi = [];
    for (const [vrsta, o] of Object.entries(OCEKIVANO)) {
      const r = await konsultant(`/stanje-poslovanja?vrsta=${vrsta}&dan=2025-05-14`);
      const p = r.tijelo?.period;
      const ok =
        r.status === 200 && p.od === o.od && p.do === o.do && p.naziv === o.naziv && p.tekuci === false &&
        r.tijelo.grafikon.stubovi.length === o.stubova && p.prethodni.do === danaOd(o.od, -1) &&
        /<html/i.test(r.tijelo.html) && r.tijelo.html.includes(o.naziv) && !/<script/i.test(r.tijelo.html);
      if (!ok) losi.push(`${vrsta}: ${r.status} ${p?.od}–${p?.do} „${p?.naziv}“ ${r.tijelo?.grafikon?.stubovi?.length}`);
    }
    provjeri("Šest vrsta perioda: tačne granice, naziv, prethodni period, grafikon i HTML bez skripti", losi.length === 0, losi.join(" | "));

    const bez = await konsultant("/stanje-poslovanja?vrsta=mjesec");
    const prviOvogMjeseca = `${danas.slice(0, 7)}-01`;
    provjeri(
      "Bez izabranog dana — posljednji ZAVRŠENI period (prošli mjesec)",
      bez.status === 200 && bez.tijelo.period.do === danaOd(prviOvogMjeseca, -1) && bez.tijelo.period.tekuci === false && bez.tijelo.period.kasnije === prviOvogMjeseca,
      `${bez.tijelo?.period?.od}–${bez.tijelo?.period?.do}`,
    );
    const tekuci = await konsultant(`/stanje-poslovanja?vrsta=godina&dan=${danas}`);
    provjeri(
      "Tekući period se siječe na danas i nosi „(do danas)“; sljedećeg nema",
      tekuci.status === 200 && tekuci.tijelo.period.do === danas && tekuci.tijelo.period.tekuci === true && /\(do danas\)/.test(tekuci.tijelo.period.naziv) && tekuci.tijelo.period.kasnije === null,
      JSON.stringify(tekuci.tijelo?.period),
    );
    const buducnost = await konsultant(`/stanje-poslovanja?vrsta=godina&dan=${Number(danas.slice(0, 4)) + 1}-03-01`);
    const nepoznata = await konsultant("/stanje-poslovanja?vrsta=decenija");
    provjeri(
      "Period u budućnosti i nepoznata vrsta → 400 sa objašnjenjem",
      buducnost.status === 400 && buducnost.tijelo?.error?.code === "PERIOD_U_BUDUCNOSTI" && nepoznata.status === 400 && nepoznata.tijelo?.error?.code === "VRSTA_NEPOZNATA",
      `${buducnost.status} ${buducnost.tijelo?.error?.code} · ${nepoznata.status} ${nepoznata.tijelo?.error?.code}`,
    );

    // ── Pokazatelji prate stvarne upise: neusaglašenost VISOK danas → semafor crveno ─────────────
    const prije = (await konsultant(`/stanje-poslovanja?vrsta=dan&dan=${danas}`)).tijelo;
    const nc = await marko("/neusaglasenosti", { telo: { opis: `${oznaka} curi rashladna komora`, ozbiljnost: "VISOK" } });
    t.nc.push(nc.tijelo?.id);
    const poslije = (await konsultant(`/stanje-poslovanja?vrsta=dan&dan=${danas}`)).tijelo;
    provjeri(
      "Nova neusaglašenost VISOK: broj novih i otvorenih raste, semafor „Potrebna je vaša odluka“ sa stavkom",
      nc.status === 201 &&
        poslije.pokazatelji.nc.nove === prije.pokazatelji.nc.nove + 1 &&
        poslije.pokazatelji.nc.otvorene_visok === prije.pokazatelji.nc.otvorene_visok + 1 &&
        poslije.ocjena.nivo === "crveno" &&
        poslije.ocjena.stavke.some((s) => s.nivo === "crveno" && /visoke ozbiljnosti/.test(s.tekst)) &&
        poslije.html.includes("Potrebna je vaša odluka"),
      `${nc.status} nove ${prije.pokazatelji.nc.nove}→${poslije.pokazatelji.nc.nove} visok ${prije.pokazatelji.nc.otvorene_visok}→${poslije.pokazatelji.nc.otvorene_visok} ${poslije.ocjena.nivo}`,
    );
    const stub = poslije.grafikon.stubovi[poslije.grafikon.stubovi.length - 1];
    provjeri("Dnevni izvještaj: grafikon posljednjih 14 dana, današnji stub broji novu neusaglašenost", poslije.grafikon.stubovi.length === 14 && stub.od === danas && stub.ncNove >= 1, `${poslije.grafikon.stubovi.length} ${stub?.od} ${stub?.ncNove}`);

    // ── Kontrolni centar direktora: isti semafor, za posljednjih 7 dana ───────────────────────
    const dir = await direktor("/tabla/direktor");
    provjeri(
      "Direktorov pregled: semafor (sa novom neusaglašenošću VISOK — crveno), 7 dana, 14 dana zapisa, povlačenja u toku",
      dir.status === 200 && dir.tijelo.ocjena.nivo === "crveno" && dir.tijelo.period.do === danas && dir.tijelo.period.od === danaOd(danas, -6) &&
        dir.tijelo.grafikon.stubovi.length === 14 && Array.isArray(dir.tijelo.povlacenja) && dir.tijelo.pokazatelji.nc.otvorene_visok >= 1,
      `${dir.status} ${dir.tijelo?.ocjena?.nivo} ${dir.tijelo?.period?.od}–${dir.tijelo?.period?.do} ${dir.tijelo?.grafikon?.stubovi?.length}`,
    );

    // ── Preuzimanje (kad slanje sa servera nije podešeno) ──────────────────────────────────────
    const fajl = await preuzmi(konsultant, "/stanje-poslovanja/izvjestaj.html?vrsta=mjesec&dan=2025-05-14");
    provjeri("„Preuzmi izvještaj“: isti HTML kao fajl", fajl.status === 200 && /text\/html/.test(fajl.tip) && fajl.sadrzaj.toString("utf8").includes("maj 2025."), `${fajl.status} ${fajl.tip}`);

    // ── Primaoci ──────────────────────────────────────────────────────────────────────────────
    t.primaociPrije = (await pool.query(`select izvjestaj_primaoci from firma limit 1`)).rows[0]?.izvjestaj_primaoci ?? "";
    const los = await konsultant("/stanje-poslovanja/primaoci", { method: "PATCH", telo: { primaoci: "direktor@e2e.test, nije-mejl" } });
    const previse = await konsultant("/stanje-poslovanja/primaoci", { method: "PATCH", telo: { primaoci: Array.from({ length: 11 }, (_, i) => `d${i}@e2e.test`).join(", ") } });
    provjeri(
      "Primaoci: neispravna adresa i više od 10 → 400, ništa se ne upisuje",
      los.status === 400 && los.tijelo?.error?.code === "MEJL_NEISPRAVAN" && /nije-mejl/.test(los.tijelo?.error?.message ?? "") && previse.status === 400 && previse.tijelo?.error?.code === "PREVISE_PRIMALACA",
      `${los.status} ${los.tijelo?.error?.code} · ${previse.status} ${previse.tijelo?.error?.code}`,
    );
    const dobar = await konsultant("/stanje-poslovanja/primaoci", { method: "PATCH", telo: { primaoci: "Direktor@E2E.test; direktor@e2e.test  vlasnik@e2e.test" } });
    const audit = await pool.query(`select 1 from audit_log where entitet_tip = 'firma' and nove_vrijednosti ? 'izvjestaj_primaoci' and created_at >= $1`, [pocetak]);
    provjeri(
      "Primaoci: zarez, tačka-zarez ili razmak; mala slova; bez duplikata; izmjena u auditu",
      dobar.status === 200 && dobar.tijelo.primaoci === "direktor@e2e.test, vlasnik@e2e.test" && audit.rowCount >= 1,
      `${dobar.status} „${dobar.tijelo?.primaoci}“ audit ${audit.rowCount}`,
    );
    const anaPrimaoci = await ana("/stanje-poslovanja/primaoci", { method: "PATCH", telo: { primaoci: "ana@e2e.test" } });
    provjeri("Odgovorno lice ne mijenja primaoce (403)", anaPrimaoci.status === 403, String(anaPrimaoci.status));

    // ── Slanje ────────────────────────────────────────────────────────────────────────────────
    const pregled = (await konsultant("/stanje-poslovanja?vrsta=mjesec&dan=2025-05-14")).tijelo;
    const lazniServer = pregled.slanje.podeseno && /@pilot\.test>?$/.test(pregled.slanje.posiljalac ?? "");
    if (!pregled.slanje.podeseno) {
      const r = await konsultant("/stanje-poslovanja/posalji", { telo: { vrsta: "mjesec", dan: "2025-05-14" } });
      provjeri("Slanje bez SMTP podešavanja → 409 sa uputstvom (preuzmi i pošalji kao prilog)", r.status === 409 && r.tijelo?.error?.code === "SLANJE_NIJE_PODESENO", `${r.status} ${r.tijelo?.error?.code}`);
      provjeri("Slanje kroz lažni SMTP · preskočeno (server nema SMTP podešavanje)", true);
    } else if (!lazniServer) {
      provjeri("Slanje kroz lažni SMTP · preskočeno (server ima PRAVO SMTP podešavanje — test ne šalje pravi mejl)", true);
    } else {
      posta = laznaPosta();
      await posta.pokreni();
      const r = await konsultant("/stanje-poslovanja/posalji", { telo: { vrsta: "mjesec", dan: "2025-05-14" } });
      const poruka = posta.stanje.poruke[0];
      const tekst = (poruka?.podaci ?? "").replace(/=\n/g, "");
      provjeri(
        "Slanje: 201, mejl stigao oboma, sa prijavom na SMTP nalog, HTML i tekstualni dio",
        r.status === 201 && r.tijelo.poslato.join(",") === "direktor@e2e.test,vlasnik@e2e.test" && posta.stanje.poruke.length === 1 &&
          poruka.za.join(",") === "direktor@e2e.test,vlasnik@e2e.test" &&
          posta.stanje.prijave.some((p) => p.includes("proba@pilot.test")) &&
          /Content-Type: text\/html/i.test(tekst) && /Content-Type: text\/plain/i.test(tekst) && /^Subject: /m.test(tekst),
        `${r.status} ${JSON.stringify(r.tijelo?.error ?? r.tijelo?.poslato)} poruka ${posta.stanje.poruke.length} za ${poruka?.za}`,
      );
      const trag = await pool.query(`select id, vrsta, to_char(period_od, 'YYYY-MM-DD') as od, to_char(period_do, 'YYYY-MM-DD') as do, primaoci, poslao_korisnik_id from izvjestaj_poslat where created_at >= $1`, [pocetak]);
      t.poslati.push(...trag.rows.map((x) => x.id));
      const ist = (await konsultant("/stanje-poslovanja?vrsta=mjesec&dan=2025-05-14")).tijelo.istorija;
      provjeri(
        "Poslat izvještaj ostaje u tragu (ko, kad, period, kome) i u spisku „Poslati izvještaji“",
        trag.rowCount === 1 && trag.rows[0].vrsta === "mjesec" && trag.rows[0].od === "2025-05-01" && trag.rows[0].do === "2025-05-31" &&
          trag.rows[0].poslao_korisnik_id === NALOZI.konsultant.id && ist.some((h) => h.od === "2025-05-01" && h.vrsta === "mjesec"),
        JSON.stringify(trag.rows[0]),
      );

      // SMTP odbije primaoca → 502, a trag se NE upisuje (mejl nije otišao).
      posta.stanje.odbijRcpt = true;
      const pao = await konsultant("/stanje-poslovanja/posalji", { telo: { vrsta: "sedmica", dan: "2025-05-14" } });
      const tragPao = await pool.query(`select 1 from izvjestaj_poslat where created_at >= $1 and vrsta = 'sedmica'`, [pocetak]);
      provjeri("SMTP odbije → 502 „Mejl nije poslat“, bez traga o slanju", pao.status === 502 && pao.tijelo?.error?.code === "SLANJE_NIJE_USPJELO" && tragPao.rowCount === 0, `${pao.status} ${pao.tijelo?.error?.code} trag ${tragPao.rowCount}`);
      posta.stanje.odbijRcpt = false;

      await konsultant("/stanje-poslovanja/primaoci", { method: "PATCH", telo: { primaoci: "" } });
      const bezPrimalaca = await konsultant("/stanje-poslovanja/posalji", { telo: { vrsta: "mjesec", dan: "2025-05-14" } });
      provjeri("Bez primalaca → 400 „upišite kome se šalje“, ništa ne ide na SMTP", bezPrimalaca.status === 400 && bezPrimalaca.tijelo?.error?.code === "NEMA_PRIMALACA" && posta.stanje.poruke.length === 1, `${bezPrimalaca.status} ${bezPrimalaca.tijelo?.error?.code}`);
    }
  } finally {
    if (posta) await posta.ugasi();
    const k = await pool.connect();
    try {
      await k.query("begin");
      const ncIds = t.nc.filter(Boolean);
      if (t.primaociPrije !== null) await k.query(`update firma set izvjestaj_primaoci = $1`, [t.primaociPrije || null]);
      await k.query(`delete from obavjestenje where izvor_id = any($1) or naslov like $2 or poruka like $2`, [ncIds, `%${oznaka}%`]);
      await k.query(`delete from zadatak where izvor_id = any($1)`, [ncIds]);
      await k.query(`delete from audit_log where entitet_id = any($1)`, [[...ncIds, ...t.poslati]]);
      await k.query(`delete from audit_log where entitet_tip = 'firma' and nove_vrijednosti ? 'izvjestaj_primaoci' and created_at >= $1`, [pocetak]);
      await k.query(`delete from korektivna_mjera where neusaglasenost_id = any($1)`, [ncIds]);
      await k.query(`delete from neusaglasenost where id = any($1)`, [ncIds]);
      await k.query(`delete from izvjestaj_poslat where id = any($1)`, [t.poslati]);
      await k.query("commit");
    } catch (e) {
      await k.query("rollback");
      throw e;
    } finally {
      k.release();
    }
  }
}
