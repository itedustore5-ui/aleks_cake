import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { Search, Truck, PackageCheck, User, Warehouse, Printer, AlertTriangle } from "lucide-react";
import { api, ApiGreska } from "../lib/api";
import { PageHeader, Modal, ZakonskaOznaka } from "../components/Zajednicko";
import { StatusBadge } from "../components/StatusBadge";
import { useAuth } from "../lib/auth";

type Red = {
  dobavljac: string;
  broj_dokumenta: string | null;
  datum_prijema: string;
  lot_id: string;
  broj_lota: string;
  rok_trajanja: string | null;
  artikal: string;
  lot_status: string;
  isporuka_broj: string | null;
  datum_isporuke: string | null;
  kupac: string | null;
  kupac_telefon: string | null;
  isporuka_status: string | null;
};

type PovlacenjeRed = { id: string; broj: string; artikal_naziv: string; broj_lota: string; status: string; pokrenuto_at: string; broj_kontakata: string; broj_kontaktiranih: string };
type Kontakt = { id: string; kupac_naziv: string; kupac_telefon: string; kolicina: string | null; kontaktiran: boolean; napomena: string | null };
type PovlacenjeDetalj = PovlacenjeRed & { razlog: string; kontakti: Kontakt[] };

export function Sledljivost() {
  const { korisnik } = useAuth();
  const [tekst, setTekst] = useState("");
  const [rezultati, setRezultati] = useState<Red[]>([]);
  const [pretrazeno, setPretrazeno] = useState(false);
  const [povlacenja, setPovlacenja] = useState<PovlacenjeRed[]>([]);
  const [modalPovlacenje, setModalPovlacenje] = useState<Red | null>(null);
  const [otvorenoPovlacenje, setOtvorenoPovlacenje] = useState<PovlacenjeDetalj | null>(null);

  const mozeUpravljatiPovlacenjem = korisnik?.uloga === "bzr" || korisnik?.uloga === "izvodjac";
  // Uprava vidi povlačenja (dolazi sa kartice "Povlačenja u toku"), ali ih ne pokreće i ne zatvara.
  const vidiPovlacenja = mozeUpravljatiPovlacenjem || korisnik?.uloga === "uprava";

  const ucitajPovlacenja = () => api<PovlacenjeRed[]>("/povlacenja").then(setPovlacenja);
  useEffect(() => {
    if (vidiPovlacenja) ucitajPovlacenja();
  }, []);

  const pretrazi = async (e: FormEvent) => {
    e.preventDefault();
    if (tekst.trim().length < 2) return;
    const r = await api<Red[]>(`/sledljivost/pretraga?q=${encodeURIComponent(tekst.trim())}`);
    setRezultati(r);
    setPretrazeno(true);
  };

  const otvoriPovlacenje = async (id: string) => {
    const detalj = await api<PovlacenjeDetalj>(`/povlacenja/${id}`);
    setOtvorenoPovlacenje(detalj);
  };
  // Sa neusaglašenosti „pokrenuto povlačenje“ dolazi se pravo na to povlačenje.
  const location = useLocation();
  const traziPovlacenje = (location.state as { povlacenjeId?: string } | null)?.povlacenjeId;
  useEffect(() => {
    if (traziPovlacenje && vidiPovlacenja) otvoriPovlacenje(traziPovlacenje).catch(() => undefined);
  }, [traziPovlacenje]);

  return (
    <>
      <div className="no-print">
        <PageHeader title="Sledljivost" description="Pretraga po broju lota, dobavljaču, kupcu, dokumentu ili broju isporuke." />
        <div className="panel trace-search">
          <div className="trace-search-copy">
            <div className="trace-icon"><Search size={17} /></div>
            <div>
              <h2>Pretraga lanca sledljivosti</h2>
              <p>Npr. broj lota kao MLJ-2609-A, naziv kupca ili dobavljača.</p>
            </div>
          </div>
          <form className="trace-search-form" onSubmit={pretrazi}>
            <div className="search-field wide">
              <Search size={14} />
              <input value={tekst} onChange={(e) => setTekst(e.target.value)} placeholder="Unesite pojam za pretragu..." />
            </div>
            <button className="primary-button" type="submit">Pretraži</button>
          </form>
        </div>

        {pretrazeno && rezultati.length === 0 && <p style={{ fontSize: 12, color: "#9aa5ae" }}>Nema rezultata za "{tekst}".</p>}
      </div>

      {rezultati.map((r) => (
        <div key={`${r.lot_id}-${r.isporuka_broj ?? ""}`} className="panel" style={{ marginBottom: 14 }}>
          <div className="trace-chain">
            <div className="trace-chain-head" style={{ justifyContent: "space-between" }}>
              <div>
                <strong>{r.artikal} · {r.broj_lota}</strong>
                <p>Rok trajanja: {r.rok_trajanja ?? "—"} · <StatusBadge status={r.lot_status} /></p>
              </div>
              <div className="no-print" style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
                <button className="secondary-button" onClick={() => window.print()}><Printer size={14} /> Štampaj</button>
                {mozeUpravljatiPovlacenjem && (
                  <button className="secondary-button" onClick={() => setModalPovlacenje(r)} style={{ color: "#c34e55" }}>
                    <AlertTriangle size={14} /> Pokreni povlačenje
                  </button>
                )}
              </div>
            </div>
            <div className="chain-flow">
              <ChainNode ikonica={<Warehouse size={14} />} oznaka="Dobavljač" naziv={r.dobavljac} />
              <div className="chain-line">→</div>
              <ChainNode ikonica={<PackageCheck size={14} />} oznaka="Prijem" naziv={r.datum_prijema} podnaziv={r.broj_dokumenta ?? undefined} />
              <div className="chain-line">→</div>
              <ChainNode ikonica={<Truck size={14} />} oznaka="Lot" naziv={r.broj_lota} highlight />
              {r.isporuka_broj && (
                <>
                  <div className="chain-line">→</div>
                  <ChainNode ikonica={<PackageCheck size={14} />} oznaka="Isporuka" naziv={r.isporuka_broj} podnaziv={r.datum_isporuke ?? undefined} />
                  <div className="chain-line">→</div>
                  <ChainNode ikonica={<User size={14} />} oznaka="Kupac" naziv={r.kupac ?? ""} podnaziv={r.kupac_telefon ?? undefined} />
                </>
              )}
            </div>
          </div>
        </div>
      ))}

      {vidiPovlacenja && (
        <div className="no-print">
          <div className="section-heading" style={{ marginTop: 26 }}>
            <div>
              <h2><AlertTriangle size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />Povlačenja</h2>
              <span>Ko je dobio spornu seriju i da li je zvan — počinje telefonom (čl. 28).</span>
            </div>
          </div>
          <div className="panel full-panel">
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Broj</th>
                    <th>Artikal / lot</th>
                    <th>Pokrenuto</th>
                    <th>Kontaktirano</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {povlacenja.map((p) => (
                    <tr key={p.id}>
                      <td>{p.broj}</td>
                      <td>{p.artikal_naziv} · <code>{p.broj_lota}</code></td>
                      <td className="muted-text">{new Date(p.pokrenuto_at).toLocaleString("sr-Latn-ME")}</td>
                      <td>{p.broj_kontaktiranih} / {p.broj_kontakata}</td>
                      <td><StatusBadge status={p.status === "ZAVRSENO" ? "ZATVORENA" : "OTVORENA"} tekst={p.status === "ZAVRSENO" ? "Završeno" : "U toku"} /></td>
                      <td><button className="small-action" onClick={() => otvoriPovlacenje(p.id)}>Otvori</button></td>
                    </tr>
                  ))}
                  {povlacenja.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted-text" style={{ textAlign: "center", padding: 20 }}>Nema pokrenutih povlačenja.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {modalPovlacenje && (
        <PokreniPovlacenjeModal
          lot={modalPovlacenje}
          onClose={() => setModalPovlacenje(null)}
          onPokrenuto={() => {
            ucitajPovlacenja();
          }}
        />
      )}
      {otvorenoPovlacenje && (
        <PovlacenjeDetaljModal
          povlacenje={otvorenoPovlacenje}
          samoCitanje={!mozeUpravljatiPovlacenjem}
          onClose={() => setOtvorenoPovlacenje(null)}
          onOsvjezi={() => otvoriPovlacenje(otvorenoPovlacenje.id).then(ucitajPovlacenja)}
        />
      )}
    </>
  );
}

function ChainNode({ ikonica, oznaka, naziv, podnaziv, highlight }: { ikonica: React.ReactNode; oznaka: string; naziv: string; podnaziv?: string; highlight?: boolean }) {
  return (
    <div className="chain-node-wrap">
      <div className={`chain-node ${highlight ? "highlight" : ""}`}>
        <div className="chain-node-icon">{ikonica}</div>
        <span>{oznaka}</span>
        <strong>{naziv}</strong>
        {podnaziv && <small>{podnaziv}</small>}
      </div>
    </div>
  );
}

function PokreniPovlacenjeModal({ lot, onClose, onPokrenuto }: { lot: Red; onClose: () => void; onPokrenuto: () => void }) {
  const [razlog, setRazlog] = useState("");
  const [greska, setGreska] = useState("");
  const [rezultat, setRezultat] = useState<{ broj: string; brojKontakata: number } | null>(null);

  const posalji = async () => {
    try {
      const r = await api<{ broj: string; brojKontakata: number }>(`/sledljivost/lot/${lot.lot_id}/povlacenje`, { telo: { razlog } });
      setRezultat(r);
      onPokrenuto();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Povlačenje nije pokrenuto.");
    }
  };

  if (rezultat) {
    return (
      <Modal naslov="Povlačenje je pokrenuto" onClose={onClose} footer={<button className="primary-button" onClick={onClose}>U redu</button>}>
        <div style={{ padding: 20 }}>
          <p style={{ fontSize: 12, color: "#556774" }}>
            <strong>{rezultat.broj}</strong> — otvoreno {rezultat.brojKontakata} {rezultat.brojKontakata === 1 ? "kontakt" : "kontakata"} za pozivanje. Otvorite spisak u sekciji "Povlačenja" i obavijestite kupce telefonom.
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      naslov={`Pokreni povlačenje — ${lot.artikal} · ${lot.broj_lota}`}
      podnaslov="Povlačenje počinje telefonom (čl. 28)"
      onClose={onClose}
      greska={greska}
      footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={posalji} disabled={razlog.trim().length < 3}>Pokreni</button></>}
    >
      <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
        <label>
          Razlog povlačenja
          <input value={razlog} onChange={(e) => setRazlog(e.target.value)} placeholder="npr. temperatura van opsega pri prijemu, sumnja na kontaminaciju..." />
        </label>
      </div>
    </Modal>
  );
}

function PovlacenjeDetaljModal({ povlacenje, samoCitanje, onClose, onOsvjezi }: { povlacenje: PovlacenjeDetalj; samoCitanje: boolean; onClose: () => void; onOsvjezi: () => void }) {
  const [greska, setGreska] = useState("");

  const oznaciKontaktiran = async (kontaktId: string) => {
    try {
      await api(`/povlacenja/${povlacenje.id}/kontakt/${kontaktId}`, { method: "PATCH", telo: {} });
      onOsvjezi();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Nije sačuvano.");
    }
  };

  const zatvori = async () => {
    try {
      await api(`/povlacenja/${povlacenje.id}/zavrsi`, { method: "PATCH", telo: {} });
      onOsvjezi();
      onClose();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Povlačenje nije zatvoreno.");
    }
  };

  const sviKontaktirani = povlacenje.kontakti.every((k) => k.kontaktiran);

  return (
    <Modal
      naslov={povlacenje.broj}
      podnaslov={`${povlacenje.artikal_naziv} · ${povlacenje.broj_lota}`}
      onClose={onClose}
      greska={greska}
      footer={
        povlacenje.status === "U_TOKU" && !samoCitanje ? (
          <><button className="secondary-button" onClick={onClose}>Zatvori prozor</button><button className="primary-button" onClick={zatvori} disabled={!sviKontaktirani}>Zatvori povlačenje</button></>
        ) : (
          <button className="primary-button" onClick={onClose}>Zatvori prozor</button>
        )
      }
    >
      <div style={{ padding: "0 20px 16px" }}>
        <p style={{ fontSize: 12, color: "#556774" }}>{povlacenje.razlog}</p>
      </div>
      <div className="no-print" style={{ padding: "0 20px 8px", display: "flex", justifyContent: "flex-end" }}>
        <button className="secondary-button" onClick={() => window.print()}><Printer size={14} /> Štampaj spisak</button>
      </div>
      <div style={{ padding: "0 20px 20px" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Kupac</th>
              <th>Telefon <ZakonskaOznaka clan="28" /></th>
              <th>Količina</th>
              <th>Kontaktiran</th>
              <th className="no-print"></th>
            </tr>
          </thead>
          <tbody>
            {povlacenje.kontakti.map((k) => (
              <tr key={k.id}>
                <td>{k.kupac_naziv}</td>
                <td>{k.kupac_telefon}</td>
                <td className="muted-text">{k.kolicina ?? "—"}</td>
                <td>{k.kontaktiran ? <StatusBadge status="VAZI" tekst="Da" /> : <StatusBadge status="OTVORENA" tekst="Ne" />}</td>
                <td className="no-print">
                  {!k.kontaktiran && !samoCitanje && <button className="small-action" onClick={() => oznaciKontaktiran(k.id)}>Označi zvano</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
