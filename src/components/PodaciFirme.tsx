import { useEffect, useState, type ChangeEvent } from "react";
import { api, ApiGreska } from "../lib/api";
import { Modal } from "./Zajednicko";

// Podaci firme — ista forma za konsultanta (Podešavanje) i vlasnicu („Prvi koraci“, 29.10.2026). Šalje polja kako ih
// server prima (camelCase); ranija forma je slala `odgovorno_lice_ime`, pa je svako čuvanje brisalo ime odgovornog lica.
export type Firma = { naziv: string; pib: string | null; adresa: string | null; grad: string | null; telefon: string | null; email: string | null; odgovorno_lice_ime: string | null };

type Vrijednosti = { naziv: string; pib: string; adresa: string; grad: string; telefon: string; email: string; odgovornoLiceIme: string };
const izFirme = (f: Firma): Vrijednosti => ({
  naziv: f.naziv ?? "", pib: f.pib ?? "", adresa: f.adresa ?? "", grad: f.grad ?? "",
  telefon: f.telefon ?? "", email: f.email ?? "", odgovornoLiceIme: f.odgovorno_lice_ime ?? "",
});

function useFirma(firma: Firma, onSaved: () => void) {
  const [v, setV] = useState(() => izFirme(firma));
  const [greska, setGreska] = useState("");
  const [radim, setRadim] = useState(false);
  const polje = (k: keyof Vrijednosti) => ({ value: v[k], onChange: (e: ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: e.target.value })) });
  const posalji = async () => {
    setGreska("");
    if (v.naziv.trim().length < 2) return setGreska("Upišite naziv firme (kako piše u rješenju o registraciji).");
    setRadim(true);
    try {
      await api("/firma", { method: "PATCH", telo: v });
      onSaved();
      return true;
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Podaci nisu sačuvani — provjerite internet i pokušajte ponovo.");
    } finally {
      setRadim(false);
    }
  };
  return { polje, posalji, greska, radim };
}

function Polja({ polje }: { polje: ReturnType<typeof useFirma>["polje"] }) {
  return (
    <div className="form-grid">
      <label style={{ gridColumn: "1 / -1" }}>Naziv firme<input {...polje("naziv")} placeholder="kako piše u rješenju o registraciji" /></label>
      <label>Adresa<input {...polje("adresa")} placeholder="ulica i broj" /></label>
      <label>Grad<input {...polje("grad")} placeholder="npr. Bar" /></label>
      <label>PIB<input {...polje("pib")} inputMode="numeric" placeholder="8 cifara" /></label>
      <label>Telefon<input {...polje("telefon")} type="tel" /></label>
      <label style={{ gridColumn: "1 / -1" }}>E-pošta<input {...polje("email")} type="email" inputMode="email" /></label>
      <label style={{ gridColumn: "1 / -1" }}>
        Odgovorno lice za bezbjednost hrane (ime za rješenje o imenovanju)
        <input {...polje("odgovornoLiceIme")} placeholder="ime i prezime" />
      </label>
    </div>
  );
}

/** Podešavanje (konsultant): forma na strani. */
export function FirmaForma({ firma, onSaved }: { firma: Firma; onSaved: () => void }) {
  const f = useFirma(firma, onSaved);
  return (
    <div className="panel" style={{ maxWidth: 560 }}>
      <div className="panel-header"><h2>Podaci o firmi</h2></div>
      <Polja polje={f.polje} />
      {f.greska && <div className="auth-error" role="alert" style={{ margin: "0 20px 12px" }}>{f.greska}</div>}
      <div style={{ padding: "0 20px 20px" }}>
        <button className="primary-button" onClick={f.posalji} disabled={f.radim}>{f.radim ? "Čuvam…" : "Sačuvaj"}</button>
      </div>
    </div>
  );
}

/** „Prvi koraci“ (vlasnica): isti podaci u prozoru. */
export function PodaciFirmeModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [firma, setFirma] = useState<Firma | null>(null);
  const [greska, setGreska] = useState("");
  useEffect(() => {
    api<Firma>("/firma").then(setFirma).catch(() => setGreska("Podaci se nisu učitali — provjerite internet."));
  }, []);
  if (!firma) return <Modal naslov="Podaci ateljea" onClose={onClose} greska={greska}><p className="muted-text" style={{ padding: 20 }}>Učitavanje…</p></Modal>;
  return <PodaciFirmeForma firma={firma} onClose={onClose} onSaved={onSaved} />;
}

function PodaciFirmeForma({ firma, onClose, onSaved }: { firma: Firma; onClose: () => void; onSaved: () => void }) {
  const f = useFirma(firma, onSaved);
  const sacuvaj = async () => {
    if (await f.posalji()) onClose();
  };
  return (
    <Modal naslov="Podaci ateljea" podnaslov="Idu na rješenje o imenovanju, HACCP plan i paket za inspekciju" onClose={onClose} greska={f.greska}
      footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={sacuvaj} disabled={f.radim}>{f.radim ? "Čuvam…" : "Sačuvaj"}</button></>}>
      <Polja polje={f.polje} />
    </Modal>
  );
}
