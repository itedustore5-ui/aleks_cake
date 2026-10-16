import crypto from "node:crypto";

const MIN_DUZINA = 10;

// scrypt, talas 5: asinhrono (sinhrono heširanje je zaustavljalo CIJELI server pri svakoj prijavi) i
// dvostruko skuplje od podrazumijevanog (N = 2^15, 32 MiB po heširanju — staje u Render od 512 MB).
// Parametri se upisuju u heš, pa se kasnije mogu pojačati bez prekida: stari heš i dalje radi, a pri
// sljedećoj uspješnoj prijavi se tiho zamijeni novim (`trebaNoviHes`).
const N = 32768;
const R = 8;
const P = 1;
const MAXMEM = 64 * 1024 * 1024;
const DUZINA = 64;

function scrypt(lozinka: string, salt: string, opcije: crypto.ScryptOptions): Promise<Buffer> {
  return new Promise((ok, ne) => crypto.scrypt(lozinka, salt, DUZINA, opcije, (greska, kljuc) => (greska ? ne(greska) : ok(kljuc))));
}

/** Nov heš: `scrypt2$N$r$p$salt$heš`. */
export async function hashLozinke(lozinka: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const izvedeni = await scrypt(lozinka, salt, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt2$${N}$${R}$${P}$${salt}$${izvedeni.toString("hex")}`;
}

/** Provjera i novog (`scrypt2$…`) i starog formata (`scrypt$salt$heš`, podrazumijevani parametri). */
export async function provjeriLozinku(lozinka: string, sacuvaniHash: string): Promise<boolean> {
  const dijelovi = String(sacuvaniHash ?? "").split("$");
  let salt: string | undefined;
  let hes: string | undefined;
  let opcije: crypto.ScryptOptions = {};
  if (dijelovi[0] === "scrypt2" && dijelovi.length === 6) {
    const [, n, r, p] = dijelovi.map(Number);
    if (![n, r, p].every((x) => Number.isInteger(x) && x > 0) || n > 1 << 20) return false;
    opcije = { N: n, r, p, maxmem: MAXMEM * 4 };
    salt = dijelovi[4];
    hes = dijelovi[5];
  } else if (dijelovi[0] === "scrypt" && dijelovi.length === 3) {
    salt = dijelovi[1];
    hes = dijelovi[2];
  }
  if (!salt || !hes) return false;
  const sacuvani = Buffer.from(hes, "hex");
  const izvedeni = await scrypt(lozinka, salt, opcije);
  return sacuvani.length === izvedeni.length && crypto.timingSafeEqual(sacuvani, izvedeni);
}

/** Heš napravljen slabijim (starim) parametrima — pri uspješnoj prijavi zamijeniti novim. */
export function trebaNoviHes(sacuvaniHash: string): boolean {
  return !String(sacuvaniHash ?? "").startsWith(`scrypt2$${N}$${R}$${P}$`);
}

let lazniHes: Promise<string> | null = null;
/** Za nepostojeće korisničko ime: ista cijena kao prava provjera, da se po vremenu odgovora ne vidi
 * koje ime postoji. */
export async function lazniPokusaj(lozinka: string): Promise<false> {
  lazniHes ??= hashLozinke(crypto.randomBytes(16).toString("hex"));
  await provjeriLozinku(lozinka, await lazniHes);
  return false;
}

export function lozinkaJeDovoljnoDugacka(lozinka: string): boolean {
  return typeof lozinka === "string" && lozinka.length >= MIN_DUZINA;
}

export { MIN_DUZINA as MINIMALNA_DUZINA_LOZINKE };
