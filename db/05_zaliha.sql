-- Zaliha se nikad ne mijenja ručno — svaka promjena količine ide kroz kretanje_zalihe.
create type zaliha_status_t as enum ('DOSTUPNO', 'REZERVISANO', 'KARANTIN', 'BLOKIRANO', 'ISTEKLO');

create table zaliha (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references lot (id),
  artikal_id uuid not null references artikal (id),
  kolicina numeric(12, 3) not null default 0,
  status zaliha_status_t not null default 'DOSTUPNO',
  updated_at timestamptz not null default now(),
  unique (lot_id, status)
);

create index idx_zaliha_artikal on zaliha (artikal_id);
create index idx_zaliha_status on zaliha (status);

create type kretanje_tip_t as enum ('PRIJEM', 'ISPORUKA', 'ISPRAVKA', 'HOLD', 'RELEASE', 'OTPIS');

create table kretanje_zalihe (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references lot (id),
  artikal_id uuid not null references artikal (id),
  kolicina_delta numeric(12, 3) not null,
  tip kretanje_tip_t not null,
  referenca_tip varchar(50),
  referenca_id uuid,
  izvrsio_korisnik_id uuid not null references korisnik (id),
  napomena text,
  created_at timestamptz not null default now()
);

create index idx_kretanje_lot on kretanje_zalihe (lot_id);
create index idx_kretanje_referenca on kretanje_zalihe (referenca_tip, referenca_id);
