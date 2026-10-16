import { Fragment, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Plus, Printer, Wand2, ChevronDown, ChevronUp } from "lucide-react";
import { api, ApiGreska } from "../lib/api";
import { lokalniDatum } from "../lib/vrijeme";
import { PageHeader, Modal, ZakonskaOznaka } from "../components/Zajednicko";
import { StatusBadge } from "../components/StatusBadge";
import { useAuth } from "../lib/auth";
import { useSkladista } from "../lib/skladista";

// ─── Tipovi ──────────────────────────────────────────────────────────────────────────────────────
type Ucestalost = "DNEVNO" | "RADNIM_DANIMA" | "SEDMICNO" | "MJESECNO" | "PO_DOGADJAJU";
type StavkaPlana = {
  id: string;
  naziv: string;
  vrsta: "mjerenje" | "obrazac" | "kontrola_vozila";
  kontrolna_tacka_id: string | null;
  kontrolna_tacka_naziv: string | null;
  obrazac_kod: string | null;
  vozilo_oznaka: string | null;
  ucestalost: Ucestalost;
  puta: number;
  uloga: string | null;
  skladiste_id: string | null;
  skladiste_naziv: string | null;
  vazi_od: string;
  aktivan: boolean;
  napomena: string | null;
};
type StanjeDanas = { id: string; uradjeno: number; fali: number; rok: string };
type Rupe = { id: string; periodaUkupno: number; propusteno: { od: string; do: string; uradjeno: number }[] };
type Granica = { min_vrijednost: string | null; max_vrijednost: string | null; artikal_naziv?: string | null; granica_potvrdio?: boolean | null; verzija: number; vazi_od: string };
type Tacka = {
  id: string;
  sifra: string;
  naziv: string;
  opis: string | null;
  opasnost: string | null;
  korektivna_mjera: string | null;
  verifikacija: string | null;
  opstaGranica: Granica | null;
  granicePoArtiklu: Granica[];
  monitoring: StavkaPlana[];
};
type Uredjaj = {
  id: string;
  naziv: string;
  oznaka: string | null;
  lokacija: string | null;
  interval_provjere_mjeseci: number;
  interval_kalibracije_mjeseci: number | null;
  aktivan: boolean;
  posljednja_provjera: string | null;
  posljednja_kalibracija: string | null;
  provjera_do: string | null;
  kalibracija_do: string | null;
  stanje: string;
};
type Provjera = { id: string; datum: string; vrsta: string; referentna: string | null; izmjereno: string | null; rezultat: string; broj_sertifikata: string | null; izvrsilac: string; napomena: string | null };
type StanjeVerifikacije = { vrsta: string; naziv: string; posljednja: string | null; zakljucak: string | null; izvrsilac: string | null; sljedecaDo: string | null; stanje: string };
type ZapisVerifikacije = { id: string; vrsta: string; datum: string; izvrsilac: string; nalaz: string; zakljucak: string; sljedeca_do: string | null };
type Obrazac = { kod: string; naziv: string };
type Vozilo = { id: string; registarski_broj: string };

const UCESTALOST: Record<Ucestalost, string> = {
  DNEVNO: "svaki dan",
  RADNIM_DANIMA: "radnim danima (pon–sub)",
  SEDMICNO: "jednom sedmično",
  MJESECNO: "jednom mjesečno",
  PO_DOGADJAJU: "uz svaki prijem / isporuku",
};
const ULOGA: Record<string, string> = { operater: "magacioner", vozac: "vozač", bzr: "odgovorno lice" };
const VRSTA_VERIFIKACIJE: Record<string, string> = {
  REVIZIJA_PLANA: "Godišnja revizija HACCP plana",
  INTERNI_AUDIT: "Interni audit",
  VJEZBA_POVLACENJA: "Vježba povlačenja (sledljivost)",
};
const datum = (s: string | null | undefined) => (s ? `${s.split("-").reverse().join(".")}.` : "—");
const granica = (g: Granica | null | undefined) => {
  if (!g) return "—";
  const min = g.min_vrijednost !== null ? Number(g.min_vrijednost) : null;
  const max = g.max_vrijednost !== null ? Number(g.max_vrijednost) : null;
  return min !== null && max !== null ? `${min} do ${max} °C` : max !== null ? `najviše ${max} °C` : min !== null ? `najmanje ${min} °C` : "—";
};

// Predlog teksta za HACCP plan — konsultant ga prilagodi firmi. Tri osnovne tačke distributera.
const PREDLOG: Record<string, { opasnost: string; korektivnaMjera: string; verifikacija: string }> = {
  KKT1: {
    opasnost: "Umnožavanje patogenih mikroorganizama (Listeria, Salmonella) ako roba stigne toplija od granice; kontaminacija kroz oštećenu ambalažu.",
    korektivnaMjera: "Roba van granice se ne prima u slobodnu zalihu — zadržava se (HOLD) do odluke odgovornog lica; dobavljač se obavještava; odluka i razlog se upisuju.",
    verifikacija: "Odgovorno lice sedmično pregleda zapise prijema; termometar se provjerava mjesečno (ledena voda 0 °C) i kalibriše godišnje.",
  },
  KKT2: {
    opasnost: "Umnožavanje mikroorganizama kad je temperatura komore iznad granice.",
    korektivnaMjera: "Robu premjestiti u ispravnu komoru, pozvati servis, procijeniti koliko je roba bila van granice i odlučiti o zadržavanju.",
    verifikacija: "Dnevni pregled mjerenja; odgovorno lice sedmično pregleda zapise i provjerava da nema propuštenih dana.",
  },
  KKT3: {
    opasnost: "Prekid hladnog lanca tokom prevoza do kupca.",
    korektivnaMjera: "Stavka van granice se ne predaje ili se vraća; otvara se neusaglašenost; vozilo se provjerava prije sljedećeg utovara.",
    verifikacija: "Pregled temperatura pri predaji i kontrole vozila (D1) prije utovara.",
  },
};
const PREDLOG_OPSTI = {
  opasnost: "Umnožavanje mikroorganizama pri temperaturi van granice.",
  korektivnaMjera: "Utvrditi uzrok, zaštititi robu (premjestiti ili zadržati), otvoriti neusaglašenost i upisati šta je urađeno.",
  verifikacija: "Odgovorno lice sedmično pregleda zapise.",
};

const KARTICE = [
  { kod: "plan", naziv: "Plan monitoringa" },
  { kod: "tacke", naziv: "Kontrolne tačke" },
  { kod: "termometri", naziv: "Termometri" },
  { kod: "verifikacija", naziv: "Verifikacija sistema" },
] as const;
type Kartica = (typeof KARTICE)[number]["kod"];

export function HaccpPlan() {
  const { korisnik } = useAuth();
  const navigate = useNavigate();
  const mijenja = korisnik?.uloga === "bzr" || korisnik?.uloga === "izvodjac";
  const pocetna = (useLocation().state as { kartica?: Kartica } | null)?.kartica ?? "plan";
  const [kartica, setKartica] = useState<Kartica>(pocetna);
  const [greska, setGreska] = useState("");

  return (
    <>
      <PageHeader
        title="HACCP plan"
        description={
          <>
            Šta se prati, koliko često i ko — i dokaz da se to stvarno radi <ZakonskaOznaka clan="36" />. Plan se sklapa iz podešenih tačaka i
            granica, ne iz šablona.
          </>
        }
        action={
          mijenja ? (
            <button className="primary-button" onClick={() => navigate("/prilozi", { state: { prilog: "haccp" } })}>
              <Printer size={16} /> Štampaj HACCP plan
            </button>
          ) : undefined
        }
      />
      {greska && <div className="auth-error" style={{ marginBottom: 12 }}>{greska}</div>}
      {mijenja && (
        <div className="izlaz-traka" style={{ background: "#f3f6f9", color: "#33444d" }}>
          <span>
            <b>Obuka zaposlenih</b> je dio HACCP sistema (Uredba 91/2026, Dio 13): plan obuke i pitanja za provjeru znanja vode se na strani Ljudi.
          </span>
          <button className="small-action" onClick={() => navigate("/ljudi", { state: { tab: "plan" } })}>Plan obuke</button>
          <button className="small-action" onClick={() => navigate("/ljudi", { state: { tab: "provjera", pod: "pitanja" } })}>Pitanja za provjeru</button>
        </div>
      )}
      <div className="filter-tabs" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        {KARTICE.map((k) => (
          <button key={k.kod} className={kartica === k.kod ? "selected" : ""} onClick={() => setKartica(k.kod)}>{k.naziv}</button>
        ))}
      </div>
      {kartica === "plan" && <PlanMonitoringa mijenja={mijenja} setGreska={setGreska} />}
      {kartica === "tacke" && <KontrolneTacke mijenja={mijenja} setGreska={setGreska} />}
      {kartica === "termometri" && <Termometri mijenja={mijenja} setGreska={setGreska} />}
      {kartica === "verifikacija" && <VerifikacijaSistema mijenja={mijenja} />}
    </>
  );
}

// ─── Plan monitoringa ────────────────────────────────────────────────────────────────────────────
function PlanMonitoringa({ mijenja, setGreska }: { mijenja: boolean; setGreska: (s: string) => void }) {
  const [stavke, setStavke] = useState<StavkaPlana[] | null>(null);
  const [danas, setDanas] = useState<Record<string, StanjeDanas>>({});
  const [rupe, setRupe] = useState<Record<string, Rupe>>({});
  const [otvorena, setOtvorena] = useState<string | null>(null);
  const [modal, setModal] = useState<StavkaPlana | "nova" | null>(null);

  const ucitaj = () => {
    api<StavkaPlana[]>("/plan-monitoringa").then(setStavke);
    api<{ stavke: StanjeDanas[] }>("/monitoring/danas").then((r) => setDanas(Object.fromEntries(r.stavke.map((s) => [s.id, s]))));
    api<{ stavke: Rupe[] }>("/monitoring/pregled?dana=30").then((r) => setRupe(Object.fromEntries(r.stavke.map((s) => [s.id, s]))));
  };
  useEffect(ucitaj, []);

  const osnovni = async () => {
    try {
      await api("/plan-monitoringa/osnovni", { method: "POST", telo: {} });
      ucitaj();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Plan nije napravljen.");
    }
  };
  const iskljuci = (s: StavkaPlana) => api(`/plan-monitoringa/${s.id}`, { method: "PATCH", telo: { aktivan: !s.aktivan } }).then(ucitaj);

  if (stavke === null) return null;
  const aktivne = stavke.filter((s) => s.aktivan);

  return (
    <>
      <p className="muted-text" style={{ fontSize: 11, maxWidth: 760, marginBottom: 12 }}>
        „Danas" se broji iz stvarnih unosa (mjerenja, obrasci, kontrole vozila). „Propušteno" su završeni dani i sedmice u posljednjih 30
        dana u kojima nije urađeno koliko plan traži — to je rupa koju inspektor vidi. Stavke „uz svaki prijem / isporuku" se ne broje ovdje:
        bez temperature se prijem i isporuka ne mogu ni snimiti.
      </p>
      {mijenja && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <button className="primary-button" onClick={() => setModal("nova")}><Plus size={15} /> Nova stavka</button>
          {aktivne.length === 0 && (
            <button className="secondary-button" onClick={osnovni}><Wand2 size={15} /> Predloži osnovni plan</button>
          )}
        </div>
      )}
      <div className="panel full-panel">
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Šta</th><th>Koliko često</th><th>Ko</th><th>Danas</th><th>Propušteno (30 dana)</th><th></th></tr>
            </thead>
            <tbody>
              {stavke.length === 0 && (
                <tr><td colSpan={6} className="muted-text" style={{ padding: 20 }}>Plan monitoringa još nije napravljen.{mijenja ? " Počnite od osnovnog plana pa ga prilagodite." : ""}</td></tr>
              )}
              {stavke.map((s) => {
                const d = danas[s.id];
                const r = rupe[s.id];
                return (
                  <Fragment key={s.id}>
                    <tr style={!s.aktivan ? { opacity: 0.5 } : undefined}>
                      <td>
                        {s.naziv}
                        <div className="muted-text" style={{ fontSize: 10 }}>
                          {s.vrsta === "mjerenje" ? `mjerenje · ${s.kontrolna_tacka_naziv}` : s.vrsta === "obrazac" ? `obrazac ${s.obrazac_kod}` : `vozilo ${s.vozilo_oznaka}`}
                          {s.skladiste_naziv ? ` · ${s.skladiste_naziv}` : ""}
                          {s.napomena ? ` · ${s.napomena}` : ""}
                        </div>
                      </td>
                      <td>{UCESTALOST[s.ucestalost]}{s.puta > 1 ? `, ${s.puta}×` : ""}</td>
                      <td>{s.uloga ? ULOGA[s.uloga] ?? s.uloga : "bilo ko"}</td>
                      <td>
                        {!s.aktivan ? (
                          <span className="muted-text">isključeno</span>
                        ) : s.ucestalost === "PO_DOGADJAJU" ? (
                          <span className="muted-text">uz svaki unos</span>
                        ) : !d ? (
                          <span className="muted-text">danas nije radni dan</span>
                        ) : d.fali === 0 ? (
                          <StatusBadge status="VAZI" tekst={`urađeno ${d.uradjeno}/${s.puta}`} />
                        ) : (
                          <StatusBadge status="USKORO" tekst={`${d.uradjeno}/${s.puta} · ${d.rok}`} />
                        )}
                      </td>
                      <td>
                        {r && r.periodaUkupno > 0 ? (
                          <button className="link-button" onClick={() => setOtvorena(otvorena === s.id ? null : s.id)} disabled={r.propusteno.length === 0}>
                            {r.propusteno.length === 0 ? (
                              <StatusBadge status="VAZI" tekst={`0 od ${r.periodaUkupno}`} />
                            ) : (
                              <>
                                <StatusBadge status="KASNI" tekst={`${r.propusteno.length} od ${r.periodaUkupno}`} />
                                {otvorena === s.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                              </>
                            )}
                          </button>
                        ) : (
                          <span className="muted-text">—</span>
                        )}
                      </td>
                      <td>
                        {mijenja && (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button className="small-action" onClick={() => setModal(s)}>Izmijeni</button>
                            <button className="small-action" onClick={() => iskljuci(s)}>{s.aktivan ? "Isključi" : "Uključi"}</button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {otvorena === s.id && r && (
                      <tr>
                        <td colSpan={6} style={{ background: "#fbfcfd", fontSize: 11 }}>
                          Nije urađeno koliko treba:{" "}
                          {r.propusteno.map((p) => (p.od === p.do ? datum(p.od) : `${datum(p.od)}–${datum(p.do)}`) + ` (${p.uradjeno}/${s.puta})`).join(" · ")}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {modal && <StavkaPlanaModal stavka={modal === "nova" ? null : modal} onClose={() => setModal(null)} onSacuvano={ucitaj} />}
    </>
  );
}

function StavkaPlanaModal({ stavka, onClose, onSacuvano }: { stavka: StavkaPlana | null; onClose: () => void; onSacuvano: () => void }) {
  const skladista = useSkladista();
  const [naziv, setNaziv] = useState(stavka?.naziv ?? "");
  const [vrsta, setVrsta] = useState<StavkaPlana["vrsta"]>(stavka?.vrsta ?? "mjerenje");
  const [veza, setVeza] = useState("");
  const [ucestalost, setUcestalost] = useState<Ucestalost>(stavka?.ucestalost ?? "RADNIM_DANIMA");
  const [puta, setPuta] = useState(String(stavka?.puta ?? 1));
  const [uloga, setUloga] = useState(stavka?.uloga ?? "operater");
  const [skladisteId, setSkladisteId] = useState(stavka?.skladiste_id ?? "");
  const [napomena, setNapomena] = useState(stavka?.napomena ?? "");
  const [tacke, setTacke] = useState<{ id: string; sifra: string; naziv: string }[]>([]);
  const [obrasci, setObrasci] = useState<Obrazac[]>([]);
  const [vozila, setVozila] = useState<Vozilo[]>([]);
  const [greska, setGreska] = useState("");

  useEffect(() => {
    if (stavka) return;
    api<{ id: string; sifra: string; naziv: string }[]>("/kontrolne-tacke").then(setTacke);
    fetch("/obrasci-cg.json").then((r) => r.json()).then(setObrasci);
    api<Vozilo[]>("/vozila").then(setVozila);
  }, [stavka]);

  const posalji = async () => {
    try {
      const zajedno = { naziv, ucestalost, puta: Number(puta), uloga: uloga || null, skladisteId: skladisteId || null, napomena: napomena || undefined };
      if (stavka) await api(`/plan-monitoringa/${stavka.id}`, { method: "PATCH", telo: zajedno });
      else
        await api("/plan-monitoringa", {
          telo: {
            ...zajedno,
            vrsta,
            kontrolnaTackaId: vrsta === "mjerenje" ? veza : undefined,
            obrazacKod: vrsta === "obrazac" ? veza : undefined,
            voziloId: vrsta === "kontrola_vozila" ? veza : undefined,
          },
        });
      onSacuvano();
      onClose();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Stavka nije sačuvana.");
    }
  };

  return (
    <Modal naslov={stavka ? `Izmjena — ${stavka.naziv}` : "Nova stavka plana"} podnaslov="Plan monitoringa" onClose={onClose} greska={greska}
      footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={posalji} disabled={naziv.trim().length < 3 || (!stavka && !veza)}>Sačuvaj</button></>}>
      <div className="form-grid">
        <label style={{ gridColumn: "1 / -1" }}>Šta se radi<input value={naziv} onChange={(e) => setNaziv(e.target.value)} placeholder="npr. Temperatura komore K-02" /></label>
        {!stavka && (
          <>
            <label>
              Vrsta
              <select value={vrsta} onChange={(e) => { setVrsta(e.target.value as StavkaPlana["vrsta"]); setVeza(""); }}>
                <option value="mjerenje">Mjerenje temperature</option>
                <option value="obrazac">Dnevni obrazac</option>
                <option value="kontrola_vozila">Kontrola vozila (D1)</option>
              </select>
            </label>
            <label>
              {vrsta === "mjerenje" ? "Kontrolna tačka" : vrsta === "obrazac" ? "Obrazac" : "Vozilo"}
              <select value={veza} onChange={(e) => setVeza(e.target.value)}>
                <option value="">— izaberite —</option>
                {vrsta === "mjerenje" && tacke.map((t) => <option key={t.id} value={t.id}>{t.sifra} · {t.naziv}</option>)}
                {vrsta === "obrazac" && obrasci.map((o) => <option key={o.kod} value={o.kod}>{o.kod} · {o.naziv}</option>)}
                {vrsta === "kontrola_vozila" && vozila.map((v) => <option key={v.id} value={v.id}>{v.registarski_broj}</option>)}
              </select>
            </label>
          </>
        )}
        <label>
          Koliko često
          <select value={ucestalost} onChange={(e) => setUcestalost(e.target.value as Ucestalost)}>
            {(Object.keys(UCESTALOST) as Ucestalost[]).map((u) => <option key={u} value={u}>{UCESTALOST[u]}</option>)}
          </select>
        </label>
        <label>Koliko puta u tom periodu<input type="number" min={1} max={12} value={puta} onChange={(e) => setPuta(e.target.value)} disabled={ucestalost === "PO_DOGADJAJU"} /></label>
        <label>
          Ko radi
          <select value={uloga} onChange={(e) => setUloga(e.target.value)}>
            <option value="operater">Magacioner</option>
            <option value="vozac">Vozač</option>
            <option value="bzr">Odgovorno lice</option>
            <option value="">Bilo ko</option>
          </select>
        </label>
        {skladista.vise && (
          <label>
            Magacin
            <select value={skladisteId} onChange={(e) => setSkladisteId(e.target.value)}>
              <option value="">Svi magacini</option>
              {skladista.aktivna.map((s) => <option key={s.id} value={s.id}>{s.naziv}</option>)}
            </select>
          </label>
        )}
        <label style={{ gridColumn: "1 / -1" }}>Napomena<input value={napomena} onChange={(e) => setNapomena(e.target.value)} placeholder="npr. jutro i popodne, svaka komora" /></label>
      </div>
    </Modal>
  );
}

// ─── Kontrolne tačke ─────────────────────────────────────────────────────────────────────────────
function KontrolneTacke({ mijenja, setGreska }: { mijenja: boolean; setGreska: (s: string) => void }) {
  const [tacke, setTacke] = useState<Tacka[] | null>(null);
  const [modal, setModal] = useState<Tacka | "nova" | null>(null);
  const ucitaj = () => api<{ kontrolneTacke: Tacka[] }>("/haccp-plan").then((p) => setTacke(p.kontrolneTacke)).catch((e) => setGreska(e.message));
  useEffect(() => {
    ucitaj();
  }, []);
  if (tacke === null) return null;
  return (
    <>
      <p className="muted-text" style={{ fontSize: 11, maxWidth: 760, marginBottom: 12 }}>
        Granica za robu se unosi na artiklu (Šifarnici) i sama postaje pravilo za prijem i predaju. Ovdje je opšta granica tačke (npr. komora)
        i tekst za HACCP plan: opasnost, korektivna mjera, verifikacija.
      </p>
      {mijenja && <button className="primary-button" style={{ marginBottom: 12 }} onClick={() => setModal("nova")}><Plus size={15} /> Nova kontrolna tačka</button>}
      <div style={{ display: "grid", gap: 12 }}>
        {tacke.map((t) => (
          <div key={t.id} className="panel" style={{ padding: 16, minHeight: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
              <h3 style={{ margin: 0, fontSize: 14 }}>{t.sifra} · {t.naziv}</h3>
              {mijenja && <button className="small-action" onClick={() => setModal(t)}>Izmijeni</button>}
            </div>
            <div className="form-grid" style={{ padding: "10px 0 0", fontSize: 12 }}>
              <div><span className="meta-label">Opasnost</span><div>{t.opasnost ?? <span className="danas-fali">— upisati —</span>}</div></div>
              <div>
                <span className="meta-label">Kritična granica</span>
                <div>
                  {t.opstaGranica ? `${granica(t.opstaGranica)} (opšta)` : t.granicePoArtiklu.length ? "po artiklu" : <span className="danas-fali">— nije podešena —</span>}
                  {t.granicePoArtiklu.length > 0 && (
                    <div className="muted-text" style={{ fontSize: 10 }}>
                      {t.granicePoArtiklu.map((g) => `${g.artikal_naziv}: ${granica(g)}${g.granica_potvrdio ? "" : " (nepotvrđena)"}`).join(" · ")}
                    </div>
                  )}
                </div>
              </div>
              <div><span className="meta-label">Korektivna mjera</span><div>{t.korektivna_mjera ?? <span className="danas-fali">— upisati —</span>}</div></div>
              <div><span className="meta-label">Verifikacija</span><div>{t.verifikacija ?? <span className="danas-fali">— upisati —</span>}</div></div>
              <div style={{ gridColumn: "1 / -1" }}>
                <span className="meta-label">Monitoring (iz plana)</span>
                <div>{t.monitoring.length ? t.monitoring.map((m) => `${m.naziv} — ${UCESTALOST[m.ucestalost]}${m.puta > 1 ? `, ${m.puta}×` : ""}, ${m.uloga ? ULOGA[m.uloga] : "bilo ko"}`).join(" · ") : <span className="danas-fali">— nije u planu monitoringa —</span>}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      {modal && <TackaModal tacka={modal === "nova" ? null : modal} onClose={() => setModal(null)} onSacuvano={ucitaj} />}
    </>
  );
}

function TackaModal({ tacka, onClose, onSacuvano }: { tacka: Tacka | null; onClose: () => void; onSacuvano: () => void }) {
  const [sifra, setSifra] = useState(tacka?.sifra ?? "");
  const [naziv, setNaziv] = useState(tacka?.naziv ?? "");
  const [opasnost, setOpasnost] = useState(tacka?.opasnost ?? "");
  const [korektivnaMjera, setKorektivnaMjera] = useState(tacka?.korektivna_mjera ?? "");
  const [verifikacija, setVerifikacija] = useState(tacka?.verifikacija ?? "");
  const [min, setMin] = useState(tacka?.opstaGranica?.min_vrijednost != null ? String(Number(tacka.opstaGranica.min_vrijednost)) : "");
  const [max, setMax] = useState(tacka?.opstaGranica?.max_vrijednost != null ? String(Number(tacka.opstaGranica.max_vrijednost)) : "");
  const [greska, setGreska] = useState("");

  const predlozi = () => {
    const p = PREDLOG[sifra.toUpperCase()] ?? PREDLOG_OPSTI;
    setOpasnost(p.opasnost);
    setKorektivnaMjera(p.korektivnaMjera);
    setVerifikacija(p.verifikacija);
  };

  const posalji = async () => {
    try {
      const tekst = { naziv, opasnost: opasnost || undefined, korektivnaMjera: korektivnaMjera || undefined, verifikacija: verifikacija || undefined };
      let id = tacka?.id;
      if (tacka) await api(`/kontrolne-tacke/${tacka.id}`, { method: "PATCH", telo: tekst });
      else id = (await api<{ id: string }>("/kontrolne-tacke", { telo: { sifra, ...tekst } })).id;
      // Opšta granica je pravilo (verzionisano) — nova verzija samo kad se promijeni.
      const staroMin = tacka?.opstaGranica?.min_vrijednost != null ? String(Number(tacka.opstaGranica.min_vrijednost)) : "";
      const staroMax = tacka?.opstaGranica?.max_vrijednost != null ? String(Number(tacka.opstaGranica.max_vrijednost)) : "";
      if ((min !== staroMin || max !== staroMax) && (min !== "" || max !== "")) {
        await api("/pravila-kontrole", {
          telo: { kontrolnaTackaId: id, naziv: `${naziv} — opšta granica`, minVrijednost: min !== "" ? Number(min) : undefined, maxVrijednost: max !== "" ? Number(max) : undefined, ozbiljnost: "VISOK" },
        });
      }
      onSacuvano();
      onClose();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Kontrolna tačka nije sačuvana.");
    }
  };

  return (
    <Modal naslov={tacka ? `${tacka.sifra} · ${tacka.naziv}` : "Nova kontrolna tačka"} podnaslov="Tekst za HACCP plan" onClose={onClose} greska={greska}
      footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={posalji} disabled={!naziv.trim() || (!tacka && sifra.trim().length < 2)}>Sačuvaj</button></>}>
      <div className="form-grid">
        {!tacka && <label>Šifra<input value={sifra} onChange={(e) => setSifra(e.target.value.toUpperCase())} placeholder="npr. KKT2-K02" /></label>}
        <label style={tacka ? { gridColumn: "1 / -1" } : undefined}>Naziv<input value={naziv} onChange={(e) => setNaziv(e.target.value)} placeholder="npr. Komora K-02" /></label>
        <label>Opšta granica — najmanje (°C)<input type="number" step="0.1" value={min} onChange={(e) => setMin(e.target.value)} /></label>
        <label>Opšta granica — najviše (°C)<input type="number" step="0.1" value={max} onChange={(e) => setMax(e.target.value)} /></label>
        <div style={{ gridColumn: "1 / -1" }}>
          <button type="button" className="link-button" onClick={predlozi}><Wand2 size={13} /> Predloži tekst (pa prilagodite firmi)</button>
        </div>
        <label style={{ gridColumn: "1 / -1" }}>Opasnost<textarea rows={2} value={opasnost} onChange={(e) => setOpasnost(e.target.value)} /></label>
        <label style={{ gridColumn: "1 / -1" }}>Korektivna mjera<textarea rows={2} value={korektivnaMjera} onChange={(e) => setKorektivnaMjera(e.target.value)} /></label>
        <label style={{ gridColumn: "1 / -1" }}>Verifikacija<textarea rows={2} value={verifikacija} onChange={(e) => setVerifikacija(e.target.value)} /></label>
      </div>
    </Modal>
  );
}

// ─── Termometri ──────────────────────────────────────────────────────────────────────────────────
function Termometri({ mijenja, setGreska }: { mijenja: boolean; setGreska: (s: string) => void }) {
  const [uredjaji, setUredjaji] = useState<Uredjaj[] | null>(null);
  const [provjere, setProvjere] = useState<Record<string, Provjera[]>>({});
  const [otvoren, setOtvoren] = useState<string | null>(null);
  const [modalNov, setModalNov] = useState(false);
  const [modalProvjera, setModalProvjera] = useState<Uredjaj | null>(null);
  const ucitaj = () => api<Uredjaj[]>("/mjerni-uredjaji").then(setUredjaji).catch((e) => setGreska(e.message));
  useEffect(() => {
    ucitaj();
  }, []);
  const prosiri = async (id: string) => {
    if (otvoren === id) return setOtvoren(null);
    setOtvoren(id);
    setProvjere({ ...provjere, [id]: await api<Provjera[]>(`/mjerni-uredjaji/${id}/provjere`) });
  };
  if (uredjaji === null) return null;
  return (
    <>
      <p className="muted-text" style={{ fontSize: 11, maxWidth: 760, marginBottom: 12 }}>
        Mjerenje vrijedi koliko i termometar. Interna provjera (ledena voda, 0 °C) — mjesečno; kalibracija u ovlašćenoj laboratoriji — po
        planu, uz broj sertifikata. Termometar koji ne prođe provjeru otvara neusaglašenost: mjerenja njime od posljednje dobre provjere su upitna.
      </p>
      {mijenja && <button className="primary-button" style={{ marginBottom: 12 }} onClick={() => setModalNov(true)}><Plus size={15} /> Nov termometar</button>}
      <div className="panel full-panel">
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Termometar</th><th>Stanje</th><th>Posljednja provjera</th><th>Sljedeća provjera</th><th>Kalibracija važi do</th><th></th></tr></thead>
            <tbody>
              {uredjaji.length === 0 && <tr><td colSpan={6} className="muted-text" style={{ padding: 20 }}>Nijedan termometar nije upisan.</td></tr>}
              {uredjaji.map((u) => (
                <Fragment key={u.id}>
                  <tr style={!u.aktivan ? { opacity: 0.5 } : undefined}>
                    <td>
                      {u.naziv}{u.oznaka ? ` (${u.oznaka})` : ""}
                      {u.lokacija && <div className="muted-text" style={{ fontSize: 10 }}>{u.lokacija}</div>}
                    </td>
                    <td><StatusBadge status={u.stanje} /></td>
                    <td className="muted-text">{datum(u.posljednja_provjera)}</td>
                    <td>{datum(u.provjera_do)}</td>
                    <td>{u.interval_kalibracije_mjeseci ? datum(u.kalibracija_do) : <span className="muted-text">nije u planu</span>}</td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        {mijenja && <button className="small-action" onClick={() => setModalProvjera(u)}>Upiši provjeru</button>}
                        <button className="small-action" onClick={() => prosiri(u.id)}>Istorija {otvoren === u.id ? <ChevronUp size={11} /> : <ChevronDown size={11} />}</button>
                      </div>
                    </td>
                  </tr>
                  {otvoren === u.id && (
                    <tr>
                      <td colSpan={6} style={{ background: "#fbfcfd", fontSize: 11 }}>
                        {(provjere[u.id] ?? []).length === 0
                          ? "Još nema provjera."
                          : provjere[u.id].map((p) => (
                              <div key={p.id}>
                                {datum(p.datum)} · {p.vrsta === "INTERNA" ? "interna provjera" : "kalibracija"}
                                {p.referentna !== null ? ` · referentno ${Number(p.referentna)} °C, pokazao ${Number(p.izmjereno)} °C` : ""}
                                {p.broj_sertifikata ? ` · sertifikat ${p.broj_sertifikata}` : ""} · <StatusBadge status={p.rezultat} /> · {p.izvrsilac}
                              </div>
                            ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {modalNov && <NovTermometarModal onClose={() => setModalNov(false)} onSacuvano={ucitaj} />}
      {modalProvjera && <ProvjeraModal uredjaj={modalProvjera} onClose={() => setModalProvjera(null)} onSacuvano={() => { ucitaj(); setProvjere({}); setOtvoren(null); }} />}
    </>
  );
}

function NovTermometarModal({ onClose, onSacuvano }: { onClose: () => void; onSacuvano: () => void }) {
  const [naziv, setNaziv] = useState("");
  const [oznaka, setOznaka] = useState("");
  const [lokacija, setLokacija] = useState("");
  const [provjera, setProvjera] = useState("1");
  const [kalibracija, setKalibracija] = useState("12");
  const [greska, setGreska] = useState("");
  const posalji = async () => {
    try {
      await api("/mjerni-uredjaji", {
        telo: { naziv, oznaka: oznaka || undefined, lokacija: lokacija || undefined, intervalProvjereMjeseci: Number(provjera), intervalKalibracijeMjeseci: kalibracija ? Number(kalibracija) : null },
      });
      onSacuvano();
      onClose();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Termometar nije sačuvan.");
    }
  };
  return (
    <Modal naslov="Nov termometar" podnaslov="Mjerni uređaj" onClose={onClose} greska={greska}
      footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={posalji} disabled={naziv.trim().length < 2}>Sačuvaj</button></>}>
      <div className="form-grid">
        <label>Naziv<input value={naziv} onChange={(e) => setNaziv(e.target.value)} placeholder="npr. Ubodni termometar 1" /></label>
        <label>Oznaka / serijski broj<input value={oznaka} onChange={(e) => setOznaka(e.target.value)} /></label>
        <label style={{ gridColumn: "1 / -1" }}>Gdje se koristi<input value={lokacija} onChange={(e) => setLokacija(e.target.value)} placeholder="npr. prijem robe, komora K-02" /></label>
        <label>Interna provjera na (mjeseci)<input type="number" min={1} max={24} value={provjera} onChange={(e) => setProvjera(e.target.value)} /></label>
        <label>Kalibracija na (mjeseci, prazno = ne radi se)<input type="number" min={1} max={60} value={kalibracija} onChange={(e) => setKalibracija(e.target.value)} /></label>
      </div>
    </Modal>
  );
}

function ProvjeraModal({ uredjaj, onClose, onSacuvano }: { uredjaj: Uredjaj; onClose: () => void; onSacuvano: () => void }) {
  const [vrsta, setVrsta] = useState<"INTERNA" | "KALIBRACIJA">("INTERNA");
  const [dan, setDan] = useState(lokalniDatum());
  const [referentna, setReferentna] = useState("0");
  const [izmjereno, setIzmjereno] = useState("");
  const [dozvoljeno, setDozvoljeno] = useState("0.5");
  const [rezultat, setRezultat] = useState<"ISPRAVAN" | "NEISPRAVAN">("ISPRAVAN");
  const [sertifikat, setSertifikat] = useState("");
  const [napomena, setNapomena] = useState("");
  const [greska, setGreska] = useState("");
  const [ishod, setIshod] = useState<{ rezultat: string; neusaglasenost: string | null } | null>(null);
  const interna = vrsta === "INTERNA";
  const posalji = async () => {
    try {
      const r = await api<{ rezultat: string; neusaglasenost: string | null }>(`/mjerni-uredjaji/${uredjaj.id}/provjera`, {
        telo: {
          datum: dan,
          vrsta,
          referentna: interna && izmjereno !== "" ? Number(referentna) : undefined,
          izmjereno: interna && izmjereno !== "" ? Number(izmjereno) : undefined,
          dozvoljenoOdstupanje: interna ? Number(dozvoljeno) : undefined,
          rezultat: interna ? undefined : rezultat,
          brojSertifikata: sertifikat || undefined,
          napomena: napomena || undefined,
        },
      });
      setIshod(r);
      onSacuvano();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Provjera nije sačuvana.");
    }
  };
  if (ishod) {
    return (
      <Modal naslov={ishod.rezultat === "ISPRAVAN" ? "Termometar je ispravan" : "Termometar NIJE ispravan"} podnaslov={uredjaj.naziv} onClose={onClose} footer={<button className="primary-button" onClick={onClose}>Zatvori</button>}>
        <p style={{ fontSize: 12 }}>
          {ishod.rezultat === "ISPRAVAN"
            ? "Provjera je upisana, rok je pomjeren."
            : `Otvorena je neusaglašenost ${ishod.neusaglasenost}. Ne mjerite ovim termometrom dok se ne zamijeni ili kalibriše, i pregledajte mjerenja od posljednje ispravne provjere.`}
        </p>
      </Modal>
    );
  }
  return (
    <Modal naslov={`Provjera — ${uredjaj.naziv}`} podnaslov="Interna provjera ili kalibracija" onClose={onClose} greska={greska}
      footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={posalji} disabled={interna ? izmjereno === "" : !sertifikat.trim()}>Upiši</button></>}>
      <div className="form-grid">
        <label>
          Vrsta
          <select value={vrsta} onChange={(e) => setVrsta(e.target.value as "INTERNA" | "KALIBRACIJA")}>
            <option value="INTERNA">Interna provjera (ledena voda)</option>
            <option value="KALIBRACIJA">Kalibracija u laboratoriji</option>
          </select>
        </label>
        <label>Datum<input type="date" value={dan} max={lokalniDatum()} onChange={(e) => setDan(e.target.value)} /></label>
        {interna ? (
          <>
            <label>Referentna vrijednost (°C)<input type="number" step="0.1" value={referentna} onChange={(e) => setReferentna(e.target.value)} /></label>
            <label>Termometar pokazuje (°C)<input type="number" step="0.1" value={izmjereno} onChange={(e) => setIzmjereno(e.target.value)} /></label>
            <label>Dozvoljeno odstupanje (± °C)<input type="number" step="0.1" value={dozvoljeno} onChange={(e) => setDozvoljeno(e.target.value)} /></label>
            <div className="muted-text" style={{ fontSize: 10, alignSelf: "end" }}>Rezultat računa aplikacija: van dozvoljenog odstupanja = neispravan.</div>
          </>
        ) : (
          <>
            <label>
              Rezultat sa sertifikata
              <select value={rezultat} onChange={(e) => setRezultat(e.target.value as "ISPRAVAN" | "NEISPRAVAN")}>
                <option value="ISPRAVAN">Ispravan</option>
                <option value="NEISPRAVAN">Neispravan</option>
              </select>
            </label>
            <label>Broj sertifikata<input value={sertifikat} onChange={(e) => setSertifikat(e.target.value)} /></label>
          </>
        )}
        <label style={{ gridColumn: "1 / -1" }}>Napomena<input value={napomena} onChange={(e) => setNapomena(e.target.value)} /></label>
      </div>
    </Modal>
  );
}

// ─── Verifikacija sistema ────────────────────────────────────────────────────────────────────────
function VerifikacijaSistema({ mijenja }: { mijenja: boolean }) {
  const [podaci, setPodaci] = useState<{ stanje: StanjeVerifikacije[]; zapisi: ZapisVerifikacije[] } | null>(null);
  const [modal, setModal] = useState<string | null>(null);
  const ucitaj = () => api<{ stanje: StanjeVerifikacije[]; zapisi: ZapisVerifikacije[] }>("/verifikacija-sistema").then(setPodaci);
  useEffect(() => {
    ucitaj();
  }, []);
  if (!podaci) return null;
  return (
    <>
      <p className="muted-text" style={{ fontSize: 11, maxWidth: 760, marginBottom: 12 }}>
        Sedmi princip HACCP-a: provjera da sistem radi. Plan se revidira bar jednom godišnje i uvijek kad se promijeni proizvod ili postupak
        <ZakonskaOznaka clan="36" />. Zaključak „potrebne izmjene" otvara zadatak.
      </p>
      <div className="stats-grid" style={{ marginBottom: 16 }}>
        {podaci.stanje.map((s) => (
          <div key={s.vrsta} className="stat-card" style={{ display: "block" }}>
            <div className="stat-copy">
              <span>{s.naziv}</span>
              <div style={{ margin: "6px 0" }}><StatusBadge status={s.stanje} /></div>
              <small className="muted-text">
                {s.posljednja ? `Posljednja ${datum(s.posljednja)} · sljedeća do ${datum(s.sljedecaDo)}` : "Nije rađena."}
              </small>
              {mijenja && <div style={{ marginTop: 8 }}><button className="small-action" onClick={() => setModal(s.vrsta)}>Upiši</button></div>}
            </div>
          </div>
        ))}
      </div>
      <div className="panel full-panel">
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Datum</th><th>Šta</th><th>Ko</th><th>Nalaz</th><th>Zaključak</th><th>Sljedeća do</th></tr></thead>
            <tbody>
              {podaci.zapisi.length === 0 && <tr><td colSpan={6} className="muted-text" style={{ padding: 20 }}>Još nema upisa.</td></tr>}
              {podaci.zapisi.map((z) => (
                <tr key={z.id}>
                  <td>{datum(z.datum)}</td>
                  <td>{VRSTA_VERIFIKACIJE[z.vrsta] ?? z.vrsta}</td>
                  <td>{z.izvrsilac}</td>
                  <td style={{ maxWidth: 360 }}>{z.nalaz}</td>
                  <td><StatusBadge status={z.zakljucak} /></td>
                  <td>{datum(z.sljedeca_do)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {modal && <VerifikacijaModal vrsta={modal} onClose={() => setModal(null)} onSacuvano={ucitaj} />}
    </>
  );
}

function VerifikacijaModal({ vrsta, onClose, onSacuvano }: { vrsta: string; onClose: () => void; onSacuvano: () => void }) {
  const [dan, setDan] = useState(lokalniDatum());
  const [nalaz, setNalaz] = useState("");
  const [zakljucak, setZakljucak] = useState<"USAGLASENO" | "POTREBNE_IZMJENE">("USAGLASENO");
  const [greska, setGreska] = useState("");
  const posalji = async () => {
    try {
      await api("/verifikacija-sistema", { telo: { vrsta, datum: dan, nalaz, zakljucak } });
      onSacuvano();
      onClose();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Nije sačuvano.");
    }
  };
  return (
    <Modal naslov={VRSTA_VERIFIKACIJE[vrsta] ?? vrsta} podnaslov="Verifikacija sistema" onClose={onClose} greska={greska}
      footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={posalji} disabled={nalaz.trim().length < 10}>Upiši</button></>}>
      <div className="form-grid">
        <label>Datum<input type="date" value={dan} max={lokalniDatum()} onChange={(e) => setDan(e.target.value)} /></label>
        <label>
          Zaključak
          <select value={zakljucak} onChange={(e) => setZakljucak(e.target.value as "USAGLASENO" | "POTREBNE_IZMJENE")}>
            <option value="USAGLASENO">Usaglašeno</option>
            <option value="POTREBNE_IZMJENE">Potrebne izmjene</option>
          </select>
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Šta je pregledano i šta je nađeno
          <textarea rows={4} value={nalaz} onChange={(e) => setNalaz(e.target.value)}
            placeholder={vrsta === "VJEZBA_POVLACENJA" ? "npr. izabran lot MLJ-2609-A; za 12 min nađeno svih 5 kupaca sa telefonima" : "npr. pregledane sve KKT, granice i zapisi za posljednjih 12 mjeseci…"} />
        </label>
      </div>
    </Modal>
  );
}
