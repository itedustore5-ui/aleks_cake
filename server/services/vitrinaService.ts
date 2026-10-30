import type { PoolClient } from "pg";
import { transakcija, upit } from "../db.js";
import { ApiGreska } from "../greske.js";
import { NA_TERENU, PROZOR, izvrsilacZa, provjeriProzorUpisa, type SesijskiKorisnik } from "../auth.js";
import { danasCG, danaUnazad } from "../vrijeme.js";
import { logIzmjena, logIzmjenaReda, logKreiranje, stanjeReda } from "./auditService.js";
import { sljedeciBroj, danasKratko } from "./brojeviService.js";
import { zauzmiKljuc, upisiRezultatKljuca } from "./kljucService.js";
import { IME, SERIJA_LOTA } from "./sqlDijelovi.js";
import { urediAlergene } from "../alergeni.js";

// Kolači iz vitrine (dopuna 42, 30.10.2026). Atelje pravi kolače za prodaju iz vitrine — bez kupca sa imenom, pa
// sledljivost (čl. 27) ide do SERIJE kolača i DANA prodaje. Pravila (P6):
//  • serija se veže za serije sastojaka kao torta (P2): samo prihvaćen sastojak sa rokom važećim na dan izrade;
//    bez sastojaka se prima (kartica to kaže), a sastojak se dopisuje dok je kolač u vitrini;
//  • ostatak u vitrini se RAČUNA (napravljeno − prodato − otpisano), ne upisuje; zbir nikad preko napravljenog;
//  • posle roka se ne prodaje (ROK_ISTEKAO) — samo otpis, uz razlog;
//  • zadržan sastojak (temperatura, povlačenje): kolač se ne prodaje; prodaja koja se desila PRIJE toga upisuje se samo
//    uz izričito „prodato prije zadržavanja“ (audit), a svi u ateljeu dobijaju „Skloni iz vitrine“ (lotBlokadaService);
//  • upis prodaje se ne mijenja (#1): pogrešan dodir poništava onaj ko ga je upisao, u 10 minuta; stariji ili tuđi
//    upis — odgovorno lice, uz razlog, u svom prozoru (#9); audit pamti šta je poništeno;
//  • vide svi u ateljeu (kao P5); istoriju zaposleni od juče (#6).

const NAJDUZI_ROK_DANA = 60;
const PONISTI_MINUTA = 10;
const NAJDUZI_PERIOD_DANA = 366;
const VODSTVO = ["bzr", "izvodjac"];
const DAN = /^\d{4}-\d{2}-\d{2}$/;

const vrijemeDana = (dan: string) => Date.parse(`${dan}T00:00:00Z`);
const razlikaDana = (od: string, doDana: string) => Math.round((vrijemeDana(doDana) - vrijemeDana(od)) / 86_400_000);
const pomjeriDan = (dan: string, dana: number) => new Date(vrijemeDana(dan) + dana * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "UTC" });
/** 2026-10-30 → 30.10.2026. */
const citljivo = (dan: string) => `${dan.slice(8, 10)}.${dan.slice(5, 7)}.${dan.slice(0, 4)}.`;

function provjeriRok(datum: string, rok: string) {
  if (rok < datum) throw new ApiGreska(400, "ROK_PRIJE_IZRADE", "Rok ne može biti prije dana kad je kolač napravljen.");
  if (razlikaDana(datum, rok) > NAJDUZI_ROK_DANA) {
    throw new ApiGreska(400, "ROK_PREDALEKO", `Rok je više od ${NAJDUZI_ROK_DANA} dana od izrade — provjerite datum.`);
  }
}

/** Red serije zaključan do kraja transakcije — svaki upis prometa prvo zaključa seriju, pa je zbir pouzdan. */
async function zakljucajSeriju(klijent: PoolClient, id: string) {
  const s = (
    await klijent.query<{ id: string; broj: string; naziv: string; datum: string; rok: string; komada: number }>(
      `select id, broj, naziv, datum, rok, komada from serija_vitrine where id = $1 for update`,
      [id],
    )
  ).rows[0];
  if (!s) throw new ApiGreska(404, "KOLAC_NE_POSTOJI", "Kolač nije pronađen.");
  const potroseno = (
    await klijent.query<{ n: number }>(`select coalesce(sum(prodato + otpisano), 0)::int as n from serija_vitrine_promet where serija_id = $1`, [id])
  ).rows[0].n;
  return { ...s, potroseno, ostalo: s.komada - potroseno };
}

/** Sastojak ide u kolač samo prihvaćen i sa rokom koji važi na dan izrade (kao torta, P2). */
async function provjeriLot(klijent: PoolClient, lotId: string, datum: string) {
  const lot = (
    await klijent.query<{ status: string; broj_lota: string; artikal: string; rok: string | null; istekao: boolean | null }>(
      `select l.status, l.broj_lota, a.naziv as artikal, to_char(l.rok_trajanja, 'DD.MM.YYYY.') as rok, l.rok_trajanja < $2::date as istekao
       from lot l join artikal a on a.id = l.artikal_id where l.id = $1`,
      [lotId, datum],
    )
  ).rows[0];
  if (!lot) throw new ApiGreska(404, "LOT_NE_POSTOJI", "Sastojak (lot) nije pronađen.");
  if (lot.status !== "PRIHVACEN") {
    throw new ApiGreska(409, "LOT_NIJE_PRIHVACEN", `${lot.artikal} (lot ${lot.broj_lota}) ${lot.status === "HOLD" ? "je zadržan" : "nije prihvaćen"} — u kolač ide samo prihvaćen sastojak.`);
  }
  if (lot.istekao) throw new ApiGreska(409, "ROK_ISTEKAO", `${lot.artikal} (lot ${lot.broj_lota}) je istekao ${lot.rok} — ne ide u kolač.`);
  return `${lot.artikal} · lot ${lot.broj_lota}`;
}

type Sastojak = {
  serija_id: string; lot_id: string; broj_lota: string; bez_broja: boolean; lot_status: string; artikal: string;
  alergeni: string[]; alergeni_upisani: boolean; rok: string | null;
};

async function sastojciSerija(ids: string[]) {
  const mapa = new Map<string, Sastojak[]>();
  if (ids.length === 0) return mapa;
  const r = await upit<Sastojak>(
    `select sl.serija_id, sl.lot_id, l.broj_lota, l.bez_broja, l.status as lot_status, a.naziv as artikal, a.alergeni, a.alergeni_upisani,
            l.rok_trajanja as rok
     from serija_vitrine_lot sl join lot l on l.id = sl.lot_id join artikal a on a.id = l.artikal_id
     where sl.serija_id = any($1) order by a.naziv, l.broj_lota`,
    [ids],
  );
  for (const s of r.rows) mapa.set(s.serija_id, [...(mapa.get(s.serija_id) ?? []), s]);
  return mapa;
}

/** Šta kartica kaže o sastojcima: alergeni (unija), sastojci kojima niko nije pogledao deklaraciju, zadržani. */
function oSastojcima(sastojci: Sastojak[]) {
  return {
    sastojci,
    alergeni: urediAlergene(sastojci.flatMap((s) => s.alergeni)),
    bezAlergena: Array.from(new Set(sastojci.filter((s) => !s.alergeni_upisani).map((s) => s.artikal))),
    zadrzani: sastojci.filter((s) => s.lot_status === "HOLD" || s.lot_status === "ODBIJEN").map((s) => `${s.artikal} (lot ${s.broj_lota})`),
  };
}

// ── Čitanje ──

/** Koliko je kolača tog dana napravljeno, prodato i otpisano — isti broj na ekranu Vitrina i na Kontrolnom centru. */
export async function zbirVitrine(dan: string) {
  return (
    await upit<{ napravljeno: number; prodato: number; otpisano: number }>(
      `select coalesce((select sum(komada) from serija_vitrine where datum = $1::date), 0)::int as napravljeno,
              coalesce((select sum(prodato) from serija_vitrine_promet where datum = $1::date), 0)::int as prodato,
              coalesce((select sum(otpisano) from serija_vitrine_promet where datum = $1::date), 0)::int as otpisano`,
      [dan],
    )
  ).rows[0];
}

/** Ekran „Vitrina“: šta je sada u vitrini (prvo ono čiji rok prvi ističe), današnji zbir i nazivi za formu.
 * Kolač koji je upravo rasprodat ostaje na ekranu dok traje „Poništi“ — da se pogrešan posljednji dodir ispravi. */
export async function vitrinaSada(korisnik: SesijskiKorisnik) {
  const danas = danasCG();
  const [serije, nazivi, zbir] = await Promise.all([
    upit<{
      id: string; broj: string; naziv: string; datum: string; rok: string; komada: number; napomena: string | null; izvrsilac: string;
      prodato: number; otpisano: number; ostalo: number; danas_prodato: number; danas_otpisano: number; istekao: boolean; rok_danas: boolean;
      ponisti_id: string | null; ponisti_prodato: number | null; ponisti_otpisano: number | null;
    }>(
      `with promet as (
         select serija_id, sum(prodato)::int as prodato, sum(otpisano)::int as otpisano,
                coalesce(sum(prodato) filter (where datum = $1::date), 0)::int as danas_prodato,
                coalesce(sum(otpisano) filter (where datum = $1::date), 0)::int as danas_otpisano
         from serija_vitrine_promet group by serija_id
       ), moj as (
         select distinct on (serija_id) serija_id, id, prodato, otpisano from serija_vitrine_promet
         where uneo_korisnik_id = $2 and created_at > now() - interval '${PONISTI_MINUTA} minutes'
         order by serija_id, created_at desc
       )
       select s.id, s.broj, s.naziv, s.datum, s.rok, s.komada, s.napomena, s.izvrsilac,
              coalesce(p.prodato, 0) as prodato, coalesce(p.otpisano, 0) as otpisano,
              s.komada - coalesce(p.prodato, 0) - coalesce(p.otpisano, 0) as ostalo,
              coalesce(p.danas_prodato, 0) as danas_prodato, coalesce(p.danas_otpisano, 0) as danas_otpisano,
              s.rok < $1::date as istekao, s.rok = $1::date as rok_danas,
              m.id as ponisti_id, m.prodato as ponisti_prodato, m.otpisano as ponisti_otpisano
       from serija_vitrine s left join promet p on p.serija_id = s.id left join moj m on m.serija_id = s.id
       where s.komada - coalesce(p.prodato, 0) - coalesce(p.otpisano, 0) > 0 or m.id is not null
       order by s.komada - coalesce(p.prodato, 0) - coalesce(p.otpisano, 0) = 0, s.rok, s.naziv, s.broj`,
      [danas, korisnik.id],
    ),
    // Za formu „Napravljeno“: posljednji put — koliko dana rok i od kojih sastojaka (predlog, čovjek potvrđuje).
    upit<{ naziv: string; rok_dana: number; artikli: string[] }>(
      `select * from (
         select distinct on (lower(s.naziv)) s.naziv, s.rok - s.datum as rok_dana,
                coalesce((select array_agg(distinct a.naziv) from serija_vitrine_lot sl join lot l on l.id = sl.lot_id
                          join artikal a on a.id = l.artikal_id where sl.serija_id = s.id), '{}') as artikli
         from serija_vitrine s where s.datum >= $1::date - 90
         order by lower(s.naziv), s.created_at desc
       ) x order by lower(x.naziv) limit 200`,
      [danas],
    ),
    zbirVitrine(danas),
  ]);
  const sastojci = await sastojciSerija(serije.rows.map((s) => s.id));
  return {
    zbirDanas: zbir,
    serije: serije.rows.map((s) => ({ ...s, rasprodato: s.ostalo <= 0, ...oSastojcima(sastojci.get(s.id) ?? []) })),
    nazivi: nazivi.rows,
  };
}

/** Jedan kolač: sastojci i svaki upis prodaje i otpisa (ko, kad) — uz oznaku koji se smije poništiti. */
export async function detaljSerije(id: string, korisnik: SesijskiKorisnik) {
  const danas = danasCG();
  const s = (
    await upit<{ id: string; broj: string; naziv: string; datum: string; rok: string; komada: number; napomena: string | null; izvrsilac: string; uneo: string; istekao: boolean }>(
      `select s.id, s.broj, s.naziv, s.datum, s.rok, s.komada, s.napomena, s.izvrsilac, ${IME("s.uneo_korisnik_id")} as uneo, s.rok < $2::date as istekao
       from serija_vitrine s where s.id = $1`,
      [id, danas],
    )
  ).rows[0];
  if (!s) throw new ApiGreska(404, "KOLAC_NE_POSTOJI", "Kolač nije pronađen.");
  const promet = (
    await upit<{ id: string; datum: string; prodato: number; otpisano: number; razlog_otpisa: string | null; uneo: string; upisano: string; svoj_svjez: boolean }>(
      `select p.id, p.datum, p.prodato, p.otpisano, p.razlog_otpisa, ${IME("p.uneo_korisnik_id")} as uneo,
              to_char(p.created_at at time zone 'Europe/Podgorica', 'DD.MM. HH24:MI') as upisano,
              p.uneo_korisnik_id = $2 and p.created_at > now() - interval '${PONISTI_MINUTA} minutes' as svoj_svjez
       from serija_vitrine_promet p where p.serija_id = $1 order by p.created_at desc`,
      [id, korisnik.id],
    )
  ).rows;
  const vodstvo = VODSTVO.includes(korisnik.uloga);
  const prodato = promet.reduce((z, p) => z + p.prodato, 0);
  const otpisano = promet.reduce((z, p) => z + p.otpisano, 0);
  return {
    ...s,
    prodato,
    otpisano,
    ostalo: s.komada - prodato - otpisano,
    // Ekran unaprijed zna šta smije: svoj svjež upis — bez pitanja; ostalo — odgovorno lice uz razlog, u svom prozoru.
    promet: promet.map(({ svoj_svjez, ...p }) => ({ ...p, mozePonistiti: svoj_svjez || (vodstvo && danaUnazad(p.datum) <= PROZOR[korisnik.uloga]), trebaRazlog: !svoj_svjez })),
    ...oSastojcima((await sastojciSerija([id])).get(id) ?? []),
  };
}

/** Istorija po danima: šta je napravljeno, prodato i otpisano. Zaposleni vidi od juče (#6), vodstvo do godinu dana. */
export async function istorijaVitrine(korisnik: SesijskiKorisnik, odUlaz?: string, doUlaz?: string) {
  const danas = danasCG();
  for (const d of [odUlaz, doUlaz]) if (d && !DAN.test(d)) throw new ApiGreska(400, "DATUM_NEISPRAVAN", "Datum nije ispravan.");
  const doDana = doUlaz && doUlaz < danas ? doUlaz : danas;
  let od = odUlaz ?? pomjeriDan(doDana, -6);
  if (NA_TERENU.includes(korisnik.uloga)) {
    const najranije = pomjeriDan(danas, -PROZOR[korisnik.uloga]);
    if (od < najranije) od = najranije;
    if (od > doDana) throw new ApiGreska(400, "PERIOD_VAN_PROZORA", "Zaposleni vidi vitrinu od juče — stariju istoriju vidi odgovorno lice.");
  }
  if (od > doDana) throw new ApiGreska(400, "PERIOD_NEISPRAVAN", "Početak perioda je poslije kraja.");
  if (razlikaDana(od, doDana) >= NAJDUZI_PERIOD_DANA) throw new ApiGreska(400, "PERIOD_PREDUG", "Najduži period je godinu dana.");

  const [napravljeno, promet] = await Promise.all([
    upit<{ dan: string; id: string; broj: string; naziv: string; komada: number; rok: string; izvrsilac: string }>(
      `select s.datum as dan, s.id, s.broj, s.naziv, s.komada, s.rok, s.izvrsilac from serija_vitrine s
       where s.datum between $1::date and $2::date order by s.datum desc, s.created_at`,
      [od, doDana],
    ),
    upit<{ dan: string; id: string; broj: string; naziv: string; prodato: number; otpisano: number; razlozi: string | null }>(
      `select p.datum as dan, s.id, s.broj, s.naziv, sum(p.prodato)::int as prodato, sum(p.otpisano)::int as otpisano,
              string_agg(distinct p.razlog_otpisa, ', ') as razlozi
       from serija_vitrine_promet p join serija_vitrine s on s.id = p.serija_id
       where p.datum between $1::date and $2::date
       group by p.datum, s.id, s.broj, s.naziv order by p.datum desc, s.naziv`,
      [od, doDana],
    ),
  ]);
  type Dan = { dan: string; napravljeno: typeof napravljeno.rows; promet: typeof promet.rows; ukupno: { napravljeno: number; prodato: number; otpisano: number } };
  const dani = new Map<string, Dan>();
  const zaDan = (dan: string) => {
    let d = dani.get(dan);
    if (!d) {
      d = { dan, napravljeno: [], promet: [], ukupno: { napravljeno: 0, prodato: 0, otpisano: 0 } };
      dani.set(dan, d);
    }
    return d;
  };
  for (const n of napravljeno.rows) {
    const d = zaDan(n.dan);
    d.napravljeno.push(n);
    d.ukupno.napravljeno += n.komada;
  }
  for (const p of promet.rows) {
    const d = zaDan(p.dan);
    d.promet.push(p);
    d.ukupno.prodato += p.prodato;
    d.ukupno.otpisano += p.otpisano;
  }
  const lista = Array.from(dani.values()).sort((a, b) => (a.dan < b.dan ? 1 : -1));
  return {
    od,
    do: doDana,
    dani: lista,
    ukupno: {
      napravljeno: lista.reduce((z, d) => z + d.ukupno.napravljeno, 0),
      prodato: lista.reduce((z, d) => z + d.ukupno.prodato, 0),
      otpisano: lista.reduce((z, d) => z + d.ukupno.otpisano, 0),
    },
  };
}

// ── Upis ──

export type SerijaUlaz = { naziv: string; komada: number; rok: string; datum?: string; napomena?: string; lotIds: string[] };

/** „Napravljeno“: nova serija kolača u vitrini, sa serijama sastojaka. Broj iz `sljedeciBroj` (#34). */
export async function kreirajSeriju(ulaz: SerijaUlaz, korisnik: SesijskiKorisnik, kljuc?: string) {
  const datum = ulaz.datum ?? danasCG();
  provjeriProzorUpisa(korisnik.uloga, datum);
  provjeriRok(datum, ulaz.rok);
  const lotIds = Array.from(new Set(ulaz.lotIds));
  return transakcija(async (klijent) => {
    if (kljuc) {
      const ranije = await zauzmiKljuc(klijent, korisnik.id, kljuc, "serija_vitrine");
      if (ranije?.id) return { id: String(ranije.id), broj: String(ranije.broj ?? "") };
    }
    const broj = await sljedeciBroj(klijent, "serija_vitrine", `VIT-${danasKratko()}`);
    const naziv = ulaz.naziv.trim();
    const id = (
      await klijent.query<{ id: string }>(
        `insert into serija_vitrine (broj, naziv, datum, komada, rok, napomena, izvrsilac, uneo_korisnik_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [broj, naziv, datum, ulaz.komada, ulaz.rok, ulaz.napomena?.trim() || null, izvrsilacZa(korisnik, null), korisnik.id],
      )
    ).rows[0].id;
    const sastojci: string[] = [];
    for (const lotId of lotIds) {
      sastojci.push(await provjeriLot(klijent, lotId, datum));
      await klijent.query(`insert into serija_vitrine_lot (serija_id, lot_id, dodao_korisnik_id) values ($1, $2, $3)`, [id, lotId, korisnik.id]);
    }
    await logKreiranje(klijent, {
      korisnikId: korisnik.id,
      entitetTip: "serija_vitrine",
      entitetId: id,
      noveVrijednosti: { broj, naziv, komada: ulaz.komada, datum, rok: ulaz.rok, sastojci },
    });
    if (kljuc) await upisiRezultatKljuca(klijent, korisnik.id, kljuc, { id, broj });
    return { id, broj };
  });
}

export type IzmjenaSerije = { naziv: string; komada: number; rok: string; napomena?: string };

/** Ispravka naziva, broja komada i roka — u prozoru upisa (#9), audit pamti šta je bilo (#56). */
export async function izmijeniSeriju(id: string, ulaz: IzmjenaSerije, korisnik: SesijskiKorisnik) {
  await transakcija(async (klijent) => {
    const s = await zakljucajSeriju(klijent, id);
    provjeriProzorUpisa(korisnik.uloga, s.datum);
    provjeriRok(s.datum, ulaz.rok);
    if (ulaz.komada < s.potroseno) {
      throw new ApiGreska(409, "KOMADA_MANJE", `Već je prodato ili otpisano ${s.potroseno} kom. — napravljeno ne može biti manje.`);
    }
    const kasnijaProdaja = (
      await klijent.query<{ datum: string }>(
        `select max(datum) as datum from serija_vitrine_promet where serija_id = $1 and prodato > 0 having max(datum) > $2::date`,
        [id, ulaz.rok],
      )
    ).rows[0];
    if (kasnijaProdaja) {
      throw new ApiGreska(409, "PRODATO_POSLE_ROKA", `Prodaja je upisana ${citljivo(kasnijaProdaja.datum)} — rok ne može biti raniji od toga.`);
    }
    const prije = await stanjeReda(klijent, "serija_vitrine", id);
    await klijent.query(`update serija_vitrine set naziv = $1, komada = $2, rok = $3, napomena = $4, updated_at = now() where id = $5`, [
      ulaz.naziv.trim(),
      ulaz.komada,
      ulaz.rok,
      ulaz.napomena?.trim() || null,
      id,
    ]);
    await logIzmjenaReda(klijent, { korisnikId: korisnik.id, entitetTip: "serija_vitrine", entitetId: id, prije, poslije: await stanjeReda(klijent, "serija_vitrine", id) });
  });
}

/** Zaboravljen sastojak se dopisuje dok je kolač u vitrini; posle — samo u prozoru upisa (#9). */
export async function dodajLot(id: string, lotId: string, korisnik: SesijskiKorisnik) {
  return transakcija(async (klijent) => {
    const s = await zakljucajSeriju(klijent, id);
    if (s.ostalo <= 0) provjeriProzorUpisa(korisnik.uloga, s.datum);
    const opis = await provjeriLot(klijent, lotId, s.datum);
    const novo = await klijent.query(`insert into serija_vitrine_lot (serija_id, lot_id, dodao_korisnik_id) values ($1, $2, $3) on conflict do nothing`, [id, lotId, korisnik.id]);
    if (!novo.rowCount) return { dodato: false };
    await logIzmjena(klijent, { korisnikId: korisnik.id, entitetTip: "serija_vitrine", entitetId: id, stareVrijednosti: { sastojak: null }, noveVrijednosti: { sastojak: opis } });
    return { dodato: true };
  });
}

/** Pogrešno izabran sastojak se skida samo dok se kolač nije prodavao — posle bi povlačenje moglo izostaviti kupce
 * (bolje jedan sastojak viška nego manjka); tada se dodaje pravi. */
export async function ukloniLot(id: string, lotId: string, korisnik: SesijskiKorisnik) {
  await transakcija(async (klijent) => {
    const s = await zakljucajSeriju(klijent, id);
    if (s.potroseno > 0) {
      throw new ApiGreska(409, "SASTOJAK_OSTAJE", `${s.naziv} se već prodaje — sastojak se ne skida, da povlačenje ne izostavi nijedan kolač. Ako fali pravi sastojak, dodajte ga.`);
    }
    const red = (
      await klijent.query<{ opis: string }>(
        `delete from serija_vitrine_lot sl using lot l, artikal a
         where sl.serija_id = $1 and sl.lot_id = $2 and l.id = sl.lot_id and a.id = l.artikal_id
         returning a.naziv || ' · lot ' || l.broj_lota as opis`,
        [id, lotId],
      )
    ).rows[0];
    if (!red) throw new ApiGreska(404, "SASTOJAK_NE_POSTOJI", "Taj sastojak nije upisan u ovaj kolač.");
    await logIzmjena(klijent, { korisnikId: korisnik.id, entitetTip: "serija_vitrine", entitetId: id, stareVrijednosti: { sastojak: red.opis }, noveVrijednosti: { sastojak: null, uklonjen: red.opis } });
  });
}

export type PrometUlaz = { prodato: number; otpisano: number; razlog?: string; datum?: string; prijeZadrzavanja?: boolean };

/** Prodato / otpisano za jedan dan. „Prodat 1“ je jedan upis po dodiru — upis se ne mijenja (#1). */
export async function upisiPromet(id: string, ulaz: PrometUlaz, korisnik: SesijskiKorisnik) {
  const { prodato, otpisano } = ulaz;
  if (prodato + otpisano <= 0) throw new ApiGreska(400, "KOLICINA_OBAVEZNA", "Upišite koliko je prodato ili otpisano.");
  const razlog = ulaz.razlog?.trim() || null;
  if (otpisano > 0 && (!razlog || razlog.length < 3)) {
    throw new ApiGreska(400, "RAZLOG_OBAVEZAN", "Upišite zašto se otpisuje (npr. istekao rok, oštećen, sastojak zadržan).");
  }
  const datum = ulaz.datum ?? danasCG();
  provjeriProzorUpisa(korisnik.uloga, datum);
  return transakcija(async (klijent) => {
    const s = await zakljucajSeriju(klijent, id);
    if (datum < s.datum) throw new ApiGreska(400, "DATUM_PRIJE_IZRADE", `${s.naziv} je napravljen ${citljivo(s.datum)} — prodaja i otpis ne mogu biti ranije.`);
    if (prodato > 0 && s.rok < datum) {
      throw new ApiGreska(409, "ROK_ISTEKAO", `Rok za ${s.naziv} je istekao ${citljivo(s.rok)} — ne prodaje se. Sklonite ga iz vitrine i upišite otpis.`);
    }
    let zadrzani: string[] = [];
    if (prodato > 0) {
      zadrzani = (
        await klijent.query<{ opis: string }>(
          `select a.naziv || ' (lot ' || l.broj_lota || ')' as opis from serija_vitrine_lot sl join lot l on l.id = sl.lot_id
           join artikal a on a.id = l.artikal_id where sl.serija_id = $1 and l.status in ('HOLD', 'ODBIJEN') order by 1`,
          [id],
        )
      ).rows.map((r) => r.opis);
      if (zadrzani.length > 0 && !ulaz.prijeZadrzavanja) {
        throw new ApiGreska(
          409,
          "SASTOJAK_ZADRZAN",
          `${zadrzani.join(", ")} ${zadrzani.length === 1 ? "je zadržan" : "su zadržani"} — ${s.naziv} se ne prodaje. Sklonite ga iz vitrine i upišite otpis.`,
          { zadrzani },
        );
      }
    }
    if (prodato + otpisano > s.ostalo) {
      throw new ApiGreska(
        409,
        "NEMA_U_VITRINI",
        s.ostalo > 0 ? `U vitrini je ostalo ${s.ostalo} kom. — ne može se upisati ${prodato + otpisano}.` : `${s.naziv} je već sav upisan kao prodat ili otpisan.`,
        { ostalo: s.ostalo },
      );
    }
    const prometId = (
      await klijent.query<{ id: string }>(
        `insert into serija_vitrine_promet (serija_id, datum, prodato, otpisano, razlog_otpisa, uneo_korisnik_id) values ($1, $2, $3, $4, $5, $6) returning id`,
        [id, datum, prodato, otpisano, otpisano > 0 ? razlog : null, korisnik.id],
      )
    ).rows[0].id;
    if (zadrzani.length > 0) {
      // Izuzetak se pamti: prodaja upisana dok je sastojak zadržan — pri povlačenju se zna koliko je otišlo i kad.
      await logKreiranje(klijent, {
        korisnikId: korisnik.id,
        entitetTip: "serija_vitrine",
        entitetId: id,
        noveVrijednosti: { promet: prometId, datum, prodato, prijeZadrzavanja: true, zadrzani },
      });
    }
    return { id: prometId, ostalo: s.ostalo - prodato - otpisano };
  });
}

/** Poništavanje upisa prodaje/otpisa: svoj u 10 minuta (pogrešan dodir), inače odgovorno lice uz razlog, u svom prozoru. */
export async function ponistiPromet(prometId: string, razlogUlaz: string | undefined, korisnik: SesijskiKorisnik) {
  const razlog = razlogUlaz?.trim() || null;
  return transakcija(async (klijent) => {
    const p = (
      await klijent.query<{ serija_id: string; datum: string; prodato: number; otpisano: number; razlog_otpisa: string | null; uneo_korisnik_id: string; svjez: boolean }>(
        `select serija_id, datum, prodato, otpisano, razlog_otpisa, uneo_korisnik_id, created_at > now() - interval '${PONISTI_MINUTA} minutes' as svjez
         from serija_vitrine_promet where id = $1`,
        [prometId],
      )
    ).rows[0];
    if (!p) throw new ApiGreska(404, "UPIS_NE_POSTOJI", "Upis nije pronađen — možda je već poništen.");
    const s = await zakljucajSeriju(klijent, p.serija_id);
    const svojSvjez = p.uneo_korisnik_id === korisnik.id && p.svjez;
    if (!svojSvjez) {
      if (!VODSTVO.includes(korisnik.uloga)) {
        throw new ApiGreska(
          403,
          "PONISTAVA_ODGOVORNO_LICE",
          p.uneo_korisnik_id === korisnik.id ? `Upis je stariji od ${PONISTI_MINUTA} minuta — poništava ga odgovorno lice, uz razlog.` : "Tuđi upis poništava odgovorno lice, uz razlog.",
        );
      }
      provjeriProzorUpisa(korisnik.uloga, p.datum);
      if (!razlog || razlog.length < 5) throw new ApiGreska(400, "RAZLOG_OBAVEZAN", "Upišite zašto se upis poništava (npr. upisano 5 umjesto 3).");
    }
    const obrisano = await klijent.query(`delete from serija_vitrine_promet where id = $1`, [prometId]);
    if (!obrisano.rowCount) throw new ApiGreska(404, "UPIS_NE_POSTOJI", "Upis nije pronađen — možda je već poništen.");
    const opis = `${citljivo(p.datum)}: prodato ${p.prodato}${p.otpisano > 0 ? `, otpis ${p.otpisano} (${p.razlog_otpisa})` : ""}`;
    await logIzmjena(klijent, {
      korisnikId: korisnik.id,
      entitetTip: "serija_vitrine",
      entitetId: p.serija_id,
      stareVrijednosti: { promet: opis },
      noveVrijednosti: { promet: null, ponisteno: opis, razlog: razlog ?? "pogrešan dodir (svoj upis, odmah)" },
    });
    return { ostalo: s.ostalo + p.prodato + p.otpisano };
  });
}

// ── Sledljivost ──

/** Kolači iz vitrine u kojima je bila serija ovog lota (isti dobavljač, artikal i broj lota kroz sve prijeme — R-17):
 * koliko je napravljeno, prodato po danima, otpisano i šta je još u vitrini. Kupci su bez imena — zato po danu. */
export async function vitrinaSerijeLota(lotId: string) {
  const r = await upit<{ id: string; broj: string; naziv: string; datum: string; rok: string; komada: number; sastojak: string; prodato: number; otpisano: number; prodato_po_danima: string | null }>(
    `select distinct on (s.datum, s.id) s.id, s.broj, s.naziv, s.datum, s.rok, s.komada, a.naziv || ' · lot ' || l.broj_lota as sastojak,
            coalesce((select sum(p.prodato) from serija_vitrine_promet p where p.serija_id = s.id), 0)::int as prodato,
            coalesce((select sum(p.otpisano) from serija_vitrine_promet p where p.serija_id = s.id), 0)::int as otpisano,
            (select string_agg(to_char(d.datum, 'DD.MM.') || ' — ' || d.prodato || ' kom.', ', ' order by d.datum)
               from (select p.datum, sum(p.prodato)::int as prodato from serija_vitrine_promet p
                     where p.serija_id = s.id and p.prodato > 0 group by p.datum) d) as prodato_po_danima
     from serija_vitrine_lot sl join serija_vitrine s on s.id = sl.serija_id join lot l on l.id = sl.lot_id join artikal a on a.id = l.artikal_id
     where sl.lot_id in (${SERIJA_LOTA})
     order by s.datum desc, s.id`,
    [lotId],
  );
  return r.rows.map((s) => ({ ...s, ostalo: s.komada - s.prodato - s.otpisano }));
}
