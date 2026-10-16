import { useState, type FormEvent } from "react";
import { LockKeyhole, ShieldCheck, AlertCircle, Smartphone } from "lucide-react";
import { useAuth } from "../lib/auth";
import { ApiGreska } from "../lib/api";

export function Prijava() {
  const { prijavi, potvrdiKod } = useAuth();
  const [korisnickoIme, setKorisnickoIme] = useState("");
  const [lozinka, setLozinka] = useState("");
  const [greska, setGreska] = useState("");
  const [saljem, setSaljem] = useState(false);
  // Drugi korak (#81): lozinka je tačna, sesija se daje tek uz kod iz aplikacije ili rezervni kod.
  const [izazov, setIzazov] = useState<string | null>(null);
  const [kod, setKod] = useState("");

  const posalji = async (event: FormEvent) => {
    event.preventDefault();
    setSaljem(true);
    setGreska("");
    try {
      const drugi = await prijavi(korisnickoIme.trim(), lozinka);
      if (drugi) {
        setIzazov(drugi.izazov);
        setLozinka("");
      }
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Prijava nije uspjela.");
    } finally {
      setSaljem(false);
    }
  };

  const posaljiKod = async (event: FormEvent) => {
    event.preventDefault();
    if (!izazov) return;
    setSaljem(true);
    setGreska("");
    try {
      await potvrdiKod(izazov, kod.trim());
    } catch (e) {
      if (e instanceof ApiGreska && e.code === "IZAZOV_ISTEKAO") {
        setIzazov(null);
        setKod("");
      }
      setGreska(e instanceof ApiGreska ? e.message : "Prijava nije uspjela.");
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
            <LockKeyhole size={19} />
          </div>
          <div>
            <div className="eyebrow">Prijava</div>
            <h1>Dobra higijenska praksa i HACCP</h1>
            <p>Prijavite se korisničkim imenom i lozinkom koje ste dobili od odgovornog lica.</p>
          </div>
        </div>
        {izazov ? (
          <form className="auth-form" onSubmit={posaljiKod}>
            {greska && (
              <div className="auth-error">
                <AlertCircle size={14} /> {greska}
              </div>
            )}
            <div className="auth-security-note" style={{ marginTop: 0 }}>
              <Smartphone size={14} />
              <span>Otvorite aplikaciju za potvrdu na telefonu (npr. Google ili Microsoft Authenticator) i upišite kod od 6 cifara za „PILOT“.</span>
            </div>
            <label>
              Kod iz aplikacije
              <input
                value={kod}
                onChange={(e) => setKod(e.target.value)}
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123 456"
                maxLength={12}
              />
            </label>
            <small className="muted-text">Nemate telefon kod sebe? Upišite jedan od rezervnih kodova (npr. ABCD-EFGH) — svaki važi jednom.</small>
            <button className="primary-button auth-submit" type="submit" disabled={saljem || kod.trim().length < 6}>
              {saljem ? "Provjeravam..." : "Potvrdi"}
            </button>
            <button className="link-button" type="button" onClick={() => { setIzazov(null); setKod(""); setGreska(""); }}>
              Nazad na korisničko ime i lozinku
            </button>
          </form>
        ) : (
        <form className="auth-form" onSubmit={posalji}>
          {greska && (
            <div className="auth-error">
              <AlertCircle size={14} /> {greska}
            </div>
          )}
          <label>
            Korisničko ime
            <input value={korisnickoIme} onChange={(e) => setKorisnickoIme(e.target.value)} autoFocus autoComplete="username" />
          </label>
          <label>
            Lozinka
            <input type="password" value={lozinka} onChange={(e) => setLozinka(e.target.value)} autoComplete="current-password" />
          </label>
          <button className="primary-button auth-submit" type="submit" disabled={saljem}>
            {saljem ? "Prijavljivanje..." : "Prijavi se"}
          </button>
        </form>
        )}
        <div className="auth-security-note">
          <ShieldCheck size={14} />
          <span>Podaci se prenose šifrovano. Lozinka se čuva samo kao heš — niko, ni konsultant, ne može da je pročita.</span>
        </div>
      </div>
    </div>
  );
}
