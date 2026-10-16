import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { bezVeze, postaviVlasnikaIzlaza } from "./izlaz";

export type Uloga = "izvodjac" | "bzr" | "operater" | "vozac" | "uprava";

export type Korisnik = {
  id: string;
  korisnicko_ime: string;
  uloga: Uloga;
  lice_id: string | null;
  lice_ime: string | null;
  mora_promijeniti_lozinku: boolean;
  lozinka_stanje: string;
  /** Potvrda u dva koraka uključena (#81). */
  totp_ukljucen?: boolean;
  /** Za ulogu je 2FA obavezna na ovoj instanci, a nije uključena — ništa drugo se ne otvara dok je ne uključi. */
  mora2fa?: boolean;
};

/** Posle tačne lozinke nalog sa 2FA dobija izazov; sesija se daje tek uz kod. */
export type DrugiKorak = { izazov: string };

type AuthKontekst = {
  korisnik: Korisnik | null;
  ucitavanje: boolean;
  /** Vraća drugi korak kad nalog ima potvrdu u dva koraka; inače je korisnik prijavljen. */
  prijavi: (korisnickoIme: string, lozinka: string) => Promise<DrugiKorak | null>;
  potvrdiKod: (izazov: string, kod: string) => Promise<void>;
  odjavi: () => Promise<void>;
  osvjeziKorisnika: () => Promise<void>;
};

const Kontekst = createContext<AuthKontekst | null>(null);

// Bez mreže (talas 6, #85): aplikacija otvorena u podrumu ne smije izbaciti vozača na prijavu — pamti se
// ko je posljednji bio prijavljen na ovom telefonu (bez lozinke i bez sesije; sesija je kolačić koji
// JavaScript ne vidi). Server i dalje odlučuje: čim se mreža vrati, /auth/ja kaže da li sesija važi.
const ZAPAMCEN = "pilot-korisnik-van-mreze";
/** Keš podataka koji service worker drži za rad bez mreže (public/sw.js) — briše se pri prijavi i odjavi,
 * da na zajedničkom telefonu drugi radnik ne vidi tuđe liste. */
const KES_PODATAKA = "pilot-api-v1";

function zapamti(k: Korisnik | null) {
  try {
    if (k) localStorage.setItem(ZAPAMCEN, JSON.stringify(k));
    else localStorage.removeItem(ZAPAMCEN);
  } catch {
    // bez localStorage nema ni rada bez mreže — aplikacija radi kao i prije
  }
}

function zapamceni(): Korisnik | null {
  try {
    const t = localStorage.getItem(ZAPAMCEN);
    return t ? (JSON.parse(t) as Korisnik) : null;
  } catch {
    return null;
  }
}

async function obrisiKesPodataka() {
  try {
    if (typeof caches !== "undefined") await caches.delete(KES_PODATAKA);
  } catch {
    // nema keša — nema šta brisati
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [korisnik, setKorisnik] = useState<Korisnik | null>(null);
  const [ucitavanje, setUcitavanje] = useState(true);

  const osvjeziKorisnika = async () => {
    try {
      const odgovor = await api<{ korisnik: Korisnik }>("/auth/ja");
      if (zapamceni()?.id !== odgovor.korisnik.id) await obrisiKesPodataka();
      zapamti(odgovor.korisnik);
      setKorisnik(odgovor.korisnik);
    } catch (e) {
      if (bezVeze(e)) {
        setKorisnik(zapamceni());
        return;
      }
      zapamti(null);
      setKorisnik(null);
    }
  };

  useEffect(() => {
    osvjeziKorisnika().finally(() => setUcitavanje(false));
    // Mreža se vratila — da li sesija još važi (i ko je prijavljen) zna samo server.
    const kadSeVrati = () => void osvjeziKorisnika();
    window.addEventListener("online", kadSeVrati);
    return () => window.removeEventListener("online", kadSeVrati);
  }, []);

  useEffect(() => {
    postaviVlasnikaIzlaza(korisnik?.id ?? null);
  }, [korisnik?.id]);

  const prijavi = async (korisnickoIme: string, lozinka: string) => {
    const odgovor = await api<{ potreban2fa?: boolean; izazov?: string }>("/auth/prijava", { telo: { korisnickoIme, lozinka } });
    if (odgovor?.potreban2fa && odgovor.izazov) return { izazov: odgovor.izazov };
    await obrisiKesPodataka();
    await osvjeziKorisnika();
    return null;
  };

  const potvrdiKod = async (izazov: string, kod: string) => {
    await api("/auth/prijava/2fa", { telo: { izazov, kod } });
    await obrisiKesPodataka();
    await osvjeziKorisnika();
  };

  // Odjava traži mrežu: sesiju gasi server — bez toga bi se telefon „odjavio“, a kolačić ostao važeći.
  const odjavi = async () => {
    await api("/auth/odjava", { method: "POST" });
    zapamti(null);
    await obrisiKesPodataka();
    setKorisnik(null);
  };

  return <Kontekst.Provider value={{ korisnik, ucitavanje, prijavi, potvrdiKod, odjavi, osvjeziKorisnika }}>{children}</Kontekst.Provider>;
}

export function useAuth() {
  const kontekst = useContext(Kontekst);
  if (!kontekst) throw new Error("useAuth mora biti unutar AuthProvider-a.");
  return kontekst;
}

export const NAZIV_ULOGE: Record<Uloga, string> = {
  izvodjac: "Konsultant",
  bzr: "Odgovorno lice",
  operater: "Magacioner",
  vozac: "Vozač",
  uprava: "Uprava",
};
