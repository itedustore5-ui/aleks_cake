-- Faza 3 — HACCP kao sistem (nalazi H5, H6, H7, ostatak H4).
--
--   plan_monitoringa      šta se radi, koliko često i ko — iz toga "šta danas fali" i pregled rupa
--   kontrolna_tacka.*     opasnost, korektivna mjera, verifikacija — za štampu HACCP plana
--   mjerni_uredjaj,
--   provjera_uredjaja     termometri: interna provjera i kalibracija, sa rokovima
--   verifikacija_sistema  godišnja revizija plana, interni audit, vježba povlačenja
--   verifikacija.izuzetak_cetiri_oka   mala firma sa jednim odgovornim licem (H7)
--   pravila po artiklu    granica iz Šifarnika postaje pravilo za KKT 1 i KKT 3 (jedan izvor, H4)
--
-- Postojeći redovi se ne mijenjaju. Jedini upis podataka: pravila za artikle koji imaju granicu u
-- Šifarnicima, a nemaju svoje pravilo na KKT 1 / KKT 3 — samo se DODAJU (bez toga bi artikal ostao
-- bez ocjene, jer KKT 3 više ne čita granicu iz artikla).

-- ─── Kontrolne tačke: tekst za HACCP plan ────────────────────────────────────────────────────────
alter table kontrolna_tacka add column if not exists opasnost text;
alter table kontrolna_tacka add column if not exists korektivna_mjera text;
alter table kontrolna_tacka add column if not exists verifikacija text;

-- ─── Plan monitoringa ────────────────────────────────────────────────────────────────────────────
create table if not exists plan_monitoringa (
  id uuid primary key default gen_random_uuid(),
  naziv varchar(200) not null,
  -- mjerenje: temperatura na kontrolnoj tački · obrazac: dnevni obrazac (P3…) · kontrola_vozila: D1
  vrsta varchar(20) not null,
  kontrolna_tacka_id uuid references kontrolna_tacka (id),
  obrazac_kod varchar(20),
  vozilo_id uuid references vozilo (id),
  -- PO_DOGADJAJU: uz svaki prijem / isporuku (KKT 1, KKT 3) — ide u HACCP plan, a u "danas fali" ne,
  -- jer se sprovodi pri samom unosu (temperatura je obavezna).
  ucestalost varchar(20) not null,
  puta integer not null default 1,
  uloga uloga_t,
  skladiste_id uuid references skladiste (id),
  vazi_od date not null default ((now() at time zone 'Europe/Podgorica')::date),
  aktivan boolean not null default true,
  napomena text,
  created_by uuid references korisnik (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_plan_vrsta check (vrsta in ('mjerenje', 'obrazac', 'kontrola_vozila')),
  constraint chk_plan_ucestalost check (ucestalost in ('DNEVNO', 'RADNIM_DANIMA', 'SEDMICNO', 'MJESECNO', 'PO_DOGADJAJU')),
  constraint chk_plan_puta check (puta between 1 and 12),
  constraint chk_plan_mjerenje check ((vrsta = 'mjerenje') = (kontrolna_tacka_id is not null)),
  constraint chk_plan_obrazac check ((vrsta = 'obrazac') = (obrazac_kod is not null)),
  constraint chk_plan_vozilo check (vrsta <> 'kontrola_vozila' or vozilo_id is not null)
);
create index if not exists idx_plan_monitoringa_aktivan on plan_monitoringa (aktivan);

-- ─── Mjerni uređaji (termometri) ─────────────────────────────────────────────────────────────────
create table if not exists mjerni_uredjaj (
  id uuid primary key default gen_random_uuid(),
  naziv varchar(200) not null,
  oznaka varchar(100),
  lokacija varchar(200),
  -- Interna provjera (npr. ledena voda 0 °C) i kalibracija u ovlašćenoj laboratoriji imaju svoje rokove.
  interval_provjere_mjeseci integer not null default 1,
  interval_kalibracije_mjeseci integer,
  aktivan boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_uredjaj_interval check (interval_provjere_mjeseci between 1 and 24 and (interval_kalibracije_mjeseci is null or interval_kalibracije_mjeseci between 1 and 60))
);

-- Zapis provjere se ne mijenja (kao i svaki zapis) — ispravka je nova provjera.
create table if not exists provjera_uredjaja (
  id uuid primary key default gen_random_uuid(),
  uredjaj_id uuid not null references mjerni_uredjaj (id),
  datum date not null,
  vrsta varchar(20) not null,
  referentna numeric(6, 2),
  izmjereno numeric(6, 2),
  dozvoljeno_odstupanje numeric(4, 2),
  rezultat varchar(20) not null,
  broj_sertifikata varchar(100),
  izvrsilac varchar(200) not null,
  napomena text,
  uneo_korisnik_id uuid not null references korisnik (id),
  created_at timestamptz not null default now(),
  constraint chk_provjera_vrsta check (vrsta in ('INTERNA', 'KALIBRACIJA')),
  constraint chk_provjera_rezultat check (rezultat in ('ISPRAVAN', 'NEISPRAVAN'))
);
create index if not exists idx_provjera_uredjaja on provjera_uredjaja (uredjaj_id, datum);

-- ─── Verifikacija sistema (7. princip HACCP-a) ───────────────────────────────────────────────────
create table if not exists verifikacija_sistema (
  id uuid primary key default gen_random_uuid(),
  vrsta varchar(30) not null,
  datum date not null,
  izvrsilac varchar(200) not null,
  nalaz text not null,
  zakljucak varchar(30) not null,
  sljedeca_do date,
  uneo_korisnik_id uuid not null references korisnik (id),
  created_at timestamptz not null default now(),
  constraint chk_verifikacija_sistema_vrsta check (vrsta in ('REVIZIJA_PLANA', 'INTERNI_AUDIT', 'VJEZBA_POVLACENJA')),
  constraint chk_verifikacija_sistema_zakljucak check (zakljucak in ('USAGLASENO', 'POTREBNE_IZMJENE')),
  constraint chk_verifikacija_sistema_nalaz check (btrim(nalaz) <> '')
);

-- ─── Četiri oka u maloj firmi (H7) ───────────────────────────────────────────────────────────────
alter table verifikacija add column if not exists izuzetak_cetiri_oka boolean not null default false;

-- ─── Novi izvori (invarijanta #36 — isti spisak u zadaciService.ts) ─────────────────────────────
alter table neusaglasenost drop constraint if exists chk_neusaglasenost_izvor_tip;
alter table neusaglasenost add constraint chk_neusaglasenost_izvor_tip check (
  izvor_tip in ('mjerenje_temperature', 'kontrola_vozila', 'povlacenje', 'zapis', 'rucno', 'isporuka', 'prijem', 'mjerni_uredjaj')
) not valid;
alter table zadatak drop constraint if exists chk_zadatak_izvor_tip;
alter table zadatak add constraint chk_zadatak_izvor_tip check (
  izvor_tip is null or izvor_tip in ('neusaglasenost', 'povlacenje', 'rucno', 'verifikacija_sistema')
) not valid;
alter table obavjestenje drop constraint if exists chk_obavjestenje_izvor_tip;
alter table obavjestenje add constraint chk_obavjestenje_izvor_tip check (
  izvor_tip is null or izvor_tip in ('neusaglasenost', 'povlacenje', 'lot', 'prijem', 'isporuka', 'zadatak', 'poruka', 'bekap_log', 'mjerni_uredjaj', 'verifikacija_sistema')
) not valid;
do $$
declare
  o record;
begin
  for o in select * from (values
    ('neusaglasenost', 'chk_neusaglasenost_izvor_tip'),
    ('zadatak', 'chk_zadatak_izvor_tip'),
    ('obavjestenje', 'chk_obavjestenje_izvor_tip')) as x (tabela, naziv)
  loop
    begin
      execute format('alter table %I validate constraint %I', o.tabela, o.naziv);
    exception when check_violation then
      raise notice '%: stari redovi sa nepoznatim izvor_tip — ograničenje važi za nove redove.', o.tabela;
    end;
  end loop;
end $$;

-- ─── Jedan izvor granica (ostatak H4) ────────────────────────────────────────────────────────────
-- Artikal sa granicom u Šifarnicima, a bez svog pravila na KKT 1 / KKT 3 → dobija pravilo sa istom
-- granicom. Ubuduće to radi server pri svakoj izmjeni artikla (uskladiPravilaArtikla).
insert into pravilo_kontrole (kontrolna_tacka_id, artikal_id, naziv, min_vrijednost, max_vrijednost, jedinica, ozbiljnost)
select kt.id, a.id, 'Granica artikla — ' || a.naziv, a.temp_min, a.temp_max, '°C', 'VISOK'
from artikal a
cross join kontrolna_tacka kt
where kt.sifra in ('KKT1', 'KKT3')
  and a.temp_kontrolisano and (a.temp_min is not null or a.temp_max is not null)
  and not exists (
    select 1 from pravilo_kontrole p where p.kontrolna_tacka_id = kt.id and p.artikal_id = a.id and p.aktivan
  );
