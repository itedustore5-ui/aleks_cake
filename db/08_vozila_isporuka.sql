-- Vozila (D1 kontrola) i isporuka kupcu (D2/D3). Isporuka se vezuje za LOT, ne za artikal
-- (invarijanta #7) — tako lot ostaje sledljiv do kupca.
create type vozilo_status_t as enum ('SPREMNO', 'NIJE_SPREMNO');

create table vozilo (
  id uuid primary key default gen_random_uuid(),
  registarski_broj varchar(30) not null unique,
  tip varchar(50),
  temp_kontrolisano boolean not null default false,
  temp_min numeric(5, 2),
  temp_max numeric(5, 2),
  status vozilo_status_t not null default 'SPREMNO',
  aktivan boolean not null default true,
  created_at timestamptz not null default now()
);

alter table mjerenje_temperature
  add constraint fk_mjerenje_vozilo foreign key (vozilo_id) references vozilo (id);

-- D1 — vidi samo vozač (sprovedeno u API-ju, ne ovdje). Kritičan fail postavlja vozilo na
-- NIJE_SPREMNO i blokira isporuku tim vozilom dok se ne ponovi provjera.
create table kontrola_vozila (
  id uuid primary key default gen_random_uuid(),
  vozilo_id uuid not null references vozilo (id),
  izvrsio_korisnik_id uuid not null references korisnik (id),
  izvrseno_at timestamptz not null default now(),
  cistoca boolean not null,
  temperatura numeric(5, 2),
  oprema_ok boolean not null,
  vrata_ok boolean not null,
  ukupan_status varchar(20) not null, -- PROSAO | NIJE_PROSAO
  napomena text,
  created_at timestamptz not null default now()
);

create index idx_kontrola_vozila_vozilo on kontrola_vozila (vozilo_id);

create type isporuka_status_t as enum ('U_PRIPREMI', 'POTVRDJENA', 'DJELIMICNA', 'ODBIJENA');

create table isporuka (
  id uuid primary key default gen_random_uuid(),
  broj varchar(30) not null unique,
  kupac_id uuid not null references kupac (id),
  vozilo_id uuid references vozilo (id),
  vozac_korisnik_id uuid references korisnik (id),
  datum_isporuke date not null,
  status isporuka_status_t not null default 'U_PRIPREMI',
  potvrdio_korisnik_id uuid references korisnik (id),
  potvrdjeno_at timestamptz,
  napomena text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_isporuka_kupac on isporuka (kupac_id);
create index idx_isporuka_datum on isporuka (datum_isporuke);
create index idx_isporuka_status on isporuka (status);

create table isporuka_stavka (
  id uuid primary key default gen_random_uuid(),
  isporuka_id uuid not null references isporuka (id),
  lot_id uuid not null references lot (id),
  planirana_kolicina numeric(12, 3) not null,
  isporucena_kolicina numeric(12, 3) not null default 0,
  odbijena_kolicina numeric(12, 3) not null default 0,
  razlog_odbijanja text,
  created_at timestamptz not null default now(),
  constraint chk_isporuka_stavka_razlog check (
    odbijena_kolicina = 0 or coalesce(btrim(razlog_odbijanja), '') <> ''
  )
);

create index idx_isporuka_stavka_isporuka on isporuka_stavka (isporuka_id);
create index idx_isporuka_stavka_lot on isporuka_stavka (lot_id);
