-- Faza 2 (nalaz B2): odakle je došla neusaglašenost, zadatak ili obavještenje.
--
-- izvor_tip je bio slobodan tekst: greška u kucanju je prolazila, a veza (izvor_tip, izvor_id)
-- pokazivala u prazno — neusaglašenost bez odakle, zadatak koji se nikad ne zatvori sam jer
-- zatvoriZadatkeIzvora() traži drugi naziv. Sada baza prima samo poznate izvore.
--
-- ISTI spiskovi stoje u kodu: IZVORI_ZADATKA i IZVORI_OBAVJESTENJA u
-- server/services/zadaciService.ts (tip — greška pada već pri typecheck-u). Nov izvor se dodaje
-- na OBA mjesta, novom dopunom.
--
-- Ne dira podatke. Ograničenje se dodaje NOT VALID (važi za nove redove odmah), pa se pokuša
-- provjeriti i nad starim redovima. Ako neki stari red ima nepoznat izvor, ograničenje ostaje
-- NOT VALID i dopuna ispiše NOTICE — dopuna ne pada i ništa se ne briše.

do $$
begin
  alter table neusaglasenost add constraint chk_neusaglasenost_izvor_tip check (
    izvor_tip in ('mjerenje_temperature', 'kontrola_vozila', 'povlacenje', 'zapis', 'rucno', 'isporuka', 'prijem')
  ) not valid;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table zadatak add constraint chk_zadatak_izvor_tip check (
    izvor_tip is null or izvor_tip in ('neusaglasenost', 'povlacenje', 'rucno')
  ) not valid;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table obavjestenje add constraint chk_obavjestenje_izvor_tip check (
    izvor_tip is null or izvor_tip in ('neusaglasenost', 'povlacenje', 'lot', 'prijem', 'isporuka', 'zadatak', 'poruka', 'bekap_log')
  ) not valid;
exception when duplicate_object then null;
end $$;

-- Pokušaj da se ograničenja potvrde i nad postojećim redovima.
do $$
declare
  ogranicenje record;
begin
  for ogranicenje in
    select * from (values
      ('neusaglasenost', 'chk_neusaglasenost_izvor_tip'),
      ('zadatak', 'chk_zadatak_izvor_tip'),
      ('obavjestenje', 'chk_obavjestenje_izvor_tip')
    ) as o (tabela, naziv)
  loop
    begin
      execute format('alter table %I validate constraint %I', ogranicenje.tabela, ogranicenje.naziv);
    exception when check_violation then
      raise notice '%: postoje stari redovi sa nepoznatim izvor_tip — ograničenje važi samo za nove redove. Provjeriti: select izvor_tip, count(*) from % group by 1;',
        ogranicenje.tabela, ogranicenje.tabela;
    end;
  end loop;
end $$;
