// Service worker: obavještenja na telefonu (faza 4, nalaz A6) i rad bez interneta (talas 6, invarijanta #85).
//
// Bez mreže aplikacija se mora OTVORITI i pokazati posljednje podatke — vozač u podrumu kupca, magacioner
// u hladnjači. Upisi se ne čuvaju ovdje nego u samoj aplikaciji (src/lib/izlaz.ts), koja ih šalje kad se
// mreža vrati. Ovdje:
//  • fajlovi aplikacije — spisak `offline-spisak.json` pravi gradnja (vite.offline.ts); čuvaju se SVE strane,
//    i one koje radnik još nije otvorio. Nova verzija = nov keš, stari se briše.
//  • stranica: prvo mreža (novo izdanje se vidi odmah), bez mreže sačuvana.
//  • podaci (GET /api): prvo mreža, a bez mreže posljednji sačuvan odgovor, sa zaglavljem
//    `x-pilot-sacuvano` (kad je sačuvan) — aplikacija tada kaže da su podaci od tada.
//    Keš podataka briše aplikacija pri prijavi i odjavi (zajednički telefon).

const KES_APP = "pilot-app-";
const KES_API = "pilot-api-v1";
const KES_META = "pilot-meta";
const NAJVISE_API = 400;
const ROK_MREZE_MS = 8000;
// Ne čuva se: prijava, izvoz i bekap (veliko, tuđe), dnevnici, stanje čitanja otpremnice, push, zdravlje.
const BEZ_KESA = ["/api/auth/", "/api/izvoz", "/api/bekap", "/api/audit", "/api/greske", "/api/zdravlje", "/api/push/", "/api/van-mreze", "/api/prijem/otpremnica"];

self.addEventListener("install", (event) => {
  event.waitUntil(azurirajAplikaciju().catch(() => undefined).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await obrisiStareKeseve();
      await self.clients.claim();
    })(),
  );
});

let zadnjaProvjera = 0;

/** Novo izdanje (drugi spisak) → sačuva sve njegove fajlove u nov keš, pa obriše stari. */
async function azurirajAplikaciju() {
  zadnjaProvjera = Date.now();
  const odgovor = await fetch("/offline-spisak.json", { cache: "no-store" });
  if (!odgovor.ok) return; // razvoj (vite dev) — spiska nema
  const spisak = await odgovor.json();
  if (!spisak || !spisak.verzija || !Array.isArray(spisak.fajlovi)) return;
  const ime = KES_APP + spisak.verzija;
  if ((await trenutniKes()) === ime) return;
  const kes = await caches.open(ime);
  const rezultati = await Promise.all(
    spisak.fajlovi.map(async (putanja) => {
      if (await kes.match(putanja)) return true;
      try {
        const r = await fetch(putanja, { cache: "no-store" });
        if (!r.ok) return false;
        await kes.put(putanja, r);
        return true;
      } catch {
        return false;
      }
    }),
  );
  // Nepotpun keš se ne proglašava trenutnim — sljedeća provjera dopunjava ono što fali.
  if (rezultati.every(Boolean)) {
    const meta = await caches.open(KES_META);
    await meta.put("/__trenutni-kes", new Response(ime));
    await obrisiStareKeseve();
  }
}

async function trenutniKes() {
  const meta = await caches.open(KES_META);
  const r = await meta.match("/__trenutni-kes");
  return r ? r.text() : null;
}

async function obrisiStareKeseve() {
  const trenutni = await trenutniKes();
  if (!trenutni) return;
  const imena = await caches.keys();
  await Promise.all(imena.filter((i) => i.startsWith(KES_APP) && i !== trenutni).map((i) => caches.delete(i)));
}

function saRokom(obecanje, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("rok")), ms);
    obecanje.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function izKesaAplikacije(zahtjev) {
  return caches.match(zahtjev, { ignoreSearch: true });
}

self.addEventListener("fetch", (event) => {
  const zahtjev = event.request;
  if (zahtjev.method !== "GET") return;
  const url = new URL(zahtjev.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    if (BEZ_KESA.some((p) => url.pathname.startsWith(p))) return;
    event.respondWith(podaci(zahtjev));
    return;
  }
  if (zahtjev.mode === "navigate") {
    event.respondWith(stranica(zahtjev));
    // Novo izdanje se provjerava pri otvaranju strane, najviše jednom u 5 minuta.
    if (Date.now() - zadnjaProvjera > 5 * 60 * 1000) event.waitUntil(azurirajAplikaciju().catch(() => undefined));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    // Ime fajla nosi heš sadržaja — sačuvan fajl je uvijek tačan.
    event.respondWith(
      (async () => {
        const sacuvan = await caches.match(zahtjev);
        if (sacuvan) return sacuvan;
        const r = await fetch(zahtjev);
        if (r.ok) {
          const ime = await trenutniKes();
          if (ime) (await caches.open(ime)).put(zahtjev, r.clone()).catch(() => undefined);
        }
        return r;
      })(),
    );
    return;
  }
  // Ostalo iz public/ (obrasci, manifest, ikonice): mreža, a bez nje sačuvano.
  event.respondWith(fetch(zahtjev).catch(async () => (await izKesaAplikacije(zahtjev)) || Response.error()));
});

async function stranica(zahtjev) {
  try {
    return await saRokom(fetch(zahtjev), ROK_MREZE_MS);
  } catch {
    const sacuvana = await caches.match("/", { ignoreSearch: true });
    if (sacuvana) return sacuvana;
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PILOT</title>' +
        '<body style="font-family:sans-serif;padding:24px;background:#fff;color:#1f2a30"><h2>Nema interneta</h2>' +
        "<p>Aplikacija još nije sačuvana na ovom telefonu — otvorite je jednom dok ima signala, pa radi i bez njega.</p></body>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
}

async function podaci(zahtjev) {
  const kes = await caches.open(KES_API);
  const mreza = fetch(zahtjev).then(async (r) => {
    if (r.status === 200 && (r.headers.get("Content-Type") || "").includes("application/json")) {
      const zaglavlja = new Headers(r.headers);
      zaglavlja.set("x-pilot-sacuvano", new Date().toISOString());
      const tijelo = await r.clone().arrayBuffer();
      await kes.put(zahtjev, new Response(tijelo, { status: 200, headers: zaglavlja }));
      void skratiKes(kes);
    }
    return r;
  });
  try {
    return await saRokom(mreza, ROK_MREZE_MS);
  } catch {
    const sacuvan = await kes.match(zahtjev);
    if (sacuvan) return sacuvan;
    // Nema ni mreže ni sačuvanog — aplikacija dobija grešku mreže i kaže „nema veze“.
    return mreza;
  }
}

async function skratiKes(kes) {
  const kljucevi = await kes.keys();
  if (kljucevi.length <= NAJVISE_API) return;
  await Promise.all(kljucevi.slice(0, kljucevi.length - NAJVISE_API).map((k) => kes.delete(k)));
}

self.addEventListener("push", (event) => {
  let p = {};
  try {
    p = event.data ? event.data.json() : {};
  } catch {
    p = { naslov: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(p.naslov || "PILOT Distributeri CG", {
      body: p.tekst || "",
      icon: "/ikona-192.png",
      tag: p.id || undefined,
      data: { url: p.url || "/" },
      // Hitno (temperatura, povlačenje) ostaje na ekranu dok se ne pogleda.
      requireInteraction: !!p.hitno,
      lang: "sr",
    }),
  );
});

// Klik otvara stranu odakle je obavještenje došlo — u već otvorenoj aplikaciji ako je ima.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const prozori = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const prozor of prozori) {
        if (new URL(prozor.url).origin === self.location.origin) {
          await prozor.focus();
          if ("navigate" in prozor) await prozor.navigate(url).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});

// Pregledač ponekad sam zamijeni pretplatu (istekla) — javi serveru novu, da obavještenja ne prestanu tiho.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const { javniKljuc } = await fetch("/api/push/kljuc", { credentials: "same-origin" }).then((r) => r.json());
      const nova = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: uBajtove(javniKljuc) });
      await fetch("/api/push/pretplata", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "x-zahtjev-app": "1" },
        body: JSON.stringify(nova.toJSON()),
      });
    })().catch(() => undefined),
  );
});

function uBajtove(base64url) {
  const b64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}
