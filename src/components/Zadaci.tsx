import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCircle2, ListTodo, Plus, Send } from "lucide-react";
import { api, ApiGreska } from "../lib/api";
import { useAuth, NAZIV_ULOGE, type Uloga } from "../lib/auth";
import { mozeNa, OBAVJESTENJA_PROMIJENJENA, OBAVJESTENJA_STIGLA } from "./Layout";
import { Modal } from "./Zajednicko";
import { lokalniDatum } from "../lib/vrijeme";

type Zadatak = {
  id: string;
  naslov: string;
  opis: string | null;
  status: string;
  prioritet: string;
  rok_at: string | null;
  izvor_tip: string | null;
  izvor_oznaka: string | null;
  dodijeljeno: string | null;
  dodijeljeno_korisnik_id: string | null;
  zakasnio: boolean;
};
type Izvrsilac = { id: string; ime: string; uloga: Uloga };
type Obavjestenje = {
  id: string;
  naslov: string;
  poruka: string | null;
  ozbiljnost: string;
  izvor_tip: string | null;
  posiljalac: string | null;
  posiljalac_korisnik_id?: string | null;
  procitano_at: string | null;
  created_at: string;
};

const IZVOR: Record<string, { putanja: string; naziv: string }> = {
  neusaglasenost: { putanja: "/neusaglasenosti", naziv: "neusaglašenost" },
  povlacenje: { putanja: "/sledljivost", naziv: "povlačenje" },
  isporuka: { putanja: "/isporuka", naziv: "isporuka" },
  prijem: { putanja: "/prijem", naziv: "prijem" },
  lot: { putanja: "/prijem", naziv: "prijem" },
  zadatak: { putanja: "/moja", naziv: "zadatak" },
  bekap_log: { putanja: "/tabla", naziv: "bekap" },
};

function putanjaIzvora(izvorTip: string | null, uloga: Uloga) {
  const izvor = izvorTip ? IZVOR[izvorTip] : undefined;
  return izvor && mozeNa(uloga, izvor.putanja) ? izvor.putanja : null;
}

/** `samoMoji`: Moja strana — dodijeljeni meni (a odgovornom licu i nedodijeljeni).
 * Bez toga: Kontrolni centar — svi otvoreni, da se vidi šta visi i kod koga. */
export function ListaZadataka({ samoMoji, naslov = "Moji zadaci" }: { samoMoji: boolean; naslov?: string }) {
  const { korisnik } = useAuth();
  const navigate = useNavigate();
  const [zadaci, setZadaci] = useState<Zadatak[] | null>(null);
  const [izvrsioci, setIzvrsioci] = useState<Izvrsilac[]>([]);
  const [greska, setGreska] = useState("");
  const [modalNovi, setModalNovi] = useState(false);
  const vodiSistem = korisnik?.uloga === "bzr" || korisnik?.uloga === "izvodjac";

  const ucitaj = () => api<Zadatak[]>(samoMoji ? "/zadaci?moji=1" : "/zadaci").then(setZadaci);

  useEffect(() => {
    ucitaj();
    if (vodiSistem) api<Izvrsilac[]>("/zadaci/izvrsioci").then(setIzvrsioci);
    const osvjezi = () => ucitaj();
    window.addEventListener(OBAVJESTENJA_STIGLA, osvjezi);
    return () => window.removeEventListener(OBAVJESTENJA_STIGLA, osvjezi);
  }, [samoMoji, vodiSistem]);

  const izmijeni = async (id: string, telo: { status?: string; dodijeljenoKorisnikId?: string | null }) => {
    setGreska("");
    try {
      await api(`/zadaci/${id}`, { method: "PATCH", telo });
      await ucitaj();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Zadatak nije sačuvan.");
    }
  };

  if (!korisnik) return null;

  return (
    <div className="panel table-panel">
      <div className="panel-header">
        <h2><ListTodo size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />{naslov}</h2>
        {vodiSistem && (
          <button className="small-action" onClick={() => setModalNovi(true)}>
            <Plus size={13} /> Novi zadatak
          </button>
        )}
      </div>
      <div className="task-list">
        {greska && <div className="auth-error" style={{ marginBottom: 8 }}>{greska}</div>}
        {zadaci?.length === 0 && (
          <p style={{ color: "#9aa5ae", fontSize: 11, padding: "0 0 10px" }}>
            {vodiSistem ? "Nema otvorenih zadataka." : "Nema zadataka dodijeljenih vama."}
          </p>
        )}
        {zadaci?.map((z) => {
          const putanja = putanjaIzvora(z.izvor_tip, korisnik.uloga);
          const smijeZatvoriti = vodiSistem || z.dodijeljeno_korisnik_id === korisnik.id;
          return (
            <div key={z.id} className="task-row">
              <span className={`task-check ${z.zakasnio || z.prioritet === "VISOK" ? "danger" : "warning"}`} />
              <div>
                <strong>{z.naslov}</strong>
                {z.opis && <span>{z.opis}</span>}
                <div className="zadatak-meta">
                  {putanja && (
                    <button className="zadatak-izvor" onClick={() => navigate(putanja)}>
                      {z.izvor_oznaka ?? IZVOR[z.izvor_tip!]?.naziv} →
                    </button>
                  )}
                  {z.rok_at && (
                    <span className={z.zakasnio ? "zadatak-kasni" : undefined}>
                      rok {new Date(z.rok_at).toLocaleDateString("sr-Latn-ME")}{z.zakasnio ? " — kasni" : ""}
                    </span>
                  )}
                  {vodiSistem ? (
                    <select
                      className="zadatak-dodijeli"
                      aria-label="Dodijeli zadatak"
                      value={z.dodijeljeno_korisnik_id ?? ""}
                      onChange={(e) => izmijeni(z.id, { dodijeljenoKorisnikId: e.target.value || null })}
                    >
                      <option value="">— nije dodijeljen —</option>
                      {izvrsioci.map((i) => (
                        <option key={i.id} value={i.id}>{i.ime} · {NAZIV_ULOGE[i.uloga]}</option>
                      ))}
                    </select>
                  ) : (
                    z.dodijeljeno && !samoMoji && <span>{z.dodijeljeno}</span>
                  )}
                </div>
              </div>
              {smijeZatvoriti && (
                <button className="row-action" title="Označi kao urađeno" aria-label="Označi kao urađeno" onClick={() => izmijeni(z.id, { status: "ZAVRSEN" })}>
                  <CheckCircle2 size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {modalNovi && <NoviZadatakModal izvrsioci={izvrsioci} onClose={() => setModalNovi(false)} onSacuvano={ucitaj} />}
    </div>
  );
}

/** Ručni zadatak — ono što ne nastaje samo iz sistema. Dodijeljena osoba dobija obavještenje. */
function NoviZadatakModal({ izvrsioci, onClose, onSacuvano }: { izvrsioci: Izvrsilac[]; onClose: () => void; onSacuvano: () => void }) {
  const [naslov, setNaslov] = useState("");
  const [opis, setOpis] = useState("");
  const [dodijeljeno, setDodijeljeno] = useState("");
  const [prioritet, setPrioritet] = useState("SREDNJI");
  const [rok, setRok] = useState("");
  const [greska, setGreska] = useState("");

  const posalji = async () => {
    try {
      await api("/zadaci", {
        telo: { naslov, opis: opis || undefined, dodijeljenoKorisnikId: dodijeljeno || null, prioritet, rok: rok || undefined },
      });
      onSacuvano();
      onClose();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Zadatak nije sačuvan.");
    }
  };

  return (
    <Modal
      naslov="Novi zadatak"
      onClose={onClose}
      greska={greska}
      footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={posalji} disabled={naslov.trim().length < 3}>Sačuvaj</button></>}
    >
      <div className="form-grid">
        <label style={{ gridColumn: "1 / -1" }}>Šta treba uraditi<input value={naslov} onChange={(e) => setNaslov(e.target.value)} placeholder="npr. Očistiti rashladnu komoru 2" /></label>
        <label style={{ gridColumn: "1 / -1" }}>Opis (opciono)<input value={opis} onChange={(e) => setOpis(e.target.value)} /></label>
        <label>
          Kome
          <select value={dodijeljeno} onChange={(e) => setDodijeljeno(e.target.value)}>
            <option value="">— nije dodijeljen —</option>
            {izvrsioci.map((i) => <option key={i.id} value={i.id}>{i.ime} · {NAZIV_ULOGE[i.uloga]}</option>)}
          </select>
        </label>
        <label>
          Prioritet
          <select value={prioritet} onChange={(e) => setPrioritet(e.target.value)}>
            <option value="NIZAK">Nizak</option>
            <option value="SREDNJI">Srednji</option>
            <option value="VISOK">Visok</option>
          </select>
        </label>
        <label>Rok (opciono)<input type="date" value={rok} min={lokalniDatum()} onChange={(e) => setRok(e.target.value)} /></label>
      </div>
    </Modal>
  );
}

export function ListaObavjestenja() {
  const { korisnik } = useAuth();
  const navigate = useNavigate();
  const [lista, setLista] = useState<Obavjestenje[] | null>(null);

  const ucitaj = () => api<Obavjestenje[]>("/obavjestenja").then(setLista);
  useEffect(() => {
    ucitaj();
    const osvjezi = () => ucitaj();
    window.addEventListener(OBAVJESTENJA_STIGLA, osvjezi);
    return () => window.removeEventListener(OBAVJESTENJA_STIGLA, osvjezi);
  }, []);

  const javiZvoncu = () => window.dispatchEvent(new Event(OBAVJESTENJA_PROMIJENJENA));

  const otvori = async (o: Obavjestenje, putanja: string | null) => {
    if (!o.procitano_at) {
      await api(`/obavjestenja/${o.id}/procitano`, { method: "PATCH" }).catch(() => {});
      javiZvoncu();
    }
    if (putanja) navigate(putanja);
    else ucitaj();
  };

  const oznaciSve = async () => {
    await api("/obavjestenja/procitano-sve", { method: "PATCH" });
    javiZvoncu();
    ucitaj();
  };

  if (!korisnik) return null;
  const neprocitana = lista?.filter((o) => !o.procitano_at).length ?? 0;
  const saljePoruke = mozeNa(korisnik.uloga, "/poruke");

  return (
    <div className="panel activity-panel">
      <div className="panel-header">
        <h2><Bell size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />Obavještenja</h2>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {neprocitana > 0 && <button className="small-action" onClick={oznaciSve}>Označi sve kao pročitano</button>}
          {saljePoruke && (
            <button className="small-action" onClick={() => navigate("/poruke")}>
              <Send size={12} /> Nova poruka
            </button>
          )}
        </div>
      </div>
      <div className="activity-list">
        {lista?.length === 0 && <p style={{ color: "#9aa5ae", fontSize: 11, padding: "14px 0" }}>Nema obavještenja.</p>}
        {lista?.map((o) => {
          const putanja = putanjaIzvora(o.izvor_tip, korisnik.uloga);
          const klikabilno = putanja !== null || !o.procitano_at;
          return (
            <div
              key={o.id}
              className={`activity-row${o.procitano_at ? "" : " neprocitano"}${klikabilno ? " klikabilno" : ""}`}
              role={klikabilno ? "button" : undefined}
              tabIndex={klikabilno ? 0 : undefined}
              onClick={klikabilno ? () => otvori(o, putanja) : undefined}
              onKeyDown={klikabilno ? (e) => e.key === "Enter" && otvori(o, putanja) : undefined}
            >
              <span className="activity-time">{new Date(o.created_at).toLocaleDateString("sr-Latn-ME")}</span>
              <div className={`activity-icon ${o.ozbiljnost === "VISOK" ? "danger" : o.ozbiljnost === "NIZAK" ? "info" : "warning"}`}><Bell size={12} /></div>
              <div>
                <strong>{o.naslov}</strong>
                {o.posiljalac && <span className="posiljalac">Poruka od: {o.posiljalac}</span>}
                {o.posiljalac_korisnik_id && o.posiljalac_korisnik_id !== korisnik.id && (
                  <button
                    className="link-button"
                    style={{ fontSize: 11, padding: 0 }}
                    onClick={(e) => { e.stopPropagation(); navigate("/poruke", { state: { odgovor: { korisnikId: o.posiljalac_korisnik_id, naslov: o.naslov } } }); }}
                  >
                    Odgovori
                  </button>
                )}
                {o.poruka && <p>{o.poruka}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
