import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api, ApiGreska } from "../lib/api";
import { PageHeader, Modal } from "../components/Zajednicko";
import { StatusBadge } from "../components/StatusBadge";

type Firma = { naziv: string; pib: string | null; adresa: string | null; grad: string | null; telefon: string | null; email: string | null; odgovorno_lice_ime: string | null };
type Pitanje = { id: string; tema: string; tekst: string; ponudjeni_odgovori: string[]; tacan_indeks: number; aktivno: boolean };
type Sesija = { id: string; naziv: string; broj_pitanja: number; otvoren: boolean; cuva_imena: boolean };

const TABOVI = [
  { kod: "firma", naziv: "Podaci o firmi" },
  { kod: "pitanja", naziv: "Banka pitanja" },
  { kod: "sesije", naziv: "Sesije provjere znanja" },
] as const;

export function Admin() {
  const [tab, setTab] = useState<(typeof TABOVI)[number]["kod"]>("firma");
  const [firma, setFirma] = useState<Firma | null>(null);
  const [pitanja, setPitanja] = useState<Pitanje[]>([]);
  const [sesije, setSesije] = useState<Sesija[]>([]);
  const [modalPitanje, setModalPitanje] = useState(false);
  const [modalSesija, setModalSesija] = useState(false);

  const ucitaj = () => {
    api<Firma>("/firma").then(setFirma);
    api<Pitanje[]>("/pitanja").then(setPitanja);
    api<Sesija[]>("/provjera-znanja/sesije").then(setSesije);
  };
  useEffect(ucitaj, []);

  return (
    <>
      <PageHeader title="Podešavanje" description="Vidljivo samo konsultantu — banka pitanja se nikad ne pokazuje klijentu." />
      <div className="filter-tabs" style={{ marginBottom: 20 }}>
        {TABOVI.map((t) => (
          <button key={t.kod} className={tab === t.kod ? "selected" : ""} onClick={() => setTab(t.kod)}>{t.naziv}</button>
        ))}
      </div>

      {tab === "firma" && firma && <FirmaForma firma={firma} onSaved={ucitaj} />}

      {tab === "pitanja" && (
        <>
          <button className="primary-button" style={{ marginBottom: 16 }} onClick={() => setModalPitanje(true)}>
            <Plus size={16} /> Novo pitanje
          </button>
          <div className="panel full-panel">
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Tema</th><th>Pitanje</th><th>Tačan odgovor</th><th>Aktivno</th></tr>
                </thead>
                <tbody>
                  {pitanja.map((p) => (
                    <tr key={p.id}>
                      <td>{p.tema}</td>
                      <td className="muted-text">{p.tekst}</td>
                      <td>{p.ponudjeni_odgovori[p.tacan_indeks]}</td>
                      <td>{p.aktivno ? <StatusBadge status="VAZI" tekst="Da" /> : <StatusBadge status="ISTEKLA" tekst="Ne" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === "sesije" && (
        <>
          <button className="primary-button" style={{ marginBottom: 16 }} onClick={() => setModalSesija(true)}>
            <Plus size={16} /> Nova sesija
          </button>
          <div className="panel full-panel">
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Naziv</th><th>Broj pitanja</th><th>Čuva imena</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {sesije.map((s) => (
                    <tr key={s.id}>
                      <td>{s.naziv}</td>
                      <td>{s.broj_pitanja}</td>
                      <td>{s.cuva_imena ? "Da" : "Anonimno"}</td>
                      <td>{s.otvoren ? <StatusBadge status="VAZI" tekst="Otvorena" /> : <StatusBadge status="ISTEKLA" tekst="Zatvorena" />}</td>
                      <td>{s.otvoren && <button className="small-action" onClick={() => api(`/provjera-znanja/sesije/${s.id}/zatvori`, { method: "PATCH", telo: {} }).then(ucitaj)}>Zatvori</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {modalPitanje && <NovoPitanjeModal onClose={() => setModalPitanje(false)} onCreated={ucitaj} />}
      {modalSesija && <NovaSesijaModal onClose={() => setModalSesija(false)} onCreated={ucitaj} />}
    </>
  );
}

function FirmaForma({ firma, onSaved }: { firma: Firma; onSaved: () => void }) {
  const [vrijednosti, setVrijednosti] = useState(firma);
  const [greska, setGreska] = useState("");

  const posalji = async () => {
    try {
      await api("/firma", { method: "PATCH", telo: vrijednosti });
      setGreska("");
      onSaved();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Podaci o firmi nisu sačuvani.");
    }
  };

  return (
    <div className="panel" style={{ maxWidth: 560 }}>
      <div className="panel-header"><h2>Podaci o firmi</h2></div>
      {greska && <div className="auth-error" style={{ margin: "0 20px 16px" }}>{greska}</div>}
      <div className="form-grid">
        <label>Naziv<input value={vrijednosti.naziv} onChange={(e) => setVrijednosti((v) => ({ ...v, naziv: e.target.value }))} /></label>
        <label>PIB<input value={vrijednosti.pib ?? ""} onChange={(e) => setVrijednosti((v) => ({ ...v, pib: e.target.value }))} /></label>
        <label>Adresa<input value={vrijednosti.adresa ?? ""} onChange={(e) => setVrijednosti((v) => ({ ...v, adresa: e.target.value }))} /></label>
        <label>Grad<input value={vrijednosti.grad ?? ""} onChange={(e) => setVrijednosti((v) => ({ ...v, grad: e.target.value }))} /></label>
        <label>Telefon<input value={vrijednosti.telefon ?? ""} onChange={(e) => setVrijednosti((v) => ({ ...v, telefon: e.target.value }))} /></label>
        <label>Email<input value={vrijednosti.email ?? ""} onChange={(e) => setVrijednosti((v) => ({ ...v, email: e.target.value }))} /></label>
        <label style={{ gridColumn: "1 / -1" }}>Odgovorno lice (ime za rješenje o imenovanju)<input value={vrijednosti.odgovorno_lice_ime ?? ""} onChange={(e) => setVrijednosti((v) => ({ ...v, odgovorno_lice_ime: e.target.value }))} /></label>
      </div>
      <div style={{ padding: "0 20px 20px" }}>
        <button className="primary-button" onClick={posalji}>Sačuvaj</button>
      </div>
    </div>
  );
}

function NovoPitanjeModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [tema, setTema] = useState("");
  const [tekst, setTekst] = useState("");
  const [odgovori, setOdgovori] = useState(["", "", "", ""]);
  const [tacanIndeks, setTacanIndeks] = useState(0);
  const [greska, setGreska] = useState("");

  const posalji = async () => {
    try {
      await api("/pitanja", { telo: { tema, tekst, ponudjeniOdgovori: odgovori.filter((o) => o.trim()), tacanIndeks } });
      onCreated();
      onClose();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Pitanje nije sačuvano.");
    }
  };

  return (
    <Modal naslov="Novo pitanje" onClose={onClose} greska={greska} footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={posalji} disabled={!tema || !tekst}>Sačuvaj</button></>}>
      <div className="form-grid">
        <label style={{ gridColumn: "1 / -1" }}>Tema<input value={tema} onChange={(e) => setTema(e.target.value)} /></label>
        <label style={{ gridColumn: "1 / -1" }}>Pitanje<input value={tekst} onChange={(e) => setTekst(e.target.value)} /></label>
        {odgovori.map((o, i) => (
          <label key={i}>
            Odgovor {i + 1} {i === tacanIndeks && "(tačan)"}
            <div style={{ display: "flex", gap: 6 }}>
              <input value={o} onChange={(e) => setOdgovori((os) => os.map((x, idx) => (idx === i ? e.target.value : x)))} />
              <button type="button" className="small-action" onClick={() => setTacanIndeks(i)}>✓</button>
            </div>
          </label>
        ))}
      </div>
    </Modal>
  );
}

function NovaSesijaModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [naziv, setNaziv] = useState("");
  const [brojPitanja, setBrojPitanja] = useState(10);
  const [cuvaImena, setCuvaImena] = useState(true);
  const [greska, setGreska] = useState("");

  const posalji = async () => {
    try {
      await api("/provjera-znanja/sesije", { telo: { naziv, brojPitanja, cuvaImena } });
      onCreated();
      onClose();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Sesija nije sačuvana.");
    }
  };

  return (
    <Modal naslov="Nova sesija provjere znanja" onClose={onClose} greska={greska} footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={posalji} disabled={!naziv}>Otvori sesiju</button></>}>
      <div className="form-grid">
        <label style={{ gridColumn: "1 / -1" }}>Naziv<input value={naziv} onChange={(e) => setNaziv(e.target.value)} /></label>
        <label>Broj pitanja<input type="number" value={brojPitanja} onChange={(e) => setBrojPitanja(Number(e.target.value))} /></label>
        <label>
          Čuva imena
          <select value={cuvaImena ? "da" : "ne"} onChange={(e) => setCuvaImena(e.target.value === "da")}>
            <option value="da">Da</option>
            <option value="ne">Ne (anonimno)</option>
          </select>
        </label>
      </div>
    </Modal>
  );
}
