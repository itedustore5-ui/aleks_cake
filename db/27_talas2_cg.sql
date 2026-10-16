-- Drugi talas popravki posle revizije 25.09.2026 (nalazi R-05, R-07, R-20, R-23).

-- R-23: kojim termometrom je izmjereno. Kad termometar padne na provjeri, zna se koja mjerenja
-- su upitna (ona između posljednje dobre i ove loše provjere).
alter table mjerenje_temperature add column if not exists mjerni_uredjaj_id uuid references mjerni_uredjaj (id);
create index if not exists idx_mjerenje_uredjaj on mjerenje_temperature (mjerni_uredjaj_id, izmjereno_at);

-- R-05: granica vozila po kojoj je D1 ocijenjena — pamti se uz kontrolu, jer se granica vozila
-- kasnije može promijeniti, a zapis mora pokazati po čemu je tada ocijenjen.
alter table kontrola_vozila add column if not exists granica_min numeric(5, 2);
alter table kontrola_vozila add column if not exists granica_max numeric(5, 2);
alter table kontrola_vozila add column if not exists temperatura_ok boolean;

-- R-07: zapis se ispravlja najviše jednom — ispravka ispravke ide na posljednju verziju, pa lanac
-- ostaje lanac, a ne drvo sa dvije „važeće" verzije. Ako na nekoj bazi već ima grananja, indeks se
-- ne pravi (notice), a server i dalje odbija drugu ispravku istog zapisa.
do $$ begin
  create unique index if not exists uq_zapis_ispravlja on zapis (ispravlja_id) where ispravlja_id is not null;
exception when unique_violation then
  raise notice 'Na ovoj bazi ima zapisa ispravljenih dvaput — jedinstvenost važi u aplikaciji, stare grane pregledati ručno.';
end $$;

-- R-20: izvoz — kontrole vozila, provjere neusaglašenosti, termometri, verifikacija sistema, kretanja
-- zaliha. Kolone su nazvane kako ih čita inspektor; vrijeme po Podgorici.
create or replace view v_izvoz_kontrole_vozila as
select
  to_char(kv.izvrseno_at at time zone 'Europe/Podgorica', 'YYYY-MM-DD HH24:MI') as vrijeme,
  v.registarski_broj as vozilo,
  coalesce(l.ime, k.korisnicko_ime) as izvrsio,
  case when kv.cistoca then 'DA' else 'NE' end as cistoca,
  case when kv.oprema_ok then 'DA' else 'NE' end as oprema,
  case when kv.vrata_ok then 'DA' else 'NE' end as vrata_brtve,
  kv.temperatura,
  kv.granica_min,
  kv.granica_max,
  case when kv.temperatura_ok is null then '' when kv.temperatura_ok then 'DA' else 'NE' end as temperatura_u_granici,
  kv.ukupan_status as rezultat,
  kv.napomena,
  kv.created_at
from kontrola_vozila kv
join vozilo v on v.id = kv.vozilo_id
left join korisnik k on k.id = kv.izvrsio_korisnik_id
left join lice l on l.id = k.lice_id;

create or replace view v_izvoz_provjere_nc as
select
  n.broj as neusaglasenost,
  n.opis,
  km.opis as korektivna_mjera,
  km.rezultat as uradjeno,
  coalesce(lz.ime, kz.korisnicko_ime) as mjeru_uradio,
  to_char(km.zavrseno_at at time zone 'Europe/Podgorica', 'YYYY-MM-DD HH24:MI') as mjera_zavrsena,
  vf.rezultat as provjera,
  coalesce(lv.ime, kv.korisnicko_ime) as provjerio,
  to_char(vf.verifikovano_at at time zone 'Europe/Podgorica', 'YYYY-MM-DD HH24:MI') as provjereno,
  case when vf.izuzetak_cetiri_oka then 'DA' else 'NE' end as bez_cetiri_oka,
  vf.napomena,
  vf.verifikovano_at as created_at
from verifikacija vf
join neusaglasenost n on n.id = vf.neusaglasenost_id
left join korektivna_mjera km on km.id = vf.korektivna_mjera_id
left join korisnik kz on kz.id = km.zavrsio_korisnik_id
left join lice lz on lz.id = kz.lice_id
left join korisnik kv on kv.id = vf.verifikovao_korisnik_id
left join lice lv on lv.id = kv.lice_id;

create or replace view v_izvoz_termometri as
select
  u.naziv as uredjaj,
  u.oznaka,
  u.lokacija,
  p.datum,
  p.vrsta,
  p.referentna,
  p.izmjereno,
  p.dozvoljeno_odstupanje,
  p.rezultat,
  p.broj_sertifikata,
  p.izvrsilac,
  p.napomena,
  p.created_at
from provjera_uredjaja p
join mjerni_uredjaj u on u.id = p.uredjaj_id;

create or replace view v_izvoz_verifikacija_sistema as
select
  vs.vrsta,
  vs.datum,
  vs.izvrsilac,
  vs.nalaz,
  vs.zakljucak,
  vs.sljedeca_do,
  vs.created_at
from verifikacija_sistema vs;

create or replace view v_izvoz_kretanja_zalihe as
select
  to_char(kz.created_at at time zone 'Europe/Podgorica', 'YYYY-MM-DD HH24:MI') as vrijeme,
  a.naziv as artikal,
  l.broj_lota as lot,
  kz.tip,
  kz.kolicina_delta as promjena,
  kz.referenca_tip,
  coalesce(li.ime, k.korisnicko_ime) as izvrsio,
  kz.napomena,
  kz.created_at
from kretanje_zalihe kz
join lot l on l.id = kz.lot_id
join artikal a on a.id = kz.artikal_id
left join korisnik k on k.id = kz.izvrsio_korisnik_id
left join lice li on li.id = k.lice_id;
