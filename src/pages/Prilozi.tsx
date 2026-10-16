import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Printer, FileText } from "lucide-react";
import { api } from "../lib/api";
import { PageHeader, ZakonskaOznaka } from "../components/Zajednicko";

type Firma = { naziv: string; adresa: string | null; grad: string | null; pib: string | null; odgovorno_lice_ime: string | null };
type PlanStavka = { lice_ime: string; radno_mjesto: string | null; tema: string; planirani_datum: string; stanje: string };
type Evidencija = { ime: string; radno_mjesto: string | null; posljednja_provjera_at: string | null; posljednji_broj_tacnih: number | null; posljednji_broj_pitanja: number | null };

type Prilog = "resenje" | "prilog13" | "prilog14" | "haccp";

type Granica = { min_vrijednost: string | null; max_vrijednost: string | null; artikal_naziv: string | null; granica_potvrdio: boolean | null };
type StavkaPlana = { id: string; naziv: string; vrsta: string; obrazac_kod: string | null; vozilo_oznaka: string | null; ucestalost: string; puta: number; uloga: string | null };
type HaccpPlanPodaci = {
  datum: string;
  kontrolneTacke: {
    id: string; sifra: string; naziv: string; opasnost: string | null; korektivna_mjera: string | null; verifikacija: string | null;
    opstaGranica: Granica | null; granicePoArtiklu: Granica[]; monitoring: StavkaPlana[];
  }[];
  ostaliMonitoring: StavkaPlana[];
  uredjaji: { id: string; naziv: string; oznaka: string | null; interval_provjere_mjeseci: number; interval_kalibracije_mjeseci: number | null; posljednja_provjera: string | null; provjera_do: string | null; kalibracija_do: string | null; stanje: string }[];
  verifikacija: { vrsta: string; naziv: string; posljednja: string | null; zakljucak: string | null; sljedecaDo: string | null; stanje: string }[];
};

const OPISI: Record<Prilog, ReactNode> = {
  resenje: "Rješenje o imenovanju nije zakonski obrazac — to je pisani trag ko sprovodi postupke i ko javlja UBH.",
  prilog13: "Plan sa stanjem (planirano/uskoro/kasni/urađeno) — stavka koja je prošla bez obuke se ne briše, ostaje kao „kasni\".",
  haccp: "HACCP plan sklopljen iz onoga što je podešeno u aplikaciji — kontrolne tačke, granice, plan monitoringa, termometri, verifikacija. Tekst se mijenja na strani „HACCP plan“.",
  prilog14: (
    <>
      Dokaz da HACCP sistem stvarno radi <ZakonskaOznaka clan="36" /> — nije sertifikat o položenom
      testu (banka pitanja nije statistički validirana), nego evidencija da se provjera redovno
      sprovodi. Termini se otvaraju na „Ljudi" → „Provjera znanja".
    </>
  ),
};

export function Prilozi() {
  const [firma, setFirma] = useState<Firma | null>(null);
  const [plan, setPlan] = useState<PlanStavka[]>([]);
  const [evidencija, setEvidencija] = useState<Evidencija[]>([]);
  const [prilog, setPrilog] = useState<Prilog>((useLocation().state as { prilog?: Prilog } | null)?.prilog ?? "resenje");
  const [haccp, setHaccp] = useState<HaccpPlanPodaci | null>(null);

  useEffect(() => {
    api<Firma>("/firma").then(setFirma);
    api<PlanStavka[]>("/plan-obuke").then(setPlan);
    api<Evidencija[]>("/evidencija-osposobljavanja").then(setEvidencija);
    api<HaccpPlanPodaci>("/haccp-plan").then(setHaccp);
  }, []);

  return (
    <>
      <div className="no-print">
        <PageHeader title="Prilozi" description={OPISI[prilog]} />
        <div className="filter-tabs" style={{ marginBottom: 20 }}>
          <button className={prilog === "resenje" ? "selected" : ""} onClick={() => setPrilog("resenje")}>Rješenje o imenovanju</button>
          <button className={prilog === "prilog13" ? "selected" : ""} onClick={() => setPrilog("prilog13")}>Prilog 13 — Plan obuke</button>
          <button className={prilog === "prilog14" ? "selected" : ""} onClick={() => setPrilog("prilog14")}>Prilog 14 — Evidencija</button>
          <button className={prilog === "haccp" ? "selected" : ""} onClick={() => setPrilog("haccp")}>HACCP plan</button>
        </div>
        <button className="primary-button" onClick={() => window.print()} style={{ marginBottom: 20 }}>
          <Printer size={16} /> Štampaj
        </button>
      </div>

      <div className="panel prilog-list" style={{ maxWidth: prilog === "haccp" ? 1040 : 720, margin: "0 auto" }}>
        {prilog === "resenje" && <ResenjeOImenovanju firma={firma} />}
        {prilog === "prilog13" && <Prilog13 plan={plan} firma={firma} />}
        {prilog === "prilog14" && <Prilog14 evidencija={evidencija} firma={firma} />}
        {prilog === "haccp" && <HaccpPlanStampa plan={haccp} firma={firma} />}
      </div>
    </>
  );
}

function Zaglavlje({ firma, naslov }: { firma: Firma | null; naslov: string }) {
  return (
    <div style={{ textAlign: "center", marginBottom: 30 }}>
      <FileText size={22} style={{ marginBottom: 8 }} />
      <h1 style={{ fontSize: 18 }}>{firma?.naziv ?? "Firma"}</h1>
      <p style={{ fontSize: 11, color: "#8996a0" }}>{firma?.adresa}{firma?.adresa && firma?.grad ? ", " : ""}{firma?.grad}{firma?.pib ? ` · PIB ${firma.pib}` : ""}</p>
      <h2 style={{ marginTop: 20, fontSize: 15 }}>{naslov}</h2>
    </div>
  );
}

function ResenjeOImenovanju({ firma }: { firma: Firma | null }) {
  return (
    <div>
      <Zaglavlje firma={firma} naslov="Rješenje o imenovanju odgovornog lica za bezbjednost hrane" />
      <p style={{ fontSize: 12, lineHeight: 1.8 }}>
        Na osnovu obaveza koje za privredno društvo proizilaze iz Zakona o bezbjednosti hrane
        ("Sl. list CG", br. 59/2026), direktor društva <strong>{firma?.naziv ?? "___________________"}</strong> donosi
      </p>
      <h3 style={{ textAlign: "center", margin: "24px 0", fontSize: 13 }}>RJEŠENJE</h3>
      <ol style={{ fontSize: 12, lineHeight: 2 }}>
        <li>
          Za odgovorno lice za bezbjednost hrane imenuje se <strong>{firma?.odgovorno_lice_ime ?? "___________________"}</strong>.
        </li>
        <li>Odgovorno lice sprovodi postupke sledljivosti (čl. 27), povlačenja nebezbjedne hrane i obavještavanja nadležnog organa (čl. 28), i uspostavljanja, primjene i kontinuiranog održavanja HACCP postupaka (čl. 36) Zakona o bezbjednosti hrane.</li>
        <li>Ovo rješenje stupa na snagu danom donošenja.</li>
      </ol>
      <div style={{ marginTop: 60, display: "flex", justifyContent: "space-between", fontSize: 12, gap: 20, flexWrap: "wrap" }}>
        <div>Mjesto i datum: ______________________</div>
        <div>Direktor: ______________________</div>
      </div>
    </div>
  );
}

function Prilog13({ plan, firma }: { plan: PlanStavka[]; firma: Firma | null }) {
  return (
    <div>
      <Zaglavlje firma={firma} naslov="Prilog 13 — Godišnji plan obuke" />
      <div className="data-table-wrap"><table className="data-table">
        <thead>
          <tr>
            <th>Zaposleni</th>
            <th>Radno mjesto</th>
            <th>Tema</th>
            <th>Planirano</th>
            <th>Stanje</th>
          </tr>
        </thead>
        <tbody>
          {plan.map((p, i) => (
            <tr key={i}>
              <td>{p.lice_ime}</td>
              <td>{p.radno_mjesto ?? "—"}</td>
              <td>{p.tema}</td>
              <td>{p.planirani_datum}</td>
              <td>{p.stanje}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

function Prilog14({ evidencija, firma }: { evidencija: Evidencija[]; firma: Firma | null }) {
  return (
    <div>
      <Zaglavlje firma={firma} naslov="Prilog 14 — Evidencija osposobljavanja" />
      <div className="data-table-wrap"><table className="data-table">
        <thead>
          <tr>
            <th>Zaposleni</th>
            <th>Radno mjesto</th>
            <th>Posljednja provjera</th>
            <th>Rezultat</th>
          </tr>
        </thead>
        <tbody>
          {evidencija.map((e, i) => (
            <tr key={i}>
              <td>{e.ime}</td>
              <td>{e.radno_mjesto ?? "—"}</td>
              <td>{e.posljednja_provjera_at ? new Date(e.posljednja_provjera_at).toLocaleDateString("sr-Latn-ME") : "Nema podataka"}</td>
              <td>{e.posljednji_broj_tacnih !== null ? `${e.posljednji_broj_tacnih}/${e.posljednji_broj_pitanja}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}

const UCESTALOST: Record<string, string> = {
  DNEVNO: "svaki dan",
  RADNIM_DANIMA: "radnim danima",
  SEDMICNO: "sedmično",
  MJESECNO: "mjesečno",
  PO_DOGADJAJU: "uz svaki prijem / isporuku",
};
const ULOGA: Record<string, string> = { operater: "magacioner", vozac: "vozač", bzr: "odgovorno lice" };
const STANJE: Record<string, string> = { VAZI: "važi", USKORO: "uskoro", ISTEKLA: "istekla", NEISPRAVAN: "neispravan", KASNI: "kasni", NIJE_RADJENO: "nije rađeno" };
const dat = (s: string | null | undefined) => (s ? `${s.split("-").reverse().join(".")}.` : "—");
const opsegTekst = (g: Granica | null) => {
  if (!g) return null;
  const min = g.min_vrijednost !== null ? Number(g.min_vrijednost) : null;
  const max = g.max_vrijednost !== null ? Number(g.max_vrijednost) : null;
  return min !== null && max !== null ? `${min} do ${max} °C` : max !== null ? `najviše ${max} °C` : min !== null ? `najmanje ${min} °C` : null;
};
const monitoringTekst = (m: StavkaPlana) => `${m.naziv} — ${UCESTALOST[m.ucestalost] ?? m.ucestalost}${m.puta > 1 ? `, ${m.puta}×` : ""}; ${m.uloga ? ULOGA[m.uloga] ?? m.uloga : "bilo ko"}`;
const PRAZNO = <span style={{ color: "#b0413e" }}>— upisati —</span>;

/** HACCP plan: tabela po kontrolnoj tački (opasnost, granica, monitoring, korektivna mjera,
 * verifikacija, zapis), pa monitoring dobre higijenske prakse, termometri i verifikacija sistema.
 * Sve iz baze — šta nije podešeno, piše crveno „upisati", da se ne štampa prazan plan kao gotov. */
function HaccpPlanStampa({ plan, firma }: { plan: HaccpPlanPodaci | null; firma: Firma | null }) {
  if (!plan) return <p className="muted-text">Učitavanje…</p>;
  const revizija = plan.verifikacija.find((v) => v.vrsta === "REVIZIJA_PLANA");
  const celija = { fontSize: 10, verticalAlign: "top" as const, lineHeight: 1.45 };
  return (
    <div>
      <Zaglavlje firma={firma} naslov="HACCP plan" />
      <p style={{ fontSize: 11, marginBottom: 14 }}>
        Odgovorno lice: <strong>{firma?.odgovorno_lice_ime ?? "___________________"}</strong> · Štampano: {dat(plan.datum)} · Posljednja revizija:{" "}
        {revizija?.posljednja ? dat(revizija.posljednja) : "nije rađena"} · Osnov: Zakon o bezbjednosti hrane („Sl. list CG", br. 59/2026), čl. 36.
      </p>

      <h3 style={{ fontSize: 13, margin: "18px 0 8px" }}>1. Kritične kontrolne tačke</h3>
      <div className="data-table-wrap"><table className="data-table">
        <thead>
          <tr><th>KKT</th><th>Opasnost</th><th>Kritična granica</th><th>Monitoring — šta, koliko često, ko</th><th>Korektivna mjera</th><th>Verifikacija</th><th>Zapis</th></tr>
        </thead>
        <tbody>
          {plan.kontrolneTacke.map((t) => (
            <tr key={t.id}>
              <td style={celija}><strong>{t.sifra}</strong><br />{t.naziv}</td>
              <td style={celija}>{t.opasnost ?? PRAZNO}</td>
              <td style={celija}>
                {opsegTekst(t.opstaGranica) ?? (t.granicePoArtiklu.length ? null : PRAZNO)}
                {t.granicePoArtiklu.map((g, i) => (
                  <div key={i}>{g.artikal_naziv}: {opsegTekst(g)}{g.granica_potvrdio ? "" : " *"}</div>
                ))}
              </td>
              <td style={celija}>{t.monitoring.length ? t.monitoring.map((m) => <div key={m.id}>{monitoringTekst(m)}</div>) : PRAZNO}</td>
              <td style={celija}>{t.korektivna_mjera ?? PRAZNO}</td>
              <td style={celija}>{t.verifikacija ?? PRAZNO}</td>
              <td style={celija}>Mjerenje u aplikaciji (vrijeme, vrijednost, ko je mjerio, rezultat)</td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {plan.kontrolneTacke.some((t) => t.granicePoArtiklu.some((g) => !g.granica_potvrdio)) && (
        <p style={{ fontSize: 10, marginTop: 4 }}>* Granica još nije potvrđena od strane firme — do potvrde se odstupanje samo bilježi kao upozorenje.</p>
      )}

      <h3 style={{ fontSize: 13, margin: "18px 0 8px" }}>2. Dobra higijenska praksa — monitoring</h3>
      <div className="data-table-wrap"><table className="data-table">
        <thead><tr><th>Šta</th><th>Koliko često</th><th>Ko</th><th>Zapis</th></tr></thead>
        <tbody>
          {plan.ostaliMonitoring.length === 0 && <tr><td colSpan={4} style={celija}>{PRAZNO}</td></tr>}
          {plan.ostaliMonitoring.map((m) => (
            <tr key={m.id}>
              <td style={celija}>{m.naziv}</td>
              <td style={celija}>{UCESTALOST[m.ucestalost] ?? m.ucestalost}{m.puta > 1 ? `, ${m.puta}×` : ""}</td>
              <td style={celija}>{m.uloga ? ULOGA[m.uloga] ?? m.uloga : "bilo ko"}</td>
              <td style={celija}>{m.vrsta === "obrazac" ? `Obrazac ${m.obrazac_kod}` : m.vrsta === "kontrola_vozila" ? `Kontrola vozila ${m.vozilo_oznaka} (D1)` : "Mjerenje"}</td>
            </tr>
          ))}
        </tbody>
      </table></div>

      <h3 style={{ fontSize: 13, margin: "18px 0 8px" }}>3. Mjerni uređaji</h3>
      <div className="data-table-wrap"><table className="data-table">
        <thead><tr><th>Termometar</th><th>Interna provjera</th><th>Posljednja</th><th>Sljedeća</th><th>Kalibracija važi do</th><th>Stanje</th></tr></thead>
        <tbody>
          {plan.uredjaji.length === 0 && <tr><td colSpan={6} style={celija}>{PRAZNO}</td></tr>}
          {plan.uredjaji.map((u) => (
            <tr key={u.id}>
              <td style={celija}>{u.naziv}{u.oznaka ? ` (${u.oznaka})` : ""}</td>
              <td style={celija}>svakih {u.interval_provjere_mjeseci} mj.</td>
              <td style={celija}>{dat(u.posljednja_provjera)}</td>
              <td style={celija}>{dat(u.provjera_do)}</td>
              <td style={celija}>{u.interval_kalibracije_mjeseci ? dat(u.kalibracija_do) : "—"}</td>
              <td style={celija}>{STANJE[u.stanje] ?? u.stanje}</td>
            </tr>
          ))}
        </tbody>
      </table></div>

      <h3 style={{ fontSize: 13, margin: "18px 0 8px" }}>4. Verifikacija sistema</h3>
      <div className="data-table-wrap"><table className="data-table">
        <thead><tr><th>Šta</th><th>Posljednja</th><th>Zaključak</th><th>Sljedeća do</th><th>Stanje</th></tr></thead>
        <tbody>
          {plan.verifikacija.map((v) => (
            <tr key={v.vrsta}>
              <td style={celija}>{v.naziv}</td>
              <td style={celija}>{dat(v.posljednja)}</td>
              <td style={celija}>{v.zakljucak === "USAGLASENO" ? "usaglašeno" : v.zakljucak === "POTREBNE_IZMJENE" ? "potrebne izmjene" : "—"}</td>
              <td style={celija}>{dat(v.sljedecaDo)}</td>
              <td style={celija}>{STANJE[v.stanje] ?? v.stanje}</td>
            </tr>
          ))}
        </tbody>
      </table></div>

      <p style={{ fontSize: 10, marginTop: 14, color: "#556774" }}>
        Obrasci dnevnih zapisa i kontrole vozila su radni obrasci firme, ne zvanični obrasci. Plan se revidira najmanje jednom godišnje i
        uvijek kad se promijeni proizvod ili postupak (čl. 36).
      </p>
      <div style={{ marginTop: 40, display: "flex", justifyContent: "space-between", fontSize: 12, gap: 20, flexWrap: "wrap" }}>
        <div>Izradio: ______________________</div>
        <div>Odobrilo odgovorno lice: ______________________</div>
        <div>Datum: ______________</div>
      </div>
    </div>
  );
}
