import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderCheck, MessageSquare, PhoneCall } from "lucide-react";
import { api } from "../lib/api";
import { PageHeader } from "../components/Zajednicko";
import { AktivnostUzivo } from "../components/Aktivnost";

// Kontrolni centar DIREKTORA (11.10.2026 — „šta mu u stvari koristi od ovoga“). Ne operativne kartice odgovornog
// lica, nego: jesmo li u redu i šta traži moju odluku (semafor), četiri broja za 7 dana, da li se zapisi vode
// svaki dan (14 dana), povlačenje u toku, i put do inspekcije i poruka. Server: stanjeService.pregledDirektora.

type Nivo = "zeleno" | "zuto" | "crveno";
type Pokazatelji = {
  promet: { isporuke: number; kupci: number; prijemi: number };
  zapisi: { ukupno: number; naknadno: number; osoba: number; naVrijeme: number | null };
  plan: { perioda: number; uradjeno: number; posto: number | null };
  nc: { otvorene: number; otvorene_visok: number; nove: number; zatvorene: number };
};
type Stub = { oznaka: string; od: string; mjerenja: number; obrasci: number; d1: number; radniBezZapisa: number };
type Pregled = {
  ocjena: { nivo: Nivo; poruka: string; stavke: { nivo: string; tekst: string }[] };
  pokazatelji: Pokazatelji;
  prethodni: Pokazatelji;
  grafikon: { stubovi: Stub[] };
  povlacenja: { id: string; broj: string; artikal: string; broj_lota: string; pokrenuto_at: string; kupaca: number; obavijesteno: number }[];
  odgovornoLice: string | null;
  posljednjiIzvjestaj: { naziv: string; poslat: string } | null;
};

/** Oblik imenice uz broj: 1 kupac, 2 kupca, 5 kupaca. */
const oblik = (n: number, jedan: string, dva: string, pet: string) => {
  const d = n % 10;
  const s = n % 100;
  return d === 1 && s !== 11 ? jedan : d >= 2 && d <= 4 && (s < 12 || s > 14) ? dva : pet;
};
const datum = (s: string) => new Date(s).toLocaleDateString("sr-Latn-ME", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Promjena prema prethodnih 7 dana; boja po tome da li je promjena dobra. */
function Trend({ sada, prije, bolje, postotni = false }: { sada: number | null; prije: number | null; bolje: "vise" | "manje" | "svejedno"; postotni?: boolean }) {
  if (sada === null || prije === null) return <em className="dir-trend">&nbsp;</em>;
  const razlika = sada - prije;
  if (razlika === 0) return <em className="dir-trend">kao prethodnih 7 dana</em>;
  const gore = razlika > 0;
  const dobro = bolje === "svejedno" ? null : gore === (bolje === "vise");
  const iznos = postotni ? `${Math.abs(razlika)} p.p.` : String(Math.abs(razlika));
  return <em className={`dir-trend ${dobro === null ? "" : dobro ? "dobro" : "lose"}`}>{gore ? "▲" : "▼"} {iznos} prema prethodnih 7 dana</em>;
}

export function DirektorPregled() {
  const navigate = useNavigate();
  const [p, setP] = useState<Pregled | null>(null);
  const [greska, setGreska] = useState("");
  const [aktivnost, setAktivnost] = useState(false);

  useEffect(() => {
    api<Pregled>("/tabla/direktor")
      .then(setP)
      .catch(() => setGreska("Pregled nije učitan — provjerite internet i osvježite stranu."));
  }, []);

  if (greska) return <div className="auth-error">{greska}</div>;
  if (!p) return null;
  const k = p.pokazatelji;
  const pr = p.prethodni;
  const stubovi = p.grafikon.stubovi;
  const max = Math.max(1, ...stubovi.map((s) => s.mjerenja + s.obrasci + s.d1));

  return (
    <>
      <PageHeader
        eyebrow="Pregled za direktora"
        title="Kontrolni centar"
        description={`Šta traži vašu pažnju. Svakodnevni rad vodi odgovorno lice${p.odgovornoLice ? ` — ${p.odgovornoLice}` : ""}.`}
      />

      <section className={`dir-semafor ${p.ocjena.nivo}`} aria-label="Stanje firme">
        <h2>
          <span className="dir-tacka" aria-hidden="true" /> {p.ocjena.poruka}
        </h2>
        {p.ocjena.stavke.length > 0 ? (
          <ul>
            {p.ocjena.stavke.map((s, i) => (
              <li key={i} className={s.nivo}>{s.tekst}</li>
            ))}
          </ul>
        ) : (
          <p>Zapisi se vode redovno, nema otvorenih problema koji traže vašu odluku.</p>
        )}
      </section>

      {p.povlacenja.map((pov) => (
        <div key={pov.id} className="dir-povlacenje" role="alert">
          <PhoneCall size={18} />
          <div>
            <strong>
              Povlačenje {pov.broj} u toku — {pov.artikal}, lot {pov.broj_lota}
            </strong>
            <span>
              Obaviješteno {pov.obavijesteno} od {pov.kupaca} {oblik(pov.kupaca, "kupca", "kupaca", "kupaca")} · pokrenuto {datum(pov.pokrenuto_at)}. Vodi ga odgovorno lice; zatvara se kad su
              obaviješteni svi kupci.
            </span>
          </div>
        </div>
      ))}

      <div className="section-heading" style={{ marginTop: 22 }}>
        <div>
          <h2>Posljednjih 7 dana</h2>
          <span>U odnosu na prethodnih 7 dana.</span>
        </div>
      </div>
      <div className="dir-kpi">
        <div className="dir-kpi-k">
          <span>Kontrole po planu</span>
          <strong>{k.plan.posto === null ? "—" : `${k.plan.posto} %`}</strong>
          <small>{k.plan.perioda ? `urađeno ${k.plan.uradjeno} od ${k.plan.perioda}` : "plan kontrola još nije podešen"}</small>
          <Trend sada={k.plan.posto} prije={pr.plan.posto} bolje="vise" postotni />
        </div>
        <div className="dir-kpi-k">
          <span>Zapisi upisani na vrijeme</span>
          <strong>{k.zapisi.naVrijeme === null ? "—" : `${k.zapisi.naVrijeme} %`}</strong>
          <small>
            {k.zapisi.ukupno} {oblik(k.zapisi.ukupno, "zapis", "zapisa", "zapisa")} · upisuje {k.zapisi.osoba} {oblik(k.zapisi.osoba, "osoba", "osobe", "osoba")}
          </small>
          <Trend sada={k.zapisi.naVrijeme} prije={pr.zapisi.naVrijeme} bolje="vise" postotni />
        </div>
        <div className="dir-kpi-k">
          <span>Otvorene neusaglašenosti</span>
          <strong className={k.nc.otvorene_visok ? "lose" : ""}>{k.nc.otvorene}</strong>
          <small>
            visoke ozbiljnosti {k.nc.otvorene_visok} · nove {k.nc.nove} · zatvorene {k.nc.zatvorene}
          </small>
          <Trend sada={k.nc.otvorene} prije={pr.nc.otvorene} bolje="manje" />
        </div>
        <div className="dir-kpi-k">
          <span>Isporuke kupcima</span>
          <strong>{k.promet.isporuke}</strong>
          <small>
            {k.promet.kupci} {oblik(k.promet.kupci, "kupac", "kupca", "kupaca")} · prijema robe {k.promet.prijemi}
          </small>
          <Trend sada={k.promet.isporuke} prije={pr.promet.isporuke} bolje="svejedno" />
        </div>
      </div>

      <div className="dir-graf">
        <strong>Da li se zapisi vode svaki dan</strong>
        <span className="muted-text"> — mjerenja, dnevni obrasci i kontrole vozila, posljednjih 14 dana; crveno = radni dan bez ijednog zapisa</span>
        <div className="dir-graf-stubovi">
          {stubovi.map((s) => {
            const n = s.mjerenja + s.obrasci + s.d1;
            return (
              <div key={s.od} className="dir-graf-stub" title={`${s.od.slice(8, 10)}.${s.od.slice(5, 7)}.: ${n} zapisa`}>
                {n > 0 ? <i style={{ height: `${Math.max(4, Math.round((n / max) * 100))}%` }} /> : <i className={s.radniBezZapisa ? "rupa" : "prazno"} />}
              </div>
            );
          })}
        </div>
        <div className="dir-graf-oznake">
          {stubovi.map((s) => (
            <span key={s.od}>{s.oznaka}</span>
          ))}
        </div>
      </div>

      <div className="dir-akcije">
        <button className="primary-button" onClick={() => navigate("/inspekcija")}>
          <FolderCheck size={16} /> Došao inspektor — paket za inspekciju
        </button>
        <button className="secondary-button" onClick={() => navigate("/poruke")}>
          <MessageSquare size={16} /> Poruka odgovornom licu
        </button>
      </div>
      <p className="dir-napomena">
        Izvještaj „Stanje poslovanja“ (mjesec, kvartal, godina — sa grafikonima) šalje vam konsultant mejlom
        {p.posljednjiIzvjestaj ? ` — posljednji: ${p.posljednjiIzvjestaj.naziv}, poslat ${datum(p.posljednjiIzvjestaj.poslat)}.` : "."}
      </p>

      <details className="dir-aktivnost" onToggle={(e) => setAktivnost((e.target as HTMLDetailsElement).open)}>
        <summary>Svaki upis uživo — ko je šta i kad radio</summary>
        {aktivnost && <AktivnostUzivo />}
      </details>
    </>
  );
}
