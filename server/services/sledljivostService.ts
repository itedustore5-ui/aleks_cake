import { upit } from "../db.js";

export async function pretraziSledljivost(tekst: string) {
  const uzorak = `%${tekst}%`;
  const rezultat = await upit(
    `select * from v_sledljivost_naprijed
     where broj_lota ilike $1 or dobavljac ilike $1 or kupac ilike $1
        or broj_dokumenta ilike $1 or isporuka_broj ilike $1 or artikal ilike $1
     order by datum_prijema desc limit 50`,
    [uzorak],
  );
  return rezultat.rows;
}

export async function lanacNaprijedZaLot(lotId: string) {
  const rezultat = await upit(`select * from v_sledljivost_naprijed where lot_id = $1`, [lotId]);
  return rezultat.rows;
}

export async function lanacNazadZaIsporuku(isporukaId: string) {
  const rezultat = await upit(`select * from v_sledljivost_nazad where isporuka_id = $1`, [isporukaId]);
  return rezultat.rows;
}

