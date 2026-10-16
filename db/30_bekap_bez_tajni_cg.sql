-- Mali talas 4 (R-19): bekap iz aplikacije se preuzima na računar i šalje dalje, pa ne smije nositi
-- heševe lozinki. Novi bekapi ih nemaju (bekapService); iz starih, sačuvanih u bazi, briše se ovdje.
update bekap_log
set podaci = jsonb_set(
  podaci, '{korisnik}',
  coalesce((select jsonb_agg(e - 'lozinka_hash') from jsonb_array_elements(podaci -> 'korisnik') e), '[]'::jsonb)
)
where jsonb_typeof(podaci -> 'korisnik') = 'array';
