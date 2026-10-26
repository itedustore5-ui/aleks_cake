-- Demo podaci ateljea torti — SAMO za demo bazu (prodajni sastanci i testovi), nikad za pravog klijenta.
-- Primjenjuje se samo uz `--demo` (`npm run seed:demo`, `npm test`); konstanta DEMO u server/migracije.ts.
--
-- Broj 99, ne 13 kao kod distributera: demo ateljea treba tabele iz kasnijih dopuna (alergeni — 38, porudžbine — 39,
-- skladište — 19, termometri i plan — 24), a dopune idu redom po imenu fajla. Nova dopuna (40, 41 …) ide prije
-- demoa na novoj bazi, a poslije njega na postojećoj demo bazi — demo zato upisuje sve sam (KKT, pravila,
-- skladište), ne oslanja se na to da kasnija dopuna nešto dopuni.
--
-- Fiksni UUID-i (čitljivi, prefiks po tipu): testovi (testovi/pomoc.mjs) i alati (demo-lozinke, prvi-korisnik,
-- uvoz-start) prepoznaju demo bazu po tri demo naloga sa ovim ID-jevima.

-- Dan po Podgorici (invarijanta #11), ne current_date — Supabase radi po UTC-u.
create temp table demo_dan on commit drop as select (now() at time zone 'Europe/Podgorica')::date as d;

insert into firma (naziv, pib, adresa, grad, telefon, email, odgovorno_lice_ime) values
  ('Demo Atelje torti d.o.o.', '02987654', 'Bulevar revolucije 15', 'Bar', '+382 67 111 222', 'info@demo-atelje.me', 'Ana Backović');

-- Jedno skladište — atelje (frižideri, vitrina, zamrzivač i suva ostava). Dopuna 19 ga je napravila kao „Glavni magacin“.
update skladiste set naziv = 'Atelje' where naziv = 'Glavni magacin';
insert into skladiste (naziv) select 'Atelje' where not exists (select 1 from skladiste);

insert into lice (id, ime, radno_mjesto, rukuje_hranom, sifra, sanitarna_knjizica_broj, sanitarna_knjizica_rok) values
  ('10000000-0000-0000-0000-000000000001', 'Ana Backović', 'Vlasnica, odgovorno lice za bezbjednost hrane', true, 'M-01', 'SK-2024-0091', (select d from demo_dan) + 200),
  ('10000000-0000-0000-0000-000000000002', 'Marko Vuković', 'Poslastičar', true, 'M-02', 'SK-2024-0114', (select d from demo_dan) + 12),
  ('10000000-0000-0000-0000-000000000003', 'Nina Radulović', 'Poslastičarka', true, 'M-03', 'SK-2024-0155', (select d from demo_dan) + 300),
  ('10000000-0000-0000-0000-000000000004', 'Jelena Popović', 'Prodavačica', true, 'M-04', 'SK-2023-0087', (select d from demo_dan) - 5);

-- Demo nalozi — lozinke su scrypt heš unaprijed izračunatih početnih lozinki (testovi/pomoc.mjs). Na živoj demo
-- bazi ih odmah promijeniti: `npm run demo-lozinke`.
insert into korisnik (id, korisnicko_ime, lozinka_hash, lozinka_stanje, mora_promijeniti_lozinku, uloga, lice_id) values
  ('11000000-0000-0000-0000-000000000001', 'konsultant', 'scrypt$36adde754dbb7b4490186672ce50a266$e289881804a5d9c8d7ff1918a9078e97af8bd11853d4a019349c6f6ffa0a1a510771aaadb920428632a7ee6986b196a268bfd9952b4d8149d71a6013b8918bda', 'postavljena', false, 'izvodjac', null),
  ('11000000-0000-0000-0000-000000000002', 'ana.b', 'scrypt$d77fc3c8f7bbcbf2dd4a88079d3c0d49$16921067fda93531c1ca627181ebfe64aff4bb1cd3664920b63509558a361c9f5d6a920dbf1d41a932d146d9e2c9f105d8fd7d9f88abffeebeab0b526fa82018', 'postavljena', false, 'bzr', '10000000-0000-0000-0000-000000000001'),
  ('11000000-0000-0000-0000-000000000003', 'marko.v', 'scrypt$f69f30b1dac9ca55ad2f68534a88da07$b1ca38fb02827762ecc3c2e7df255bfc2106949e107f569070dee8d077266057f8c33898b35b2a2e4a9cc56975fa1cfd79e66c5a20dd4c3a670141eb8806b5cb', 'postavljena', false, 'operater', '10000000-0000-0000-0000-000000000002');

insert into dobavljac (id, naziv, pib, adresa, telefon, email) values
  ('20000000-0000-0000-0000-000000000001', 'Farma Demo Jaja d.o.o.', '02334455', 'Industrijska zona bb, Danilovgrad', '+382 20 811 100', 'prodaja@demo-jaja.me'),
  ('20000000-0000-0000-0000-000000000002', 'Mljekara Demo Sjever d.o.o.', '02556677', 'Industrijska zona bb, Bijelo Polje', '+382 50 432 100', 'prodaja@demo-mljekara.me'),
  ('20000000-0000-0000-0000-000000000003', 'Veleprodaja Demo Slatko d.o.o.', '02998811', 'Put za Sutomore bb, Bar', '+382 30 311 200', 'nabavka@demo-slatko.me');

-- Stalni kupci (kafići, restorani) — porudžbina torte nosi svog kupca i telefon, ovo je samo šifarnik.
insert into kupac (id, naziv, adresa, telefon, email) values
  ('30000000-0000-0000-0000-000000000001', 'Kafe Demo Centar', 'Obala 13. jula 4, Bar', '+382 67 200 100', null),
  ('30000000-0000-0000-0000-000000000002', 'Hotel Demo Primorje', 'Šetalište kralja Nikole bb, Bar', '+382 30 300 200', 'nabavka@demo-primorje.me');

-- Sastojci sa alergenima (14, Prilog II Uredbe EU 1169/2011 — server/alergeni.ts). Šećer namjerno bez upisanih
-- alergena (`alergeni_upisani = false`): ekran porudžbine tada upozori da niko nije pogledao deklaraciju.
insert into artikal (id, sifra, naziv, jedinica_mjere, zahtijeva_lot, temp_kontrolisano, temp_min, temp_max, rok_trajanja_dana, granica_potvrdio, alergeni, alergeni_upisani) values
  ('40000000-0000-0000-0000-000000000001', 'JAJ-001', 'Jaja klasa A', 'kom', true, true, 0, 8, 28, true, '{JAJA}', true),
  ('40000000-0000-0000-0000-000000000002', 'MLJ-001', 'Slatka pavlaka 35% 1L', 'l', true, true, 0, 4, 30, true, '{MLIJEKO}', true),
  ('40000000-0000-0000-0000-000000000003', 'MLJ-002', 'Maskarpone 500g', 'kom', true, true, 0, 4, 45, true, '{MLIJEKO}', true),
  ('40000000-0000-0000-0000-000000000004', 'MLJ-003', 'Mlijeko 3,2% 1L', 'l', true, true, 0, 4, 10, true, '{MLIJEKO}', true),
  ('40000000-0000-0000-0000-000000000005', 'MLJ-004', 'Puter 82% 250g', 'kom', true, true, 0, 6, 60, true, '{MLIJEKO}', true),
  ('40000000-0000-0000-0000-000000000006', 'SUH-001', 'Brašno T-400 1kg', 'kg', true, false, null, null, 365, false, '{GLUTEN}', true),
  ('40000000-0000-0000-0000-000000000007', 'SUH-002', 'Lješnik mljeveni 500g', 'kg', true, false, null, null, 180, false, '{ORASASTI}', true),
  ('40000000-0000-0000-0000-000000000008', 'SUH-003', 'Čokolada za kuvanje 70%', 'kg', true, false, null, null, 365, false, '{MLIJEKO,SOJA}', true),
  ('40000000-0000-0000-0000-000000000009', 'SMR-001', 'Maline smrznute 1kg', 'kg', true, true, -22, -18, 365, true, '{}', true),
  ('40000000-0000-0000-0000-000000000010', 'SUH-004', 'Šećer kristal 1kg', 'kg', true, false, null, null, 730, false, '{}', false);

-- Kontrolne tačke ateljea (iste šifre i nazivi kao alati/prvi-korisnik.ts — kod ih traži po šifri, #91).
insert into kontrolna_tacka (id, sifra, naziv, opis, opasnost, korektivna_mjera, verifikacija) values
  ('50000000-0000-0000-0000-000000000001', 'KKT1', 'Prijem sastojaka', 'Kontrola temperature i ispravnosti pri prijemu (jaja, mliječno, smrznuto)',
   'Razmnožavanje bakterija (Salmonella, Listeria) u jajima i mliječnim sastojcima primljenim van hladnog lanca.',
   'Sastojak van granice se zadržava (HOLD) i vraća dobavljaču ili otpisuje; dobavljač se obavještava.',
   'Vlasnica sedmično pregleda zapise prijema; termometar se provjerava jednom mjesečno.'),
  ('50000000-0000-0000-0000-000000000002', 'KKT2', 'Frižideri, vitrina i zamrzivač', 'Kontrola temperature čuvanja sastojaka, kremova i gotovih torti',
   'Razmnožavanje bakterija u kremovima, šlagu i tortama sa maskarponeom ako frižider ili vitrina ne drže temperaturu.',
   'Roba se premješta u ispravan frižider; krem ili torta duže od 2 h van granice se ne prodaje; poziva se serviser.',
   'Vlasnica sedmično pregleda zapise; termometar se provjerava jednom mjesečno.'),
  ('50000000-0000-0000-0000-000000000003', 'KKT3', 'Predaja torte', 'Temperatura torte pri predaji kupcu, naročito kod dostave',
   'Torta sa kremom predugo van frižidera pri dostavi — razmnožavanje bakterija.',
   'Torta van granice pri predaji se upisuje kao neusaglašenost; dostava se mijenja (rashladna torba, kraći put).',
   'Vlasnica pregleda predaje sa dostavom jednom sedmično.');

-- Granice (#39 — jedan izvor, pravilo_kontrole): granica artikla → pravilo na KKT 1 i KKT 3 (kao dopuna 24 i
-- uskladiPravilaArtikla); za frižidere i vitrinu opšte pravilo KKT 2; za predaju torte opšte pravilo KKT 3 (P3).
insert into pravilo_kontrole (kontrolna_tacka_id, artikal_id, naziv, min_vrijednost, max_vrijednost, jedinica, ozbiljnost)
select kt.id, a.id, 'Granica artikla — ' || a.naziv, a.temp_min, a.temp_max, '°C', 'VISOK'
from artikal a
cross join kontrolna_tacka kt
where kt.sifra in ('KKT1', 'KKT3') and a.temp_kontrolisano and (a.temp_min is not null or a.temp_max is not null);

insert into pravilo_kontrole (kontrolna_tacka_id, artikal_id, naziv, min_vrijednost, max_vrijednost, jedinica, ozbiljnost) values
  ('50000000-0000-0000-0000-000000000002', null, 'Frižideri i vitrina — rashlađeno', 0, 4, '°C', 'VISOK'),
  ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000009', 'Zamrzivač — smrznuto voće', -22, -18, '°C', 'VISOK'),
  ('50000000-0000-0000-0000-000000000003', null, 'Torta pri predaji — rashlađeno', 0, 6, '°C', 'VISOK');

-- Prijemi i lotovi: jaja i mliječno prije 2–3 dana, suvo i smrznuto prije 5 dana, šećer danas čeka odluku.
insert into prijem (id, dobavljac_id, broj_dokumenta, datum_prijema, status, primio_korisnik_id, odluka_at, skladiste_id) values
  ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'FJ-1182', (select d from demo_dan) - 3, 'PRIHVACEN', '11000000-0000-0000-0000-000000000003', now() - interval '3 days', (select id from skladiste where naziv = 'Atelje')),
  ('60000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'MS-22891', (select d from demo_dan) - 2, 'PRIHVACEN', '11000000-0000-0000-0000-000000000003', now() - interval '2 days', (select id from skladiste where naziv = 'Atelje')),
  ('60000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'VS-11082', (select d from demo_dan) - 5, 'PRIHVACEN', '11000000-0000-0000-0000-000000000003', now() - interval '5 days', (select id from skladiste where naziv = 'Atelje')),
  ('60000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000003', 'VS-11140', (select d from demo_dan), 'CEKA_ODLUKU', '11000000-0000-0000-0000-000000000003', null, (select id from skladiste where naziv = 'Atelje'));

insert into lot (id, artikal_id, dobavljac_id, prijem_id, broj_lota, proizvodni_datum, rok_trajanja, status, primljena_kolicina, prihvacena_kolicina) values
  ('70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', 'J-1023-A', (select d from demo_dan) - 4, (select d from demo_dan) + 24, 'PRIHVACEN', 360, 360),
  ('70000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', 'PV-1023-11', (select d from demo_dan) - 3, (select d from demo_dan) + 12, 'PRIHVACEN', 12, 12),
  ('70000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', 'MS-1022-07', (select d from demo_dan) - 6, (select d from demo_dan) + 30, 'PRIHVACEN', 8, 8),
  ('70000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', 'PV-1023-14', (select d from demo_dan) - 3, (select d from demo_dan) + 12, 'HOLD', 6, 0),
  ('70000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000003', 'BR-0926-33', (select d from demo_dan) - 30, (select d from demo_dan) + 200, 'PRIHVACEN', 25, 25),
  ('70000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000003', 'LJ-0915-02', (select d from demo_dan) - 40, (select d from demo_dan) + 120, 'PRIHVACEN', 5, 5),
  ('70000000-0000-0000-0000-000000000007', '40000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000003', 'CK-0901-19', (select d from demo_dan) - 60, (select d from demo_dan) + 300, 'PRIHVACEN', 10, 10),
  ('70000000-0000-0000-0000-000000000008', '40000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000003', 'MAL-0920-04', (select d from demo_dan) - 35, (select d from demo_dan) + 250, 'PRIHVACEN', 6, 6),
  ('70000000-0000-0000-0000-000000000009', '40000000-0000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000003', '60000000-0000-0000-0000-000000000004', 'SE-1001-01', (select d from demo_dan) - 25, (select d from demo_dan) + 700, 'PRIMLJEN', 20, 0);

insert into prijem_stavka (prijem_id, artikal_id, lot_id, ocekivana_kolicina, primljena_kolicina, prihvacena_kolicina, temperatura_prijema) values
  ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 360, 360, 360, 6.5),
  ('60000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000002', 12, 12, 12, 3.4),
  ('60000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000003', 8, 8, 8, 3.8),
  ('60000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000004', 6, 6, 0, 9.1),
  ('60000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000006', '70000000-0000-0000-0000-000000000005', 25, 25, 25, null),
  ('60000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000007', '70000000-0000-0000-0000-000000000006', 5, 5, 5, null),
  ('60000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000008', '70000000-0000-0000-0000-000000000007', 10, 10, 10, null),
  ('60000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000009', '70000000-0000-0000-0000-000000000008', 6, 6, 6, -19.0),
  ('60000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000010', '70000000-0000-0000-0000-000000000009', 20, 20, 0, null);

insert into zaliha (lot_id, artikal_id, kolicina, status) values
  ('70000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 300, 'DOSTUPNO'),
  ('70000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', 9, 'DOSTUPNO'),
  ('70000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000003', 6, 'DOSTUPNO'),
  ('70000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000002', 6, 'KARANTIN'),
  ('70000000-0000-0000-0000-000000000005', '40000000-0000-0000-0000-000000000006', 21, 'DOSTUPNO'),
  ('70000000-0000-0000-0000-000000000006', '40000000-0000-0000-0000-000000000007', 4, 'DOSTUPNO'),
  ('70000000-0000-0000-0000-000000000007', '40000000-0000-0000-0000-000000000008', 8, 'DOSTUPNO'),
  ('70000000-0000-0000-0000-000000000008', '40000000-0000-0000-0000-000000000009', 6, 'DOSTUPNO');

-- KKT 1 uz prijem (izmjerio poslastičar, vrijeme prijema); pavlaka PV-1023-14 stigla na 9,1 °C → FAIL i HOLD.
insert into mjerenje_temperature (kontrolna_tacka_id, pravilo_kontrole_id, lot_id, vrijednost, izmjereno_at, izmjerio_korisnik_id, rezultat, napomena, skladiste_id, created_at)
select '50000000-0000-0000-0000-000000000001', pk.id, ps.lot_id, ps.temperatura_prijema, t.vrijeme, '11000000-0000-0000-0000-000000000003', 'PASS', null, p.skladiste_id, t.vrijeme
from prijem_stavka ps
join prijem p on p.id = ps.prijem_id
join pravilo_kontrole pk on pk.kontrolna_tacka_id = '50000000-0000-0000-0000-000000000001' and pk.artikal_id = ps.artikal_id
cross join lateral (select ((p.datum_prijema + time '08:15') at time zone 'Europe/Podgorica') as vrijeme) t
where ps.temperatura_prijema is not null and ps.lot_id <> '70000000-0000-0000-0000-000000000004';

insert into mjerenje_temperature (id, kontrolna_tacka_id, pravilo_kontrole_id, lot_id, vrijednost, izmjereno_at, izmjerio_korisnik_id, rezultat, napomena, skladiste_id, created_at)
select '80000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', pk.id, '70000000-0000-0000-0000-000000000004', 9.1, t.vrijeme,
       '11000000-0000-0000-0000-000000000003', 'FAIL', 'Izmjereno pri prijemu — van granice', (select id from skladiste where naziv = 'Atelje'), t.vrijeme
from pravilo_kontrole pk
cross join lateral (select (((select d from demo_dan) - 2 + time '08:20') at time zone 'Europe/Podgorica') as vrijeme) t
where pk.kontrolna_tacka_id = '50000000-0000-0000-0000-000000000001' and pk.artikal_id = '40000000-0000-0000-0000-000000000002';

-- KKT 2: frižideri i vitrina, jutro i popodne — juče oba, danas jutro.
insert into mjerenje_temperature (kontrolna_tacka_id, pravilo_kontrole_id, vrijednost, izmjereno_at, izmjerio_korisnik_id, rezultat, napomena, skladiste_id, created_at)
select '50000000-0000-0000-0000-000000000002', pk.id, v.vrijednost, v.vrijeme, '11000000-0000-0000-0000-000000000003', 'PASS', v.napomena, (select id from skladiste where naziv = 'Atelje'), v.vrijeme
from pravilo_kontrole pk
cross join (values
  (3.2, (((select d from demo_dan) - 1 + time '08:05') at time zone 'Europe/Podgorica'), 'Frižider sa kremovima'),
  (3.9, (((select d from demo_dan) - 1 + time '15:10') at time zone 'Europe/Podgorica'), 'Vitrina u prodavnici'),
  (3.4, now() - interval '1 hour', 'Frižider sa kremovima')
) as v (vrijednost, vrijeme, napomena)
where pk.kontrolna_tacka_id = '50000000-0000-0000-0000-000000000002' and pk.artikal_id is null;

insert into neusaglasenost (id, broj, ozbiljnost, status, izvor_tip, izvor_id, opis, prijavio_korisnik_id, created_at) values
  ('90000000-0000-0000-0000-000000000001', 'NC-' || to_char((select d from demo_dan) - 2, 'YYMMDD') || '-001', 'VISOK', 'POTREBNA_MJERA', 'mjerenje_temperature', '80000000-0000-0000-0000-000000000001',
   'Slatka pavlaka 35% pri prijemu 9,1 °C (granica 0–4 °C). Lot PV-1023-14 zadržan (HOLD).', '11000000-0000-0000-0000-000000000003', now() - interval '2 days'),
  ('90000000-0000-0000-0000-000000000002', 'NC-' || to_char((select d from demo_dan) - 1, 'YYMMDD') || '-001', 'SREDNJI', 'OTVORENA', 'rucno', null,
   'Vrata vitrine ne dihtuju — popodne se osjeti toplo. Pozvati servisera.', '11000000-0000-0000-0000-000000000003', now() - interval '1 day');

-- Porudžbine torti (P1–P5): predata prekjuče (alergeni potvrđeni, serije upisane), današnja sa dostavom (u izradi,
-- alergeni još nisu potvrđeni — kartica na Kontrolnom centru) i sutrašnja (kupac javio alergiju na orašaste).
insert into porudzbina (id, broj, kupac_ime, kupac_telefon, preuzimanje_at, nacin, adresa_dostave, opis, napomena, status, alergeni,
                        alergeni_potvrdio_korisnik_id, alergeni_potvrdjeno_at, predao_korisnik_id, predato_at, preuzeo_ime, uneo_korisnik_id, created_at) values
  ('c0000000-0000-0000-0000-000000000001', 'PRD-' || to_char((select d from demo_dan) - 5, 'YYMMDD') || '-001', 'Milica Đurović', '+382 67 123 456',
   (((select d from demo_dan) - 2 + time '12:00') at time zone 'Europe/Podgorica'), 'PREUZIMA', null,
   'Čokoladna torta sa lješnikom, 20 osoba', null, 'PREDATA', '{GLUTEN,JAJA,MLIJEKO,ORASASTI,SOJA}',
   '11000000-0000-0000-0000-000000000003', (((select d from demo_dan) - 2 + time '10:30') at time zone 'Europe/Podgorica'),
   '11000000-0000-0000-0000-000000000003', (((select d from demo_dan) - 2 + time '12:05') at time zone 'Europe/Podgorica'), 'Milica Đurović',
   '11000000-0000-0000-0000-000000000002', (((select d from demo_dan) - 5 + time '17:40') at time zone 'Europe/Podgorica')),
  ('c0000000-0000-0000-0000-000000000002', 'PRD-' || to_char((select d from demo_dan) - 2, 'YYMMDD') || '-001', 'Ivana Marković', '+382 68 234 567',
   (((select d from demo_dan) + time '18:00') at time zone 'Europe/Podgorica'), 'DOSTAVA', 'Ulica Jovana Tomaševića 12, Bar',
   'Tiramisu torta, 12 osoba, natpis „Srećan rođendan, Luka“', null, 'U_IZRADI', '{}', null, null, null, null, null,
   '11000000-0000-0000-0000-000000000002', (((select d from demo_dan) - 2 + time '11:15') at time zone 'Europe/Podgorica')),
  ('c0000000-0000-0000-0000-000000000003', 'PRD-' || to_char((select d from demo_dan) - 1, 'YYMMDD') || '-001', 'Kafe Demo Centar', '+382 67 200 100',
   (((select d from demo_dan) + 1 + time '10:00') at time zone 'Europe/Podgorica'), 'PREUZIMA', null,
   'Voćna torta sa malinama, 30 osoba', 'Gost alergičan na orašaste plodove — bez lješnika i bez dekoracije sa orasima.', 'PRIMLJENA', '{}', null, null, null, null, null,
   '11000000-0000-0000-0000-000000000003', (((select d from demo_dan) - 1 + time '09:30') at time zone 'Europe/Podgorica'));

insert into porudzbina_lot (porudzbina_id, lot_id, dodao_korisnik_id, created_at)
select v.porudzbina_id::uuid, v.lot_id::uuid, '11000000-0000-0000-0000-000000000003', v.vrijeme
from (values
  ('c0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', (((select d from demo_dan) - 3 + time '09:00') at time zone 'Europe/Podgorica')),
  ('c0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', (((select d from demo_dan) - 3 + time '09:00') at time zone 'Europe/Podgorica')),
  ('c0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000005', (((select d from demo_dan) - 3 + time '09:00') at time zone 'Europe/Podgorica')),
  ('c0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000006', (((select d from demo_dan) - 3 + time '09:00') at time zone 'Europe/Podgorica')),
  ('c0000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000007', (((select d from demo_dan) - 3 + time '09:00') at time zone 'Europe/Podgorica')),
  ('c0000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000001', now() - interval '3 hours'),
  ('c0000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000003', now() - interval '3 hours'),
  ('c0000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-000000000005', now() - interval '3 hours')
) as v (porudzbina_id, lot_id, vrijeme);

insert into plan_obuke (lice_id, tema, planirani_datum, obavljeno_datum) values
  ('10000000-0000-0000-0000-000000000002', 'Lična higijena i dobra higijenska praksa', (select d from demo_dan) - 20, (select d from demo_dan) - 18),
  ('10000000-0000-0000-0000-000000000003', 'Alergeni — 14 alergena i potvrda prije predaje', (select d from demo_dan) - 10, null),
  ('10000000-0000-0000-0000-000000000004', 'Frižideri, vitrina i hladni lanac', (select d from demo_dan) + 40, null);

insert into pitanje (tema, tekst, ponudjeni_odgovori, tacan_indeks) values
  ('Lična higijena', 'Kada je obavezno prati ruke u ateljeu?', '["Samo prije pauze", "Prije rada, poslije pauze, poslije razbijanja jaja i poslije dodira sirovih namirnica", "Jednom dnevno", "Nije propisano"]', 1),
  ('Alergeni', 'Kupac kaže da je dijete alergično na lješnik. Šta radite?', '["Skinem lješnik sa dekoracije i to je dovoljno", "Provjerim sve sastojke (i čokoladu i kremove) i potvrdim alergene u porudžbini prije predaje", "Kažem da nema orašastih bez provjere", "Odbijem porudžbinu bez objašnjenja"]', 1),
  ('Temperatura', 'Na kojoj temperaturi se čuva torta sa šlagom ili kremom od maskarponea?', '["Do 4 °C, u frižideru", "Na sobnoj temperaturi do večeri", "Do 12 °C", "Svejedno je ako je torta pokrivena"]', 0),
  ('Jaja', 'Zašto se jaja drže odvojeno od kremova i gotovih torti?', '["Zbog mirisa", "Ljuska može nositi salmonelu — razdvajanje sprečava prenošenje na gotove torte", "Da zauzimaju manje mjesta", "Nema razloga"]', 1),
  ('Sledljivost', 'Šta se upisuje u porudžbinu dok se torta pravi?', '["Samo ime kupca", "Serije (lotovi) jaja, pavlake, maskarponea i drugih ključnih sastojaka", "Samo cijena", "Ništa — dovoljno je zapamtiti"]', 1),
  ('Neusaglašenost', 'Šta se radi kada je temperatura u frižideru van granice?', '["Ignoriše se ako je jednom", "Zapiše se odstupanje i korektivna mjera", "Roba se baci bez zapisa", "Prijavi se poslije mjesec dana"]', 1);

-- Demo se učitava u jednom trenutku, a datumi su unazad — bez ovoga bi svaki demo prijem nosio oznaku
-- „naknadno +N“ (invarijanta #10) i na prodajnom sastanku izgledao kao da se kasni.
update prijem set created_at = (datum_prijema + time '08:00') at time zone 'Europe/Podgorica'
  where (created_at at time zone 'Europe/Podgorica')::date > datum_prijema;
update lot set created_at = p.created_at from prijem p where p.id = lot.prijem_id and lot.created_at > p.created_at;
