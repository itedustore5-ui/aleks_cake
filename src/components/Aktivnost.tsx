import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, ArrowDownToLine, PackageCheck, AlertTriangle, Thermometer, Truck, ClipboardList, PhoneCall, PackageX, CheckCircle2 } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { mozeNa } from "./Layout";

type Stavka = { vrijeme: string; vrsta: string; ko: string | null; opis: string; tezina: "info" | "upozorenje" | "problem"; putanja: string };

const IKONICA: Record<string, typeof Activity> = {
  prijem: ArrowDownToLine,
  odluka: CheckCircle2,
  isporuka: PackageCheck,
  neusaglasenost: AlertTriangle,
  temperatura: Thermometer,
  vozilo: Truck,
  zapis: ClipboardList,
  povlacenje: PhoneCall,
  otpis: PackageX,
};

const PROVJERA_MS = 30_000;

function kadaJe(iso: string) {
  const minuta = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minuta < 1) return "upravo";
  if (minuta < 60) return `prije ${minuta} min`;
  const d = new Date(iso);
  const danas = new Date().toDateString() === d.toDateString();
  return danas ? `danas ${d.toLocaleTimeString("sr-Latn-ME", { hour: "2-digit", minute: "2-digit" })}` : d.toLocaleString("sr-Latn-ME", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Šta se u firmi dešava — iz samih zapisa, osvježava se samo dok je ekran otvoren. */
export function AktivnostUzivo() {
  const { korisnik } = useAuth();
  const navigate = useNavigate();
  const [stavke, setStavke] = useState<Stavka[] | null>(null);
  const [samoProblemi, setSamoProblemi] = useState(false);
  const [osvjezeno, setOsvjezeno] = useState<Date | null>(null);

  useEffect(() => {
    const ucitaj = () =>
      api<Stavka[]>("/aktivnost")
        .then((s) => {
          setStavke(s);
          setOsvjezeno(new Date());
        })
        .catch(() => {});
    const kadJeVidljivo = () => {
      if (document.visibilityState === "visible") ucitaj();
    };
    ucitaj();
    const interval = window.setInterval(kadJeVidljivo, PROVJERA_MS);
    document.addEventListener("visibilitychange", kadJeVidljivo);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", kadJeVidljivo);
    };
  }, []);

  if (!korisnik) return null;
  const prikazano = (stavke ?? []).filter((s) => !samoProblemi || s.tezina !== "info");

  return (
    <div className="panel aktivnost-panel">
      <div className="panel-header">
        <h2>
          <Activity size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          Aktivnost uživo <span className="uzivo-tacka" title="Osvježava se na 30 sekundi" />
        </h2>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {osvjezeno && <small className="muted-text">osvježeno {osvjezeno.toLocaleTimeString("sr-Latn-ME", { hour: "2-digit", minute: "2-digit" })}</small>}
          <button className={`small-action${samoProblemi ? " selected" : ""}`} onClick={() => setSamoProblemi((v) => !v)}>
            {samoProblemi ? "Prikaži sve" : "Samo problemi"}
          </button>
        </div>
      </div>
      <div className="aktivnost-lista">
        {stavke !== null && prikazano.length === 0 && (
          <p className="muted-text" style={{ fontSize: 11, padding: "10px 0" }}>{samoProblemi ? "Nema problema u posljednjih 7 dana." : "U posljednjih 7 dana nije bilo unosa."}</p>
        )}
        {prikazano.map((s, i) => {
          const Ikonica = IKONICA[s.vrsta] ?? Activity;
          const moze = mozeNa(korisnik.uloga, s.putanja);
          return (
            <div
              key={`${s.vrijeme}-${i}`}
              className={`aktivnost-red ${s.tezina}${moze ? " klikabilno" : ""}`}
              onClick={moze ? () => navigate(s.putanja) : undefined}
              role={moze ? "button" : undefined}
              tabIndex={moze ? 0 : undefined}
            >
              <div className="aktivnost-ikonica"><Ikonica size={13} /></div>
              <div>
                <strong>{s.opis}</strong>
                <small>{s.ko ?? "sistem"} · {kadaJe(s.vrijeme)}</small>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
