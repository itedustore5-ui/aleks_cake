-- Demo podaci — SAMO za demo bazu (prodajni sastanci), nikad za pravog klijenta.
-- Fiksni UUID-i (čitljivi, sa prefiksom po tipu) da bi seed korisnika u alati/prvi-korisnik.ts
-- i db/migriraj.ts mogao da referencira ista lica bez dodatnog upita.

insert into firma (naziv, pib, adresa, grad, telefon, email, odgovorno_lice_ime) values
  ('Demo Distribucija d.o.o.', '02987654', 'Cetinjski put 15', 'Podgorica', '+382 67 111 222', 'info@demo-distribucija.me', 'Ana Backović');

insert into lice (id, ime, radno_mjesto, rukuje_hranom, sifra, sanitarna_knjizica_broj, sanitarna_knjizica_rok) values
  ('10000000-0000-0000-0000-000000000001', 'Ana Backović', 'Odgovorno lice za bezbjednost hrane', true, 'M-01', 'SK-2024-0091', current_date + 200),
  ('10000000-0000-0000-0000-000000000002', 'Marko Vuković', 'Magacioner', true, 'M-02', 'SK-2024-0114', current_date + 12),
  ('10000000-0000-0000-0000-000000000003', 'Petar Jovanović', 'Vozač', true, 'M-03', 'SK-2023-0087', current_date - 5),
  ('10000000-0000-0000-0000-000000000004', 'Nina Radulović', 'Magacionerka', true, 'M-04', 'SK-2024-0155', current_date + 300),
  ('10000000-0000-0000-0000-000000000005', 'Đorđe Perović', 'Direktor', false, 'M-05', null, null);

-- Demo nalozi za prijavu — lozinke ispod su scrypt heš vrijednosti unaprijed izračunatih
-- lozinki (dokumentovano u README-u). Fiksni ID-jevi da bi ostatak ovog fajla mogao da ih
-- referencira kao izvršioce/prijavioce (korisnik_id kolone su NOT NULL).
insert into korisnik (id, korisnicko_ime, lozinka_hash, lozinka_stanje, mora_promijeniti_lozinku, uloga, lice_id) values
  ('11000000-0000-0000-0000-000000000001', 'konsultant', 'scrypt$36adde754dbb7b4490186672ce50a266$e289881804a5d9c8d7ff1918a9078e97af8bd11853d4a019349c6f6ffa0a1a510771aaadb920428632a7ee6986b196a268bfd9952b4d8149d71a6013b8918bda', 'postavljena', false, 'izvodjac', null),
  ('11000000-0000-0000-0000-000000000002', 'ana.b', 'scrypt$d77fc3c8f7bbcbf2dd4a88079d3c0d49$16921067fda93531c1ca627181ebfe64aff4bb1cd3664920b63509558a361c9f5d6a920dbf1d41a932d146d9e2c9f105d8fd7d9f88abffeebeab0b526fa82018', 'postavljena', false, 'bzr', '10000000-0000-0000-0000-000000000001'),
  ('11000000-0000-0000-0000-000000000003', 'marko.v', 'scrypt$f69f30b1dac9ca55ad2f68534a88da07$b1ca38fb02827762ecc3c2e7df255bfc2106949e107f569070dee8d077266057f8c33898b35b2a2e4a9cc56975fa1cfd79e66c5a20dd4c3a670141eb8806b5cb', 'postavljena', false, 'operater', '10000000-0000-0000-0000-000000000002'),
  ('11000000-0000-0000-0000-000000000004', 'petar.j', 'scrypt$6a96b6471b14e39b89faac93b300eb4e$9a4f17177d77b2f3f523aa717213eb865b52f642ff37de1d333c704b5aefbd927755a0c6a9c7a0cb39ad3b72b2d215bcb52e5641dd03f5e4b979ad9a11a4b676', 'postavljena', false, 'vozac', '10000000-0000-0000-0000-000000000003'),
  ('11000000-0000-0000-0000-000000000005', 'direktor', 'scrypt$be7e5378181d443f462ce642cf707f3a$5d46fef6c102a76382f8caf1c9b3761c5ff42486fcbf46baaccb0813414d17dec5f85799d41f1d95a7c91c085970c373df7b21043dc5945213a9be88d4070920', 'postavljena', false, 'uprava', '10000000-0000-0000-0000-000000000005');

insert into dobavljac (id, naziv, pib, adresa, telefon, email) values
  ('20000000-0000-0000-0000-000000000001', 'Mljekara Bjelasica d.o.o.', '02334455', 'Industrijska zona bb, Bijelo Polje', '+382 50 432 100', 'prodaja@bjelasica.me'),
  ('20000000-0000-0000-0000-000000000002', 'Adriatic Frost d.o.o.', '02556677', 'Luka bb, Bar', '+382 30 311 200', 'komerc@adriaticfrost.me'),
  ('20000000-0000-0000-0000-000000000003', 'Zeta Pekara a.d.', '02998811', 'Zetska bb, Podgorica', '+382 20 655 300', 'nabavka@zetapekara.me');

insert into kupac (id, naziv, adresa, telefon, email) values
  ('30000000-0000-0000-0000-000000000001', 'Market Voli 04', 'Bulevar Sv. Petra Cetinjskog 21', '+382 67 200 100', null),
  ('30000000-0000-0000-0000-000000000002', 'Restoran Galion', 'Stari grad bb', '+382 68 300 200', 'galion@kotor.me'),
  ('30000000-0000-0000-0000-000000000003', 'Hotel Splendid', 'Bečićka bb', '+382 33 410 500', 'nabavka@splendid.me'),
  ('30000000-0000-0000-0000-000000000004', 'Aroma Market', 'Njegoševa 5', '+382 41 220 330', null);

insert into artikal (id, sifra, naziv, jedinica_mjere, zahtijeva_lot, temp_kontrolisano, temp_min, temp_max, rok_trajanja_dana, granica_potvrdio) values
  ('40000000-0000-0000-0000-000000000001', 'MLK-001', 'Jogurt 2.8% 1kg', 'kom', true, true, 0, 5, 21, true),
  ('40000000-0000-0000-0000-000000000002', 'MLK-002', 'Sir Edamer 250g', 'kom', true, true, 0, 5, 45, true),
  ('40000000-0000-0000-0000-000000000003', 'FRZ-018', 'Smrznuti grašak 450g', 'kom', true, true, -20, -15, 365, true),
  ('40000000-0000-0000-0000-000000000004', 'FRZ-021', 'Pileći file smrznuti 500g', 'kom', true, true, -20, -15, 270, true),
  ('40000000-0000-0000-0000-000000000005', 'PEK-005', 'Hljeb polubijeli 500g', 'kom', true, false, null, null, 3, false),
  ('40000000-0000-0000-0000-000000000006', 'MLK-003', 'Mlijeko 3.2% 1L', 'kom', true, true, 0, 5, 10, true);

insert into kontrolna_tacka (id, sifra, naziv, opis) values
  ('50000000-0000-0000-0000-000000000001', 'KKT1', 'Prijem robe', 'Kontrola temperature i ispravnosti pri prijemu'),
  ('50000000-0000-0000-0000-000000000002', 'KKT2', 'Skladištenje', 'Kontrola temperature rashladnih komora'),
  ('50000000-0000-0000-0000-000000000003', 'KKT3', 'Vozilo i isporuka', 'Kontrola vozila i temperature pri isporuci');

insert into pravilo_kontrole (kontrolna_tacka_id, artikal_id, naziv, min_vrijednost, max_vrijednost, jedinica, ozbiljnost) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'Temperatura pri prijemu — rashlađeno', 0, 5, '°C', 'VISOK'),
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000003', 'Temperatura pri prijemu — smrznuto', -20, -15, '°C', 'VISOK'),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 'Komora K-02 — rashlađeno', 0, 5, '°C', 'VISOK'),
  ('50000000-0000-0000-0000-000000000003', null, 'Vozilo — rashladni režim', 0, 5, '°C', 'SREDNJI');

-- Prijemi i lotovi
insert into prijem (id, dobavljac_id, broj_dokumenta, datum_prijema, status, primio_korisnik_id, odluka_at) values
  ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'FR-88412', current_date - 3, 'PRIHVACEN', '11000000-0000-0000-0000-000000000003', now() - interval '3 days'),
  ('60000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'AF-22891', current_date - 2, 'PRIHVACEN', '11000000-0000-0000-0000-000000000003', now() - interval '2 days'),
  ('60000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'ZP-11082', current_date, 'CEKA_ODLUKU', '11000000-0000-0000-0000-000000000003', null);

insert into lot (id, artikal_id, dobavljac_id, prijem_id, broj_lota, proizvodni_datum, rok_trajanja, status, primljena_kolicina, prihvacena_kolicina) values
  ('70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'LOT-2609-A', current_date - 5, current_date + 16, 'PRIHVACEN', 400, 400),
  ('70000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'LOT-2609-B', current_date - 5, current_date + 5, 'PRIHVACEN', 300, 300),
  ('70000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', 'LOT-1902-F', current_date - 40, current_date + 300, 'PRIHVACEN', 250, 250),
  ('70000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'LOT-2508-E', current_date - 10, current_date + 1, 'HOLD', 120, 0),
  ('70000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000003', 'LOT-2009-P', current_date, current_date + 3, 'PRIMLJEN', 80, 0);

insert into prijem_stavka (prijem_id, artikal_id, lot_id, ocekivana_kolicina, primljena_kolicina, prihvacena_kolicina, temperatura_prijema) values
  ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 400, 400, 400, 3.2),
  ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000006', '70000000-0000-0000-0000-000000000002', 300, 300, 300, 3.8),
  ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000004', 120, 120, 0, 8.6),
  ('60000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000003', 250, 250, 250, -18.0),
  ('60000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000005', '70000000-0000-0000-0000-000000000005', 80, 80, 0, null);

insert into zaliha (lot_id, artikal_id, kolicina, status) values
  ('70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 340, 'DOSTUPNO'),
  ('70000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000006', 300, 'DOSTUPNO'),
  ('70000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', 250, 'DOSTUPNO'),
  ('70000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000002', 120, 'KARANTIN');

-- Mjerenje koje je izazvalo neusaglašenost (8.6°C na prijemu sira umjesto 0-5°C).
insert into mjerenje_temperature (id, kontrolna_tacka_id, pravilo_kontrole_id, lot_id, vrijednost, izmjereno_at, izmjerio_korisnik_id, rezultat, napomena)
select '80000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', pk.id, '70000000-0000-0000-0000-000000000004', 8.6, now() - interval '10 days', '11000000-0000-0000-0000-000000000003', 'FAIL', 'Izmjereno pri prijemu — van opsega'
from pravilo_kontrole pk where pk.artikal_id = '40000000-0000-0000-0000-000000000001' and pk.kontrolna_tacka_id = '50000000-0000-0000-0000-000000000001';

insert into neusaglasenost (id, broj, ozbiljnost, status, izvor_tip, izvor_id, opis, prijavio_korisnik_id) values
  ('90000000-0000-0000-0000-000000000001', 'NC-260919-001', 'VISOK', 'POTREBNA_MJERA', 'mjerenje_temperature', '80000000-0000-0000-0000-000000000001', 'Temperatura pri prijemu sira Edamer 8.6°C (limit 0-5°C). Lot stavljen na HOLD.', '11000000-0000-0000-0000-000000000003'),
  ('90000000-0000-0000-0000-000000000002', 'NC-260918-004', 'SREDNJI', 'OTVORENA', 'rucno', null, 'Vozilo PG CG 412 nije prošlo kontrolu čistoće prije utovara.', '11000000-0000-0000-0000-000000000002');

insert into vozilo (id, registarski_broj, tip, temp_kontrolisano, temp_min, temp_max, status) values
  ('a0000000-0000-0000-0000-000000000001', 'PG CG 412', 'Furgon rashladni', true, 0, 5, 'NIJE_SPREMNO'),
  ('a0000000-0000-0000-0000-000000000002', 'PG CG 118', 'Kombi rashladni', true, 0, 5, 'SPREMNO');

insert into kontrola_vozila (vozilo_id, izvrsio_korisnik_id, cistoca, temperatura, oprema_ok, vrata_ok, ukupan_status, napomena) values
  ('a0000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000004', false, 4.0, true, true, 'NIJE_PROSAO', 'Ostaci ambalaže u tovarnom prostoru — čišćenje prije naredne kontrole.'),
  ('a0000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000004', true, 3.5, true, true, 'PROSAO', null);

insert into isporuka (id, broj, kupac_id, vozilo_id, vozac_korisnik_id, datum_isporuke, status) values
  ('b0000000-0000-0000-0000-000000000001', 'ISP-260919-018', '30000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000004', current_date, 'POTVRDJENA'),
  ('b0000000-0000-0000-0000-000000000002', 'ISP-260919-017', '30000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000004', current_date, 'U_PRIPREMI');

insert into isporuka_stavka (isporuka_id, lot_id, planirana_kolicina, isporucena_kolicina) values
  ('b0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 60, 60),
  ('b0000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002', 40, 0);

insert into plan_obuke (lice_id, tema, planirani_datum, obavljeno_datum) values
  ('10000000-0000-0000-0000-000000000002', 'Lična higijena i dobra higijenska praksa', current_date - 20, current_date - 18),
  ('10000000-0000-0000-0000-000000000003', 'Higijena vozila i temperaturni režim pri transportu', current_date - 15, null),
  ('10000000-0000-0000-0000-000000000004', 'HACCP — kritične kontrolne tačke', current_date + 40, null);

insert into pitanje (tema, tekst, ponudjeni_odgovori, tacan_indeks) values
  ('Lična higijena', 'Kada je obavezno prati ruke u magacinu?', '["Samo prije pauze", "Prije rada, poslije pauze i poslije dodira sirove robe", "Jednom dnevno", "Nije propisano"]', 1),
  ('HACCP', 'Šta je kritična kontrolna tačka (KKT)?', '["Mjesto gdje se roba slaže", "Korak u procesu gdje se opasnost mora kontrolisati da bi se spriječila ili svela na prihvatljiv nivo", "Kancelarija odgovornog lica", "Skladište gotovih proizvoda"]', 1),
  ('Temperatura', 'U kom opsegu se drži rashlađena roba osjetljiva na kvarenje?', '["0-5°C", "8-12°C", "-5-0°C", "Sobna temperatura"]', 0),
  ('Sledljivost', 'Šta se upisuje pri prijemu robe da bi se obezbijedila sledljivost?', '["Samo naziv proizvoda", "Broj lota/serije", "Samo cijena", "Ništa, dovoljan je račun"]', 1),
  ('Neusaglašenost', 'Šta se radi kada se izmjeri temperatura van dozvoljenog opsega?', '["Ignoriše se ako je jednom", "Zapiše se odstupanje i korektivna mjera", "Roba se odmah baci bez zapisa", "Prijavi se poslije mjesec dana"]', 1);

-- Demo se učitava u jednom trenutku, a datumi su unazad — bez ovoga bi svaki demo prijem/zapis
-- nosio oznaku "naknadno +N" (invarijanta #10) i na prodajnom sastanku izgledao kao da se kasni.
update prijem set created_at = (datum_prijema + time '08:00') at time zone 'Europe/Podgorica'
  where (created_at at time zone 'Europe/Podgorica')::date > datum_prijema;
update isporuka set created_at = (datum_isporuke + time '07:30') at time zone 'Europe/Podgorica'
  where (created_at at time zone 'Europe/Podgorica')::date > datum_isporuke;
update zapis set created_at = (datum + time '16:00') at time zone 'Europe/Podgorica'
  where (created_at at time zone 'Europe/Podgorica')::date > datum;
