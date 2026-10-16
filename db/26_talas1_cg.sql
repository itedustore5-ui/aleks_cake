-- Prvi talas popravki posle revizije 25.09.2026 (nalazi R-01, R-10).

-- R-01: zaliha ne smije u minus. Stari redovi se provjeravaju posebno: ako ih na nekoj bazi ima
-- u minusu, ograničenje i dalje važi za sve nove upise, a stari se ispravljaju ručno.
alter table zaliha add constraint zaliha_kolicina_nenegativna check (kolicina >= 0) not valid;
do $$ begin
  alter table zaliha validate constraint zaliha_kolicina_nenegativna;
exception when check_violation then
  raise notice 'Na ovoj bazi ima zalihe u minusu — ograničenje važi za nove upise, stare redove ispraviti ručno.';
end $$;

-- Stavka isporuke: planirano > 0, predato i odbijeno nisu negativni i zajedno ne prelaze planirano.
alter table isporuka_stavka add constraint isporuka_stavka_kolicine check (
  planirana_kolicina > 0 and isporucena_kolicina >= 0 and odbijena_kolicina >= 0
  and isporucena_kolicina + odbijena_kolicina <= planirana_kolicina
) not valid;
do $$ begin
  alter table isporuka_stavka validate constraint isporuka_stavka_kolicine;
exception when check_violation then
  raise notice 'Na ovoj bazi ima stavki isporuke sa nemogućim količinama — ograničenje važi za nove upise.';
end $$;

-- R-10: ključ zahtjeva. Isti ključ istog korisnika vraća prvi rezultat umjesto drugog upisa
-- (dupli klik, ponovljen zahtjev kad je odgovor izgubljen na slaboj mreži). Čisti se posle 2 dana.
create table if not exists kljuc_zahtjeva (
  korisnik_id uuid not null references korisnik (id),
  kljuc varchar(80) not null,
  radnja varchar(40) not null,
  rezultat jsonb,
  created_at timestamptz not null default now(),
  primary key (korisnik_id, kljuc)
);
create index if not exists idx_kljuc_zahtjeva_created on kljuc_zahtjeva (created_at);
