-- „Stanje poslovanja“ po rasporedu (27.10.2026): dodatak koji konsultant uključuje klijentu koji ga plati — mejl
-- vlasnici svaki dan, svake sedmice, svakog mjeseca ili kvartala. Izvještaj i dalje vidi samo konsultant (#93).
-- Server svaki sat pogleda: kad se posljednji ZAVRŠENI period izabrane vrste završio na dan uključivanja ili kasnije,
-- a još nije poslat — pošalje ga sam (stanjeService.posaljiPoRasporedu). Bez ritma (null) se ništa ne šalje samo.
alter table firma add column if not exists izvjestaj_ritam varchar(20);
alter table firma add column if not exists izvjestaj_ritam_od date;
do $$ begin
  alter table firma add constraint chk_firma_izvjestaj_ritam check (izvjestaj_ritam is null or izvjestaj_ritam in ('dan', 'sedmica', 'mjesec', 'kvartal'));
exception when duplicate_object then null; end $$;

-- Trag zna da li je izvještaj poslat ručno (konsultant) ili po rasporedu.
alter table izvjestaj_poslat add column if not exists automatski boolean not null default false;
-- Isti period po rasporedu ide jednom — i kad dva procesa provjeravaju u isto vrijeme (drugi čeka, pa odustane).
create unique index if not exists uq_izvjestaj_poslat_automatski on izvjestaj_poslat (vrsta, period_od) where automatski;
