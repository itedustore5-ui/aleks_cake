import { upit } from "../db.js";

// Sledljivost unazad: lot → prijem → dobavljač (v_sledljivost_naprijed, dopuna 12). Unaprijed — lot → torte →
// kupci — čita porudzbinaService (v_sledljivost_porudzbine, dopuna 39). Kolone isporuka u pogledu ostaju prazne.
export async function pretraziSledljivost(tekst: string) {
  const uzorak = `%${tekst}%`;
  const rezultat = await upit(
    `select distinct on (lot_id) * from v_sledljivost_naprijed
     where broj_lota ilike $1 or dobavljac ilike $1 or broj_dokumenta ilike $1 or artikal ilike $1
     order by lot_id, datum_prijema desc limit 50`,
    [uzorak],
  );
  return rezultat.rows.sort((a, b) => String(b.datum_prijema).localeCompare(String(a.datum_prijema)));
}

export async function lanacNaprijedZaLot(lotId: string) {
  const rezultat = await upit(`select distinct on (lot_id) * from v_sledljivost_naprijed where lot_id = $1`, [lotId]);
  return rezultat.rows;
}
