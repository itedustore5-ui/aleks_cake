-- Kontrolne tačke KKT 1–3 na SVAKOJ bazi, ne samo na demo (11.10.2026).
-- Do sada su nastajale samo uz demo podatke (13_demo_cg). Na novoj bazi pravog klijenta ih nije bilo, a kod
-- ih traži po šifri: prijem bez KKT 1 i predaja bez KKT 3 TIHO preskaču mjerenje i ocjenu temperature, granica
-- artikla ne postaje pravilo (#39), a „Predloži osnovni plan“ izostavlja mjerenja. Testovi to nisu vidjeli jer
-- rade na demo bazi; našao ga je test uvoza upitnika na praznu bazu.
--
-- Ovdje samo za bazu koja VEĆ ima firmu (klijent otvoren prije ove dopune). Na novoj bazi dopune idu prije firme:
-- tačke tada pravi `npm run prvi-korisnik` (zajedno sa firmom), a demo ih upisuje sam (13_demo_cg) — da
-- `migriraj` pa `seed:demo` ne padne na istoj šifri. Na demo bazi (već ima tačke) ništa se ne mijenja.
insert into kontrolna_tacka (sifra, naziv, opis)
select v.sifra, v.naziv, v.opis
from (values
  ('KKT1', 'Prijem robe', 'Kontrola temperature i ispravnosti pri prijemu'),
  ('KKT2', 'Skladištenje', 'Kontrola temperature rashladnih komora'),
  ('KKT3', 'Vozilo i isporuka', 'Kontrola vozila i temperature pri isporuci')
) as v (sifra, naziv, opis)
where exists (select 1 from firma)
  and not exists (select 1 from kontrolna_tacka k where k.sifra = v.sifra);

-- Artikli upisani dok tačaka nije bilo nemaju pravilo — dobijaju ga sa svojom granicom (isto kao dopuna 24).
insert into pravilo_kontrole (kontrolna_tacka_id, artikal_id, naziv, min_vrijednost, max_vrijednost, jedinica, ozbiljnost)
select kt.id, a.id, 'Granica artikla — ' || a.naziv, a.temp_min, a.temp_max, '°C', 'VISOK'
from artikal a
cross join kontrolna_tacka kt
where kt.sifra in ('KKT1', 'KKT3')
  and a.temp_kontrolisano and (a.temp_min is not null or a.temp_max is not null)
  and not exists (
    select 1 from pravilo_kontrole p where p.kontrolna_tacka_id = kt.id and p.artikal_id = a.id and p.aktivan
  );
