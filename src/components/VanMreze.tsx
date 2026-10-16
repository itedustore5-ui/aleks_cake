import { useEffect, useState } from "react";
import { CloudOff, RefreshCw, AlertTriangle, WifiOff } from "lucide-react";
import { useIzlaz, posaljiIzlaz, ukloniIzIzlaza } from "../lib/izlaz";
import { PODACI_SA_TELEFONA } from "../lib/api";
import { Modal } from "./Zajednicko";

const sat = (iso: string) =>
  new Intl.DateTimeFormat("sr-Latn-ME", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** Posle „Sačuvaj“ bez mreže (#85): upis NIJE izgubljen i NE upisuje se ponovo. */
export function SacuvanoNaTelefonu({ naslov, opis, onClose }: { naslov: string; opis: string; onClose: () => void }) {
  return (
    <Modal naslov={naslov} onClose={onClose} footer={<button className="primary-button" onClick={onClose}>U redu</button>}>
      <div className="van-mreze-potvrda" role="status">
        <CloudOff size={22} />
        <div>
          <strong>Sačuvano na telefonu</strong>
          <p>
            {opis}: upis je sačuvan sa vremenom kad ste ga uradili i šalje se sam čim bude signala — ne upisujte ga ponovo. Dok ne ode,
            na vrhu strane piše „čeka mrežu“.
          </p>
        </div>
      </div>
    </Modal>
  );
}

/** Traka u zaglavlju strane: nema mreže, šta čeka na telefonu, šta server nije primio. */
export function TrakaVanMreze({ naMrezi }: { naMrezi: boolean }) {
  const { cekaju, odbijeno, saljem } = useIzlaz();
  const [sacuvanoAt, setSacuvanoAt] = useState<string | null>(null);
  const [otvoreno, setOtvoreno] = useState(false);

  useEffect(() => {
    const f = (e: Event) => setSacuvanoAt((e as CustomEvent<string>).detail);
    window.addEventListener(PODACI_SA_TELEFONA, f);
    return () => window.removeEventListener(PODACI_SA_TELEFONA, f);
  }, []);
  useEffect(() => {
    if (naMrezi) setSacuvanoAt(null);
  }, [naMrezi]);

  return (
    <>
      {!naMrezi && (
        <div className="upozorenje-traka" role="status">
          <WifiOff size={16} />
          <span>
            Nema interneta. D1, predaja, mjerenje, dnevni zapis i prijava problema čuvaju se na telefonu i šalju sami kad se vrati signal;
            ostalo sačekajte.{sacuvanoAt ? ` Prikazani podaci su od ${sat(sacuvanoAt)}.` : ""}
          </span>
        </div>
      )}
      {cekaju.length > 0 && (
        <div className="izlaz-traka" role="status">
          <CloudOff size={16} />
          <span>
            {cekaju.length === 1 ? "1 upis čeka mrežu" : `${cekaju.length} upisa čekaju mrežu`} — šalje se samo, ne upisujte ponovo.
            {cekaju[0].pokusaji > 0 && cekaju[0].greska ? ` Posljednji pokušaj: ${cekaju[0].greska}` : ""}
          </span>
          <button className="small-action" onClick={() => void posaljiIzlaz()} disabled={saljem || !naMrezi}>
            <RefreshCw size={12} className={saljem ? "okrece-se" : undefined} /> {saljem ? "Šaljem…" : "Pošalji sad"}
          </button>
        </div>
      )}
      {odbijeno.length > 0 && (
        <div className="izlaz-traka odbijeno" role="alert">
          <AlertTriangle size={16} />
          <span>
            {odbijeno.length === 1 ? "1 upis sa telefona server nije primio" : `${odbijeno.length} upisa sa telefona server nije primio`} — odgovorno
            lice je obaviješteno.
          </span>
          <button className="small-action" onClick={() => setOtvoreno((o) => !o)}>{otvoreno ? "Sakrij" : "Pogledaj"}</button>
        </div>
      )}
      {otvoreno && odbijeno.length > 0 && (
        <div className="panel izlaz-odbijeno">
          {odbijeno.map((s) => (
            <div key={s.kljuc} className="izlaz-odbijeno-red">
              <div>
                <strong>{s.opis}</strong> <span className="muted-text">· urađeno {sat(s.uradjenoAt)}</span>
                <div className="temp-upozorenje">{s.greska}</div>
                <div className="muted-text" style={{ fontSize: 10 }}>
                  {s.javljeno ? "Odgovorno lice je obaviješteno." : "Javlja se odgovornom licu čim bude mreže."} Ako je radnja stvarno obavljena, dogovorite
                  se sa njim kako da se upiše.
                </div>
              </div>
              <button className="small-action" onClick={() => ukloniIzIzlaza(s.kljuc)} disabled={!s.javljeno} title={s.javljeno ? undefined : "Prvo mora stići do odgovornog lica"}>
                Ukloni sa telefona
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
