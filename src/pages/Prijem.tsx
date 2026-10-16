import { Fragment, useEffect, useState } from "react";
import { Plus, ChevronDown, ChevronUp, FileText } from "lucide-react";
import { NoviPrijemModal, type ArtikalPrijema } from "../components/NoviPrijem";
import { api, ApiGreska, otvoriFajl } from "../lib/api";
import { useSlanje } from "../lib/slanje";
import { lokalniDatum } from "../lib/vrijeme";
import { PageHeader, Modal, ZakonskaOznaka, NaknadnoOznaka } from "../components/Zajednicko";
import { StatusBadge } from "../components/StatusBadge";
import { useAuth } from "../lib/auth";
import { useSkladista } from "../lib/skladista";

type Dobavljac = { id: string; naziv: string };
type Artikal = ArtikalPrijema;
type PrijemRed = {
  id: string;
  dobavljac_naziv: string;
  datum_prijema: string;
  broj_dokumenta: string | null;
  status: string;
  broj_stavki: number;
  naknadno_dana: number;
  skladiste_id: string | null;
  skladiste_naziv: string | null;
  ima_otpremnicu: boolean;
  odstupa_od_otpremnice: boolean;
};
type PoOtpremnici = { sifra?: string | null; naziv?: string | null; kolicina?: number | null; lot?: string | null; rok?: string | null };
type Stavka = {
  id: string;
  lot_id: string;
  artikal_naziv: string;
  broj_lota: string;
  lot_status: string;
  primljena_kolicina: string;
  rok_trajanja: string | null;
  temperatura_prijema: string | null;
  po_otpremnici: PoOtpremnici | null;
  temp_kontrolisano?: boolean;
  temp_rezultat?: string | null;
  temp_izmjereno?: string | null;
  temp_min?: string | null;
  temp_max?: string | null;
  temp_termometar?: string | null;
};

const citljivDatum = (iso: string) => `${iso.slice(0, 10).split("-").reverse().join(".")}.`;
/** Rok trajanja je prošao (po Podgorici — #11). Istekla roba se upisuje, ali se ne prihvata ni pušta (#38). */
const istekao = (s: { rok_trajanja: string | null }) => !!s.rok_trajanja && s.rok_trajanja.slice(0, 10) < lokalniDatum();

/** Temperatura pri prijemu (KKT 1) uz stavku — sa granicom i ocjenom, da odgovorno lice odlučuje znajući šta je izmjereno. */
function TemperaturaPrijema({ s }: { s: Stavka }) {
  const t = s.temp_izmjereno ?? s.temperatura_prijema;
  if (t === null || t === undefined || t === "") {
    return <span className="muted-text">{s.temp_kontrolisano ? "nije izmjereno" : "bez režima"}</span>;
  }
  const g = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v).toLocaleString("sr-Latn-ME"));
  const granica = g(s.temp_min) !== null || g(s.temp_max) !== null ? `${g(s.temp_min) ?? "—"} do ${g(s.temp_max) ?? "—"} °C` : null;
  const boja = s.temp_rezultat === "FAIL" ? "#c34e55" : s.temp_rezultat === "WARNING" ? "#bc7a1e" : "#1e7f55";
  const ocjena = s.temp_rezultat === "FAIL" ? "van granice" : s.temp_rezultat === "WARNING" ? "van pretpostavljene granice" : s.temp_rezultat === "PASS" ? "u granici" : null;
  return (
    <span>
      <b style={{ color: ocjena ? boja : undefined }}>{Number(t).toLocaleString("sr-Latn-ME")} °C</b>
      {ocjena && <span style={{ color: boja, fontSize: 10, fontWeight: 600 }}> · {ocjena}</span>}
      {(granica || s.temp_termometar) && (
        <div className="muted-text" style={{ fontSize: 10 }}>
          {granica ? `granica ${granica}` : ""}
          {granica && s.temp_termometar ? " · " : ""}
          {s.temp_termometar ? `termometar: ${s.temp_termometar}` : ""}
        </div>
      )}
    </span>
  );
}
type Dokument = { id: string; vrsta: "pdf" | "slika"; naziv_fajla: string | null };
type Detalj = { stavke: Stavka[]; dokumenti: Dokument[] };

export function Prijem() {
  const { korisnik } = useAuth();
  const skladista = useSkladista();
  const [filterSkladiste, setFilterSkladiste] = useState("");
  const [lista, setLista] = useState<PrijemRed[]>([]);
  const [dobavljaci, setDobavljaci] = useState<Dobavljac[]>([]);
  const [artikli, setArtikli] = useState<Artikal[]>([]);
  const [modalNovi, setModalNovi] = useState(false);
  const [modalIzmjena, setModalIzmjena] = useState<{ prijemId: string; stavka: Stavka } | null>(null);
  const [otvoren, setOtvoren] = useState<string | null>(null);
  const [stavke, setStavke] = useState<Record<string, Stavka[]>>({});
  const [dokumenti, setDokumenti] = useState<Record<string, Dokument[]>>({});
  const ucitajDetalj = async (id: string) => {
    const detalj = await api<Detalj>(`/prijem/${id}`);
    setStavke((s) => ({ ...s, [id]: detalj.stavke }));
    setDokumenti((d) => ({ ...d, [id]: detalj.dokumenti }));
  };
  const [greska, setGreska] = useState("");

  const ucitaj = () => api<PrijemRed[]>("/prijem").then(setLista);
  useEffect(() => {
    ucitaj();
    api<Dobavljac[]>("/dobavljaci").then(setDobavljaci);
    api<Artikal[]>("/artikli").then(setArtikli);
  }, []);

  const prosiri = async (id: string) => {
    if (otvoren === id) {
      setOtvoren(null);
      return;
    }
    setOtvoren(id);
    if (!stavke[id]) await ucitajDetalj(id);
  };

  const donesiOdluku = async (prijemId: string, lotId: string, odluka: "PRIHVATI" | "HOLD" | "ODBIJI", kolicina: number) => {
    let napomena: string | undefined;
    const stavka = stavke[prijemId]?.find((s) => s.lot_id === lotId);
    const izHolda = stavka?.lot_status === "HOLD";
    if (odluka === "ODBIJI" || izHolda) {
      // Istekla roba: razlog je već poznat — predlaže se, može se dopuniti.
      const predlog = stavka && istekao(stavka) ? `Istekao rok trajanja (${citljivDatum(stavka.rok_trajanja!)}) — povrat dobavljaču` : "";
      napomena = window.prompt(izHolda && odluka === "PRIHVATI" ? "Zašto se zadržana roba pušta (obavezno):" : "Razlog odbijanja (obavezno):", predlog) ?? undefined;
      if (!napomena) return;
    }
    try {
      await api(`/prijem/${prijemId}/lot/${lotId}/odluka`, { method: "PATCH", telo: { odluka, kolicina, napomena } });
      await ucitajDetalj(prijemId);
      ucitaj();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Odluka nije sačuvana.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const moguOdlucivati = korisnik?.uloga === "bzr" || korisnik?.uloga === "izvodjac";

  return (
    <>
      <PageHeader
        title="Prijem robe"
        description={<>Bez broja lota nema sledljivosti — svaka stavka mora imati lot <ZakonskaOznaka clan="27" />.</>}
        action={
          <button className="primary-button" onClick={() => setModalNovi(true)}>
            <Plus size={16} /> Novi prijem
          </button>
        }
      />
      {greska && <div className="auth-error" style={{ marginBottom: 16 }}>{greska}</div>}
      {skladista.vise && (
        <div className="filter-bar">
          <label>
            Magacin
            <select value={filterSkladiste} onChange={(e) => setFilterSkladiste(e.target.value)}>
              <option value="">Svi magacini</option>
              {skladista.sva.map((sk) => <option key={sk.id} value={sk.id}>{sk.naziv}</option>)}
            </select>
          </label>
        </div>
      )}

      <div className="panel full-panel">
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th></th>
                <th>Dobavljač</th>
                {skladista.vise && <th>Magacin</th>}
                <th>Datum</th>
                <th>Dokument</th>
                <th>Stavki</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {lista.filter((p) => !filterSkladiste || p.skladiste_id === filterSkladiste).map((p) => (
                <Fragment key={p.id}>
                  <tr style={{ cursor: "pointer" }} onClick={() => prosiri(p.id)}>
                    <td>{otvoren === p.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</td>
                    <td>{p.dobavljac_naziv}</td>
                    {skladista.vise && <td className="muted-text">{p.skladiste_naziv ?? "—"}</td>}
                    <td className="muted-text">{p.datum_prijema}<NaknadnoOznaka dana={p.naknadno_dana} /></td>
                    <td className="muted-text">
                      {p.broj_dokumenta ?? "—"}
                      {p.ima_otpremnicu && <FileText size={12} style={{ marginLeft: 6, verticalAlign: "-1px" }} aria-label="otpremnica uz prijem" />}
                      {p.odstupa_od_otpremnice && <span className="rok-oznaka istekao" style={{ marginLeft: 6 }}>odstupa od otpremnice</span>}
                    </td>
                    <td>{p.broj_stavki}</td>
                    <td><StatusBadge status={p.status} /></td>
                  </tr>
                  {otvoren === p.id && (
                    <tr>
                      <td colSpan={skladista.vise ? 7 : 6} style={{ background: "#fbfcfd", padding: 0 }}>
                        {(dokumenti[p.id] ?? []).length > 0 && (
                          <div style={{ display: "flex", gap: 8, padding: "10px 12px 0", flexWrap: "wrap" }}>
                            {dokumenti[p.id].map((d) => (
                              <button key={d.id} className="small-action" onClick={() => otvoriFajl(`/prijem/${p.id}/dokument/${d.id}`).catch((e) => setGreska(e.message))}>
                                <FileText size={12} /> Otpremnica{d.vrsta === "slika" ? " (slika)" : " (PDF)"}
                              </button>
                            ))}
                          </div>
                        )}
                        <table className="data-table" style={{ margin: "0 12px 12px" }}>
                          <thead>
                            <tr>
                              <th>Artikal</th>
                              <th>Lot <ZakonskaOznaka clan="27" /></th>
                              <th>Rok</th>
                              <th>Količina</th>
                              <th>Temperatura <ZakonskaOznaka clan="36" /></th>
                              <th>Status</th>
                              <th>Radnje</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(stavke[p.id] ?? []).map((s) => (
                              <tr key={s.id}>
                                <td>{s.artikal_naziv}</td>
                                <td>
                                  <code>{s.broj_lota}</code>
                                  {s.po_otpremnici?.lot && s.po_otpremnici.lot !== s.broj_lota && (
                                    <div className="danas-fali" style={{ fontSize: 10 }}>na otpremnici: {s.po_otpremnici.lot}</div>
                                  )}
                                </td>
                                <td className="muted-text">
                                  {s.rok_trajanja ?? "—"}
                                  {s.rok_trajanja && s.rok_trajanja < lokalniDatum() && <span className="rok-oznaka istekao" style={{ marginLeft: 6 }}>istekao</span>}
                                </td>
                                <td>
                                  {s.primljena_kolicina}
                                  {s.po_otpremnici?.kolicina != null && Number(s.po_otpremnici.kolicina) !== Number(s.primljena_kolicina) && (
                                    <div className="danas-fali" style={{ fontSize: 10 }}>
                                      po otpremnici {s.po_otpremnici.kolicina} · {Number(s.primljena_kolicina) < Number(s.po_otpremnici.kolicina) ? "manjak" : "višak"}{" "}
                                      {Math.abs(Number(s.po_otpremnici.kolicina) - Number(s.primljena_kolicina))}
                                    </div>
                                  )}
                                </td>
                                <td><TemperaturaPrijema s={s} /></td>
                                <td><StatusBadge status={s.lot_status} /></td>
                                <td>
                                  {s.lot_status === "PRIMLJEN" ? (
                                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                      <button className="small-action" onClick={() => setModalIzmjena({ prijemId: p.id, stavka: s })}>Izmijeni</button>
                                      {moguOdlucivati && !istekao(s) && (
                                        <>
                                          <button className="small-action" onClick={() => donesiOdluku(p.id, s.lot_id, "PRIHVATI", Number(s.primljena_kolicina))}>Prihvati</button>
                                          <button className="small-action" onClick={() => donesiOdluku(p.id, s.lot_id, "HOLD", Number(s.primljena_kolicina))}>Hold</button>
                                          <button className="small-action" onClick={() => donesiOdluku(p.id, s.lot_id, "ODBIJI", Number(s.primljena_kolicina))}>Odbij</button>
                                        </>
                                      )}
                                      {/* Istekla roba se ne prihvata (#38): odbija se, a ako je rok pogrešno ukucan — „Izmijeni“. */}
                                      {moguOdlucivati && istekao(s) && (
                                        <>
                                          <button className="small-action odstupanje-dugme" onClick={() => donesiOdluku(p.id, s.lot_id, "ODBIJI", Number(s.primljena_kolicina))}>
                                            Odbij — istekao rok
                                          </button>
                                          <span className="muted-text" style={{ fontSize: 10, flexBasis: "100%" }}>Rok pogrešno ukucan? „Izmijeni“ pa prihvatite.</span>
                                        </>
                                      )}
                                    </div>
                                  ) : s.lot_status === "HOLD" && moguOdlucivati ? (
                                    <div style={{ display: "flex", gap: 6 }}>
                                      {!istekao(s) && <button className="small-action" onClick={() => donesiOdluku(p.id, s.lot_id, "PRIHVATI", Number(s.primljena_kolicina))}>Pusti</button>}
                                      <button className="small-action" onClick={() => donesiOdluku(p.id, s.lot_id, "ODBIJI", Number(s.primljena_kolicina))}>{istekao(s) ? "Odbij — istekao rok" : "Odbij"}</button>
                                    </div>
                                  ) : (
                                    <span className="muted-text">Odlučeno</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modalNovi && (
        <NoviPrijemModal
          dobavljaci={dobavljaci}
          mozeNovogDobavljaca={moguOdlucivati}
          artikli={artikli}
          skladista={skladista.vise ? skladista.aktivna : []}
          podrazumijevanoSkladiste={skladista.podrazumijevano}
          onClose={() => setModalNovi(false)}
          onCreated={ucitaj}
        />
      )}
      {modalIzmjena && (
        <IzmjenaStavkeModal
          prijemId={modalIzmjena.prijemId}
          stavka={modalIzmjena.stavka}
          onClose={() => setModalIzmjena(null)}
          onSacuvano={() => ucitajDetalj(modalIzmjena.prijemId)}
        />
      )}
    </>
  );
}

function IzmjenaStavkeModal({ prijemId, stavka, onClose, onSacuvano }: { prijemId: string; stavka: Stavka; onClose: () => void; onSacuvano: () => void }) {
  const [brojLota, setBrojLota] = useState(stavka.broj_lota);
  const [rokTrajanja, setRokTrajanja] = useState(stavka.rok_trajanja ?? "");
  const [primljenaKolicina, setPrimljenaKolicina] = useState(stavka.primljena_kolicina);
  const [temperaturaPrijema, setTemperaturaPrijema] = useState(stavka.temperatura_prijema ?? "");
  const [greska, setGreska] = useState("");

  const { radim, salji } = useSlanje();
  const posalji = async () => {
    try {
      await api(`/prijem/${prijemId}/lot/${stavka.lot_id}`, {
        method: "PATCH",
        telo: {
          brojLota,
          rokTrajanja: rokTrajanja || undefined,
          primljenaKolicina: Number(primljenaKolicina),
          temperaturaPrijema: temperaturaPrijema ? Number(temperaturaPrijema) : undefined,
        },
      });
      await onSacuvano();
      onClose();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Izmjene nisu sačuvane.");
    }
  };

  return (
    <Modal naslov={`Izmjena — ${stavka.artikal_naziv}`} podnaslov="Dok se ne donese odluka" onClose={onClose} greska={greska} footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={() => salji(posalji)} disabled={radim || !brojLota.trim() || Number(primljenaKolicina) <= 0}>Sačuvaj</button></>}>
      <div className="form-grid">
        <label>Broj lota <ZakonskaOznaka clan="27" /><input value={brojLota} onChange={(e) => setBrojLota(e.target.value)} /></label>
        <label>Rok trajanja<input type="date" value={rokTrajanja} onChange={(e) => setRokTrajanja(e.target.value)} /></label>
        <label>Količina<input type="number" value={primljenaKolicina} onChange={(e) => setPrimljenaKolicina(e.target.value)} /></label>
        <label>Temperatura pri prijemu (°C) <ZakonskaOznaka clan="36" /><input type="number" step="0.1" value={temperaturaPrijema} onChange={(e) => setTemperaturaPrijema(e.target.value)} /></label>
      </div>
    </Modal>
  );
}
