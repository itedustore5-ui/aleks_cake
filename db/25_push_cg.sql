-- Push obavještenja na telefon (nalaz A6, faza 4). Obavještenje stiže i kad je aplikacija
-- zatvorena, a telefon zaključan — preko push servisa pregledača (Google, Apple, Mozilla).
-- Sadržaj je šifrovan za taj uređaj (RFC 8291): push servis ga prenosi, ali ne može pročitati.

-- Jedan red po uređaju (pregledač na telefonu/računaru) na kom je korisnik uključio obavještenja.
create table if not exists push_pretplata (
  id uuid primary key default gen_random_uuid(),
  korisnik_id uuid not null references korisnik (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  uredjaj text,
  created_at timestamptz not null default now(),
  poslednje_slanje_at timestamptz
);
create index if not exists idx_push_pretplata_korisnik on push_pretplata (korisnik_id);

-- VAPID ključ servera — jedan po bazi (= po klijentu). Pravi ga server sam pri prvom pokretanju,
-- osim ako su VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY zadati u okruženju.
create table if not exists web_push_kljuc (
  id smallint primary key default 1 check (id = 1),
  javni text not null,
  privatni text not null,
  created_at timestamptz not null default now()
);

-- Izlazni red: obavještenje se šalje kad je transakcija koja ga je upisala potvrđena (server ga
-- vidi tek tada), najviše jednom. Stara obavještenja se ne šalju — sve dosadašnje označeno kao poslato.
alter table obavjestenje add column if not exists push_poslato_at timestamptz;
update obavjestenje set push_poslato_at = created_at where push_poslato_at is null;
create index if not exists idx_obavjestenje_push_ceka on obavjestenje (created_at) where push_poslato_at is null;
