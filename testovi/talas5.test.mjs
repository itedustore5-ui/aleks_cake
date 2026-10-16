// Talas 5 (29.09.2026): slikovna bomba, izvoz bez Excel formula i sa podgoričkim vremenom, jače i
// neblokirajuće lozinke, dopune baze koje zdravlje prijavljuje, dnevnik grešaka, potvrda u dva koraka.
import crypto from "node:crypto";
import zlib from "node:zlib";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pool, prijava, anonimno, NALOZI, APP_URL, posaljiFajl, preuzmi } from "./pomoc.mjs";

export const naziv = "Talas 5: slika, izvoz, lozinke, dopune baze, dnevnik grešaka, potvrda u dva koraka";

const BAZA = `${APP_URL}/api`;
const korijen = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── TOTP kao aplikacija na telefonu (RFC 6238) ──
function izBase32(t) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bitovi = 0, v = 0;
  const b = [];
  for (const z of t.replace(/\s/g, "")) {
    v = (v << 5) | A.indexOf(z);
    bitovi += 5;
    if (bitovi >= 8) { b.push((v >>> (bitovi - 8)) & 255); bitovi -= 8; }
  }
  return Buffer.from(b);
}
function totp(tajna, korak) {
  const c = Buffer.alloc(8);
  c.writeBigUInt64BE(BigInt(korak));
  const h = crypto.createHmac("sha1", izBase32(tajna)).update(c).digest();
  const o = h[h.length - 1] & 15;
  return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
}
const korakSada = () => Math.floor(Date.now() / 30000);

/** PNG od par stotina bajtova čije zaglavlje kaže 8000 × 7000 (56 MP) — raspakovan bi bio stotine MB. */
function slikovnaBomba(sirina, visina) {
  const komad = (tip, podaci) => {
    const d = Buffer.alloc(4); d.writeUInt32BE(podaci.length);
    const t = Buffer.from(tip, "latin1");
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, podaci])));
    return Buffer.concat([d, t, podaci, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(sirina, 0); ihdr.writeUInt32BE(visina, 4); ihdr[8] = 8; // 8 bita, siva
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), komad("IHDR", ihdr), komad("IDAT", zlib.deflateSync(Buffer.alloc(200))), komad("IEND", Buffer.alloc(0))]);
}

/** Sirova prijava (bez pomoc.prijava — ona očekuje sesiju odmah, a 2FA je daje tek posle koda). */
async function surovo(baza, putanja, telo, kolacic) {
  const r = await fetch(`${baza}${putanja}`, {
    method: telo === undefined ? "GET" : "POST",
    headers: { "x-zahtjev-app": "1", "Content-Type": "application/json", ...(kolacic ? { cookie: kolacic } : {}) },
    body: telo === undefined ? undefined : JSON.stringify(telo),
  });
  const tekst = await r.text();
  let tijelo = null;
  try { tijelo = tekst ? JSON.parse(tekst) : null; } catch { tijelo = tekst; }
  return { status: r.status, tijelo, kolacic: r.headers.get("set-cookie")?.split(";")[0] ?? null };
}

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const konsultant = await prijava(NALOZI.konsultant);
  const oznaka = `E2E T5 ${Date.now()}`;
  const trag = { lica: [], korisnici: [], bekap: null, migracijaVracena: true };
  let drugiServer = null;

  try {
    // ── Slikovna bomba ──
    const dokPrije = (await pool.query(`select count(*)::int as n from prijem_dokument`)).rows[0].n;
    const bomba = await posaljiFajl(ana, "/prijem/otpremnica", slikovnaBomba(8000, 7000), "image/png", "bomba.png");
    provjeri("Slika od 56 MP (mali fajl, ogromne dimenzije) se odbija prije obrade — 400", bomba.status === 400 && bomba.tijelo?.error?.code === "SLIKA_PREVELIKA", `${bomba.status} ${bomba.tijelo?.error?.code ?? ""}`);
    const dokPoslije = (await pool.query(`select count(*)::int as n from prijem_dokument`)).rows[0].n;
    provjeri("…i ništa se ne čuva ni ne čita", dokPoslije === dokPrije, `${dokPrije} → ${dokPoslije}`);

    // ── Izvoz: Excel formula i vrijeme po Podgorici ──
    const lice = await ana("/lica", { telo: { ime: `=HYPERLINK("http://x") ${oznaka}`, radnoMjesto: "-18,5" } });
    trag.lica.push(lice.tijelo?.id);
    const csv = (await preuzmi(konsultant, "/izvoz/lica.csv")).sadrzaj.toString("utf8");
    const red = csv.split("\n").find((r) => r.includes(oznaka)) ?? "";
    provjeri("Izvoz: tekst koji počinje sa = dobija apostrof — Excel ga ne izvršava kao formulu", red.includes(`'=HYPERLINK(""http://x"") ${oznaka}`), red.slice(0, 160));
    provjeri("…a broj ostaje broj (−18,5 bez apostrofa)", /;"-18,5"(;|$)/.test(red) && !red.includes("'-18,5"), red.slice(0, 160));
    const podgorica = (d) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Podgorica", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).format(d);
    const ocekivano = [podgorica(new Date()), podgorica(new Date(Date.now() - 120_000))];
    provjeri(
      "Izvoz: vrijeme upisa po Podgorici („2026-09-29 14:05:09“), ne UTC sa „T…Z“",
      !/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/.test(red) && ocekivano.some((p) => red.includes(p)),
      `${red.match(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}\S*/)?.[0] ?? "(nema vremena)"} · očekivano ${ocekivano[0]}`,
    );

    // ── Dopune baze: zdravlje kaže koja nije primijenjena ──
    const anon = anonimno();
    provjeri("Zdravlje: sve dopune primijenjene — 200", (await anon("/zdravlje")).status === 200);
    trag.migracijaVracena = false;
    await pool.query(`delete from schema_migracije where fajl = '33_talas5_cg.sql'`);
    const bezDopune = await anon("/zdravlje");
    await pool.query(`insert into schema_migracije (fajl) values ('33_talas5_cg.sql') on conflict do nothing`);
    trag.migracijaVracena = true;
    provjeri("Zdravlje: dopuna nije primijenjena → 503 i koja", bezDopune.status === 503 && String(bezDopune.tijelo?.baza).includes("33_talas5_cg.sql"), `${bezDopune.status} ${bezDopune.tijelo?.baza}`);

    // ── Dnevnik grešaka ──
    const marko = await prijava(NALOZI.marko);
    const javljeno = await marko("/greske/pregledac", { telo: { poruka: `Pad ekrana ${oznaka}`, stek: "Error: probni pad\n    at Moja (Moja.tsx:1:1)", putanja: "/moja" } });
    provjeri("Pregledač javlja pad ekrana — 204", javljeno.status === 204, String(javljeno.status));
    const upis = (await pool.query(`select izvor, korisnik_id, putanja from greska_log where poruka = $1`, [`Pad ekrana ${oznaka}`])).rows[0];
    provjeri("…upisano u dnevnik grešaka, sa korisnikom i stranom", upis?.izvor === "pregledac" && upis.korisnik_id === NALOZI.marko.id && upis.putanja === "/moja", JSON.stringify(upis));
    const spisak = await konsultant("/greske?sati=1");
    provjeri("Konsultant čita dnevnik grešaka", spisak.status === 200 && spisak.tijelo.some((g) => g.poruka === `Pad ekrana ${oznaka}`));
    provjeri("Odgovorno lice ne čita dnevnik grešaka (403)", (await ana("/greske")).status === 403);
    await ana("/lotovi/nije-identifikator");
    const cetiriSto = (await pool.query(`select count(*)::int as n from greska_log where putanja like '/api/lotovi/nije-identifikator%'`)).rows[0].n;
    provjeri("Greška u zahtjevu (400) nije greška servera — ne ide u dnevnik", cetiriSto === 0, String(cetiriSto));

    // ── Potvrda u dva koraka ──
    const ime = `e2e.t5.${String(Date.now()).slice(-7)}`;
    const lozinka = "Tara-2026-t5x";
    const n = await konsultant("/lica", { telo: { ime: `E2E T5 Odgovorno lice ${oznaka}`, radnoMjesto: "odgovorno lice", nalog: { korisnickoIme: ime, uloga: "bzr", lozinka } } });
    trag.lica.push(n.tijelo?.id);
    const korisnikId = (await pool.query(`select id from korisnik where korisnicko_ime = $1`, [ime])).rows[0]?.id;
    trag.korisnici.push(korisnikId);
    provjeri("Konsultant otvara probni nalog odgovornog lica", n.status === 201 && !!korisnikId, `${n.status} ${n.tijelo?.error?.message ?? ""}`);

    // Lozinke: stari heš (scrypt$salt$heš, podrazumijevani parametri) radi i pri prijavi se pojača.
    const salt = crypto.randomBytes(16).toString("hex");
    await pool.query(`update korisnik set lozinka_hash = $1, mora_promijeniti_lozinku = false where id = $2`, [`scrypt$${salt}$${crypto.scryptSync(lozinka, salt, 64).toString("hex")}`, korisnikId]);
    const bzr = await prijava({ ime, lozinka, id: korisnikId });
    const hes = (await pool.query(`select lozinka_hash from korisnik where id = $1`, [korisnikId])).rows[0].lozinka_hash;
    provjeri("Stari heš lozinke radi, a pri prijavi se zamijeni jačim (scrypt2$32768$8$1$…)", hes.startsWith("scrypt2$32768$8$1$"), hes.slice(0, 22));
    provjeri("Pogrešna lozinka i nepostojeće ime — isto 401", (await surovo(BAZA, "/auth/prijava", { korisnickoIme: ime, lozinka: "pogresna-lozinka" })).status === 401 && (await surovo(BAZA, "/auth/prijava", { korisnickoIme: `${ime}.nema`, lozinka })).status === 401);

    const s0 = await bzr("/auth/2fa");
    provjeri("2FA: vodstvo je smije uključiti, a nije uključena", s0.status === 200 && s0.tijelo.dozvoljeno === true && s0.tijelo.ukljuceno === false, JSON.stringify(s0.tijelo));
    provjeri("2FA: magacioner je ne uključuje (403)", (await marko("/auth/2fa/pocni", { telo: { lozinka: NALOZI.marko.lozinka } })).status === 403);
    provjeri("2FA: bez tačne lozinke se ne počinje (403)", (await bzr("/auth/2fa/pocni", { telo: { lozinka: "nije-ta" } })).status === 403);
    const pocetak = await bzr("/auth/2fa/pocni", { telo: { lozinka } });
    const tajna = pocetak.tijelo?.tajna ?? "";
    provjeri(
      "2FA: tajna, adresa za aplikaciju (sa nazivom firme) i QR kod",
      pocetak.status === 200 && /^[A-Z2-7]{32}$/.test(tajna) && pocetak.tijelo.otpauth.startsWith("otpauth://totp/") && pocetak.tijelo.otpauth.includes("PILOT") && pocetak.tijelo.qr.startsWith("data:image/svg+xml;base64,"),
      `${pocetak.status} ${pocetak.tijelo?.otpauth?.slice(0, 60) ?? pocetak.tijelo?.error?.message}`,
    );
    const drugiUredjaj = await prijava({ ime, lozinka, id: korisnikId });
    const k0 = korakSada();
    const tacni = [k0 - 1, k0, k0 + 1].map((k) => totp(tajna, k));
    const pogresan = ["000000", "111111", "222222", "333333"].find((c) => !tacni.includes(c));
    provjeri("2FA: pogrešan kod ne uključuje (400)", (await bzr("/auth/2fa/potvrdi", { telo: { kod: pogresan } })).status === 400);
    const kodUkljucivanja = totp(tajna, korakSada());
    const ukljuci = await bzr("/auth/2fa/potvrdi", { telo: { kod: kodUkljucivanja } });
    const rezervni = ukljuci.tijelo?.rezervniKodovi ?? [];
    provjeri("2FA: tačan kod uključuje — 8 rezervnih kodova, prikazanih jednom", ukljuci.status === 200 && rezervni.length === 8, `${ukljuci.status} ${ukljuci.tijelo?.error?.message ?? ""}`);
    provjeri("2FA: drugi uređaj je odjavljen (mora ponovo, uz kod)", (await drugiUredjaj("/auth/ja")).status === 401);
    const ja = await bzr("/auth/ja");
    provjeri("2FA: ovaj uređaj ostaje prijavljen i zna da je uključena", ja.status === 200 && ja.tijelo.korisnik.totp_ukljucen === true);
    const audit = (await pool.query(`select count(*)::int as n from audit_log where entitet_id = $1 and nove_vrijednosti->>'radnja' = 'potvrda u dva koraka uključena'`, [korisnikId])).rows[0].n;
    provjeri("2FA: uključivanje je u auditu", audit === 1, String(audit));
    const tajnaUAuditu = (await pool.query(`select count(*)::int as n from audit_log where entitet_id = $1 and (coalesce(nove_vrijednosti::text, '') || coalesce(stare_vrijednosti::text, '')) like $2`, [korisnikId, `%${tajna}%`])).rows[0].n;
    provjeri("2FA: tajna se ne vidi u auditu", tajnaUAuditu === 0);
    const t0Bekap = new Date();
    const podaci = JSON.parse((await preuzmi(ana, "/bekap/preuzmi")).sadrzaj.toString("utf8"));
    trag.bekap = (await pool.query(`select id from bekap_log where pokrenuo_korisnik_id = $1 and created_at >= $2 order by created_at desc limit 1`, [NALOZI.ana.id, t0Bekap])).rows[0]?.id ?? null;
    provjeri("2FA: tajna i rezervni kodovi ne idu u bekap iz aplikacije", podaci.korisnik.every((k) => !("totp_tajna" in k) && !("totp_rezervni" in k) && !("totp_zadnji_korak" in k)));

    const p1 = await surovo(BAZA, "/auth/prijava", { korisnickoIme: ime, lozinka });
    provjeri("Prijava sa 2FA: posle lozinke izazov, a sesije NEMA", p1.status === 200 && p1.tijelo?.potreban2fa === true && !!p1.tijelo.izazov && !p1.kolacic, JSON.stringify(p1.tijelo).slice(0, 80));
    const ponovljen = await surovo(BAZA, "/auth/prijava/2fa", { izazov: p1.tijelo.izazov, kod: kodUkljucivanja });
    provjeri("Prijava sa 2FA: već iskorišćen kod ne važi drugi put (401)", ponovljen.status === 401 && ponovljen.tijelo?.error?.code === "POGRESAN_KOD", `${ponovljen.status} ${ponovljen.tijelo?.error?.code ?? ""}`);
    const saRezervnim = await surovo(BAZA, "/auth/prijava/2fa", { izazov: p1.tijelo.izazov, kod: rezervni[0].toLowerCase() });
    provjeri("Prijava sa 2FA: rezervni kod (i malim slovima) daje sesiju", saRezervnim.status === 200 && !!saRezervnim.kolacic && (await surovo(BAZA, "/auth/ja", undefined, saRezervnim.kolacic)).status === 200, `${saRezervnim.status} ${saRezervnim.tijelo?.error?.message ?? ""}`);
    const p2 = await surovo(BAZA, "/auth/prijava", { korisnickoIme: ime, lozinka });
    provjeri("Prijava sa 2FA: isti rezervni kod drugi put ne važi (401)", (await surovo(BAZA, "/auth/prijava/2fa", { izazov: p2.tijelo.izazov, kod: rezervni[0] })).status === 401);
    const saAplikacijom = await surovo(BAZA, "/auth/prijava/2fa", { izazov: p2.tijelo.izazov, kod: totp(tajna, korakSada() + 1) });
    provjeri("Prijava sa 2FA: novi kod iz aplikacije daje sesiju", saAplikacijom.status === 200 && !!saAplikacijom.kolacic, `${saAplikacijom.status} ${saAplikacijom.tijelo?.error?.message ?? ""}`);
    const p3 = await surovo(BAZA, "/auth/prijava", { korisnickoIme: ime, lozinka });
    const pokusaji = [];
    for (let i = 0; i < 5; i++) pokusaji.push((await surovo(BAZA, "/auth/prijava/2fa", { izazov: p3.tijelo.izazov, kod: pogresan })).tijelo?.error?.code);
    const sesti = await surovo(BAZA, "/auth/prijava/2fa", { izazov: p3.tijelo.izazov, kod: totp(tajna, korakSada() + 1) });
    provjeri("Prijava sa 2FA: posle 5 pogrešnih kodova izazov propada — ni tačan kod ne pomaže", pokusaji.every((c) => c === "POGRESAN_KOD") && sesti.status === 401 && sesti.tijelo?.error?.code === "IZAZOV_ISTEKAO", `${pokusaji.join(",")} → ${sesti.tijelo?.error?.code}`);
    provjeri("2FA: rezervnih ostalo 7", (await bzr("/auth/2fa")).tijelo.rezervnihPreostalo === 7);

    provjeri("2FA: isključivanje bez tačnog koda ne prolazi (400)", (await bzr("/auth/2fa/iskljuci", { telo: { lozinka, kod: pogresan } })).status === 400);
    const iskljuceno = await bzr("/auth/2fa/iskljuci", { telo: { lozinka, kod: rezervni[1] } });
    provjeri("2FA: isključuje se lozinkom i kodom (rezervnim) — 204", iskljuceno.status === 204 && (await bzr("/auth/2fa")).tijelo.ukljuceno === false, `${iskljuceno.status} ${iskljuceno.tijelo?.error?.message ?? ""}`);
    const bez2fa = await surovo(BAZA, "/auth/prijava", { korisnickoIme: ime, lozinka });
    provjeri("Poslije isključivanja: prijava opet samo lozinkom", bez2fa.status === 200 && !!bez2fa.kolacic && !bez2fa.tijelo?.potreban2fa);

    // ── Obavezna 2FA (OBAVEZNA_2FA=bzr): drugi server na istoj bazi — samo lokalno ──
    if (!/localhost|127\.0\.0\.1/.test(APP_URL)) {
      console.log("    · preskočeno: obavezna 2FA se provjerava samo na lokalnom serveru");
    } else {
      const PORT = 5057;
      drugiServer = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
        cwd: korijen,
        env: { ...process.env, PORT: String(PORT), SAMO_API: "1", NODE_ENV: "development", OBAVEZNA_2FA: "bzr" },
        stdio: "ignore",
      });
      const druga = `http://localhost:${PORT}/api`;
      const kraj = Date.now() + 60_000;
      while (Date.now() < kraj && (await fetch(`${druga}/zdravlje`).then((r) => r.status, () => 0)) !== 200) await new Promise((ok) => setTimeout(ok, 400));
      const o = await surovo(druga, "/auth/prijava", { korisnickoIme: ime, lozinka });
      const jaO = await surovo(druga, "/auth/ja", undefined, o.kolacic);
      provjeri("Obavezna 2FA: prijava prolazi, a nalog zna da mora uključiti 2FA", o.status === 200 && jaO.tijelo?.korisnik?.mora2fa === true, `${o.status} ${JSON.stringify(jaO.tijelo?.korisnik?.mora2fa)}`);
      const tablaO = await surovo(druga, "/tabla", undefined, o.kolacic);
      provjeri("Obavezna 2FA: dok je ne uključi, ništa drugo (403 DVA_FAKTORA_OBAVEZNA)", tablaO.status === 403 && tablaO.tijelo?.error?.code === "DVA_FAKTORA_OBAVEZNA", `${tablaO.status} ${tablaO.tijelo?.error?.code ?? ""}`);
      const po = await surovo(druga, "/auth/2fa/pocni", { lozinka }, o.kolacic);
      const pot = await surovo(druga, "/auth/2fa/potvrdi", { kod: totp(po.tijelo?.tajna ?? "", korakSada()) }, o.kolacic);
      const tablaPosle = await surovo(druga, "/tabla", undefined, o.kolacic);
      provjeri("Obavezna 2FA: uključi je na toj istoj sesiji — i sve se otvara", po.status === 200 && pot.status === 200 && tablaPosle.status === 200, `${po.status} ${pot.status} ${tablaPosle.status}`);
      provjeri("Obavezna 2FA: magacionera ne dira (nije na spisku OBAVEZNA_2FA)", (await surovo(druga, "/zdravlje")).status === 200 && (await (async () => {
        const m = await surovo(druga, "/auth/prijava", { korisnickoIme: NALOZI.marko.ime, lozinka: NALOZI.marko.lozinka });
        return (await surovo(druga, "/zaliha", undefined, m.kolacic)).status;
      })()) === 200);
    }
  } finally {
    if (drugiServer && drugiServer.exitCode === null) drugiServer.kill();
    if (!trag.migracijaVracena) await pool.query(`insert into schema_migracije (fajl) values ('33_talas5_cg.sql') on conflict do nothing`);
    const k = await pool.connect();
    try {
      await k.query("begin");
      const korisnici = trag.korisnici.filter(Boolean);
      const lica = trag.lica.filter(Boolean);
      await k.query(`delete from greska_log where poruka like $1`, [`%${oznaka}%`]);
      if (trag.bekap) {
        await k.query(`delete from audit_log where entitet_id = $1`, [trag.bekap]);
        await k.query(`delete from obavjestenje where izvor_id = $1`, [trag.bekap]);
        await k.query(`delete from bekap_log where id = $1`, [trag.bekap]);
      }
      await k.query(`delete from obavjestenje where korisnik_id = any($1) or izvor_id = any($2)`, [korisnici, [...lica, ...korisnici]]);
      await k.query(`delete from audit_log where entitet_id = any($1) or korisnik_id = any($2)`, [[...lica, ...korisnici], korisnici]);
      await k.query(`delete from prijava_izazov where korisnik_id = any($1)`, [korisnici]);
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
