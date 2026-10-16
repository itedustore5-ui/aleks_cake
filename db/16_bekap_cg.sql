-- Bekap iz aplikacije: snimak svih tabela kao jsonb, čuva se u bazi (ne štiti od gubitka
-- cijele Supabase baze — za to i dalje služi alati/bekap.ps1 sa pg_dump, van koda). Ono što
-- ovo štiti je greška u aplikaciji ili čovjeku, gdje treba stanje "od prije nedelju dana".
create table bekap_log (
  id uuid primary key default gen_random_uuid(),
  tip varchar(20) not null, -- RUCNI | AUTOMATSKI
  pokrenuo_korisnik_id uuid references korisnik (id),
  broj_tabela integer not null,
  broj_redova integer not null,
  podaci jsonb not null,
  created_at timestamptz not null default now()
);

create index idx_bekap_log_created on bekap_log (created_at desc);
