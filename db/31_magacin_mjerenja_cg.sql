-- Mjerenje temperature i dnevni zapis pamte MAGACIN u kom su urađeni (#77).
-- Zašto: plan monitoringa se vodi po magacinu („Temperatura komora — Glavni magacin“). Kad firma ima
-- više magacina i više magacionera, mjerenje u jednom magacinu ne smije „pokriti“ drugi — a u istom
-- magacinu ono što je uradio jedan magacioner više ne stoji drugome kao obaveza.
-- Stari redovi bez magacina se računaju za sve magacine (kao do sada).

alter table mjerenje_temperature add column if not exists skladiste_id uuid references skladiste (id);
alter table zapis add column if not exists skladiste_id uuid references skladiste (id);

-- Gdje se zna: mjerenje lota je u magacinu njegovog prijema.
update mjerenje_temperature m
   set skladiste_id = p.skladiste_id
  from lot l join prijem p on p.id = l.prijem_id
 where m.lot_id = l.id and m.skladiste_id is null and p.skladiste_id is not null;

-- Firma sa jednim magacinom: sve staro je iz njega.
update mjerenje_temperature
   set skladiste_id = (select id from skladiste where aktivan order by created_at, naziv limit 1)
 where skladiste_id is null and (select count(*) from skladiste where aktivan) = 1;
update zapis
   set skladiste_id = (select id from skladiste where aktivan order by created_at, naziv limit 1)
 where skladiste_id is null and (select count(*) from skladiste where aktivan) = 1;

create index if not exists idx_mjerenje_tacka_vrijeme on mjerenje_temperature (kontrolna_tacka_id, izmjereno_at);
create index if not exists idx_zapis_skladiste on zapis (skladiste_id);
