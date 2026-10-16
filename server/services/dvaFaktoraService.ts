import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { pool, transakcija, upit } from "../db.js";
import { ApiGreska } from "../greske.js";
import { provjeriLozinku } from "../lozinke.js";
import {
  obrisiSveSesijeZaKorisnika,
  provjeriOgranicenjeLogina,
  zabiljeziNeuspjeliPokusaj,
  ocistiNeuspjelePokusaje,
  ULOGE_2FA,
  OBAVEZNA_2FA,
  type SesijskiKorisnik,
} from "../auth.js";
import { hesRezervnog, noviRezervniKodovi, novaTajna, otpauthAdresa, provjeriKod, qrKod } from "../dvaFaktora.js";
import { logSigurnosniDogadjaj } from "./auditService.js";

// Potvrda u dva koraka (invarijanta #81). Uključuje je SAM korisnik (samo vodstvo — terenske uloge ne,
// jer bi izgubljen telefon magacionera zaustavio prijem robe). Posle lozinke nalog sa 2FA dobija izazov
// (5 min, najviše 5 pokušaja), a sesiju tek uz kod iz aplikacije ili rezervni kod.

const TRAJANJE_IZAZOVA_MIN = 5;
const NAJVISE_POKUSAJA_IZAZOVA = 5;
const hes = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

type Red2fa = { korisnicko_ime: string; lozinka_hash: string; totp_tajna: string | null; totp_ukljucen_at: string | null; totp_zadnji_korak: string | null; totp_rezervni: string[] };

async function red2fa(korisnikId: string): Promise<Red2fa> {
  const r = (await upit<Red2fa>(`select korisnicko_ime, lozinka_hash, totp_tajna, totp_ukljucen_at, totp_zadnji_korak, totp_rezervni from korisnik where id = $1`, [korisnikId])).rows[0];
  if (!r) throw new ApiGreska(404, "NALOG_NE_POSTOJI", "Nalog nije pronađen.");
  return r;
}

/** Lozinka prijavljenog, sa istim ograničenjem pokušaja kao prijava (IP + ime) — 2FA se ne može
 * isključiti niti preuzeti sa tuđeg otključanog računara bez lozinke. */
async function potvrdiLozinku(korisnikId: string, lozinka: string, ip: string | undefined, radnja: string) {
  const r = await red2fa(korisnikId);
  const kljuc = `${ip || "nepoznato"}|${r.korisnicko_ime}`;
  provjeriOgranicenjeLogina(kljuc);
  if (!(await provjeriLozinku(lozinka, r.lozinka_hash))) {
    zabiljeziNeuspjeliPokusaj(kljuc);
    await logSigurnosniDogadjaj(pool, { korisnikId, entitetTip: "korisnik", entitetId: korisnikId, ipAdresa: ip ?? null, noveVrijednosti: { radnja: `${radnja} — pogrešna lozinka` } });
    throw new ApiGreska(403, "POGRESNA_LOZINKA", "Lozinka nije tačna.");
  }
  ocistiNeuspjelePokusaje(kljuc);
  return r;
}

export async function stanje2fa(korisnik: SesijskiKorisnik) {
  const r = await red2fa(korisnik.id);
  return {
    dozvoljeno: ULOGE_2FA.includes(korisnik.uloga),
    obavezno: OBAVEZNA_2FA.includes(korisnik.uloga),
    ukljuceno: !!r.totp_ukljucen_at,
    ukljucenoAt: r.totp_ukljucen_at,
    rezervnihPreostalo: r.totp_ukljucen_at ? r.totp_rezervni.length : 0,
  };
}

/** Korak 1: lozinka → nova tajna i QR kod. Dok se ne potvrdi kodom, 2FA NIJE uključena. */
export async function zapocni2fa(korisnik: SesijskiKorisnik, lozinka: string, ip: string | undefined) {
  if (!ULOGE_2FA.includes(korisnik.uloga)) throw new ApiGreska(403, "NEDOZVOLJENO", "Potvrda u dva koraka je za odgovorno lice, konsultanta i upravu.");
  const r = await potvrdiLozinku(korisnik.id, lozinka, ip, "uključivanje potvrde u dva koraka");
  if (r.totp_ukljucen_at) throw new ApiGreska(409, "DVA_FAKTORA_VEC_UKLJUCEN", "Potvrda u dva koraka je već uključena. Za novi telefon je prvo isključite.");
  const tajna = novaTajna();
  await upit(`update korisnik set totp_tajna = $1, totp_ukljucen_at = null, totp_zadnji_korak = null, totp_rezervni = '{}' where id = $2`, [tajna, korisnik.id]);
  const firma = (await upit<{ naziv: string }>(`select naziv from firma order by created_at limit 1`)).rows[0]?.naziv ?? "";
  const adresa = otpauthAdresa(tajna, korisnik.korisnicko_ime, firma);
  return { tajna, otpauth: adresa, qr: await qrKod(adresa) };
}

/** Korak 2: kod iz aplikacije potvrđuje da je telefon podešen → 2FA uključena, rezervni kodovi se
 * prikazuju JEDNOM. Ostali uređaji se odjavljuju (moraju se prijaviti uz kod). */
export async function potvrdi2fa(korisnik: SesijskiKorisnik, kod: string, ip: string | undefined, trenutniToken?: string) {
  return transakcija(async (klijent) => {
    const r = (await klijent.query<Red2fa>(`select korisnicko_ime, lozinka_hash, totp_tajna, totp_ukljucen_at, totp_zadnji_korak, totp_rezervni from korisnik where id = $1 for update`, [korisnik.id])).rows[0];
    if (!r?.totp_tajna || r.totp_ukljucen_at) throw new ApiGreska(409, "NIJE_ZAPOCETO", "Prvo počnite uključivanje (lozinka pa QR kod).");
    const korak = provjeriKod(r.totp_tajna, kod, null);
    if (korak == null) throw new ApiGreska(400, "POGRESAN_KOD", "Kod nije tačan. Upišite 6 cifara koje aplikacija trenutno pokazuje (provjerite i sat na telefonu).");
    const { kodovi, hesevi } = noviRezervniKodovi();
    await klijent.query(`update korisnik set totp_ukljucen_at = now(), totp_zadnji_korak = $1, totp_rezervni = $2 where id = $3`, [korak, hesevi, korisnik.id]);
    await logSigurnosniDogadjaj(klijent, { korisnikId: korisnik.id, entitetTip: "korisnik", entitetId: korisnik.id, ipAdresa: ip ?? null, noveVrijednosti: { radnja: "potvrda u dva koraka uključena" } });
    await obrisiSveSesijeZaKorisnika(korisnik.id, trenutniToken, klijent);
    return { rezervniKodovi: kodovi };
  });
}

/** Isključivanje: lozinka + kod (iz aplikacije ili rezervni). Izgubljen telefon bez rezervnih kodova →
 * konsultant sa svog računara: `npm run iskljuci-2fa -- --korisnik ime`. */
export async function iskljuci2fa(korisnik: SesijskiKorisnik, lozinka: string, kod: string, ip: string | undefined) {
  await potvrdiLozinku(korisnik.id, lozinka, ip, "isključivanje potvrde u dva koraka");
  await transakcija(async (klijent) => {
    const r = (await klijent.query<Red2fa>(`select korisnicko_ime, lozinka_hash, totp_tajna, totp_ukljucen_at, totp_zadnji_korak, totp_rezervni from korisnik where id = $1 for update`, [korisnik.id])).rows[0];
    if (!r?.totp_ukljucen_at) throw new ApiGreska(409, "DVA_FAKTORA_NIJE_UKLJUCEN", "Potvrda u dva koraka nije uključena.");
    if (!(await iskoristiKod(klijent, korisnik.id, r, kod))) throw new ApiGreska(400, "POGRESAN_KOD", "Kod nije tačan.");
    await klijent.query(`update korisnik set totp_tajna = null, totp_ukljucen_at = null, totp_zadnji_korak = null, totp_rezervni = '{}' where id = $1`, [korisnik.id]);
    await logSigurnosniDogadjaj(klijent, { korisnikId: korisnik.id, entitetTip: "korisnik", entitetId: korisnik.id, ipAdresa: ip ?? null, noveVrijednosti: { radnja: "potvrda u dva koraka isključena" } });
  });
}

/** Kod iz aplikacije (6 cifara, jednom po koraku) ili rezervni kod (jednom). Upisuje iskorišćeno. */
async function iskoristiKod(klijent: Pick<PoolClient, "query">, korisnikId: string, r: Red2fa, kod: string): Promise<boolean> {
  if (!r.totp_tajna) return false;
  const cist = String(kod ?? "").trim();
  if (/^\d{6}$/.test(cist.replace(/\s/g, ""))) {
    const korak = provjeriKod(r.totp_tajna, cist, r.totp_zadnji_korak == null ? null : Number(r.totp_zadnji_korak));
    if (korak == null) return false;
    await klijent.query(`update korisnik set totp_zadnji_korak = $1 where id = $2`, [korak, korisnikId]);
    return true;
  }
  const h = hesRezervnog(cist);
  if (!r.totp_rezervni.includes(h)) return false;
  await klijent.query(`update korisnik set totp_rezervni = array_remove(totp_rezervni, $1) where id = $2`, [h, korisnikId]);
  return true;
}

// ── Drugi korak prijave ──

export async function kreirajIzazov(korisnikId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  await upit(`delete from prijava_izazov where korisnik_id = $1 or istice_at < now()`, [korisnikId]);
  await upit(`insert into prijava_izazov (token_hash, korisnik_id, istice_at) values ($1, $2, now() + $3 * interval '1 minute')`, [hes(token), korisnikId, TRAJANJE_IZAZOVA_MIN]);
  return token;
}

/** Izazov + kod → id korisnika (sesiju pravi ruta). Pogrešan kod troši pokušaj izazova i broji se u
 * ograničenje prijave (IP + ime), pa se kod ne može pogađati. */
export async function potvrdiIzazov(izazov: string, kod: string, ip: string | undefined): Promise<{ korisnikId: string; korisnickoIme: string }> {
  const hIzazova = hes(String(izazov ?? ""));
  // Ishod se odlučuje u transakciji, a greška se baca POSLIJE nje — inače bi rollback poništio i
  // brojanje pokušaja i zapis u auditu.
  const ishod = await transakcija(async (klijent) => {
    const iz = (await klijent.query<{ korisnik_id: string; pokusaji: number; istekao: boolean }>(
      `select korisnik_id, pokusaji, istice_at < now() as istekao from prijava_izazov where token_hash = $1 for update`, [hIzazova],
    )).rows[0];
    if (!iz || iz.istekao || iz.pokusaji >= NAJVISE_POKUSAJA_IZAZOVA) {
      if (iz) await klijent.query(`delete from prijava_izazov where token_hash = $1`, [hIzazova]);
      return { status: "istekao" as const };
    }
    const r = (await klijent.query<Red2fa & { aktivan: boolean }>(
      `select korisnicko_ime, lozinka_hash, totp_tajna, totp_ukljucen_at, totp_zadnji_korak, totp_rezervni, aktivan from korisnik where id = $1 for update`, [iz.korisnik_id],
    )).rows[0];
    const kljuc = `${ip || "nepoznato"}|${r?.korisnicko_ime ?? ""}`;
    provjeriOgranicenjeLogina(kljuc);
    if (!r?.aktivan || !r.totp_ukljucen_at || !(await iskoristiKod(klijent, iz.korisnik_id, r, kod))) {
      zabiljeziNeuspjeliPokusaj(kljuc);
      await klijent.query(`update prijava_izazov set pokusaji = pokusaji + 1 where token_hash = $1`, [hIzazova]);
      await logSigurnosniDogadjaj(klijent, { korisnikId: iz.korisnik_id, entitetTip: "korisnik", entitetId: iz.korisnik_id, ipAdresa: ip ?? null, noveVrijednosti: { radnja: "prijava — pogrešan kod potvrde u dva koraka" } });
      return { status: "pogresno" as const };
    }
    ocistiNeuspjelePokusaje(kljuc);
    await klijent.query(`delete from prijava_izazov where token_hash = $1`, [hIzazova]);
    return { status: "ok" as const, korisnikId: iz.korisnik_id, korisnickoIme: r.korisnicko_ime };
  });
  if (ishod.status === "istekao") throw new ApiGreska(401, "IZAZOV_ISTEKAO", "Prijava je istekla — upišite ponovo korisničko ime i lozinku.");
  if (ishod.status === "pogresno") throw new ApiGreska(401, "POGRESAN_KOD", "Kod nije tačan. Upišite 6 cifara iz aplikacije ili jedan rezervni kod.");
  return { korisnikId: ishod.korisnikId, korisnickoIme: ishod.korisnickoIme };
}
