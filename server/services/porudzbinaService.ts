import type { PoolClient } from "pg";
import { transakcija, upit } from "../db.js";
import { ApiGreska } from "../greske.js";
import { PROZOR, ogranicenjeDatuma, type SesijskiKorisnik } from "../auth.js";
import { danaUnazad } from "../vrijeme.js";
import { vrijemeVanMreze } from "../vanMreze.js";
import { logIzmjena, logIzmjenaReda, logKreiranje, logPromjenaStatusa, stanjeReda } from "./auditService.js";
import { sljedeciBroj, danasKratko } from "./brojeviService.js";
import { zauzmiKljuc, upisiRezultatKljuca } from "./kljucService.js";
import { provjeriTermometar, zabiljeziMjerenje } from "./haccpService.js";
import { IME, SERIJA_LOTA } from "./sqlDijelovi.js";
import { nazivAlergena, urediAlergene } from "../alergeni.js";

// Porudžbina torte (PILOT Poslastičarnica, dopuna 39 — PLAN.md 8.5 C). Nije isporuka distributera: nema
// zalihe po količini, rezervacije ni vozila. Pravila:
//  • kupac bez telefona se ne upisuje (#4) — povlačenje počinje telefonom;
//  • P1: alergeni se POTVRĐUJU prije predaje; predlog iz sastojaka nije dovoljan, a alergen iz sastojka se ne
//    može izostaviti — ako sastojak nije u torti, skida se njegov lot;
//  • P2: torta se veže za serije ključnih sastojaka (porudzbina_lot) — inače nema odgovora „kome je otišla“;
//  • predaja se provjerava U TRENUTKU PREDAJE (kao #48): zadržan ili odbijen sastojak zaustavlja predaju;
//  • P3: temperatura pri predaji se ocjenjuje po pravilu KKT 3 iz HACCP plana, granica nikad u kodu;
//  • P5: porudžbine vide svi u ateljeu (tortu pravi više ljudi) — teren od juče naprijed, ne samo svoje.

const OTVORENE = ["PRIMLJENA", "U_IZRADI"];
const KKT3_SIFRA = "KKT3";
const NAJDALJE_UNAPRIJED_DANA = 400;

/** Alergeni iz sastojaka (lotova) porudžbine — predlog; `alias` je red porudžbine u upitu. */
const PREDLOG = (alias: string) => `coalesce((
  select array_agg(distinct x order by x) from porudzbina_lot pl
  join lot l on l.id = pl.lot_id join artikal a on a.id = l.artikal_id cross join lateral unnest(a.alergeni) x
  where pl.porudzbina_id = ${alias}.id), '{}')::varchar(20)[]`;

const DAN = (kolona: string) => `to_char(${kolona} at time zone 'Europe/Podgorica', 'YYYY-MM-DD')`;
const SAT = (kolona: string) => `to_char(${kolona} at time zone 'Europe/Podgorica', 'HH24:MI')`;

/** Dan preuzimanja: unazad samo u prozoru uloge (#9 — naknadno upisana torta), unaprijed do godinu dana. */
function provjeriDanPreuzimanja(korisnik: SesijskiKorisnik, datum: string) {
  const unazad = danaUnazad(datum);
  const dani = PROZOR[korisnik.uloga];
  if (unazad > dani) {
    throw new ApiGreska(400, "DATUM_VAN_PROZORA", `Porudžbina sa preuzimanjem prije više od ${dani} ${dani === 1 ? "dan" : "dana"} se ne upisuje — starije upisuje ${korisnik.uloga === "izvodjac" ? "niko" : "odgovorno lice ili konsultant"}.`);
  }
  if (-unazad > NAJDALJE_UNAPRIJED_DANA) throw new ApiGreska(400, "DATUM_PREDALEKO", "Preuzimanje je više od godinu dana unaprijed — provjerite godinu.");
}

async function zakljucajOtvorenu(klijent: PoolClient, id: string) {
  const red = (await klijent.query<{ status: string; broj: string; kupac_ime: string }>(`select status, broj, kupac_ime from porudzbina where id = $1 for update`, [id])).rows[0];
  if (!red) throw new ApiGreska(404, "PORUDZBINA_NE_POSTOJI", "Porudžbina nije pronađena.");
  if (red.status === "PREDATA") throw new ApiGreska(409, "PORUDZBINA_PREDATA", `Porudžbina ${red.broj} je već predata — mijenja se samo prijavom problema (reklamacija).`);
  if (red.status === "OTKAZANA") throw new ApiGreska(409, "PORUDZBINA_OTKAZANA", `Porudžbina ${red.broj} je otkazana.`);
  return red;
}

async function predlogAlergena(klijent: PoolClient, id: string): Promise<string[]> {
  return (await klijent.query<{ predlog: string[] }>(`select ${PREDLOG("p")} as predlog from porudzbina p where p.id = $1`, [id])).rows[0]?.predlog ?? [];
}

// ── Čitanje ──

export async function listaPorudzbina(korisnik: SesijskiKorisnik) {
  const r = await upit(
    `select p.id, p.broj, p.kupac_ime, p.kupac_telefon, p.preuzimanje_at, ${DAN("p.preuzimanje_at")} as dan, ${SAT("p.preuzimanje_at")} as vrijeme,
            p.nacin, p.adresa_dostave, p.opis, p.napomena, p.status, p.alergeni, p.alergeni_potvrdjeno_at, p.predato_at, p.predaja_van_mreze, p.razlog_otkaza,
            (select count(*)::int from porudzbina_lot pl where pl.porudzbina_id = p.id) as broj_sastojaka,
            (select count(*)::int from neusaglasenost nc where nc.izvor_tip = 'porudzbina' and nc.izvor_id = p.id and nc.status <> 'ZATVORENA') as otvorena_odstupanja,
            exists (select 1 from porudzbina_lot pl join lot l on l.id = pl.lot_id where pl.porudzbina_id = p.id and l.status in ('HOLD', 'ODBIJEN')) as sastojak_zadrzan,
            not (${PREDLOG("p")} <@ p.alergeni) as fali_alergen
     from porudzbina p
     where ${ogranicenjeDatuma(korisnik.uloga, "(p.preuzimanje_at at time zone 'Europe/Podgorica')::date")} or p.status = any($1)
     order by p.preuzimanje_at, p.broj`,
    [OTVORENE],
  );
  return r.rows;
}

export async function detaljPorudzbine(id: string) {
  const p = (
    await upit(
      `select p.*, ${DAN("p.preuzimanje_at")} as dan, ${SAT("p.preuzimanje_at")} as vrijeme,
              ${IME("p.uneo_korisnik_id")} as uneo, ${IME("p.alergeni_potvrdio_korisnik_id")} as alergene_potvrdio,
              ${IME("p.predao_korisnik_id")} as predao, ${IME("p.otkazao_korisnik_id")} as otkazao,
              m.rezultat as rezultat_temperature, u.naziv as termometar
       from porudzbina p
       left join mjerenje_temperature m on m.id = p.mjerenje_id
       left join mjerni_uredjaj u on u.id = p.mjerni_uredjaj_id
       where p.id = $1`,
      [id],
    )
  ).rows[0];
  if (!p) throw new ApiGreska(404, "PORUDZBINA_NE_POSTOJI", "Porudžbina nije pronađena.");
  const lotovi = (
    await upit<{ alergeni: string[]; alergeni_upisani: boolean; artikal: string }>(
      `select pl.lot_id, l.broj_lota, l.status as lot_status, to_char(l.rok_trajanja, 'YYYY-MM-DD') as rok, a.naziv as artikal,
              a.alergeni, a.alergeni_upisani, d.naziv as dobavljac, pr.datum_prijema, ${IME("pl.dodao_korisnik_id")} as dodao
       from porudzbina_lot pl join lot l on l.id = pl.lot_id join artikal a on a.id = l.artikal_id
       join dobavljac d on d.id = l.dobavljac_id left join prijem pr on pr.id = l.prijem_id
       where pl.porudzbina_id = $1 order by a.naziv, l.broj_lota`,
      [id],
    )
  ).rows;
  const predlog = urediAlergene(lotovi.flatMap((l) => l.alergeni));
  return {
    ...p,
    lotovi,
    predlog,
    // Sastojak kome niko nije pogledao deklaraciju — predlog za njega ne znači „nema alergena“.
    sastojciBezAlergena: Array.from(new Set(lotovi.filter((l) => !l.alergeni_upisani).map((l) => l.artikal))),
    faliAlergen: predlog.filter((s) => !(p.alergeni as string[]).includes(s)),
  };
}

/** Sastojci koji smiju u tortu: prihvaćen lot, rok nije istekao, ima ga (nije sav otpisan). FEFO. */
export async function lotoviZaIzbor() {
  return (
    await upit(
      `select l.id as lot_id, l.broj_lota, to_char(l.rok_trajanja, 'YYYY-MM-DD') as rok, a.naziv as artikal, a.alergeni, a.alergeni_upisani,
              d.naziv as dobavljac, pr.datum_prijema
       from lot l join artikal a on a.id = l.artikal_id join dobavljac d on d.id = l.dobavljac_id join prijem pr on pr.id = l.prijem_id
       where l.status = 'PRIHVACEN'
         and (l.rok_trajanja is null or l.rok_trajanja >= (now() at time zone 'Europe/Podgorica')::date)
         and pr.datum_prijema >= (now() at time zone 'Europe/Podgorica')::date - 120
         and coalesce((select sum(z.kolicina) from zaliha z where z.lot_id = l.id and z.status = 'DOSTUPNO'), 0) > 0
       order by a.naziv, l.rok_trajanja nulls last, pr.datum_prijema desc
       limit 300`,
    )
  ).rows;
}

// ── Upis ──

export type PorudzbinaUlaz = {
  kupacIme: string;
  kupacTelefon: string;
  preuzimanjeDatum: string;
  preuzimanjeVrijeme: string;
  nacin: "PREUZIMA" | "DOSTAVA";
  adresaDostave?: string;
  opis: string;
  napomena?: string;
};

const adresa = (u: PorudzbinaUlaz) => {
  const a = u.adresaDostave?.trim() || null;
  if (u.nacin === "DOSTAVA" && !a) throw new ApiGreska(400, "ADRESA_OBAVEZNA", "Za dostavu upišite adresu (sala, hotel, kuća).");
  return u.nacin === "DOSTAVA" ? a : null;
};

export async function kreirajPorudzbinu(ulaz: PorudzbinaUlaz, korisnik: SesijskiKorisnik, kljuc?: string) {
  provjeriDanPreuzimanja(korisnik, ulaz.preuzimanjeDatum);
  const adresaDostave = adresa(ulaz);
  return transakcija(async (klijent) => {
    if (kljuc) {
      const ranije = await zauzmiKljuc(klijent, korisnik.id, kljuc, "porudzbina");
      if (ranije?.id) return { id: String(ranije.id), broj: String(ranije.broj ?? "") };
    }
    const broj = await sljedeciBroj(klijent, "porudzbina", `PRD-${danasKratko()}`);
    const r = await klijent.query<{ id: string }>(
      `insert into porudzbina (broj, kupac_ime, kupac_telefon, preuzimanje_at, nacin, adresa_dostave, opis, napomena, uneo_korisnik_id)
       values ($1, $2, $3, ($4::date + $5::time) at time zone 'Europe/Podgorica', $6, $7, $8, $9, $10) returning id`,
      [broj, ulaz.kupacIme.trim(), ulaz.kupacTelefon.trim(), ulaz.preuzimanjeDatum, ulaz.preuzimanjeVrijeme, ulaz.nacin, adresaDostave, ulaz.opis.trim(), ulaz.napomena?.trim() || null, korisnik.id],
    );
    const id = r.rows[0].id;
    await logKreiranje(klijent, { korisnikId: korisnik.id, entitetTip: "porudzbina", entitetId: id, noveVrijednosti: { broj, kupac: ulaz.kupacIme, preuzimanje: `${ulaz.preuzimanjeDatum} ${ulaz.preuzimanjeVrijeme}`, nacin: ulaz.nacin } });
    if (kljuc) await upisiRezultatKljuca(klijent, korisnik.id, kljuc, { id, broj });
    return { id, broj };
  });
}

/** Ispravka dok torta nije predata — kupac, telefon, vrijeme, način, opis. Audit pamti šta je bilo (#56). */
export async function izmijeniPorudzbinu(id: string, ulaz: PorudzbinaUlaz, korisnik: SesijskiKorisnik) {
  provjeriDanPreuzimanja(korisnik, ulaz.preuzimanjeDatum);
  const adresaDostave = adresa(ulaz);
  await transakcija(async (klijent) => {
    await zakljucajOtvorenu(klijent, id);
    const prije = await stanjeReda(klijent, "porudzbina", id, true);
    await klijent.query(
      `update porudzbina set kupac_ime = $1, kupac_telefon = $2, preuzimanje_at = ($3::date + $4::time) at time zone 'Europe/Podgorica',
              nacin = $5, adresa_dostave = $6, opis = $7, napomena = $8, updated_at = now()
       where id = $9`,
      [ulaz.kupacIme.trim(), ulaz.kupacTelefon.trim(), ulaz.preuzimanjeDatum, ulaz.preuzimanjeVrijeme, ulaz.nacin, adresaDostave, ulaz.opis.trim(), ulaz.napomena?.trim() || null, id],
    );
    await logIzmjenaReda(klijent, { korisnikId: korisnik.id, entitetTip: "porudzbina", entitetId: id, prije, poslije: await stanjeReda(klijent, "porudzbina", id) });
  });
}

/** Serija sastojka ulazi u tortu (P2). Novi alergen koga nema u potvrđenom spisku poništava potvrdu — čovjek
 * mora ponovo pogledati. */
export async function dodajLot(id: string, lotId: string, korisnik: SesijskiKorisnik) {
  return transakcija(async (klijent) => {
    const p = await zakljucajOtvorenu(klijent, id);
    const lot = (
      await klijent.query<{ status: string; broj_lota: string; artikal: string; rok: string | null; istekao: boolean | null }>(
        `select l.status, l.broj_lota, a.naziv as artikal, to_char(l.rok_trajanja, 'DD.MM.YYYY.') as rok,
                l.rok_trajanja < (now() at time zone 'Europe/Podgorica')::date as istekao
         from lot l join artikal a on a.id = l.artikal_id where l.id = $1`,
        [lotId],
      )
    ).rows[0];
    if (!lot) throw new ApiGreska(404, "LOT_NE_POSTOJI", "Lot nije pronađen.");
    if (lot.status !== "PRIHVACEN") {
      throw new ApiGreska(409, "LOT_NIJE_PRIHVACEN", `${lot.artikal} (lot ${lot.broj_lota}) ${lot.status === "HOLD" ? "je zadržan" : "nije prihvaćen"} — u tortu ide samo prihvaćen sastojak.`);
    }
    if (lot.istekao) throw new ApiGreska(409, "ROK_ISTEKAO", `${lot.artikal} (lot ${lot.broj_lota}) je istekao ${lot.rok} — ne ide u tortu.`);
    const novo = await klijent.query(`insert into porudzbina_lot (porudzbina_id, lot_id, dodao_korisnik_id) values ($1, $2, $3) on conflict do nothing returning id`, [id, lotId, korisnik.id]);
    if (!novo.rowCount) return { dodato: false, potvrdaPonistena: false };
    await logIzmjena(klijent, { korisnikId: korisnik.id, entitetTip: "porudzbina", entitetId: id, stareVrijednosti: { sastojak: null }, noveVrijednosti: { sastojak: `${lot.artikal} · lot ${lot.broj_lota}` } });

    const r = (await klijent.query<{ alergeni: string[]; potvrdjeno: boolean }>(`select alergeni, alergeni_potvrdjeno_at is not null as potvrdjeno from porudzbina where id = $1`, [id])).rows[0];
    const predlog = await predlogAlergena(klijent, id);
    const novi = predlog.filter((s) => !r.alergeni.includes(s));
    let potvrdaPonistena = false;
    if (r.potvrdjeno && novi.length > 0) {
      await klijent.query(`update porudzbina set alergeni_potvrdjeno_at = null, alergeni_potvrdio_korisnik_id = null, updated_at = now() where id = $1`, [id]);
      await logIzmjena(klijent, {
        korisnikId: korisnik.id,
        entitetTip: "porudzbina",
        entitetId: id,
        stareVrijednosti: { alergeniPotvrdjeni: true },
        noveVrijednosti: { alergeniPotvrdjeni: false, razlog: `nov sastojak ${lot.artikal} donosi: ${novi.map(nazivAlergena).join(", ")}`, porudzbina: p.broj },
      });
      potvrdaPonistena = true;
    }
    return { dodato: true, potvrdaPonistena, noviAlergeni: novi };
  });
}

/** Pogrešno izabran lot se skida dok torta nije predata — uz trag u auditu. */
export async function ukloniLot(id: string, lotId: string, korisnik: SesijskiKorisnik) {
  await transakcija(async (klijent) => {
    await zakljucajOtvorenu(klijent, id);
    const red = (
      await klijent.query<{ opis: string }>(
        `delete from porudzbina_lot pl using lot l, artikal a
         where pl.porudzbina_id = $1 and pl.lot_id = $2 and l.id = pl.lot_id and a.id = l.artikal_id
         returning a.naziv || ' · lot ' || l.broj_lota as opis`,
        [id, lotId],
      )
    ).rows[0];
    if (!red) throw new ApiGreska(404, "SASTOJAK_NE_POSTOJI", "Taj lot nije u ovoj porudžbini.");
    await logIzmjena(klijent, { korisnikId: korisnik.id, entitetTip: "porudzbina", entitetId: id, stareVrijednosti: { sastojak: red.opis }, noveVrijednosti: { sastojak: null, uklonjen: red.opis } });
  });
}

/** P1: čovjek potvrđuje alergene torte. Alergen iz sastojka se ne može izostaviti; dodati se smije (npr. orasi
 * u dekoraciji, a nisu vođeni kao lot). Prazan spisak samo uz izričito „torta nema nijedan alergen“. */
export async function potvrdiAlergene(id: string, ulaz: { alergeni: string[]; bezAlergena?: boolean }, korisnik: SesijskiKorisnik) {
  const alergeni: string[] = urediAlergene(ulaz.alergeni);
  return transakcija(async (klijent) => {
    await zakljucajOtvorenu(klijent, id);
    const predlog = await predlogAlergena(klijent, id);
    const fale = predlog.filter((s) => !alergeni.includes(s));
    if (fale.length > 0) {
      const odakle = (
        await klijent.query<{ artikal: string; broj_lota: string; alergeni: string[] }>(
          `select a.naziv as artikal, l.broj_lota, a.alergeni from porudzbina_lot pl join lot l on l.id = pl.lot_id join artikal a on a.id = l.artikal_id
           where pl.porudzbina_id = $1 and a.alergeni && $2::varchar(20)[] order by a.naziv`,
          [id, fale],
        )
      ).rows.map((r) => `${r.artikal} (lot ${r.broj_lota})`);
      throw new ApiGreska(
        409,
        "ALERGEN_IZ_SASTOJKA",
        `${fale.map(nazivAlergena).join(", ")} ${fale.length === 1 ? "dolazi" : "dolaze"} iz sastojka: ${odakle.join(", ")} — ne može se izostaviti. Ako taj sastojak nije u torti, uklonite njegov lot.`,
        { fale },
      );
    }
    if (alergeni.length === 0 && !ulaz.bezAlergena) {
      throw new ApiGreska(400, "ALERGENI_PRAZNO", "Označite alergene torte, ili potvrdite da torta nema nijedan od 14 alergena.");
    }
    const prije = await stanjeReda(klijent, "porudzbina", id, true);
    await klijent.query(`update porudzbina set alergeni = $1, alergeni_potvrdio_korisnik_id = $2, alergeni_potvrdjeno_at = now(), updated_at = now() where id = $3`, [alergeni, korisnik.id, id]);
    await logIzmjenaReda(klijent, { korisnikId: korisnik.id, entitetTip: "porudzbina", entitetId: id, prije, poslije: await stanjeReda(klijent, "porudzbina", id), dodatno: { alergeniPotvrdjeni: true } });
    const bezPodatka = (
      await klijent.query<{ artikal: string }>(
        `select distinct a.naziv as artikal from porudzbina_lot pl join lot l on l.id = pl.lot_id join artikal a on a.id = l.artikal_id
         where pl.porudzbina_id = $1 and not a.alergeni_upisani order by 1`,
        [id],
      )
    ).rows.map((r) => r.artikal);
    return { alergeni, sastojciBezAlergena: bezPodatka };
  });
}

export async function pocniIzradu(id: string, korisnik: SesijskiKorisnik) {
  await transakcija(async (klijent) => {
    const p = await zakljucajOtvorenu(klijent, id);
    if (p.status !== "PRIMLJENA") throw new ApiGreska(409, "VEC_U_IZRADI", `Porudžbina ${p.broj} je već u izradi.`);
    await klijent.query(`update porudzbina set status = 'U_IZRADI', updated_at = now() where id = $1`, [id]);
    await logPromjenaStatusa(klijent, { korisnikId: korisnik.id, entitetTip: "porudzbina", entitetId: id, stareVrijednosti: { status: p.status }, noveVrijednosti: { status: "U_IZRADI" } });
  });
}

/** Otkaz prije predaje, uz razlog (kao #63) — porudžbina ostaje zapisana. */
export async function otkaziPorudzbinu(id: string, razlog: string, korisnik: SesijskiKorisnik) {
  const tekst = razlog.trim();
  if (tekst.length < 5) throw new ApiGreska(400, "RAZLOG_OBAVEZAN", "Upišite zašto se porudžbina otkazuje (npr. kupac otkazao telefonom).");
  await transakcija(async (klijent) => {
    const p = await zakljucajOtvorenu(klijent, id);
    await klijent.query(`update porudzbina set status = 'OTKAZANA', otkazano_at = now(), otkazao_korisnik_id = $1, razlog_otkaza = $2, updated_at = now() where id = $3`, [korisnik.id, tekst, id]);
    await logPromjenaStatusa(klijent, { korisnikId: korisnik.id, entitetTip: "porudzbina", entitetId: id, stareVrijednosti: { status: p.status }, noveVrijednosti: { status: "OTKAZANA", razlog: tekst } });
  });
}

export type PredajaUlaz = { temperatura?: number | null; mjerniUredjajId?: string | null; preuzeoIme?: string };

/** Termometar kad se mjeri (#60): čim firma ima aktivan termometar, zna se kojim je mjereno. */
async function termometarZaMjerenje(mjerniUredjajId: string | null | undefined) {
  if (!mjerniUredjajId) {
    const u = (
      await upit<{ ukupno: number; ispravnih: number }>(
        `select count(*)::int as ukupno,
                count(*) filter (where coalesce((select p.rezultat from provjera_uredjaja p where p.uredjaj_id = u.id order by p.datum desc, p.created_at desc limit 1), '') <> 'NEISPRAVAN')::int as ispravnih
         from mjerni_uredjaj u where u.aktivan`,
      )
    ).rows[0];
    if (u.ukupno > 0 && u.ispravnih === 0) {
      throw new ApiGreska(409, "NEMA_ISPRAVNOG_TERMOMETRA", "Nijedan termometar u upotrebi nije prošao provjeru — provjerite ili zamijenite termometar (HACCP plan → Termometri), pa mjerite.");
    }
    if (u.ukupno > 0) throw new ApiGreska(400, "TERMOMETAR_OBAVEZAN", "Izaberite termometar kojim ste mjerili.");
    return null;
  }
  return provjeriTermometar(mjerniUredjajId);
}

/** Predaja torte kupcu. Sve se provjerava sada, u trenutku predaje: alergeni potvrđeni i potpuni (P1), nijedan
 * sastojak nije zadržan (povlačenje, temperatura van granice), kod dostave temperatura. Bez mreže (#85): vrijeme
 * predaje je vrijeme sa telefona. Mjerenje ide POSLIJE predaje, u svojoj transakciji — kao KKT 3 isporuke:
 * nalaz van granice ne poništava predaju koja se već desila, nego otvara neusaglašenost. */
export async function predajPorudzbinu(id: string, ulaz: PredajaUlaz, korisnik: SesijskiKorisnik) {
  const temperatura = ulaz.temperatura ?? null;
  const uredjaj = temperatura === null ? null : await termometarZaMjerenje(ulaz.mjerniUredjajId);
  const predaja = await transakcija(async (klijent) => {
    const p = await zakljucajOtvorenu(klijent, id);
    const r = (
      await klijent.query<{ nacin: string; alergeni: string[]; potvrdjeno: boolean; predlog: string[] }>(
        `select nacin, alergeni, alergeni_potvrdjeno_at is not null as potvrdjeno, ${PREDLOG("p")} as predlog from porudzbina p where p.id = $1`,
        [id],
      )
    ).rows[0];
    if (!r.potvrdjeno) {
      throw new ApiGreska(409, "ALERGENI_NISU_POTVRDJENI", `Potvrdite alergene torte prije predaje — kupac mora znati šta je u torti (${p.broj}).`);
    }
    const fale = r.predlog.filter((s) => !r.alergeni.includes(s));
    if (fale.length > 0) {
      throw new ApiGreska(409, "ALERGENI_NISU_POTVRDJENI", `Sastojak dodat posle potvrde donosi ${fale.map(nazivAlergena).join(", ")} — potvrdite alergene ponovo.`);
    }
    const zadrzani = (
      await klijent.query<{ opis: string }>(
        `select a.naziv || ' (lot ' || l.broj_lota || ')' as opis from porudzbina_lot pl join lot l on l.id = pl.lot_id join artikal a on a.id = l.artikal_id
         where pl.porudzbina_id = $1 and l.status in ('HOLD', 'ODBIJEN') order by 1`,
        [id],
      )
    ).rows.map((x) => x.opis);
    if (zadrzani.length > 0) {
      throw new ApiGreska(409, "SASTOJAK_ZADRZAN", `${zadrzani.join(", ")} ${zadrzani.length === 1 ? "je zadržan" : "su zadržani"} — torta se ne predaje. Javite se odgovornom licu.`);
    }
    if (r.nacin === "DOSTAVA" && temperatura === null) {
      throw new ApiGreska(400, "TEMPERATURA_OBAVEZNA", "Kod dostave upišite temperaturu torte pri predaji — to je dokaz da je hladni lanac održan do kupca.");
    }
    await klijent.query(
      `update porudzbina set status = 'PREDATA', predato_at = coalesce($2::timestamptz, now()), predaja_van_mreze = $2::timestamptz is not null,
              predao_korisnik_id = $3, preuzeo_ime = $4, temperatura_predaje = $5, mjerni_uredjaj_id = $6, updated_at = now()
       where id = $1`,
      [id, vrijemeVanMreze(), korisnik.id, ulaz.preuzeoIme?.trim() || null, temperatura, uredjaj],
    );
    await logPromjenaStatusa(klijent, {
      korisnikId: korisnik.id,
      entitetTip: "porudzbina",
      entitetId: id,
      stareVrijednosti: { status: p.status },
      noveVrijednosti: { status: "PREDATA", temperatura, preuzeo: ulaz.preuzeoIme?.trim() || null },
    });
    return { broj: p.broj, kupac: p.kupac_ime };
  });

  if (temperatura === null) return { status: "PREDATA", rezultat: null, neusaglasenostId: null, bezGranice: false };
  // P3: granica je opšte pravilo KKT 3 (predaja kupcu) iz HACCP plana. Bez pravila — temperatura ostaje
  // zapisana uz porudžbinu, ali se ne ocjenjuje (kao isporuka artikla bez granice).
  const kkt3 = (await upit<{ id: string }>(`select id from kontrolna_tacka where sifra = $1 and aktivan`, [KKT3_SIFRA])).rows[0];
  const pravilo = kkt3
    ? (
        await upit<{ id: string; min_vrijednost: string | null; max_vrijednost: string | null }>(
          `select id, min_vrijednost, max_vrijednost from pravilo_kontrole where kontrolna_tacka_id = $1 and artikal_id is null and aktivan order by created_at desc limit 1`,
          [kkt3.id],
        )
      ).rows[0]
    : undefined;
  if (!kkt3 || !pravilo) return { status: "PREDATA", rezultat: null, neusaglasenostId: null, bezGranice: true };
  const m = await zabiljeziMjerenje(pravilo, {
    kontrolnaTackaId: kkt3.id,
    praviloKontroleId: pravilo.id,
    vrijednost: temperatura,
    izmjerioKorisnikId: korisnik.id,
    napomena: `Pri predaji torte — ${predaja.broj} (${predaja.kupac})`,
    holdLota: false,
    mjerniUredjajId: uredjaj,
  });
  await upit(`update porudzbina set mjerenje_id = $1 where id = $2`, [m.mjerenjeId, id]);
  return { status: "PREDATA", rezultat: m.rezultat, neusaglasenostId: m.neusaglasenostId, bezGranice: false };
}

// ── Sledljivost i povlačenje ──

/** Torte u kojima je bila serija ovog lota (isti dobavljač, artikal i broj lota kroz sve prijeme — R-17). */
export async function porudzbineSerije(lotId: string) {
  return (
    await upit(
      `select v.*, ${DAN("v.preuzimanje_at")} as dan from v_sledljivost_porudzbine v where v.lot_id in (${SERIJA_LOTA})
       order by v.preuzimanje_at desc`,
      [lotId],
    )
  ).rows;
}

export async function pretraziPorudzbine(tekst: string) {
  const uzorak = `%${tekst}%`;
  return (
    await upit(
      `select distinct on (p.preuzimanje_at, p.id) p.id, p.broj, p.kupac_ime, p.kupac_telefon, p.status, p.opis, ${DAN("p.preuzimanje_at")} as dan
       from porudzbina p
       left join porudzbina_lot pl on pl.porudzbina_id = p.id left join lot l on l.id = pl.lot_id
       where p.broj ilike $1 or p.kupac_ime ilike $1 or p.kupac_telefon ilike $1 or p.opis ilike $1 or l.broj_lota ilike $1
       order by p.preuzimanje_at desc, p.id limit 50`,
      [uzorak],
    )
  ).rows;
}
