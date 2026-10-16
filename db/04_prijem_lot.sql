-- Prijem robe i LOT — LOT je centralni objekat sledljivosti (čl. 27).
create type prijem_status_t as enum (
  'U_TOKU', 'CEKA_ODLUKU', 'PRIHVACEN', 'DJELIMICNO_PRIHVACEN', 'ODBIJEN', 'ZATVOREN'
);

create table prijem (
  id uuid primary key default gen_random_uuid(),
  dobavljac_id uuid not null references dobavljac (id),
  broj_dokumenta varchar(100),
  datum_prijema date not null,
  status prijem_status_t not null default 'U_TOKU',
  primio_korisnik_id uuid not null references korisnik (id),
  odluku_donio_korisnik_id uuid references korisnik (id),
  odluka_at timestamptz,
  napomena text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_prijem_datum on prijem (datum_prijema);
create index idx_prijem_status on prijem (status);

create type lot_status_t as enum (
  'PRIMLJEN', 'KARANTIN', 'PRIHVACEN', 'HOLD', 'ODBIJEN', 'ISTEKAO', 'ISTROSEN'
);

-- Broj lota je obavezan (čl. 27 — sledljivost počinje označavanjem serije). Bez njega nema
-- prijema stavke.
create table lot (
  id uuid primary key default gen_random_uuid(),
  artikal_id uuid not null references artikal (id),
  dobavljac_id uuid not null references dobavljac (id),
  prijem_id uuid not null references prijem (id),
  broj_lota varchar(100) not null,
  proizvodni_datum date,
  rok_trajanja date,
  status lot_status_t not null default 'PRIMLJEN',
  primljena_kolicina numeric(12, 3) not null default 0,
  prihvacena_kolicina numeric(12, 3) not null default 0,
  odbijena_kolicina numeric(12, 3) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_lot_broj_lota check (btrim(broj_lota) <> '')
);

create index idx_lot_broj_lota on lot (broj_lota);
create index idx_lot_artikal on lot (artikal_id);
create index idx_lot_rok_trajanja on lot (rok_trajanja);
create index idx_lot_status on lot (status);

create table prijem_stavka (
  id uuid primary key default gen_random_uuid(),
  prijem_id uuid not null references prijem (id),
  artikal_id uuid not null references artikal (id),
  lot_id uuid not null references lot (id),
  ocekivana_kolicina numeric(12, 3),
  primljena_kolicina numeric(12, 3) not null,
  prihvacena_kolicina numeric(12, 3) not null default 0,
  odbijena_kolicina numeric(12, 3) not null default 0,
  temperatura_prijema numeric(5, 2),
  napomena text,
  created_at timestamptz not null default now()
);

create index idx_prijem_stavka_prijem on prijem_stavka (prijem_id);
create index idx_prijem_stavka_lot on prijem_stavka (lot_id);
