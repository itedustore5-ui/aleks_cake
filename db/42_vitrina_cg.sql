-- Kolači iz vitrine (29.10.2026) — dnevna evidencija: atelje pravi kolače za prodaju iz vitrine, bez kupca sa imenom,
-- pa sledljivost (čl. 27) ide do SERIJE kolača i DANA prodaje, ne do kupca. Ujutru: šta je napravljeno, koliko komada,
-- rok i od kojih serija sastojaka; tokom dana / uveče: koliko je prodato, koliko otpisano (uz razlog). Ostatak u vitrini
-- se računa (napravljeno − prodato − otpisano), ne upisuje.
create table if not exists serija_vitrine (
  id uuid primary key default gen_random_uuid(),
  broj varchar(30) not null unique,
  naziv varchar(200) not null,
  datum date not null,
  komada integer not null,
  rok date not null,
  napomena text,
  izvrsilac varchar(200) not null,
  uneo_korisnik_id uuid not null references korisnik (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_serija_vitrine_komada check (komada between 1 and 10000),
  constraint chk_serija_vitrine_rok check (rok >= datum)
);
create index if not exists idx_serija_vitrine_datum on serija_vitrine (datum desc);

-- Serije sastojaka u kolaču (kao porudzbina_lot, P2): samo prihvaćen sastojak sa važećim rokom — provjera u servisu.
create table if not exists serija_vitrine_lot (
  serija_id uuid not null references serija_vitrine (id),
  lot_id uuid not null references lot (id),
  dodao_korisnik_id uuid references korisnik (id),
  created_at timestamptz not null default now(),
  primary key (serija_id, lot_id)
);
create index if not exists idx_serija_vitrine_lot_lot on serija_vitrine_lot (lot_id);

-- Promet: svaki upis je „prodato N, otpisano M“ za jedan dan. Upis se ne mijenja (#1); zbir nikad preko napravljenog
-- (servis drži red serije `for update`); otpis bez razloga se ne prima.
create table if not exists serija_vitrine_promet (
  id uuid primary key default gen_random_uuid(),
  serija_id uuid not null references serija_vitrine (id),
  datum date not null,
  prodato integer not null default 0,
  otpisano integer not null default 0,
  razlog_otpisa text,
  uneo_korisnik_id uuid not null references korisnik (id),
  created_at timestamptz not null default now(),
  constraint chk_promet_kolicine check (prodato >= 0 and otpisano >= 0 and prodato + otpisano > 0),
  constraint chk_promet_razlog check (otpisano = 0 or coalesce(btrim(razlog_otpisa), '') <> '')
);
create index if not exists idx_serija_vitrine_promet_serija on serija_vitrine_promet (serija_id, datum);

-- Kao svaka tabela (#78): RLS uključen, bez politika — javne uloge Supabase-a ne vide ništa.
alter table serija_vitrine enable row level security;
alter table serija_vitrine_lot enable row level security;
alter table serija_vitrine_promet enable row level security;

-- „Skloni iz vitrine“ (zadržan ili povučen sastojak) vodi na Vitrinu — nov izvor obavještenja, na oba mjesta (#36):
-- ovdje i u IZVORI_OBAVJESTENJA (zadaciService.ts).
alter table obavjestenje drop constraint if exists chk_obavjestenje_izvor_tip;
alter table obavjestenje add constraint chk_obavjestenje_izvor_tip check (
  izvor_tip is null or izvor_tip in ('neusaglasenost', 'povlacenje', 'lot', 'prijem', 'isporuka', 'zadatak', 'poruka', 'bekap_log', 'mjerni_uredjaj', 'verifikacija_sistema', 'porudzbina', 'serija_vitrine')
) not valid;
do $$ begin
  alter table obavjestenje validate constraint chk_obavjestenje_izvor_tip;
exception when check_violation then
  raise notice 'Stari redovi u obavjestenje ne prolaze chk_obavjestenje_izvor_tip, pravilo važi za nove upise.';
end $$;

-- Izvoz (Izvještaji, paket za inspekciju): po seriji — šta, kad, koliko, prodato po danima, otpisano, ostatak, sastojci,
-- alergeni nazivima (isti nazivi kao server/alergeni.ts i v_izvoz_porudzbine).
drop view if exists v_izvoz_vitrina;
create view v_izvoz_vitrina with (security_invoker = true) as
select
  s.broj as "Broj",
  s.datum,
  s.naziv as "Kolač",
  s.komada as "Napravljeno",
  coalesce((select sum(p.prodato) from serija_vitrine_promet p where p.serija_id = s.id), 0)::int as "Prodato",
  coalesce((select sum(p.otpisano) from serija_vitrine_promet p where p.serija_id = s.id), 0)::int as "Otpisano",
  (s.komada - coalesce((select sum(p.prodato + p.otpisano) from serija_vitrine_promet p where p.serija_id = s.id), 0))::int as "U vitrini",
  s.rok as "Rok",
  -- Po DANU, ne po upisu: „Prodat 1“ je jedan red po dodiru, pa bi dan sa 20 prodaja bio 20 stavki.
  (select string_agg(to_char(d.datum, 'DD.MM.') || ': prodato ' || d.prodato
            || case when d.otpisano > 0 then ', otpis ' || d.otpisano || coalesce(' (' || d.razlozi || ')', '') else '' end, '; ' order by d.datum)
     from (select p.datum, sum(p.prodato)::int as prodato, sum(p.otpisano)::int as otpisano, string_agg(distinct p.razlog_otpisa, ', ') as razlozi
           from serija_vitrine_promet p where p.serija_id = s.id group by p.datum) d) as "Promet po danima",
  (select string_agg(a.naziv || ' · lot ' || l.broj_lota, '; ' order by a.naziv)
     from serija_vitrine_lot sl join lot l on l.id = sl.lot_id join artikal a on a.id = l.artikal_id where sl.serija_id = s.id) as "Sastojci po seriji",
  (select string_agg(n.naziv, ', ' order by n.r) from (values
     ('GLUTEN', 'Gluten', 1), ('RAKOVI', 'Rakovi', 2), ('JAJA', 'Jaja', 3), ('RIBA', 'Riba', 4), ('KIKIRIKI', 'Kikiriki', 5),
     ('SOJA', 'Soja', 6), ('MLIJEKO', 'Mlijeko', 7), ('ORASASTI', 'Orašasti plodovi', 8), ('CELER', 'Celer', 9),
     ('SENF', 'Slačica (senf)', 10), ('SUSAM', 'Susam', 11), ('SULFITI', 'Sumpor-dioksid i sulfiti', 12), ('LUPINA', 'Lupina', 13), ('MEKUSCI', 'Mekušci', 14)
   ) as n (sifra, naziv, r)
   where n.sifra in (select x from serija_vitrine_lot sl join lot l on l.id = sl.lot_id join artikal a on a.id = l.artikal_id
                     cross join lateral unnest(a.alergeni) x where sl.serija_id = s.id)) as "Alergeni",
  s.izvrsilac as "Napravio/la",
  s.created_at as "Upisano"
from serija_vitrine s;
