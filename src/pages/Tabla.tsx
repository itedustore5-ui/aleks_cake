import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldAlert, AlertTriangle, Thermometer, Truck, PackageX, Clock3, BookOpen, ArrowDownToLine, PackageCheck, PhoneCall, ClipboardList, DatabaseBackup, ClipboardCheck, Gauge, CalendarX } from "lucide-react";
import { api, ApiGreska, preuzmiFajl } from "../lib/api";
import { lokalniDatum } from "../lib/vrijeme";
import { PageHeader, Modal } from "../components/Zajednicko";
import { StatusBadge } from "../components/StatusBadge";
import { ListaZadataka } from "../components/Zadaci";
import { AktivnostUzivo } from "../components/Aktivnost";
import { ProvjeraZnanjaUlaz } from "../components/ProvjeraZnanjaUlaz";
import { mozeNa } from "../components/Layout";
import { useAuth } from "../lib/auth";
import { DirektorPregled } from "./DirektorPregled";

type BekapMeta = { id: string; tip: string; broj_tabela: number; broj_redova: number; velicina_bajtova: number | string | null; created_at: string };

type Detalj = { naslov: string; prazno: string; kolone: { kljuc: string; naziv: string; vrsta?: "status" }[]; redovi: Record<string, string | null>[] };

type TablaPodaci = {
  kriticno: {
    neusaglasenostiVisoke: number;
    neusaglasenostiOtvorene: number;
    temperatureVanOpsega: number;
    vozilaNijeSpremno: number;
    lotoviNaHoldu: number;
    zadaciZakasnili: number;
    zadaciOtvoreni: number;
    knjizicIstice: number;
    povlacenjaUToku: number;
    monitoringFali: number;
    monitoringJuce: number;
    haccpRokovi: number;
    robaIstekao: number;
    robaUskoro: number;
  };
  operativno: { prijemiDanas: number; isporukeDanas: number; zapisiDanas: number };
};

/** Direktor (uprava) ima svoj, jednostavniji Kontrolni centar — DirektorPregled (11.10.2026). */
export function Tabla() {
  const { korisnik } = useAuth();
  return korisnik?.uloga === "uprava" ? <DirektorPregled /> : <TablaVodstva />;
}

function TablaVodstva() {
  const { korisnik } = useAuth();
  const [podaci, setPodaci] = useState<TablaPodaci | null>(null);
  const [bekap, setBekap] = useState<BekapMeta | null | undefined>(undefined);
  const [bekapUToku, setBekapUToku] = useState(false);
  const [bekapGreska, setBekapGreska] = useState("");
  const [detalj, setDetalj] = useState<Detalj | null>(null);
  const navigate = useNavigate();

  const mozeBekap = korisnik?.uloga === "bzr" || korisnik?.uloga === "izvodjac";
  // Uprava nadgleda: ne rješava zadatke i ne ulazi na operativne strane — vidi stanje i aktivnost.
  const jeUprava = korisnik?.uloga === "uprava";

  useEffect(() => {
    api<TablaPodaci>("/tabla").then(setPodaci);
    if (mozeBekap) api<BekapMeta | null>("/bekap/poslednji").then(setBekap);
  }, [mozeBekap]);

  const napraviBekap = async () => {
    setBekapUToku(true);
    setBekapGreska("");
    try {
      // Preuzima se direktno — kopija se više ne čuva u bazi (dopuna 35).
      await preuzmiFajl("/bekap/preuzmi", `bekap-cg-${lokalniDatum()}.json`);
      setBekap(await api<BekapMeta | null>("/bekap/poslednji"));
    } catch (e) {
      setBekapGreska(e instanceof ApiGreska ? e.message : "Bekap nije preuzet — provjerite internet i pokušajte ponovo.");
    } finally {
      setBekapUToku(false);
    }
  };

  if (!podaci) return null;
  const k = podaci.kriticno;

  const kriticneKartice = [
    { naslov: "Povlačenja u toku", vrijednost: k.povlacenjaUToku, ikonica: <PhoneCall size={18} />, putanja: "/sledljivost", tona: "danger" },
    { naslov: "Otvorene neusaglašenosti", vrijednost: k.neusaglasenostiOtvorene, ikonica: <AlertTriangle size={18} />, putanja: "/neusaglasenosti", detalj: "neusaglasenosti", tona: k.neusaglasenostiVisoke > 0 ? "danger" : "warning" },
    { naslov: "Temperature van opsega (24h)", vrijednost: k.temperatureVanOpsega, ikonica: <Thermometer size={18} />, putanja: "/haccp", detalj: "temperature", tona: k.temperatureVanOpsega > 0 ? "danger" : "warning" },
    { naslov: "Vozila nisu spremna", vrijednost: k.vozilaNijeSpremno, ikonica: <Truck size={18} />, putanja: "/vozila", detalj: "vozila", tona: k.vozilaNijeSpremno > 0 ? "danger" : "warning" },
    { naslov: "Lotovi na HOLD-u", vrijednost: k.lotoviNaHoldu, ikonica: <PackageX size={18} />, putanja: "/zalihe", stanje: { status: "HOLD" }, tona: k.lotoviNaHoldu > 0 ? "danger" : "warning" },
    // Rok robe (R-02): istekla roba se ne isporučuje, a stoji u zalihama dok je neko ne otpiše.
    { naslov: `Rok robe: isteklo ${k.robaIstekao} · ističe za 7 dana ${k.robaUskoro}`, vrijednost: k.robaIstekao + k.robaUskoro, ikonica: <CalendarX size={18} />, putanja: "/zalihe", stanje: { status: "PRIHVACEN", rok: k.robaIstekao > 0 ? "istekao" : "uskoro" }, detalj: "rok-robe", tona: k.robaIstekao > 0 ? "danger" : "warning" },
    { naslov: "Zakašnjeli zadaci", vrijednost: k.zadaciZakasnili, ikonica: <Clock3 size={18} />, putanja: "#zadaci", tona: k.zadaciZakasnili > 0 ? "danger" : "warning" },
    { naslov: "Knjižice ističu/istekle", vrijednost: k.knjizicIstice, ikonica: <BookOpen size={18} />, putanja: "/ljudi", detalj: "knjizice", tona: k.knjizicIstice > 0 ? "danger" : "warning" },
    // Plan monitoringa (faza 3): šta danas još nije urađeno; juče propušteno je već rupa u zapisima.
    { naslov: `Danas fali po planu${k.monitoringJuce ? ` · juče propušteno ${k.monitoringJuce}` : ""}`, vrijednost: k.monitoringFali, ikonica: <ClipboardCheck size={18} />, putanja: "/haccp-plan", stanje: { kartica: "plan" }, detalj: "monitoring", tona: k.monitoringJuce > 0 ? "danger" : "warning" },
    { naslov: "HACCP rokovi (termometri, revizija)", vrijednost: k.haccpRokovi, ikonica: <Gauge size={18} />, putanja: "/haccp-plan", stanje: { kartica: "termometri" }, detalj: "rokovi", tona: k.haccpRokovi > 0 ? "danger" : "warning" },
  ].filter((kartica) => !(jeUprava && kartica.putanja === "#zadaci"));
  // Ko smije na stranu — ide na nju. Uprava ne ulazi na operativne strane, pa dobija listu iza
  // broja, samo za čitanje (ranije je klik kod direktora radio ništa).
  const otvori = (putanja: string, kartica?: string, stanje?: unknown) => {
    if (putanja.startsWith("#")) document.getElementById(putanja.slice(1))?.scrollIntoView({ behavior: "smooth" });
    else if (korisnik && mozeNa(korisnik.uloga, putanja)) navigate(putanja, stanje ? { state: stanje } : undefined);
    else if (kartica) api<Detalj>(`/tabla/detalj/${kartica}`).then(setDetalj);
  };

  return (
    <>
      <PageHeader title="Kontrolni centar" description="Ovo nije forma za unos — ovo je pregled onoga što traži pažnju danas." />
      {/* Nalog koji vidi sve podatke firme, a nema potvrdu u dva koraka (#81) — podsjetnik dok je ne uključi. */}
      {korisnik && (korisnik.uloga === "izvodjac" || korisnik.uloga === "bzr") && korisnik.totp_ukljucen === false && (
        <button type="button" className="upozorenje-traka" style={{ width: "100%", border: 0, cursor: "pointer", textAlign: "left" }} onClick={() => navigate("/moja#dva-koraka")}>
          <ShieldAlert size={16} />
          <span>Uključite potvrdu u dva koraka — vaš nalog vidi sve podatke firme, a sada ga štiti samo lozinka. Moja strana → „Potvrda u dva koraka“ (2 minuta).</span>
        </button>
      )}
      <ProvjeraZnanjaUlaz />
      <div className="section-heading">
        <div>
          <h2>Kritično</h2>
          <span>Klik na karticu otvara konkretnu listu.</span>
        </div>
      </div>
      <div className="alert-grid">
        {kriticneKartice.map((kartica) => (
          <button key={kartica.naslov} className={`alert-card ${kartica.vrijednost > 0 ? kartica.tona : "neutral"}`} onClick={() => otvori(kartica.putanja, kartica.detalj, kartica.stanje)}>
            <div className="alert-card-icon">{kartica.ikonica}</div>
            <div className="alert-card-content">
              <b>{kartica.vrijednost}</b>
              <strong>{kartica.naslov}</strong>
            </div>
          </button>
        ))}
      </div>

      <div className="section-heading" style={{ marginTop: 26 }}>
        <div>
          <h2>Operativno danas</h2>
        </div>
      </div>
      <div className="stats-grid">
        <button className="stat-card" onClick={() => otvori("/prijem", "prijemi")} style={{ textAlign: "left" }}>
          <div className="stat-icon blue">
            <ArrowDownToLine size={18} />
          </div>
          <div className="stat-copy">
            <span>Prijemi danas</span>
            <strong>{podaci.operativno.prijemiDanas}</strong>
          </div>
        </button>
        <button className="stat-card" onClick={() => otvori("/isporuka", "isporuke")} style={{ textAlign: "left" }}>
          <div className="stat-icon green">
            <PackageCheck size={18} />
          </div>
          <div className="stat-copy">
            <span>Isporuke danas</span>
            <strong>{podaci.operativno.isporukeDanas}</strong>
          </div>
        </button>
        <button className="stat-card" onClick={() => otvori("/haccp", "zapisi")} style={{ textAlign: "left" }}>
          <div className="stat-icon orange">
            <ClipboardList size={18} />
          </div>
          <div className="stat-copy">
            <span>Dnevni zapisi sa terena danas</span>
            <strong>{podaci.operativno.zapisiDanas}</strong>
            <small>P3–P10, svi unosi svih uloga</small>
          </div>
        </button>
      </div>

      <div className="section-heading" style={{ marginTop: 26 }}>
        <div>
          <h2>Šta se dešava</h2>
          <span>Svaki prijem, isporuka, obrazac, kontrola i problem — ko je i kada. Temperatura van opsega, povlačenje i nespremno vozilo stižu i na zvonce.</span>
        </div>
      </div>
      <AktivnostUzivo />

      {detalj && (
        <Modal naslov={detalj.naslov} podnaslov="Pregled — samo za čitanje" onClose={() => setDetalj(null)}>
          {detalj.redovi.length === 0 ? (
            <p className="muted-text">{detalj.prazno}</p>
          ) : (
            <div className="data-table-wrap" style={{ maxHeight: "60vh", overflow: "auto" }}>
              <table className="data-table">
                <thead><tr>{detalj.kolone.map((kol) => <th key={kol.kljuc}>{kol.naziv}</th>)}</tr></thead>
                <tbody>
                  {detalj.redovi.map((red, i) => (
                    <tr key={i}>
                      {detalj.kolone.map((kol) => (
                        <td key={kol.kljuc}>{kol.vrsta === "status" && red[kol.kljuc] ? <StatusBadge status={red[kol.kljuc]!} /> : red[kol.kljuc] ?? "—"}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}

      {!jeUprava && (
      <>
      <div className="section-heading" id="zadaci" style={{ marginTop: 26 }}>
        <div>
          <h2>Otvoreni zadaci ({k.zadaciOtvoreni})</h2>
          <span>
            {mozeBekap
              ? "Nastaju sami iz neusaglašenosti, povlačenja i kontrole vozila. Dodijelite zadatak nekome — dobiće obavještenje. Zatvara se sam kad se zatvori ono iz čega je nastao."
              : "Nastaju sami iz neusaglašenosti, povlačenja i kontrole vozila."}
          </span>
        </div>
      </div>
      <ListaZadataka samoMoji={false} naslov="Svi otvoreni zadaci" />
      </>
      )}

      {mozeBekap && (
        <>
          <div className="section-heading" style={{ marginTop: 26 }}>
            <div>
              <h2>Bekap</h2>
              <span>Kopija vaših podataka za čuvanje van aplikacije — preuzima se na ovaj uređaj. Sačuvajte je na računaru firme; podsjetnik stiže kad prođe sedmica bez preuzimanja.</span>
            </div>
          </div>
          <div className="panel" style={{ minHeight: "auto" }}>
            <div style={{ padding: 20, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div className="stat-icon blue">
                <DatabaseBackup size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                {bekap === undefined ? (
                  <span className="muted-text">Učitavanje...</span>
                ) : bekap === null ? (
                  <span className="muted-text">Bekap još nije preuzet.</span>
                ) : (
                  <>
                    <strong style={{ display: "block", fontSize: 12 }}>
                      Posljednji: {new Date(bekap.created_at).toLocaleString("sr-Latn-ME")} ({bekap.tip === "RUCNI" ? "preuzet" : "napravljen automatski"})
                    </strong>
                    <small className="muted-text">
                      {bekap.broj_tabela} tabela · {bekap.broj_redova} redova
                      {bekap.velicina_bajtova ? ` · ${(Number(bekap.velicina_bajtova) / 1048576).toLocaleString("sr-Latn-ME", { maximumFractionDigits: 1 })} MB` : ""}
                    </small>
                  </>
                )}
                {bekapGreska && <div className="auth-error" style={{ marginTop: 8 }}>{bekapGreska}</div>}
              </div>
              <button className="primary-button" onClick={napraviBekap} disabled={bekapUToku}>
                {bekapUToku ? "Preuzimam…" : "Preuzmi bekap sada"}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
