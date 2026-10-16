import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, AlertCircle, CheckCircle2 } from "lucide-react";
import { api, ApiGreska } from "../lib/api";
import { useAuth } from "../lib/auth";

type Pitanje = { id: string; tema: string; tekst: string; ponudjeni_odgovori: string[] };
type MojTermin = { otvoren: boolean; naziv: string | null; vezan: boolean; zavrseno: boolean };

/** Provjeru radi PRIJAVLJENI zaposleni, svojom šifrom (invarijanta #32) — šifra se ne kuca, server
 * je uzima iz naloga. Ulaz je sa početne strane (Moja strana / Kontrolni centar). */
export function ProvjeraZnanja() {
  const { korisnik } = useAuth();
  const [termin, setTermin] = useState<MojTermin | null>(null);
  const [ucesnikId, setUcesnikId] = useState<string | null>(null);
  const [pitanja, setPitanja] = useState<Pitanje[]>([]);
  const [indeks, setIndeks] = useState(0);
  const [rezultat, setRezultat] = useState<{ brojTacnih: number; brojPitanja: number } | null>(null);
  const [greska, setGreska] = useState("");
  const [ucitavanje, setUcitavanje] = useState(false);
  const [lozinka, setLozinka] = useState("");

  useEffect(() => {
    api<MojTermin>("/provjera-znanja/moj-termin")
      .then(setTermin)
      .catch(() => setGreska("Stanje provjere nije učitano — osvježite stranu."));
  }, []);

  const pocni = async () => {
    setGreska("");
    setUcitavanje(true);
    try {
      const odgovor = await api<{ ucesnikId: string; pitanja: Pitanje[] }>("/provjera-znanja/uci", { telo: { lozinka } });
      setLozinka("");
      setUcesnikId(odgovor.ucesnikId);
      setPitanja(odgovor.pitanja);
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Ulazak nije uspio.");
    } finally {
      setUcitavanje(false);
    }
  };

  const odaberi = async (pitanjeId: string, datIndeks: number) => {
    setGreska("");
    try {
      await api("/provjera-znanja/odgovor", { telo: { ucesnikId, pitanjeId, datIndeks } });
      if (indeks + 1 < pitanja.length) {
        setIndeks((i) => i + 1);
      } else {
        setRezultat(await api<{ brojTacnih: number; brojPitanja: number }>("/provjera-znanja/zavrsi", { telo: { ucesnikId } }));
      }
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Odgovor nije sačuvan — pokušajte ponovo.");
    }
  };

  const nazad = (
    <Link to="/" className="muted-text" style={{ display: "block", textAlign: "center", marginTop: 16, fontSize: 11 }}>
      ← Nazad u aplikaciju
    </Link>
  );

  if (rezultat) {
    return (
      <div className="auth-shell" style={{ gridTemplateColumns: "minmax(0,480px)" }}>
        <div className="auth-card" style={{ textAlign: "center" }}>
          <CheckCircle2 size={32} color="#20a477" style={{ margin: "0 auto 12px" }} />
          <h1>Provjera je završena</h1>
          <p style={{ marginTop: 10 }}>Tačno {rezultat.brojTacnih} od {rezultat.brojPitanja} pitanja. Hvala, {korisnik?.lice_ime ?? "kolega"}.</p>
          {nazad}
        </div>
      </div>
    );
  }

  if (pitanja.length > 0 && ucesnikId) {
    const trenutno = pitanja[indeks];
    return (
      <div className="auth-shell" style={{ gridTemplateColumns: "minmax(0,560px)" }}>
        <div className="auth-card">
          <div className="eyebrow">Pitanje {indeks + 1} od {pitanja.length} · {trenutno.tema}</div>
          <h1 style={{ fontSize: 20, marginTop: 10 }}>{trenutno.tekst}</h1>
          {greska && (
            <div className="auth-error" style={{ marginTop: 12 }}>
              <AlertCircle size={14} /> {greska}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
            {trenutno.ponudjeni_odgovori.map((odgovor, i) => (
              <button key={i} className="secondary-button full-width" style={{ justifyContent: "flex-start", minHeight: 44 }} onClick={() => odaberi(trenutno.id, i)}>
                {odgovor}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const moze = termin?.otvoren && termin.vezan && !termin.zavrseno;
  return (
    <div className="auth-shell" style={{ gridTemplateColumns: "minmax(0,480px)" }}>
      <div className="auth-card">
        <div className="auth-heading">
          <div className="auth-lock">
            <ShieldCheck size={19} />
          </div>
          <div>
            <div className="eyebrow">Provjera znanja</div>
            <h1>{termin?.naziv ?? "Provjera znanja"}</h1>
            <p>
              {korisnik?.lice_ime ?? korisnik?.korisnicko_ime}
            </p>
          </div>
        </div>
        {greska && (
          <div className="auth-error" style={{ marginTop: 16 }}>
            <AlertCircle size={14} /> {greska}
          </div>
        )}
        {termin && !termin.otvoren && <p style={{ marginTop: 16 }}>Trenutno nije otvorena nijedna provjera znanja.</p>}
        {termin?.otvoren && !termin.vezan && <p style={{ marginTop: 16 }}>Vaš nalog nije vezan za zaposlenog u spisku ljudi — javite se odgovornom licu.</p>}
        {termin?.otvoren && termin.zavrseno && <p style={{ marginTop: 16 }}>Ovu provjeru ste već završili.</p>}
        {moze && (
          <>
            <p className="muted-text" style={{ marginTop: 16, fontSize: 12 }}>
              Odgovarate sami, svojim nalogom. Odgovor na pitanje se ne može promijeniti.
            </p>
            <form onSubmit={(e) => { e.preventDefault(); if (lozinka) pocni(); }}>
              <label style={{ display: "block", marginTop: 12, fontSize: 12 }}>
                Potvrdite da ste to vi — upišite SVOJU lozinku
                <input type="password" autoComplete="current-password" value={lozinka} onChange={(e) => setLozinka(e.target.value)} style={{ width: "100%", marginTop: 6 }} />
              </label>
              <button type="submit" className="primary-button auth-submit" disabled={ucitavanje || !lozinka} style={{ marginTop: 14 }}>
                {ucitavanje ? "Učitavam…" : "Počni"}
              </button>
            </form>
          </>
        )}
        {nazad}
      </div>
    </div>
  );
}
