import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Send, Download, FileText, AlertCircle } from "lucide-react";
import { api, preuzmiFajl, ApiGreska } from "../lib/api";
import { PageHeader } from "../components/Zajednicko";

// „Stanje poslovanja“ — konsultantov izvještaj direktoru (11.10.2026): izbor perioda, pregled tačno kakav stiže
// mejlom, primaoci i slanje. Server: services/stanjeService.ts.

const VRSTE = [
  { kod: "dan", naziv: "Dan" },
  { kod: "sedmica", naziv: "Sedmica" },
  { kod: "mjesec", naziv: "Mjesec" },
  { kod: "kvartal", naziv: "Kvartal" },
  { kod: "polugodiste", naziv: "Polugodište" },
  { kod: "godina", naziv: "Godina" },
] as const;
type Vrsta = (typeof VRSTE)[number]["kod"];

type Izvjestaj = {
  period: { vrsta: Vrsta; od: string; do: string; naziv: string; tekuci: boolean; ranije: string; kasnije: string | null; prethodni: { naziv: string } };
  firma: string;
  primaoci: string;
  predlogPrimalaca: string;
  ocjena: { nivo: "zeleno" | "zuto" | "crveno"; poruka: string; stavke: { nivo: string; tekst: string }[] };
  html: string;
  slanje: { podeseno: boolean; posiljalac: string | null };
  istorija: { vrsta: Vrsta; od: string; do: string; primaoci: string; created_at: string }[];
};

const NAZIV_VRSTE: Record<string, string> = Object.fromEntries(VRSTE.map((v) => [v.kod, v.naziv.toLowerCase()]));
const datum = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}.`;

export function StanjePoslovanja() {
  const [vrsta, setVrsta] = useState<Vrsta>("mjesec");
  const [dan, setDan] = useState<string | undefined>(undefined);
  const [iz, setIz] = useState<Izvjestaj | null>(null);
  const [ucitavam, setUcitavam] = useState(false);
  const [greska, setGreska] = useState("");
  const [poruka, setPoruka] = useState("");
  const [primaoci, setPrimaoci] = useState("");
  const [radim, setRadim] = useState<string | null>(null);
  const okvir = useRef<HTMLIFrameElement>(null);

  const ucitaj = async (v: Vrsta, d?: string) => {
    setUcitavam(true);
    setGreska("");
    try {
      const q = new URLSearchParams({ vrsta: v, ...(d ? { dan: d } : {}) });
      const r = await api<Izvjestaj>(`/stanje-poslovanja?${q}`);
      setIz(r);
      setPrimaoci((stari) => stari || r.primaoci || r.predlogPrimalaca || "");
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Izvještaj nije učitan.");
    } finally {
      setUcitavam(false);
    }
  };
  useEffect(() => {
    void ucitaj(vrsta, dan);
  }, [vrsta, dan]);

  // Pregled mejla u okviru: visina po sadržaju (isti dokument kao mejl, bez skripti).
  const prilagodiVisinu = () => {
    const tijelo = okvir.current?.contentDocument?.body;
    if (okvir.current && tijelo) okvir.current.style.height = `${tijelo.scrollHeight + 24}px`;
  };

  const sacuvajPrimaoce = async () => {
    setGreska("");
    setPoruka("");
    setRadim("primaoci");
    try {
      const r = await api<{ primaoci: string }>("/stanje-poslovanja/primaoci", { method: "PATCH", telo: { primaoci } });
      setPrimaoci(r.primaoci);
      setIz((x) => (x ? { ...x, primaoci: r.primaoci } : x));
      setPoruka("Primaoci su sačuvani.");
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Primaoci nisu sačuvani.");
    } finally {
      setRadim(null);
    }
  };

  const posalji = async () => {
    if (!iz) return;
    setGreska("");
    setPoruka("");
    // Ništa sivo bez objašnjenja (#74): klik kaže šta fali.
    if (!iz.slanje.podeseno) {
      setGreska("Slanje mejla sa servera nije podešeno (SMTP). Kliknite „Sačuvaj PDF“ i pošaljite ga kao prilog, ili podesite SMTP na Renderu.");
      return;
    }
    if (!iz.primaoci.trim()) {
      setGreska(primaoci.trim() ? "Prvo sačuvajte primaoce (dugme „Sačuvaj“)." : "Upišite mejl direktora i sačuvajte.");
      return;
    }
    if (primaoci.trim() !== iz.primaoci.trim()) {
      setGreska("Primaoci su izmijenjeni, a nisu sačuvani — kliknite „Sačuvaj“, pa pošaljite.");
      return;
    }
    setRadim("salji");
    try {
      const r = await api<{ poslato: string[]; period: string }>("/stanje-poslovanja/posalji", { telo: { vrsta, dan: iz.period.od } });
      setPoruka(`Poslato: ${r.period} → ${r.poslato.join(", ")}.`);
      await ucitaj(vrsta, iz.period.od);
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Mejl nije poslat.");
    } finally {
      setRadim(null);
    }
  };

  const preuzmi = async () => {
    if (!iz) return;
    setGreska("");
    setRadim("preuzmi");
    try {
      await preuzmiFajl(`/stanje-poslovanja/izvjestaj.html?vrsta=${vrsta}&dan=${iz.period.od}`, `stanje-poslovanja-${vrsta}-${iz.period.od}.html`);
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Preuzimanje nije uspjelo.");
    } finally {
      setRadim(null);
    }
  };

  // PDF pravi pregledač (kao inspekcijski paket): izvještaj se otvori u novom prozoru i odmah ponudi štampu —
  // kao štampač se izabere „Sačuvaj kao PDF“. Bez biblioteke na serveru; ime fajla je naslov izvještaja.
  const sacuvajPdf = () => {
    if (!iz) return;
    setGreska("");
    const prozor = window.open("", "_blank");
    if (!prozor) {
      setGreska("Pregledač je zaustavio novi prozor — dozvolite iskačuće prozore za ovu stranicu, pa kliknite ponovo.");
      return;
    }
    prozor.document.open();
    prozor.document.write(iz.html);
    prozor.document.close();
    prozor.focus();
    setTimeout(() => prozor.print(), 300);
  };

  const vecPoslat = iz?.istorija.find((h) => h.vrsta === vrsta && h.od === iz.period.od);

  return (
    <>
      <PageHeader
        title="Stanje poslovanja"
        description="Izvještaj za direktora: ključni pokazatelji i grafikoni za izabrani period, uz poređenje sa prethodnim. Pregledajte ga ovdje, pa pošaljite mejlom."
      />

      <div className="stanje-alati">
        <div className="filter-tabs" style={{ margin: 0, flexWrap: "wrap" }}>
          {VRSTE.map((v) => (
            <button key={v.kod} className={vrsta === v.kod ? "selected" : ""} onClick={() => { setVrsta(v.kod); setDan(undefined); }}>
              {v.naziv}
            </button>
          ))}
        </div>
        <div className="stanje-period">
          <button className="secondary-button" onClick={() => iz && setDan(iz.period.ranije)} disabled={!iz || ucitavam} aria-label="Prethodni period">
            <ChevronLeft size={16} />
          </button>
          <strong>{iz ? iz.period.naziv : "…"}</strong>
          <button className="secondary-button" onClick={() => iz?.period.kasnije && setDan(iz.period.kasnije)} disabled={!iz?.period.kasnije || ucitavam} aria-label="Sljedeći period">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="panel stanje-slanje">
        <label className="stanje-primaoci" htmlFor="stanje-primaoci">
          <span>Kome se šalje (mejl direktora; više adresa — zarezom)</span>
          <div>
            <input id="stanje-primaoci" type="text" inputMode="email" value={primaoci} onChange={(e) => setPrimaoci(e.target.value)} placeholder="direktor@firma.me" />
            <button className="secondary-button" onClick={sacuvajPrimaoce} disabled={radim === "primaoci"}>
              Sačuvaj
            </button>
          </div>
        </label>
        <div className="stanje-dugmad">
          <button className="primary-button" onClick={posalji} disabled={radim === "salji" || !iz}>
            <Send size={15} /> {radim === "salji" ? "Šaljem…" : "Pošalji direktoru"}
          </button>
          <button className="secondary-button" onClick={sacuvajPdf} disabled={!iz}>
            <FileText size={15} /> Sačuvaj PDF
          </button>
          <button className="secondary-button" onClick={preuzmi} disabled={radim === "preuzmi" || !iz}>
            <Download size={15} /> Preuzmi HTML
          </button>
          <span className="muted-text">
            {iz?.slanje.podeseno ? `Šalje se sa: ${iz.slanje.posiljalac}` : "Slanje sa servera nije podešeno — sačuvajte PDF i pošaljite ga kao prilog iz svoje pošte."}
            {" "}PDF: otvori se prozor za štampu — kao štampač izaberite „Sačuvaj kao PDF“.
            {vecPoslat ? ` · Ovaj izvještaj je već poslat ${new Date(vecPoslat.created_at).toLocaleDateString("sr-Latn-ME")}.` : ""}
          </span>
        </div>
        {greska && (
          <div className="auth-error" role="alert">
            <AlertCircle size={14} /> {greska}
          </div>
        )}
        {poruka && !greska && <div className="nc-info" role="status">{poruka}</div>}
      </div>

      {iz && (
        <div className="stanje-pregled">
          <iframe ref={okvir} title={`Izvještaj: ${iz.period.naziv}`} srcDoc={iz.html} sandbox="allow-same-origin" onLoad={prilagodiVisinu} className="stanje-okvir" />
        </div>
      )}

      {iz && iz.istorija.length > 0 && (
        <div className="panel full-panel" style={{ marginTop: 16 }}>
          <div style={{ padding: "14px 18px 4px" }}>
            <h2 style={{ fontSize: 14 }}>Poslati izvještaji</h2>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Poslato</th>
                  <th>Vrsta</th>
                  <th>Period</th>
                  <th>Kome</th>
                </tr>
              </thead>
              <tbody>
                {iz.istorija.map((h, i) => (
                  <tr key={i}>
                    <td>{new Date(h.created_at).toLocaleString("sr-Latn-ME", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                    <td>{NAZIV_VRSTE[h.vrsta] ?? h.vrsta}</td>
                    <td>{h.od === h.do ? datum(h.od) : `${datum(h.od)} – ${datum(h.do)}`}</td>
                    <td>{h.primaoci}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
