-- Povlačenje nebezbjedne hrane (čl. 28) — ko je dobio spornu seriju i da li je zvan.
-- Povlačenje počinje telefonom: kontakti se snimaju iz stvarnih isporuka tog lota, sa
-- telefonom kupca (kupac bez telefona se i ne upisuje — invarijanta #4).
create table povlacenje (
  id uuid primary key default gen_random_uuid(),
  broj varchar(30) not null unique,
  lot_id uuid not null references lot (id),
  razlog text not null,
  status varchar(20) not null default 'U_TOKU', -- U_TOKU | ZAVRSENO
  pokrenuo_korisnik_id uuid not null references korisnik (id),
  pokrenuto_at timestamptz not null default now(),
  zavrseno_at timestamptz,
  zavrsio_korisnik_id uuid references korisnik (id),
  constraint chk_povlacenje_razlog check (btrim(razlog) <> '')
);

create index idx_povlacenje_lot on povlacenje (lot_id);
create index idx_povlacenje_status on povlacenje (status);

create table povlacenje_kontakt (
  id uuid primary key default gen_random_uuid(),
  povlacenje_id uuid not null references povlacenje (id),
  isporuka_id uuid references isporuka (id),
  kupac_naziv varchar(200) not null,
  kupac_telefon varchar(50) not null,
  kolicina numeric(12, 3),
  kontaktiran boolean not null default false,
  kontaktiran_at timestamptz,
  napomena text,
  created_at timestamptz not null default now()
);

create index idx_povlacenje_kontakt_povlacenje on povlacenje_kontakt (povlacenje_id);
