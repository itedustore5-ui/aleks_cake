import { useEffect, useState } from "react";
import { FilterVremena, opisPerioda, type Period } from "../components/FilterVremena";
import { Download, AlertCircle, Printer, FileText, Search } from "lucide-react";
import { api, preuzmiFajl, ApiGreska } from "../lib/api";
import { PageHeader, StampaZaglavlje } from "../components/Zajednicko";
import { NAZIVI as NAZIVI_STATUSA } from "../components/StatusBadge";

type Izvor = { kod: string; naziv: string; nedostaje?: boolean };
type Pregled = { naziv: string; kolone: string[]; redovi: Record<string, unknown>[]; ukupno: number; datumKolona: string | null; filteri: Record<string, string[]> };

// Čitljiva zaglavlja za kolone koje se najčešće vide; ostale: "broj_dokumenta" → "Broj dokumenta".
const ZAGLAVLJA: Record<string, string> = {
  created_at: "Upisano",
  updated_at: "Izmijenjeno",
  naknadno_dana: "Naknadno (dana)",
  skladiste_naziv: "Magacin",
  datum_prijema: "Datum prijema",
  datum_isporuke: "Datum isporuke",
  broj_lota: "Lot",
  rok_trajanja: "Rok trajanja",
  temperatura_predaje: "Temp. pri predaji (°C)",
  temperatura_prijema: "Temp. pri prijemu (°C)",
  obrazac_kod: "Obrazac",
  izvrsilac: "Izvršilac",
  vazeci: "Važeći",
  potvrdjeno_at: "Potvrđeno",
  odluka_at: "Odluka donesena",
  zavrseno_at: "Završeno",
  zatvoreno_at: "Zatvoreno",
  izvrseno_at: "Izvršeno",
  izmjereno_at: "Izmjereno",
  pokrenuto_at: "Pokrenuto",
  kontaktiran_at: "Kontaktiran",
  ukupan_status: "Rezultat",
  lot_status: "Status lota",
};
const naslovKolone = (k: string) => ZAGLAVLJA[k] ?? k.charAt(0).toUpperCase() + k.slice(1).replace(/_at$/, "").replace(/_/g, " ");
// Statusi se čitaju kao na ekranu aplikacije ("U pripremi"), ne kao šifra iz baze ("U_PRIPREMI").
const STATUSNE = new Set(["status", "ukupan_status", "lot_status", "rezultat", "ozbiljnost"]);
// Interni ID-jevi su za povezivanje tabela, ne za čitanje — ostaju u CSV-u, ne u pregledu.
const vidljiva = (k: string) => k !== "id" && !k.endsWith("_id") && k !== "lozinka_hash" && k !== "podaci";
const ISO_VRIJEME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/;

function prikazi(v: unknown, kolona = ""): string {
  if (STATUSNE.has(kolona) && typeof v === "string" && NAZIVI_STATUSA[v]) return NAZIVI_STATUSA[v];
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Da" : "Ne";
  if (typeof v === "object") return JSON.stringify(v);
  const t = String(v);
  if (ISO_VRIJEME.test(t)) return new Date(t).toLocaleString("sr-Latn-ME", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  if (ISO_DATUM.test(t)) return new Date(t).toLocaleDateString("sr-Latn-ME");
  return t;
}

export function Izvjestaji() {
  const [izvori, setIzvori] = useState<Izvor[]>([]);
  const [izabran, setIzabran] = useState<Izvor | null>(null);
  const [pregled, setPregled] = useState<Pregled | null>(null);
  const [ucitavam, setUcitavam] = useState(false);
  const [pretraga, setPretraga] = useState("");
  const [greska, setGreska] = useState("");
  const [preuzimam, setPreuzimam] = useState<string | null>(null);
  // Filter po vremenu ostaje kad se pređe na drugi izvještaj (isti period za cio inspekcijski pregled);
  // filteri po kategoriji (status, magacin…) važe za izabrani izvještaj.
  const [period, setPeriod] = useState<Period>({ od: "", do: "" });
  const [polja, setPolja] = useState<Record<string, string>>({});

  useEffect(() => {
    api<Izvor[]>("/izvoz/izvori").then(setIzvori);
  }, []);

  const upitFiltera = (p: Period, f: Record<string, string>) => {
    const q = new URLSearchParams();
    if (p.od) q.set("od", p.od);
    if (p.do) q.set("do", p.do);
    for (const [k, v] of Object.entries(f)) if (v) q.set(`f_${k}`, v);
    const s = q.toString();
    return s ? `?${s}` : "";
  };

  const ucitajPregled = async (i: Izvor, p: Period, f: Record<string, string>) => {
    setGreska("");
    setUcitavam(true);
    try {
      setPregled(await api<Pregled>(`/izvoz/${i.kod}/pregled${upitFiltera(p, f)}`));
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Pregled nije učitan.");
    } finally {
      setUcitavam(false);
    }
  };

  const otvori = async (i: Izvor) => {
    setIzabran(i);
    setPregled(null);
    setPretraga("");
    setPolja({});
    await ucitajPregled(i, period, {});
  };
  const promijeniPeriod = (p: Period) => {
    setPeriod(p);
    if (izabran) void ucitajPregled(izabran, p, polja);
  };
  const promijeniPolje = (k: string, v: string) => {
    const f = { ...polja, [k]: v };
    setPolja(f);
    if (izabran) void ucitajPregled(izabran, period, f);
  };

  const preuzmiCsv = async () => {
    if (!izabran) return;
    setGreska("");
    setPreuzimam(izabran.kod);
    try {
      await preuzmiFajl(`/izvoz/${izabran.kod}.csv${upitFiltera(pregled?.datumKolona ? period : { od: "", do: "" }, polja)}`, `${izabran.naziv}.csv`);
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Preuzimanje nije uspjelo.");
    } finally {
      setPreuzimam(null);
    }
  };

  const preuzmiSve = async () => {
    setGreska("");
    setPreuzimam("sve");
    try {
      const odgovor = await api<{ podaci: Record<string, unknown[]>; nedostaje: { naziv: string }[] }>("/izvoz/sve.json");
      const blob = new Blob([JSON.stringify(odgovor.podaci, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "izvoz-svih-podataka.json";
      a.click();
      URL.revokeObjectURL(url);
      if (odgovor.nedostaje.length > 0) setGreska(`Izvezeno je sve osim: ${odgovor.nedostaje.map((n) => n.naziv).join(", ")}.`);
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Izvoz nije uspio.");
    } finally {
      setPreuzimam(null);
    }
  };

  const kolone = (pregled?.kolone ?? []).filter(vidljiva);
  const tekst = pretraga.trim().toLowerCase();
  const redovi = (pregled?.redovi ?? []).filter((r) => !tekst || kolone.some((k) => prikazi(r[k], k).toLowerCase().includes(tekst)));

  return (
    <>
      <PageHeader
        title="Izvještaji i izvoz"
        description="1. Izaberite izvještaj · 2. Pregledajte ga na ekranu · 3. Štampajte ili preuzmite."
        action={
          <button className="secondary-button" onClick={preuzmiSve} disabled={preuzimam === "sve"}>
            <Download size={16} /> Izvezi sve (JSON)
          </button>
        }
      />
      {greska && (
        <div className="auth-error" style={{ marginBottom: 16 }}>
          <AlertCircle size={14} /> {greska}
        </div>
      )}

      <div className="izvjestaji-raspored">
        <div className="izvjestaji-spisak no-print">
          {izvori.map((i) => (
            <button key={i.kod} className={`izvjestaj-stavka${izabran?.kod === i.kod ? " izabran" : ""}`} onClick={() => otvori(i)} disabled={i.nedostaje}>
              <FileText size={14} />
              <span>{i.naziv}</span>
              {i.nedostaje && <small className="danas-fali">nema u bazi</small>}
            </button>
          ))}
        </div>

        <div className="izvjestaji-pregled">
          {!izabran && <div className="panel izvjestaj-prazno">Izaberite izvještaj lijevo — prvo se vidi na ekranu, pa se štampa ili preuzima.</div>}
          {izabran && (
            <>
              <StampaZaglavlje
                naslov={izabran.naziv}
                filteri={[
                  pregled?.datumKolona ? opisPerioda(period) : "",
                  ...Object.entries(polja).filter(([, v]) => v).map(([k, v]) => `${naslovKolone(k)}: ${prikazi(v, k)}`),
                  tekst ? `pretraga: „${pretraga.trim()}"` : "",
                ]}
                brojRedova={redovi.length}
              />
              {pregled?.datumKolona ? (
                <FilterVremena period={period} onChange={promijeniPeriod} oznaka={`Period · po koloni „${naslovKolone(pregled.datumKolona)}“`} />
              ) : (
                pregled && <p className="muted-text no-print" style={{ fontSize: 11, margin: "0 0 10px" }}>Ovaj izvještaj nema datum — prikazuje se cio spisak.</p>
              )}
              <div className="filter-bar">
                {Object.entries(pregled?.filteri ?? {}).map(([k, vrijednosti]) => (
                  <label key={k}>
                    {naslovKolone(k)}
                    <select value={polja[k] ?? ""} onChange={(e) => promijeniPolje(k, e.target.value)}>
                      <option value="">Sve</option>
                      {vrijednosti.map((v) => <option key={v} value={v}>{prikazi(v, k)}</option>)}
                    </select>
                  </label>
                ))}
                <label className="filter-pretraga">
                  Pretraga u pregledu
                  <span>
                    <Search size={13} />
                    <input value={pretraga} onChange={(e) => setPretraga(e.target.value)} placeholder="bilo šta iz tabele" />
                  </span>
                </label>
                <span className="filter-broj">
                  {ucitavam ? "Učitavanje..." : pregled && `${redovi.length} prikazano · za izabrani filter ${pregled.ukupno}${pregled.ukupno > pregled.redovi.length ? ` (pregled: najnovijih ${pregled.redovi.length}; CSV sadrži sve)` : ""}`}
                </span>
                <button className="secondary-button" onClick={preuzmiCsv} disabled={!pregled || preuzimam === izabran.kod}>
                  <Download size={15} /> CSV (filter, sve kolone)
                </button>
                <button className="primary-button" onClick={() => window.print()} disabled={!pregled || redovi.length === 0}>
                  <Printer size={15} /> Štampaj pregled
                </button>
              </div>
              <div className="panel full-panel">
                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>{kolone.map((k) => <th key={k}>{naslovKolone(k)}</th>)}</tr>
                    </thead>
                    <tbody>
                      {pregled && redovi.length === 0 && (
                        <tr><td colSpan={kolone.length || 1} className="muted-text" style={{ padding: 20 }}>{tekst ? "Ništa ne odgovara pretrazi." : "Ovaj izvještaj je prazan."}</td></tr>
                      )}
                      {redovi.map((r, i) => (
                        <tr key={i}>{kolone.map((k) => <td key={k}>{prikazi(r[k], k)}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
