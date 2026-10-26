// Zajedničko za sve testove: prijava, provjera, veza sa bazom i zaštita da se testovi
// NIKAD ne pokrenu na bazi pravog klijenta (prave i brišu podatke).
import "dotenv/config";
import pg from "pg";

export const APP_URL = (process.env.APP_URL || "http://localhost:5000").replace(/\/$/, "");
const BAZA = `${APP_URL}/api`;

// Isto pravilo kao server/db.ts: lokalna baza (izolovani testovi, CI) je bez SSL-a, Supabase sa njim.
const URL_BAZE = process.env.DATABASE_URL ?? "";
export const pool = new pg.Pool({ connectionString: URL_BAZE, ssl: URL_BAZE.includes("localhost") ? undefined : { rejectUnauthorized: false } });

// Demo nalozi iz db/99_demo_atelje.sql. Na lokalnoj bazi (npm test, CI — svaki put čista, iz 99_demo_atelje.sql)
// važe početne lozinke. Na živoj demo bazi su promijenjene (`npm run demo-lozinke`, talas 5 — repozitorijum
// je bio javan) i čitaju se iz .env: DEMO_LOZINKA_ANA, _MARKO, _KONSULTANT.
const LOKALNA = URL_BAZE.includes("localhost");
const lozinka = (kljuc, pocetna) => (LOKALNA ? pocetna : process.env[`DEMO_LOZINKA_${kljuc}`] || pocetna);
export const NALOZI = {
  ana: { ime: "ana.b", lozinka: lozinka("ANA", "Podgorica-2026!"), id: "11000000-0000-0000-0000-000000000002" },
  marko: { ime: "marko.v", lozinka: lozinka("MARKO", "Magacin-2026!"), id: "11000000-0000-0000-0000-000000000003" },
  konsultant: { ime: "konsultant", lozinka: lozinka("KONSULTANT", "Konsultant-2026!"), id: "11000000-0000-0000-0000-000000000001" },
};

/** Baza je demo samo ako u njoj stoje sva tri demo naloga sa svojim fiksnim ID-jevima. */
export async function provjeriDemoBazu() {
  const r = await pool.query(`select count(*)::int as n from korisnik where (id::text, korisnicko_ime) in (select * from unnest($1::text[], $2::text[]))`, [
    Object.values(NALOZI).map((n) => n.id),
    Object.values(NALOZI).map((n) => n.ime),
  ]);
  if (r.rows[0].n !== Object.keys(NALOZI).length) {
    throw new Error("Ovo NIJE demo baza — testovi prave i brišu podatke i pokreću se samo na demo bazi. Prekidam.");
  }
}

export const danasCG = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Podgorica" });
/** Slobodno na lotu — u ateljeu nema rezervacije za isporuke, slobodno je ono što je dostupno. */
export const slobodno = (l) => Number(l.dostupno);
/** Rok trajanja za prijem u testu — obavezan je pri prijemu (R-17). */
export const rokZaDana = (dana) => {
  const d = new Date(`${danasCG()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dana);
  return d.toISOString().slice(0, 10);
};
/** Lot sa isteklim rokom ne ide u tortu (P2) — demo lotovi vremenom isteknu, testovi biraju važeće. */
export const nijeIstekao = (l) => !l.rok_trajanja || String(l.rok_trajanja).slice(0, 10) >= danasCG();

// Skladište u koje testovi primaju robu: „Atelje" iz demo podataka. Demo baza može imati i
// druga aktivna skladišta (unesena ručno kroz aplikaciju) — tada prijem bez izbora vraća 400.
export async function glavnoSkladiste(k) {
  const aktivna = (await k("/skladista")).tijelo.skladista.filter((s) => s.aktivan);
  return (aktivna.find((s) => s.naziv === "Atelje") ?? aktivna[0])?.id;
}

/** Drugi zaposleni sa nalogom (atelje ima jednog demo zaposlenog) — za provjere „tuđe“ i poruke među zaposlenima.
 * Otvara ga vlasnica kao u aplikaciji (lice + nalog u jednoj transakciji). Briše se sa `obrisiZaposlenog`. */
export async function drugiZaposleni(ana, ime, dodatno = {}) {
  const korisnickoIme = `e2e.${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const lozinka = "Proba-zaposleni-2026";
  const r = await ana("/lica", { telo: { ime, radnoMjesto: "poslastičar", ...dodatno, nalog: { korisnickoIme, uloga: "operater", lozinka } } });
  if (r.status !== 201) throw new Error(`Drugi zaposleni nije upisan (${r.status}): ${r.tijelo?.error?.message ?? ""}`);
  const id = (await pool.query(`select id from korisnik where korisnicko_ime = $1`, [korisnickoIme])).rows[0].id;
  const k = await prijava({ ime: korisnickoIme, lozinka, id });
  return { k, id, liceId: r.tijelo.id, lozinka, sifra: r.tijelo.sifra };
}
export async function obrisiZaposlenog(klijent, z) {
  if (!z) return;
  await klijent.query(`delete from obavjestenje where korisnik_id = $1`, [z.id]);
  await klijent.query(`delete from sesija_prijave where korisnik_id = $1`, [z.id]);
  await klijent.query(`delete from audit_log where entitet_id = any($1) or korisnik_id = $2`, [[z.id, z.liceId], z.id]);
  await klijent.query(`delete from korisnik where id = $1`, [z.id]);
  await klijent.query(`delete from plan_obuke where lice_id = $1`, [z.liceId]);
  await klijent.query(`delete from lice where id = $1`, [z.liceId]);
}

/** Klijent bez prijave — za javne adrese (zdravlje, ulazak u provjeru znanja šifrom). */
export function anonimno() {
  return zahtjev(null);
}

/** Prijavljen klijent: `k(putanja, { method, telo, zaglavlja })` → { status, tijelo }. */
export async function prijava(nalog) {
  const r = await fetch(`${BAZA}/auth/prijava`, {
    method: "POST",
    headers: { "x-zahtjev-app": "1", "Content-Type": "application/json" },
    body: JSON.stringify({ korisnickoIme: nalog.ime, lozinka: nalog.lozinka }),
  });
  if (r.status !== 200) throw new Error(`Prijava ${nalog.ime} nije uspjela (${r.status})`);
  const kolacic = r.headers.get("set-cookie").split(";")[0];
  const k = zahtjev(kolacic);
  k.id = nalog.id;
  k.kolacic = kolacic;
  return k;
}

function zahtjev(kolacic) {
  return async (putanja, { method, telo, zaglavlja } = {}) => {
    const odg = await fetch(`${BAZA}${putanja}`, {
      method: method ?? (telo === undefined ? "GET" : "POST"),
      headers: { "x-zahtjev-app": "1", "Content-Type": "application/json", ...(kolacic ? { cookie: kolacic } : {}), ...zaglavlja },
      body: telo === undefined ? undefined : JSON.stringify(telo),
    });
    const tekst = await odg.text();
    let tijelo = null;
    try {
      tijelo = tekst ? JSON.parse(tekst) : null;
    } catch {
      tijelo = tekst;
    }
    return { status: odg.status, tijelo };
  };
}

/** Šalje fajl (PDF, slika) kao sirovo tijelo, sa sesijom prijavljenog klijenta `k`. */
export async function posaljiFajl(k, putanja, sadrzaj, tip, naziv = "fajl") {
  const odg = await fetch(`${BAZA}${putanja}`, {
    method: "POST",
    headers: { "x-zahtjev-app": "1", "Content-Type": tip, "x-naziv-fajla": encodeURIComponent(naziv), cookie: k.kolacic },
    body: sadrzaj,
  });
  const tekst = await odg.text();
  let tijelo = null;
  try {
    tijelo = tekst ? JSON.parse(tekst) : null;
  } catch {
    tijelo = tekst;
  }
  return { status: odg.status, tijelo };
}

/** Sirov odgovor (za preuzimanje fajla). */
export async function preuzmi(k, putanja) {
  const odg = await fetch(`${BAZA}${putanja}`, { headers: { "x-zahtjev-app": "1", cookie: k.kolacic } });
  return { status: odg.status, tip: odg.headers.get("content-type"), sadrzaj: Buffer.from(await odg.arrayBuffer()) };
}

/** Sakupljač rezultata jednog testa. */
export function noviRezultati() {
  const lista = [];
  const provjeri = (naziv, uslov, detalj = "") => {
    lista.push({ naziv, ok: !!uslov });
    console.log(`  ${uslov ? "✓" : "✗"} ${naziv}${detalj ? ` — ${detalj}` : ""}`);
  };
  return { lista, provjeri };
}
