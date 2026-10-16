// Push obavještenja (faza 4, nalaz A6): pretplata po uređaju, sadržaj stiže šifrovan na adresu
// uređaja i samo ga uređaj može pročitati, najviše jednom, nestao uređaj (410) se briše sam, odjava.
// Push servis pregledača glumi lokalni HTTP server. Briše sve što napravi.
import http from "node:http";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { pool, prijava, NALOZI } from "./pomoc.mjs";

const require = createRequire(import.meta.url);
const ece = require("http_ece"); // dolazi uz web-push

export const naziv = "Push obavještenja na telefon";

const pauza = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function cekaj(uslov, ms = 20_000) {
  const kraj = Date.now() + ms;
  while (Date.now() < kraj) {
    if (await uslov()) return true;
    await pauza(300);
  }
  return false;
}

/** Ključevi „uređaja" — isto što pregledač napravi pri pretplati. */
function uredjaj() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return { ecdh, p256dh: ecdh.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") };
}

export async function pokreni({ provjeri }) {
  const stiglo = [];
  const servis = http.createServer((req, res) => {
    const dijelovi = [];
    req.on("data", (d) => dijelovi.push(d));
    req.on("end", () => {
      stiglo.push({ put: req.url, zaglavlja: req.headers, tijelo: Buffer.concat(dijelovi) });
      res.statusCode = req.url.includes("nestalo") ? 410 : 201;
      res.end();
    });
  });
  await new Promise((ok) => servis.listen(0, ok));
  const port = servis.address().port;
  const adresa = (p) => `http://localhost:${port}/${p}`;
  const brojPretplata = async (endpoint) => (await pool.query(`select count(*)::int as n from push_pretplata where endpoint = $1`, [endpoint])).rows[0].n;

  const ana = await prijava(NALOZI.ana);
  const marko = await prijava(NALOZI.marko);
  const petar = await prijava(NALOZI.petar);
  const telefon = uredjaj();
  const trag = { poruke: [] };

  try {
    const k = await marko("/push/kljuc");
    provjeri("Server daje javni VAPID ključ (65 bajtova)", k.status === 200 && Buffer.from(k.tijelo.javniKljuc, "base64url").length === 65);

    const tudja = await marko("/push/pretplata", { telo: { endpoint: "https://primjer.me/push", keys: { p256dh: telefon.p256dh, auth: telefon.auth } } });
    provjeri("Adresa koja nije push servis pregledača se odbija (400)", tudja.status === 400, `${tudja.status}`);

    const p = await marko("/push/pretplata", { telo: { endpoint: adresa("marko"), keys: { p256dh: telefon.p256dh, auth: telefon.auth }, uredjaj: "E2E" } });
    provjeri("Magacioner uključuje obavještenja na svom uređaju", p.status === 201 && p.tijelo.brojUredjaja >= 1, JSON.stringify(p.tijelo));

    // Poruka od Ane samo Marku → obavještenje (kao i do sad) → push na njegov uređaj.
    const poruka = await ana("/poruke", {
      telo: { naslov: "E2E push: utovar u 6h", tekst: "Sutra ranije.", primaoci: { nacin: "pojedinacno", korisnici: [NALOZI.marko.id] } },
    });
    trag.poruke.push(poruka.tijelo?.id);
    provjeri("Push stiže na uređaj za nekoliko sekundi", await cekaj(() => stiglo.some((s) => s.put === "/marko")));

    const s = stiglo.find((x) => x.put === "/marko");
    if (s) {
      provjeri(
        "Potpisan (VAPID) i šifrovan (aes128gcm)",
        /^vapid t=[^,]+, k=/.test(s.zaglavlja.authorization ?? "") && s.zaglavlja["content-encoding"] === "aes128gcm",
        `${s.zaglavlja.authorization?.slice(0, 20)} ${s.zaglavlja["content-encoding"]}`,
      );
      let sadrzaj;
      try {
        sadrzaj = JSON.parse(ece.decrypt(s.tijelo, { version: "aes128gcm", privateKey: telefon.ecdh, authSecret: telefon.auth }).toString("utf8"));
      } catch (e) {
        sadrzaj = { greska: e.message };
      }
      provjeri("Samo uređaj ga čita: naslov poruke i strana za klik", sadrzaj?.naslov === "E2E push: utovar u 6h" && sadrzaj?.url === "/moja", JSON.stringify(sadrzaj));
    }
    await pauza(6_000); // bar još jedan krug slanja
    const puta = stiglo.filter((x) => x.put === "/marko").length;
    provjeri("Isto obavještenje se ne šalje dva puta", puta === 1, `${puta}`);

    // Uređaj koji je nestao: push servis vrati 410 → pretplata se briše sama.
    const stari = uredjaj();
    await marko("/push/pretplata", { telo: { endpoint: adresa("nestalo"), keys: { p256dh: stari.p256dh, auth: stari.auth } } });
    provjeri("Probno obavještenje se prima (202)", (await marko("/push/proba", { telo: {} })).status === 202);
    await cekaj(() => stiglo.some((x) => x.put === "/nestalo"));
    provjeri("Nestao uređaj (410) se briše sam", await cekaj(async () => (await brojPretplata(adresa("nestalo"))) === 0, 5_000));

    // Odjava: samo svog uređaja.
    provjeri("Vozač ne može odjaviti tuđi uređaj", (await petar("/push/odjava", { telo: { endpoint: adresa("marko") } })).status === 204 && (await brojPretplata(adresa("marko"))) === 1);
    const odjava = await marko("/push/odjava", { telo: { endpoint: adresa("marko") } });
    provjeri("Odjava briše uređaj", odjava.status === 204 && (await brojPretplata(adresa("marko"))) === 0);
  } finally {
    servis.close();
    await pool.query(`delete from push_pretplata where endpoint like $1`, [`http://localhost:${port}/%`]);
    const poruke = trag.poruke.filter(Boolean);
    if (poruke.length) {
      await pool.query(`delete from obavjestenje where izvor_tip = 'poruka' and izvor_id = any($1)`, [poruke]);
      await pool.query(`delete from audit_log where entitet_tip = 'poruka' and entitet_id = any($1)`, [poruke]);
      await pool.query(`delete from poruka where id = any($1)`, [poruke]);
    }
    await pool.query(`delete from obavjestenje where korisnik_id = $1 and naslov = 'Probno obavještenje' and created_at > now() - interval '15 minutes'`, [NALOZI.marko.id]);
  }
}
