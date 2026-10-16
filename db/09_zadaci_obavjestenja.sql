-- Zadaci i obavještenja. Zadatak mora znati iz kog poslovnog događaja je nastao.
create type zadatak_prioritet_t as enum ('NIZAK', 'SREDNJI', 'VISOK');
create type zadatak_status_t as enum ('OTVOREN', 'U_TOKU', 'ZAVRSEN', 'ZAKASNIO', 'OTKAZAN');

create table zadatak (
  id uuid primary key default gen_random_uuid(),
  naslov varchar(200) not null,
  opis text,
  dodijeljeno_korisnik_id uuid references korisnik (id),
  prioritet zadatak_prioritet_t not null default 'SREDNJI',
  status zadatak_status_t not null default 'OTVOREN',
  rok_at timestamptz,
  zavrseno_at timestamptz,
  izvor_tip varchar(50),
  izvor_id uuid,
  created_by uuid references korisnik (id),
  created_at timestamptz not null default now()
);

create index idx_zadatak_dodijeljeno on zadatak (dodijeljeno_korisnik_id);
create index idx_zadatak_status on zadatak (status);
create index idx_zadatak_rok on zadatak (rok_at);

create table obavjestenje (
  id uuid primary key default gen_random_uuid(),
  korisnik_id uuid not null references korisnik (id),
  naslov varchar(200) not null,
  poruka text,
  ozbiljnost ozbiljnost_t not null default 'SREDNJI',
  izvor_tip varchar(50),
  izvor_id uuid,
  procitano_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_obavjestenje_korisnik on obavjestenje (korisnik_id, procitano_at);
