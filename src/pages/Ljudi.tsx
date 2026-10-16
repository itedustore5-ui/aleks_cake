import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Plus, KeyRound, Printer } from "lucide-react";
import { api, ApiGreska } from "../lib/api";
import { PageHeader, Modal, ZakonskaOznaka } from "../components/Zajednicko";
import { StatusBadge } from "../components/StatusBadge";
import { useAuth } from "../lib/auth";
import { ProvjeraZnanjaKartica } from "../components/ProvjeraZnanjaKartica";
import { useSkladista } from "../lib/skladista";

type Lice = {
  id: string;
  ime: string;
  radno_mjesto: string | null;
  rukuje_hranom: boolean;
  sifra: string;
  sanitarna_knjizica_broj: string | null;
  sanitarna_knjizica_rok: string | null;
  knjizica_status: string | null;
  ima_nalog: boolean;
  aktivan: boolean;
};

type PlanStavka = {
  id: string;
  lice_ime: string;
  tema: string;
  planirani_datum: string;
  obavljeno_datum: string | null;
  stanje: string;
};

type Nalog = {
  id: string;
  korisnicko_ime: string;
  uloga: string;
  lozinka_stanje: string;
  aktivan: boolean;
  lice_ime: string | null;
  skladiste_id: string | null;
  skladiste_naziv: string | null;
};


const TABOVI = [
  { kod: "zaposleni", naziv: "Svi zaposleni" },
  { kod: "plan", naziv: "Godišnji plan obuke" },
  { kod: "provjera", naziv: "Provjera znanja" },
  { kod: "nalozi", naziv: "Nalozi" },
] as const;

export function Ljudi() {
  const navigate = useNavigate();
  const { korisnik } = useAuth();
  // Isto pravilo kao smijeDodijelitiUlogu na serveru — dugme se ne nudi tamo gdje bi server odbio.
  const smijeDirnutiNalog = (uloga: string) =>
    korisnik?.uloga === "izvodjac" ? uloga !== "izvodjac" : korisnik?.uloga === "bzr" && (uloga === "operater" || uloga === "vozac");
  // Ulaz sa drugih strana (HACCP plan → „Plan obuke“ / „Pitanja za provjeru znanja“) otvara pravu karticu.
  const ulaz = useLocation().state as { tab?: (typeof TABOVI)[number]["kod"]; pod?: "rezultati" | "pitanja" } | null;
  const [tab, setTab] = useState<(typeof TABOVI)[number]["kod"]>(ulaz?.tab ?? "zaposleni");
  const skladista = useSkladista();
  const postaviMaticno = (nalogId: string, skladisteId: string) =>
    api(`/nalozi/${nalogId}/skladiste`, { method: "PATCH", telo: { skladisteId: skladisteId || null } }).then(ucitaj);
  const [lica, setLica] = useState<Lice[]>([]);
  const [plan, setPlan] = useState<PlanStavka[]>([]);
  const [nalozi, setNalozi] = useState<Nalog[]>([]);
  const [verzijaZnanja, setVerzijaZnanja] = useState(0);
  const [modalNoviLice, setModalNoviLice] = useState(false);
  const [modalIzmjenaLice, setModalIzmjenaLice] = useState<Lice | null>(null);
  const [modalNoviNalog, setModalNoviNalog] = useState<Lice | true | null>(null);
  const [modalLozinka, setModalLozinka] = useState<Nalog | null>(null);
  const [modalPlan, setModalPlan] = useState(false);
  const [modalNovaSesija, setModalNovaSesija] = useState(false);

  const ucitaj = () => {
    api<Lice[]>("/lica").then(setLica);
    api<PlanStavka[]>("/plan-obuke").then(setPlan);
    api<Nalog[]>("/nalozi").then(setNalozi);
  };

  useEffect(ucitaj, []);

  return (
    <>
      <PageHeader
        title="Ljudi"
        description="Jedan spisak svih zaposlenih — ko rukuje hranom, kome ističe sanitarna knjižica i ko ima nalog za prijavu."
        action={
          tab === "zaposleni" ? (
            <button className="primary-button" onClick={() => setModalNoviLice(true)}>
              <Plus size={16} /> Novo lice
            </button>
          ) : tab === "plan" ? (
            <button className="primary-button" onClick={() => setModalPlan(true)}>
              <Plus size={16} /> Nova stavka plana
            </button>
          ) : tab === "provjera" ? (
            <button className="primary-button" onClick={() => setModalNovaSesija(true)}>
              <Plus size={16} /> Otvori termin
            </button>
          ) : (
            <button className="primary-button" onClick={() => setModalNoviNalog(true)}>
              <Plus size={16} /> Novi nalog
            </button>
          )
        }
      />
      <div className="filter-tabs" style={{ marginBottom: 16 }}>
        {TABOVI.map((t) => (
          <button key={t.kod} className={tab === t.kod ? "selected" : ""} onClick={() => setTab(t.kod)}>
            {t.naziv}
          </button>
        ))}
      </div>

      {tab === "zaposleni" && (
        <div className="panel full-panel">
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ime</th>
                  <th>Radno mjesto</th>
                  <th>Šifra</th>
                  <th>Rukuje hranom</th>
                  <th>Sanitarna knjižica <ZakonskaOznaka clan="sanitarna" /></th>
                  <th>Nalog</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lica.map((l) => (
                  <tr key={l.id} style={!l.aktivan ? { opacity: 0.55 } : undefined}>
                    <td>{l.ime}</td>
                    <td className="muted-text">{l.radno_mjesto ?? "—"}</td>
                    <td>
                      <code>{l.sifra}</code>
                    </td>
                    <td>{l.rukuje_hranom ? "Da" : "Ne"}</td>
                    <td>{l.knjizica_status ? <StatusBadge status={l.knjizica_status} /> : <span className="muted-text">—</span>}</td>
                    <td>
                      {l.ima_nalog ? (
                        <StatusBadge status="VAZI" tekst="Ima nalog" />
                      ) : l.aktivan ? (
                        <button className="small-action" onClick={() => setModalNoviNalog(l)}>
                          <KeyRound size={12} /> Otvori nalog
                        </button>
                      ) : (
                        <span className="muted-text">Bez naloga</span>
                      )}
                    </td>
                    <td>{l.aktivan ? <StatusBadge status="VAZI" tekst="Aktivan" /> : <StatusBadge status="ISTEKLA" tekst="Uklonjen" />}</td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="small-action" onClick={() => setModalIzmjenaLice(l)}>Izmijeni</button>
                        {l.aktivan ? (
                          <button className="small-action" onClick={() => { if (window.confirm(`Ukloniti ${l.ime} sa spiska zaposlenih?`)) api(`/lica/${l.id}`, { method: "PATCH", telo: { aktivan: false } }).then(ucitaj); }}>
                            Ukloni
                          </button>
                        ) : (
                          <button className="small-action" onClick={() => api(`/lica/${l.id}`, { method: "PATCH", telo: { aktivan: true } }).then(ucitaj)}>
                            Vrati
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "plan" && (
        <p className="muted-text" style={{ fontSize: 11, margin: "0 0 12px", maxWidth: 760 }}>
          <b>Godišnji plan obuke</b> (Vodič UBH, Prilog 13): ko, koju temu i do kada. Novu obuku upisujete dugmetom <b>„Nova stavka plana“</b> (na vrhu
          strane) — za jednog zaposlenog ili odjednom za sve koji rukuju hranom. Kad je obuka održana: <b>„Označi urađeno“</b>. Štampa:{" "}
          <b>Prilozi → Prilog 13</b>. Znanje poslije obuke provjeravate na kartici <b>Provjera znanja</b> (pitanja firme unosite vi). Obuka i nadzor
          zaposlenih su obaveza iz Uredbe o higijeni hrane 91/2026, Dio 13.
        </p>
      )}
      {tab === "plan" && (
        <div className="panel full-panel">
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ime</th>
                  <th>Tema</th>
                  <th>Planirano</th>
                  <th>Stanje</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {plan.length === 0 && (
                  <tr><td colSpan={5} className="muted-text" style={{ padding: 20 }}>Plan obuke je prazan — dugme „Nova stavka plana“ na vrhu strane.</td></tr>
                )}
                {plan.map((p) => (
                  <tr key={p.id}>
                    <td>{p.lice_ime}</td>
                    <td>{p.tema}</td>
                    <td className="muted-text">{p.planirani_datum}</td>
                    <td>
                      <StatusBadge status={p.stanje} />
                    </td>
                    <td>
                      {!p.obavljeno_datum && (
                        <button className="small-action" onClick={() => api(`/plan-obuke/${p.id}/uradjeno`, { method: "PATCH", telo: {} }).then(ucitaj)}>
                          Označi urađeno
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "provjera" && <ProvjeraZnanjaKartica verzija={verzijaZnanja} onOsvjezi={ucitaj} pocetno={ulaz?.pod} />}

      {tab === "nalozi" && (
        <>
          <p className="muted-text" style={{ fontSize: 11, marginBottom: 14, maxWidth: 640 }}>
            Nalog je za prijavu u aplikaciju — magacioner i vozač njime vide svoju tablu na terenu.
            {skladista.vise && " Matično skladište je samo podrazumijevani izbor pri unosu — magacioner po potrebi bira i drugo."}
            Istim nalogom zaposleni radi i provjeru znanja — prije početka upisuje svoju lozinku.
          </p>
          <div className="panel full-panel">
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Korisničko ime</th>
                  <th>Lice</th>
                  <th>Uloga</th>
                  {skladista.vise && <th>Matično skladište</th>}
                  <th>Lozinka</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {nalozi.map((n) => (
                  <tr key={n.id}>
                    <td>{n.korisnicko_ime}</td>
                    <td className="muted-text">{n.lice_ime ?? "—"}</td>
                    <td>{n.uloga}</td>
                    {skladista.vise && (
                      <td>
                        {n.aktivan && (smijeDirnutiNalog(n.uloga) || n.id === korisnik?.id) ? (
                          <select className="zadatak-dodijeli" aria-label="Matično skladište" value={n.skladiste_id ?? ""} onChange={(e) => postaviMaticno(n.id, e.target.value)}>
                            <option value="">— nije podešeno —</option>
                            {skladista.aktivna.map((sk) => <option key={sk.id} value={sk.id}>{sk.naziv}</option>)}
                          </select>
                        ) : (
                          <span className="muted-text">{n.skladiste_naziv ?? "—"}</span>
                        )}
                      </td>
                    )}
                    <td>
                      <StatusBadge status={n.lozinka_stanje === "privremena" ? "USKORO" : "VAZI"} tekst={n.lozinka_stanje} />
                    </td>
                    <td>{n.aktivan ? <StatusBadge status="VAZI" tekst="Aktivan" /> : <StatusBadge status="ISTEKLA" tekst="Deaktiviran" />}</td>
                    <td>
                      {n.aktivan && smijeDirnutiNalog(n.uloga) && n.id !== korisnik?.id && (
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="small-action" onClick={() => setModalLozinka(n)}>
                            <KeyRound size={12} /> Nova lozinka
                          </button>
                          <button className="small-action" onClick={() => { if (window.confirm(`Deaktivirati nalog ${n.korisnicko_ime}? Više se neće moći prijaviti.`)) api(`/nalozi/${n.id}/deaktiviraj`, { method: "PATCH", telo: {} }).then(ucitaj); }}>
                            Deaktiviraj
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
        </>
      )}

      {modalNoviLice && <NoviLiceModal mozeNalog={smijeDirnutiNalog("operater")} onClose={() => setModalNoviLice(false)} onCreated={ucitaj} />}
      {modalIzmjenaLice && <IzmjenaLiceModal lice={modalIzmjenaLice} onClose={() => setModalIzmjenaLice(null)} onSacuvano={ucitaj} />}
      {modalPlan && <NoviPlanModal lica={lica} onClose={() => setModalPlan(false)} onCreated={ucitaj} />}
      {modalNoviNalog && <NoviNalogModal lica={lica} pocetnoLice={modalNoviNalog === true ? null : modalNoviNalog} onClose={() => setModalNoviNalog(null)} onCreated={ucitaj} />}
      {modalLozinka && <NovaLozinkaModal nalog={modalLozinka} onClose={() => setModalLozinka(null)} onSacuvano={ucitaj} />}
      {modalNovaSesija && <NovaSesijaModal onClose={() => setModalNovaSesija(false)} onCreated={() => setVerzijaZnanja((v) => v + 1)} />}
    </>
  );
}

function NoviLiceModal({ mozeNalog, onClose, onCreated }: { mozeNalog: boolean; onClose: () => void; onCreated: () => void }) {
  const [ime, setIme] = useState("");
  const [radnoMjesto, setRadnoMjesto] = useState("");
  const [rukujeHranom, setRukujeHranom] = useState(true);
  const [knjizicaBroj, setKnjizicaBroj] = useState("");
  const [knjizicaRok, setKnjizicaRok] = useState("");
  const [saNalogom, setSaNalogom] = useState(false);
  const nalog = useNalogPolja(ime, radnoMjesto);
  const [pristup, setPristup] = useState<Pristup | null>(null);
  const [greska, setGreska] = useState("");

  const posalji = async () => {
    try {
      const rezultat = await api<{ sifra: string; nalog: { korisnickoIme: string; privremenaLozinka: string } | null }>("/lica", {
        telo: {
          ime, radnoMjesto, rukujeHranom, sanitarnaKnjizicaBroj: knjizicaBroj || undefined, sanitarnaKnjizicaRok: knjizicaRok || undefined,
          nalog: saNalogom ? { korisnickoIme: nalog.korisnickoIme, uloga: nalog.uloga, lozinka: nalog.lozinka } : undefined,
        },
      });
      onCreated();
      if (rezultat.nalog) setPristup({ ime, sifra: rezultat.sifra, ...rezultat.nalog });
      else onClose();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Lice nije sačuvano.");
    }
  };

  if (pristup) return <PristupModal pristup={pristup} onClose={onClose} />;

  return (
    <Modal naslov="Novo lice" podnaslov="Spisak zaposlenih" onClose={onClose} greska={greska} footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={posalji} disabled={!ime || (saNalogom && !nalog.ispravno)}>Sačuvaj</button></>}>
      <div className="form-grid">
        <label>Ime i prezime<input value={ime} onChange={(e) => setIme(e.target.value)} /></label>
        <label>Radno mjesto<input value={radnoMjesto} onChange={(e) => setRadnoMjesto(e.target.value)} placeholder="npr. magacioner, vozač" /></label>
        <label>
          Rukuje hranom
          <select value={rukujeHranom ? "da" : "ne"} onChange={(e) => setRukujeHranom(e.target.value === "da")}>
            <option value="da">Da</option>
            <option value="ne">Ne</option>
          </select>
        </label>
        <div />
        <label>Broj sanitarne knjižice <ZakonskaOznaka clan="sanitarna" /><input value={knjizicaBroj} onChange={(e) => setKnjizicaBroj(e.target.value)} /></label>
        <label>Rok sanitarne knjižice<input type="date" value={knjizicaRok} onChange={(e) => setKnjizicaRok(e.target.value)} /></label>
        {mozeNalog && (
          <div style={{ gridColumn: "1 / -1", border: "1px solid var(--linija, #dfe6ec)", borderRadius: 8, padding: 12 }}>
            <label style={{ flexDirection: "row", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={saNalogom} onChange={(e) => setSaNalogom(e.target.checked)} style={{ width: "auto", height: "auto" }} />
              <span style={{ fontSize: 12 }}><b>Otvori i nalog za prijavu</b> — za magacionera i vozača koji rade u aplikaciji</span>
            </label>
            {saNalogom && <NalogPolja polja={nalog} />}
          </div>
        )}
      </div>
    </Modal>
  );
}

function IzmjenaLiceModal({ lice, onClose, onSacuvano }: { lice: Lice; onClose: () => void; onSacuvano: () => void }) {
  const [ime, setIme] = useState(lice.ime);
  const [radnoMjesto, setRadnoMjesto] = useState(lice.radno_mjesto ?? "");
  const [rukujeHranom, setRukujeHranom] = useState(lice.rukuje_hranom);
  const [knjizicaBroj, setKnjizicaBroj] = useState(lice.sanitarna_knjizica_broj ?? "");
  const [knjizicaRok, setKnjizicaRok] = useState(lice.sanitarna_knjizica_rok ?? "");
  const [greska, setGreska] = useState("");

  const posalji = async () => {
    try {
      await api(`/lica/${lice.id}`, {
        method: "PATCH",
        telo: { ime, radnoMjesto, rukujeHranom, sanitarnaKnjizicaBroj: knjizicaBroj || undefined, sanitarnaKnjizicaRok: knjizicaRok || undefined },
      });
      onSacuvano();
      onClose();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Izmjene nisu sačuvane.");
    }
  };

  return (
    <Modal naslov={`Izmjena — ${lice.ime}`} podnaslov={`Šifra ${lice.sifra}`} onClose={onClose} greska={greska} footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={posalji} disabled={!ime}>Sačuvaj</button></>}>
      <div className="form-grid">
        <label>Ime i prezime<input value={ime} onChange={(e) => setIme(e.target.value)} /></label>
        <label>Radno mjesto<input value={radnoMjesto} onChange={(e) => setRadnoMjesto(e.target.value)} /></label>
        <label>
          Rukuje hranom
          <select value={rukujeHranom ? "da" : "ne"} onChange={(e) => setRukujeHranom(e.target.value === "da")}>
            <option value="da">Da</option>
            <option value="ne">Ne</option>
          </select>
        </label>
        <div />
        <label>Broj sanitarne knjižice <ZakonskaOznaka clan="sanitarna" /><input value={knjizicaBroj} onChange={(e) => setKnjizicaBroj(e.target.value)} /></label>
        <label>Rok sanitarne knjižice<input type="date" value={knjizicaRok} onChange={(e) => setKnjizicaRok(e.target.value)} /></label>
      </div>
    </Modal>
  );
}

// Teme koje distributer najčešće planira — predlog, ne obaveza (upisuje se i bilo šta drugo).
const TEME_OBUKE = [
  "Dobra higijenska praksa — osnovno",
  "HACCP — kritične kontrolne tačke i granice",
  "Prijem robe: lot, rok i temperatura",
  "Skladištenje i hladni lanac",
  "Transport i kontrola vozila (D1)",
  "Sledljivost i povlačenje robe",
  "Lična higijena i zdravstveno stanje",
  "Čišćenje i dezinfekcija",
];
const SVI_HRANA = "__svi_hrana";
const SVI = "__svi";

function NoviPlanModal({ lica, onClose, onCreated }: { lica: Lice[]; onClose: () => void; onCreated: () => void }) {
  const aktivna = lica.filter((l) => l.aktivan);
  const saHranom = aktivna.filter((l) => l.rukuje_hranom);
  const [kome, setKome] = useState(saHranom.length > 0 ? SVI_HRANA : aktivna[0]?.id ?? "");
  const [tema, setTema] = useState("");
  const [datum, setDatum] = useState("");
  const [greska, setGreska] = useState("");
  const [radim, setRadim] = useState(false);
  const izabrani = kome === SVI_HRANA ? saHranom : kome === SVI ? aktivna : aktivna.filter((l) => l.id === kome);

  const posalji = async () => {
    setRadim(true);
    setGreska("");
    let upisano = 0;
    try {
      for (const l of izabrani) {
        await api("/plan-obuke", { telo: { liceId: l.id, tema, planiraniDatum: datum } });
        upisano += 1;
      }
      onCreated();
      onClose();
    } catch (e) {
      onCreated();
      setGreska(`${upisano > 0 ? `Upisano za ${upisano} od ${izabrani.length}. ` : ""}${e instanceof ApiGreska ? e.message : "Stavka plana nije sačuvana."}`);
    } finally {
      setRadim(false);
    }
  };

  return (
    <Modal
      naslov="Nova stavka plana obuke"
      podnaslov="Prilog 13"
      onClose={onClose}
      greska={greska}
      footer={
        <>
          <button className="secondary-button" onClick={onClose}>Otkaži</button>
          <button className="primary-button" onClick={posalji} disabled={radim || izabrani.length === 0 || !tema.trim() || !datum}>
            Sačuvaj{izabrani.length > 1 ? ` (${izabrani.length} zaposlenih)` : ""}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          Za koga
          <select value={kome} onChange={(e) => setKome(e.target.value)}>
            {saHranom.length > 0 && <option value={SVI_HRANA}>Svi koji rukuju hranom ({saHranom.length})</option>}
            <option value={SVI}>Svi zaposleni ({aktivna.length})</option>
            {aktivna.map((l) => (
              <option key={l.id} value={l.id}>{l.ime}</option>
            ))}
          </select>
        </label>
        <label>Planirani datum<input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} /></label>
        <label style={{ gridColumn: "1 / -1" }}>
          Tema
          <input list="teme-obuke" value={tema} onChange={(e) => setTema(e.target.value)} placeholder="izaberite sa spiska ili upišite" />
          <datalist id="teme-obuke">
            {TEME_OBUKE.map((t) => <option key={t} value={t} />)}
          </datalist>
        </label>
      </div>
    </Modal>
  );
}

function NoviNalogModal({ lica, pocetnoLice, onClose, onCreated }: { lica: Lice[]; pocetnoLice: Lice | null; onClose: () => void; onCreated: () => void }) {
  const bezNaloga = lica.filter((l) => l.aktivan && !l.ima_nalog);
  const [liceId, setLiceId] = useState(pocetnoLice?.id ?? "");
  const lice = lica.find((l) => l.id === liceId) ?? null;
  const nalog = useNalogPolja(lice?.ime ?? "", lice?.radno_mjesto ?? "");
  const [pristup, setPristup] = useState<Pristup | null>(null);
  const [greska, setGreska] = useState("");

  const posalji = async () => {
    try {
      const rezultat = await api<{ korisnickoIme: string; privremenaLozinka: string }>("/nalozi", {
        telo: { liceId: liceId || undefined, korisnickoIme: nalog.korisnickoIme, uloga: nalog.uloga, lozinka: nalog.lozinka },
      });
      setPristup({ ime: lice?.ime ?? null, sifra: lice?.sifra ?? null, ...rezultat });
      onCreated();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Nalog nije kreiran.");
    }
  };

  if (pristup) return <PristupModal pristup={pristup} onClose={onClose} />;

  return (
    <Modal naslov="Novi nalog za prijavu" podnaslov="Magacioner ili vozač — nalog se veže za lice sa spiska" onClose={onClose} greska={greska} footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={posalji} disabled={!nalog.ispravno}>Kreiraj</button></>}>
      <div className="form-grid">
        <label style={{ gridColumn: "1 / -1" }}>
          Zaposleni
          <select value={liceId} onChange={(e) => setLiceId(e.target.value)}>
            <option value="">— bez veze sa spiskom —</option>
            {bezNaloga.map((l) => (
              <option key={l.id} value={l.id}>{l.ime}{l.radno_mjesto ? ` · ${l.radno_mjesto}` : ""} ({l.sifra})</option>
            ))}
          </select>
        </label>
      </div>
      <NalogPolja polja={nalog} />
    </Modal>
  );
}

function NovaLozinkaModal({ nalog, onClose, onSacuvano }: { nalog: Nalog; onClose: () => void; onSacuvano: () => void }) {
  const [lozinka, setLozinka] = useState(predloziLozinku);
  const [pristup, setPristup] = useState<Pristup | null>(null);
  const [greska, setGreska] = useState("");

  const posalji = async () => {
    try {
      const rezultat = await api<{ privremenaLozinka: string }>(`/nalozi/${nalog.id}/lozinka`, { method: "PATCH", telo: { lozinka } });
      setPristup({ ime: nalog.lice_ime, sifra: null, korisnickoIme: nalog.korisnicko_ime, privremenaLozinka: rezultat.privremenaLozinka });
      onSacuvano();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Lozinka nije postavljena.");
    }
  };

  if (pristup) return <PristupModal pristup={pristup} onClose={onClose} />;

  return (
    <Modal naslov={`Nova lozinka — ${nalog.lice_ime ?? nalog.korisnicko_ime}`} podnaslov="Za zaboravljenu lozinku. Stara prestaje da važi, a prijava na svim uređajima se prekida." onClose={onClose} greska={greska} footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={posalji} disabled={lozinka.length < MIN_LOZINKA}>Postavi lozinku</button></>}>
      <div className="form-grid">
        <LozinkaPolje lozinka={lozinka} setLozinka={setLozinka} />
      </div>
    </Modal>
  );
}

// ─── Nalog: prijedlozi, polja, jednokratan prikaz ─────────────────────────────────────────────
// Lozinku odgovorno lice vidi SAMO ovdje, pri postavljanju — poslije toga niko (invarijanta #28).
// Uvijek je privremena: pri prvoj prijavi se mora promijeniti.

const MIN_LOZINKA = 10;
const RIJECI = ["Lovcen", "Durmitor", "Tara", "Moraca", "Bojana", "Orjen", "Sinjajevina", "Komovi", "Prokletije", "Biogradska", "Zeta", "Piva"];

function predloziLozinku() {
  const n = new Uint32Array(2);
  crypto.getRandomValues(n);
  return `${RIJECI[n[0] % RIJECI.length]}-${String(1000 + (n[1] % 9000))}`;
}

const bezKvacica = (s: string) =>
  s.toLowerCase().replace(/[čć]/g, "c").replace(/[šś]/g, "s").replace(/ž/g, "z").replace(/đ/g, "dj").replace(/[^a-z]/g, "");

/** "Marko Vuković" → "marko.v" */
function predloziKorisnickoIme(ime: string) {
  const [prvo, ...ostalo] = ime.trim().split(/\s+/);
  const prezime = ostalo[ostalo.length - 1] ?? "";
  return prvo ? `${bezKvacica(prvo)}${prezime ? `.${bezKvacica(prezime).slice(0, 1)}` : ""}` : "";
}

/** Radno mjesto nije uloga (invarijanta #27) — samo predlog, koji se može promijeniti. */
const predloziUlogu = (radnoMjesto: string) => (/voza[čc]|vozi|dostav/i.test(radnoMjesto) ? "vozac" : "operater");

type Pristup = { ime: string | null; sifra: string | null; korisnickoIme: string; privremenaLozinka: string };

function useNalogPolja(ime: string, radnoMjesto: string) {
  const [korisnickoImeRucno, setKorisnickoIme] = useState<string | null>(null);
  const [ulogaRucno, setUloga] = useState<string | null>(null);
  const [lozinka, setLozinka] = useState(predloziLozinku);
  const korisnickoIme = korisnickoImeRucno ?? predloziKorisnickoIme(ime);
  const uloga = ulogaRucno ?? predloziUlogu(radnoMjesto);
  return {
    korisnickoIme, setKorisnickoIme, uloga, setUloga, lozinka, setLozinka,
    ispravno: korisnickoIme.length >= 3 && lozinka.length >= MIN_LOZINKA,
  };
}

function NalogPolja({ polja }: { polja: ReturnType<typeof useNalogPolja> }) {
  return (
    <div className="form-grid" style={{ marginTop: 10 }}>
      <label>
        Uloga
        <select value={polja.uloga} onChange={(e) => polja.setUloga(e.target.value)}>
          <option value="operater">Magacioner</option>
          <option value="vozac">Vozač</option>
        </select>
      </label>
      <label>
        Korisničko ime
        <input value={polja.korisnickoIme} onChange={(e) => polja.setKorisnickoIme(e.target.value.toLowerCase().replace(/\s/g, ""))} placeholder="npr. marko.v" />
      </label>
      <LozinkaPolje lozinka={polja.lozinka} setLozinka={polja.setLozinka} />
    </div>
  );
}

function LozinkaPolje({ lozinka, setLozinka }: { lozinka: string; setLozinka: (l: string) => void }) {
  return (
    <label style={{ gridColumn: "1 / -1" }}>
      Početna lozinka (privremena)
      <div style={{ display: "flex", gap: 8 }}>
        <input value={lozinka} onChange={(e) => setLozinka(e.target.value)} style={{ flex: 1, fontFamily: "monospace" }} autoComplete="off" />
        <button type="button" className="secondary-button" onClick={() => setLozinka(predloziLozinku())}>Predloži drugu</button>
      </div>
      <small className={lozinka.length < MIN_LOZINKA ? "danas-fali" : "muted-text"} style={{ fontWeight: 400 }}>
        Najmanje {MIN_LOZINKA} znakova ({lozinka.length}). Pri prvoj prijavi zaposleni je mora promijeniti u svoju — vi je poslije ne vidite nigdje.
      </small>
    </label>
  );
}

function PristupModal({ pristup, onClose }: { pristup: Pristup; onClose: () => void }) {
  const adresa = window.location.origin;
  const stampaj = () => {
    const prozor = window.open("", "_blank", "width=420,height=520");
    if (!prozor) return;
    const red = (naziv: string, vrijednost: string) =>
      `<tr><td style="padding:6px 12px 6px 0;color:#555">${naziv}</td><td style="padding:6px 0;font:600 15px monospace">${vrijednost.replace(/</g, "&lt;")}</td></tr>`;
    prozor.document.write(`<html><head><title>Pristup aplikaciji</title></head><body style="font-family:sans-serif;padding:24px">
      <h3 style="margin:0 0 4px">Pristup aplikaciji</h3><div style="color:#555;margin-bottom:14px">${(pristup.ime ?? "").replace(/</g, "&lt;")}</div>
      <table>${red("Adresa", adresa)}${red("Korisničko ime", pristup.korisnickoIme)}${red("Početna lozinka", pristup.privremenaLozinka)}</table>
      <p style="font-size:12px;color:#555;margin-top:18px">Pri prvoj prijavi aplikacija traži da postavite svoju lozinku (najmanje 10 znakova). Ovu ceduljicu zatim uništite.</p>
      </body></html>`);
    prozor.document.close();
    prozor.focus();
    prozor.print();
  };
  return (
    <Modal naslov="Nalog je spreman" podnaslov="Zapišite ili odštampajte odmah — lozinka se više neće prikazati" onClose={onClose}
      footer={<><button className="secondary-button" onClick={stampaj}><Printer size={14} /> Štampaj ceduljicu</button><button className="primary-button" onClick={onClose}>Zatvori</button></>}>
      <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
        {pristup.ime && <div><span className="meta-label">Zaposleni</span><div>{pristup.ime}</div></div>}
        <div><span className="meta-label">Korisničko ime</span><div><code style={{ fontSize: 15 }}>{pristup.korisnickoIme}</code></div></div>
        <div className="next-control">
          <div className="next-control-icon"><KeyRound size={16} /></div>
          <div>
            <span>Početna lozinka</span>
            <strong style={{ fontSize: 15, fontFamily: "monospace" }}>{pristup.privremenaLozinka}</strong>
          </div>
        </div>
        <small className="muted-text">Prijava na {adresa}. Pri prvoj prijavi mora postaviti svoju lozinku.</small>
      </div>
    </Modal>
  );
}

function NovaSesijaModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [naziv, setNaziv] = useState("");
  const [brojPitanja, setBrojPitanja] = useState(10);
  const [cuvaImena, setCuvaImena] = useState(true);
  const [izvorPitanja, setIzvorPitanja] = useState("sva");
  const [pragProlaza, setPragProlaza] = useState(70);
  const [greska, setGreska] = useState("");

  const posalji = async () => {
    try {
      await api("/provjera-znanja/sesije", { telo: { naziv, brojPitanja, cuvaImena, izvorPitanja, pragProlaza } });
      onCreated();
      onClose();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Termin nije otvoren.");
    }
  };

  return (
    <Modal naslov="Otvori termin za provjeru znanja" podnaslov="Pitanja bira sistem nasumično iz izabranog izvora" onClose={onClose} greska={greska} footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={posalji} disabled={!naziv}>Otvori termin</button></>}>
      <div className="form-grid">
        <label style={{ gridColumn: "1 / -1" }}>Naziv (npr. "Higijena — septembar 2026")<input value={naziv} onChange={(e) => setNaziv(e.target.value)} /></label>
        <label>Broj pitanja<input type="number" value={brojPitanja} onChange={(e) => setBrojPitanja(Number(e.target.value))} /></label>
        <label>
          Čuva imena
          <select value={cuvaImena ? "da" : "ne"} onChange={(e) => setCuvaImena(e.target.value === "da")}>
            <option value="da">Da</option>
            <option value="ne">Ne (anonimno)</option>
          </select>
        </label>
        <label>
          Pitanja iz
          <select value={izvorPitanja} onChange={(e) => setIzvorPitanja(e.target.value)}>
            <option value="sva">Sva pitanja</option>
            <option value="firma">Samo pitanja firme</option>
            <option value="konsultant">Samo pitanja konsultanta</option>
          </select>
        </label>
        <label>
          Prag za položeno (%)
          <input type="number" min={1} max={100} value={pragProlaza} onChange={(e) => setPragProlaza(Number(e.target.value))} />
        </label>
      </div>
    </Modal>
  );
}
