// Mali talas 4 posle revizije 25.09.2026:
//   R-19 bekap iz aplikacije bez tajni (heševi lozinki, sesije, ključevi) i sa svim tabelama;
//   R-25 /api/zdravlje provjerava i bazu;
//   R-26 neispravan zahtjev → 400/409 sa porukom, ne 500;
//   R-27 bezbjednosna zaglavlja (CSP i HSTS samo u produkciji — ovdje se provjerava ostatak).
import { pool, prijava, anonimno, preuzmi, NALOZI, APP_URL, danasCG } from "./pomoc.mjs";

export const naziv = "Mali talas 4: bekap bez tajni, zdravlje, greške 4xx, zaglavlja";

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const anon = anonimno();
  const trag = { bekap: null };

  try {
    // ── R-25 ──
    const z = await anon("/zdravlje");
    provjeri("R-25: zdravlje javlja i stanje baze", z.status === 200 && z.tijelo.ok === true && z.tijelo.baza === "ok", JSON.stringify(z.tijelo));
    // Nadzor dostupnosti (UptimeRobot, besplatni plan) pita metodom HEAD — mora dobiti 200, ne 404.
    const glava = await fetch(`${APP_URL}/api/zdravlje`, { method: "HEAD" });
    provjeri("Zdravlje odgovara i na HEAD (UptimeRobot) — 200", glava.status === 200, String(glava.status));

    // ── R-27 ──
    const odg = await fetch(`${APP_URL}/api/zdravlje`);
    provjeri("R-27: nosniff, zabrana okvira i Permissions-Policy", odg.headers.get("x-content-type-options") === "nosniff" && odg.headers.get("x-frame-options") === "DENY" && (odg.headers.get("permissions-policy") ?? "").includes("microphone=()"));

    // ── R-26 ──
    const losJson = await fetch(`${APP_URL}/api/poruke`, {
      method: "POST",
      headers: { "x-zahtjev-app": "1", "Content-Type": "application/json", cookie: ana.kolacic },
      body: "{ovo nije json",
    });
    provjeri("R-26: neispravan JSON → 400, ne 500", losJson.status === 400);
    const losId = await ana("/lotovi/nije-identifikator");
    provjeri("R-26: loš identifikator u adresi → 400, ne 500", losId.status === 400 && losId.tijelo.error.code === "NEISPRAVAN_PODATAK", `${losId.status}`);
    const zod = await ana("/provjera-znanja/zavrsi", { telo: { ucesnikId: "x" } });
    provjeri("R-26: greška šeme van tijelo() → 400, ne 500", zod.status === 400 && zod.tijelo.error.code === "NEVALIDAN_UNOS", `${zod.status}`);
    const veza = await ana("/plan-obuke", { telo: { liceId: "00000000-0000-4000-8000-000000000000", tema: "E2E", planiraniDatum: danasCG() } });
    provjeri("R-26: veza na nepostojeći zapis → 409 sa porukom, ne 500", veza.status === 409 && veza.tijelo.error.code === "VEZA_NE_POSTOJI", `${veza.status} ${veza.tijelo?.error?.code}`);
    const bezLozinke = await ana("/provjera-znanja/uci", { telo: {} });
    provjeri("R-26: poruka iz šeme ide na ekran („Upišite svoju lozinku.\")", bezLozinke.status === 400 && bezLozinke.tijelo.error.message === "Upišite svoju lozinku.", bezLozinke.tijelo?.error?.message);

    // ── R-19 ──
    // Podsjetnik umjesto sedmične kopije: na čistoj bazi server pri pokretanju javi odgovornom licu.
    const podsjetnik = (await pool.query(
      `select exists (select 1 from obavjestenje where izvor_tip = 'bekap_log' and naslov = 'Preuzmite sedmični bekap') as ima,
              exists (select 1 from bekap_log where created_at > now() - interval '7 days') as preuzet`,
    )).rows[0];
    provjeri("Bekap: podsjetnik „Preuzmite sedmični bekap“ (ili je bekap preuzet ove sedmice)", podsjetnik.ima || podsjetnik.preuzet, JSON.stringify(podsjetnik));
    const t0 = new Date();
    const b = await preuzmi(ana, "/bekap/preuzmi");
    const podaci = JSON.parse(b.sadrzaj.toString("utf8"));
    const zapis = (await pool.query(
      `select id, podaci is null as bez_kopije, velicina_bajtova from bekap_log where pokrenuo_korisnik_id = $1 and created_at >= $2 order by created_at desc limit 1`,
      [NALOZI.ana.id, t0],
    )).rows[0];
    trag.bekap = zapis?.id;
    provjeri(
      "Bekap se preuzima direktno (JSON) — u bazi ostaje samo ko je i kad preuzeo i koliko je velik, BEZ kopije podataka (dopuna 35)",
      b.status === 200 && /application\/json/.test(b.tip ?? "") && zapis?.bez_kopije === true && Number(zapis?.velicina_bajtova) === b.sadrzaj.length,
      `${b.status} ${b.tip} ${JSON.stringify(zapis)} ${b.sadrzaj.length}`,
    );
    const kopije = (await pool.query(`select count(*)::int as n from bekap_log where podaci is not null`)).rows[0].n;
    provjeri("…i nijedan stari bekap više ne drži kopiju podataka u bazi", kopije === 0, `${kopije}`);
    provjeri("R-19: bekap nosi naloge, ali bez heša lozinke", Array.isArray(podaci?.korisnik) && podaci.korisnik.length >= 5 && podaci.korisnik.every((k) => !("lozinka_hash" in k)));
    provjeri("R-19: …bez sesija, VAPID ključa, push uređaja i ključeva zahtjeva", ["sesija_prijave", "web_push_kljuc", "push_pretplata", "kljuc_zahtjeva", "bekap_log"].every((t) => !(t in podaci)));
    provjeri("R-19: …a sa tabelama HACCP sistema (plan, termometri, verifikacija)", ["plan_monitoringa", "mjerni_uredjaj", "provjera_uredjaja", "verifikacija_sistema", "artikal_dobavljaca"].every((t) => t in podaci));
    provjeri("R-19: otpremnice bez samog fajla (on je u pg_dump bekapu)", Array.isArray(podaci.prijem_dokument) && podaci.prijem_dokument.every((p) => !("sadrzaj" in p)));
  } finally {
    if (trag.bekap) {
      await pool.query(`delete from audit_log where entitet_id = $1`, [trag.bekap]);
      await pool.query(`delete from bekap_log where id = $1`, [trag.bekap]);
    }
  }
}
