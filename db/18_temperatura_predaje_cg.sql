-- KKT 3: temperatura robe u trenutku predaje kupcu.
--
-- Do sada je hladni lanac bio dokazan do vrata vozila (D1 kontrola vozila), ali ne i do kupca.
-- Inspektor koji pita "na kojoj je temperaturi jogurt predat marketu" nije imao odgovor.
-- Upisuje se po stavci, jer ista isporuka nosi i rashlađeno (0–5 °C) i smrznuto (−20 do −15 °C).
--
-- Ne dira podatke — stare isporuke ostaju bez temperature, i tako se i prikazuju.
alter table isporuka_stavka add column if not exists temperatura_predaje numeric(5, 2);
