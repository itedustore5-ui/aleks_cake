-- Prijave (sesije) u bazi umjesto u memoriji servera.
--
-- Do sada je svaki deploy, restart ili uspavljivanje servisa na Renderu odjavljivao SVE korisnike —
-- vozač se odjavi usred ture i ne može da potvrdi isporuku dok se ne prijavi ponovo.
--
-- U bazi se čuva samo heš tokena (sha256), nikad sam token: ko pročita ovu tabelu (ili bekap),
-- ne može se njome prijaviti. Tabela namjerno NIJE u bekapu sa table.
--
-- Server ovu tabelu pravi i sam pri pokretanju ako je nema (isti `create ... if not exists`) —
-- da deploy prije pokretanja dopune ne bi zaključao sve korisnike van aplikacije.
create table if not exists sesija_prijave (
  token_hash text primary key,
  korisnik_id uuid not null references korisnik (id),
  istice_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_sesija_prijave_korisnik on sesija_prijave (korisnik_id);
create index if not exists idx_sesija_prijave_istice on sesija_prijave (istice_at);
