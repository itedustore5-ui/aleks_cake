import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { api, ApiGreska } from "../lib/api";
import { stanjePush, ukljuciPush, iskljuciPush, type StanjePush } from "../lib/push";

/** Moja strana → „Obavještenja na telefon". Po uređaju: svako uključuje na svom telefonu. */
export function PushObavjestenja() {
  const [stanje, setStanje] = useState<StanjePush | null>(null);
  const [radim, setRadim] = useState(false);
  const [poruka, setPoruka] = useState("");

  useEffect(() => {
    stanjePush().then(setStanje).catch(() => setStanje("nepodrzano"));
  }, []);

  const uradi = async (fn: () => Promise<StanjePush>) => {
    setRadim(true);
    setPoruka("");
    try {
      setStanje(await fn());
    } catch (e) {
      setPoruka(e instanceof ApiGreska ? e.message : "Nije uspjelo — pokušajte ponovo.");
    } finally {
      setRadim(false);
    }
  };

  const proba = async () => {
    setPoruka("");
    await api("/push/proba", { telo: {} });
    setPoruka("Poslato — za nekoliko sekundi stiže na ovaj uređaj (i kad je ekran zaključan).");
  };

  if (!stanje) return null;

  return (
    <div className="panel" style={{ minHeight: "auto" }}>
      <div className="panel-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <BellRing size={16} /> Obavještenja na telefon
        </h2>
      </div>
      <div style={{ padding: "0 20px 20px", display: "flex", flexDirection: "column", gap: 10, fontSize: 12 }}>
        {stanje === "ukljuceno" && (
          <>
            <span>Uključeno na ovom uređaju — obavještenja stižu i kad je aplikacija zatvorena.</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="secondary-button" onClick={proba}>Pošalji probno</button>
              <button className="secondary-button" disabled={radim} onClick={() => uradi(iskljuciPush)}>Isključi na ovom uređaju</button>
            </div>
          </>
        )}
        {stanje === "iskljuceno" && (
          <>
            <span className="muted-text">Kad je uključeno, temperatura van granice, dodijeljena mjera ili poruka stižu kao obavještenje na telefon, i kad je ekran zaključan.</span>
            <div>
              <button className="primary-button" disabled={radim} onClick={() => uradi(ukljuciPush)}>
                {radim ? "Uključujem…" : "Uključi na ovom uređaju"}
              </button>
            </div>
          </>
        )}
        {stanje === "iphone-dodaj" && (
          <span className="muted-text">
            Na iPhoneu obavještenja rade samo kad je aplikacija na početnom ekranu: u Safariju dugme <b>Dijeli</b> → <b>Dodaj na početni ekran</b>, pa aplikaciju
            otvorite sa te ikone i ovdje uključite obavještenja (iOS 16.4 ili noviji).
          </span>
        )}
        {stanje === "blokirano" && (
          <span className="muted-text">Obavještenja su za ovu stranicu odbijena u pregledaču. Dozvolite ih u podešavanjima pregledača (ikona katanca pored adrese), pa osvježite stranu.</span>
        )}
        {stanje === "nepodrzano" && <span className="muted-text">Ovaj pregledač ne podržava obavještenja na telefon. Zvonce u aplikaciji i dalje radi.</span>}
        {poruka && <span className="muted-text">{poruka}</span>}
      </div>
    </div>
  );
}
