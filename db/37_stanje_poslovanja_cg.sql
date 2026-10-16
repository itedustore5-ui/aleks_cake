-- Izvještaj „Stanje poslovanja“ za direktora (11.10.2026): konsultant bira period i šalje ga mejlom.
-- Primaoci se pamte uz firmu (direktor, po želji još neko); svako slanje ostaje zapisano — da se zna šta je poslato,
-- kome i kada (i da se ne pošalje isti mjesečni dvaput bez znanja).
alter table firma add column if not exists izvjestaj_primaoci text;

create table if not exists izvjestaj_poslat (
  id uuid primary key default gen_random_uuid(),
  vrsta varchar(20) not null,
  period_od date not null,
  period_do date not null,
  primaoci text not null,
  poslao_korisnik_id uuid references korisnik (id),
  created_at timestamptz not null default now(),
  constraint chk_izvjestaj_vrsta check (vrsta in ('dan', 'sedmica', 'mjesec', 'kvartal', 'polugodiste', 'godina'))
);
create index if not exists idx_izvjestaj_poslat_created on izvjestaj_poslat (created_at desc);

-- Kao svaka tabela (#78): RLS uključen, bez politika — javne uloge Supabase-a ne vide ništa.
alter table izvjestaj_poslat enable row level security;
