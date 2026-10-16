-- Organizacija: firma (jedan red po instanci — jedna baza = jedan klijent) i nalozi za prijavu.
create extension if not exists pgcrypto;

create table firma (
  id uuid primary key default gen_random_uuid(),
  naziv varchar(200) not null,
  pib varchar(50),
  adresa text,
  grad varchar(100),
  telefon varchar(50),
  email varchar(255),
  odgovorno_lice_ime varchar(200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create type uloga_t as enum ('izvodjac', 'bzr', 'operater', 'vozac', 'uprava');
create type nalog_stanje_t as enum ('privremena', 'svoja', 'postavljena');

create table korisnik (
  id uuid primary key default gen_random_uuid(),
  korisnicko_ime varchar(100) not null unique,
  lozinka_hash text not null,
  lozinka_stanje nalog_stanje_t not null default 'privremena',
  mora_promijeniti_lozinku boolean not null default true,
  uloga uloga_t not null,
  lice_id uuid, -- FK dodat u 02_ljudi.sql (lice se pravi poslije korisnika kod prvog naloga)
  aktivan boolean not null default true,
  poslednja_prijava_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_korisnik_uloga on korisnik (uloga);
