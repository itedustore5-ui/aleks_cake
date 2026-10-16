-- Šifarnici: dobavljači, kupci, artikli, interni razlozi/opasnosti.
create table dobavljac (
  id uuid primary key default gen_random_uuid(),
  naziv varchar(200) not null,
  pib varchar(50),
  adresa text,
  telefon varchar(50),
  email varchar(255),
  aktivan boolean not null default true,
  created_at timestamptz not null default now()
);

-- Kupac bez telefona se ne upisuje — povlačenje po čl. 28 počinje telefonom.
create table kupac (
  id uuid primary key default gen_random_uuid(),
  naziv varchar(200) not null,
  adresa text,
  telefon varchar(50) not null,
  email varchar(255),
  aktivan boolean not null default true,
  created_at timestamptz not null default now()
);

-- granica_potvrdio: dok je prazno, temp. opseg je pretpostavka konsultanta, ne podatak
-- klijenta — automatska ocjena odstupanja se ne smije po njemu odbijati robu.
create table artikal (
  id uuid primary key default gen_random_uuid(),
  sifra varchar(50) unique,
  naziv varchar(200) not null,
  jedinica_mjere varchar(20) not null default 'kom',
  zahtijeva_lot boolean not null default true,
  temp_kontrolisano boolean not null default false,
  temp_min numeric(5, 2),
  temp_max numeric(5, 2),
  rok_trajanja_dana integer,
  granica_potvrdio boolean not null default false,
  aktivan boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table razlog_sifra (
  id uuid primary key default gen_random_uuid(),
  kod varchar(20) not null unique,
  opis varchar(200) not null,
  aktivan boolean not null default true
);

create table opasnost_sifra (
  id uuid primary key default gen_random_uuid(),
  kod varchar(20) not null unique,
  opis varchar(200) not null,
  tip varchar(30), -- BIOLOSKA / HEMIJSKA / FIZICKA
  aktivan boolean not null default true
);
