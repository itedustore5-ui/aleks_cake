import { useRef, useState } from "react";

/** Zaključava dugme dok zahtjev traje (nalaz R-10): drugi klik ne šalje ništa, a dugme pokazuje da se radi. */
export function useSlanje() {
  const uToku = useRef(false);
  const [radim, setRadim] = useState(false);
  const salji = async (fn: () => Promise<void>) => {
    if (uToku.current) return;
    uToku.current = true;
    setRadim(true);
    try {
      await fn();
    } finally {
      uToku.current = false;
      setRadim(false);
    }
  };
  return { radim, salji };
}

/** Ključ zahtjeva — jedan po otvorenoj formi. Server isti ključ ne upisuje dvaput, pa ponovljeno
 * slanje (izgubljen odgovor na slaboj mreži) vraća prvi prijem ili isporuku umjesto drugog. */
export function noviKljuc(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    // stariji pregledač ili stranica bez HTTPS-a — ispod je zamjena
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}
