import { useEffect, useState } from "react";
import { Printer, Search } from "lucide-react";
import { api } from "../lib/api";
import { PageHeader, StampaZaglavlje } from "../components/Zajednicko";
import { FilterVremena, opisPerioda, type Period } from "../components/FilterVremena";

type AuditRed = {
  id: string;
  akcija: string;
  entitet_tip: string;
  entitet_id: string;
  korisnicko_ime: string | null;
  korisnik_ime: string | null;
  stare_vrijednosti: Record<string, unknown> | null;
  nove_vrijednosti: Record<string, unknown> | null;
  created_at: string;
};
type Filteri = { tipovi: string[]; akcije: string[]; korisnici: { id: string; ime: string }[] };

// Čitljivi nazivi — u bazi ostaju šifre (entitet_tip, akcija), na ekranu ono što čovjek razumije.
const AKCIJE: Record<string, string> = {
  KREIRANJE: "Upis",
  IZMJENA: "Izmjena",
  PROMJENA_STATUSA: "Promjena statusa",
  ODLUKA: "Odluka",
  SIGURNOST: "Prijava i sigurnost",
};
const ENTITETI: Record<string, string> = {
  prijem: "Prijem",
  lot: "Lot",
  isporuka: "Isporuka",
  neusaglasenost: "Neusaglašenost",
  korektivna_mjera: "Korektivna mjera",
  kontrola_vozila: "Kontrola vozila (D1)",
  vozilo: "Vozilo",
  zapis: "Dnevni zapis",
  mjerenje_temperature: "Mjerenje temperature",
  kretanje_zalihe: "Kretanje zalihe",
  povlacenje: "Povlačenje",
  povlacenje_kontakt: "Kontakt povlačenja",
  korisnik: "Nalog",
  lice: "Zaposleni",
  plan_obuke: "Plan obuke",
  artikal: "Artikal",
  dobavljac: "Dobavljač",
  kupac: "Kupac",
  skladiste: "Magacin",
  pravilo_kontrole: "Granica (pravilo kontrole)",
  kontrolna_tacka: "Kontrolna tačka",
  plan_monitoringa: "Plan monitoringa",
  mjerni_uredjaj: "Termometar",
  provjera_uredjaja: "Provjera termometra",
  verifikacija_sistema: "Verifikacija sistema",
  zadatak: "Zadatak",
  poruka: "Poruka",
  pitanje: "Pitanje za provjeru znanja",
  sesija_znanja: "Termin provjere znanja",
  firma: "Firma",
};
const nazivEntiteta = (t: string) => ENTITETI[t] ?? t;

const prikaz = (v: unknown) => (v === null || v === undefined || v === "" ? "∅" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** Kod izmjene: „polje: bilo → sada" (R-06); inače samo nove vrijednosti. */
function formatirajDetalje(stare: Record<string, unknown> | null, nove: Record<string, unknown> | null): string {
  if (!nove && !stare) return "—";
  const kljucevi = Array.from(new Set([...Object.keys(stare ?? {}), ...Object.keys(nove ?? {})]));
  const parovi = kljucevi
    .map((k) => {
      const imaStaro = !!stare && k in stare;
      const novo = nove?.[k];
      if (imaStaro) return `${k}: ${prikaz(stare![k])} → ${prikaz(novo)}`;
      return novo === null || novo === undefined || novo === "" ? null : `${k}: ${prikaz(novo)}`;
    })
    .filter(Boolean);
  return parovi.length === 0 ? "—" : parovi.join(" · ");
}

export function Audit() {
  const [lista, setLista] = useState<AuditRed[]>([]);
  const [filteri, setFilteri] = useState<Filteri>({ tipovi: [], akcije: [], korisnici: [] });
  const [period, setPeriod] = useState<Period>({ od: "", do: "" });
  const [entitet, setEntitet] = useState("");
  const [akcija, setAkcija] = useState("");
  const [korisnikId, setKorisnikId] = useState("");
  const [trazi, setTrazi] = useState("");
  const [ucitavam, setUcitavam] = useState(false);

  useEffect(() => {
    api<Filteri>("/audit/filteri").then(setFilteri);
  }, []);

  // Tekst se traži tek kad se prestane kucati (0,4 s), ostalo odmah.
  useEffect(() => {
    const q = new URLSearchParams();
    if (entitet) q.set("entitetTip", entitet);
    if (akcija) q.set("akcija", akcija);
    if (korisnikId) q.set("korisnikId", korisnikId);
    if (period.od) q.set("od", period.od);
    if (period.do) q.set("do", period.do);
    if (trazi.trim()) q.set("q", trazi.trim());
    const t = window.setTimeout(() => {
      setUcitavam(true);
      api<AuditRed[]>(`/audit${q.toString() ? `?${q}` : ""}`)
        .then(setLista)
        .finally(() => setUcitavam(false));
    }, trazi ? 400 : 0);
    return () => window.clearTimeout(t);
  }, [entitet, akcija, korisnikId, period, trazi]);

  const imaFiltera = entitet || akcija || korisnikId || period.od || period.do || trazi;
  const imeKorisnika = filteri.korisnici.find((k) => k.id === korisnikId)?.ime;

  return (
    <>
      <PageHeader
        title="Audit trag"
        description="Imutabilan zapis — ne može se mijenjati niti brisati kroz aplikaciju. Ko je šta upisao ili promijenio, kada, i šta je bilo prije."
        action={
          <button className="secondary-button" onClick={() => window.print()} disabled={lista.length === 0}>
            <Printer size={15} /> Štampaj
          </button>
        }
      />
      <StampaZaglavlje
        naslov="Audit trag"
        filteri={[
          opisPerioda(period),
          entitet ? `nad: ${nazivEntiteta(entitet)}` : "",
          akcija ? `radnja: ${AKCIJE[akcija] ?? akcija}` : "",
          imeKorisnika ? `ko: ${imeKorisnika}` : "",
          trazi ? `traži: „${trazi}“` : "",
        ]}
        brojRedova={lista.length}
      />
      <FilterVremena period={period} onChange={setPeriod} />
      <div className="filter-bar no-print">
        <label>
          Nad čim
          <select value={entitet} onChange={(e) => setEntitet(e.target.value)}>
            <option value="">Sve</option>
            {filteri.tipovi.map((t) => <option key={t} value={t}>{nazivEntiteta(t)}</option>)}
          </select>
        </label>
        <label>
          Radnja
          <select value={akcija} onChange={(e) => setAkcija(e.target.value)}>
            <option value="">Sve</option>
            {filteri.akcije.map((a) => <option key={a} value={a}>{AKCIJE[a] ?? a}</option>)}
          </select>
        </label>
        <label>
          Ko
          <select value={korisnikId} onChange={(e) => setKorisnikId(e.target.value)}>
            <option value="">Svi</option>
            {filteri.korisnici.map((k) => <option key={k.id} value={k.id}>{k.ime}</option>)}
          </select>
        </label>
        <label className="filter-pretraga">
          Traži u vrijednostima
          <span>
            <Search size={13} />
            <input value={trazi} onChange={(e) => setTrazi(e.target.value)} placeholder="npr. broj lota, LOT-2409, HOLD" />
          </span>
        </label>
        {imaFiltera && (
          <button className="link-button" onClick={() => { setEntitet(""); setAkcija(""); setKorisnikId(""); setPeriod({ od: "", do: "" }); setTrazi(""); }}>
            Poništi filtere
          </button>
        )}
        <span className="filter-broj">{ucitavam ? "Učitavanje..." : `${lista.length}${lista.length === 500 ? " (najnovijih 500 — suzite filter)" : ""}`}</span>
      </div>
      <div className="panel full-panel audit-table-shell">
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Vrijeme</th>
                <th>Ko</th>
                <th>Radnja</th>
                <th>Nad čim</th>
                <th>Detalji (bilo → sada)</th>
              </tr>
            </thead>
            <tbody>
              {!ucitavam && lista.length === 0 && (
                <tr><td colSpan={5} className="muted-text" style={{ padding: 20 }}>{imaFiltera ? "Ništa za izabrani filter." : "Dnevnik je prazan."}</td></tr>
              )}
              {lista.map((a) => (
                <tr key={a.id}>
                  <td className="muted-text">{new Date(a.created_at).toLocaleString("sr-Latn-ME")}</td>
                  <td>{a.korisnik_ime ?? a.korisnicko_ime ?? "sistem"}</td>
                  <td>{AKCIJE[a.akcija] ?? a.akcija}</td>
                  <td>{nazivEntiteta(a.entitet_tip)}</td>
                  <td className="muted-text">{formatirajDetalje(a.stare_vrijednosti, a.nove_vrijednosti)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
