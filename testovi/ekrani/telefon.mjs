// Zajedničko za testove ekrana: pregledač u veličini telefona, prijavljen kao demo nalog.
// Lozinka se nikad ne kuca u pregledač: prijava ide kroz API, pregledač dobija samo kolačić sesije.
import { chromium } from "playwright-core";
import { APP_URL, prijava, NALOZI } from "../pomoc.mjs";

const KANAL = process.env.PW_KANAL || "chrome";
let pregledac = null;

export async function pokreniPregledac() {
  try {
    pregledac = await chromium.launch({ channel: KANAL, headless: true });
  } catch (e) {
    throw new Error(`Pregledač (${KANAL}) se ne pokreće: ${e.message.split("\n")[0]}\nInstalirajte Google Chrome ili postavite PW_KANAL=msedge.`);
  }
}

export const zatvoriPregledac = () => pregledac?.close();

// Greške mreže su očekivane kad je telefon bez signala — nisu greške aplikacije.
const MREZNA_GRESKA = /ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|Failed to fetch|Failed to load resource|NetworkError/i;

/** Telefon prijavljen kao nalog iz NALOZI (ana, marko, petar, direktor, konsultant). */
export async function telefon(kljuc) {
  const api = await prijava(NALOZI[kljuc]);
  const [ime, ...vrijednost] = api.kolacic.split("=");
  const kontekst = await pregledac.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "sr-Latn-ME",
    timezoneId: "Europe/Podgorica",
    serviceWorkers: "allow",
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36",
  });
  await kontekst.addCookies([{ name: ime, value: vrijednost.join("="), url: APP_URL, httpOnly: true, sameSite: "Lax" }]);
  const strana = await kontekst.newPage();
  const greske = [];
  let bezMreze = false;
  strana.on("pageerror", (e) => greske.push(`greška na strani: ${e.message}`));
  strana.on("console", (p) => {
    if (p.type() !== "error") return;
    if (bezMreze && MREZNA_GRESKA.test(p.text())) return;
    greske.push(`konzola: ${p.text().slice(0, 200)}`);
  });
  return {
    api,
    kontekst,
    strana,
    greske,
    /** Telefon bez signala (false) i nazad (true). */
    async mreza(ima) {
      bezMreze = !ima;
      await kontekst.setOffline(!ima);
    },
    zatvori: () => kontekst.close(),
  };
}

/** Koliko je strana šira od ekrana i koji elementi vire (bez onih u sopstvenom skrolu, npr. tabela). */
export async function siroko(strana) {
  return strana.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const visak = document.documentElement.scrollWidth - w;
    if (visak <= 1) return { visak: 0, krivi: [] };
    const uSkrolu = (e) => {
      for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === "auto" || o === "scroll" || o === "hidden") return true;
      }
      return false;
    };
    const krivi = [...document.querySelectorAll("body *")]
      .filter((e) => e.getBoundingClientRect().right > w + 1 && !uSkrolu(e))
      .slice(0, 4)
      .map((e) => `${e.tagName.toLowerCase()}${typeof e.className === "string" && e.className ? "." + e.className.trim().split(/\s+/)[0] : ""}`);
    return { visak, krivi };
  });
}

/** Otvori stranu i sačekaj da se učita (naslov strane). */
export async function otvori(t, putanja) {
  await t.strana.goto(`${APP_URL}${putanja}`, { waitUntil: "domcontentloaded" });
  try {
    await t.strana.waitForSelector(".page-header h1", { timeout: 20_000 });
  } catch {
    const tekst = (await t.strana.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
    throw new Error(`strana se nije otvorila — adresa ${t.strana.url()}, na ekranu: „${tekst}“${t.greske.length ? `, greške: ${t.greske.slice(-3).join(" | ")}` : ""}`);
  }
  await t.strana.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
}

/** Snimak ekrana u folder iz EKRANI_SLIKE (ako je zadat) — za pregled očima, test ne zavisi od njega. */
export async function slikaj(strana, ime) {
  if (!process.env.EKRANI_SLIKE) return;
  await strana.screenshot({ path: `${process.env.EKRANI_SLIKE}/${ime}.png` }).catch(() => undefined);
}

/** Otvoren prozor (modal) sa datim naslovom. */
export const prozor = (strana, naslov) => strana.locator(".modal", { has: strana.locator("h2", { hasText: naslov }) });
