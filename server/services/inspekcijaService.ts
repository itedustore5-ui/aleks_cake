// Inspekcijski paket (talas 7, prvi dio — 04.10.2026): svi zapisi za izabrani period na jednom mjestu,
// za inspektora UBH (Uredba o higijeni hrane 91/2026, čl. 7 st. 5: na zahtjev Uprave dostaviti dokaze;
// dokumentacija ažurna, evidencije se čuvaju). Ono što se prodaje: dokaz da zapisi nastaju SVAKOG
// dana, a ne noć prije inspekcije — zato paket počinje kontinuitetom (po danu, plan monitoringa,
// koliko je upisano naknadno), pa tek onda idu same evidencije.
//
// Samo čita. Isti izvori kao ostatak aplikacije: plan monitoringa iz monitoringService (#43), termometri
// i verifikacija iz haccpPlanService, granice iz pravila (#39), važeći zapis po #1, dan po Podgorici (#11).
import { upit } from "../db.js";
import { ApiGreska } from "../greske.js";
import { danasCG } from "../vrijeme.js";
import { IME, IZVOR_OZNAKA } from "./sqlDijelovi.js";
import { obrasci } from "./obrasciService.js";
import { listaUredjaja, stanjeVerifikacije, VRSTE_VERIFIKACIJE } from "./haccpPlanService.js";
import { dodajDane, pregledPlana } from "./monitoringService.js";
import { IZVORI_IZVOZA, izvezi } from "./izvozService.js";
import { napraviZip, type FajlUZipu } from "../zip.js";

const DAN = /^\d{4}-\d{2}-\d{2}$/;
/** Najduži period jednog paketa — godina; duže je spisak koji niko ne čita. */
export const NAJVISE_DANA = 366;
const PG = (kolona: string) => `(${kolona} at time zone 'Europe/Podgorica')`;

/** Početak rada u aplikaciji (30.10.2026): najraniji „važi od“ plana monitoringa ili prvi zapis — šta je ranije. Dan prije
 * toga nije „dan bez zapisa“: aplikacija se tada još nije koristila. Ništa se ne sakriva — svaki raniji zapis pomjera
 * početak unazad. */
const SQL_POCETAK_RADA = `select to_char(least(
    (select min(vazi_od) from plan_monitoringa),
    (select min(datum_prijema) from prijem),
    (select min(${PG("izmjereno_at")}::date) from mjerenje_temperature),
    (select min(datum) from zapis),
    (select min(${PG("created_at")}::date) from porudzbina),
    (select min(datum) from serija_vitrine)
  ), 'YYYY-MM-DD') as dan`;
const VRIJEME = (kolona: string) => `to_char(${PG(kolona)}, 'YYYY-MM-DD HH24:MI')`;

const razlikaDana = (od: string, doDan: string) => Math.round((Date.parse(`${doDan}T12:00:00Z`) - Date.parse(`${od}T12:00:00Z`)) / 86_400_000);

/** Period paketa: bez „do“ — danas; bez „od“ — godinu unazad. Budućnost se odsijeca na danas. */
export function periodPaketa(od?: string, doDan?: string) {
  const danas = danasCG();
  if ((od && !DAN.test(od)) || (doDan && !DAN.test(doDan))) throw new ApiGreska(400, "PERIOD_NEISPRAVAN", "Izaberite period (od – do).");
  const d = doDan && doDan < danas ? doDan : danas;
  const o = od ?? dodajDane(d, -(NAJVISE_DANA - 1));
  if (o > danas) throw new ApiGreska(400, "PERIOD_U_BUDUCNOSTI", "Period počinje poslije današnjeg dana — u njemu još nema zapisa.");
  if (o > d) throw new ApiGreska(400, "PERIOD_NEISPRAVAN", "Početak perioda je poslije kraja — zamijenite „od“ i „do“.");
  if (razlikaDana(o, d) + 1 > NAJVISE_DANA) {
    throw new ApiGreska(400, "PERIOD_PREDUG", "Paket se pravi za najviše godinu dana — izaberite kraći period (npr. prošli mjesec ili ovu godinu).");
  }
  return { od: o, do: d };
}

type Red = Record<string, unknown>;

/** Odgovori iz obrasca čitljivo: „Ima li tragova štetočina?: ne; Provjerena mjesta: magacin 1“. */
function odgovori(kod: string, podaci: unknown): string {
  const o = obrasci().find((x) => x.kod === kod);
  const p = (podaci ?? {}) as Record<string, unknown>;
  if (!o) return Object.entries(p).map(([k, v]) => `${k}: ${String(v)}`).join("; ");
  return o.polja
    .filter((polje) => p[polje.kljuc] !== undefined && p[polje.kljuc] !== null && p[polje.kljuc] !== "")
    .map((polje) => {
      const v = p[polje.kljuc];
      return `${polje.oznaka}: ${typeof v === "boolean" ? (v ? "da" : "ne") : String(v)}`;
    })
    .join("; ");
}

/** Sve za štampu (i za ekran). Svaki odjeljak je spisak redova sa čitljivim kolonama. */
export async function paket(odUlaz?: string, doUlaz?: string, izradio?: string) {
  const { od, do: doDan } = periodPaketa(odUlaz, doUlaz);
  const p = [od, doDan];
  const pocetakRada = (await upit<{ dan: string | null }>(SQL_POCETAK_RADA)).rows[0]?.dan ?? null;

  const [firma, kalendar, prijemi, mjerenja, zapisi, porudzbine, nc, povlacenja, termometriProvjere, verifikacije, zaposleni, planObuke, provjereZnanja, izmjene] = await Promise.all([
    upit(`select naziv, adresa, grad, pib, odgovorno_lice_ime from firma limit 1`),

    // Kontinuitet: koliko je zapisa nastalo svakog dana perioda (dan radnje, po Podgorici).
    upit(
      `select to_char(d.dan, 'YYYY-MM-DD') as dan, extract(isodow from d.dan)::int as dan_u_sedmici,
              (select count(*) from mjerenje_temperature m join kontrolna_tacka kt on kt.id = m.kontrolna_tacka_id
                where kt.sifra <> 'KKT1' and ${PG("m.izmjereno_at")}::date = d.dan)::int as mjerenja, -- KKT 1 je uz prijem
              (select count(*) from zapis z where z.datum = d.dan and z.ispravlja_id is null)::int as zapisi,
              (select count(*) from prijem pr where pr.datum_prijema = d.dan)::int as prijemi,
              (select count(*) from porudzbina po where po.status = 'PREDATA' and ${PG("po.predato_at")}::date = d.dan)::int as torte
       from (select g::date as dan from generate_series($1::date, $2::date, interval '1 day') g) d
       order by d.dan`,
      p,
    ),

    // KKT 1 — prijem: svaka stavka sa lotom, rokom, temperaturom (granica iz pravila, #39) i odlukom.
    upit(
      `select to_char(pr.datum_prijema, 'YYYY-MM-DD') as datum, pr.broj_dokumenta, d.naziv as dobavljac, s.naziv as magacin,
              a.naziv as artikal, a.jedinica_mjere, l.broj_lota, to_char(l.rok_trajanja, 'YYYY-MM-DD') as rok,
              ps.primljena_kolicina, ps.prihvacena_kolicina, ps.odbijena_kolicina, l.status::text as lot_status, a.temp_kontrolisano,
              m.vrijednost as temperatura, m.rezultat::text as temp_rezultat, pk.min_vrijednost as temp_min, pk.max_vrijednost as temp_max,
              u.naziv as termometar, ${IME("pr.primio_korisnik_id")} as primio, ${VRIJEME("pr.created_at")} as upisano,
              (${PG("pr.created_at")}::date - pr.datum_prijema) as naknadno_dana, pr.id as prijem_id
       from prijem_stavka ps
       join prijem pr on pr.id = ps.prijem_id
       join lot l on l.id = ps.lot_id
       join artikal a on a.id = ps.artikal_id
       join dobavljac d on d.id = pr.dobavljac_id
       left join skladiste s on s.id = pr.skladiste_id
       left join lateral (
         select x.rezultat, x.vrijednost, x.pravilo_kontrole_id, x.mjerni_uredjaj_id from mjerenje_temperature x
         join kontrolna_tacka kt on kt.id = x.kontrolna_tacka_id
         where x.lot_id = l.id and kt.sifra = 'KKT1' order by x.izmjereno_at limit 1
       ) m on true
       left join pravilo_kontrole pk on pk.id = m.pravilo_kontrole_id
       left join mjerni_uredjaj u on u.id = m.mjerni_uredjaj_id
       where pr.datum_prijema between $1 and $2
       order by pr.datum_prijema, pr.created_at, a.naziv`,
      p,
    ),

    // Mjerenja temperature osim KKT 1 (ono je uz prijem): frižideri i vitrina (KKT 2), predaja torte (KKT 3), ostalo.
    upit(
      `select ${VRIJEME("m.izmjereno_at")} as vrijeme, kt.sifra, kt.naziv as tacka, s.naziv as magacin,
              l.broj_lota, a.naziv as artikal, (select po.broj from porudzbina po where po.mjerenje_id = m.id) as porudzbina,
              m.vrijednost, pk.min_vrijednost as granica_min, pk.max_vrijednost as granica_max, m.rezultat::text as rezultat,
              u.naziv as termometar, ${IME("m.izmjerio_korisnik_id")} as izmjerio, m.van_mreze, m.napomena,
              (${PG("m.created_at")}::date - ${PG("m.izmjereno_at")}::date) as naknadno_dana
       from mjerenje_temperature m
       join kontrolna_tacka kt on kt.id = m.kontrolna_tacka_id
       left join lot l on l.id = m.lot_id
       left join artikal a on a.id = l.artikal_id
       left join skladiste s on s.id = m.skladiste_id
       left join pravilo_kontrole pk on pk.id = m.pravilo_kontrole_id
       left join mjerni_uredjaj u on u.id = m.mjerni_uredjaj_id
       where kt.sifra <> 'KKT1' and ${PG("m.izmjereno_at")}::date between $1 and $2
       order by m.izmjereno_at`,
      p,
    ),

    // Dnevni obrasci — SVE verzije: ispravka je nov zapis, a trag ostaje (#1, #57).
    upit(
      `select z.id, z.ispravlja_id, to_char(z.datum, 'YYYY-MM-DD') as datum, z.obrazac_kod, z.podaci, z.odstupanje, z.korektivna_mjera,
              z.izvrsilac, s.naziv as magacin, z.van_mreze, ${VRIJEME("z.created_at")} as upisano,
              (${PG("z.created_at")}::date - z.datum) as naknadno_dana,
              exists (select 1 from zapis n where n.ispravlja_id = z.id) as ispravljen
       from zapis z left join skladiste s on s.id = z.skladiste_id
       where z.datum between $1 and $2
       order by z.datum, z.obrazac_kod, z.created_at`,
      p,
    ),

    // Porudžbine torti (dopuna 39) sa preuzimanjem u periodu: kupac sa telefonom (čl. 28), potvrđeni alergeni (P1),
    // serije sastojaka (čl. 27, P2), predaja i temperatura (KKT 3, P3). Otkazane se vide sa razlogom.
    upit(
      `select po.broj, to_char(${PG("po.preuzimanje_at")}, 'YYYY-MM-DD HH24:MI') as preuzimanje, po.kupac_ime as kupac, po.kupac_telefon as telefon,
              case po.nacin when 'DOSTAVA' then 'dostava' else 'u ateljeu' end as nacin, po.opis, po.status, po.razlog_otkaza,
              po.alergeni, po.alergeni_potvrdjeno_at is not null as alergeni_potvrdjeni, ${IME("po.alergeni_potvrdio_korisnik_id")} as alergene_potvrdio,
              (select string_agg(a.naziv || ' · lot ' || l.broj_lota, '; ' order by a.naziv) from porudzbina_lot pl
                 join lot l on l.id = pl.lot_id join artikal a on a.id = l.artikal_id where pl.porudzbina_id = po.id) as sastojci,
              ${VRIJEME("po.predato_at")} as predato, ${IME("po.predao_korisnik_id")} as predao, po.preuzeo_ime as preuzeo,
              po.temperatura_predaje, m.rezultat::text as temp_rezultat, po.predaja_van_mreze
       from porudzbina po left join mjerenje_temperature m on m.id = po.mjerenje_id
       where ${PG("po.preuzimanje_at")}::date between $1 and $2
       order by po.preuzimanje_at, po.broj`,
      p,
    ),

    // Neusaglašenosti aktivne u periodu: nastale do kraja perioda, a nisu zatvorene prije njegovog početka.
    upit(
      `select nc.broj, to_char(${PG("nc.created_at")}, 'YYYY-MM-DD') as datum, nc.ozbiljnost::text as ozbiljnost, nc.status::text as status,
              nc.opis, ${IZVOR_OZNAKA} as izvor, ${IME("nc.prijavio_korisnik_id")} as prijavio,
              mj.opis as mjera, mj.rezultat as uradjeno, mj.uradio, mj.zavrseno,
              vf.rezultat::text as provjera, vf.provjerio, vf.provjereno, vf.izuzetak_cetiri_oka,
              to_char(${PG("nc.zatvoreno_at")}, 'YYYY-MM-DD') as zatvoreno
       from neusaglasenost nc
       left join lateral (
         select m.opis, m.rezultat, ${IME("m.zavrsio_korisnik_id")} as uradio, to_char(${PG("m.zavrseno_at")}, 'YYYY-MM-DD') as zavrseno
         from korektivna_mjera m where m.neusaglasenost_id = nc.id order by m.created_at desc limit 1
       ) mj on true
       left join lateral (
         select v.rezultat, ${IME("v.verifikovao_korisnik_id")} as provjerio, to_char(${PG("v.verifikovano_at")}, 'YYYY-MM-DD') as provjereno, v.izuzetak_cetiri_oka
         from verifikacija v where v.neusaglasenost_id = nc.id order by v.verifikovano_at desc limit 1
       ) vf on true
       where ${PG("nc.created_at")}::date <= $2 and (nc.zatvoreno_at is null or ${PG("nc.zatvoreno_at")}::date >= $1)
       order by nc.created_at`,
      p,
    ),

    // Povlačenja (čl. 28) aktivna u periodu.
    upit(
      `select pv.broj, to_char(${PG("pv.pokrenuto_at")}, 'YYYY-MM-DD') as pokrenuto, a.naziv as artikal, l.broj_lota, pv.razlog, pv.status,
              (select count(*) from povlacenje_kontakt k where k.povlacenje_id = pv.id)::int as kupaca,
              (select count(*) from povlacenje_kontakt k where k.povlacenje_id = pv.id and k.kontaktiran)::int as obavijesteno,
              to_char(${PG("pv.zavrseno_at")}, 'YYYY-MM-DD') as zavrseno
       from povlacenje pv join lot l on l.id = pv.lot_id join artikal a on a.id = l.artikal_id
       where ${PG("pv.pokrenuto_at")}::date <= $2 and (pv.zavrseno_at is null or ${PG("pv.zavrseno_at")}::date >= $1)
       order by pv.pokrenuto_at`,
      p,
    ),

    upit(
      `select to_char(pu.datum, 'YYYY-MM-DD') as datum, u.naziv as uredjaj, u.oznaka, pu.vrsta, pu.referentna, pu.izmjereno,
              pu.rezultat, pu.broj_sertifikata, pu.izvrsilac
       from provjera_uredjaja pu join mjerni_uredjaj u on u.id = pu.uredjaj_id
       where pu.datum between $1 and $2 order by pu.datum, u.naziv`,
      p,
    ),

    upit(
      `select vs.vrsta, to_char(vs.datum, 'YYYY-MM-DD') as datum, vs.izvrsilac, vs.nalaz, vs.zakljucak, to_char(vs.sljedeca_do, 'YYYY-MM-DD') as sljedeca_do
       from verifikacija_sistema vs where vs.datum between $1 and $2 order by vs.datum`,
      p,
    ),

    // Sanitarne knjižice (Zakon o zaštiti stanovništva od zaraznih bolesti, čl. 31): broj i rok — nikad nalaz (#15).
    upit(
      `select l.ime, l.radno_mjesto, l.sanitarna_knjizica_broj, to_char(l.sanitarna_knjizica_rok, 'YYYY-MM-DD') as knjizica_rok
       from lice l where l.aktivan and l.rukuje_hranom order by l.ime`,
    ),

    upit(
      `select lice_ime, radno_mjesto, tema, to_char(planirani_datum, 'YYYY-MM-DD') as planirano, to_char(obavljeno_datum, 'YYYY-MM-DD') as obavljeno, stanje
       from v_plan_obuke
       where planirani_datum between $1 and $2 or obavljeno_datum between $1 and $2
       order by planirani_datum, lice_ime`,
      p,
    ),

    // Provjera znanja: po terminu, bez imena (rezultat pojedinca nije za inspektora — dokaz je da se radi).
    upit(
      `select s.naziv, to_char(min(${PG("u.zavrseno_at")})::date, 'YYYY-MM-DD') as od, to_char(max(${PG("u.zavrseno_at")})::date, 'YYYY-MM-DD') as do,
              count(*)::int as ucesnika, round(avg(100.0 * u.broj_tacnih / nullif(u.broj_pitanja, 0)))::int as prosjek
       from ucesnik_znanja u join sesija_znanja s on s.id = u.sesija_id
       where u.zavrseno_at is not null and ${PG("u.zavrseno_at")}::date between $1 and $2
       group by s.id, s.naziv order by 2`,
      p,
    ),

    // Izmjene podataka od početka rada — bez naloga i lozinki (to je administracija, ne podatak o hrani).
    upit<{ n: number }>(
      `select count(*)::int as n from audit_log where akcija = 'IZMJENA' and entitet_tip <> 'korisnik'
         and ${PG("created_at")}::date between greatest($1::date, coalesce($3::date, $1::date)) and $2::date`,
      [od, doDan, pocetakRada],
    ),
  ]);

  const [plan, uredjaji, verifikacijaStanje] = await Promise.all([pregledPlana(od, doDan), listaUredjaja(true), stanjeVerifikacije()]);

  // ── Kontinuitet: koliko je upisano istog dana, koliko naknadno (#10), koliko ljudi upisuje ──────────
  const nazivObrasca = new Map(obrasci().map((o) => [o.kod, o.naziv]));
  const zapisiRedovi = zapisi.rows.map((z: Red) => ({
    datum: z.datum,
    obrazac_kod: z.obrazac_kod,
    obrazac: nazivObrasca.get(String(z.obrazac_kod)) ?? z.obrazac_kod,
    odgovori: odgovori(String(z.obrazac_kod), z.podaci),
    odstupanje: z.odstupanje,
    korektivna_mjera: z.korektivna_mjera,
    izvrsilac: z.izvrsilac,
    magacin: z.magacin,
    upisano: z.upisano,
    naknadno_dana: z.naknadno_dana,
    van_mreze: z.van_mreze,
    // Verzija: važeći (na njega niko ne pokazuje), zamijenjen ispravkom, ili je sam ispravka.
    verzija: z.ispravljen ? "zamijenjen ispravkom" : z.ispravlja_id ? "ispravka" : "važeći",
  }));
  const prviZapisi = zapisi.rows.filter((z: Red) => !z.ispravlja_id);
  const prijemiJednom = [...new Map(prijemi.rows.map((r: Red) => [r.prijem_id, r])).values()];
  const naknadno = (redovi: Red[]) => redovi.filter((r) => Number(r.naknadno_dana) > 0).length;
  const grupe = [
    { naziv: "Prijemi robe", ukupno: prijemiJednom.length, naknadno: naknadno(prijemiJednom) },
    { naziv: "Mjerenja temperature", ukupno: mjerenja.rows.length, naknadno: naknadno(mjerenja.rows) },
    { naziv: "Dnevni obrasci", ukupno: prviZapisi.length, naknadno: naknadno(prviZapisi) },
  ];
  const ukupno = grupe.reduce((z, g) => z + g.ukupno, 0);
  const ukupnoNaknadno = grupe.reduce((z, g) => z + g.naknadno, 0);
  const osobe = new Set(
    [
      ...prijemi.rows.map((r: Red) => r.primio),
      ...mjerenja.rows.map((r: Red) => r.izmjerio),
      ...prviZapisi.map((r: Red) => r.izvrsilac),
      ...porudzbine.rows.map((r: Red) => r.predao),
    ].filter(Boolean) as string[],
  );
  const dani: (Red & { prije_pocetka: boolean })[] = kalendar.rows.map((d: Red) => ({ ...d, prije_pocetka: pocetakRada !== null && String(d.dan) < pocetakRada }));
  const daniSaZapisom = dani.filter((d) => Number(d.mjerenja) + Number(d.zapisi) + Number(d.prijemi) > 0).length;
  const radniDani = dani.filter((d) => Number(d.dan_u_sedmici) !== 7 && !d.prije_pocetka).length;
  const vanMreze =
    mjerenja.rows.filter((r: Red) => r.van_mreze).length +
    prviZapisi.filter((r: Red) => r.van_mreze).length +
    porudzbine.rows.filter((r: Red) => r.predaja_van_mreze).length;

  // ── Sanitarne knjižice: stanje u periodu, ne samo danas ─────────────────────────────────────────
  const knjizice = zaposleni.rows.map((z: Red) => {
    const rok = z.knjizica_rok as string | null;
    const stanje = !rok ? "NIJE_UPISAN" : rok < od ? "ISTEKLA_PRIJE" : rok <= doDan ? "ISTEKLA_U_PERIODU" : "VAZILA";
    return { ...z, stanje };
  });

  const planIzvrsenje = plan.stavke.map((s) => ({
    naziv: s.naziv,
    ucestalost: s.ucestalost,
    puta: s.puta,
    magacin: s.skladiste_naziv,
    periodaUkupno: s.periodaUkupno,
    uradjeno: s.periodaUkupno - s.propusteno.length,
    propusteno: s.propusteno.map((x) => ({ od: x.od, do: x.do, uradjeno: x.uradjeno })),
  }));

  return {
    firma: firma.rows[0] ?? null,
    period: { od, do: doDan, dana: razlikaDana(od, doDan) + 1 },
    izradjeno: { vrijeme: new Date().toISOString(), izradio: izradio ?? null },
    sazetak: {
      grupe,
      ukupno,
      naknadno: ukupnoNaknadno,
      istogDana: ukupno ? Math.round((100 * (ukupno - ukupnoNaknadno)) / ukupno) : null,
      osoba: osobe.size,
      daniSaZapisom,
      radniDani,
      vanMreze,
      izmjenaPodataka: izmjene.rows[0]?.n ?? 0,
      torti: porudzbine.rows.filter((r: Red) => r.status === "PREDATA").length,
      neusaglasenosti: nc.rows.length,
      neusaglasenostiOtvorene: nc.rows.filter((n: Red) => n.status !== "ZATVORENA").length,
      povlacenja: povlacenja.rows.length,
      mjerenjaVanGranice: mjerenja.rows.filter((m: Red) => m.rezultat === "FAIL").length + prijemi.rows.filter((m: Red) => m.temp_rezultat === "FAIL").length,
      planPropusteno: planIzvrsenje.reduce((z, s) => z + s.propusteno.length, 0),
      planPerioda: planIzvrsenje.reduce((z, s) => z + s.periodaUkupno, 0),
    },
    kalendar: dani,
    pocetakRada,
    plan: { do: plan.do, stavke: planIzvrsenje },
    prijemi: prijemi.rows.map(({ prijem_id: _id, ...r }: Red) => r),
    mjerenja: mjerenja.rows,
    zapisi: zapisiRedovi,
    porudzbine: porudzbine.rows,
    neusaglasenosti: nc.rows,
    povlacenja: povlacenja.rows,
    termometri: { provjere: termometriProvjere.rows, stanje: uredjaji },
    verifikacija: {
      uPeriodu: verifikacije.rows.map((v: Red) => ({ ...v, naziv: VRSTE_VERIFIKACIJE[v.vrsta as keyof typeof VRSTE_VERIFIKACIJE]?.naziv ?? v.vrsta })),
      stanje: verifikacijaStanje,
    },
    knjizice,
    obuka: { plan: planObuke.rows, provjere: provjereZnanja.rows },
  };
}

/** Podaci iz paketa kao CSV fajlovi u ZIP-u — za inspektora koji traži da mu se dokazi DOSTAVE
 * (čl. 7 st. 5 Uredbe). Isti izvori i isti filter po vremenu kao Izvještaji (#88). Dnevnik izmjena
 * (audit) ne ide — nosi i adrese uređaja zaposlenih; daje se na zahtjev iz Izvještaja. Izvor koga nema
 * u bazi ne obara paket (#30) — piše se u SADRZAJ.txt. */
export async function paketZip(odUlaz?: string, doUlaz?: string, firmaNaziv?: string) {
  const { od, do: doDan } = periodPaketa(odUlaz, doUlaz);
  const fajlovi: FajlUZipu[] = [];
  const spisak: string[] = [];
  const nedostaje: string[] = [];
  let i = 0;
  for (const izvor of IZVORI_IZVOZA.filter((x) => x.kod !== "audit")) {
    try {
      const { naziv, csv, redova } = await izvezi(izvor.kod, { od, do: doDan });
      i += 1;
      const ime = `${String(i).padStart(2, "0")}-${izvor.kod}.csv`;
      fajlovi.push({ ime, sadrzaj: csv });
      spisak.push(`${ime.padEnd(30)} ${naziv} — ${redova} ${redova === 1 ? "red" : "redova"}${izvor.kod === "lica" ? " (spisak zaposlenih, bez obzira na period)" : ""}`);
    } catch (e) {
      nedostaje.push(`${izvor.naziv}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const sadrzaj = [
    `INSPEKCIJSKI PAKET — PODACI${firmaNaziv ? ` · ${firmaNaziv}` : ""}`,
    `Period: ${od} – ${doDan} (dan po podgoričkom vremenu). Izrađeno: ${new Date().toLocaleString("sr-Latn-ME", { timeZone: "Europe/Podgorica" })}.`,
    "",
    "Fajlovi su CSV (razdvajač ;, UTF-8) — otvaraju se u Excelu. Vrijeme je po podgoričkom satu.",
    "Kolona naknadno_dana: za koliko dana POSLIJE dana na koji se odnosi je zapis upisan (0 = isti dan).",
    "Dnevni obrasci P3–P10 su po Vodiču UBH; ostali radni obrasci su obrasci firme, ne zvanični obrasci.",
    "",
    ...spisak,
    ...(nedostaje.length ? ["", "Nije uključeno (izvor trenutno nije dostupan u bazi):", ...nedostaje] : []),
    "",
    "Dnevnik izmjena (audit) nije u paketu — dostavlja se na zahtjev.",
  ].join("\r\n");
  fajlovi.unshift({ ime: "SADRZAJ.txt", sadrzaj: `﻿${sadrzaj}\r\n` });
  return { od, do: doDan, zip: napraviZip(fajlovi) };
}
