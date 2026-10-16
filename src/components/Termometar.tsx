import { useEffect, useState } from "react";
import { api } from "../lib/api";

export type Termometar = { id: string; naziv: string; oznaka: string | null; lokacija: string | null; stanje: "NEISPRAVAN" | "ISTEKLA" | "USKORO" | "VAZI" };

/** Termometri u upotrebi i izabrani (nalaz R-23: mjerenje pamti kojim je termometrom urađeno).
 * Kad je upotrebljiv samo jedan, bira se sam. */
export function useIzborTermometra() {
  const [termometri, setTermometri] = useState<Termometar[] | null>(null);
  const [termometarId, setTermometarId] = useState("");
  useEffect(() => {
    api<Termometar[]>("/termometri")
      .then((t) => {
        setTermometri(t);
        const upotrebljivi = t.filter((x) => x.stanje !== "NEISPRAVAN");
        if (upotrebljivi.length === 1) setTermometarId((id) => id || upotrebljivi[0].id);
      })
      .catch(() => setTermometri([]));
  }, []);
  return { termometri: termometri ?? [], ucitano: termometri !== null, termometarId, setTermometarId };
}

/** Izbor termometra. Onaj koji nije prošao provjeru se vidi, ali se ne može izabrati. */
export function IzborTermometra({ termometri, value, onChange, obavezan }: { termometri: Termometar[]; value: string; onChange: (id: string) => void; obavezan?: boolean }) {
  if (termometri.length === 0) return null;
  return (
    <label>
      Termometar{obavezan ? "" : " (opciono)"}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— izaberite termometar —</option>
        {termometri.map((t) => (
          <option key={t.id} value={t.id} disabled={t.stanje === "NEISPRAVAN"}>
            {t.naziv}{t.oznaka ? ` (${t.oznaka})` : ""}{t.stanje === "NEISPRAVAN" ? " — nije prošao provjeru" : t.stanje === "ISTEKLA" ? " — provjera istekla" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
