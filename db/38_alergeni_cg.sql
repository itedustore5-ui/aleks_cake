-- Alergeni sastojka (PILOT Poslastičarnica, 18.10.2026 — PLAN.md 8.4): artikal nosi koje od 14 alergena iz
-- Uredbe (EU) 1169/2011, Prilog II sadrži. Porudžbina torte iz toga PREDLAŽE alergene, a čovjek ih potvrđuje
-- prije predaje (P1, dopuna 39). Spisak šifara je isti kao server/alergeni.ts — mijenja se na oba mjesta.
--
-- alergeni_upisani: prazan spisak sam ne znači „nema alergena“ — znači i „niko još nije pogledao deklaraciju“.
-- Postaje true kad neko u Šifarnicima sačuva alergene artikla (i kad ih nema). Do tada porudžbina upozorava.
alter table artikal add column if not exists alergeni varchar(20)[] not null default '{}';
alter table artikal add column if not exists alergeni_upisani boolean not null default false;

alter table artikal drop constraint if exists chk_artikal_alergeni;
alter table artikal add constraint chk_artikal_alergeni check (
  alergeni <@ array['GLUTEN', 'RAKOVI', 'JAJA', 'RIBA', 'KIKIRIKI', 'SOJA', 'MLIJEKO', 'ORASASTI', 'CELER', 'SENF', 'SUSAM', 'SULFITI', 'LUPINA', 'MEKUSCI']::varchar(20)[]
);
