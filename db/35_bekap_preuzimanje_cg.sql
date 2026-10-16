-- Bekap iz aplikacije se više ne čuva u bazi (04.10.2026). Svaki bekap — i sedmični automatski — bio je
-- puna kopija podataka u ISTOJ bazi, 90 dana: trošio je prostor (besplatni Supabase ima 500 MB, pa prelazi
-- u „samo čitanje“), a od gubitka baze ne štiti. Sada se JSON preuzima direktno; u bekap_log ostaje samo
-- ko je i kad preuzeo, i koliko je bio velik. Stare kopije se brišu odmah.
-- Prostor koji su zauzimale baza ponovo koristi za nove podatke; da se i broj u Supabase panelu smanji,
-- jednom u SQL editoru: vacuum full bekap_log;  (ne može ovdje — dopuna ide u transakciji).
alter table bekap_log alter column podaci drop not null;
alter table bekap_log add column if not exists velicina_bajtova bigint;
update bekap_log set podaci = null where podaci is not null;
