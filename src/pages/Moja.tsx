import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, BookOpen, CheckCircle2, ArrowDownToLine, Cake, ChevronRight, AlertTriangle } from "lucide-react";
import { api, ApiGreska } from "../lib/api";
import { PageHeader } from "../components/Zajednicko";
import { StatusBadge } from "../components/StatusBadge";
import { useAuth, NAZIV_ULOGE } from "../lib/auth";
import { ListaZadataka, ListaObavjestenja } from "../components/Zadaci";
import { lokalniDatum } from "../lib/vrijeme";
import { ProvjeraZnanjaUlaz } from "../components/ProvjeraZnanjaUlaz";
import { PushObavjestenja } from "../components/PushObavjestenja";
import { DvaKoraka } from "../components/DvaKoraka";

type Lice = { id: string; ime: string; sifra: string; sanitarna_knjizica_rok: string | null; knjizica_status: string | null; rukuje_hranom: boolean };

export function Moja() {
  const { korisnik } = useAuth();
  const navigate = useNavigate();
  const [lice, setLice] = useState<Lice | null>(null);
  const [brojPrijema, setBrojPrijema] = useState<number | null>(null);
  const [torteDanas, setTorteDanas] = useState<{ ukupno: number; zaIzradu: number } | null>(null);

  useEffect(() => {
    if (korisnik?.lice_id) {
      api<Lice | null>("/lica/ja").then(setLice);
    }
    if (korisnik?.uloga === "operater") {
      api<unknown[]>("/prijem").then((r) => setBrojPrijema(r.length));
      // Torte za danas — preuzimanje danas, još nisu predate (P5: zaposleni vidi sve porudžbine ateljea).
      api<{ dan: string; status: string }[]>("/porudzbine").then((r) => {
        const danas = r.filter((p) => p.dan === lokalniDatum() && p.status !== "OTKAZANA");
        setTorteDanas({ ukupno: danas.length, zaIzradu: danas.filter((p) => p.status === "PRIMLJENA" || p.status === "U_IZRADI").length });
      }).catch(() => undefined);
    }
  }, [korisnik?.lice_id, korisnik?.uloga]);

  const terenskaUloga = korisnik?.uloga === "operater";
  const knjizicaTrazi = terenskaUloga && lice && lice.rukuje_hranom && (lice.knjizica_status === "ISTEKLA" || lice.knjizica_status === "USKORO");

  return (
    <>
      <PageHeader title="Moja strana" description={korisnik ? `${korisnik.lice_ime ?? korisnik.korisnicko_ime} · ${NAZIV_ULOGE[korisnik.uloga]}` : ""} />

      {knjizicaTrazi && (
        <div className="upozorenje-traka">
          <AlertTriangle size={16} />
          <span>
            Sanitarna knjižica {lice!.knjizica_status === "ISTEKLA" ? "je istekla" : "uskoro ističe"}
            {lice!.sanitarna_knjizica_rok ? ` (${new Date(lice!.sanitarna_knjizica_rok).toLocaleDateString("sr-Latn-ME")})` : ""} — javite se odgovornom licu za ljekarski pregled.
          </span>
        </div>
      )}

      <ProvjeraZnanjaUlaz />

      {terenskaUloga && <DanasPoPlanu />}

      {korisnik?.uloga === "operater" && (
        <>
          <div className="section-heading">
            <div><h2>Moj rad</h2></div>
          </div>
          <div className="stats-grid" style={{ marginBottom: 24 }}>
            <button className="stat-card" style={{ textAlign: "left" }} onClick={() => navigate("/porudzbine")}>
              <div className="stat-icon green"><Cake size={18} /></div>
              <div className="stat-copy">
                <span>Torte danas</span>
                <strong>{torteDanas ? torteDanas.ukupno : "…"}</strong>
                <small>{torteDanas && torteDanas.zaIzradu > 0 ? `još za predaju: ${torteDanas.zaIzradu}` : "Otvori porudžbine"}</small>
              </div>
            </button>
            <button className="stat-card" style={{ textAlign: "left" }} onClick={() => navigate("/prijem")}>
              <div className="stat-icon blue"><ArrowDownToLine size={18} /></div>
              <div className="stat-copy">
                <span>Prijemi (posljednji dan)</span>
                <strong>{brojPrijema ?? "…"}</strong>
                <small>Otvori prijem robe</small>
              </div>
            </button>
            <button className="stat-card" style={{ textAlign: "left" }} onClick={() => navigate("/haccp")}>
              <div className="stat-icon orange"><CheckCircle2 size={18} /></div>
              <div className="stat-copy">
                <span>Dnevni obrasci</span>
                <strong>P3–P10</strong>
                <small>Čišćenje, štetočine, higijena, otpad, oprema</small>
              </div>
            </button>
          </div>
        </>
      )}

      <div className="section-heading">
        <div><h2>Zadaci i obavještenja</h2></div>
      </div>
      <div className="dashboard-columns">
        <ListaZadataka samoMoji />
        <ListaObavjestenja />
      </div>

      <div className="section-heading" style={{ marginTop: 26 }}>
        <div><h2>Moji podaci</h2></div>
      </div>
      <div className="dashboard-columns">
        {/* Knjižica se tiče samo onih koji rukuju hranom (Zakon o zaštiti stanovništva od zaraznih
            bolesti, čl. 31). Šifra se zaposlenom ne pokazuje: potpis je ime, a provjera znanja ide
            preko naloga i lozinke (invarijante #17, #23, #32). */}
        {lice && lice.rukuje_hranom && lice.knjizica_status && (
          <div className="panel" style={{ minHeight: "auto" }}>
            <div className="panel-header"><h2>Sanitarna knjižica</h2></div>
            <div style={{ padding: "0 20px 20px" }}>
              <span className="meta-label">Važi do</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <StatusBadge status={lice.knjizica_status} />
                <small className="muted-text">{lice.sanitarna_knjizica_rok ?? ""}</small>
              </div>
            </div>
          </div>
        )}
        <PromjenaLozinke />
        <DvaKoraka />
        <PushObavjestenja />
      </div>
    </>
  );
}

function PromjenaLozinke() {
  const [stara, setStara] = useState("");
  const [nova, setNova] = useState("");
  const [poruka, setPoruka] = useState("");
  const [greska, setGreska] = useState("");

  const posalji = async (e: FormEvent) => {
    e.preventDefault();
    setGreska("");
    setPoruka("");
    try {
      await api("/auth/promijeni-lozinku", { telo: { staraLozinka: stara, novaLozinka: nova } });
      setPoruka("Lozinka je promijenjena.");
      setStara("");
      setNova("");
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Lozinka nije promijenjena.");
    }
  };

  return (
    <div className="panel" style={{ minHeight: "auto" }}>
      <div className="panel-header">
        <h2><KeyRound size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />Promjena lozinke</h2>
      </div>
      <form className="form-grid" style={{ gridTemplateColumns: "1fr", padding: "0 20px 20px" }} onSubmit={posalji}>
        {poruka && <div className="auth-security-note"><BookOpen size={13} />{poruka}</div>}
        {greska && <div className="auth-error">{greska}</div>}
        <label>Trenutna lozinka<input type="password" value={stara} onChange={(e) => setStara(e.target.value)} /></label>
        <label>Nova lozinka (najmanje 10 znakova)<input type="password" value={nova} onChange={(e) => setNova(e.target.value)} /></label>
        <button className="primary-button" type="submit" disabled={nova.length < 10}>Sačuvaj lozinku</button>
      </form>
    </div>
  );
}

type StavkaDanas = {
  id: string;
  naziv: string;
  vrsta: "mjerenje" | "obrazac";
  kontrolna_tacka_id: string | null;
  obrazac_kod: string | null;
  puta: number;
  uradjeno: number;
  fali: number;
  rok: string;
  skladiste_id?: string | null;
  skladiste_naziv?: string | null;
  /** Ko je u ovom periodu već uradio (posljednja tri) — obaveza je magacina, ne osobe (#77). */
  uradili?: { ime: string; vrijeme: string; dan: string }[];
};

/** Koliko često se „Danas po planu“ osvježava sam — da drugi magacioner odmah vidi urađeno. */
const OSVJEZI_PLAN_MS = 45_000;

/** Plan monitoringa za ovog čovjeka (po ulozi i magacinu): šta danas treba, šta je urađeno, i šta
 * je juče ostalo neurađeno. Dugme vodi pravo na obrazac ili mjerenje. */
function DanasPoPlanu() {
  const navigate = useNavigate();
  const [stanje, setStanje] = useState<{ stavke: StavkaDanas[]; juce: StavkaDanas[] } | null>(null);
  // Osvježava se sam i kad se magacioner vrati u aplikaciju: ako je kolega upravo izmjerio komoru,
  // stavka treba odmah da bude „urađeno“, a ne da ga šalje da mjeri ponovo.
  useEffect(() => {
    const ucitaj = () => api<{ stavke: StavkaDanas[]; juce: StavkaDanas[] }>("/monitoring/danas").then(setStanje).catch(() => undefined);
    const kadJeVidljivo = () => {
      if (document.visibilityState === "visible") ucitaj();
    };
    ucitaj();
    const interval = window.setInterval(kadJeVidljivo, OSVJEZI_PLAN_MS);
    document.addEventListener("visibilitychange", kadJeVidljivo);
    window.addEventListener("focus", kadJeVidljivo);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", kadJeVidljivo);
      window.removeEventListener("focus", kadJeVidljivo);
    };
  }, []);
  if (!stanje || (stanje.stavke.length === 0 && stanje.juce.length === 0)) return null;
  const upisi = (s: StavkaDanas) =>
    s.vrsta === "obrazac"
      ? navigate("/haccp", { state: { obrazac: s.obrazac_kod, skladiste: s.skladiste_id } })
      : navigate("/haccp", { state: { mjerenje: s.kontrolna_tacka_id, skladiste: s.skladiste_id } });
  const fali = stanje.stavke.filter((s) => s.fali > 0).length;
  return (
    <>
      <div className="section-heading">
        <div>
          <h2>Danas po planu</h2>
          <span>{fali === 0 ? "Sve iz plana za danas je urađeno." : `Još ${fali === 1 ? "1 stavka" : `${fali} stavke`} — upišite čim uradite, ne na kraju dana.`}</span>
        </div>
      </div>
      {stanje.juce.length > 0 && (
        <div className="upozorenje-traka">
          <AlertTriangle size={16} />
          <span>Juče nije urađeno: {stanje.juce.map((s) => `${s.naziv} (${s.uradjeno}/${s.puta})`).join(", ")}. Javite odgovornom licu.</span>
        </div>
      )}
      <div className="panel" style={{ minHeight: "auto", marginBottom: 24 }}>
        {stanje.stavke.map((s) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: "1px solid #edf1f3" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13 }}>{s.naziv}</div>
              <small className="muted-text">
                {s.uradjeno} od {s.puta} · {s.rok}
                {s.skladiste_naziv ? ` · ${s.skladiste_naziv}` : ""}
              </small>
              {s.uradili && s.uradili.length > 0 && (
                <div style={{ fontSize: 11, color: "#1e7f55", marginTop: 2 }}>
                  <CheckCircle2 size={11} style={{ verticalAlign: "-1px" }} /> uradio/la:{" "}
                  {s.uradili.map((u) => `${u.ime} ${s.rok === "danas" ? u.vrijeme : `${u.dan} ${u.vrijeme}`}`).join(", ")}
                </div>
              )}
            </div>
            {s.fali === 0 ? (
              <StatusBadge status="VAZI" tekst="urađeno" />
            ) : (
              <button className="primary-button" onClick={() => upisi(s)}>Upiši <ChevronRight size={14} /></button>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
