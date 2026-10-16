import { useEffect, useState } from "react";
import { Plus, Truck, ClipboardList } from "lucide-react";
import { api, ApiGreska } from "../lib/api";
import { useSlanje, noviKljuc } from "../lib/slanje";
import { upisiIliSacuvaj, useIzlaz, IZLAZ_POSLAT } from "../lib/izlaz";
import { SacuvanoNaTelefonu } from "../components/VanMreze";
import { PageHeader, Modal, VanMrezeOznaka } from "../components/Zajednicko";
import { StatusBadge } from "../components/StatusBadge";
import { useAuth } from "../lib/auth";
import { lokalniDatum } from "../lib/vrijeme";

type Vozilo = {
  id: string;
  registarski_broj: string;
  tip: string | null;
  status: string;
  temp_kontrolisano: boolean;
  temp_min: string | null;
  temp_max: string | null;
  /** Ishod današnje kontrole (D1) — null ako danas nije rađena. */
  d1_danas: string | null;
  /** Vozilo ima današnju isporuku — tek tada se D1 traži (prije utovara). */
  vozi_danas?: boolean;
};
type Kontrola = {
  id: string;
  van_mreze?: boolean;
  vozilo_id: string;
  registarski_broj: string;
  izvrsio: string | null;
  izvrsio_korisnik_id: string | null;
  izvrseno_at: string;
  datum: string;
  cistoca: boolean;
  oprema_ok: boolean;
  vrata_ok: boolean;
  temperatura: string | null;
  granica_min: string | null;
  granica_max: string | null;
  temperatura_ok: boolean | null;
  ukupan_status: string;
  napomena: string | null;
};

const rezim = (min: string | null, max: string | null) => (min === null && max === null ? null : `${min === null ? "—" : Number(min)} – ${max === null ? "—" : Number(max)} °C`);

const sat = (iso: string) => new Date(iso).toLocaleTimeString("sr-Latn-ME", { hour: "2-digit", minute: "2-digit" });
const datumIVrijeme = (iso: string) => `${new Date(iso).toLocaleDateString("sr-Latn-ME")} ${sat(iso)}`;

export function Vozila() {
  const { korisnik } = useAuth();
  const [vozila, setVozila] = useState<Vozilo[]>([]);
  const [kontrole, setKontrole] = useState<Kontrola[]>([]);
  const [modalKontrola, setModalKontrola] = useState<Vozilo | null>(null);
  const [modalVozilo, setModalVozilo] = useState<Vozilo | "novo" | null>(null);
  const [filterVozilo, setFilterVozilo] = useState("");
  const [filterDatum, setFilterDatum] = useState("");
  const [filterRezultat, setFilterRezultat] = useState("");
  const [samoMoje, setSamoMoje] = useState(false);

  const izlaz = useIzlaz();
  const ucitaj = () => {
    api<Vozilo[]>("/vozila").then(setVozila);
    api<Kontrola[]>("/kontrole-vozila").then(setKontrole);
  };
  useEffect(() => {
    ucitaj();
    // D1 koja je čekala na telefonu je stigla — status vozila se mijenja.
    window.addEventListener(IZLAZ_POSLAT, ucitaj);
    return () => window.removeEventListener(IZLAZ_POSLAT, ucitaj);
  }, []);

  const danas = lokalniDatum();
  // Lista je sortirana od najnovije — prva kontrola za vozilo je posljednja urađena.
  const posljednja = (voziloId: string) => kontrole.find((k) => k.vozilo_id === voziloId);
  const prikazano = kontrole.filter(
    (k) =>
      (!filterVozilo || k.vozilo_id === filterVozilo) &&
      (!filterDatum || k.datum === filterDatum) &&
      (!filterRezultat || k.ukupan_status === filterRezultat) &&
      (!samoMoje || k.izvrsio_korisnik_id === korisnik?.id),
  );
  const imaFiltera = filterVozilo || filterDatum || filterRezultat || samoMoje;
  const vodiSistem = korisnik?.uloga === "bzr" || korisnik?.uloga === "izvodjac";
  // D1 upisuju vozač, odgovorno lice i konsultant (invarijanta #24).
  const mozeD1 = vodiSistem || korisnik?.uloga === "vozac";

  return (
    <>
      <PageHeader
        title="Vozila"
        description="Vozilo je spremno samo za dan u kom je kontrola (D1) prošla. Pala kontrola blokira isporuku tim vozilom dok nova ne prođe."
        action={
          vodiSistem && (
            <button className="primary-button" onClick={() => setModalVozilo("novo")}>
              <Plus size={16} /> Novo vozilo
            </button>
          )
        }
      />
      <div className="vehicle-grid">
        {vozila.map((v) => (
          <div key={v.id} className={`vehicle-card ${v.status === "NIJE_SPREMNO" ? "danger" : v.d1_danas === "PROSAO" ? "success" : v.vozi_danas === false ? "" : "warning"}`}>
            <div className="vehicle-top">
              <div className="vehicle-symbol"><Truck size={16} /></div>
            </div>
            <h3>{v.registarski_broj}</h3>
            <div className="vehicle-type">
              {v.tip ?? "Vozilo"}
              {v.temp_kontrolisano && <><span>·</span>rashladno {rezim(v.temp_min, v.temp_max) ?? <b style={{ color: "#d95d64" }}>granica nije upisana</b>}</>}
            </div>
            <div className="vehicle-divider" />
            <div className="vehicle-meta">
              <div>
                <span>Status</span>
                <strong className={v.status === "NIJE_SPREMNO" ? "kontrola-nema" : v.d1_danas === "PROSAO" ? "kontrola-danas" : v.vozi_danas === false ? "muted-text" : "kontrola-stara"}>
                  {v.status === "NIJE_SPREMNO"
                    ? "Nije spremno — nova D1 mora proći"
                    : v.d1_danas === "PROSAO"
                      ? "Spremno danas"
                      : v.vozi_danas === false
                        ? "Danas ne vozi — D1 nije potrebna"
                        : "Danas vozi — čeka D1 prije utovara"}
                </strong>
                {izlaz.ceka(`vozilo:${v.id}`) && <span className="ceka-mrezu" style={{ marginTop: 4 }}>D1 je na telefonu — čeka mrežu</span>}
              </div>
              <div>
                <span>Posljednja kontrola</span>
                {(() => {
                  const k = posljednja(v.id);
                  if (!k) return <strong className="kontrola-nema">nije rađena</strong>;
                  return (
                    <strong className={k.datum === danas ? "kontrola-danas" : "kontrola-stara"}>
                      {k.datum === danas ? `danas u ${sat(k.izvrseno_at)}` : datumIVrijeme(k.izvrseno_at)} · {k.izvrsio ?? "—"}
                    </strong>
                  );
                })()}
              </div>
            </div>
            {mozeD1 && <button className="secondary-button full-width" onClick={() => setModalKontrola(v)}>Nova kontrola (D1)</button>}
            {vodiSistem && <button className="link-button" style={{ marginTop: 8 }} onClick={() => setModalVozilo(v)}>Izmijeni vozilo</button>}
          </div>
        ))}
      </div>

      <div className="section-heading" style={{ marginTop: 26 }}>
        <div>
          <h2><ClipboardList size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />Evidencija kontrola (D1)</h2>
          <span>Svaka kontrola ostaje zapisana — ne može se mijenjati ni brisati.</span>
        </div>
      </div>
      <div className="filter-bar">
        <label>
          Vozilo
          <select value={filterVozilo} onChange={(e) => setFilterVozilo(e.target.value)}>
            <option value="">Sva vozila</option>
            {vozila.map((v) => <option key={v.id} value={v.id}>{v.registarski_broj}</option>)}
          </select>
        </label>
        <label>
          Datum
          <input type="date" value={filterDatum} onChange={(e) => setFilterDatum(e.target.value)} />
        </label>
        <button className={`small-action${filterDatum === danas ? " selected" : ""}`} onClick={() => setFilterDatum(danas)}>Danas</button>
        <label>
          Rezultat
          <select value={filterRezultat} onChange={(e) => setFilterRezultat(e.target.value)}>
            <option value="">Svi</option>
            <option value="PROSAO">Prošao</option>
            <option value="NIJE_PROSAO">Nije prošao</option>
          </select>
        </label>
        <label className="filter-potvrda">
          <input type="checkbox" checked={samoMoje} onChange={(e) => setSamoMoje(e.target.checked)} /> Samo moje kontrole
        </label>
        {imaFiltera && (
          <button className="link-button" onClick={() => { setFilterVozilo(""); setFilterDatum(""); setFilterRezultat(""); setSamoMoje(false); }}>
            Poništi filtere
          </button>
        )}
        <span className="filter-broj">{prikazano.length} od {kontrole.length}</span>
      </div>
      {/* Na telefonu kartice umjesto tabele od 8 kolona — rezultat mora biti vidljiv bez skrolovanja u stranu. */}
      <div className="panel kontrole-kartice">
        {prikazano.length === 0 && <p className="muted-text" style={{ fontSize: 11, padding: 16 }}>{imaFiltera ? "Nema kontrola za izabrane filtere." : "Nema zabilježenih kontrola."}</p>}
        {prikazano.map((k) => {
          const pali = [!k.cistoca && "čistoća", !k.oprema_ok && "oprema", !k.vrata_ok && "vrata", k.temperatura_ok === false && `temperatura (granica ${rezim(k.granica_min, k.granica_max)})`].filter(Boolean);
          return (
            <div key={k.id} className="danas-red">
              <div>
                <strong>{k.registarski_broj} <StatusBadge status={k.ukupan_status} /></strong>
                <span>{datumIVrijeme(k.izvrseno_at)} · {k.izvrsio ?? "—"}{k.temperatura !== null ? ` · ${Number(k.temperatura)} °C` : ""}<VanMrezeOznaka da={k.van_mreze} /></span>
                {pali.length > 0 && <span className="danas-fali">Nije u redu: {pali.join(", ")}</span>}
                {k.napomena && <span>{k.napomena}</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="panel full-panel kontrole-tabela">
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Vozilo</th>
                <th>Vrijeme</th>
                <th>Čistoća</th>
                <th>Oprema</th>
                <th>Vrata</th>
                <th>Temperatura</th>
                <th>Izvršio</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {prikazano.map((k) => (
                <tr key={k.id}>
                  <td>{k.registarski_broj}</td>
                  <td className="muted-text">{datumIVrijeme(k.izvrseno_at)}<VanMrezeOznaka da={k.van_mreze} /></td>
                  <td>{k.cistoca ? "Da" : "Ne"}</td>
                  <td>{k.oprema_ok ? "Da" : "Ne"}</td>
                  <td>{k.vrata_ok ? "Da" : "Ne"}</td>
                  <td className="muted-text" style={k.temperatura_ok === false ? { color: "#c34e55", fontWeight: 600 } : undefined}>
                    {k.temperatura !== null ? `${Number(k.temperatura)} °C` : "—"}
                    {k.granica_min !== null || k.granica_max !== null ? <span className="muted-text"> ({rezim(k.granica_min, k.granica_max)})</span> : null}
                  </td>
                  <td className="muted-text">{k.izvrsio ?? "—"}</td>
                  <td><StatusBadge status={k.ukupan_status} /></td>
                </tr>
              ))}
              {prikazano.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted-text" style={{ textAlign: "center", padding: 20 }}>
                    {imaFiltera ? "Nema kontrola za izabrane filtere." : "Nema zabilježenih kontrola."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalKontrola && <NovaKontrolaModal vozilo={modalKontrola} onClose={() => setModalKontrola(null)} onCreated={ucitaj} />}
      {modalVozilo && <VoziloModal vozilo={modalVozilo === "novo" ? undefined : modalVozilo} onClose={() => setModalVozilo(null)} onCreated={ucitaj} />}
    </>
  );
}

/** Da / Ne bez podrazumijevanog odgovora — „Sačuvaj" bez ijednog klika više ne upisuje „prošao" (R-05). */
function DaNe({ oznaka, vrijednost, onChange }: { oznaka: string; vrijednost: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <label>
      {oznaka}
      <select value={vrijednost === null ? "" : vrijednost ? "da" : "ne"} onChange={(e) => e.target.value && onChange(e.target.value === "da")} style={vrijednost === false ? { borderColor: "#df686c" } : undefined}>
        <option value="">— izaberite —</option>
        <option value="da">Da, u redu</option>
        <option value="ne">Ne</option>
      </select>
    </label>
  );
}

function NovaKontrolaModal({ vozilo, onClose, onCreated }: { vozilo: Vozilo; onClose: () => void; onCreated: () => void }) {
  const [cistoca, setCistoca] = useState<boolean | null>(null);
  const [opremaOk, setOpremaOk] = useState<boolean | null>(null);
  const [vrataOk, setVrataOk] = useState<boolean | null>(null);
  const [temperatura, setTemperatura] = useState("");
  const [napomena, setNapomena] = useState("");
  const [greska, setGreska] = useState("");
  const [ishod, setIshod] = useState<{ ukupanStatus: string; nijeURedu: string[] } | null>(null);
  const [naTelefonu, setNaTelefonu] = useState(false);
  const [kljuc] = useState(noviKljuc);

  const min = vozilo.temp_min === null ? null : Number(vozilo.temp_min);
  const max = vozilo.temp_max === null ? null : Number(vozilo.temp_max);
  const t = temperatura === "" ? null : Number(temperatura);
  const vanGranice = t !== null && ((min !== null && t < min) || (max !== null && t > max));
  const sveOdgovoreno = cistoca !== null && opremaOk !== null && vrataOk !== null && (!vozilo.temp_kontrolisano || t !== null);

  const { radim, salji } = useSlanje();
  const posalji = async () => {
    try {
      // Bez mreže se čuva na telefonu i šalje kad bude signala (#85) — sa vremenom kontrole.
      const u = await upisiIliSacuvaj<{ ukupanStatus: string; nijeURedu: string[] }>(
        "/kontrole-vozila",
        { vozilId: vozilo.id, cistoca, opremaOk, vrataOk, temperatura: t, napomena: napomena || undefined },
        { kljuc, opis: `D1 — ${vozilo.registarski_broj}`, vezano: `vozilo:${vozilo.id}` },
      );
      if (!u.poslato) {
        setNaTelefonu(true);
        return;
      }
      const r = u.rezultat;
      onCreated();
      if (r.ukupanStatus === "PROSAO") onClose();
      else setIshod(r);
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Kontrola nije sačuvana.");
    }
  };

  if (naTelefonu) return <SacuvanoNaTelefonu naslov={`Kontrola vozila — ${vozilo.registarski_broj}`} opis="Kontrola vozila (D1)" onClose={onClose} />;

  if (ishod) {
    return (
      <Modal naslov={`Kontrola vozila — ${vozilo.registarski_broj}`} onClose={onClose} footer={<button className="primary-button" onClick={onClose}>Zatvori</button>}>
        <div style={{ padding: 20 }}>
          <StatusBadge status="NIJE_PROSAO" />
          <p style={{ marginTop: 10, fontSize: 12, color: "#c34e55" }}>
            Vozilo nije spremno — nije u redu: {ishod.nijeURedu.join(", ")}. Otvorena je neusaglašenost i obaviješteno je odgovorno lice.
            Ne utovarujte robu u ovo vozilo dok nova kontrola ne prođe.
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal naslov={`Kontrola vozila — ${vozilo.registarski_broj}`} podnaslov="D1 — prije utovara" onClose={onClose} greska={greska} footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={() => salji(posalji)} disabled={radim || !sveOdgovoreno}>Sačuvaj</button></>}>
      <div className="form-grid">
        <DaNe oznaka="Tovarni prostor čist" vrijednost={cistoca} onChange={setCistoca} />
        <DaNe oznaka="Oprema ispravna" vrijednost={opremaOk} onChange={setOpremaOk} />
        <DaNe oznaka="Vrata i brtve ispravni" vrijednost={vrataOk} onChange={setVrataOk} />
        {vozilo.temp_kontrolisano && (
          <label>
            Temperatura tovarnog prostora (°C){rezim(vozilo.temp_min, vozilo.temp_max) ? ` · granica ${rezim(vozilo.temp_min, vozilo.temp_max)}` : ""}
            <input type="number" step="0.1" value={temperatura} onChange={(e) => setTemperatura(e.target.value)} style={vanGranice ? { borderColor: "#df686c" } : undefined} />
          </label>
        )}
        <label style={{ gridColumn: "1 / -1" }}>Napomena<input value={napomena} onChange={(e) => setNapomena(e.target.value)} /></label>
      </div>
      {vanGranice && <p style={{ fontSize: 12, color: "#c34e55", margin: "0 20px 12px" }}>Temperatura je van granice vozila — vozilo neće biti spremno i otvoriće se neusaglašenost.</p>}
      {vozilo.temp_kontrolisano && min === null && max === null && (
        <p className="muted-text" style={{ fontSize: 11, margin: "0 20px 12px" }}>Granica vozila nije upisana — temperatura se upisuje, ali se ne ocjenjuje. Javite odgovornom licu.</p>
      )}
    </Modal>
  );
}

function VoziloModal({ vozilo, onClose, onCreated }: { vozilo?: Vozilo; onClose: () => void; onCreated: () => void }) {
  const [registarskiBroj, setRegistarskiBroj] = useState(vozilo?.registarski_broj ?? "");
  const [tip, setTip] = useState(vozilo?.tip ?? "");
  const [tempKontrolisano, setTempKontrolisano] = useState(vozilo?.temp_kontrolisano ?? true);
  const [tempMin, setTempMin] = useState(vozilo?.temp_min !== undefined && vozilo?.temp_min !== null ? String(Number(vozilo.temp_min)) : "0");
  const [tempMax, setTempMax] = useState(vozilo?.temp_max !== undefined && vozilo?.temp_max !== null ? String(Number(vozilo.temp_max)) : "4");
  const [uUpotrebi, setUUpotrebi] = useState(true);
  const [greska, setGreska] = useState("");

  const granicaOk = !tempKontrolisano || (tempMin !== "" && tempMax !== "" && Number(tempMin) < Number(tempMax));
  const { radim, salji } = useSlanje();
  const posalji = async () => {
    try {
      const telo = {
        registarskiBroj: registarskiBroj.trim(),
        tip: tip || undefined,
        tempKontrolisano,
        tempMin: tempKontrolisano ? Number(tempMin) : undefined,
        tempMax: tempKontrolisano ? Number(tempMax) : undefined,
      };
      if (vozilo) await api(`/vozila/${vozilo.id}`, { method: "PATCH", telo: { ...telo, tempMin: tempKontrolisano ? Number(tempMin) : null, tempMax: tempKontrolisano ? Number(tempMax) : null, aktivan: uUpotrebi } });
      else await api("/vozila", { telo });
      onCreated();
      onClose();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Vozilo nije sačuvano.");
    }
  };

  return (
    <Modal naslov={vozilo ? `Vozilo — ${vozilo.registarski_broj}` : "Novo vozilo"} onClose={onClose} greska={greska} footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={() => salji(posalji)} disabled={radim || registarskiBroj.trim().length < 3 || !granicaOk}>Sačuvaj</button></>}>
      <div className="form-grid">
        <label>Registarski broj<input value={registarskiBroj} onChange={(e) => setRegistarskiBroj(e.target.value)} /></label>
        <label>Tip<input value={tip} onChange={(e) => setTip(e.target.value)} placeholder="npr. Furgon rashladni" /></label>
        <label style={{ gridColumn: "1 / -1" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={tempKontrolisano} onChange={(e) => setTempKontrolisano(e.target.checked)} style={{ width: "auto", height: "auto" }} /> Rashladno vozilo (prevozi robu pod temperaturnim režimom)
          </span>
        </label>
        {tempKontrolisano && (
          <>
            <label>Režim od (°C)<input type="number" step="0.5" value={tempMin} onChange={(e) => setTempMin(e.target.value)} /></label>
            <label>Režim do (°C)<input type="number" step="0.5" value={tempMax} onChange={(e) => setTempMax(e.target.value)} /></label>
          </>
        )}
        {vozilo && (
          <label style={{ gridColumn: "1 / -1" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={uUpotrebi} onChange={(e) => setUUpotrebi(e.target.checked)} style={{ width: "auto", height: "auto" }} /> Vozilo je u upotrebi
            </span>
          </label>
        )}
      </div>
      {tempKontrolisano && !granicaOk && <p style={{ fontSize: 12, color: "#c34e55", margin: "0 20px 12px" }}>Upišite režim — donja granica manja od gornje. Po njemu se ocjenjuje kontrola prije utovara.</p>}
    </Modal>
  );
}
