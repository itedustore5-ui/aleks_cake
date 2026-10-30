import { useEffect, useMemo, useState } from "react";
import { Plus, AlertTriangle, X, Undo2, ChevronRight } from "lucide-react";
import { api, ApiGreska } from "../lib/api";
import { useSlanje, noviKljuc } from "../lib/slanje";
import { lokalniDatum } from "../lib/vrijeme";
import { useAuth } from "../lib/auth";
import { PageHeader, Modal, ZakonskaOznaka } from "../components/Zajednicko";
import { AlergeniOznaka } from "../components/Alergeni";

// Vitrina (dopuna 42): kolači za prodaju iz vitrine, kupci bez imena — sledljivost ide do serije kolača i dana prodaje.
// Jedan ekran za telefon: gore šta je sada u vitrini, sa velikim dugmićima („Prodat 1“ jednim dodirom tokom dana,
// „Upiši više“ uveče, „Otpis“), dugme „Napravljeno“ i istorija po danima. Server sve provjerava sam (rok, zadržan
// sastojak, koliko je ostalo) — ekran unaprijed kaže šta ne može i šta fali (#74).

type SastojakKolaca = { lot_id: string; broj_lota: string; lot_status: string; artikal: string; alergeni: string[]; alergeni_upisani: boolean; rok: string | null };
type Kolac = {
  id: string;
  broj: string;
  naziv: string;
  datum: string;
  rok: string;
  komada: number;
  napomena: string | null;
  prodato: number;
  otpisano: number;
  ostalo: number;
  danas_prodato: number;
  danas_otpisano: number;
  istekao: boolean;
  rok_danas: boolean;
  ponisti_id: string | null;
  ponisti_prodato: number | null;
  ponisti_otpisano: number | null;
  rasprodato: boolean;
  sastojci: SastojakKolaca[];
  alergeni: string[];
  bezAlergena: string[];
  zadrzani: string[];
};
type Naziv = { naziv: string; rok_dana: number; artikli: string[] };
type Zbir = { napravljeno: number; prodato: number; otpisano: number };
type Stanje = { zbirDanas: Zbir; serije: Kolac[]; nazivi: Naziv[] };
type Ponuda = { lot_id: string; broj_lota: string; rok: string | null; artikal: string; alergeni: string[]; alergeni_upisani: boolean; dobavljac: string };
type Upis = { id: string; datum: string; prodato: number; otpisano: number; razlog_otpisa: string | null; uneo: string; upisano: string; mozePonistiti: boolean; trebaRazlog: boolean };
type DetaljKolaca = {
  id: string;
  broj: string;
  naziv: string;
  datum: string;
  rok: string;
  komada: number;
  napomena: string | null;
  izvrsilac: string;
  uneo: string;
  istekao: boolean;
  prodato: number;
  otpisano: number;
  ostalo: number;
  promet: Upis[];
  sastojci: SastojakKolaca[];
  alergeni: string[];
  bezAlergena: string[];
  zadrzani: string[];
};
type DanIstorije = {
  dan: string;
  napravljeno: { id: string; broj: string; naziv: string; komada: number }[];
  promet: { id: string; broj: string; naziv: string; prodato: number; otpisano: number; razlozi: string | null }[];
  ukupno: Zbir;
};
type Istorija = { od: string; do: string; dani: DanIstorije[]; ukupno: Zbir };
type Poruka = { id: string; tekst: string; greska?: boolean };

/** Dan ± n dana (YYYY-MM-DD) — računa se u UTC podne, pa promjena vremena ne pomjera dan (#11). */
const pomjeriDan = (dan: string, dana: number) => new Date(Date.parse(`${dan}T12:00:00Z`) + dana * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "UTC" });
const kratko = (dan: string) => `${dan.slice(8, 10)}.${dan.slice(5, 7)}.`;
const puno = (dan: string) => `${dan.slice(8, 10)}.${dan.slice(5, 7)}.${dan.slice(0, 4)}.`;
const prikazDana = (dan: string) => {
  const danas = lokalniDatum();
  if (dan === danas) return "danas";
  if (dan === pomjeriDan(danas, -1)) return "juče";
  if (dan === pomjeriDan(danas, 1)) return "sutra";
  return kratko(dan);
};
const danUSedmici = (dan: string) => new Date(`${dan}T12:00:00Z`).toLocaleDateString("sr-Latn-ME", { weekday: "long", timeZone: "UTC" });
const prikazRoka = (rok: string | null) => (rok ? puno(rok) : "bez roka");
const greskaTekst = (e: unknown, opsta: string) => (e instanceof ApiGreska ? e.message : opsta);
const RAZLOZI_OTPISA = ["Istekao rok", "Oštećen", "Sastojak zadržan", "Kvalitet — nije za prodaju"];

export function Vitrina() {
  const { korisnik } = useAuth();
  const vodstvo = korisnik?.uloga === "bzr" || korisnik?.uloga === "izvodjac";
  const [stanje, setStanje] = useState<Stanje | null>(null);
  const [greskaUcitavanja, setGreskaUcitavanja] = useState("");
  const [novi, setNovi] = useState(false);
  const [promet, setPromet] = useState<{ vrsta: "prodaja" | "otpis"; kolac: Kolac } | null>(null);
  const [detalj, setDetalj] = useState<string | null>(null);
  const [poruka, setPoruka] = useState<Poruka | null>(null);
  const [osvjezenje, setOsvjezenje] = useState(0);
  const { radim, salji } = useSlanje();

  const ucitaj = () =>
    api<Stanje>("/vitrina")
      .then((s) => {
        setStanje(s);
        setGreskaUcitavanja("");
      })
      .catch((e) => setGreskaUcitavanja(greskaTekst(e, "Vitrina se nije učitala — provjerite internet.")));

  useEffect(() => {
    void ucitaj();
    // Za vitrinom može stajati više ljudi sa svojim telefonima — stanje se osvježava samo.
    const tajmer = window.setInterval(() => void ucitaj(), 45_000);
    const vidljivo = () => {
      if (document.visibilityState === "visible") void ucitaj();
    };
    document.addEventListener("visibilitychange", vidljivo);
    return () => {
      window.clearInterval(tajmer);
      document.removeEventListener("visibilitychange", vidljivo);
    };
  }, []);

  // Potvrda uz karticu nestaje sama; greška ostaje dok se ne uradi nešto drugo.
  useEffect(() => {
    if (!poruka || poruka.greska) return;
    const t = window.setTimeout(() => setPoruka(null), 6000);
    return () => window.clearTimeout(t);
  }, [poruka]);

  const posleUpisa = async (id: string, tekst: string) => {
    setPoruka({ id, tekst });
    await ucitaj();
    setOsvjezenje((n) => n + 1);
  };

  const prodaj1 = (k: Kolac) =>
    salji(async () => {
      try {
        const r = await api<{ ostalo: number }>(`/vitrina/${k.id}/promet`, { telo: { prodato: 1, otpisano: 0 } });
        await posleUpisa(k.id, r.ostalo > 0 ? `Prodat 1 — u vitrini još ${r.ostalo}.` : "Prodat posljednji — rasprodato.");
      } catch (e) {
        setPoruka({ id: k.id, tekst: greskaTekst(e, "Nije upisano — pokušajte ponovo."), greska: true });
        void ucitaj();
      }
    });

  const ponisti = (k: Kolac) =>
    salji(async () => {
      if (!k.ponisti_id) return;
      try {
        await api(`/vitrina/promet/${k.ponisti_id}/ponisti`, { telo: {} });
        await posleUpisa(k.id, "Poništeno.");
      } catch (e) {
        setPoruka({ id: k.id, tekst: greskaTekst(e, "Nije poništeno."), greska: true });
      }
    });

  const serije = stanje?.serije ?? [];
  const zbir = stanje?.zbirDanas;

  return (
    <>
      <PageHeader
        eyebrow="Atelje"
        title="Vitrina"
        description={<>Kolači za prodaju iz vitrine: šta je napravljeno, od kojih serija sastojaka i šta je prodato — po danu <ZakonskaOznaka clan="27" />.</>}
        action={
          <button className="primary-button" onClick={() => setNovi(true)}>
            <Plus size={16} /> Napravljeno
          </button>
        }
      />

      {greskaUcitavanja && <div className="auth-error" role="alert" style={{ marginBottom: 12 }}>{greskaUcitavanja}</div>}
      {zbir && (
        <div className="vitrina-zbir">
          <span className="vitrina-zbir-naslov">Danas</span>
          <span>napravljeno <b>{zbir.napravljeno}</b></span>
          <span>prodato <b>{zbir.prodato}</b></span>
          <span>otpis <b>{zbir.otpisano}</b></span>
        </div>
      )}

      <h2 className="vitrina-naslov">U vitrini sada</h2>
      {stanje && serije.length === 0 && (
        <div className="panel" style={{ padding: 16 }}>
          <span className="muted-text">U vitrini nema upisanih kolača. Kad napravite kolače, dodirnite „Napravljeno“ i upišite koliko komada i od kojih sastojaka.</span>
        </div>
      )}
      <div className="vitrina-lista">
        {serije.map((k) => (
          <KarticaKolaca
            key={k.id}
            k={k}
            poruka={poruka?.id === k.id ? poruka : null}
            radim={radim}
            onProdat={() => void prodaj1(k)}
            onVise={() => setPromet({ vrsta: "prodaja", kolac: k })}
            onOtpis={() => setPromet({ vrsta: "otpis", kolac: k })}
            onDetalj={() => setDetalj(k.id)}
            onPonisti={() => void ponisti(k)}
          />
        ))}
      </div>

      <IstorijaVitrine vodstvo={vodstvo} osvjezenje={osvjezenje} />

      {novi && (
        <NapravljenoForma
          nazivi={stanje?.nazivi ?? []}
          vodstvo={vodstvo}
          onClose={() => setNovi(false)}
          onSacuvano={(id, tekst) => {
            setNovi(false);
            void posleUpisa(id, tekst);
          }}
        />
      )}
      {promet && (
        <PrometForma
          vrsta={promet.vrsta}
          k={promet.kolac}
          vodstvo={vodstvo}
          onClose={() => setPromet(null)}
          onSacuvano={(tekst) => {
            const id = promet.kolac.id;
            setPromet(null);
            void posleUpisa(id, tekst);
          }}
        />
      )}
      {detalj && (
        <DetaljKolacaModal
          id={detalj}
          onClose={() => setDetalj(null)}
          onPromjena={() => {
            void ucitaj();
            setOsvjezenje((n) => n + 1);
          }}
        />
      )}
    </>
  );
}

function KarticaKolaca({ k, poruka, radim, onProdat, onVise, onOtpis, onDetalj, onPonisti }: {
  k: Kolac;
  poruka: Poruka | null;
  radim: boolean;
  onProdat: () => void;
  onVise: () => void;
  onOtpis: () => void;
  onDetalj: () => void;
  onPonisti: () => void;
}) {
  const zadrzan = k.zadrzani.length > 0;
  const stop = k.istekao || zadrzan;
  const klasa = k.rasprodato ? " rasprodato" : stop ? " stop" : k.rok_danas ? " rok-danas" : "";
  const posljednji = k.ponisti_otpisano ? `otpis ${k.ponisti_otpisano}` : `prodat ${k.ponisti_prodato ?? 1}`;
  return (
    <div className={`vitrina-kartica${klasa}`}>
      <div className="vitrina-vrh">
        <div style={{ minWidth: 0 }}>
          <div className="vitrina-ime">{k.naziv}</div>
          <div className="vitrina-meta">
            napravljeno {prikazDana(k.datum)} · rok{" "}
            {k.istekao ? <b className="vitrina-crveno">istekao {kratko(k.rok)}</b> : k.rok_danas ? <b className="vitrina-narandzasto">danas</b> : prikazDana(k.rok)}
          </div>
        </div>
        <div className="vitrina-broj">
          <strong>{Math.max(k.ostalo, 0)}</strong>
          <span>od {k.komada} u vitrini</span>
        </div>
      </div>
      {!k.rasprodato && zadrzan && (
        <div className="vitrina-stop"><AlertTriangle size={13} /> Ne prodaje se — zadržan sastojak: {k.zadrzani.join(", ")}. Sklonite iz vitrine i upišite otpis.</div>
      )}
      {!k.rasprodato && !zadrzan && k.istekao && (
        <div className="vitrina-stop"><AlertTriangle size={13} /> Rok je istekao — ne prodaje se. Sklonite iz vitrine i upišite otpis.</div>
      )}
      <div className="vitrina-oznake">
        {k.sastojci.length === 0 ? <span className="alergeni-nisu">sastojci nisu upisani</span> : <AlergeniOznaka sifre={k.alergeni} />}
        {k.bezAlergena.length > 0 && <span className="alergeni-nisu">alergeni nisu upisani za: {k.bezAlergena.join(", ")}</span>}
        {k.danas_prodato > 0 && <span className="muted-text">danas prodato {k.danas_prodato}</span>}
        {k.danas_otpisano > 0 && <span className="muted-text">danas otpis {k.danas_otpisano}</span>}
      </div>
      {k.rasprodato ? (
        <div className="vitrina-rasprodato">Rasprodato</div>
      ) : (
        <div className="vitrina-dugmad">
          {!stop && (
            <button className="primary-button vitrina-prodat" disabled={radim} onClick={onProdat}>
              Prodat 1
            </button>
          )}
          <button className="secondary-button" onClick={onVise}>Upiši više</button>
          <button className={`secondary-button vitrina-otpis${stop ? " istaknuto" : ""}`} onClick={onOtpis}>Otpis</button>
        </div>
      )}
      {poruka && (
        <div className={poruka.greska ? "auth-error" : "vitrina-poruka"} role={poruka.greska ? "alert" : "status"}>
          {poruka.tekst}
        </div>
      )}
      <div className="vitrina-dno">
        <button className="link-button" onClick={onDetalj}>
          Sastojci i upisi <ChevronRight size={12} />
        </button>
        {k.ponisti_id && (
          <button className="link-button" disabled={radim} onClick={onPonisti}>
            <Undo2 size={12} /> Poništi ({posljednji})
          </button>
        )}
        <span className="muted-text vitrina-sifra">{k.broj}</span>
      </div>
    </div>
  );
}

/** Broj komada: velika dugmad − i + za prst, a može se i ukucati. */
function BrojKomada({ vrijednost, onChange, najvise }: { vrijednost: string; onChange: (v: string) => void; najvise?: number }) {
  const n = Number(vrijednost) || 0;
  return (
    <div className="broj-komada">
      <button type="button" className="secondary-button" aria-label="Manje" onClick={() => onChange(String(Math.max(1, n - 1)))}>−</button>
      <input inputMode="numeric" value={vrijednost} onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="0" aria-label="Broj komada" />
      <button type="button" className="secondary-button" aria-label="Više" onClick={() => onChange(String(najvise ? Math.min(najvise, n + 1) : n + 1))}>+</button>
    </div>
  );
}

/** Dan upisa: zaposleni bira danas ili juče (#9 — ne dalje), vodstvo datum. */
function DanUpisa({ dan, onChange, vodstvo, najranije }: { dan: string; onChange: (d: string) => void; vodstvo: boolean; najranije?: string }) {
  const danas = lokalniDatum();
  const juce = pomjeriDan(danas, -1);
  if (vodstvo) return <input type="date" value={dan} max={danas} min={najranije} onChange={(e) => onChange(e.target.value || danas)} />;
  return (
    <select value={dan} onChange={(e) => onChange(e.target.value)}>
      <option value={danas}>Danas ({kratko(danas)})</option>
      {(!najranije || juce >= najranije) && <option value={juce}>Juče ({kratko(juce)})</option>}
    </select>
  );
}

function NapravljenoForma({ nazivi, vodstvo, onClose, onSacuvano }: { nazivi: Naziv[]; vodstvo: boolean; onClose: () => void; onSacuvano: (id: string, tekst: string) => void }) {
  const danas = lokalniDatum();
  const [naziv, setNaziv] = useState("");
  const [broj, setBroj] = useState("");
  const [dan, setDan] = useState(danas);
  const [rokDana, setRokDana] = useState(2);
  const [rok, setRok] = useState(pomjeriDan(danas, 2));
  const [rokDirnut, setRokDirnut] = useState(false);
  const [napomena, setNapomena] = useState("");
  const [ponuda, setPonuda] = useState<Ponuda[]>([]);
  const [izabrani, setIzabrani] = useState<string[]>([]);
  const [trazi, setTrazi] = useState("");
  const [predlog, setPredlog] = useState(false);
  const [bezSastojaka, setBezSastojaka] = useState(false);
  const [greska, setGreska] = useState("");
  const [kljuc] = useState(noviKljuc);
  const { radim, salji } = useSlanje();

  useEffect(() => {
    api<Ponuda[]>("/porudzbine/sastojci").then(setPonuda).catch(() => setPonuda([]));
  }, []);

  // Isti kolač kao ranije: rok kao prošli put i sastojci kao prošli put — za svaki artikal prva serija po roku
  // (FEFO, #8). To je samo predlog: čovjek vidi i potvrđuje šta je stvarno koristio.
  const izaberiNaziv = (tekst: string) => {
    setNaziv(tekst);
    const raniji = nazivi.find((x) => x.naziv.toLowerCase() === tekst.trim().toLowerCase());
    if (!raniji) return;
    setRokDana(raniji.rok_dana);
    if (!rokDirnut) setRok(pomjeriDan(dan, raniji.rok_dana));
    if (izabrani.length === 0) {
      const predlozeni = raniji.artikli.map((a) => ponuda.find((p) => p.artikal === a)?.lot_id).filter((x): x is string => !!x);
      if (predlozeni.length > 0) {
        setIzabrani(predlozeni);
        setPredlog(true);
      }
    }
  };
  const promijeniDan = (d: string) => {
    setDan(d);
    if (!rokDirnut) setRok(pomjeriDan(d, rokDana));
  };
  const prebaci = (id: string) => {
    setIzabrani((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
    setBezSastojaka(false);
  };

  const izabraniLotovi = izabrani.map((id) => ponuda.find((p) => p.lot_id === id)).filter((p): p is Ponuda => !!p);
  const filtrirano = useMemo(() => {
    const t = trazi.trim().toLowerCase();
    return ponuda.filter((p) => !izabrani.includes(p.lot_id) && (!t || `${p.artikal} ${p.broj_lota} ${p.dobavljac}`.toLowerCase().includes(t)));
  }, [ponuda, izabrani, trazi]);
  const alergeni = Array.from(new Set(izabraniLotovi.flatMap((p) => p.alergeni)));
  const bezPodatka = Array.from(new Set(izabraniLotovi.filter((p) => !p.alergeni_upisani).map((p) => p.artikal)));

  const n = Number(broj);
  const fali: string[] = [];
  if (naziv.trim().length < 2) fali.push("naziv kolača");
  if (!Number.isInteger(n) || n < 1) fali.push("koliko je komada napravljeno");
  if (!rok) fali.push("rok");

  const sacuvaj = () => {
    if (fali.length > 0) {
      setGreska(`Za čuvanje još fali: ${fali.join(", ")}.`);
      return;
    }
    if (rok < dan) {
      setGreska("Rok ne može biti prije dana kad je kolač napravljen.");
      return;
    }
    if (izabrani.length === 0 && !bezSastojaka) {
      setBezSastojaka(true);
      setGreska("Niste izabrali nijedan sastojak — ako serija bude sporna, ovaj kolač neće biti na spisku. Izaberite serije sastojaka, ili dodirnite „Sačuvaj“ još jednom.");
      return;
    }
    setGreska("");
    void salji(async () => {
      try {
        const r = await api<{ id: string; broj: string }>("/vitrina", {
          telo: { naziv, komada: n, rok, datum: dan, napomena: napomena.trim() || undefined, lotIds: izabrani },
          kljuc,
        });
        onSacuvano(r.id, `${naziv.trim()} — ${n} kom. u vitrini.`);
      } catch (e) {
        setGreska(greskaTekst(e, "Nije sačuvano."));
      }
    });
  };

  return (
    <Modal
      naslov="Napravljeno"
      podnaslov="Kolači za vitrinu"
      onClose={onClose}
      greska={greska}
      siroki
      footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={sacuvaj} disabled={radim}>Sačuvaj</button></>}
    >
      <div className="form-grid">
        <label style={{ gridColumn: "1 / -1" }}>
          Kolač
          <input list="vitrina-nazivi" value={naziv} onChange={(e) => izaberiNaziv(e.target.value)} placeholder="npr. Čokoladni mousse" autoComplete="off" />
          <datalist id="vitrina-nazivi">
            {nazivi.map((x) => <option key={x.naziv} value={x.naziv} />)}
          </datalist>
        </label>
        {nazivi.length > 0 && !naziv && (
          <div className="vitrina-polje" style={{ gridColumn: "1 / -1" }}>
            Ranije pravljeno
            <div className="razlozi-brzo">
              {nazivi.slice(0, 12).map((x) => (
                <button type="button" key={x.naziv} className="small-action" onClick={() => izaberiNaziv(x.naziv)}>{x.naziv}</button>
              ))}
            </div>
          </div>
        )}
        {/* Ne <label>: dodir na natpis bi „kliknuo“ prvo dugme (−) unutra. */}
        <div className="vitrina-polje">Koliko komada<BrojKomada vrijednost={broj} onChange={setBroj} /></div>
        <label>Napravljeno<DanUpisa dan={dan} onChange={promijeniDan} vodstvo={vodstvo} /></label>
        <label>
          Rok (do kad se prodaje)
          <input type="date" value={rok} min={dan} onChange={(e) => { setRok(e.target.value); setRokDirnut(true); }} />
        </label>
        <label>Napomena (opciono)<input value={napomena} onChange={(e) => setNapomena(e.target.value)} placeholder="npr. bez glutena, za izlog" /></label>

        <div className="vitrina-polje" style={{ gridColumn: "1 / -1" }}>
          <span>Sastojci po seriji <ZakonskaOznaka clan="27" /></span>
          <small className="muted-text">Jaja, pavlaka, maskarpone, mlijeko… — ako serija bude sporna, zna se u kojim je kolačima i kog dana su prodati.</small>
          {predlog && izabrani.length > 0 && <div className="info-traka" style={{ margin: 0 }}>Predloženi su sastojci kao prošli put — provjerite da su to serije koje ste stvarno koristili.</div>}
          {izabraniLotovi.length > 0 && (
            <ul className="vitrina-izabrani">
              {izabraniLotovi.map((p) => (
                <li key={p.lot_id}>
                  {p.artikal} · {p.broj_lota}
                  <button type="button" aria-label={`Ukloni ${p.artikal}`} onClick={() => prebaci(p.lot_id)}><X size={12} /></button>
                </li>
              ))}
            </ul>
          )}
          {izabraniLotovi.length > 0 && (
            <div className="vitrina-oznake">
              Alergeni: <AlergeniOznaka sifre={alergeni} />
              {bezPodatka.length > 0 && <span className="alergeni-nisu">nisu upisani za: {bezPodatka.join(", ")}</span>}
            </div>
          )}
          <input value={trazi} onChange={(e) => setTrazi(e.target.value)} placeholder="Traži: jaja, pavlaka, broj lota…" aria-label="Traži sastojak" />
          <div className="vitrina-ponuda">
            {filtrirano.slice(0, 40).map((p) => (
              <button type="button" key={p.lot_id} className="vitrina-ponuda-red" onClick={() => prebaci(p.lot_id)}>
                <Plus size={14} />
                <span>
                  <strong>{p.artikal}</strong> · lot {p.broj_lota}
                  <span className="muted-text"> · rok {prikazRoka(p.rok)}</span>
                </span>
              </button>
            ))}
            {filtrirano.length > 40 && <div className="muted-text vitrina-ponuda-vise">još {filtrirano.length - 40} — suzite pretragu</div>}
            {ponuda.length === 0 && <div className="muted-text vitrina-ponuda-vise">Nema prihvaćenih sastojaka sa rokom — prvo prijem robe.</div>}
            {ponuda.length > 0 && filtrirano.length === 0 && <div className="muted-text vitrina-ponuda-vise">Ništa za „{trazi}“.</div>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function PrometForma({ vrsta, k, vodstvo, onClose, onSacuvano }: { vrsta: "prodaja" | "otpis"; k: Kolac; vodstvo: boolean; onClose: () => void; onSacuvano: (tekst: string) => void }) {
  const zadrzan = k.zadrzani.length > 0;
  const [broj, setBroj] = useState(vrsta === "otpis" ? String(Math.max(k.ostalo, 1)) : "");
  const [razlog, setRazlog] = useState(vrsta !== "otpis" ? "" : k.istekao ? "Istekao rok" : zadrzan ? "Sastojak zadržan" : "");
  const [dan, setDan] = useState(lokalniDatum());
  const [prije, setPrije] = useState(false);
  const [greska, setGreska] = useState("");
  const { radim, salji } = useSlanje();
  const prodaja = vrsta === "prodaja";
  const n = Number(broj);

  const fali: string[] = [];
  if (!Number.isInteger(n) || n < 1) fali.push("broj komada");
  if (!prodaja && razlog.trim().length < 3) fali.push("razlog otpisa");
  if (prodaja && zadrzan && !prije) fali.push("potvrda da je prodato prije nego što je sastojak zadržan");

  const sacuvaj = () => {
    if (fali.length > 0) {
      setGreska(`Za upis još fali: ${fali.join(", ")}.`);
      return;
    }
    if (n > k.ostalo) {
      setGreska(`U vitrini je ostalo ${k.ostalo} kom. — ne može se upisati ${n}.`);
      return;
    }
    setGreska("");
    void salji(async () => {
      try {
        const r = await api<{ ostalo: number }>(`/vitrina/${k.id}/promet`, {
          telo: {
            prodato: prodaja ? n : 0,
            otpisano: prodaja ? 0 : n,
            razlog: prodaja ? undefined : razlog,
            datum: dan,
            prijeZadrzavanja: prodaja && zadrzan ? true : undefined,
          },
        });
        onSacuvano(`${prodaja ? "Prodato" : "Otpis"} ${n} — u vitrini još ${r.ostalo}.`);
      } catch (e) {
        setGreska(greskaTekst(e, "Nije upisano."));
      }
    });
  };

  return (
    <Modal
      naslov={prodaja ? "Prodato" : "Otpis"}
      podnaslov={`${k.naziv} · u vitrini ${k.ostalo} od ${k.komada}`}
      onClose={onClose}
      greska={greska}
      footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className={prodaja ? "primary-button" : "primary-button opasno"} onClick={sacuvaj} disabled={radim}>{prodaja ? "Upiši prodato" : "Upiši otpis"}</button></>}
    >
      <div className="form-grid">
        <div className="vitrina-polje">Koliko komada<BrojKomada vrijednost={broj} onChange={setBroj} najvise={k.ostalo} /></div>
        <label>Dan<DanUpisa dan={dan} onChange={setDan} vodstvo={vodstvo} najranije={k.datum} /></label>
        {!prodaja && (
          <div className="vitrina-polje" style={{ gridColumn: "1 / -1" }}>
            Zašto se otpisuje
            <div className="razlozi-brzo">
              {RAZLOZI_OTPISA.map((r) => (
                <button type="button" key={r} className={`small-action${razlog === r ? " izabrano" : ""}`} onClick={() => setRazlog(r)}>{r}</button>
              ))}
            </div>
            <input value={razlog} onChange={(e) => setRazlog(e.target.value)} placeholder="ili upišite razlog" aria-label="Razlog otpisa" />
          </div>
        )}
        {prodaja && zadrzan && (
          <label className="potvrda-red vitrina-potvrda" style={{ gridColumn: "1 / -1" }}>
            <input type="checkbox" checked={prije} onChange={(e) => setPrije(e.target.checked)} />
            <span>Ovo je prodato PRIJE nego što je sastojak zadržan ({k.zadrzani.join(", ")}). Od sada se ne prodaje.</span>
          </label>
        )}
        {prodaja && k.istekao && <p className="upozorenje-tekst" style={{ gridColumn: "1 / -1", margin: 0 }}><AlertTriangle size={12} /> Rok je istekao {kratko(k.rok)} — prodaja se upisuje samo za dan do roka.</p>}
      </div>
    </Modal>
  );
}

function DetaljKolacaModal({ id, onClose, onPromjena }: { id: string; onClose: () => void; onPromjena: () => void }) {
  const [d, setD] = useState<DetaljKolaca | null>(null);
  const [greska, setGreska] = useState("");
  const [obavijest, setObavijest] = useState("");
  const [ponuda, setPonuda] = useState<Ponuda[]>([]);
  const [trazi, setTrazi] = useState("");
  const [izabraniLot, setIzabraniLot] = useState("");
  const [ispravka, setIspravka] = useState<{ naziv: string; komada: string; rok: string; napomena: string } | null>(null);
  const [ponistava, setPonistava] = useState<string | null>(null);
  const [razlog, setRazlog] = useState("");
  const { radim, salji } = useSlanje();

  const ucitaj = async () => {
    try {
      setD(await api<DetaljKolaca>(`/vitrina/${id}`));
    } catch (e) {
      setGreska(greskaTekst(e, "Kolač se nije otvorio."));
    }
  };
  useEffect(() => {
    void ucitaj();
    api<Ponuda[]>("/porudzbine/sastojci").then(setPonuda).catch(() => setPonuda([]));
  }, [id]);

  const osvjezi = async (poruka = "") => {
    setObavijest(poruka);
    await ucitaj();
    onPromjena();
  };
  const radnja = (fn: () => Promise<void>) =>
    salji(async () => {
      setGreska("");
      try {
        await fn();
      } catch (e) {
        setGreska(greskaTekst(e, "Nije sačuvano."));
      }
    });

  const ponudaZaDodati = useMemo(() => {
    const vec = new Set(d?.sastojci.map((s) => s.lot_id));
    const t = trazi.trim().toLowerCase();
    return ponuda.filter((p) => !vec.has(p.lot_id) && (!t || `${p.artikal} ${p.broj_lota} ${p.dobavljac}`.toLowerCase().includes(t)));
  }, [ponuda, d, trazi]);

  if (!d) {
    return (
      <Modal naslov="Kolač" onClose={onClose} greska={greska}>
        <div style={{ padding: 20 }} className="muted-text">{greska ? "" : "Učitavanje..."}</div>
      </Modal>
    );
  }

  const prodavan = d.promet.length > 0;
  return (
    <Modal
      naslov={d.naziv}
      podnaslov={`${d.broj} · napravljeno ${puno(d.datum)}`}
      onClose={onClose}
      greska={greska}
      siroki
      footer={<button className="secondary-button" onClick={onClose}>Zatvori</button>}
    >
      <div className="porudzbina-detalj">
        {obavijest && <div className="info-traka" role="status">{obavijest}</div>}
        <section>
          <div className="vitrina-brojevi">
            <div><strong>{d.komada}</strong><span>napravljeno</span></div>
            <div><strong>{d.prodato}</strong><span>prodato</span></div>
            <div><strong>{d.otpisano}</strong><span>otpis</span></div>
            <div><strong>{d.ostalo}</strong><span>u vitrini</span></div>
          </div>
          <p className="muted-text">
            Rok: {d.istekao ? <b className="vitrina-crveno">istekao {puno(d.rok)}</b> : puno(d.rok)} · napravio/la: {d.izvrsilac} · upisao/la: {d.uneo}
          </p>
          {d.napomena && <p className="muted-text">Napomena: {d.napomena}</p>}
          {!ispravka && (
            <div className="dugmad-red">
              <button className="small-action" onClick={() => setIspravka({ naziv: d.naziv, komada: String(d.komada), rok: d.rok, napomena: d.napomena ?? "" })}>Ispravi naziv, broj ili rok</button>
            </div>
          )}
          {ispravka && (
            <div className="podforma">
              <label className="podforma-polje">Naziv<input value={ispravka.naziv} onChange={(e) => setIspravka({ ...ispravka, naziv: e.target.value })} /></label>
              <label className="podforma-polje">Napravljeno komada<input inputMode="numeric" value={ispravka.komada} onChange={(e) => setIspravka({ ...ispravka, komada: e.target.value.replace(/\D/g, "") })} /></label>
              <label className="podforma-polje">Rok<input type="date" value={ispravka.rok} min={d.datum} onChange={(e) => setIspravka({ ...ispravka, rok: e.target.value })} /></label>
              <label className="podforma-polje">Napomena<input value={ispravka.napomena} onChange={(e) => setIspravka({ ...ispravka, napomena: e.target.value })} /></label>
              <div className="dugmad-red">
                <button
                  className="secondary-button"
                  disabled={radim}
                  onClick={() =>
                    void radnja(async () => {
                      await api(`/vitrina/${id}`, { method: "PATCH", telo: { naziv: ispravka.naziv, komada: Number(ispravka.komada), rok: ispravka.rok, napomena: ispravka.napomena || undefined } });
                      setIspravka(null);
                      await osvjezi("Ispravljeno.");
                    })
                  }
                >
                  Sačuvaj ispravku
                </button>
                <button className="link-button" onClick={() => setIspravka(null)}>Odustani</button>
              </div>
            </div>
          )}
        </section>

        <section>
          <h3>Sastojci po seriji <ZakonskaOznaka clan="27" /></h3>
          {d.sastojci.length === 0 && <p className="alergeni-nisu" style={{ display: "block" }}>Sastojci nisu upisani — dodajte serije ispod, da se zna od čega je kolač.</p>}
          <ul className="sastojci-lista">
            {d.sastojci.map((s) => (
              <li key={s.lot_id} className={s.lot_status !== "PRIHVACEN" ? "zadrzan" : ""}>
                <div>
                  <strong>{s.artikal}</strong> · lot {s.broj_lota}
                  <span className="muted-text"> · rok {prikazRoka(s.rok)}</span>
                  <div className="sastojak-alergeni">
                    {s.alergeni_upisani ? <AlergeniOznaka sifre={s.alergeni} prazno="bez alergena" /> : <span className="alergeni-nisu">alergeni nisu upisani u Šifarnicima</span>}
                    {s.lot_status !== "PRIHVACEN" && <span className="alergeni-nisu"><AlertTriangle size={11} /> zadržan — kolač se ne prodaje</span>}
                  </div>
                </div>
                {!prodavan && (
                  <button
                    className="row-action"
                    aria-label={`Ukloni ${s.artikal}`}
                    title="Pogrešno izabran — ukloni"
                    onClick={() => void radnja(async () => { await api(`/vitrina/${id}/lotovi/${s.lot_id}`, { method: "DELETE" }); await osvjezi(); })}
                  >
                    <X size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {d.sastojci.length > 0 && <p>Alergeni kolača: <AlergeniOznaka sifre={d.alergeni} /></p>}
          {d.bezAlergena.length > 0 && <p className="upozorenje-tekst"><AlertTriangle size={12} /> Alergeni nisu upisani za: {d.bezAlergena.join(", ")} — pogledajte deklaraciju (upisuje se u Šifarnicima).</p>}
          {prodavan && <p className="muted-text">Kolač se već prodaje — sastojak se ne skida (da povlačenje ne izostavi nijedan kolač), ali se zaboravljeni može dodati.</p>}
          {(d.ostalo > 0 || !prodavan) && (
            <div className="form-grid dodaj-sastojak">
              <label>
                Traži sastojak
                <input value={trazi} onChange={(e) => setTrazi(e.target.value)} placeholder="jaja, pavlaka, broj lota…" />
              </label>
              <label>
                Serija (lot)
                <select value={izabraniLot} onChange={(e) => setIzabraniLot(e.target.value)}>
                  <option value="">— izaberite —</option>
                  {ponudaZaDodati.map((p) => (
                    <option key={p.lot_id} value={p.lot_id}>{p.artikal} · {p.broj_lota} · rok {prikazRoka(p.rok)}</option>
                  ))}
                </select>
              </label>
              <button
                className="secondary-button"
                style={{ alignSelf: "end" }}
                onClick={() => {
                  if (!izabraniLot) {
                    setGreska("Izaberite seriju sastojka sa spiska.");
                    return;
                  }
                  void radnja(async () => {
                    await api(`/vitrina/${id}/lotovi`, { telo: { lotId: izabraniLot } });
                    setIzabraniLot("");
                    await osvjezi("Sastojak je dodat.");
                  });
                }}
              >
                <Plus size={14} /> Dodaj
              </button>
            </div>
          )}
        </section>

        <section>
          <h3>Upisi prodaje i otpisa</h3>
          {d.promet.length === 0 && <p className="muted-text">Još ništa nije prodato ni otpisano.</p>}
          <ul className="sastojci-lista">
            {d.promet.map((p) => (
              <li key={p.id}>
                <div>
                  <strong>{prikazDana(p.datum)}</strong> · {p.prodato > 0 && `prodato ${p.prodato}`}{p.prodato > 0 && p.otpisano > 0 && ", "}{p.otpisano > 0 && <span className="vitrina-crveno">otpis {p.otpisano} ({p.razlog_otpisa})</span>}
                  <span className="muted-text"> · {p.uneo} · {p.upisano}</span>
                  {ponistava === p.id && (
                    <div className="podforma">
                      {p.trebaRazlog && (
                        <label className="podforma-polje">
                          Zašto se poništava
                          <input value={razlog} onChange={(e) => setRazlog(e.target.value)} placeholder="npr. upisano 5 umjesto 3" />
                        </label>
                      )}
                      <div className="dugmad-red">
                        <button
                          className="secondary-button"
                          disabled={radim}
                          onClick={() =>
                            void radnja(async () => {
                              await api(`/vitrina/promet/${p.id}/ponisti`, { telo: { razlog: razlog || undefined } });
                              setPonistava(null);
                              setRazlog("");
                              await osvjezi("Upis je poništen.");
                            })
                          }
                        >
                          Poništi upis
                        </button>
                        <button className="link-button" onClick={() => setPonistava(null)}>Odustani</button>
                      </div>
                    </div>
                  )}
                </div>
                {p.mozePonistiti && ponistava !== p.id && (
                  <button className="row-action" aria-label="Poništi upis" title="Poništi upis" onClick={() => { setPonistava(p.id); setRazlog(""); }}>
                    <Undo2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Modal>
  );
}

function IstorijaVitrine({ vodstvo, osvjezenje }: { vodstvo: boolean; osvjezenje: number }) {
  // Zaposleni vidi od juče (#6); vodstvo bira period.
  const periodi = vodstvo
    ? [{ dana: 0, naziv: "Danas" }, { dana: 6, naziv: "7 dana" }, { dana: 29, naziv: "30 dana" }]
    : [{ dana: 1, naziv: "Juče i danas" }];
  const [dana, setDana] = useState(vodstvo ? 6 : 1);
  const [ist, setIst] = useState<Istorija | null>(null);
  const [greska, setGreska] = useState("");

  useEffect(() => {
    const danas = lokalniDatum();
    api<Istorija>(`/vitrina/istorija?od=${pomjeriDan(danas, -dana)}&do=${danas}`)
      .then((r) => {
        setIst(r);
        setGreska("");
      })
      .catch((e) => setGreska(greskaTekst(e, "Istorija se nije učitala.")));
  }, [dana, osvjezenje]);

  return (
    <section className="vitrina-istorija">
      <h2 className="vitrina-naslov">Istorija po danima</h2>
      {periodi.length > 1 && (
        <div className="filter-bar">
          {periodi.map((p) => (
            <button key={p.dana} className={`small-action${dana === p.dana ? " selected" : ""}`} onClick={() => setDana(p.dana)}>{p.naziv}</button>
          ))}
        </div>
      )}
      {greska && <div className="auth-error" role="alert">{greska}</div>}
      {/* Zbir perioda samo kad ima više dana — za jedan dan je isto što piše u zaglavlju tog dana. */}
      {ist && ist.dani.length > 1 && (
        <div className="vitrina-zbir">
          <span className="vitrina-zbir-naslov">{periodi.find((p) => p.dana === dana)?.naziv ?? "Period"}</span>
          <span>napravljeno <b>{ist.ukupno.napravljeno}</b></span>
          <span>prodato <b>{ist.ukupno.prodato}</b></span>
          <span>otpis <b>{ist.ukupno.otpisano}</b></span>
        </div>
      )}
      {ist && ist.dani.length === 0 && <p className="muted-text">U ovom periodu nema upisa.</p>}
      {ist?.dani.map((d) => {
        const prodato = d.promet.filter((p) => p.prodato > 0);
        const otpis = d.promet.filter((p) => p.otpisano > 0);
        return (
          <div key={d.dan} className="panel vitrina-dan">
            <h3>
              <span>{danUSedmici(d.dan)} {kratko(d.dan)}</span>
              <span className="muted-text">napravljeno {d.ukupno.napravljeno} · prodato {d.ukupno.prodato} · otpis {d.ukupno.otpisano}</span>
            </h3>
            {d.napravljeno.length > 0 && <p><b>Napravljeno:</b> {d.napravljeno.map((x) => `${x.naziv} ${x.komada}`).join(", ")}</p>}
            {prodato.length > 0 && <p><b>Prodato:</b> {prodato.map((x) => `${x.naziv} ${x.prodato}`).join(", ")}</p>}
            {otpis.length > 0 && <p className="vitrina-crveno"><b>Otpis:</b> {otpis.map((x) => `${x.naziv} ${x.otpisano}${x.razlozi ? ` (${x.razlozi})` : ""}`).join(", ")}</p>}
          </div>
        );
      })}
    </section>
  );
}
