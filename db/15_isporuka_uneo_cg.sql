-- Isporuka nije imala kolonu za "ko je unio zapis" — filter "vidim samo svoje" (samoMoje)
-- je zato gledao vozac_korisnik_id (dodijeljeni vozač na isporuci — polje koje forma i ne
-- šalje, pa je skoro uvijek prazno). Posljedica: operater/vozač bi kreirao isporuku, ona bi
-- se uspješno sačuvala, ali bi odmah nestala iz njegove liste — izgledalo je kao da ništa
-- nije uneseno. Ne dira postojeće podatke.
alter table isporuka add column uneo_korisnik_id uuid references korisnik (id);
create index idx_isporuka_uneo on isporuka (uneo_korisnik_id);

-- Isti pogrešan izvor je hranio i v_sledljivost_nazad (izvještajna kolona, trenutno se nigdje
-- u pregledaču ne prikazuje, ali je nosila pogrešan podatak).
drop view if exists v_sledljivost_nazad;
create view v_sledljivost_nazad as
select
  ku.naziv as kupac,
  ku.telefon as kupac_telefon,
  isp.id as isporuka_id,
  isp.broj as isporuka_broj,
  isp.datum_isporuke,
  isp.uneo_korisnik_id,
  lo.id as lot_id,
  lo.broj_lota,
  a.naziv as artikal,
  p.id as prijem_id,
  p.datum_prijema,
  d.naziv as dobavljac
from isporuka isp
join kupac ku on ku.id = isp.kupac_id
join isporuka_stavka ist on ist.isporuka_id = isp.id
join lot lo on lo.id = ist.lot_id
join artikal a on a.id = lo.artikal_id
join prijem p on p.id = lo.prijem_id
join dobavljac d on d.id = p.dobavljac_id;
