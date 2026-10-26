-- P4 (PILOT Poslastičarnica, 27.10.2026 — PLAN.md 8.4, 8.6): broj serije (lot) pri prijemu NIJE obavezan kad ga
-- roba nema (pijaca, pekara, market), ali trag jeste — dobavljač + račun/otpremnica + datum. Takav lot dobija oznaku
-- „bez serije · <dokument> · <datum>“ (prijemService) i po njoj se traži, veže za tortu i povlači (čl. 27, 28).
-- Artikal kome je serija obavezna (`artikal.zahtijeva_lot`, npr. jaja — oznaka sa jajeta ili kutije) bez nje se ne
-- prima. Za nove artikle je serija ubuduće izbor, ne podrazumijevano: većina sastojka ateljea je nema na pakovanju.

-- Lot upisan bez broja serije sa etikete — da ekran, izvoz i inspektor vide da je oznaka trag dokumenta, ne serija.
alter table lot add column if not exists bez_broja boolean not null default false;

alter table artikal alter column zahtijeva_lot set default false;
