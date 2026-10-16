import { useEffect, useState } from "react";
import { api, ApiGreska } from "./api";

// Rad bez interneta (talas 6, invarijanta #85). Vozač u podrumu kupca i magacioner u hladnjači nemaju
// signal — upis (D1, predaja, mjerenje, dnevni zapis, prijava problema) se tada čuva NA TELEFONU i šalje
// sam čim se mreža vrati: redom kojim je urađen (D1 prije predaje), sa vremenom kad je stvarno urađen
// (`x-uradjeno-at`) i istim ključem zahtjeva (server ga ne upisuje dvaput). Ono što server tada odbije
// ne briše se tiho: prijavi se odgovornom licu (`/van-mreze/odbijeno`) i ostaje na telefonu dok ga
// radnik ne ukloni.

export type StavkaIzlaza = {
  kljuc: string;
  putanja: string;
  telo: unknown;
  /** Za ljude: „D1 — PG 123 AB“, „Predaja IS-2026-0012“. */
  opis: string;
  uradjenoAt: string;
  /** Na šta se odnosi, da lista pokaže „čeka mrežu“: `isporuka:<id>`, `vozilo:<id>`, `obrazac:<kod>`. */
  vezano?: string;
  pokusaji: number;
  stanje: "ceka" | "odbijeno";
  greska?: string;
  greskaKod?: string;
  /** Odbijen upis je prijavljen odgovornom licu (server je primio prijavu). */
  javljeno?: boolean;
};

export type IshodUpisa<T> = { poslato: true; rezultat: T } | { poslato: false };

/** Javlja listama da je upis sa telefona stigao na server — da se osvježe. */
export const IZLAZ_POSLAT = "pilot-izlaz-poslat";

const PREFIKS = "pilot-izlaz-v1:";
const PROVJERA_MS = 30_000;

let vlasnik: string | null = null;
let saljem = false;
/** Upravo poslato (vezano → kada): lista ga pokazuje kao poslato dok se sama ne osvježi — inače bi
 * „Potvrdi“ na trenutak ponovo iskočilo i predaja bi se mogla kliknuti drugi put. */
const nedavnoPoslato = new Map<string, number>();
const NEDAVNO_MS = 20_000;
const slusaoci = new Set<() => void>();
const javi = () => slusaoci.forEach((f) => f());

function procitaj(): StavkaIzlaza[] {
  if (!vlasnik) return [];
  try {
    const t = localStorage.getItem(PREFIKS + vlasnik);
    const n: unknown = t ? JSON.parse(t) : [];
    return Array.isArray(n) ? (n as StavkaIzlaza[]) : [];
  } catch {
    return [];
  }
}

function zapisi(lista: StavkaIzlaza[]): boolean {
  if (!vlasnik) return false;
  try {
    localStorage.setItem(PREFIKS + vlasnik, JSON.stringify(lista));
    return true;
  } catch {
    return false;
  } finally {
    javi();
  }
}

const izmijeni = (kljuc: string, promjena: Partial<StavkaIzlaza>) => zapisi(procitaj().map((s) => (s.kljuc === kljuc ? { ...s, ...promjena } : s)));

/** Mreža nije stigla do servera (ili je server trenutno nedostupan) — upis nije ni odbijen ni primljen. */
export const bezVeze = (e: unknown) =>
  e instanceof ApiGreska && (e.status === 0 || e.code === "SERVER_NEDOSTUPAN" || [502, 503, 504].includes(e.status));

/** Poziva AuthProvider: red je po korisniku — na zajedničkom telefonu svako šalje samo svoje. */
export function postaviVlasnikaIzlaza(korisnikId: string | null) {
  if (vlasnik === korisnikId) return;
  vlasnik = korisnikId;
  javi();
  if (korisnikId) void posaljiIzlaz();
}

/**
 * Upis sa terena: pošalje odmah, a bez mreže ga sačuva na telefonu. Greška koju je server stvarno
 * vratio (pogrešan unos, 4xx) ide nazad u formu kao i prije — čuva se samo ono što nije stiglo.
 */
export async function upisiIliSacuvaj<T>(putanja: string, telo: unknown, o: { kljuc: string; opis: string; vezano?: string }): Promise<IshodUpisa<T>> {
  const uradjenoAt = new Date().toISOString();
  const sacuvaj = () => {
    if (!vlasnik) return false;
    const lista = procitaj();
    if (lista.some((s) => s.kljuc === o.kljuc)) return true;
    return zapisi([...lista, { kljuc: o.kljuc, putanja, telo, opis: o.opis, vezano: o.vezano, uradjenoAt, pokusaji: 0, stanje: "ceka" }]);
  };
  if (typeof navigator !== "undefined" && navigator.onLine === false && sacuvaj()) return { poslato: false };
  try {
    return { poslato: true, rezultat: await api<T>(putanja, { telo, kljuc: o.kljuc }) };
  } catch (e) {
    // Zahtjev je možda stigao (odgovor se izgubio) — isti ključ pri ponovnom slanju vraća prvi rezultat.
    if (bezVeze(e) && sacuvaj()) return { poslato: false };
    throw e;
  }
}

async function javiOdbijeno(s: StavkaIzlaza) {
  try {
    await api("/van-mreze/odbijeno", {
      telo: { putanja: s.putanja, opis: s.opis, telo: s.telo, greskaKod: s.greskaKod, greskaPoruka: s.greska, uradjenoAt: s.uradjenoAt },
    });
    izmijeni(s.kljuc, { javljeno: true });
  } catch {
    // pokušava se ponovo pri sljedećem slanju
  }
}

/** Šalje sve što čeka, redom. Staje na prvom upisu koji nije stigao (mreža, server) — redoslijed se ne mijenja. */
export async function posaljiIzlaz(): Promise<void> {
  if (saljem || !vlasnik) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const ciji = vlasnik;
  saljem = true;
  javi();
  let poslato = 0;
  try {
    for (;;) {
      if (vlasnik !== ciji) break;
      const s = procitaj().find((x) => x.stanje === "ceka");
      if (!s) break;
      try {
        await api(s.putanja, { telo: s.telo, kljuc: s.kljuc, uradjenoAt: s.uradjenoAt });
        if (s.vezano) nedavnoPoslato.set(s.vezano, Date.now());
        zapisi(procitaj().filter((x) => x.kljuc !== s.kljuc));
        poslato += 1;
        window.dispatchEvent(new Event(IZLAZ_POSLAT));
      } catch (e) {
        const g = e instanceof ApiGreska ? e : null;
        // Nije stiglo ili se ne zna — pokušava se kasnije, istim redom.
        if (!g || bezVeze(g) || g.status >= 500 || g.status === 401 || g.code === "U_TOKU") {
          izmijeni(s.kljuc, { pokusaji: s.pokusaji + 1, greska: g?.message ?? "Slanje nije uspjelo.", greskaKod: g?.code });
          break;
        }
        // Server ga ne prima (npr. lot je u međuvremenu zadržan) — ne briše se, javlja se odgovornom licu.
        izmijeni(s.kljuc, { stanje: "odbijeno", greska: g.message, greskaKod: g.code, pokusaji: s.pokusaji + 1 });
        await javiOdbijeno({ ...s, greska: g.message, greskaKod: g.code });
      }
    }
    for (const s of procitaj().filter((x) => x.stanje === "odbijeno" && !x.javljeno)) await javiOdbijeno(s);
  } finally {
    saljem = false;
    javi();
    if (poslato > 0) window.setTimeout(javi, NEDAVNO_MS + 500);
  }
}

/** Radnik uklanja odbijen upis sa telefona kad ga je pogledao (odgovorno lice je već obaviješteno). */
export function ukloniIzIzlaza(kljuc: string) {
  zapisi(procitaj().filter((s) => !(s.kljuc === kljuc && s.stanje === "odbijeno")));
}

export function useIzlaz() {
  const [, osvjezi] = useState(0);
  useEffect(() => {
    const f = () => osvjezi((x) => x + 1);
    slusaoci.add(f);
    return () => {
      slusaoci.delete(f);
    };
  }, []);
  const sve = procitaj();
  return {
    cekaju: sve.filter((s) => s.stanje === "ceka"),
    odbijeno: sve.filter((s) => s.stanje === "odbijeno"),
    saljem,
    /** Upis vezan za ovo (npr. `isporuka:<id>`) čeka na telefonu. */
    ceka: (vezano: string) => sve.some((s) => s.stanje === "ceka" && s.vezano === vezano),
    /** …ili je upravo poslat, a lista se još nije osvježila. */
    upravoPoslato: (vezano: string) => Date.now() - (nedavnoPoslato.get(vezano) ?? 0) < NEDAVNO_MS,
  };
}

/** Jednom, pri pokretanju: šalje kad se mreža vrati, kad se aplikacija ponovo otvori i na 30 s dok nešto čeka. */
export function ukljuciSlanjeIzlaza() {
  const probaj = () => {
    if (procitaj().some((s) => s.stanje === "ceka" || !s.javljeno)) void posaljiIzlaz();
  };
  window.addEventListener("online", probaj);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") probaj();
  });
  window.setInterval(probaj, PROVJERA_MS);
  // Druga kartica istog pregledača je nešto dodala ili poslala.
  window.addEventListener("storage", (e) => {
    if (e.key?.startsWith(PREFIKS)) javi();
  });
}
