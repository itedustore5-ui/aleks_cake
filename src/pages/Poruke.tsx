import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Send, MessageSquare, Reply } from "lucide-react";
import { api, ApiGreska } from "../lib/api";
import { NAZIV_ULOGE, useAuth, type Uloga } from "../lib/auth";
import { PageHeader } from "../components/Zajednicko";
import { OBAVJESTENJA_PROMIJENJENA, OBAVJESTENJA_STIGLA } from "../components/Layout";

type Primalac = { id: string; ime: string; uloga: Uloga };
type Poslata = {
  id: string;
  naslov: string;
  tekst: string | null;
  vazno: boolean;
  primaoci_opis: string;
  broj_primalaca: number;
  procitalo: number;
  posiljalac: string;
  created_at: string;
};
type Primljena = {
  id: string;
  naslov: string;
  tekst: string | null;
  vazno: boolean;
  created_at: string;
  posiljalac: string;
  posiljalac_uloga: Uloga;
  posiljalac_korisnik_id: string;
  obavjestenje_id: string;
  procitano_at: string | null;
};
/** Jedan spisak primljenih i poslatih — po vremenu, najnovije gore (01.10.2026). */
type Stavka = ({ smjer: "primljena" } & Primljena) | ({ smjer: "poslata" } & Poslata);
type Prikaz = "sve" | "primljene" | "poslate";
type Citalac = { ime: string; uloga: Uloga; procitano_at: string | null };
type Nacin = "svi" | "uloge" | "pojedinacno";

// Redoslijed kojim se grupe nude — prvo teren, kome se poruke najčešće i šalju.
const GRUPE: { uloga: Uloga; naziv: string }[] = [
  { uloga: "operater", naziv: "Magacioneri" },
  { uloga: "vozac", naziv: "Vozači" },
  { uloga: "bzr", naziv: "Odgovorno lice" },
  { uloga: "uprava", naziv: "Uprava" },
  { uloga: "izvodjac", naziv: "Konsultant" },
];

const vrijeme = (iso: string) =>
  new Date(iso).toLocaleString("sr-Latn-ME", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function Poruke() {
  const { korisnik } = useAuth();
  const naTerenu = korisnik?.uloga === "operater" || korisnik?.uloga === "vozac";
  // „Odgovori" iz obavještenja: poruka ide pošiljaocu, naslov sa „Odg:".
  const odgovor = (useLocation().state as { odgovor?: { korisnikId: string; naslov: string } } | null)?.odgovor;
  const [primaoci, setPrimaoci] = useState<Primalac[]>([]);
  const [poslate, setPoslate] = useState<Poslata[]>([]);
  const [primljene, setPrimljene] = useState<Primljena[]>([]);
  const [prikaz, setPrikaz] = useState<Prikaz>("sve");
  const [otvorena, setOtvorena] = useState<string | null>(null);
  const [citaoci, setCitaoci] = useState<Record<string, Citalac[]>>({});

  // Na terenu se najčešće piše jednoj osobi (kolegi, vozaču, odgovornom licu), a vodstvo grupama.
  const [nacin, setNacin] = useState<Nacin>(odgovor || naTerenu ? "pojedinacno" : "uloge");
  const [uloge, setUloge] = useState<Set<Uloga>>(new Set(["operater", "vozac"]));
  const [korisnici, setKorisnici] = useState<Set<string>>(new Set(odgovor ? [odgovor.korisnikId] : []));
  const [naslov, setNaslov] = useState(odgovor ? (odgovor.naslov.startsWith("Odg:") ? odgovor.naslov : `Odg: ${odgovor.naslov}`).slice(0, 200) : "");
  const [tekst, setTekst] = useState("");
  const [vazno, setVazno] = useState(false);
  const [greska, setGreska] = useState("");
  const [uspjeh, setUspjeh] = useState("");
  const [saljem, setSaljem] = useState(false);

  const ucitajPoslate = () => api<Poslata[]>("/poruke").then(setPoslate);
  const ucitajPrimljene = () => api<Primljena[]>("/poruke/primljene").then(setPrimljene);
  useEffect(() => {
    api<Primalac[]>("/poruke/primaoci").then(setPrimaoci);
    ucitajPoslate();
    ucitajPrimljene();
    // Nova poruka stiže dok je strana otvorena — Layout to javi (zvonce provjerava na 30 s).
    window.addEventListener(OBAVJESTENJA_STIGLA, ucitajPrimljene);
    return () => window.removeEventListener(OBAVJESTENJA_STIGLA, ucitajPrimljene);
  }, []);

  const svePoruke: Stavka[] = [
    ...(prikaz === "poslate" ? [] : primljene.map((p) => ({ ...p, smjer: "primljena" as const }))),
    ...(prikaz === "primljene" ? [] : poslate.map((p) => ({ ...p, smjer: "poslata" as const }))),
  ].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const neprocitanih = primljene.filter((p) => !p.procitano_at).length;

  const procitaj = async (p: Primljena) => {
    if (p.procitano_at) return;
    await api(`/obavjestenja/${p.obavjestenje_id}/procitano`, { method: "PATCH" }).catch(() => undefined);
    window.dispatchEvent(new Event(OBAVJESTENJA_PROMIJENJENA));
    ucitajPrimljene();
  };
  const odgovori = (p: Primljena) => {
    void procitaj(p);
    setNacin("pojedinacno");
    setKorisnici(new Set([p.posiljalac_korisnik_id]));
    setNaslov((p.naslov.startsWith("Odg:") ? p.naslov : `Odg: ${p.naslov}`).slice(0, 200));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const grupe = GRUPE.map((g) => ({ ...g, broj: primaoci.filter((p) => p.uloga === g.uloga).length })).filter((g) => g.broj > 0);
  const brojPrimalaca =
    nacin === "svi" ? primaoci.length : nacin === "uloge" ? primaoci.filter((p) => uloge.has(p.uloga)).length : korisnici.size;

  const prebaci = <T,>(skup: Set<T>, vrijednost: T) => {
    const novi = new Set(skup);
    if (novi.has(vrijednost)) novi.delete(vrijednost);
    else novi.add(vrijednost);
    return novi;
  };

  const posalji = async () => {
    setGreska("");
    setUspjeh("");
    setSaljem(true);
    try {
      const primaociTelo =
        nacin === "svi" ? { nacin } : nacin === "uloge" ? { nacin, uloge: [...uloge] } : { nacin, korisnici: [...korisnici] };
      const r = await api<{ brojPrimalaca: number; primaoci: string }>("/poruke", {
        telo: { naslov, tekst: tekst || undefined, vazno, primaoci: primaociTelo },
      });
      setUspjeh(`Poslato — ${r.primaoci} (${r.brojPrimalaca}).`);
      setNaslov("");
      setTekst("");
      setVazno(false);
      ucitajPoslate();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Poruka nije poslata.");
    } finally {
      setSaljem(false);
    }
  };

  const prikaziCitaoce = async (id: string) => {
    if (otvorena === id) {
      setOtvorena(null);
      return;
    }
    setOtvorena(id);
    const lista = await api<Citalac[]>(`/poruke/${id}/primaoci`);
    setCitaoci((c) => ({ ...c, [id]: lista }));
  };

  return (
    <>
      <PageHeader
        title="Poruke"
        description="Poruka kolegi, vozaču, odgovornom licu ili grupi — stiže na zvonce, na Moju stranu i na telefon. Ovdje se vidi ko je pročitao vaše poruke."
      />
      <div className="dashboard-columns">
        <div className="panel" style={{ minHeight: "auto" }}>
          <div className="panel-header">
            <h2><Send size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />Nova poruka</h2>
          </div>
          <div className="form-grid" style={{ gridTemplateColumns: "1fr", padding: "0 20px 20px" }}>
            {uspjeh && <div className="auth-security-note">{uspjeh}</div>}
            {greska && <div className="auth-error">{greska}</div>}
            <div className="polje-naslov">
              Kome
              <div className="filter-tabs" style={{ marginTop: 2 }}>
                <button type="button" className={nacin === "uloge" ? "selected" : ""} onClick={() => setNacin("uloge")}>Po grupi</button>
                <button type="button" className={nacin === "pojedinacno" ? "selected" : ""} onClick={() => setNacin("pojedinacno")}>Pojedinačno</button>
                <button type="button" className={nacin === "svi" ? "selected" : ""} onClick={() => setNacin("svi")}>Svima</button>
              </div>
            </div>
            {nacin === "uloge" && (
              <div className="grupe-lista">
                {grupe.map((g) => (
                  <label key={g.uloga}>
                    <input type="checkbox" checked={uloge.has(g.uloga)} onChange={() => setUloge((u) => prebaci(u, g.uloga))} />
                    {g.naziv} ({g.broj})
                  </label>
                ))}
              </div>
            )}
            {nacin === "pojedinacno" && (
              <div className="primaoci-lista">
                {primaoci.map((p) => (
                  <label key={p.id}>
                    <input type="checkbox" checked={korisnici.has(p.id)} onChange={() => setKorisnici((k) => prebaci(k, p.id))} />
                    {p.ime} <span className="muted-text">· {NAZIV_ULOGE[p.uloga]}</span>
                  </label>
                ))}
              </div>
            )}
            <label>Naslov<input value={naslov} onChange={(e) => setNaslov(e.target.value)} maxLength={200} placeholder={naTerenu ? "npr. Kamion kasni 20 minuta" : "npr. Od ponedjeljka utovar počinje u 6h"} /></label>
            <label>
              Tekst (opciono)
              <textarea value={tekst} onChange={(e) => setTekst(e.target.value)} maxLength={2000} rows={4} />
            </label>
            <label className="potvrda-red">
              <input type="checkbox" checked={vazno} onChange={(e) => setVazno(e.target.checked)} /> Važno — ističe se crveno kod primaoca
            </label>
            <button className="primary-button" onClick={posalji} disabled={saljem || naslov.trim().length < 2 || brojPrimalaca === 0}>
              <Send size={14} /> {brojPrimalaca === 0 ? "Izaberite primaoce" : `Pošalji (${brojPrimalaca})`}
            </button>
          </div>
        </div>

        <div className="panel" style={{ minHeight: "auto" }}>
          <div className="panel-header" style={{ flexWrap: "wrap", gap: 8 }}>
            <h2><MessageSquare size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />Poruke</h2>
            <div className="filter-tabs" style={{ margin: 0 }}>
              <button className={prikaz === "sve" ? "selected" : ""} onClick={() => setPrikaz("sve")}>Sve</button>
              <button className={prikaz === "primljene" ? "selected" : ""} onClick={() => setPrikaz("primljene")}>
                Primljene{neprocitanih > 0 && <b> {neprocitanih}</b>}
              </button>
              <button className={prikaz === "poslate" ? "selected" : ""} onClick={() => setPrikaz("poslate")}>Poslate</button>
            </div>
          </div>
          <div style={{ padding: "0 20px 14px" }}>
            {svePoruke.length === 0 && <p className="muted-text" style={{ fontSize: 11, padding: "6px 0" }}>Još nema poruka.</p>}
            {svePoruke.map((p) =>
              p.smjer === "primljena" ? (
                <div
                  key={`r-${p.obavjestenje_id}`}
                  className={`poruka-red primljena${p.procitano_at ? "" : " neprocitana"}`}
                  onClick={() => void procitaj(p)}
                  role={p.procitano_at ? undefined : "button"}
                >
                  <strong>
                    {!p.procitano_at && <span className="poruka-nova" aria-label="nepročitano" />}
                    {p.naslov}
                    {p.vazno && <span className="vazno-oznaka">Važno</span>}
                  </strong>
                  {p.tekst && <p>{p.tekst}</p>}
                  <div className="poruka-meta">
                    <span>Od: {p.posiljalac} ({NAZIV_ULOGE[p.posiljalac_uloga] ?? p.posiljalac_uloga}) · {vrijeme(p.created_at)}</span>
                    {p.posiljalac_korisnik_id !== korisnik?.id && (
                      <button className="link-button" onClick={(e) => { e.stopPropagation(); odgovori(p); }}>
                        <Reply size={12} /> Odgovori
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div key={`s-${p.id}`} className="poruka-red">
                  <strong>
                    {p.naslov}
                    {p.vazno && <span className="vazno-oznaka">Važno</span>}
                  </strong>
                  {p.tekst && <p>{p.tekst}</p>}
                  <div className="poruka-meta">
                    <span>{p.posiljalac} · {vrijeme(p.created_at)}</span>
                    <span>Kome: {p.primaoci_opis}</span>
                    <button className="link-button" onClick={() => prikaziCitaoce(p.id)}>
                      <span className={`poruka-procitano${p.procitalo === p.broj_primalaca ? " sve" : ""}`}>
                        Pročitalo {p.procitalo} od {p.broj_primalaca}
                      </span>
                    </button>
                  </div>
                  {otvorena === p.id && (
                    <div className="poruka-meta" style={{ flexDirection: "column", alignItems: "flex-start", gap: 3, marginTop: 4 }}>
                      {(citaoci[p.id] ?? []).map((c) => (
                        <span key={c.ime + c.uloga}>
                          {c.ime} ({NAZIV_ULOGE[c.uloga]}) — {c.procitano_at ? `pročitano ${vrijeme(c.procitano_at)}` : <b style={{ color: "#c34e55" }}>nije pročitano</b>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ),
            )}
          </div>
        </div>
      </div>
    </>
  );
}
