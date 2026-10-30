import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Thermometer, PackageX, Clock3, BookOpen, ArrowDownToLine, Cake, CakeSlice, PhoneCall, ClipboardList, DatabaseBackup, ClipboardCheck, Gauge, CalendarX } from "lucide-react";
import { api, ApiGreska, preuzmiFajl } from "../lib/api";
import { lokalniDatum } from "../lib/vrijeme";
import { PageHeader, Modal } from "../components/Zajednicko";
import { StatusBadge } from "../components/StatusBadge";
import { ListaZadataka } from "../components/Zadaci";
import { AktivnostUzivo } from "../components/Aktivnost";
import { ProvjeraZnanjaUlaz } from "../components/ProvjeraZnanjaUlaz";
import { PrviKoraci } from "../components/PrviKoraci";
import { mozeNa } from "../components/Layout";
import { useAuth } from "../lib/auth";

type BekapMeta = { id: string; tip: string; broj_tabela: number; broj_redova: number; velicina_bajtova: number | string | null; created_at: string };

type Detalj = { naslov: string; prazno: string; kolone: { kljuc: string; naziv: string; vrsta?: "status" }[]; redovi: Record<string, string | null>[] };

type TablaPodaci = {
  kriticno: {
    neusaglasenostiVisoke: number;
    neusaglasenostiOtvorene: number;
    temperatureVanOpsega: number;
    porudzbineBezAlergena: number;
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
    vitrinaSkloniti: number;
  };
  operativno: { prijemiDanas: number; porudzbineDanas: number; zapisiDanas: number; vitrinaDanas: { napravljeno: number; prodato: number; otpisano: number } };
};

/** Kontrolni centar vlasnice i konsultanta (direktorov pregled je uklonjen — PLAN.md 8.3). */
export function Tabla() {
  const { korisnik } = useAuth();
  const [podaci, setPodaci] = useState<TablaPodaci | null>(null);
  const [bekap, setBekap] = useState<BekapMeta | null | undefined>(undefined);
  const [bekapUToku, setBekapUToku] = useState(false);
  const [bekapGreska, setBekapGreska] = useState("");
  const [detalj, setDetalj] = useState<Detalj | null>(null);
  const navigate = useNavigate();

  const mozeBekap = korisnik?.uloga === "bzr" || korisnik?.uloga === "izvodjac";

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
    // P1: torta za danas ili sutra kojoj alergeni još nisu potvrđeni — ne smije se otkriti tek na vratima.
    { naslov: "Torte (danas, sutra) bez potvrđenih alergena", vrijednost: k.porudzbineBezAlergena, ikonica: <Cake size={18} />, putanja: "/porudzbine", detalj: "porudzbine-alergeni", tona: k.porudzbineBezAlergena > 0 ? "danger" : "warning" },
    // Vitrina (dopuna 42): kolač kome je istekao rok ili mu je sastojak zadržan, a još je u vitrini — skloniti i otpisati.
    { naslov: "Vitrina: skloniti (istekao rok, zadržan sastojak)", vrijednost: k.vitrinaSkloniti, ikonica: <CakeSlice size={18} />, putanja: "/vitrina", detalj: "vitrina", tona: k.vitrinaSkloniti > 0 ? "danger" : "warning" },
    { naslov: "Lotovi na HOLD-u", vrijednost: k.lotoviNaHoldu, ikonica: <PackageX size={18} />, putanja: "/zalihe", stanje: { status: "HOLD" }, tona: k.lotoviNaHoldu > 0 ? "danger" : "warning" },
    // Rok sastojka (R-02): istekao ne ide u tortu, a stoji u zalihama dok ga neko ne otpiše.
    { naslov: `Rok sastojaka: isteklo ${k.robaIstekao} · ističe za 7 dana ${k.robaUskoro}`, vrijednost: k.robaIstekao + k.robaUskoro, ikonica: <CalendarX size={18} />, putanja: "/zalihe", stanje: { status: "PRIHVACEN", rok: k.robaIstekao > 0 ? "istekao" : "uskoro" }, detalj: "rok-robe", tona: k.robaIstekao > 0 ? "danger" : "warning" },
    { naslov: "Zakašnjeli zadaci", vrijednost: k.zadaciZakasnili, ikonica: <Clock3 size={18} />, putanja: "#zadaci", tona: k.zadaciZakasnili > 0 ? "danger" : "warning" },
    { naslov: "Knjižice ističu/istekle", vrijednost: k.knjizicIstice, ikonica: <BookOpen size={18} />, putanja: "/ljudi", detalj: "knjizice", tona: k.knjizicIstice > 0 ? "danger" : "warning" },
    // Plan monitoringa (faza 3): šta danas još nije urađeno; juče propušteno je već rupa u zapisima.
    { naslov: `Danas fali po planu${k.monitoringJuce ? ` · juče propušteno ${k.monitoringJuce}` : ""}`, vrijednost: k.monitoringFali, ikonica: <ClipboardCheck size={18} />, putanja: "/haccp-plan", stanje: { kartica: "plan" }, detalj: "monitoring", tona: k.monitoringJuce > 0 ? "danger" : "warning" },
    { naslov: "HACCP rokovi (termometri, revizija)", vrijednost: k.haccpRokovi, ikonica: <Gauge size={18} />, putanja: "/haccp-plan", stanje: { kartica: "termometri" }, detalj: "rokovi", tona: k.haccpRokovi > 0 ? "danger" : "warning" },
  ];
  // Ko smije na stranu — ide na nju; inače dobija listu iza broja, samo za čitanje.
  const otvori = (putanja: string, kartica?: string, stanje?: unknown) => {
    if (putanja.startsWith("#")) document.getElementById(putanja.slice(1))?.scrollIntoView({ behavior: "smooth" });
    else if (korisnik && mozeNa(korisnik.uloga, putanja)) navigate(putanja, stanje ? { state: stanje } : undefined);
    else if (kartica) api<Detalj>(`/tabla/detalj/${kartica}`).then(setDetalj);
  };

  return (
    <>
      <PageHeader title="Kontrolni centar" description="Ovo nije forma za unos — ovo je pregled onoga što traži pažnju danas." />
      {/* Podsjetnik „Uključite potvrdu u dva koraka“ je uklonjen (29.10.2026, odluka vlasnice — vlasnici ateljea smeta na
          prvoj strani). Potvrda u dva koraka ostaje na Mojoj strani, za koga je hoće (#81); ko je nema, javlja dnevni-pregled. */}
      {/* Vlasnica sama podešava atelje (29.10.2026); konsultant vidi isto da je vodi. */}
      {mozeBekap && <PrviKoraci />}
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
        <button className="stat-card" onClick={() => otvori("/porudzbine", "porudzbine")} style={{ textAlign: "left" }}>
          <div className="stat-icon green">
            <Cake size={18} />
          </div>
          <div className="stat-copy">
            <span>Torte danas</span>
            <strong>{podaci.operativno.porudzbineDanas}</strong>
          </div>
        </button>
        <button className="stat-card" onClick={() => otvori("/vitrina")} style={{ textAlign: "left" }}>
          <div className="stat-icon violet">
            <CakeSlice size={18} />
          </div>
          <div className="stat-copy">
            <span>Vitrina danas — prodato</span>
            <strong>{podaci.operativno.vitrinaDanas.prodato}</strong>
            <small>napravljeno {podaci.operativno.vitrinaDanas.napravljeno} · otpis {podaci.operativno.vitrinaDanas.otpisano}</small>
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
          <span>Svaki prijem, porudžbina, predata torta, obrazac i problem — ko je i kada. Temperatura van opsega i povlačenje stižu i na zvonce.</span>
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

      <div className="section-heading" id="zadaci" style={{ marginTop: 26 }}>
        <div>
          <h2>Otvoreni zadaci ({k.zadaciOtvoreni})</h2>
          <span>Nastaju sami iz neusaglašenosti i povlačenja. Dodijelite zadatak nekome — dobiće obavještenje. Zatvara se sam kad se zatvori ono iz čega je nastao.</span>
        </div>
      </div>
      <ListaZadataka samoMoji={false} naslov="Svi otvoreni zadaci" />

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
