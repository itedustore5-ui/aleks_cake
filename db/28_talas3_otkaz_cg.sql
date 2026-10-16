-- Treći talas popravki posle revizije 25.09.2026 — R-15: isporuka se može otkazati (prije predaje).
-- Nova vrijednost enuma ide u SVOJ fajl: ne smije se koristiti u istoj transakciji u kojoj je dodata
-- (naučeno na teži način), a 29 je već koristi u ograničenju.
alter type isporuka_status_t add value if not exists 'OTKAZANA';
