-- Invarijanta #10: naknadan unos se ne krije. naknadno_dana = za koliko dana je zapis unesen
-- POSLIJE datuma na koji se odnosi (dan po podgoričkom vremenu, ne UTC). 0 = unesen istog dana.
-- Ne dira podatke — samo pogledi za izvoz.

create or replace view v_trag_ispravki as
select
  t.id,
  t.obrazac_kod,
  t.datum,
  t.izvrsilac,
  t.ispravlja_id,
  t.created_at,
  not exists(select 1 from zapis n where n.ispravlja_id = t.id) as vazeci,
  ((t.created_at at time zone 'Europe/Podgorica')::date - t.datum) as naknadno_dana
from zapis t;

create view v_izvoz_prijemi as
select p.*, ((p.created_at at time zone 'Europe/Podgorica')::date - p.datum_prijema) as naknadno_dana
from prijem p;

create view v_izvoz_isporuke as
select i.*, ((i.created_at at time zone 'Europe/Podgorica')::date - i.datum_isporuke) as naknadno_dana
from isporuka i;
