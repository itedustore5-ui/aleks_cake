import { api } from "./api";

// Obavještenja na telefon (faza 4). Pretplata je po UREĐAJU: uključuje se na svakom telefonu
// posebno, i to na Mojoj strani. Sadržaj ide šifrovan kroz push servis pregledača.

export type StanjePush =
  | "nepodrzano" // pregledač nema push (stari telefon, ili iPhone van početnog ekrana)
  | "iphone-dodaj" // iPhone: prvo „Dodaj na početni ekran", pa otvoriti odatle
  | "blokirano" // korisnik je odbio dozvolu — mijenja se u podešavanjima pregledača
  | "iskljuceno"
  | "ukljuceno";

const jeIphone = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const saPocetnogEkrana = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

export function registrujServiceWorker() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}

async function registracija() {
  return navigator.serviceWorker.ready;
}

export async function stanjePush(): Promise<StanjePush> {
  const podrzano = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!podrzano) return jeIphone() && !saPocetnogEkrana() ? "iphone-dodaj" : "nepodrzano";
  if (Notification.permission === "denied") return "blokirano";
  const pretplata = await (await registracija()).pushManager.getSubscription();
  return pretplata ? "ukljuceno" : "iskljuceno";
}

function uBajtove(base64url: string) {
  const b64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Traži dozvolu, pravi pretplatu u pregledaču i predaje je serveru. */
export async function ukljuciPush(): Promise<StanjePush> {
  const dozvola = await Notification.requestPermission();
  if (dozvola !== "granted") return dozvola === "denied" ? "blokirano" : "iskljuceno";
  const { javniKljuc } = await api<{ javniKljuc: string }>("/push/kljuc");
  const reg = await registracija();
  const pretplata = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: uBajtove(javniKljuc) }));
  const json = pretplata.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api("/push/pretplata", { telo: { endpoint: json.endpoint, keys: json.keys, uredjaj: navigator.userAgent.slice(0, 200) } });
  return "ukljuceno";
}

export async function iskljuciPush(): Promise<StanjePush> {
  const pretplata = await (await registracija()).pushManager.getSubscription();
  if (pretplata) {
    await api("/push/odjava", { telo: { endpoint: pretplata.endpoint } }).catch(() => undefined);
    await pretplata.unsubscribe();
  }
  return "iskljuceno";
}
