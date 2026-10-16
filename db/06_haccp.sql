-- HACCP/DHP: kontrolne tačke i pravila su PODACI (versionisana), nikad hardkodovani limiti.
create table kontrolna_tacka (
  id uuid primary key default gen_random_uuid(),
  sifra varchar(20) not null unique, -- npr. KKT1 (prijem), KKT2 (skladištenje), KKT3 (vozilo)
  naziv varchar(200) not null,
  opis text,
  aktivan boolean not null default true
);

create type ozbiljnost_t as enum ('NIZAK', 'SREDNJI', 'VISOK');

create table pravilo_kontrole (
  id uuid primary key default gen_random_uuid(),
  kontrolna_tacka_id uuid not null references kontrolna_tacka (id),
  artikal_id uuid references artikal (id),
  naziv varchar(200) not null,
  min_vrijednost numeric(10, 3),
  max_vrijednost numeric(10, 3),
  jedinica varchar(10) not null default '°C',
  ozbiljnost ozbiljnost_t not null default 'SREDNJI',
  verzija integer not null default 1,
  vazi_od timestamptz not null default now(),
  vazi_do timestamptz,
  aktivan boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_pravilo_kontrole_tacka on pravilo_kontrole (kontrolna_tacka_id);
create index idx_pravilo_kontrole_artikal on pravilo_kontrole (artikal_id);

create type mjerenje_rezultat_t as enum ('PASS', 'FAIL', 'WARNING');

-- Istorijska mjerenja se ne mijenjaju. Ispravka je nov događaj/audit, ne update ovog reda.
create table mjerenje_temperature (
  id uuid primary key default gen_random_uuid(),
  kontrolna_tacka_id uuid not null references kontrolna_tacka (id),
  pravilo_kontrole_id uuid references pravilo_kontrole (id),
  lot_id uuid references lot (id),
  vozilo_id uuid, -- FK dodat u 08_vozila_isporuka.sql
  vrijednost numeric(5, 2) not null,
  jedinica varchar(10) not null default '°C',
  izmjereno_at timestamptz not null default now(),
  izmjerio_korisnik_id uuid not null references korisnik (id),
  rezultat mjerenje_rezultat_t not null,
  napomena text,
  created_at timestamptz not null default now()
);

create index idx_mjerenje_lot on mjerenje_temperature (lot_id);
create index idx_mjerenje_izmjereno_at on mjerenje_temperature (izmjereno_at);
create index idx_mjerenje_rezultat on mjerenje_temperature (rezultat);

-- Dnevni obrasci (P1/P3/P7/P8...), definisani generički kroz public/obrasci-cg.json.
-- Ispravka je NOV zapis sa ispravlja_id -> stari; važeći je onaj na koji niko ne pokazuje.
create table zapis (
  id uuid primary key default gen_random_uuid(),
  obrazac_kod varchar(20) not null,
  datum date not null,
  podaci jsonb not null default '{}'::jsonb,
  odstupanje boolean not null default false,
  korektivna_mjera text,
  izvrsilac varchar(200) not null,
  uneo_korisnik_id uuid not null references korisnik (id),
  ispravlja_id uuid references zapis (id),
  created_at timestamptz not null default now(),
  constraint chk_zapis_korektivna_mjera check (
    not odstupanje or coalesce(btrim(korektivna_mjera), '') <> ''
  )
);

create index idx_zapis_obrazac_datum on zapis (obrazac_kod, datum);
create index idx_zapis_uneo on zapis (uneo_korisnik_id);
create index idx_zapis_ispravlja on zapis (ispravlja_id);
