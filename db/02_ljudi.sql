-- Ljudi: SVI zaposleni (invarijanta — jedan spisak, ne dva). rukuje_hranom odlučuje za koga
-- važe sanitarna knjižica i plan obuke. Nalog za prijavu (korisnik) je odvojen od lica —
-- spojeni preko korisnik.lice_id, jer nemaju svi zaposleni nalog za prijavu.
create table lice (
  id uuid primary key default gen_random_uuid(),
  ime varchar(200) not null,
  radno_mjesto varchar(100),
  rukuje_hranom boolean not null default true,
  sifra varchar(20) not null unique, -- za potpisivanje zapisa i ulazak u provjeru znanja
  sanitarna_knjizica_broj varchar(100),
  sanitarna_knjizica_rok date, -- rok dokumenta, NIKAD nalaz pregleda
  aktivan boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table korisnik add constraint fk_korisnik_lice foreign key (lice_id) references lice (id);
create index idx_korisnik_lice on korisnik (lice_id);

-- Prilog 13: godišnji plan obuke kao PLAN sa stanjem, ne kao dnevni zapis.
-- Stavka koja je prošla bez obuke se ne briše — ostaje i izlazi na štampu kao "kasni".
create table plan_obuke (
  id uuid primary key default gen_random_uuid(),
  lice_id uuid not null references lice (id),
  tema varchar(200) not null,
  planirani_datum date not null,
  obavljeno_datum date,
  napomena text,
  created_at timestamptz not null default now()
);

create index idx_plan_obuke_lice on plan_obuke (lice_id);
create index idx_plan_obuke_planirani_datum on plan_obuke (planirani_datum);
