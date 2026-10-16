-- Više skladišta (magacina) u istoj firmi + poruke odgovornog lica i uprave zaposlenima.
--
-- Bezbjedno na živoj bazi: dodaje tabele i kolone, pravi JEDNO podrazumijevano skladište ako ga
-- nema, i veže postojeće prijeme i isporuke za njega. Firma sa jednim magacinom ne vidi nikakvu
-- razliku — izbor skladišta se u aplikaciji pojavljuje tek kad firma ima više od jednog aktivnog.

-- ── Skladišta ──────────────────────────────────────────────────────────────────────────────
-- Lot živi u skladištu u kojem je primljen (prijem.skladiste_id). Premještanje robe između
-- skladišta nije u ovoj verziji — zato se zaliha ne dijeli po skladištu, nego se skladište lota
-- čita iz njegovog prijema, a isporuka smije da nosi samo lotove iz svog skladišta.
create table if not exists skladiste (
  id uuid primary key default gen_random_uuid(),
  naziv varchar(120) not null unique,
  adresa text,
  aktivan boolean not null default true,
  created_at timestamptz not null default now()
);

insert into skladiste (naziv) select 'Glavni magacin' where not exists (select 1 from skladiste);

alter table prijem add column if not exists skladiste_id uuid references skladiste (id);
alter table isporuka add column if not exists skladiste_id uuid references skladiste (id);
-- Matično skladište naloga: podrazumijevani izbor u formama. Magacioner po potrebi radi i u
-- drugom — bira ga u formi, nalog se ne mijenja.
alter table korisnik add column if not exists skladiste_id uuid references skladiste (id);

update prijem set skladiste_id = (select id from skladiste order by created_at, naziv limit 1) where skladiste_id is null;
update isporuka set skladiste_id = (select id from skladiste order by created_at, naziv limit 1) where skladiste_id is null;

create index if not exists idx_prijem_skladiste on prijem (skladiste_id);
create index if not exists idx_isporuka_skladiste on isporuka (skladiste_id);

-- Nove kolone idu NA KRAJ — create or replace smije samo da dodaje kolone na kraj pogleda.
create or replace view v_zaliha_dostupna as
select
  z.id as zaliha_id,
  z.artikal_id,
  a.naziv as artikal_naziv,
  z.lot_id,
  l.broj_lota,
  l.rok_trajanja,
  z.kolicina,
  z.status,
  p.skladiste_id,
  s.naziv as skladiste_naziv
from zaliha z
join artikal a on a.id = z.artikal_id
join lot l on l.id = z.lot_id
left join prijem p on p.id = l.prijem_id
left join skladiste s on s.id = p.skladiste_id
where z.status = 'DOSTUPNO' and z.kolicina > 0
order by l.rok_trajanja nulls last; -- FEFO

-- `p.*` u pogledu se razvija u trenutku pravljenja — nova kolona skladiste_id ne bi ušla u izvoz
-- dok se pogled ne napravi ponovo. Redoslijed kolona se mijenja, pa drop + create.
drop view if exists v_izvoz_prijemi;
create view v_izvoz_prijemi as
select p.*, s.naziv as skladiste_naziv,
       ((p.created_at at time zone 'Europe/Podgorica')::date - p.datum_prijema) as naknadno_dana
from prijem p left join skladiste s on s.id = p.skladiste_id;

drop view if exists v_izvoz_isporuke;
create view v_izvoz_isporuke as
select i.*, s.naziv as skladiste_naziv,
       ((i.created_at at time zone 'Europe/Podgorica')::date - i.datum_isporuke) as naknadno_dana
from isporuka i left join skladiste s on s.id = i.skladiste_id;

-- ── Poruke ─────────────────────────────────────────────────────────────────────────────────
-- Poruku šalje odgovorno lice ili uprava; svaki primalac dobija je kao obavještenje
-- (obavjestenje.izvor_tip = 'poruka'). Ovdje se čuva ko je poslao, šta i kome — a ko je pročitao
-- se vidi iz obavjestenje.procitano_at. Poruka se ne briše i ne mijenja.
create table if not exists poruka (
  id uuid primary key default gen_random_uuid(),
  posiljalac_korisnik_id uuid not null references korisnik (id),
  naslov varchar(200) not null,
  tekst text,
  vazno boolean not null default false,
  primaoci_opis text not null,
  broj_primalaca integer not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_poruka_created on poruka (created_at desc);
create index if not exists idx_obavjestenje_izvor on obavjestenje (izvor_tip, izvor_id);
