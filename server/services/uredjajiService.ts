// Frižideri, vitrina i zamrzivač — kako ih vidi vlasnica (29.10.2026, „Prvi koraci“): naziv, vrsta i granica, bez
// šifara. Ispod je isto što konsultant radi u HACCP planu: svaki uređaj je kontrolna tačka KKT2… sa opštim pravilom
// (#39, verzionisano) i dnevnim mjerenjem u planu (2×). Šifru bira server (KKT2, KKT2-F2, KKT2-V, KKT2-Z2…).
import type { PoolClient } from "pg";
import { upit } from "../db.js";
import { ApiGreska } from "../greske.js";
import { logIzmjena, logKreiranje } from "./auditService.js";
import { UREDJAJI, predlogTeksta, vrstaPoSifri, type VrstaUredjaja } from "./haccpPredlog.js";

export type UredjajCuvanja = {
  id: string;
  sifra: string;
  naziv: string;
  vrsta: VrstaUredjaja;
  aktivan: boolean;
  min: number | null;
  max: number | null;
  u_planu: boolean;
  mjereno: boolean;
};

const nazivStavke = (naziv: string, sifra: string) => `Temperatura — ${naziv} (${sifra})`;

export async function uredjajiCuvanja(): Promise<UredjajCuvanja[]> {
  const r = await upit<Omit<UredjajCuvanja, "vrsta">>(
    `select kt.id, kt.sifra, kt.naziv, kt.aktivan,
            p.min_vrijednost::float as min, p.max_vrijednost::float as max,
            exists (select 1 from plan_monitoringa pm where pm.kontrolna_tacka_id = kt.id and pm.aktivan) as u_planu,
            exists (select 1 from mjerenje_temperature m where m.kontrolna_tacka_id = kt.id) as mjereno
     from kontrolna_tacka kt
     left join pravilo_kontrole p on p.kontrolna_tacka_id = kt.id and p.artikal_id is null and p.aktivan
     where kt.sifra like 'KKT2%'
     order by kt.aktivan desc, kt.sifra`,
  );
  return r.rows.map((u) => ({ ...u, vrsta: vrstaPoSifri(u.sifra)! }));
}

/** Opšte pravilo tačke — nova verzija samo kad se granica stvarno promijeni (stara ostaje sa `vazi_do`). */
async function postaviGranicu(klijent: PoolClient, korisnikId: string, tacka: { id: string; sifra: string; naziv: string }, min: number, max: number) {
  const staro = (await klijent.query<{ id: string; verzija: number; min: number | null; max: number | null }>(
    `select id, verzija, min_vrijednost::float as min, max_vrijednost::float as max from pravilo_kontrole
     where kontrolna_tacka_id = $1 and artikal_id is null and aktivan for update`,
    [tacka.id],
  )).rows[0];
  if (staro && staro.min === min && staro.max === max) return false;
  if (staro) await klijent.query(`update pravilo_kontrole set aktivan = false, vazi_do = now() where id = $1`, [staro.id]);
  const r = await klijent.query<{ id: string }>(
    `insert into pravilo_kontrole (kontrolna_tacka_id, naziv, min_vrijednost, max_vrijednost, jedinica, ozbiljnost, verzija)
     values ($1, $2, $3, $4, '°C', 'VISOK', $5) returning id`,
    [tacka.id, `${tacka.naziv} — opšta granica`, min, max, (staro?.verzija ?? 0) + 1],
  );
  await logKreiranje(klijent, {
    korisnikId, entitetTip: "pravilo_kontrole", entitetId: r.rows[0].id,
    noveVrijednosti: { tacka: tacka.sifra, min, max, ...(staro ? { prethodno: { min: staro.min, max: staro.max } } : {}) },
  });
  return true;
}

/** Dnevno mjerenje 2× — samo kad plan već postoji (inače „Predloži osnovni plan“ uvrštava sve uređaje). */
async function uvrstiUPlan(klijent: PoolClient, korisnikId: string, tacka: { id: string; sifra: string; naziv: string }) {
  const plan = (await klijent.query(`select 1 from plan_monitoringa where aktivan limit 1`)).rows[0];
  if (!plan) return false;
  const vec = (await klijent.query(`select 1 from plan_monitoringa where kontrolna_tacka_id = $1 and aktivan limit 1`, [tacka.id])).rows[0];
  if (vec) return false;
  const r = await klijent.query<{ id: string }>(
    `insert into plan_monitoringa (naziv, vrsta, kontrolna_tacka_id, ucestalost, puta, uloga, napomena, created_by)
     values ($1, 'mjerenje', $2, 'DNEVNO', 2, 'operater', 'Jutro i popodne.', $3) returning id`,
    [nazivStavke(tacka.naziv, tacka.sifra), tacka.id, korisnikId],
  );
  await logKreiranje(klijent, { korisnikId, entitetTip: "plan_monitoringa", entitetId: r.rows[0].id, noveVrijednosti: { tacka: tacka.sifra, ucestalost: "DNEVNO", puta: 2 } });
  return true;
}

async function nazivZauzet(klijent: PoolClient, naziv: string, osim?: string) {
  const r = await klijent.query(
    `select 1 from kontrolna_tacka where sifra like 'KKT2%' and lower(btrim(naziv)) = lower(btrim($1)) and ($2::uuid is null or id <> $2) limit 1`,
    [naziv, osim ?? null],
  );
  return r.rows.length > 0;
}

export async function dodajUredjaj(klijent: PoolClient, korisnikId: string, ulaz: { naziv: string; vrsta: VrstaUredjaja; min: number; max: number }) {
  const cfg = UREDJAJI[ulaz.vrsta];
  if (await nazivZauzet(klijent, ulaz.naziv)) throw new ApiGreska(409, "UREDJAJ_POSTOJI", `„${ulaz.naziv}“ već postoji — dajte drugom uređaju drugo ime (npr. „${cfg.naziv} 2“).`);
  const sifre = new Set((await klijent.query<{ sifra: string }>(`select sifra from kontrolna_tacka where sifra like 'KKT2%'`)).rows.map((x) => x.sifra));
  let sifra = cfg.osnovna;
  for (let n = 2; sifre.has(sifra); n++) sifra = `${cfg.prefiks}${n}`;
  const tekst = predlogTeksta(sifra);
  const r = await klijent.query<{ id: string }>(
    `insert into kontrolna_tacka (sifra, naziv, opis, opasnost, korektivna_mjera, verifikacija) values ($1, $2, $3, $4, $5, $6) returning id`,
    [sifra, ulaz.naziv, cfg.opis, tekst.opasnost, tekst.korektivnaMjera, tekst.verifikacija],
  );
  const tacka = { id: r.rows[0].id, sifra, naziv: ulaz.naziv };
  await logKreiranje(klijent, { korisnikId, entitetTip: "kontrolna_tacka", entitetId: tacka.id, noveVrijednosti: { sifra, naziv: ulaz.naziv, vrsta: ulaz.vrsta } });
  await postaviGranicu(klijent, korisnikId, tacka, ulaz.min, ulaz.max);
  const uPlanu = await uvrstiUPlan(klijent, korisnikId, tacka);
  return { id: tacka.id, sifra, uPlanu };
}

/** Novo ime, nova granica (nova verzija pravila), isključen („nemamo ga više“) ili ponovo uključen. */
export async function izmijeniUredjaj(klijent: PoolClient, korisnikId: string, id: string, ulaz: { naziv?: string; min?: number; max?: number; aktivan?: boolean }) {
  const t = (await klijent.query<{ id: string; sifra: string; naziv: string; aktivan: boolean }>(
    `select id, sifra, naziv, aktivan from kontrolna_tacka where id = $1 and sifra like 'KKT2%' for update`,
    [id],
  )).rows[0];
  if (!t) throw new ApiGreska(404, "UREDJAJ_NE_POSTOJI", "Uređaj nije pronađen.");
  const prije = { naziv: t.naziv, aktivan: t.aktivan };
  const naziv = ulaz.naziv?.trim();
  if (naziv && naziv !== t.naziv) {
    if (await nazivZauzet(klijent, naziv, t.id)) throw new ApiGreska(409, "UREDJAJ_POSTOJI", `„${naziv}“ već postoji — izaberite drugo ime.`);
    await klijent.query(`update kontrolna_tacka set naziv = $2 where id = $1`, [t.id, naziv]);
    // Stavka plana nosi ime uređaja — zaposleni na Mojoj strani vidi isto ime kao na frižideru.
    await klijent.query(`update plan_monitoringa set naziv = $3, updated_at = now() where kontrolna_tacka_id = $1 and naziv = $2`, [t.id, nazivStavke(t.naziv, t.sifra), nazivStavke(naziv, t.sifra)]);
    t.naziv = naziv;
  }
  if (ulaz.min !== undefined && ulaz.max !== undefined) await postaviGranicu(klijent, korisnikId, t, ulaz.min, ulaz.max);
  if (ulaz.aktivan === false && t.aktivan) {
    await klijent.query(`update kontrolna_tacka set aktivan = false where id = $1`, [t.id]);
    await klijent.query(`update plan_monitoringa set aktivan = false, updated_at = now() where kontrolna_tacka_id = $1 and aktivan`, [t.id]);
    t.aktivan = false;
  } else if (ulaz.aktivan === true && !t.aktivan) {
    await klijent.query(`update kontrolna_tacka set aktivan = true where id = $1`, [t.id]);
    t.aktivan = true;
    await uvrstiUPlan(klijent, korisnikId, t);
  }
  if (prije.naziv !== t.naziv || prije.aktivan !== t.aktivan) {
    await logIzmjena(klijent, { korisnikId, entitetTip: "kontrolna_tacka", entitetId: t.id, stareVrijednosti: prije, noveVrijednosti: { naziv: t.naziv, aktivan: t.aktivan } });
  }
}
