export class ApiGreska extends Error {
  code: string;
  details: Record<string, unknown>;
  status: number;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Opcije = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  telo?: unknown;
  /** Ključ zahtjeva (noviKljuc) — server isti ključ ne upisuje dvaput. */
  kljuc?: string;
  /** Samo za upis koji je čekao na telefonu bez mreže (#85): kad je stvarno urađen. */
  uradjenoAt?: string;
};

/** Service worker (public/sw.js) je bez mreže vratio posljednje sačuvane podatke — Layout to kaže. */
export const PODACI_SA_TELEFONA = "pilot-podaci-sa-telefona";

// Isti upis (metoda + adresa + tijelo) koji je već u toku ne šalje se ponovo — drugi klik dobija
// odgovor prvog (nalaz R-10). Čitanja (GET) se ne diraju.
const uToku = new Map<string, Promise<unknown>>();

export async function api<T = unknown>(putanja: string, opcije: Opcije = {}): Promise<T> {
  const metoda = opcije.method ?? (opcije.telo ? "POST" : "GET");
  if (metoda === "GET") return posalji<T>(putanja, metoda, opcije);
  const kljucMape = `${metoda} ${putanja} ${opcije.telo !== undefined ? JSON.stringify(opcije.telo) : ""}`;
  const vec = uToku.get(kljucMape);
  if (vec) return vec as Promise<T>;
  const zahtjev = posalji<T>(putanja, metoda, opcije).finally(() => uToku.delete(kljucMape));
  uToku.set(kljucMape, zahtjev);
  return zahtjev;
}

/** Koliko običan zahtjev najviše čeka odgovor. Slanje fajla ima svoj rok (posaljiFajl). */
const ROK_ZAHTJEVA_MS = 45_000;

async function posalji<T>(putanja: string, metoda: string, opcije: Opcije): Promise<T> {
  const zaglavlja: Record<string, string> = { "x-zahtjev-app": "1" };
  if (opcije.telo !== undefined) zaglavlja["Content-Type"] = "application/json";
  if (opcije.kljuc) zaglavlja["x-kljuc-zahtjeva"] = opcije.kljuc;
  if (opcije.uradjenoAt) zaglavlja["x-uradjeno-at"] = opcije.uradjenoAt;

  // Rok (talas 5): na slabom signalu zahtjev inače visi bez kraja, a dugme ostaje zaključano.
  const prekid = new AbortController();
  const tajmer = window.setTimeout(() => prekid.abort(), ROK_ZAHTJEVA_MS);
  let odgovor: Response;
  try {
    odgovor = await fetch(`/api${putanja}`, {
      method: metoda,
      credentials: "include",
      headers: zaglavlja,
      body: opcije.telo !== undefined ? JSON.stringify(opcije.telo) : undefined,
      signal: prekid.signal,
    });
  } catch {
    if (prekid.signal.aborted) {
      throw new ApiGreska(0, "ISTEKLO", "Server ne odgovara na vrijeme — provjerite internet pa pokušajte ponovo. Unos je ostao u formi.");
    }
    throw new ApiGreska(0, "NEMA_VEZE", "Nema veze sa serverom — provjerite internet pa pokušajte ponovo. Unos je ostao u formi.");
  } finally {
    window.clearTimeout(tajmer);
  }

  if (odgovor.status === 204) return undefined as T;
  const sacuvano = odgovor.headers.get("x-pilot-sacuvano");
  if (sacuvano) window.dispatchEvent(new CustomEvent(PODACI_SA_TELEFONA, { detail: sacuvano }));

  const tekst = await odgovor.text();
  let podaci: { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null = null;
  try {
    podaci = tekst ? JSON.parse(tekst) : null;
  } catch {
    // Render vraća HTML stranicu (502/503) dok se servis budi ili restartuje.
    throw new ApiGreska(odgovor.status, "SERVER_NEDOSTUPAN", "Server trenutno ne odgovara — pokušajte ponovo za minut. Unos je ostao u formi.");
  }

  if (!odgovor.ok) {
    const greska = podaci?.error;
    throw new ApiGreska(odgovor.status, greska?.code ?? "GRESKA", greska?.message ?? "Došlo je do greške.", greska?.details ?? {});
  }
  return podaci as T;
}

/** Šalje fajl (PDF, slika) kao sirovo tijelo zahtjeva — bez base64 naduvavanja. */
/** Šalje fajl. `rokMs` — posle toga se odustaje (slab signal u magacinu): bolje jasna poruka nego
 * beskonačno „učitavanje“. Odgovor koji nije JSON (npr. stranica proksija dok se server pokreće) daje
 * razumljivu poruku, ne grešku parsiranja. */
export async function posaljiFajl<T = unknown>(putanja: string, fajl: Blob, nazivFajla: string, rokMs = 90_000): Promise<T> {
  const prekid = new AbortController();
  const tajmer = setTimeout(() => prekid.abort(), rokMs);
  let odgovor: Response;
  try {
    odgovor = await fetch(`/api${putanja}`, {
      method: "POST",
      credentials: "include",
      headers: { "x-zahtjev-app": "1", "Content-Type": fajl.type || "application/octet-stream", "x-naziv-fajla": encodeURIComponent(nazivFajla) },
      body: fajl,
      signal: prekid.signal,
    });
  } catch (e) {
    clearTimeout(tajmer);
    if (prekid.signal.aborted) throw new ApiGreska(0, "ISTEKLO", "Slanje traje predugo — provjerite internet (Wi-Fi ili mobilni signal) pa pokušajte ponovo.");
    throw new ApiGreska(0, "NEMA_VEZE", "Nema veze sa serverom — provjerite internet pa pokušajte ponovo.");
  }
  clearTimeout(tajmer);
  const tekst = await odgovor.text();
  let podaci: { error?: { code?: string; message?: string; details?: Record<string, unknown> } } | null = null;
  try {
    podaci = tekst ? JSON.parse(tekst) : null;
  } catch {
    podaci = null;
  }
  if (!odgovor.ok) {
    const greska = podaci?.error;
    const opsta = [502, 503, 504].includes(odgovor.status) ? "Server trenutno ne odgovara (možda se ponovo pokreće) — pokušajte za minut." : `Slanje nije uspjelo (${odgovor.status}).`;
    throw new ApiGreska(odgovor.status, greska?.code ?? "GRESKA", greska?.message ?? opsta, greska?.details ?? {});
  }
  return podaci as T;
}

/** Otvara dokument (PDF, sliku) u novoj kartici — kroz fetch, da se greška vidi (invarijanta #31). */
export async function otvoriFajl(putanja: string) {
  const prozor = window.open("", "_blank");
  const odgovor = await fetch(`/api${putanja}`, { credentials: "include", headers: { "x-zahtjev-app": "1" } });
  if (!odgovor.ok) {
    prozor?.close();
    const podaci = await odgovor.json().catch(() => null);
    throw new ApiGreska(odgovor.status, podaci?.error?.code ?? "GRESKA", podaci?.error?.message ?? `Otvaranje nije uspjelo (${odgovor.status}).`);
  }
  const url = URL.createObjectURL(await odgovor.blob());
  if (prozor) prozor.location.href = url;
  else window.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Preuzimanje ide kroz fetch, ne kroz <a href> — obično preuzimanje koje padne ne prikaže
 * ništa (izgleda kao pokvareno dugme), a server je vratio 401/409/500 (invarijanta #31). */
export async function preuzmiFajl(putanja: string, nazivFajla: string) {
  const odgovor = await fetch(`/api${putanja}`, { credentials: "include", headers: { "x-zahtjev-app": "1" } });
  if (!odgovor.ok) {
    const podaci = await odgovor.json().catch(() => null);
    throw new ApiGreska(odgovor.status, podaci?.error?.code ?? "GRESKA", podaci?.error?.message ?? `Preuzimanje nije uspjelo (${odgovor.status}).`);
  }
  const blob = await odgovor.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nazivFajla;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
