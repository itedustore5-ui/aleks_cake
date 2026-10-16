import crypto from "node:crypto";
import QRCode from "qrcode";

// Potvrda u dva koraka (talas 5, invarijanta #81): TOTP po RFC 6238 — 6 cifara, 30 s, HMAC-SHA1 — isti
// kod koji daju Google Authenticator, Microsoft Authenticator i slične aplikacije. Sve se računa na
// našem serveru; QR kod se crta ovdje (biblioteka qrcode), ništa ne ide spoljnom servisu.

const KORAK_S = 30;
const CIFARA = 6;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function uBase32(bajtovi: Buffer): string {
  let bitovi = 0;
  let vrijednost = 0;
  let izlaz = "";
  for (const b of bajtovi) {
    vrijednost = (vrijednost << 8) | b;
    bitovi += 8;
    while (bitovi >= 5) {
      izlaz += BASE32[(vrijednost >>> (bitovi - 5)) & 31];
      bitovi -= 5;
    }
  }
  if (bitovi > 0) izlaz += BASE32[(vrijednost << (5 - bitovi)) & 31];
  return izlaz;
}

function izBase32(tekst: string): Buffer {
  const cist = tekst.replace(/[\s=-]/g, "").toUpperCase();
  let bitovi = 0;
  let vrijednost = 0;
  const bajtovi: number[] = [];
  for (const znak of cist) {
    const i = BASE32.indexOf(znak);
    if (i < 0) throw new Error("Neispravna tajna");
    vrijednost = (vrijednost << 5) | i;
    bitovi += 5;
    if (bitovi >= 8) {
      bajtovi.push((vrijednost >>> (bitovi - 8)) & 255);
      bitovi -= 8;
    }
  }
  return Buffer.from(bajtovi);
}

/** Nova tajna: 20 nasumičnih bajtova (160 bita, preporuka RFC 4226). */
export const novaTajna = () => uBase32(crypto.randomBytes(20));

export const trenutniKorak = (sadaMs = Date.now()) => Math.floor(sadaMs / 1000 / KORAK_S);

/** Kod za zadati korak (vremenski prozor od 30 s). */
export function kodZaKorak(tajna: string, korak: number): string {
  const brojac = Buffer.alloc(8);
  brojac.writeBigUInt64BE(BigInt(korak));
  const hmac = crypto.createHmac("sha1", izBase32(tajna)).update(brojac).digest();
  const pomak = hmac[hmac.length - 1] & 0x0f;
  const broj = ((hmac[pomak] & 0x7f) << 24) | (hmac[pomak + 1] << 16) | (hmac[pomak + 2] << 8) | hmac[pomak + 3];
  return String(broj % 10 ** CIFARA).padStart(CIFARA, "0");
}

/** Provjera koda: dozvoljen je i prethodni i sljedeći prozor (sat na telefonu kasni/žuri do 30 s), ali
 * NIKAD korak koji je već iskorišćen (`zadnjiKorak`) — isti kod ne važi dvaput. Vraća iskorišćeni
 * korak (da se upiše u bazu) ili null. */
export function provjeriKod(tajna: string, kod: string, zadnjiKorak: number | null): number | null {
  const cist = String(kod ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(cist)) return null;
  const sada = trenutniKorak();
  for (const korak of [sada - 1, sada, sada + 1]) {
    if (zadnjiKorak != null && korak <= zadnjiKorak) continue;
    const ocekivan = kodZaKorak(tajna, korak);
    if (crypto.timingSafeEqual(Buffer.from(ocekivan), Buffer.from(cist))) return korak;
  }
  return null;
}

/** Adresa za aplikaciju-autentifikator. Izdavač nosi naziv firme: konsultant ima po jedan unos za svakog
 * klijenta i mora ih razlikovati u aplikaciji. */
export function otpauthAdresa(tajna: string, korisnickoIme: string, firma: string): string {
  const izdavac = `PILOT ${firma}`.trim().slice(0, 60);
  const oznaka = `${encodeURIComponent(izdavac)}:${encodeURIComponent(korisnickoIme)}`;
  return `otpauth://totp/${oznaka}?secret=${tajna}&issuer=${encodeURIComponent(izdavac)}&algorithm=SHA1&digits=${CIFARA}&period=${KORAK_S}`;
}

/** QR kod kao data: slika (SVG) — CSP dozvoljava img-src data:. */
export async function qrKod(adresa: string): Promise<string> {
  const svg = await QRCode.toString(adresa, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

// ── Rezervni kodovi: za izgubljen telefon. Svaki važi jednom; u bazi samo heš. ──
const ZNAKOVI_REZERVE = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // bez 0/O, 1/I/L
const normalizuj = (kod: string) => String(kod ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const hesRezervnog = (kod: string) => crypto.createHash("sha256").update(normalizuj(kod)).digest("hex");

export function noviRezervniKodovi(broj = 8): { kodovi: string[]; hesevi: string[] } {
  const kodovi = Array.from({ length: broj }, () => {
    const b = crypto.randomBytes(8);
    const znakovi = [...b].map((x) => ZNAKOVI_REZERVE[x % ZNAKOVI_REZERVE.length]).join("");
    return `${znakovi.slice(0, 4)}-${znakovi.slice(4, 8)}`;
  });
  return { kodovi, hesevi: kodovi.map(hesRezervnog) };
}

/** Da li je unos rezervni kod (8 slova/cifara), a ne 6 cifara iz aplikacije. */
export const izgledaKaoRezervni = (kod: string) => normalizuj(kod).length === 8 && !/^\d+$/.test(normalizuj(kod));
