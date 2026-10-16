import type { PoolClient } from "pg";
import { pool, upit, transakcija } from "../db.js";
import { ApiGreska } from "../greske.js";
import type { Uloga } from "../auth.js";
import { logKreiranje, logIzmjenaReda, stanjeReda } from "./auditService.js";

// Odakle je zadatak ili obavještenje došlo (izvor_tip + izvor_id). ISTI spisak stoji kao CHECK u
// db/22_integritet_cg.sql, proširen u 24_haccp_sistem_cg.sql (nalaz B2) — nov izvor se dodaje na OBA mjesta, inače upis pada u bazi.
// Ranije je izvor bio slobodan tekst: greška u kucanju je prolazila, a veza je pokazivala u prazno.
export const IZVORI_ZADATKA = ["neusaglasenost", "povlacenje", "rucno", "verifikacija_sistema"] as const;
export const IZVORI_OBAVJESTENJA = ["neusaglasenost", "povlacenje", "lot", "prijem", "isporuka", "zadatak", "poruka", "bekap_log", "mjerni_uredjaj", "verifikacija_sistema"] as const;
export type IzvorZadatka = (typeof IZVORI_ZADATKA)[number];
export type IzvorObavjestenja = (typeof IZVORI_OBAVJESTENJA)[number];

type NoviZadatakInput = {
  naslov: string;
  opis?: string;
  dodijeljenoKorisnikId?: string | null;
  prioritet?: "NIZAK" | "SREDNJI" | "VISOK";
  rokAt?: string | null;
  izvorTip?: IzvorZadatka;
  izvorId?: string;
  createdBy?: string | null;
};

export async function kreirajZadatak(klijent: PoolClient | typeof pool, ulaz: NoviZadatakInput) {
  const rezultat = await klijent.query<{ id: string }>(
    `insert into zadatak (naslov, opis, dodijeljeno_korisnik_id, prioritet, rok_at, izvor_tip, izvor_id, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      ulaz.naslov,
      ulaz.opis ?? null,
      ulaz.dodijeljenoKorisnikId ?? null,
      ulaz.prioritet ?? "SREDNJI",
      ulaz.rokAt ?? null,
      ulaz.izvorTip ?? null,
      ulaz.izvorId ?? null,
      ulaz.createdBy ?? null,
    ],
  );
  return rezultat.rows[0].id;
}

type NovoObavjestenjeInput = {
  korisnikId: string;
  naslov: string;
  poruka?: string;
  ozbiljnost?: "NIZAK" | "SREDNJI" | "VISOK";
  izvorTip?: IzvorObavjestenja;
  izvorId?: string;
};

export async function kreirajObavjestenje(klijent: PoolClient | typeof pool, ulaz: NovoObavjestenjeInput) {
  await klijent.query(
    `insert into obavjestenje (korisnik_id, naslov, poruka, ozbiljnost, izvor_tip, izvor_id)
     values ($1, $2, $3, $4, $5, $6)`,
    [ulaz.korisnikId, ulaz.naslov, ulaz.poruka ?? null, ulaz.ozbiljnost ?? "SREDNJI", ulaz.izvorTip ?? null, ulaz.izvorId ?? null],
  );
}

/** Automatski zadatak živi koliko i ono iz čega je nastao — kad se zatvori neusaglašenost ili
 * povlačenje, njegov zadatak se zatvara sam. Inače bi ostao da visi kao "zakašnjeo" zauvijek. */
export async function zatvoriZadatkeIzvora(klijent: PoolClient | typeof pool, izvorTip: IzvorZadatka, izvorId: string) {
  await klijent.query(
    `update zadatak set status = 'ZAVRSEN', zavrseno_at = now()
     where izvor_tip = $1 and izvor_id = $2 and status not in ('ZAVRSEN', 'OTKAZAN')`,
    [izvorTip, izvorId],
  );
}

/** Obavijesti sve aktivne korisnike zadate uloge (npr. bzr kad nastane kritična NC). */
export async function obavijestiUlogu(klijent: PoolClient | typeof pool, uloga: string, ulaz: Omit<NovoObavjestenjeInput, "korisnikId">) {
  const korisnici = await klijent.query<{ id: string }>(`select id from korisnik where uloga = $1 and aktivan`, [uloga]);
  for (const red of korisnici.rows) {
    await kreirajObavjestenje(klijent, { ...ulaz, korisnikId: red.id });
  }
}

// ── Zadaci i obavještenja za strane (faza 4: SQL iz ruta u servis) ──

type Korisnik = { id: string; uloga: Uloga };
const vodiSistem = (uloga: Uloga) => uloga === "bzr" || uloga === "izvodjac";

/** Automatski zadaci (iz neusaglašenosti, povlačenja, kontrole vozila) nastaju NEDODIJELJENI —
 * odgovorno lice ih vidi kao svoje dok ih ne dodijeli nekome. Terenske uloge vide samo ono što
 * je dodijeljeno baš njima; uprava gleda sve, ali ne zatvara tuđe. */
export async function listaZadataka(korisnik: Korisnik, samoMojiTrazeno: boolean) {
  const samoMoji = samoMojiTrazeno || (!vodiSistem(korisnik.uloga) && korisnik.uloga !== "uprava");
  const r = await upit(
    `select z.*, coalesce(l.ime, k.korisnicko_ime) as dodijeljeno,
            case z.izvor_tip when 'neusaglasenost' then nc.broj when 'povlacenje' then pv.broj end as izvor_oznaka,
            (z.rok_at is not null and z.rok_at < now()) as zakasnio
     from zadatak z
     left join korisnik k on k.id = z.dodijeljeno_korisnik_id
     left join lice l on l.id = k.lice_id
     left join neusaglasenost nc on z.izvor_tip = 'neusaglasenost' and nc.id = z.izvor_id
     left join povlacenje pv on z.izvor_tip = 'povlacenje' and pv.id = z.izvor_id
     where z.status not in ('ZAVRSEN', 'OTKAZAN')
       and ($1::boolean is false or z.dodijeljeno_korisnik_id = $2 or ($3::boolean and z.dodijeljeno_korisnik_id is null))
     order by (z.prioritet = 'VISOK') desc, z.rok_at nulls last, z.created_at desc`,
    [samoMoji, korisnik.id, vodiSistem(korisnik.uloga)],
  );
  return r.rows;
}

/** Kome se zadatak može dodijeliti — svi aktivni nalozi, sa imenom sa spiska zaposlenih. */
export async function izvrsioci() {
  const r = await upit(
    `select k.id, coalesce(l.ime, k.korisnicko_ime) as ime, k.uloga
     from korisnik k left join lice l on l.id = k.lice_id
     where k.aktivan order by coalesce(l.ime, k.korisnicko_ime)`,
  );
  return r.rows;
}

async function provjeriAktivanNalog(klijent: PoolClient | typeof pool, korisnikId: string) {
  const cilj = await klijent.query(`select 1 from korisnik where id = $1 and aktivan`, [korisnikId]);
  if (!cilj.rows[0]) throw new ApiGreska(400, "NALOG_NIJE_AKTIVAN", "Zadatak se može dodijeliti samo aktivnom nalogu.");
}

type RucniZadatak = { naslov: string; opis?: string; dodijeljenoKorisnikId?: string | null; prioritet: "NIZAK" | "SREDNJI" | "VISOK"; rok?: string };

/** Ručni zadatak — ono što ne nastaje samo iz sistema („očisti komoru 2 do petka"). */
export async function kreirajRucniZadatak(ulaz: RucniZadatak, korisnikId: string) {
  return transakcija(async (klijent) => {
    if (ulaz.dodijeljenoKorisnikId) await provjeriAktivanNalog(klijent, ulaz.dodijeljenoKorisnikId);
    // Rok je kraj tog dana po podgoričkom vremenu — „do petka" znači do kraja petka.
    const rokAt = ulaz.rok
      ? (await klijent.query<{ rok: string }>(`select (($1::date + time '23:59') at time zone 'Europe/Podgorica')::text as rok`, [ulaz.rok])).rows[0].rok
      : null;
    const id = await kreirajZadatak(klijent, {
      naslov: ulaz.naslov,
      opis: ulaz.opis || undefined,
      dodijeljenoKorisnikId: ulaz.dodijeljenoKorisnikId ?? null,
      prioritet: ulaz.prioritet,
      rokAt,
      izvorTip: "rucno",
      createdBy: korisnikId,
    });
    if (ulaz.dodijeljenoKorisnikId && ulaz.dodijeljenoKorisnikId !== korisnikId) {
      await kreirajObavjestenje(klijent, {
        korisnikId: ulaz.dodijeljenoKorisnikId,
        naslov: `Dodijeljen vam je zadatak: ${ulaz.naslov}`,
        poruka: [ulaz.opis, ulaz.rok ? `Rok: ${ulaz.rok}.` : ""].filter(Boolean).join(" ") || undefined,
        ozbiljnost: ulaz.prioritet === "VISOK" ? "VISOK" : "SREDNJI",
        izvorTip: "zadatak",
        izvorId: id,
      });
    }
    await logKreiranje(klijent, { korisnikId, entitetTip: "zadatak", entitetId: id, noveVrijednosti: ulaz });
    return id;
  });
}

type IzmjenaZadatka = { status?: "OTVOREN" | "U_TOKU" | "ZAVRSEN" | "OTKAZAN"; dodijeljenoKorisnikId?: string | null };

/** Dodjela, obavještenje i promjena statusa su jedna radnja: ranije je dodjela ostajala upisana
 * i kad je provjera statusa odmah zatim odbila zahtjev. */
export async function izmijeniZadatak(zadatakId: string, ulaz: IzmjenaZadatka, korisnik: Korisnik) {
  await transakcija(async (klijent) => {
    const zadatak = await klijent.query<{ naslov: string; opis: string | null; dodijeljeno_korisnik_id: string | null }>(
      `select naslov, opis, dodijeljeno_korisnik_id from zadatak where id = $1 for update`,
      [zadatakId],
    );
    const red = zadatak.rows[0];
    if (!red) throw new ApiGreska(404, "ZADATAK_NE_POSTOJI", "Zadatak nije pronađen.");
    const prije = await stanjeReda(klijent, "zadatak", zadatakId);

    if (ulaz.dodijeljenoKorisnikId !== undefined) {
      if (!vodiSistem(korisnik.uloga)) throw new ApiGreska(403, "NEDOZVOLJENO", "Zadatke dodjeljuje odgovorno lice.");
      if (ulaz.dodijeljenoKorisnikId) await provjeriAktivanNalog(klijent, ulaz.dodijeljenoKorisnikId);
      await klijent.query(`update zadatak set dodijeljeno_korisnik_id = $1 where id = $2`, [ulaz.dodijeljenoKorisnikId, zadatakId]);
      if (ulaz.dodijeljenoKorisnikId && ulaz.dodijeljenoKorisnikId !== korisnik.id && ulaz.dodijeljenoKorisnikId !== red.dodijeljeno_korisnik_id) {
        await kreirajObavjestenje(klijent, {
          korisnikId: ulaz.dodijeljenoKorisnikId,
          naslov: `Dodijeljen vam je zadatak: ${red.naslov}`,
          poruka: red.opis ?? undefined,
          ozbiljnost: "SREDNJI",
          izvorTip: "zadatak",
          izvorId: zadatakId,
        });
      }
    }

    if (ulaz.status !== undefined) {
      const dodijeljeno = ulaz.dodijeljenoKorisnikId !== undefined ? ulaz.dodijeljenoKorisnikId : red.dodijeljeno_korisnik_id;
      if (!vodiSistem(korisnik.uloga) && dodijeljeno !== korisnik.id) {
        throw new ApiGreska(403, "NIJE_VAS_ZADATAK", "Ovaj zadatak nije dodijeljen vama.");
      }
      await klijent.query(
        `update zadatak set status = $1::zadatak_status_t, zavrseno_at = case when $1::zadatak_status_t = 'ZAVRSEN' then now() else zavrseno_at end where id = $2`,
        [ulaz.status, zadatakId],
      );
    }
    // Ko je kome prebacio zadatak i ko ga je zatvorio — bez ovoga se to nije vidjelo nigdje (R-06).
    await logIzmjenaReda(klijent, { korisnikId: korisnik.id, entitetTip: "zadatak", entitetId: zadatakId, prije, poslije: await stanjeReda(klijent, "zadatak", zadatakId) });
  });
}

export async function obavjestenjaKorisnika(korisnikId: string) {
  const r = await upit(
    `select o.*, case when o.izvor_tip = 'poruka' then coalesce(l.ime, k.korisnicko_ime) end as posiljalac,
            case when o.izvor_tip = 'poruka' then p.posiljalac_korisnik_id end as posiljalac_korisnik_id
     from obavjestenje o
     left join poruka p on o.izvor_tip = 'poruka' and p.id = o.izvor_id
     left join korisnik k on k.id = p.posiljalac_korisnik_id
     left join lice l on l.id = k.lice_id
     where o.korisnik_id = $1 order by o.created_at desc limit 50`,
    [korisnikId],
  );
  return r.rows;
}

export async function procitajSvaObavjestenja(korisnikId: string) {
  await pool.query(`update obavjestenje set procitano_at = now() where korisnik_id = $1 and procitano_at is null`, [korisnikId]);
}

export async function procitajObavjestenje(id: string, korisnikId: string) {
  const r = await pool.query(`update obavjestenje set procitano_at = now() where id = $1 and korisnik_id = $2`, [id, korisnikId]);
  if (r.rowCount === 0) throw new ApiGreska(404, "OBAVJESTENJE_NE_POSTOJI", "Obavještenje nije pronađeno.");
}
