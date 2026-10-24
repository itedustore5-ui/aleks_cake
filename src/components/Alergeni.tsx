import { useAlergeni } from "../lib/alergeni";

/** Kvačice za 14 alergena. `zakljucani` su oni koji dolaze iz sastojaka porudžbine — ne mogu se skinuti
 * (P1): ako sastojak nije u torti, uklanja se njegov lot, ne alergen. */
export function IzborAlergena({
  izabrani,
  onChange,
  zakljucani = [],
}: {
  izabrani: string[];
  onChange: (sifre: string[]) => void;
  zakljucani?: string[];
}) {
  const { lista } = useAlergeni();
  const prebaci = (sifra: string) => {
    if (zakljucani.includes(sifra)) return;
    onChange(izabrani.includes(sifra) ? izabrani.filter((s) => s !== sifra) : [...izabrani, sifra]);
  };
  return (
    <div className="alergeni-izbor">
      {lista.map((a) => {
        const iz = zakljucani.includes(a.sifra);
        return (
          <label key={a.sifra} className={`alergen-kvacica${izabrani.includes(a.sifra) ? " izabran" : ""}${iz ? " iz-sastojka" : ""}`} title={iz ? `${a.opis} — iz sastojka, ne može se skinuti` : a.opis}>
            <input type="checkbox" checked={izabrani.includes(a.sifra) || iz} disabled={iz} onChange={() => prebaci(a.sifra)} />
            <span>{a.naziv}</span>
          </label>
        );
      })}
    </div>
  );
}

/** Mala oznaka sa spiskom alergena, za liste. */
export function AlergeniOznaka({ sifre, prazno = "bez alergena" }: { sifre: readonly string[]; prazno?: string }) {
  const { nazivi } = useAlergeni();
  if (sifre.length === 0) return <span className="muted-text">{prazno}</span>;
  return <span className="alergeni-oznaka">{nazivi(sifre)}</span>;
}
