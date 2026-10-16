import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { pool, upit, transakcija } from "../db.js";
import { ApiGreska } from "../greske.js";
import { smijeDodijelitiUlogu, obrisiSveSesijeZaKorisnika, type Uloga } from "../auth.js";
import { hashLozinke, lozinkaJeDovoljnoDugacka, MINIMALNA_DUZINA_LOZINKE } from "../lozinke.js";
import { danasCG } from "../vrijeme.js";
import { logKreiranje, logIzmjenaReda, stanjeReda } from "./auditService.js";
import { sljedeciBroj } from "./brojeviService.js";

// Ljudi i nalozi: spisak zaposlenih (lice), plan obuke (Prilog 13) i nalozi za prijavu
// (faza 4: SQL iz rute u servis). Nalog i lice su dvije stvari (invarijanta #16).

type Izvrsilac = { id: string; uloga: Uloga };
const JEDINSTVEN = "23505";

/** Moja strana: svoja šifra i svoja knjižica. */
export async function mojeLice(korisnikId: string) {
  const r = await upit(`select * from v_lica where id = (select lice_id from korisnik where id = $1)`, [korisnikId]);
  return r.rows[0] ?? null;
}

/** Cijeli spisak (rokovi knjižica svih zaposlenih) — samo vodstvo (nalaz U1). */
export async function svaLica() {
  return (await upit(`select * from v_lica order by ime`)).rows;
}

const lozinkaZadataIliPredlog = (zadata: string | undefined) => {
  const z = zadata?.trim();
  if (z && !lozinkaJeDovoljnoDugacka(z)) {
    throw new ApiGreska(400, "LOZINKA_KRATKA", `Lozinka mora imati najmanje ${MINIMALNA_DUZINA_LOZINKE} znakova.`);
  }
  return z || crypto.randomBytes(9).toString("base64url").slice(0, MINIMALNA_DUZINA_LOZINKE + 2);
};

export type NoviNalog = { liceId?: string | null; korisnickoIme: string; uloga: Uloga; lozinka?: string };

/** Otvaranje naloga — jedno mjesto za „Novi nalog" i za „Novo lice + nalog". Radi u transakciji
 * pozivaoca, pa lice bez naloga (ili nalog bez lica) ne ostaje ako drugi korak padne. Lozinku može
 * da zada odgovorno lice; prazno = sistem je predloži. Svakako je privremena (invarijanta #28). */
async function otvoriNalogU(klijent: PoolClient, ulaz: NoviNalog, izvrsilac: Izvrsilac) {
  if (!smijeDodijelitiUlogu(izvrsilac.uloga, ulaz.uloga)) {
    throw new ApiGreska(403, "NEDOZVOLJENA_ULOGA", "Ne možete otvoriti nalog sa tom ulogom.");
  }
  const privremenaLozinka = lozinkaZadataIliPredlog(ulaz.lozinka);
  const korisnickoIme = ulaz.korisnickoIme.trim().toLowerCase();
  const zauzeto = await klijent.query(`select 1 from korisnik where korisnicko_ime = $1`, [korisnickoIme]);
  if (zauzeto.rows[0]) throw new ApiGreska(409, "KORISNICKO_IME_ZAUZETO", `Korisničko ime "${korisnickoIme}" je zauzeto — dodajte broj ili još jedno slovo prezimena.`);
  if (ulaz.liceId) {
    const vecIma = await klijent.query(`select korisnicko_ime from korisnik where lice_id = $1 and aktivan`, [ulaz.liceId]);
    if (vecIma.rows[0]) throw new ApiGreska(409, "LICE_IMA_NALOG", `Ovo lice već ima nalog (${vecIma.rows[0].korisnicko_ime}). Ako je zaboravio lozinku — "Nova lozinka" na kartici Nalozi.`);
  }
  try {
    const r = await klijent.query<{ id: string }>(
      `insert into korisnik (korisnicko_ime, lozinka_hash, uloga, lice_id) values ($1, $2, $3, $4) returning id`,
      [korisnickoIme, await hashLozinke(privremenaLozinka), ulaz.uloga, ulaz.liceId ?? null],
    );
    await logKreiranje(klijent, { korisnikId: izvrsilac.id, entitetTip: "korisnik", entitetId: r.rows[0].id, noveVrijednosti: { uloga: ulaz.uloga, liceId: ulaz.liceId ?? null } });
    return { id: r.rows[0].id, korisnickoIme, privremenaLozinka };
  } catch (e) {
    if ((e as { code?: string }).code === JEDINSTVEN) throw new ApiGreska(409, "KORISNICKO_IME_ZAUZETO", `Korisničko ime "${korisnickoIme}" je zauzeto.`);
    throw e;
  }
}

export const otvoriNalog = (ulaz: NoviNalog, izvrsilac: Izvrsilac) => transakcija((klijent) => otvoriNalogU(klijent, ulaz, izvrsilac));

type NovoLice = { ime: string; radnoMjesto?: string; rukujeHranom: boolean; sanitarnaKnjizicaBroj?: string; sanitarnaKnjizicaRok?: string };

/** Novo lice (šifra iz sljedeciBroj — invarijanta #34) i po želji odmah njegov nalog, u jednoj transakciji. */
export async function novoLice(ulaz: NovoLice, nalog: Omit<NoviNalog, "liceId"> | undefined, izvrsilac: Izvrsilac) {
  return transakcija(async (klijent) => {
    const sifra = await sljedeciBroj(klijent, "lice", "M", 2);
    const lice = await klijent.query<{ id: string }>(
      `insert into lice (ime, radno_mjesto, rukuje_hranom, sifra, sanitarna_knjizica_broj, sanitarna_knjizica_rok)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [ulaz.ime, ulaz.radnoMjesto ?? null, ulaz.rukujeHranom, sifra, ulaz.sanitarnaKnjizicaBroj ?? null, ulaz.sanitarnaKnjizicaRok ?? null],
    );
    await logKreiranje(klijent, { korisnikId: izvrsilac.id, entitetTip: "lice", entitetId: lice.rows[0].id, noveVrijednosti: ulaz });
    const otvoren = nalog ? await otvoriNalogU(klijent, { ...nalog, liceId: lice.rows[0].id }, izvrsilac) : null;
    return { id: lice.rows[0].id, sifra, nalog: otvoren && { korisnickoIme: otvoren.korisnickoIme, privremenaLozinka: otvoren.privremenaLozinka } };
  });
}

export async function izmijeniLice(liceId: string, ulaz: Partial<NovoLice> & { aktivan?: boolean }, korisnikId: string) {
  await transakcija(async (klijent) => {
    const prije = await stanjeReda(klijent, "lice", liceId, true);
    if (!prije) throw new ApiGreska(404, "LICE_NE_POSTOJI", "Zaposleni nije pronađen.");
    await klijent.query(
      `update lice set
         ime = coalesce($1, ime),
         radno_mjesto = coalesce($2, radno_mjesto),
         rukuje_hranom = coalesce($3, rukuje_hranom),
         sanitarna_knjizica_broj = coalesce($4, sanitarna_knjizica_broj),
         sanitarna_knjizica_rok = coalesce($5, sanitarna_knjizica_rok),
         aktivan = coalesce($6, aktivan),
         updated_at = now()
       where id = $7`,
      [ulaz.ime ?? null, ulaz.radnoMjesto ?? null, ulaz.rukujeHranom ?? null, ulaz.sanitarnaKnjizicaBroj ?? null, ulaz.sanitarnaKnjizicaRok ?? null, ulaz.aktivan ?? null, liceId],
    );
    await logIzmjenaReda(klijent, { korisnikId, entitetTip: "lice", entitetId: liceId, prije, poslije: await stanjeReda(klijent, "lice", liceId) });
  });
}

/** Samo ime i id aktivnih vozača — za izbor vozača pri pripremi isporuke. */
export async function vozaci() {
  const r = await upit(
    `select k.id, coalesce(l.ime, k.korisnicko_ime) as ime
     from korisnik k left join lice l on l.id = k.lice_id
     where k.uloga = 'vozac' and k.aktivan order by 2`,
  );
  return r.rows;
}

/** Godišnji plan obuke — Prilog 13 je plan, ne zapis (invarijanta #18). */
export async function planObuke() {
  return (await upit(`select * from v_plan_obuke order by planirani_datum`)).rows;
}

export async function dodajUPlanObuke(ulaz: { liceId: string; tema: string; planiraniDatum: string; napomena?: string }, korisnikId: string) {
  return transakcija(async (klijent) => {
    const r = await klijent.query<{ id: string }>(
      `insert into plan_obuke (lice_id, tema, planirani_datum, napomena) values ($1, $2, $3, $4) returning id`,
      [ulaz.liceId, ulaz.tema, ulaz.planiraniDatum, ulaz.napomena ?? null],
    );
    await logKreiranje(klijent, { korisnikId, entitetTip: "plan_obuke", entitetId: r.rows[0].id, noveVrijednosti: ulaz });
    return r.rows[0].id;
  });
}

export async function obukaObavljena(planId: string, datum: string | undefined, korisnikId: string) {
  await transakcija(async (klijent) => {
    const prije = await stanjeReda(klijent, "plan_obuke", planId, true);
    if (!prije) throw new ApiGreska(404, "STAVKA_NE_POSTOJI", "Stavka plana obuke nije pronađena.");
    await klijent.query(`update plan_obuke set obavljeno_datum = $1 where id = $2`, [datum ?? danasCG(), planId]);
    await logIzmjenaReda(klijent, { korisnikId, entitetTip: "plan_obuke", entitetId: planId, prije, poslije: await stanjeReda(klijent, "plan_obuke", planId) });
  });
}

export async function nalozi() {
  const r = await upit(
    `select k.id, k.korisnicko_ime, k.uloga, k.lozinka_stanje, k.aktivan, k.poslednja_prijava_at, l.ime as lice_ime,
            k.skladiste_id, s.naziv as skladiste_naziv
     from korisnik k left join lice l on l.id = k.lice_id left join skladiste s on s.id = k.skladiste_id
     order by k.uloga, k.korisnicko_ime`,
  );
  return r.rows;
}

/** bzr/izvodjac smiju da diraju samo nalog čija SADAŠNJA uloga smiju i da dodijele — bez ovoga bi
 * bzr mogao da promijeni ulogu ili deaktivira drugog bzr ili konsultanta (invarijanta #13), jer
 * smijeDodijelitiUlogu sama po sebi provjerava samo CILJNU ulogu, ne i trenutnu. */
async function provjeriMozeDaDirneNalog(izvrsilac: Izvrsilac, ciljId: string) {
  const cilj = await pool.query<{ uloga: Uloga }>(`select uloga from korisnik where id = $1`, [ciljId]);
  if (!cilj.rows[0]) throw new ApiGreska(404, "NALOG_NE_POSTOJI", "Nalog nije pronađen.");
  if (!smijeDodijelitiUlogu(izvrsilac.uloga, cilj.rows[0].uloga)) {
    throw new ApiGreska(403, "NEDOZVOLJEN_NALOG", "Nemate dozvolu da mijenjate ovaj nalog.");
  }
}

/** Promjena uloge briše sesije tog naloga — stara sesija nosi staru ulogu (invarijanta #27). */
export async function promijeniUlogu(ciljId: string, ciljUloga: Uloga, izvrsilac: Izvrsilac) {
  if (!smijeDodijelitiUlogu(izvrsilac.uloga, ciljUloga)) throw new ApiGreska(403, "NEDOZVOLJENA_ULOGA", "Ne možete dodijeliti tu ulogu.");
  await provjeriMozeDaDirneNalog(izvrsilac, ciljId);
  await transakcija(async (klijent) => {
    const prije = await stanjeReda(klijent, "korisnik", ciljId, true);
    await klijent.query(`update korisnik set uloga = $1, updated_at = now() where id = $2`, [ciljUloga, ciljId]);
    await obrisiSveSesijeZaKorisnika(ciljId, undefined, klijent);
    await logIzmjenaReda(klijent, { korisnikId: izvrsilac.id, entitetTip: "korisnik", entitetId: ciljId, prije, poslije: await stanjeReda(klijent, "korisnik", ciljId) });
  });
}

/** Zaboravljena lozinka: odgovorno lice postavlja NOVU privremenu — staru ne vidi niko, ni ono
 * (invarijanta #28). Sve prijave tog naloga se prekidaju, a pri sljedećoj se lozinka mora promijeniti. */
export async function novaLozinka(ciljId: string, zadata: string | undefined, izvrsilac: Izvrsilac) {
  if (ciljId === izvrsilac.id) throw new ApiGreska(409, "SVOJA_LOZINKA", "Svoju lozinku mijenjate na svojoj strani (Moja strana → Promjena lozinke).");
  await provjeriMozeDaDirneNalog(izvrsilac, ciljId);
  const privremenaLozinka = lozinkaZadataIliPredlog(zadata);
  await transakcija(async (klijent) => {
    const prije = await stanjeReda(klijent, "korisnik", ciljId, true);
    await klijent.query(
      `update korisnik set lozinka_hash = $1, lozinka_stanje = 'privremena', mora_promijeniti_lozinku = true, updated_at = now() where id = $2`,
      [await hashLozinke(privremenaLozinka), ciljId],
    );
    await obrisiSveSesijeZaKorisnika(ciljId, undefined, klijent);
    await logIzmjenaReda(klijent, {
      korisnikId: izvrsilac.id, entitetTip: "korisnik", entitetId: ciljId, prije, poslije: await stanjeReda(klijent, "korisnik", ciljId),
      dodatno: { lozinka: "postavljena nova privremena" },
    });
  });
  return privremenaLozinka;
}

export async function deaktivirajNalog(ciljId: string, izvrsilac: Izvrsilac) {
  await provjeriMozeDaDirneNalog(izvrsilac, ciljId);
  await transakcija(async (klijent) => {
    const prije = await stanjeReda(klijent, "korisnik", ciljId, true);
    await klijent.query(`update korisnik set aktivan = false, updated_at = now() where id = $1`, [ciljId]);
    await obrisiSveSesijeZaKorisnika(ciljId, undefined, klijent);
    await logIzmjenaReda(klijent, { korisnikId: izvrsilac.id, entitetTip: "korisnik", entitetId: ciljId, prije, poslije: await stanjeReda(klijent, "korisnik", ciljId) });
  });
}

/** Matično skladište naloga — samo podrazumijevani izbor u formama. Ista granica kao za ostale
 * izmjene naloga (invarijanta #13), osim što svako smije da postavi svoje. */
export async function postaviMaticnoSkladiste(ciljId: string, skladisteId: string | null, izvrsilac: Izvrsilac) {
  if (ciljId !== izvrsilac.id) await provjeriMozeDaDirneNalog(izvrsilac, ciljId);
  if (skladisteId) {
    const postoji = await pool.query(`select 1 from skladiste where id = $1 and aktivan`, [skladisteId]);
    if (!postoji.rows[0]) throw new ApiGreska(400, "SKLADISTE_NE_POSTOJI", "Izabrano skladište ne postoji ili više nije aktivno.");
  }
  await transakcija(async (klijent) => {
    const prije = await stanjeReda(klijent, "korisnik", ciljId, true);
    await klijent.query(`update korisnik set skladiste_id = $1 where id = $2`, [skladisteId, ciljId]);
    await logIzmjenaReda(klijent, { korisnikId: izvrsilac.id, entitetTip: "korisnik", entitetId: ciljId, prije, poslije: await stanjeReda(klijent, "korisnik", ciljId) });
  });
}
