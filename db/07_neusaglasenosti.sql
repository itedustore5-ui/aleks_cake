-- Neusaglašenosti + korektivne mjere + verifikacija.
create type nc_status_t as enum (
  'OTVORENA', 'ISTRAGA', 'POTREBNA_MJERA', 'MJERA_U_TOKU', 'CEKA_VERIFIKACIJU', 'ZATVORENA', 'PONOVO_OTVORENA'
);

create table neusaglasenost (
  id uuid primary key default gen_random_uuid(),
  broj varchar(30) not null unique,
  ozbiljnost ozbiljnost_t not null default 'SREDNJI',
  status nc_status_t not null default 'OTVORENA',
  izvor_tip varchar(50) not null, -- 'mjerenje_temperature' | 'kontrola_vozila' | 'prijem' | 'rucno'
  izvor_id uuid,
  opis text not null,
  prijavio_korisnik_id uuid not null references korisnik (id),
  odgovorni_korisnik_id uuid references korisnik (id),
  zatvoreno_at timestamptz,
  zatvorio_korisnik_id uuid references korisnik (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_nc_status on neusaglasenost (status);
create index idx_nc_izvor on neusaglasenost (izvor_tip, izvor_id);
create index idx_nc_ozbiljnost_status on neusaglasenost (ozbiljnost, status);

-- Odstupanje bez korektivne mjere se ne snima (invarijanta #2) — sprovedeno i ovdje.
create type korektivna_status_t as enum ('OTVORENA', 'U_TOKU', 'ZAVRSENA', 'OTKAZANA');

create table korektivna_mjera (
  id uuid primary key default gen_random_uuid(),
  neusaglasenost_id uuid not null references neusaglasenost (id),
  opis text not null,
  dodijeljeno_korisnik_id uuid references korisnik (id),
  rok date,
  zavrseno_at timestamptz,
  zavrsio_korisnik_id uuid references korisnik (id),
  status korektivna_status_t not null default 'OTVORENA',
  rezultat text,
  created_at timestamptz not null default now(),
  constraint chk_korektivna_opis check (btrim(opis) <> '')
);

create index idx_korektivna_nc on korektivna_mjera (neusaglasenost_id);

-- Gdje je zahtijevana nezavisnost, verifikator ne smije biti isti kao onaj ko je završio mjeru.
create table verifikacija (
  id uuid primary key default gen_random_uuid(),
  neusaglasenost_id uuid not null references neusaglasenost (id),
  korektivna_mjera_id uuid references korektivna_mjera (id),
  verifikovao_korisnik_id uuid not null references korisnik (id),
  verifikovano_at timestamptz not null default now(),
  rezultat varchar(20) not null, -- POTVRDJENO | ODBIJENO
  napomena text
);

create index idx_verifikacija_nc on verifikacija (neusaglasenost_id);
