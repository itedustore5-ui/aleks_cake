import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Printer, CheckCircle2, XCircle } from "lucide-react";
import { api, ApiGreska } from "../lib/api";
import { Modal, ZakonskaOznaka, StampaZaglavlje } from "./Zajednicko";
import { StatusBadge } from "./StatusBadge";

type Sesija = {
  id: string;
  naziv: string;
  broj_pitanja: number;
  otvoren: boolean;
  cuva_imena: boolean;
  prag_prolaza: number;
  izvor_pitanja: "sva" | "firma" | "konsultant";
  broj_zavrsilo: number;
  broj_proslo: number;
  prosjek_posto: number | null;
  created_at: string;
};
type Rezultat = {
  id: string;
  sesija_id: string;
  sesija: string;
  prag_prolaza: number;
  sifra: string;
  ime: string | null;
  radno_mjesto: string | null;
  broj_tacnih: number;
  broj_pitanja: number;
  posto: number | null;
  prosao: boolean;
  zavrseno_at: string;
};
type PitanjeFirme = {
  id: string;
  tema: string;
  tekst: string;
  ponudjeni_odgovori: string[];
  tacan_indeks: number;
  aktivno: boolean;
  broj_odgovora: number;
  broj_tacnih: number;
};

const IZVOR_NAZIV = { sva: "Sva pitanja", firma: "Pitanja firme", konsultant: "Pitanja konsultanta" } as const;
const datum = (iso: string) => new Date(iso).toLocaleDateString("sr-Latn-ME");

/** Ljudi → Provjera znanja: termini sa prolaznošću, ko je radio i koji skor, i pitanja firme koja
 * unosi odgovorno lice. Konsultantova banka joj ostaje skrivena (invarijanta #14). */
export function ProvjeraZnanjaKartica({ verzija, onOsvjezi, pocetno }: { verzija: number; onOsvjezi: () => void; pocetno?: "rezultati" | "pitanja" }) {
  const navigate = useNavigate();
  const [pod, setPod] = useState<"rezultati" | "pitanja">(pocetno ?? "rezultati");
  const [sesije, setSesije] = useState<Sesija[]>([]);
  const [rezultati, setRezultati] = useState<Rezultat[]>([]);
  const [pitanja, setPitanja] = useState<PitanjeFirme[]>([]);
  const [filterSesija, setFilterSesija] = useState("");
  const [modalPitanje, setModalPitanje] = useState<PitanjeFirme | "novo" | null>(null);
  const [greska, setGreska] = useState("");

  const ucitaj = () => {
    api<Sesija[]>("/provjera-znanja/sesije").then(setSesije);
    api<Rezultat[]>("/provjera-znanja/rezultati").then(setRezultati);
    api<PitanjeFirme[]>("/pitanja-firme").then(setPitanja);
  };
  useEffect(ucitaj, [verzija]);

  const prikazaniRezultati = rezultati.filter((r) => !filterSesija || r.sesija_id === filterSesija);
  const aktivnaPitanja = pitanja.filter((p) => p.aktivno).length;
  const otvoreni = sesije.filter((s) => s.otvoren);

  return (
    <>
      <div className="panel no-print" style={{ minHeight: "auto", marginBottom: 14 }}>
        <div style={{ padding: 16 }}>
          <span className="meta-label">Kako zaposleni ulazi</span>
          <p style={{ fontSize: 12, margin: "4px 0 0" }}>
            Prijavljen <b>svojim nalogom</b>, sa svoje početne strane (Moja strana, Kontrolni centar): dok je termin otvoren, tamo
            stoji <b>„Uđi u provjeru znanja“</b>. Prije početka upisuje <b>svoju lozinku</b> — na zajedničkom telefonu niko ne može
            raditi provjeru umjesto drugoga. Šifra se za provjeru ne koristi. Zaposleni bez naloga ne može raditi provjeru — prvo mu otvorite nalog (Svi zaposleni → „Otvori nalog“).
          </p>
          <p style={{ fontSize: 12, margin: "6px 0 0" }}>
            {otvoreni.length > 0 ? (
              <>Otvoren termin: <b>{otvoreni.map((s) => s.naziv).join(", ")}</b> — zaposleni ga sada vide na svojoj strani.</>
            ) : (
              <b className="danas-fali">Nema otvorenog termina — dok ga ne otvorite (dugme „Otvori termin“ gore desno), niko ne može ući.</b>
            )}
          </p>
        </div>
      </div>
      <p className="muted-text no-print" style={{ fontSize: 11, marginBottom: 14, maxWidth: 720 }}>
        Pitanja dolaze iz dva izvora:
        <b> pitanja firme</b> unosite vi, o vašim procedurama; <b>pitanja konsultanta</b> ostaju skrivena i vama — ko zna pitanja unaprijed, provjera
        prestaje da mjeri znanje. Rezultati su dokaz da se provjera redovno sprovodi <ZakonskaOznaka clan="36" />, ne sertifikat.
      </p>
      {greska && <div className="auth-error no-print" style={{ marginBottom: 12 }}>{greska}</div>}

      <div className="filter-tabs no-print" style={{ marginBottom: 14 }}>
        <button className={pod === "rezultati" ? "selected" : ""} onClick={() => setPod("rezultati")}>Termini i rezultati</button>
        <button className={pod === "pitanja" ? "selected" : ""} onClick={() => setPod("pitanja")}>
          Pitanja firme <b>{aktivnaPitanja}</b>
        </button>
      </div>

      {pod === "rezultati" && (
        <>
          <div className="panel full-panel no-print" style={{ marginBottom: 20 }}>
            <div className="panel-header"><h2>Termini</h2></div>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Naziv</th><th>Pitanja</th><th>Prag</th><th>Završilo</th><th>Položilo</th><th>Prosjek</th><th>Status</th><th></th></tr>
                </thead>
                <tbody>
                  {sesije.map((s) => (
                    <tr key={s.id}>
                      <td>
                        {s.naziv}
                        <div className="muted-text" style={{ fontSize: 9 }}>{datum(s.created_at)} · {s.cuva_imena ? "sa imenima" : "anonimno"}</div>
                      </td>
                      <td className="muted-text">{s.broj_pitanja} · {IZVOR_NAZIV[s.izvor_pitanja] ?? s.izvor_pitanja}</td>
                      <td>{s.prag_prolaza} %</td>
                      <td>{s.broj_zavrsilo}</td>
                      <td>{s.broj_zavrsilo > 0 ? `${s.broj_proslo}/${s.broj_zavrsilo}` : "—"}</td>
                      <td>{s.prosjek_posto !== null ? `${s.prosjek_posto} %` : "—"}</td>
                      <td>{s.otvoren ? <StatusBadge status="VAZI" tekst="Otvoren" /> : <StatusBadge status="ISTEKLA" tekst="Zatvoren" />}</td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          {s.broj_zavrsilo > 0 && <button className="small-action" onClick={() => setFilterSesija(s.id)}>Rezultati</button>}
                          {s.otvoren && (
                            <button className="small-action" onClick={() => api(`/provjera-znanja/sesije/${s.id}/zatvori`, { method: "PATCH", telo: {} }).then(() => { ucitaj(); onOsvjezi(); })}>
                              Zatvori
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {sesije.length === 0 && <tr><td colSpan={8} className="muted-text" style={{ padding: 20 }}>Nema otvaranih termina — dugme „Otvori termin" gore desno.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <StampaZaglavlje
            naslov="Rezultati provjere znanja"
            filteri={[filterSesija ? `termin: ${sesije.find((s) => s.id === filterSesija)?.naziv}` : ""]}
            brojRedova={prikazaniRezultati.length}
          />
          <div className="panel full-panel">
            <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <h2>Ko je radio i koji je rezultat</h2>
              <div className="no-print" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <select className="zadatak-dodijeli" value={filterSesija} onChange={(e) => setFilterSesija(e.target.value)} aria-label="Termin">
                  <option value="">Svi termini</option>
                  {sesije.map((s) => <option key={s.id} value={s.id}>{s.naziv}</option>)}
                </select>
                <button className="small-action" onClick={() => window.print()} disabled={prikazaniRezultati.length === 0}>
                  <Printer size={12} /> Štampaj rezultate
                </button>
                <button className="small-action" onClick={() => navigate("/prilozi")}>Prilog 14</button>
              </div>
            </div>
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Zaposleni</th><th>Radno mjesto</th><th>Termin</th><th>Tačno</th><th>Skor</th><th>Prolaz</th><th>Datum</th></tr>
                </thead>
                <tbody>
                  {prikazaniRezultati.map((r) => (
                    <tr key={r.id}>
                      <td>{r.ime ?? <span className="muted-text">anonimno · {r.sifra}</span>}</td>
                      <td className="muted-text">{r.radno_mjesto ?? "—"}</td>
                      <td className="muted-text">{r.sesija}</td>
                      <td>{r.broj_tacnih}/{r.broj_pitanja}</td>
                      <td>
                        <div className="skor-traka" title={`${r.posto ?? 0} %`}>
                          <span className={r.prosao ? "prosao" : "pao"} style={{ width: `${r.posto ?? 0}%` }} />
                        </div>
                        <small>{r.posto ?? 0} %</small>
                      </td>
                      <td>
                        {r.prosao ? (
                          <span className="prolaz da"><CheckCircle2 size={12} /> Položeno</span>
                        ) : (
                          <span className="prolaz ne"><XCircle size={12} /> Nije položeno</span>
                        )}
                        <div className="muted-text" style={{ fontSize: 9 }}>prag {r.prag_prolaza} %</div>
                      </td>
                      <td className="muted-text">{datum(r.zavrseno_at)}</td>
                    </tr>
                  ))}
                  {prikazaniRezultati.length === 0 && <tr><td colSpan={7} className="muted-text" style={{ padding: 20 }}>Još niko nije završio provjeru.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {pod === "pitanja" && (
        <div className="panel full-panel">
          <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2>Pitanja firme</h2>
            <button className="small-action" onClick={() => setModalPitanje("novo")}><Plus size={12} /> Novo pitanje</button>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Tema</th><th>Pitanje</th><th>Tačan odgovor</th><th>Odgovorilo</th><th>Tačno</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {pitanja.map((p) => (
                  <tr key={p.id} style={!p.aktivno ? { opacity: 0.55 } : undefined}>
                    <td className="muted-text">{p.tema}</td>
                    <td>{p.tekst}</td>
                    <td>{p.ponudjeni_odgovori[p.tacan_indeks]}</td>
                    <td>{p.broj_odgovora}</td>
                    <td>{p.broj_odgovora > 0 ? `${Math.round((p.broj_tacnih * 100) / p.broj_odgovora)} %` : "—"}</td>
                    <td>{p.aktivno ? <StatusBadge status="VAZI" tekst="U upotrebi" /> : <StatusBadge status="ISTEKLA" tekst="Isključeno" />}</td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="small-action" onClick={() => setModalPitanje(p)} title={p.broj_odgovora > 0 ? "Već je korišćeno — čuva se nova verzija, stara ostaje u rezultatima" : undefined}>
                          Izmijeni
                        </button>
                        <button
                          className="small-action"
                          onClick={() =>
                            api(`/pitanja-firme/${p.id}`, { method: "PATCH", telo: { aktivno: !p.aktivno } })
                              .then(ucitaj)
                              .catch((e) => setGreska(e instanceof ApiGreska ? e.message : "Nije sačuvano."))
                          }
                        >
                          {p.aktivno ? "Isključi" : "Uključi"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {pitanja.length === 0 && (
                  <tr><td colSpan={7} className="muted-text" style={{ padding: 20 }}>Još nema pitanja firme. Unesite pitanja o vašim procedurama — npr. „Na kojoj temperaturi se čuva jogurt u komori 2?"</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modalPitanje && (
        <PitanjeModal pitanje={modalPitanje === "novo" ? undefined : modalPitanje} onClose={() => setModalPitanje(null)} onSacuvano={ucitaj} />
      )}
    </>
  );
}

function PitanjeModal({ pitanje, onClose, onSacuvano }: { pitanje?: PitanjeFirme; onClose: () => void; onSacuvano: () => void }) {
  const [tema, setTema] = useState(pitanje?.tema ?? "");
  const [tekst, setTekst] = useState(pitanje?.tekst ?? "");
  const [odgovori, setOdgovori] = useState<string[]>(pitanje?.ponudjeni_odgovori ?? ["", "", ""]);
  const [tacan, setTacan] = useState(pitanje?.tacan_indeks ?? 0);
  const [greska, setGreska] = useState("");

  const popunjeni = odgovori.map((o) => o.trim()).filter(Boolean);
  const validno = tema.trim().length >= 2 && tekst.trim().length >= 5 && popunjeni.length >= 2 && odgovori[tacan]?.trim();

  const posalji = async () => {
    // Prazna polja se izbacuju, a indeks tačnog se preračunava na ono što ostane.
    const cisti = odgovori.map((o, i) => ({ o: o.trim(), i })).filter((x) => x.o);
    const telo = { tema, tekst, ponudjeniOdgovori: cisti.map((x) => x.o), tacanIndeks: cisti.findIndex((x) => x.i === tacan) };
    try {
      // Pitanje na koje se već odgovaralo se ne prepravlja (rezultati bi pokazivali tuđe pitanje) —
      // čuva se kao NOVA VERZIJA, a staro se isključi i ostaje u rezultatima.
      if (pitanje && pitanje.broj_odgovora > 0) await api(`/pitanja-firme/${pitanje.id}/nova-verzija`, { telo });
      else if (pitanje) await api(`/pitanja-firme/${pitanje.id}`, { method: "PATCH", telo });
      else await api("/pitanja-firme", { telo });
      onSacuvano();
      onClose();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Pitanje nije sačuvano.");
    }
  };

  return (
    <Modal
      naslov={pitanje ? (pitanje.broj_odgovora > 0 ? "Nova verzija pitanja" : "Izmjena pitanja") : "Novo pitanje firme"}
      podnaslov={
        pitanje && pitanje.broj_odgovora > 0
          ? `Na ovo pitanje je odgovaralo ${pitanje.broj_odgovora} — staro ostaje u rezultatima (isključeno), od sada važi ova verzija.`
          : "Označite tačan odgovor kružićem"
      }
      onClose={onClose}
      greska={greska}
      footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={posalji} disabled={!validno}>Sačuvaj</button></>}
    >
      <div className="form-grid">
        <label>Tema<input value={tema} onChange={(e) => setTema(e.target.value)} placeholder="npr. Prijem robe" /></label>
        <label style={{ gridColumn: "1 / -1" }}>
          Pitanje
          <textarea rows={2} value={tekst} onChange={(e) => setTekst(e.target.value)} placeholder="npr. Šta radite ako je jogurt pri prijemu na 8 °C?" />
        </label>
        {odgovori.map((o, i) => (
          <label key={i} className="odgovor-red" style={{ gridColumn: "1 / -1" }}>
            <input type="radio" name="tacan" checked={tacan === i} onChange={() => setTacan(i)} aria-label={`Odgovor ${i + 1} je tačan`} />
            <input value={o} onChange={(e) => setOdgovori((sv) => sv.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Odgovor ${i + 1}`} />
          </label>
        ))}
        {odgovori.length < 6 && (
          <button type="button" className="link-button" style={{ gridColumn: "1 / -1", justifySelf: "start" }} onClick={() => setOdgovori((sv) => [...sv, ""])}>
            <Plus size={13} /> Još jedan odgovor
          </button>
        )}
      </div>
    </Modal>
  );
}
