-- Porudžbina torte (PILOT Poslastičarnica, 18.10.2026 — PLAN.md 8.5 C). NIJE distributerska isporuka: nema
-- zalihe po količini, rezervacije ni vozila. Svaka torta ima kupca sa telefonom (#4), alergene koje je ČOVJEK
-- potvrdio prije predaje (P1) i serije ključnih sastojaka koje su ušle u nju (P2) — da se na pitanje
-- „serija jaja je sporna, kome su otišle torte?“ odgovori telefonom.
--
-- Statusi su tekst sa CHECK-om, ne enum: nova vrijednost enuma se ne smije koristiti u istoj transakciji
-- (vidi „Naučeno“), a ovdje je spisak mali i stabilan.

create table if not exists porudzbina (
  id uuid primary key default gen_random_uuid(),
  broj varchar(30) not null unique,
  kupac_ime varchar(200) not null,
  kupac_telefon varchar(50) not null,
  preuzimanje_at timestamptz not null,
  nacin varchar(10) not null default 'PREUZIMA',
  adresa_dostave text,
  opis text not null,
  napomena text,
  status varchar(12) not null default 'PRIMLJENA',
  -- Potvrđeni alergeni torte (P1). Predlog iz sastojaka se ne čuva — računa se iz lotova; čuva se ono što je
  -- čovjek potvrdio, ko i kada. Novi sastojak sa alergenom koga nema u potvrđenom poništava potvrdu.
  alergeni varchar(20)[] not null default '{}',
  alergeni_potvrdio_korisnik_id uuid references korisnik (id),
  alergeni_potvrdjeno_at timestamptz,
  -- Predaja kupcu: ko je predao (potpis je ime, #23), kome, kada; kod dostave i temperatura (KKT 3, pravilo
  -- kontrole — P3, granica nikad u kodu). Bez mreže (#85): vrijeme sa telefona + oznaka.
  predao_korisnik_id uuid references korisnik (id),
  predato_at timestamptz,
  predaja_van_mreze boolean not null default false,
  preuzeo_ime varchar(200),
  temperatura_predaje numeric(5, 2),
  mjerni_uredjaj_id uuid references mjerni_uredjaj (id),
  mjerenje_id uuid references mjerenje_temperature (id),
  otkazao_korisnik_id uuid references korisnik (id),
  otkazano_at timestamptz,
  razlog_otkaza text,
  uneo_korisnik_id uuid not null references korisnik (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_porudzbina_ime check (btrim(kupac_ime) <> ''),
  constraint chk_porudzbina_telefon check (btrim(kupac_telefon) <> ''),
  constraint chk_porudzbina_opis check (btrim(opis) <> ''),
  constraint chk_porudzbina_nacin check (nacin in ('PREUZIMA', 'DOSTAVA')),
  constraint chk_porudzbina_adresa check (nacin <> 'DOSTAVA' or coalesce(btrim(adresa_dostave), '') <> ''),
  constraint chk_porudzbina_status check (status in ('PRIMLJENA', 'U_IZRADI', 'PREDATA', 'OTKAZANA')),
  constraint chk_porudzbina_alergeni check (
    alergeni <@ array['GLUTEN', 'RAKOVI', 'JAJA', 'RIBA', 'KIKIRIKI', 'SOJA', 'MLIJEKO', 'ORASASTI', 'CELER', 'SENF', 'SUSAM', 'SULFITI', 'LUPINA', 'MEKUSCI']::varchar(20)[]
  ),
  -- P1 i u bazi: predata torta ima potvrđene alergene, ko je predao i kada.
  constraint chk_porudzbina_predata check (status <> 'PREDATA' or (predato_at is not null and predao_korisnik_id is not null and alergeni_potvrdjeno_at is not null)),
  constraint chk_porudzbina_otkaz check (status <> 'OTKAZANA' or (otkazano_at is not null and otkazao_korisnik_id is not null and coalesce(btrim(razlog_otkaza), '') <> ''))
);
create index if not exists idx_porudzbina_preuzimanje on porudzbina (preuzimanje_at);
create index if not exists idx_porudzbina_status on porudzbina (status);

-- Koja serija sastojka je ušla u tortu (P2, faza 1 — lotovi ključnih sastojaka: jaja, pavlaka, maskarpone…).
-- Dok torta nije predata, veza se smije skinuti (pogrešno izabran lot) — uz audit; poslije predaje ne.
create table if not exists porudzbina_lot (
  id uuid primary key default gen_random_uuid(),
  porudzbina_id uuid not null references porudzbina (id),
  lot_id uuid not null references lot (id),
  dodao_korisnik_id uuid not null references korisnik (id),
  created_at timestamptz not null default now(),
  constraint uq_porudzbina_lot unique (porudzbina_id, lot_id)
);
create index if not exists idx_porudzbina_lot_lot on porudzbina_lot (lot_id);

-- Povlačenje (čl. 28) zove i kupce torti, ne samo kupce isporuka.
alter table povlacenje_kontakt add column if not exists porudzbina_id uuid references porudzbina (id);

-- Nov izvor (#36): reklamacija ili problem na porudžbini, i obavještenje „Ne predajte tortu“. Isti spisak kao
-- IZVORI_OBAVJESTENJA u zadaciService.ts i šema u routes/neusaglasenosti.ts.
alter table neusaglasenost drop constraint if exists chk_neusaglasenost_izvor_tip;
alter table neusaglasenost add constraint chk_neusaglasenost_izvor_tip check (
  izvor_tip in ('mjerenje_temperature', 'kontrola_vozila', 'povlacenje', 'zapis', 'rucno', 'isporuka', 'prijem', 'mjerni_uredjaj', 'porudzbina')
) not valid;
alter table obavjestenje drop constraint if exists chk_obavjestenje_izvor_tip;
alter table obavjestenje add constraint chk_obavjestenje_izvor_tip check (
  izvor_tip is null or izvor_tip in ('neusaglasenost', 'povlacenje', 'lot', 'prijem', 'isporuka', 'zadatak', 'poruka', 'bekap_log', 'mjerni_uredjaj', 'verifikacija_sistema', 'porudzbina')
) not valid;
do $$
declare o record;
begin
  for o in select * from (values ('neusaglasenost', 'chk_neusaglasenost_izvor_tip'), ('obavjestenje', 'chk_obavjestenje_izvor_tip')) as x (tabela, naziv)
  loop
    begin
      execute format('alter table %I validate constraint %I', o.tabela, o.naziv);
    exception when check_violation then
      raise notice 'Stari redovi u % ne prolaze %, pravilo važi za nove upise.', o.tabela, o.naziv;
    end;
  end loop;
end $$;

-- Sledljivost unaprijed: lot (cijela serija se traži u servisu) → torte → kupci sa telefonom.
drop view if exists v_sledljivost_porudzbine;
create view v_sledljivost_porudzbine with (security_invoker = true) as
select
  pl.lot_id,
  l.broj_lota,
  l.rok_trajanja,
  a.naziv as artikal,
  d.naziv as dobavljac,
  p.id as porudzbina_id,
  p.broj as porudzbina_broj,
  p.kupac_ime,
  p.kupac_telefon,
  p.preuzimanje_at,
  p.status,
  p.predato_at,
  p.opis
from porudzbina_lot pl
join porudzbina p on p.id = pl.porudzbina_id
join lot l on l.id = pl.lot_id
join artikal a on a.id = l.artikal_id
join dobavljac d on d.id = l.dobavljac_id;

-- Za Izvještaje i inspekcijski paket (ZIP): sve porudžbine sa alergenima i serijama sastojaka.
drop view if exists v_izvoz_porudzbine;
create view v_izvoz_porudzbine with (security_invoker = true) as
select
  p.broj as "Broj",
  (p.preuzimanje_at at time zone 'Europe/Podgorica')::date as datum,
  to_char(p.preuzimanje_at at time zone 'Europe/Podgorica', 'HH24:MI') as "Vrijeme preuzimanja",
  p.kupac_ime as "Kupac",
  p.kupac_telefon as "Telefon",
  case p.nacin when 'DOSTAVA' then 'dostava' else 'preuzima u ateljeu' end as "Način",
  p.opis as "Opis torte",
  p.status,
  -- Nazivi, ne šifre — inspektor i kupac čitaju „Jaja, Mlijeko“ (isti nazivi kao server/alergeni.ts).
  (select string_agg(n.naziv, ', ' order by n.r) from (values
     ('GLUTEN', 'Gluten', 1), ('RAKOVI', 'Rakovi', 2), ('JAJA', 'Jaja', 3), ('RIBA', 'Riba', 4), ('KIKIRIKI', 'Kikiriki', 5),
     ('SOJA', 'Soja', 6), ('MLIJEKO', 'Mlijeko', 7), ('ORASASTI', 'Orašasti plodovi', 8), ('CELER', 'Celer', 9),
     ('SENF', 'Slačica (senf)', 10), ('SUSAM', 'Susam', 11), ('SULFITI', 'Sumpor-dioksid i sulfiti', 12), ('LUPINA', 'Lupina', 13), ('MEKUSCI', 'Mekušci', 14)
   ) as n (sifra, naziv, r) where n.sifra = any(p.alergeni)) as "Alergeni",
  (select coalesce(l.ime, k.korisnicko_ime) from korisnik k left join lice l on l.id = k.lice_id where k.id = p.alergeni_potvrdio_korisnik_id) as "Alergene potvrdio",
  (select string_agg(a.naziv || ' · lot ' || lo.broj_lota, '; ' order by a.naziv) from porudzbina_lot pl join lot lo on lo.id = pl.lot_id join artikal a on a.id = lo.artikal_id where pl.porudzbina_id = p.id) as "Sastojci po seriji",
  p.predato_at as "Predato",
  (select coalesce(l.ime, k.korisnicko_ime) from korisnik k left join lice l on l.id = k.lice_id where k.id = p.predao_korisnik_id) as "Predao",
  p.preuzeo_ime as "Preuzeo",
  p.temperatura_predaje as "Temperatura pri predaji",
  p.predaja_van_mreze as "Bez mreže",
  p.razlog_otkaza as "Razlog otkaza",
  p.created_at as "Upisano"
from porudzbina p;

-- Kao svaka tabela (#78): RLS uključen, bez politika — javne uloge Supabase-a ne vide ništa.
alter table porudzbina enable row level security;
alter table porudzbina_lot enable row level security;
