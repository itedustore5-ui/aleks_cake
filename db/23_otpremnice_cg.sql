-- Otpremnica uz prijem: PDF ili fotografija se pročita NA NAŠEM SERVERU (PDF tekst ili lokalni OCR,
-- bez spoljnih servisa), popuni formu prijema, a magacioner provjeri i potvrdi. Ništa se ne upisuje
-- samo od sebe.
--
-- Ne dira postojeće podatke — samo dodaje tabele i jednu kolonu.

-- Dokument (PDF ili slika) uz prijem. Čuva se u bazi da uđe i u bekap (pg_dump) — Render nema
-- trajan disk. prijem_id je prazan dok magacioner ne potvrdi prijem; nepotvrđeni se brišu posle 2 dana.
create table if not exists prijem_dokument (
  id uuid primary key default gen_random_uuid(),
  prijem_id uuid references prijem (id),
  vrsta varchar(10) not null,
  naziv_fajla varchar(200),
  mime varchar(100) not null,
  velicina integer not null,
  sadrzaj bytea not null,
  -- Šta je aplikacija pročitala — da se kasnije vidi šta je magacioner promijenio (lot, količina).
  procitano jsonb,
  uneo_korisnik_id uuid not null references korisnik (id),
  created_at timestamptz not null default now(),
  constraint chk_prijem_dokument_vrsta check (vrsta in ('pdf', 'slika'))
);
create index if not exists idx_prijem_dokument_prijem on prijem_dokument (prijem_id);

-- "JOG 2,8 1/1" kod dobavljača X je naš "Jogurt 2.8% 1kg". Pamti se pri potvrdi prijema, pa se
-- sljedeći put prepozna samo. kljuc = šifra dobavljača, a kad je nema — naziv malim slovima.
create table if not exists artikal_dobavljaca (
  id uuid primary key default gen_random_uuid(),
  dobavljac_id uuid not null references dobavljac (id),
  kljuc varchar(300) not null,
  sifra varchar(100),
  naziv varchar(300),
  artikal_id uuid not null references artikal (id),
  potvrdio_korisnik_id uuid references korisnik (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_artikal_dobavljaca unique (dobavljac_id, kljuc)
);

-- Stavka kako piše na otpremnici (šifra, naziv, količina, lot, rok) — da se vidi manjak
-- ("po otpremnici 50, primljeno 47") i lot koji se ne slaže sa robom.
alter table prijem_stavka add column if not exists po_otpremnici jsonb;
