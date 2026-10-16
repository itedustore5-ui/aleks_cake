-- Talas 6 (30.09.2026): rad bez interneta za vozača i magacionera (invarijanta #85).
-- Upis napravljen na telefonu bez signala stiže kasnije: vrijeme radnje je vrijeme sa telefona
-- (izmjereno_at, izvrseno_at, potvrdjeno_at), created_at je kad je stiglo — a oznaka kaže da je
-- upisano bez mreže, da se ne pomiješa sa naknadnim upisom (#10).
alter table mjerenje_temperature add column if not exists van_mreze boolean not null default false;
alter table kontrola_vozila add column if not exists van_mreze boolean not null default false;
alter table zapis add column if not exists van_mreze boolean not null default false;
alter table neusaglasenost add column if not exists van_mreze boolean not null default false;
alter table isporuka add column if not exists potvrda_van_mreze boolean not null default false;

-- Upis bez mreže koji server kasnije ODBIJE (npr. lot je u međuvremenu zadržan, a vozač je robu već
-- predao) ne smije nestati: čuva se ovdje sa svim podacima, a odgovorno lice dobija obavještenje.
create table if not exists van_mreze_odbijeno (
  id uuid primary key default gen_random_uuid(),
  korisnik_id uuid not null references korisnik (id),
  putanja text not null,
  opis text not null,
  telo jsonb,
  greska_kod text,
  greska_poruka text,
  uradjeno_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_van_mreze_odbijeno_created on van_mreze_odbijeno (created_at desc);
alter table van_mreze_odbijeno enable row level security;
