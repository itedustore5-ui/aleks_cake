import { useState, type FormEvent } from "react";
import { KeyRound, ShieldCheck, AlertCircle, LogOut } from "lucide-react";
import { useAuth } from "../lib/auth";
import { api, ApiGreska } from "../lib/api";

/** Prikazano umjesto cijele aplikacije dok korisnik ima privremenu lozinku — ne da se
 * zaobići, jer u suprotnom ostaje na lozinci koju je neko drugi upisao. */
export function PromijeniLozinku() {
  const { osvjeziKorisnika, odjavi } = useAuth();
  const [staraLozinka, setStaraLozinka] = useState("");
  const [novaLozinka, setNovaLozinka] = useState("");
  const [greska, setGreska] = useState("");
  const [saljem, setSaljem] = useState(false);

  const posalji = async (event: FormEvent) => {
    event.preventDefault();
    setSaljem(true);
    setGreska("");
    try {
      await api("/auth/promijeni-lozinku", { telo: { staraLozinka, novaLozinka } });
      await osvjeziKorisnika();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Lozinka nije promijenjena.");
    } finally {
      setSaljem(false);
    }
  };

  return (
    <div className="auth-shell" style={{ gridTemplateColumns: "minmax(0, 520px)" }}>
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark">
            <span>P</span>
          </div>
          <div className="brand-copy">
            <strong>PILOT</strong>
            <span>DISTRIBUTERI CG</span>
          </div>
        </div>
        <div className="auth-heading">
          <div className="auth-lock">
            <KeyRound size={19} />
          </div>
          <div>
            <div className="eyebrow">Prva prijava</div>
            <h1>Postavite svoju lozinku</h1>
            <p>Lozinku koju vam je dalo odgovorno lice koristite samo jednom — sada postavite svoju, koju niko drugi ne zna.</p>
          </div>
        </div>
        <form className="auth-form" onSubmit={posalji}>
          {greska && (
            <div className="auth-error">
              <AlertCircle size={14} /> {greska}
            </div>
          )}
          <label>
            Trenutna (privremena) lozinka
            <input type="password" value={staraLozinka} onChange={(e) => setStaraLozinka(e.target.value)} autoFocus autoComplete="current-password" />
          </label>
          <label>
            Nova lozinka (najmanje 10 znakova)
            <input type="password" value={novaLozinka} onChange={(e) => setNovaLozinka(e.target.value)} autoComplete="new-password" />
          </label>
          <button className="primary-button auth-submit" type="submit" disabled={saljem || novaLozinka.length < 10}>
            {saljem ? "Čuvanje..." : "Postavi lozinku i nastavi"}
          </button>
        </form>
        <div className="auth-security-note">
          <ShieldCheck size={14} />
          <span>Lozinka se čuva samo kao heš — niko, ni konsultant, ne može da je pročita.</span>
        </div>
        <button type="button" className="link-button" style={{ marginTop: 14 }} onClick={() => odjavi()}>
          <LogOut size={13} /> Odjavi se
        </button>
      </div>
    </div>
  );
}
