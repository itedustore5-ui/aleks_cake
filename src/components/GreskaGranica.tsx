import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";
import { prijaviGresku } from "../lib/greske";

/** Kad jedna strana pukne, ostatak aplikacije (meni, odjava) i dalje radi — umjesto bijelog ekrana na
 * telefonu magacionera. Greška se javlja u dnevnik (#80). `kljuc` (adresa strane) je vraća u normalu
 * čim se pređe na drugu stranu. */
export class GreskaGranica extends Component<{ kljuc: string; children: ReactNode }, { greska: Error | null; kljuc: string }> {
  state = { greska: null as Error | null, kljuc: this.props.kljuc };

  static getDerivedStateFromError(greska: Error) {
    return { greska };
  }

  static getDerivedStateFromProps(props: { kljuc: string }, state: { greska: Error | null; kljuc: string }) {
    return props.kljuc !== state.kljuc ? { greska: null, kljuc: props.kljuc } : null;
  }

  componentDidCatch(greska: Error, info: ErrorInfo) {
    prijaviGresku(greska, info.componentStack ?? undefined);
  }

  render() {
    if (!this.state.greska) return this.props.children;
    return (
      <div className="panel" style={{ minHeight: "auto", maxWidth: 560, margin: "24px auto" }} role="alert">
        <div style={{ padding: 22, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", color: "#b8434a", fontWeight: 700 }}>
            <AlertTriangle size={18} /> Ova strana je naišla na grešku
          </div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
            Ništa što je već sačuvano nije izgubljeno. Greška je zapisana i javljena konsultantu. Pokušajte ponovo — ako se ponovi, pređite na
            drugu stranu i javite šta ste radili.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="primary-button" type="button" onClick={() => window.location.reload()}>
              <RotateCcw size={14} /> Pokušaj ponovo
            </button>
            <button className="secondary-button" type="button" onClick={() => window.location.assign("/")}>
              <Home size={14} /> Početna strana
            </button>
          </div>
        </div>
      </div>
    );
  }
}
