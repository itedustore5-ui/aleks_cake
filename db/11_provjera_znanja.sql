-- Provjera znanja — pojednostavljeno. NIJE zakonska obaveza; dokaz je da HACCP sistem radi
-- (čl. 36) + Vodič UBH Prilog 13/14. Banka pitanja je vidljiva samo ulozi izvodjac.
create table pitanje (
  id uuid primary key default gen_random_uuid(),
  tema varchar(100) not null,
  tekst text not null,
  ponudjeni_odgovori jsonb not null, -- ["odgovor 1", "odgovor 2", ...]
  tacan_indeks integer not null,
  aktivno boolean not null default true,
  created_at timestamptz not null default now()
);

create table sesija_znanja (
  id uuid primary key default gen_random_uuid(),
  naziv varchar(200) not null,
  broj_pitanja integer not null default 10,
  otvoren boolean not null default true,
  cuva_imena boolean not null default true,
  created_by uuid references korisnik (id),
  created_at timestamptz not null default now()
);

-- Ulazi se šifrom sa spiska zaposlenih (lice.sifra), ne posebnim nalogom.
create table ucesnik_znanja (
  id uuid primary key default gen_random_uuid(),
  sesija_id uuid not null references sesija_znanja (id),
  lice_id uuid references lice (id),
  sifra varchar(20) not null,
  ime_snapshot varchar(200),
  zavrseno_at timestamptz,
  broj_tacnih integer,
  broj_pitanja integer,
  created_at timestamptz not null default now(),
  unique (sesija_id, sifra)
);

create table odgovor_znanja (
  id uuid primary key default gen_random_uuid(),
  ucesnik_id uuid not null references ucesnik_znanja (id),
  pitanje_id uuid not null references pitanje (id),
  dat_indeks integer not null,
  tacan boolean not null,
  created_at timestamptz not null default now()
);

create index idx_odgovor_ucesnik on odgovor_znanja (ucesnik_id);
