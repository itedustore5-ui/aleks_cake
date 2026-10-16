-- Pogledi: sledljivost, ljudi, plan obuke, trag ispravki, izvoz, evidencija osposobljavanja.
-- Kolone u v_izvoz_sledljivost su CSV zaglavlja — ne mijenjati ih bez razloga (izvoz.html čita
-- direktno iz njih).

create view v_lica as
select
  l.id,
  l.ime,
  l.radno_mjesto,
  l.rukuje_hranom,
  l.sifra,
  l.sanitarna_knjizica_broj,
  l.sanitarna_knjizica_rok,
  case
    when not l.rukuje_hranom then null
    when l.sanitarna_knjizica_rok is null then 'NEPOZNATO'
    when l.sanitarna_knjizica_rok < (now() at time zone 'Europe/Podgorica')::date then 'ISTEKLA'
    when l.sanitarna_knjizica_rok < (now() at time zone 'Europe/Podgorica')::date + 30 then 'USKORO'
    else 'VAZI'
  end as knjizica_status,
  exists(select 1 from korisnik k where k.lice_id = l.id and k.aktivan) as ima_nalog,
  l.aktivan,
  l.created_at
from lice l;

create view v_plan_obuke as
select
  p.id,
  p.lice_id,
  l.ime as lice_ime,
  l.radno_mjesto,
  p.tema,
  p.planirani_datum,
  p.obavljeno_datum,
  p.napomena,
  case
    when p.obavljeno_datum is not null then 'URADJENO'
    when p.planirani_datum < (now() at time zone 'Europe/Podgorica')::date then 'KASNI'
    when p.planirani_datum <= (now() at time zone 'Europe/Podgorica')::date + 30 then 'USKORO'
    else 'PLANIRANO'
  end as stanje
from plan_obuke p
join lice l on l.id = p.lice_id;

-- Važeći zapis je onaj na koji niko ne pokazuje (invarijanta #1) — NIKAD ispravlja_id is null.
create view v_trag_ispravki as
select
  t.id,
  t.obrazac_kod,
  t.datum,
  t.izvrsilac,
  t.ispravlja_id,
  t.created_at,
  not exists(select 1 from zapis n where n.ispravlja_id = t.id) as vazeci
from zapis t;

create view v_zaliha_dostupna as
select
  z.id as zaliha_id,
  z.artikal_id,
  a.naziv as artikal_naziv,
  z.lot_id,
  l.broj_lota,
  l.rok_trajanja,
  z.kolicina,
  z.status
from zaliha z
join artikal a on a.id = z.artikal_id
join lot l on l.id = z.lot_id
where z.status = 'DOSTUPNO' and z.kolicina > 0
order by l.rok_trajanja nulls last; -- FEFO

create view v_sledljivost_naprijed as
select
  d.naziv as dobavljac,
  p.id as prijem_id,
  p.broj_dokumenta,
  p.datum_prijema,
  p.primio_korisnik_id as uneo_korisnik_id,
  lo.id as lot_id,
  lo.broj_lota,
  lo.rok_trajanja,
  a.naziv as artikal,
  lo.status as lot_status,
  ist.id as isporuka_stavka_id,
  isp.broj as isporuka_broj,
  isp.datum_isporuke,
  ku.naziv as kupac,
  ku.telefon as kupac_telefon,
  isp.status as isporuka_status
from prijem p
join dobavljac d on d.id = p.dobavljac_id
join lot lo on lo.prijem_id = p.id
join artikal a on a.id = lo.artikal_id
left join isporuka_stavka ist on ist.lot_id = lo.id
left join isporuka isp on isp.id = ist.isporuka_id
left join kupac ku on ku.id = isp.kupac_id;

create view v_sledljivost_nazad as
select
  ku.naziv as kupac,
  ku.telefon as kupac_telefon,
  isp.id as isporuka_id,
  isp.broj as isporuka_broj,
  isp.datum_isporuke,
  isp.vozac_korisnik_id as uneo_korisnik_id,
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

create view v_izvoz_sledljivost as
select
  d.naziv as "Dobavljač",
  p.datum_prijema as "Datum prijema",
  p.broj_dokumenta as "Broj dokumenta",
  a.naziv as "Artikal",
  lo.broj_lota as "Broj lota",
  lo.rok_trajanja as "Rok trajanja",
  lo.status as "Status lota",
  isp.datum_isporuke as "Datum isporuke",
  isp.broj as "Broj isporuke",
  ku.naziv as "Kupac",
  ku.telefon as "Telefon kupca",
  ist.isporucena_kolicina as "Isporučena količina"
from lot lo
join artikal a on a.id = lo.artikal_id
join prijem p on p.id = lo.prijem_id
join dobavljac d on d.id = p.dobavljac_id
left join isporuka_stavka ist on ist.lot_id = lo.id
left join isporuka isp on isp.id = ist.isporuka_id
left join kupac ku on ku.id = isp.kupac_id;

create view v_evidencija_osposobljavanja as
select
  l.id as lice_id,
  l.ime,
  l.radno_mjesto,
  max(u.zavrseno_at) as posljednja_provjera_at,
  (array_agg(u.broj_tacnih order by u.zavrseno_at desc))[1] as posljednji_broj_tacnih,
  (array_agg(u.broj_pitanja order by u.zavrseno_at desc))[1] as posljednji_broj_pitanja,
  (array_agg(s.naziv order by u.zavrseno_at desc))[1] as posljednja_sesija
from lice l
left join ucesnik_znanja u on u.lice_id = l.id and u.zavrseno_at is not null
left join sesija_znanja s on s.id = u.sesija_id
group by l.id, l.ime, l.radno_mjesto;
