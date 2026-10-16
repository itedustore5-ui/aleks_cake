-- Talas 5 (29.09.2026): potvrda u dva koraka (2FA, TOTP) za vodstvo i dnevnik grešaka.
-- Nove tabele odmah sa RLS-om (invarijanta #78) — javne uloge Supabase-a ne vide ništa.

-- ── Potvrda u dva koraka ──
-- Tajna se ne vidi nigdje osim pri uključivanju (QR kod); ne ide u audit ni u bekap iz aplikacije (#68).
-- totp_ukljucen_at prazno + tajna upisana = uključivanje započeto, a kod još nije potvrđen.
-- totp_zadnji_korak: isti kod ne važi dvaput (onaj ko ga vidi preko ramena ne može ga ponoviti).
-- totp_rezervni: heševi rezervnih kodova (za izgubljen telefon) — iskorišćen se briše sa spiska.
alter table korisnik
  add column if not exists totp_tajna text,
  add column if not exists totp_ukljucen_at timestamptz,
  add column if not exists totp_zadnji_korak bigint,
  add column if not exists totp_rezervni text[] not null default '{}';

-- Drugi korak prijave: posle ispravne lozinke nalog sa 2FA dobija izazov (5 minuta, najviše 5
-- pokušaja), a sesiju tek uz ispravan kod. U bazi samo heš izazova.
create table if not exists prijava_izazov (
  token_hash text primary key,
  korisnik_id uuid not null references korisnik (id) on delete cascade,
  istice_at timestamptz not null,
  pokusaji int not null default 0,
  created_at timestamptz not null default now()
);
alter table prijava_izazov enable row level security;

-- ── Dnevnik grešaka ──
-- Greška servera (500), pad ekrana u pregledaču i neuhvaćena greška procesa — da konsultant sazna
-- prije nego što klijent nazove. Bez spoljnog servisa. Čuva se 90 dana.
create table if not exists greska_log (
  id bigserial primary key,
  vrijeme timestamptz not null default now(),
  izvor text not null check (izvor in ('server', 'pregledac', 'proces')),
  metod text,
  putanja text,
  status int,
  kod text,
  poruka text not null,
  detalji text,
  korisnik_id uuid,
  izdanje text
);
create index if not exists idx_greska_log_vrijeme on greska_log (vrijeme desc);
alter table greska_log enable row level security;
