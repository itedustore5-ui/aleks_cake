-- R-12 (27.09.2026): Supabase uz svaki projekat nudi i svoj REST pristup (Data API) sa javnim „anon"
-- ključem. Security Advisor je potvrdio da je šema public izložena bez RLS-a na ijednoj tabeli — ko ima
-- ključ čitao bi i pisao sve (heševe lozinki, sesije, VAPID ključ) mimo aplikacije i mimo svih pravila.
--
-- Prva brava je u panelu (Data API isključen). Ovo je druga, u bazi — važi i ako neko API ponovo uključi:
--   1. RLS na svakoj tabeli šeme public, BEZ ijedne politike → javne uloge ne vide nijedan red.
--      Aplikacija radi kao vlasnik tabela, a vlasnika RLS ne ograničava (bez FORCE) — zato se RLS
--      uključuje SAMO na tabelama čiji je vlasnik korisnik koji pokreće migracije (isti kao aplikacija).
--   2. Pogledi računaju prava onoga KO PITA (security_invoker), ne vlasnika — inače bi pogled bio
--      zaobilaznica oko RLS-a (Advisor: „Security Definer View").
--   3. Uloge anon i authenticated gube sva prava na tabele, poglede i sekvence, i na one koje se tek
--      naprave (podrazumijevana prava) — samo gdje te uloge postoje (Supabase; lokalna baza ih nema).
-- Nova tabela ili pogled u kasnijoj dopuni: `enable row level security` / `with (security_invoker = true)`
-- — test `bezbjednost_baze` pada ako se zaboravi (invarijanta #78).
do $$
declare
  r record;
  preskoceno text := '';
begin
  for r in
    select c.oid::regclass as naziv, c.relkind, pg_has_role(current_user, c.relowner, 'USAGE') as moja
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
    order by 1
  loop
    if not r.moja then
      preskoceno := preskoceno || ' ' || r.naziv::text;
    elsif r.relkind = 'v' then
      execute format('alter view %s set (security_invoker = true)', r.naziv);
    else
      execute format('alter table %s enable row level security', r.naziv);
    end if;
  end loop;
  if preskoceno <> '' then
    raise notice 'RLS/security_invoker preskočen (vlasnik je drugi korisnik):%', preskoceno;
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on all tables in schema public from anon;
    revoke all on all sequences in schema public from anon;
    alter default privileges in schema public revoke all on tables from anon;
    alter default privileges in schema public revoke all on sequences from anon;
    alter default privileges in schema public revoke all on functions from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on all tables in schema public from authenticated;
    revoke all on all sequences in schema public from authenticated;
    alter default privileges in schema public revoke all on tables from authenticated;
    alter default privileges in schema public revoke all on sequences from authenticated;
    alter default privileges in schema public revoke all on functions from authenticated;
  end if;
end $$;
