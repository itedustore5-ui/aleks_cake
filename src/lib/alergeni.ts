import { useEffect, useState } from "react";
import { api } from "./api";

/** 14 alergena iz Priloga II Uredbe (EU) 1169/2011 — spisak drži server (server/alergeni.ts), ovdje se samo čita. */
export type Alergen = { sifra: string; naziv: string; opis: string };

let kes: Alergen[] | null = null;

export function useAlergeni() {
  const [lista, setLista] = useState<Alergen[]>(kes ?? []);
  useEffect(() => {
    if (kes) return;
    api<Alergen[]>("/alergeni")
      .then((l) => {
        kes = l;
        setLista(l);
      })
      .catch(() => {});
  }, []);
  const naziv = (sifra: string) => lista.find((a) => a.sifra === sifra)?.naziv ?? sifra;
  /** „Jaja, Mlijeko, Gluten“ — redom iz Priloga II, ne redom kojim su kliknuti. */
  const nazivi = (sifre: readonly string[]) => lista.filter((a) => sifre.includes(a.sifra)).map((a) => a.naziv).join(", ");
  return { lista, naziv, nazivi };
}
