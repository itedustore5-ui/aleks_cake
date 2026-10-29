import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronDown, ChevronUp, Plus } from "lucide-react";
import { api, ApiGreska } from "../lib/api";
import { Modal } from "./Zajednicko";
import { PodaciFirmeModal } from "./PodaciFirme";

// „Prvi koraci“ (29.10.2026): vlasnica sama podešava atelje, uz video uputstvo konsultanta. Spisak dolazi sa servera
// (pocetakService) — svaki korak je urađen kad to baza kaže, ne kad se klikne kvačica. Dugme vodi pravo na mjesto
// gdje se radi; podaci ateljea i uređaji se upisuju ovdje, u prozoru.

type Korak = { kod: string; naslov: string; opis: string; stanje: string; gotovo: boolean | null; opciono?: boolean };
type Koraci = { koraci: Korak[]; uradjeno: number; ukupno: number };

const SAKRIVENO = "pilot-prvi-koraci-sakriveno";
const sakriveno = () => {
  try {
    return localStorage.getItem(SAKRIVENO) === "1";
  } catch {
    return false;
  }
};

export function PrviKoraci() {
  const navigate = useNavigate();
  const [p, setP] = useState<Koraci | null>(null);
  const [zatvoreno, setZatvoreno] = useState(sakriveno);
  const [modal, setModal] = useState<"firma" | "uredjaji" | null>(null);
  const [radim, setRadim] = useState(false);
  const [poruka, setPoruka] = useState("");
  const [greska, setGreska] = useState("");

  const ucitaj = () => api<Koraci>("/prvi-koraci").then(setP).catch(() => undefined);
  useEffect(() => {
    void ucitaj();
  }, []);
  if (!p) return null;

  const sve = p.uradjeno === p.ukupno;
  const prebaci = () => {
    setZatvoreno((z) => {
      try {
        localStorage.setItem(SAKRIVENO, z ? "0" : "1");
      } catch {
        /* privatni prozor — samo za ovaj put */
      }
      return !z;
    });
  };

  const napraviPlan = async () => {
    setGreska("");
    setPoruka("");
    setRadim(true);
    try {
      const r = await api<{ broj: number; granice: number }>("/plan-monitoringa/osnovni", { method: "POST", telo: {} });
      setPoruka(`Plan je napravljen: ${r.broj} stavki — frižideri dva puta dnevno, čišćenje i lična higijena radnim danima… Sljedeći korak: provjerite uređaje i granice.`);
      await ucitaj();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Plan nije napravljen — provjerite internet i pokušajte ponovo.");
    } finally {
      setRadim(false);
    }
  };

  const dugme = (k: Korak) => {
    const idi = (putanja: string, stanje?: unknown) => () => navigate(putanja, stanje ? { state: stanje } : undefined);
    const radnja: Record<string, [string, () => void]> = {
      firma: [k.gotovo ? "Izmijeni" : "Upiši", () => setModal("firma")],
      plan: k.gotovo ? ["Otvori plan", idi("/haccp-plan", { kartica: "plan" })] : [radim ? "Pravim…" : "Napravi plan", napraviPlan],
      uredjaji: ["Uređaji", () => setModal("uredjaji")],
      termometar: ["Termometri", idi("/haccp-plan", { kartica: "termometri" })],
      zaposleni: ["Zaposleni", idi("/ljudi", { tab: "zaposleni" })],
      dobavljaci: ["Dobavljači", idi("/sifarnici", { tab: "dobavljaci" })],
      sastojci: ["Sastojci", idi("/sifarnici", { tab: "artikli" })],
      kupci: ["Kupci", idi("/sifarnici", { tab: "kupci" })],
      rjesenje: ["Prilozi", idi("/prilozi")],
      telefon: ["Uključi", () => navigate("/moja#obavjestenja-telefon")],
    };
    const [tekst, klik] = radnja[k.kod] ?? ["Otvori", () => undefined];
    return (
      <button className={k.gotovo ? "secondary-button" : "primary-button"} onClick={klik} disabled={k.kod === "plan" && radim}>
        {tekst}
      </button>
    );
  };

  if (sve && zatvoreno) {
    return (
      <button type="button" className="prvi-koraci-zatvoreno" onClick={prebaci}>
        <Check size={15} /> Atelje je podešen — prvi koraci urađeni <ChevronDown size={15} />
      </button>
    );
  }

  return (
    <section className="panel prvi-koraci" aria-labelledby="prvi-koraci-naslov">
      <div className="prvi-koraci-glava">
        <div>
          <h2 id="prvi-koraci-naslov">Prvi koraci — podesite atelje</h2>
          <span className="muted-text">Redom, odozgo. Svaki korak se sam označi kad je urađen.</span>
        </div>
        <strong>{p.uradjeno} od {p.ukupno} urađeno</strong>
      </div>
      <div className="prvi-koraci-traka" aria-hidden="true"><span style={{ width: `${Math.round((p.uradjeno / p.ukupno) * 100)}%` }} /></div>
      {poruka && <div className="nc-info" role="status">{poruka}</div>}
      {greska && <div className="auth-error" role="alert">{greska}</div>}
      <ol>
        {p.koraci.map((k, i) => (
          <li key={k.kod} className={`prvi-korak${k.gotovo ? " gotovo" : k.gotovo === false && !k.opciono ? " fali" : ""}`}>
            <span className="br" aria-hidden="true">{k.gotovo ? <Check size={14} /> : i + 1}</span>
            <div>
              <strong>{k.naslov}{k.opciono ? " (nije obavezno)" : ""}</strong>
              <p>{k.opis}</p>
              <div className="stanje">{k.gotovo ? "✓ " : ""}{k.stanje}</div>
            </div>
            {dugme(k)}
          </li>
        ))}
      </ol>
      {sve && (
        <button type="button" className="link-button" onClick={prebaci}>
          <ChevronUp size={14} /> Sakrij spisak
        </button>
      )}
      {modal === "firma" && <PodaciFirmeModal onClose={() => setModal(null)} onSaved={ucitaj} />}
      {modal === "uredjaji" && <UredjajiModal imaPlan={!!p.koraci.find((k) => k.kod === "plan")?.gotovo} onClose={() => { setModal(null); void ucitaj(); }} />}
    </section>
  );
}

// ─── Frižideri, vitrina, zamrzivač ──────────────────────────────────────────────────────────────
type Vrsta = "frizider" | "vitrina" | "zamrzivac";
type Uredjaj = { id: string; sifra: string; naziv: string; vrsta: Vrsta; aktivan: boolean; min: number | null; max: number | null; u_planu: boolean; mjereno: boolean };
const VRSTE: Record<Vrsta, { naziv: string; min: number; max: number }> = {
  frizider: { naziv: "Frižider", min: 0, max: 4 },
  vitrina: { naziv: "Vitrina", min: 0, max: 4 },
  zamrzivac: { naziv: "Zamrzivač", min: -25, max: -18 },
};
const broj = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(",", ".")));

function UredjajiModal({ imaPlan, onClose }: { imaPlan: boolean; onClose: () => void }) {
  const [lista, setLista] = useState<Uredjaj[] | null>(null);
  const [greska, setGreska] = useState("");
  const [poruka, setPoruka] = useState("");
  const ucitaj = () => api<Uredjaj[]>("/uredjaji-cuvanja").then(setLista).catch(() => setGreska("Spisak se nije učitao — provjerite internet."));
  useEffect(() => {
    void ucitaj();
  }, []);

  const izmijeni = async (id: string, telo: Record<string, unknown>, tekst: string) => {
    setGreska("");
    setPoruka("");
    try {
      await api(`/uredjaji-cuvanja/${id}`, { method: "PATCH", telo });
      setPoruka(tekst);
      await ucitaj();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Nije sačuvano — provjerite internet i pokušajte ponovo.");
    }
  };

  const aktivni = (lista ?? []).filter((u) => u.aktivan);
  const iskljuceni = (lista ?? []).filter((u) => !u.aktivan);
  return (
    <Modal naslov="Frižideri, vitrina, zamrzivač" podnaslov="Svaki uređaj se mjeri posebno, po svojoj granici" onClose={onClose} greska={greska} siroki
      footer={<button className="primary-button" onClick={onClose}>Gotovo</button>}>
      <div className="uredjaji-modal">
        <p className="muted-text">
          Upišite uređaje kakve stvarno imate i dajte im imena koja zaposleni prepoznaju (npr. „Frižider za kremove“). Granica je predlog —
          ako je za neki uređaj drugačija, upišite je. Uređaj koji nemate — „Nemamo ga“.
          {!imaPlan && " Kad napravite plan (korak 2), svaki uređaj dobija mjerenje dva puta dnevno."}
        </p>
        {poruka && <div className="nc-info" role="status">{poruka}</div>}
        {lista === null && <p className="muted-text">Učitavanje…</p>}
        {aktivni.map((u) => <UredjajRed key={u.id} u={u} onSacuvaj={izmijeni} />)}
        <NovUredjaj zauzeti={(lista ?? []).map((u) => u.naziv)} onDodato={(t) => { setPoruka(t); void ucitaj(); }} setGreska={setGreska} />
        {iskljuceni.length > 0 && (
          <div className="uredjaji-iskljuceni">
            <strong>Isključeni (ne mjere se)</strong>
            {iskljuceni.map((u) => (
              <div key={u.id} className="uredjaj-iskljucen">
                <span>{u.naziv}</span>
                <button className="small-action" onClick={() => izmijeni(u.id, { aktivan: true }, `„${u.naziv}“ je ponovo uključen.`)}>Vrati</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function UredjajRed({ u, onSacuvaj }: { u: Uredjaj; onSacuvaj: (id: string, telo: Record<string, unknown>, tekst: string) => Promise<void> }) {
  const [naziv, setNaziv] = useState(u.naziv);
  const [min, setMin] = useState(u.min === null ? "" : String(u.min));
  const [max, setMax] = useState(u.max === null ? "" : String(u.max));
  const [fali, setFali] = useState("");
  const sacuvaj = () => {
    setFali("");
    const a = broj(min);
    const b = broj(max);
    if (naziv.trim().length < 2) return setFali("Upišite naziv.");
    if (Number.isNaN(a) || Number.isNaN(b)) return setFali("Upišite granicu brojem, od i do (npr. 0 i 4).");
    if (a >= b) return setFali("Granica „od“ mora biti niža od „do“.");
    const telo: Record<string, unknown> = {};
    if (naziv.trim() !== u.naziv) telo.naziv = naziv.trim();
    if (a !== u.min || b !== u.max) Object.assign(telo, { min: a, max: b });
    if (!Object.keys(telo).length) return setFali("Nema izmjena.");
    void onSacuvaj(u.id, telo, `„${naziv.trim()}“ je sačuvan.`);
  };
  return (
    <div className="uredjaj-red">
      <div className="uredjaj-polja">
        <label className="uredjaj-naziv">{VRSTE[u.vrsta].naziv}<input value={naziv} onChange={(e) => setNaziv(e.target.value)} /></label>
        <label>Od °C<input inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} /></label>
        <label>Do °C<input inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} /></label>
      </div>
      <div className="uredjaj-dugmad">
        <button className="secondary-button" onClick={sacuvaj}>Sačuvaj</button>
        <button className="link-button" onClick={() => void onSacuvaj(u.id, { aktivan: false }, `„${u.naziv}“ je isključen — više se ne traži njegovo mjerenje.`)}>Nemamo ga</button>
        {u.min === null && <span className="danas-fali">nema granicu</span>}
        {fali && <span className="danas-fali" role="alert">{fali}</span>}
      </div>
    </div>
  );
}

function NovUredjaj({ zauzeti, onDodato, setGreska }: { zauzeti: string[]; onDodato: (t: string) => void; setGreska: (s: string) => void }) {
  const [vrsta, setVrsta] = useState<Vrsta>("frizider");
  const predlogNaziva = (v: Vrsta) => {
    const z = new Set(zauzeti.map((x) => x.trim().toLowerCase()));
    let n = VRSTE[v].naziv;
    for (let i = 2; z.has(n.toLowerCase()); i++) n = `${VRSTE[v].naziv} ${i}`;
    return n;
  };
  const [naziv, setNaziv] = useState(() => predlogNaziva("frizider"));
  const [min, setMin] = useState("0");
  const [max, setMax] = useState("4");
  const [fali, setFali] = useState("");
  const promijeniVrstu = (v: Vrsta) => {
    setVrsta(v);
    setNaziv(predlogNaziva(v));
    setMin(String(VRSTE[v].min));
    setMax(String(VRSTE[v].max));
  };
  const dodaj = async () => {
    setFali("");
    setGreska("");
    const a = broj(min);
    const b = broj(max);
    if (naziv.trim().length < 2) return setFali("Upišite naziv.");
    if (Number.isNaN(a) || Number.isNaN(b)) return setFali("Upišite granicu brojem, od i do.");
    if (a >= b) return setFali("Granica „od“ mora biti niža od „do“.");
    try {
      await api("/uredjaji-cuvanja", { telo: { naziv: naziv.trim(), vrsta, min: a, max: b } });
      onDodato(`„${naziv.trim()}“ je dodat.`);
      setNaziv(predlogNaziva(vrsta));
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Uređaj nije dodat — provjerite internet i pokušajte ponovo.");
    }
  };
  return (
    <div className="uredjaj-red uredjaj-nov">
      <strong>Dodaj uređaj</strong>
      <div className="uredjaj-polja">
        <label>Vrsta
          <select value={vrsta} onChange={(e) => promijeniVrstu(e.target.value as Vrsta)}>
            {(Object.keys(VRSTE) as Vrsta[]).map((v) => <option key={v} value={v}>{VRSTE[v].naziv}</option>)}
          </select>
        </label>
        <label className="uredjaj-naziv">Naziv<input value={naziv} onChange={(e) => setNaziv(e.target.value)} /></label>
        <label>Od °C<input inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} /></label>
        <label>Do °C<input inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} /></label>
      </div>
      <div className="uredjaj-dugmad">
        <button className="primary-button" onClick={dodaj}><Plus size={15} /> Dodaj</button>
        {fali && <span className="danas-fali" role="alert">{fali}</span>}
      </div>
    </div>
  );
}
