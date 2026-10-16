import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { X, AlertCircle } from "lucide-react";

export function StatCard({ ikonica, boja, oznaka, vrijednost, detalj }: { ikonica: ReactNode; boja: string; oznaka: string; vrijednost: string | number; detalj?: string }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${boja}`}>{ikonica}</div>
      <div className="stat-copy">
        <span>{oznaka}</span>
        <strong>{vrijednost}</strong>
        {detalj && <small>{detalj}</small>}
      </div>
    </div>
  );
}

/** `siroki` — za duge forme (prijem): šire na računaru, i NE zatvara se dodirom van prozora — na
 * telefonu bi slučajan dodir iznad forme obrisao sve upisano. Zatvara se samo sa X ili „Otkaži“. */
export function Modal({ naslov, podnaslov, onClose, children, footer, greska, siroki }: { naslov: string; podnaslov?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; greska?: string; siroki?: boolean }) {
  return (
    <div className="modal-backdrop" onClick={siroki ? undefined : onClose}>
      <div className={siroki ? "modal siroki" : "modal"} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            {podnaslov && <span>{podnaslov}</span>}
            <h2>{naslov}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Zatvori">
            <X size={18} />
          </button>
        </div>
        {/* Greška stoji uz dugme, ne na vrhu: kod duge forme magacioner je dole, kod „Sačuvaj“,
            i poruku na vrhu ne vidi — izgleda kao da dugme ne radi. */}
        {greska && !footer && (
          <div className="auth-error" style={{ margin: "16px 20px 0" }}>
            <AlertCircle size={14} /> {greska}
          </div>
        )}
        {children}
        {footer && (
          <div className="modal-dno">
            {greska && (
              <div className="auth-error" role="alert" style={{ margin: "10px 20px 0" }}>
                <AlertCircle size={14} /> {greska}
              </div>
            )}
            <div className="modal-footer">{footer}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <div className="eyebrow">{eyebrow ?? "Operativni pregled"}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

const ZAKONSKE_OZNAKE = {
  "27": { prikaz: "čl. 27", opis: "Zakon o bezbjednosti hrane, čl. 27 — sledljivost: sistem za identifikaciju dobavljača i kupaca, označavanje serije." },
  "28": { prikaz: "čl. 28", opis: "Zakon o bezbjednosti hrane, čl. 28 — povlačenje nebezbjedne hrane i obavještavanje UBH." },
  "35": { prikaz: "čl. 35", opis: "Zakon o bezbjednosti hrane, čl. 35 — zahtjevi higijene hrane, propisuje ih Vlada (Uredba o higijeni hrane)." },
  "36": { prikaz: "čl. 36", opis: "Zakon o bezbjednosti hrane, čl. 36 — HACCP: uspostaviti, primjenjivati i kontinuirano održavati postupke." },
  "47": { prikaz: "čl. 47", opis: "Zakon o bezbjednosti hrane, čl. 47 — vodiči za dobru higijensku praksu i primjenu HACCP-a." },
  sanitarna: { prikaz: "čl. 31", opis: "Zakon o zaštiti stanovništva od zaraznih bolesti, čl. 31 — sanitarne knjižice lica koja rukuju hranom." },
} satisfies Record<string, { prikaz: string; opis: string }>;

/** Mala oznaka pored polja koja pokazuje na koji član zakona se taj podatak oslanja —
 * bez ovoga ostaje samo tvrdnja da je aplikacija "usklađena", bez dokaza gdje. */
export function ZakonskaOznaka({ clan }: { clan: keyof typeof ZAKONSKE_OZNAKE }) {
  const info = ZAKONSKE_OZNAKE[clan];
  return (
    <span className="zakon-oznaka" title={info.opis}>
      {info.prikaz}
    </span>
  );
}

/** Invarijanta #10: zapis unesen kasnije se smije, ali ne smije izgledati kao da je unesen istog dana. */
export function NaknadnoOznaka({ dana }: { dana: number | null | undefined }) {
  if (!dana || dana <= 0) return null;
  return (
    <span className="naknadno-oznaka" title={`Unijeto ${dana} ${dana === 1 ? "dan" : "dana"} poslije datuma na koji se zapis odnosi.`}>
      naknadno +{dana}
    </span>
  );
}

/** Upis napravljen na telefonu bez interneta (#85): vrijeme je vrijeme radnje, a na server je stigao kasnije. */
export function VanMrezeOznaka({ da }: { da: boolean | null | undefined }) {
  if (!da) return null;
  return (
    <span className="naknadno-oznaka van-mreze-oznaka" title="Upisano na telefonu bez interneta — vrijeme je kad je urađeno, a na server je stiglo kad se vratio signal.">
      bez mreže
    </span>
  );
}

export function PrazanPrikaz({ poruka }: { poruka: string }) {
  return (
    <div className="empty-notices">
      <span>{poruka}</span>
    </div>
  );
}

export function Ucitavanje() {
  return <div className="auth-loading">Učitavanje...</div>;
}

/** Zaglavlje koje se vidi SAMO na štampi: firma, naslov, kad je štampano i po kojim filterima —
 * papir bez toga inspektoru ne kaže šta je izvučeno i kada. */
export function StampaZaglavlje({ naslov, filteri, brojRedova }: { naslov: string; filteri?: string[]; brojRedova?: number }) {
  const [firma, setFirma] = useState<string>("");
  useEffect(() => {
    api<{ naziv: string } | null>("/firma").then((f) => setFirma(f?.naziv ?? "")).catch(() => {});
  }, []);
  const aktivni = (filteri ?? []).filter(Boolean);
  return (
    <div className="samo-stampa stampa-zaglavlje">
      <div>
        <strong>{firma}</strong>
        <h1>{naslov}</h1>
      </div>
      <div className="stampa-meta">
        <span>Štampano: {new Date().toLocaleString("sr-Latn-ME", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
        <span>Filteri: {aktivni.length ? aktivni.join(" · ") : "bez filtera (sve)"}</span>
        {brojRedova !== undefined && <span>Broj stavki: {brojRedova}</span>}
      </div>
    </div>
  );
}
