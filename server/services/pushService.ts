import webpush from "web-push";
import { pool, upit, tabelaPostoji } from "../db.js";
import { ApiGreska } from "../greske.js";

// Push obavještenja na telefon (nalaz A6, faza 4). Kanal za ISTA obavještenja koja se vide na
// zvoncu — ništa se ne šalje mimo tabele `obavjestenje`:
//  - obavještenje se upisuje u transakciji kao i do sad;
//  - ova petlja ga vidi tek kad je transakcija potvrđena, i šalje ga NAJVIŠE JEDNOM (red se
//    označi prije slanja — radije jedno propušteno nego pet istih na zaključanom ekranu);
//  - sadržaj je šifrovan za uređaj (RFC 8291) — push servis pregledača ga prenosi, ne čita;
//  - uređaj koji je nestao (404/410) briše se sam.

const isProduction = process.env.NODE_ENV === "production";
const INTERVAL_MS = 5_000;

type Kljucevi = { javni: string; privatni: string };
let kljucevi: Kljucevi | null = null;

/** VAPID ključ: iz okruženja (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY) ili jedan po bazi, napravljen
 * pri prvom pokretanju. Po bazi, jer je baza po klijentu — pretplate i ključ idu zajedno u bekap. */
async function vapid(): Promise<Kljucevi> {
  if (kljucevi) return kljucevi;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    kljucevi = { javni: process.env.VAPID_PUBLIC_KEY, privatni: process.env.VAPID_PRIVATE_KEY };
    return kljucevi;
  }
  const novi = webpush.generateVAPIDKeys();
  await pool.query(`insert into web_push_kljuc (id, javni, privatni) values (1, $1, $2) on conflict (id) do nothing`, [novi.publicKey, novi.privateKey]);
  const r = await upit<Kljucevi>(`select javni, privatni from web_push_kljuc where id = 1`);
  kljucevi = r.rows[0];
  return kljucevi;
}

export async function javniKljuc() {
  return (await vapid()).javni;
}

// Push servisi pregledača. Server šalje samo njima — adresa pretplate dolazi iz pregledača, pa se
// ne smije pretvoriti u „pošalji POST bilo kud". Lokalno (razvoj, testovi) i http://localhost.
const PUSH_SERVISI = ["fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];

function dozvoljenEndpoint(adresa: string) {
  let url: URL;
  try {
    url = new URL(adresa);
  } catch {
    return false;
  }
  if (url.protocol === "https:" && PUSH_SERVISI.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) return true;
  return !isProduction && url.protocol === "http:" && url.hostname === "localhost";
}

export type Pretplata = { endpoint: string; keys: { p256dh: string; auth: string } };

/** Isti uređaj (endpoint) se samo osvježi; ako se na njemu prijavi neko drugi, pretplata prelazi na njega. */
export async function sacuvajPretplatu(korisnikId: string, p: Pretplata, uredjaj: string | null) {
  if (!dozvoljenEndpoint(p.endpoint)) throw new ApiGreska(400, "PUSH_ADRESA", "Ovaj pregledač nije podržan za obavještenja na telefon.");
  await pool.query(
    `insert into push_pretplata (korisnik_id, endpoint, p256dh, auth, uredjaj) values ($1, $2, $3, $4, $5)
     on conflict (endpoint) do update set korisnik_id = excluded.korisnik_id, p256dh = excluded.p256dh, auth = excluded.auth, uredjaj = excluded.uredjaj`,
    [korisnikId, p.endpoint, p.keys.p256dh, p.keys.auth, uredjaj?.slice(0, 200) ?? null],
  );
}

export async function obrisiPretplatu(korisnikId: string, endpoint: string) {
  await pool.query(`delete from push_pretplata where korisnik_id = $1 and endpoint = $2`, [korisnikId, endpoint]);
}

export async function brojPretplata(korisnikId: string) {
  return (await upit<{ n: number }>(`select count(*)::int as n from push_pretplata where korisnik_id = $1`, [korisnikId])).rows[0].n;
}

// Klik na obavještenje otvara stranu odakle je došlo (ista mapa kao na zvoncu, Zadaci.tsx);
// strana na koju uloga ne smije vodi na njenu početnu.
const PUTANJA: Record<string, string> = {
  neusaglasenost: "/neusaglasenosti",
  povlacenje: "/sledljivost",
  isporuka: "/isporuka",
  prijem: "/prijem",
  lot: "/prijem",
  zadatak: "/moja",
  poruka: "/moja",
  mjerni_uredjaj: "/haccp-plan",
  verifikacija_sistema: "/haccp-plan",
  bekap_log: "/tabla",
};

type ZaSlanje = { id: string; korisnik_id: string; naslov: string; poruka: string | null; izvor_tip: string | null; ozbiljnost: string };

async function posaljiJedno(o: ZaSlanje) {
  const k = await vapid();
  const pretplate = await upit<{ id: string; endpoint: string; p256dh: string; auth: string }>(
    `select id, endpoint, p256dh, auth from push_pretplata where korisnik_id = $1`,
    [o.korisnik_id],
  );
  const sadrzaj = JSON.stringify({
    id: o.id,
    naslov: o.naslov.slice(0, 120),
    tekst: (o.poruka ?? "").slice(0, 300),
    url: (o.izvor_tip && PUTANJA[o.izvor_tip]) || "/",
    hitno: o.ozbiljnost === "VISOK",
  });
  for (const p of pretplate.rows) {
    if (!dozvoljenEndpoint(p.endpoint)) continue;
    try {
      const zahtjev = webpush.generateRequestDetails({ endpoint: p.endpoint, keys: { p256dh: p.p256dh, auth: p.auth } }, sadrzaj, {
        // Kontakt za push servis: na Renderu javna adresa servisa (Apple ne prima localhost).
        vapidDetails: { subject: process.env.VAPID_SUBJECT || process.env.RENDER_EXTERNAL_URL || "mailto:obavjestenja@localhost", publicKey: k.javni, privateKey: k.privatni },
        TTL: 60 * 60 * 12,
        urgency: o.ozbiljnost === "VISOK" ? "high" : "normal",
      });
      const odgovor = await fetch(zahtjev.endpoint, {
        method: zahtjev.method,
        headers: zahtjev.headers as Record<string, string>,
        body: zahtjev.body ? new Uint8Array(zahtjev.body) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
      if (odgovor.status === 404 || odgovor.status === 410) {
        await pool.query(`delete from push_pretplata where id = $1`, [p.id]); // uređaj je odjavio obavještenja ili ga više nema
      } else if (odgovor.ok) {
        await pool.query(`update push_pretplata set poslednje_slanje_at = now() where id = $1`, [p.id]);
      } else {
        console.error(`Push: ${new URL(p.endpoint).hostname} vratio ${odgovor.status}`);
      }
    } catch (e) {
      console.error("Push nije poslat:", (e as Error).message);
    }
  }
}

let radi = false;

/** Jedan krug: stara neposlata (> 1 h) se samo označe; nova se preuzmu i pošalju. U produkciji se
 * preuzimaju samo obavještenja korisnika sa pravom (https) pretplatom — lokalni server i testovi
 * nad istom demo bazom ne gube svoja zbog Rendera, niti Render njihova. */
export async function krugSlanja() {
  if (radi) return;
  radi = true;
  try {
    await pool.query(`update obavjestenje set push_poslato_at = now() where push_poslato_at is null and created_at < now() - interval '1 hour'`);
    const preuzeto = await pool.query<ZaSlanje>(
      `update obavjestenje o set push_poslato_at = now()
       where o.id in (
         select o2.id from obavjestenje o2
         where o2.push_poslato_at is null
           and exists (select 1 from push_pretplata p where p.korisnik_id = o2.korisnik_id and ($1::boolean or p.endpoint like 'https://%'))
         order by o2.created_at limit 50
         for update skip locked)
       returning o.id, o.korisnik_id, o.naslov, o.poruka, o.izvor_tip, o.ozbiljnost::text as ozbiljnost`,
      [!isProduction],
    );
    for (const o of preuzeto.rows) await posaljiJedno(o);
  } finally {
    radi = false;
  }
}

export async function pokreniSlanjePush() {
  if (!(await tabelaPostoji("push_pretplata"))) {
    console.error("Push obavještenja su isključena dok se ne pokrene dopuna 25 (npm run migriraj).");
    return;
  }
  setInterval(() => krugSlanja().catch((e) => console.error("Krug slanja push obavještenja:", (e as Error).message)), INTERVAL_MS).unref();
}
