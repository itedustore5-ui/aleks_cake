// „Prvi koraci“ (29.10.2026): vlasnica sama podešava atelje u aplikaciji, uz video uputstvo konsultanta — bez upitnika i
// uvoza. Svaki korak se provjerava iz baze (ne kvačicom), pa spisak sam pokazuje šta još fali. Rješenje o imenovanju se
// ne vidi u bazi (štampa se i potpisuje) — taj korak nema provjeru i ne ulazi u „urađeno“.
import { upit } from "../db.js";

export type Korak = { kod: string; naslov: string; opis: string; stanje: string; gotovo: boolean | null; opciono?: boolean };

export async function prviKoraci(korisnikId: string): Promise<{ koraci: Korak[]; uradjeno: number; ukupno: number }> {
  const s = (await upit<{
    fali_firma: string[] | null; plan: number; uredjaji: number; bez_granice: string[] | null; van_plana: string[] | null;
    termometri: number; provjereni: number; lica: number; bez_knjizice: number; nalozi: number;
    dobavljaci: number; sastojci: number; bez_alergena: number; kupci: number; telefon: number;
  }>(
    `select
       (select array_remove(array[
          case when coalesce(btrim(naziv), '') = '' then 'naziv' end,
          case when coalesce(btrim(adresa), '') = '' then 'adresa' end,
          case when coalesce(btrim(grad), '') = '' then 'grad' end,
          case when coalesce(btrim(pib), '') = '' then 'PIB' end,
          case when coalesce(btrim(odgovorno_lice_ime), '') = '' then 'odgovorno lice' end], null) from firma limit 1) as fali_firma,
       (select count(*)::int from plan_monitoringa where aktivan) as plan,
       (select count(*)::int from kontrolna_tacka where aktivan and sifra like 'KKT2%') as uredjaji,
       (select array_agg(kt.naziv order by kt.sifra) from kontrolna_tacka kt where kt.aktivan and kt.sifra like 'KKT2%'
          and not exists (select 1 from pravilo_kontrole p where p.kontrolna_tacka_id = kt.id and p.artikal_id is null and p.aktivan)) as bez_granice,
       (select array_agg(kt.naziv order by kt.sifra) from kontrolna_tacka kt where kt.aktivan and kt.sifra like 'KKT2%'
          and not exists (select 1 from plan_monitoringa pm where pm.kontrolna_tacka_id = kt.id and pm.aktivan)) as van_plana,
       (select count(*)::int from mjerni_uredjaj where aktivan) as termometri,
       (select count(*)::int from mjerni_uredjaj u where u.aktivan
          and exists (select 1 from provjera_uredjaja p where p.uredjaj_id = u.id and p.rezultat = 'ISPRAVAN')) as provjereni,
       (select count(*)::int from lice where aktivan) as lica,
       (select count(*)::int from lice where aktivan and rukuje_hranom and (sanitarna_knjizica_broj is null or sanitarna_knjizica_rok is null)) as bez_knjizice,
       (select count(*)::int from korisnik where aktivan and uloga = 'operater') as nalozi,
       (select count(*)::int from dobavljac where aktivan) as dobavljaci,
       (select count(*)::int from artikal where aktivan) as sastojci,
       (select count(*)::int from artikal where aktivan and not alergeni_upisani) as bez_alergena,
       (select count(*)::int from kupac where aktivan) as kupci,
       (select count(*)::int from push_pretplata where korisnik_id = $1) as telefon`,
    [korisnikId],
  )).rows[0];

  const faliFirma = s.fali_firma ?? ["naziv"];
  const bezGranice = s.bez_granice ?? [];
  const vanPlana = s.van_plana ?? [];
  const koraci: Korak[] = [
    {
      kod: "firma", naslov: "Podaci ateljea",
      opis: "Naziv, adresa, PIB i ime odgovornog lica idu na rješenje o imenovanju, HACCP plan i paket za inspekciju.",
      stanje: faliFirma.length ? `Fali: ${faliFirma.join(", ")}.` : "Upisano.",
      gotovo: faliFirma.length === 0,
    },
    {
      kod: "plan", naslov: "Plan mjerenja i čišćenja",
      opis: "Jednim klikom: šta se svaki dan mjeri i popunjava (frižideri 2× dnevno, čišćenje, lična higijena…), sa predloženim granicama.",
      stanje: s.plan ? `${s.plan} stavki u planu.` : "Još nije napravljen.",
      gotovo: s.plan > 0,
    },
    {
      kod: "uredjaji", naslov: "Frižideri, vitrina, zamrzivač",
      opis: "Upišite uređaje kakve stvarno imate — svaki sa svojom granicom. Koji nemate, isključite.",
      stanje: !s.uredjaji ? "Nijedan uređaj." : bezGranice.length ? `Bez granice: ${bezGranice.join(", ")}.` : vanPlana.length && s.plan ? `Nije u planu mjerenja: ${vanPlana.join(", ")}.` : `${s.uredjaji} ${s.uredjaji === 1 ? "uređaj" : "uređaja"}, svaki sa granicom.`,
      gotovo: s.uredjaji > 0 && bezGranice.length === 0 && (s.plan === 0 || vanPlana.length === 0),
    },
    {
      kod: "termometar", naslov: "Termometar",
      opis: "Upišite termometar kojim se mjeri i uradite prvu provjeru (čaša leda i vode — treba da pokaže 0 °C).",
      stanje: !s.termometri ? "Nijedan termometar." : s.provjereni ? "Upisan i provjeren." : "Upisan — čeka prvu provjeru.",
      gotovo: s.provjereni > 0,
    },
    {
      kod: "zaposleni", naslov: "Zaposleni i sanitarne knjižice",
      opis: "Svi koji rade u ateljeu; kod onih koji rukuju hranom broj knjižice i do kada važi. Ko upisuje u aplikaciji dobija nalog.",
      stanje: `U spisku: ${s.lica} · ${s.nalozi} ${s.nalozi === 1 ? "nalog" : "naloga"} zaposlenih${s.bez_knjizice ? ` · bez knjižice: ${s.bez_knjizice}` : ""}.`,
      gotovo: s.lica > 0 && s.bez_knjizice === 0,
    },
    {
      kod: "dobavljaci", naslov: "Dobavljači",
      opis: "Od koga kupujete sastojke — kad je serija sporna, zna se odakle je stigla.",
      stanje: s.dobavljaci ? `${s.dobavljaci} upisano.` : "Nijedan.",
      gotovo: s.dobavljaci > 0,
    },
    {
      kod: "sastojci", naslov: "Sastojci i alergeni",
      opis: "Sastojci koje koristite, sa alergenima sa deklaracije — iz njih se predlaže spisak alergena svake torte.",
      stanje: !s.sastojci ? "Nijedan." : s.bez_alergena ? `${s.sastojci} upisano · bez alergena: ${s.bez_alergena}.` : `${s.sastojci} upisano, svi sa alergenima.`,
      gotovo: s.sastojci > 0 && s.bez_alergena === 0,
    },
    {
      kod: "kupci", naslov: "Stalni kupci", opciono: true,
      opis: "Kafići, hoteli i sale koji redovno naručuju — u porudžbini se biraju sa spiska. Ako ih nemate, preskočite.",
      stanje: s.kupci ? `${s.kupci} upisano.` : "Nije obavezno.",
      gotovo: s.kupci > 0,
    },
    {
      kod: "rjesenje", naslov: "Rješenje o imenovanju",
      opis: "Odštampajte, potpišite i čuvajte uz HACCP plan — pisani trag ko u ateljeu vodi bezbjednost hrane.",
      stanje: "Štampa se iz Priloga.",
      gotovo: null,
    },
    {
      kod: "telefon", naslov: "Obavještenja na ovom telefonu",
      opis: "Da vam stigne poruka kad je temperatura van granice ili kad nešto čeka vašu odluku. Na iPhoneu prvo „Dodaj na početni ekran“.",
      stanje: s.telefon ? "Uključeno." : "Nije uključeno na vašem telefonu.",
      gotovo: s.telefon > 0,
    },
  ];
  const obavezni = koraci.filter((k) => k.gotovo !== null && !k.opciono);
  return { koraci, uradjeno: obavezni.filter((k) => k.gotovo).length, ukupno: obavezni.length };
}
