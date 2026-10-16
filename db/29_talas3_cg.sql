-- Treći talas popravki posle revizije 25.09.2026 (nalazi R-14, R-15, R-17, R-28).

-- R-15: otkaz isporuke — ko, kad i zašto. Otkazana isporuka bez razloga ne postoji.
alter table isporuka add column if not exists otkazano_at timestamptz;
alter table isporuka add column if not exists otkazao_korisnik_id uuid references korisnik (id);
alter table isporuka add column if not exists razlog_otkaza text;
alter table isporuka drop constraint if exists isporuka_otkaz_razlog;
alter table isporuka add constraint isporuka_otkaz_razlog check (
  status <> 'OTKAZANA' or (coalesce(btrim(razlog_otkaza), '') <> '' and otkazano_at is not null)
);
-- `i.*` se razvija pri pravljenju pogleda — nove kolone ulaze u izvoz tek sa novim pogledom (B5).
drop view if exists v_izvoz_isporuke;
create view v_izvoz_isporuke as
select i.*, s.naziv as skladiste_naziv,
       ((i.created_at at time zone 'Europe/Podgorica')::date - i.datum_isporuke) as naknadno_dana
from isporuka i left join skladiste s on s.id = i.skladiste_id;

-- R-17: rok trajanja se upisuje pri prijemu (po artiklu — konsultant isključuje za izuzetke).
-- Bez roka nema FEFO-a ni blokade istekle robe.
alter table artikal add column if not exists rok_obavezan boolean not null default true;

-- R-17: ista serija (artikal + broj lota) se u jednom prijemu upisuje jednom, sa ukupnom količinom.
do $$ begin
  create unique index if not exists uq_lot_serija_u_prijemu on lot (prijem_id, artikal_id, upper(btrim(broj_lota)));
exception when unique_violation then
  raise notice 'Na ovoj bazi ima prijema sa istom serijom dvaput — pravilo važi u aplikaciji, stare redove pregledati ručno.';
end $$;
-- Serija kroz više prijema (isti dobavljač, artikal, broj lota) je jedna serija za povlačenje.
create index if not exists idx_lot_serija on lot (artikal_id, dobavljac_id, upper(btrim(broj_lota)));

-- R-28: kupac ima PIB i adresu isporuke (otpremnica); PIB kupca i dobavljača je jedinstven.
alter table kupac add column if not exists pib varchar(20);
alter table kupac add column if not exists adresa_isporuke text;
do $$ begin
  create unique index if not exists uq_kupac_pib on kupac (btrim(pib)) where pib is not null and btrim(pib) <> '';
exception when unique_violation then
  raise notice 'Na ovoj bazi ima kupaca sa istim PIB-om — pravilo važi za nove upise.';
end $$;
do $$ begin
  create unique index if not exists uq_dobavljac_pib on dobavljac (btrim(pib)) where pib is not null and btrim(pib) <> '';
exception when unique_violation then
  raise notice 'Na ovoj bazi ima dobavljača sa istim PIB-om — pravilo važi za nove upise.';
end $$;

-- R-14: rezervacija. Isporuka u pripremi drži robu lota: slobodno = na zalihi − rezervisano za
-- isporuke u pripremi. Rezervacija nije kretanje robe (roba je i dalje na polici), pa se računa,
-- ne upisuje — otkaz ili izmjena isporuke je oslobađa sama.
create or replace view v_zaliha_dostupna as
select
  z.id as zaliha_id,
  z.artikal_id,
  a.naziv as artikal_naziv,
  z.lot_id,
  l.broj_lota,
  l.rok_trajanja,
  z.kolicina,
  z.status,
  p.skladiste_id,
  s.naziv as skladiste_naziv,
  r.rezervisano,
  greatest(z.kolicina - r.rezervisano, 0) as slobodno
from zaliha z
join artikal a on a.id = z.artikal_id
join lot l on l.id = z.lot_id
left join prijem p on p.id = l.prijem_id
left join skladiste s on s.id = p.skladiste_id
cross join lateral (
  select coalesce(sum(ist.planirana_kolicina), 0) as rezervisano
  from isporuka_stavka ist join isporuka i on i.id = ist.isporuka_id
  where ist.lot_id = z.lot_id and i.status = 'U_PRIPREMI'
) r
where z.status = 'DOSTUPNO' and z.kolicina > 0
order by l.rok_trajanja nulls last; -- FEFO
