import { useEffect, useState } from "react";
import { api } from "./api";

export type Skladiste = { id: string; naziv: string; adresa: string | null; aktivan: boolean };

/** Firma sa jednim skladištem ne vidi izbor skladišta nigdje — `vise` odlučuje da li se polje
 * i kolona uopšte prikazuju. `podrazumijevano`: matično skladište naloga, pa prvo aktivno. */
export function useSkladista() {
  const [podaci, setPodaci] = useState<{ skladista: Skladiste[]; maticno: string | null }>({ skladista: [], maticno: null });

  const osvjezi = () =>
    api<{ skladista: Skladiste[]; maticno: string | null }>("/skladista")
      .then(setPodaci)
      .catch(() => {});

  useEffect(() => {
    osvjezi();
  }, []);

  const aktivna = podaci.skladista.filter((s) => s.aktivan);
  const podrazumijevano = podaci.maticno && aktivna.some((s) => s.id === podaci.maticno) ? podaci.maticno : (aktivna[0]?.id ?? "");
  return { sva: podaci.skladista, aktivna, vise: aktivna.length > 1, maticno: podaci.maticno, podrazumijevano, osvjezi };
}
