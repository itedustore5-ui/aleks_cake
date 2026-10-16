-- Događaji i audit log — imutabilni. Nikad se ne brišu niti mijenjaju kroz UI.
create table dogadjaj (
  id uuid primary key default gen_random_uuid(),
  tip_dogadjaja varchar(50) not null, -- npr. EVT-014 (prihvati prijem)
  entitet_tip varchar(50) not null,
  entitet_id uuid not null,
  korisnik_id uuid references korisnik (id),
  desilo_se_at timestamptz not null default now(),
  podaci jsonb not null default '{}'::jsonb,
  korelacija_id uuid
);

create index idx_dogadjaj_entitet on dogadjaj (entitet_tip, entitet_id);
create index idx_dogadjaj_tip_vrijeme on dogadjaj (tip_dogadjaja, desilo_se_at);
create index idx_dogadjaj_korelacija on dogadjaj (korelacija_id);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  dogadjaj_id uuid references dogadjaj (id),
  korisnik_id uuid references korisnik (id),
  akcija varchar(50) not null,
  entitet_tip varchar(50) not null,
  entitet_id uuid not null,
  stare_vrijednosti jsonb,
  nove_vrijednosti jsonb,
  ip_adresa inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index idx_audit_entitet on audit_log (entitet_tip, entitet_id);
create index idx_audit_created_at on audit_log (created_at);
