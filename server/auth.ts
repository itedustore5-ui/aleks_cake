import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { PoolClient } from "pg";
import { pool, upit } from "./db.js";
import { ApiGreska, posalji } from "./greske.js";
import { danaUnazad, jeDatumUBuducnosti } from "./vrijeme.js";

export type Uloga = "izvodjac" | "bzr" | "operater" | "vozac" | "uprava";

export type SesijskiKorisnik = {
  id: string;
  korisnicko_ime: string;
  uloga: Uloga;
  lice_id: string | null;
  lice_ime: string | null;
  mora_promijeniti_lozinku: boolean;
  lozinka_stanje: string;
  /** Potvrda u dva koraka uključena (#81). */
  totp_ukljucen: boolean;
};

export type AuthZahtjev = Request & { korisnik?: SesijskiKorisnik };

const SESIJA_KOLACIC = "pilot_sesija";
const TRAJANJE_SESIJE_MS = 8 * 60 * 60 * 1000;
const isProduction = process.env.NODE_ENV === "production";

const neuspjeliPokusaji = new Map<string, { pokusaji: number; resetAt: number }>();

export const noviToken = () => crypto.randomBytes(32).toString("base64url");

// Sesije su u bazi (sesija_prijave), ne u memoriji — deploy i restart više ne odjavljuju ljude.
// U bazi je samo heš tokena: ko pročita tabelu, ne može se njome prijaviti.
const hesTokena = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export async function kreirajSesiju(korisnikId: string): Promise<string> {
  const token = noviToken();
  await upit(`insert into sesija_prijave (token_hash, korisnik_id, istice_at) values ($1, $2, now() + $3 * interval '1 millisecond')`, [
    hesTokena(token),
    korisnikId,
    TRAJANJE_SESIJE_MS,
  ]);
  return token;
}

export async function obrisiSesiju(token: string) {
  await upit(`delete from sesija_prijave where token_hash = $1`, [hesTokena(token)]);
}

/** Promjena uloge i deaktivacija brišu sesije — stara sesija nosi staru ulogu (invarijanta #27).
 * `osimTokena`: promjena lozinke odjavljuje sve DRUGE uređaje, a ne onaj na kom je promijenjena. */
export async function obrisiSveSesijeZaKorisnika(korisnikId: string, osimTokena?: string, klijent: Pick<PoolClient, "query"> = pool) {
  await klijent.query(`delete from sesija_prijave where korisnik_id = $1 and ($2::text is null or token_hash <> $2)`, [
    korisnikId,
    osimTokena ? hesTokena(osimTokena) : null,
  ]);
}

/** Pri pokretanju: tabela sesija mora postojati i prije nego što se pokrene dopuna 20 — inače
 * deploy prije dopune zaključa SVE korisnike van aplikacije. Isti DDL kao db/20_sesije_prijave_cg.sql.
 * Istekle sesije se čiste jednom na sat. */
export async function pripremiSesije() {
  await upit(`create table if not exists sesija_prijave (
    token_hash text primary key,
    korisnik_id uuid not null references korisnik (id),
    istice_at timestamptz not null,
    created_at timestamptz not null default now()
  )`);
  const ocisti = () => upit(`delete from sesija_prijave where istice_at < now()`).catch((e) => console.error("Čišćenje sesija nije uspjelo:", e));
  await ocisti();
  setInterval(ocisti, 60 * 60 * 1000).unref();
}

const vrijednostKolacica = (request: Request, naziv: string) => {
  const zaglavlje = request.headers.cookie || "";
  const dio = zaglavlje.split(";").map((deo) => deo.trim()).find((deo) => deo.startsWith(`${naziv}=`));
  return dio ? decodeURIComponent(dio.slice(naziv.length + 1)) : undefined;
};

export function postaviSesijskiKolacic(response: Response, token: string) {
  response.setHeader(
    "Set-Cookie",
    `${SESIJA_KOLACIC}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TRAJANJE_SESIJE_MS / 1000}${isProduction ? "; Secure" : ""}`,
  );
}

export function obrisiSesijskiKolacic(response: Response) {
  response.setHeader("Set-Cookie", `${SESIJA_KOLACIC}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isProduction ? "; Secure" : ""}`);
}

export function tokenIzZahtjeva(request: Request) {
  return vrijednostKolacica(request, SESIJA_KOLACIC);
}

export async function ucitajKorisnikaPoSesiji(token: string | undefined): Promise<SesijskiKorisnik | undefined> {
  if (!token) return undefined;
  const rezultat = await upit<SesijskiKorisnik & { aktivan: boolean }>(
    `select k.id, k.korisnicko_ime, k.uloga, k.lice_id, k.mora_promijeniti_lozinku, k.lozinka_stanje,
            k.aktivan, l.ime as lice_ime, k.totp_ukljucen_at is not null as totp_ukljucen
     from sesija_prijave s
     join korisnik k on k.id = s.korisnik_id
     left join lice l on l.id = k.lice_id
     where s.token_hash = $1 and s.istice_at > now()`,
    [hesTokena(token)],
  );
  const red = rezultat.rows[0];
  if (!red || !red.aktivan) return undefined;
  return red;
}

/** Uloge koje smiju uključiti potvrdu u dva koraka (#81): nalozi koji vide sve podatke firme. Terenske
 * ne — izgubljen telefon magacionera ne smije zaustaviti prijem robe. */
export const ULOGE_2FA: Uloga[] = ["izvodjac", "bzr", "uprava"];
/** Kome je 2FA OBAVEZNA na ovoj instanci: env OBAVEZNA_2FA="izvodjac,bzr" (podrazumijevano nikome). */
export const OBAVEZNA_2FA: Uloga[] = String(process.env.OBAVEZNA_2FA ?? "")
  .split(",").map((u) => u.trim()).filter((u): u is Uloga => (ULOGE_2FA as string[]).includes(u));
/** Dok obavezna 2FA nije uključena, nalog smije samo ovo: da vidi ko je, da je uključi, da promijeni
 * lozinku i da javi grešku ekrana. */
const BEZ_2FA_DOZVOLJENO = new Set(["/auth/ja", "/auth/2fa", "/auth/2fa/pocni", "/auth/2fa/potvrdi", "/auth/promijeni-lozinku", "/greske/pregledac"]);
export const mora2fa = (k: SesijskiKorisnik) => OBAVEZNA_2FA.includes(k.uloga) && !k.totp_ukljucen;

export const requireAuth = async (request: AuthZahtjev, response: Response, next: NextFunction) => {
  const korisnik = await ucitajKorisnikaPoSesiji(tokenIzZahtjeva(request));
  if (!korisnik) {
    posalji(response, 401, "NEPRIJAVLJEN", "Prijava je potrebna.");
    return;
  }
  if (mora2fa(korisnik) && !BEZ_2FA_DOZVOLJENO.has(request.path)) {
    posalji(response, 403, "DVA_FAKTORA_OBAVEZNA", "Za vašu ulogu je obavezna potvrda u dva koraka — uključite je na Mojoj strani.");
    return;
  }
  request.korisnik = korisnik;
  next();
};

export const SVE_ULOGE: Uloga[] = ["izvodjac", "bzr", "uprava", "operater", "vozac"];

/** Uloge se pišu na SVAKOJ ruti (nalaz A3, faza 4). Funkcija nosi svoj spisak (`uloge`), pa
 * `provjeriRute()` pri pokretanju servera vidi rutu kojoj je zaboravljen. */
export const requireUloga = (...uloge: Uloga[]) =>
  Object.assign(
    (request: AuthZahtjev, response: Response, next: NextFunction) => {
      if (!request.korisnik || !uloge.includes(request.korisnik.uloga)) {
        posalji(response, 403, "NEDOZVOLJENO", "Vaša uloga nema pristup ovoj funkciji.");
        return;
      }
      next();
    },
    { uloge },
  );

/** Svaki prijavljeni korisnik — izričito, da se vidi da je odluka donesena, a ne zaboravljena. */
export const sviPrijavljeni = () => requireUloga(...SVE_ULOGE);

/** Zaštita od CSRF-a: state-changing zahtjevi moraju nositi ovo zaglavlje. Cross-site forme i
 * <img>/<script> pozivi ga ne mogu postaviti bez CORS dozvole koju server ne daje. */
export const zahtjevAppZaglavlje = (request: Request, response: Response, next: NextFunction) => {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    next();
    return;
  }
  if (request.headers["x-zahtjev-app"] !== "1") {
    posalji(response, 403, "NEDOSTAJE_ZAGLAVLJE", "Zahtjev nije prepoznat kao dolazak iz aplikacije.");
    return;
  }
  next();
};

export function provjeriOgranicenjeLogina(kljucKlijenta: string) {
  const stanje = neuspjeliPokusaji.get(kljucKlijenta);
  if (stanje && stanje.resetAt > Date.now() && stanje.pokusaji >= 8) {
    throw new ApiGreska(429, "PREVISE_POKUSAJA", "Previše neuspješnih pokušaja. Pokušajte ponovo za nekoliko minuta.");
  }
}

export function zabiljeziNeuspjeliPokusaj(kljucKlijenta: string) {
  const stanje = neuspjeliPokusaji.get(kljucKlijenta);
  const sljedeci = stanje && stanje.resetAt > Date.now() ? stanje : { pokusaji: 0, resetAt: Date.now() + 10 * 60 * 1000 };
  sljedeci.pokusaji += 1;
  neuspjeliPokusaji.set(kljucKlijenta, sljedeci);
}

export function ocistiNeuspjelePokusaje(kljucKlijenta: string) {
  neuspjeliPokusaji.delete(kljucKlijenta);
}

/** Koliko dana unazad smije da unosi/vidi svaka uloga — stoji na serveru, ne u pregledaču. */
export const PROZOR: Record<Uloga, number> = {
  operater: 1,
  vozac: 1,
  bzr: 7,
  izvodjac: 30,
  uprava: 7,
};

export const NA_TERENU: Uloga[] = ["operater", "vozac"];

/** Kolona se prosljeđuje kao argument — pogledi imaju različita imena (datum, datum_prijema...). */
export function ogranicenjeDatuma(uloga: Uloga, kolona: string) {
  const dani = PROZOR[uloga];
  // Dan po podgoričkom vremenu (invarijanta #11) — current_date u bazi je UTC, pa bi između ponoći
  // i 1–2h jutarnji unos od juče ispao iz prozora operatera.
  return `${kolona} >= (now() at time zone 'Europe/Podgorica')::date - ${dani}`;
}

const KO_UNOSI_STARIJE: Partial<Record<Uloga, string>> = {
  operater: "odgovorno lice",
  vozac: "odgovorno lice",
  bzr: "konsultant",
  uprava: "konsultant",
};

/** Invarijanta #9 pri UPISU (ne samo pri čitanju liste): datum ne smije biti u budućnosti
 * ni stariji od prozora uloge. Bez ovoga je zapis mogao nastati "noć prije inspekcije". */
export function provjeriProzorUpisa(uloga: Uloga, datum: string) {
  if (jeDatumUBuducnosti(datum)) {
    throw new ApiGreska(400, "DATUM_U_BUDUCNOSTI", "Datum ne može biti u budućnosti.");
  }
  const dani = PROZOR[uloga];
  if (danaUnazad(datum) > dani) {
    const ko = KO_UNOSI_STARIJE[uloga];
    throw new ApiGreska(
      400,
      "DATUM_VAN_PROZORA",
      `Upis je dozvoljen najviše ${dani} ${dani === 1 ? "dan" : "dana"} unazad${ko ? ` — stariji zapis unosi ${ko}` : ""}.`,
    );
  }
}

/** Operater/vozač ne mogu upisati tuđe ime kao izvršioca — server ga uvijek postavi na njihovo. */
export function izvrsilacZa(korisnik: SesijskiKorisnik, poslatoIme: string | undefined | null): string {
  if (NA_TERENU.includes(korisnik.uloga)) {
    return korisnik.lice_ime ?? korisnik.korisnicko_ime;
  }
  const ime = (poslatoIme ?? "").trim();
  return ime.length > 0 ? ime : (korisnik.lice_ime ?? korisnik.korisnicko_ime);
}

export function samoMoje(uloga: Uloga): boolean {
  return NA_TERENU.includes(uloga);
}

/** bzr otvara naloge samo ulozi operater/vozac; izvodjac otvara bilo koju osim izvodjac. */
export function smijeDodijelitiUlogu(izvrsiocevaUloga: Uloga, ciljUloga: Uloga): boolean {
  if (izvrsiocevaUloga === "izvodjac") return ciljUloga !== "izvodjac";
  if (izvrsiocevaUloga === "bzr") return ciljUloga === "operater" || ciljUloga === "vozac";
  return false;
}
