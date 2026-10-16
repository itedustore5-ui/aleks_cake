-- Pitanja firme i prag prolaza na provjeri znanja.
--
-- Do sada je banka pitanja bila samo konsultantova (invarijanta #14) i odgovorno lice nije moglo
-- da unese nijedno pitanje. Sada postoje DVA izvora pitanja:
--   'konsultant' — banka konsultanta; odgovorno lice je i dalje NE VIDI (da mjerenje ostane pošteno)
--   'firma'      — pitanja koja unosi odgovorno lice, o procedurama svoje firme; ona ih vidi i
--                  vidi statistiku po pitanju
-- Termin provjere bira odakle se uzimaju pitanja i koliki je prag za "prošao".
--
-- Ne dira podatke: sva postojeća pitanja ostaju konsultantova, svi postojeći termini "sva pitanja, 70 %".
alter table pitanje add column if not exists izvor varchar(20) not null default 'konsultant';
alter table pitanje add column if not exists created_by uuid references korisnik (id);

do $$
begin
  alter table pitanje add constraint chk_pitanje_izvor check (izvor in ('konsultant', 'firma'));
exception when duplicate_object then null;
end $$;

alter table sesija_znanja add column if not exists prag_prolaza integer not null default 70;
alter table sesija_znanja add column if not exists izvor_pitanja varchar(20) not null default 'sva';

do $$
begin
  alter table sesija_znanja add constraint chk_sesija_prag check (prag_prolaza between 1 and 100);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table sesija_znanja add constraint chk_sesija_izvor check (izvor_pitanja in ('sva', 'firma', 'konsultant'));
exception when duplicate_object then null;
end $$;
