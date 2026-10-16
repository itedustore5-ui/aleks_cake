import { useEffect, useState, type FormEvent } from "react";
import { ShieldCheck, ShieldAlert, Smartphone, Copy, Printer, LogOut } from "lucide-react";
import { api, ApiGreska } from "../lib/api";
import { useAuth } from "../lib/auth";

type Stanje = { dozvoljeno: boolean; obavezno: boolean; ukljuceno: boolean; ukljucenoAt: string | null; rezervnihPreostalo: number };
type Pocetak = { tajna: string; otpauth: string; qr: string };

/** Potvrda u dva koraka (#81) — panel na Mojoj strani za vodstvo. Tok: lozinka → QR kod u aplikaciji
 * na telefonu → kod od 6 cifara → rezervni kodovi (prikazuju se JEDNOM). */
export function DvaKoraka({ poslije }: { poslije?: () => void }) {
  const [stanje, setStanje] = useState<Stanje | null>(null);
  const [korak, setKorak] = useState<"mir" | "lozinka" | "skeniraj" | "rezervni" | "iskljuci">("mir");
  const [lozinka, setLozinka] = useState("");
  const [kod, setKod] = useState("");
  const [pocetak, setPocetak] = useState<Pocetak | null>(null);
  const [rezervni, setRezervni] = useState<string[]>([]);
  const [sacuvao, setSacuvao] = useState(false);
  const [greska, setGreska] = useState("");
  const [saljem, setSaljem] = useState(false);

  const ucitaj = () => api<Stanje>("/auth/2fa").then(setStanje).catch(() => setStanje(null));
  useEffect(() => {
    void ucitaj();
  }, []);
  // Traka na Kontrolnom centru vodi na /moja#dva-koraka — panel se sam pokaže.
  // Ponavlja se dok se Moja strana ne učita do kraja — liste iznad stižu kasnije i guraju panel naniže.
  useEffect(() => {
    if (!stanje?.dozvoljeno || window.location.hash !== "#dva-koraka") return;
    const pomjeri = () => document.getElementById("dva-koraka")?.scrollIntoView({ block: "start" });
    const tajmeri = [0, 600, 1500, 3000].map((ms) => window.setTimeout(pomjeri, ms));
    return () => tajmeri.forEach((t) => window.clearTimeout(t));
  }, [stanje?.dozvoljeno]);

  if (!stanje || !stanje.dozvoljeno) return null;

  const izvrsi = async (rad: () => Promise<void>) => {
    setSaljem(true);
    setGreska("");
    try {
      await rad();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Nije uspjelo — pokušajte ponovo.");
    } finally {
      setSaljem(false);
    }
  };

  const pocni = (e: FormEvent) => {
    e.preventDefault();
    void izvrsi(async () => {
      setPocetak(await api<Pocetak>("/auth/2fa/pocni", { telo: { lozinka } }));
      setLozinka("");
      setKorak("skeniraj");
    });
  };

  const potvrdi = (e: FormEvent) => {
    e.preventDefault();
    void izvrsi(async () => {
      const r = await api<{ rezervniKodovi: string[] }>("/auth/2fa/potvrdi", { telo: { kod: kod.trim() } });
      setRezervni(r.rezervniKodovi);
      setKod("");
      setPocetak(null);
      setKorak("rezervni");
    });
  };

  const iskljuci = (e: FormEvent) => {
    e.preventDefault();
    void izvrsi(async () => {
      await api("/auth/2fa/iskljuci", { telo: { lozinka, kod: kod.trim() } });
      setLozinka("");
      setKod("");
      setKorak("mir");
      await ucitaj();
      poslije?.();
    });
  };

  const zavrsi = async () => {
    setRezervni([]);
    setSacuvao(false);
    setKorak("mir");
    await ucitaj();
    poslije?.();
  };

  const tajnaCitljivo = pocetak?.tajna.replace(/(.{4})/g, "$1 ").trim();

  return (
    <div className="panel" style={{ minHeight: "auto" }} id="dva-koraka">
      <div className="panel-header">
        <h2>
          {stanje.ukljuceno ? <ShieldCheck size={14} style={{ verticalAlign: "-2px", marginRight: 6, color: "#1e7f55" }} /> : <ShieldAlert size={14} style={{ verticalAlign: "-2px", marginRight: 6, color: "#b8434a" }} />}
          Potvrda u dva koraka
        </h2>
      </div>
      <div style={{ padding: "0 20px 20px", display: "grid", gap: 12, fontSize: 13, lineHeight: 1.5 }}>
        {greska && <div className="auth-error">{greska}</div>}

        {korak === "mir" && !stanje.ukljuceno && (
          <>
            <p style={{ margin: 0 }}>
              Vaš nalog vidi sve podatke firme. Uz potvrdu u dva koraka, ukradena ili pogođena lozinka nije dovoljna — pri prijavi treba i kod sa
              vašeg telefona.{stanje.obavezno ? " Za vašu ulogu je obavezna." : ""}
            </p>
            <button className="primary-button" type="button" onClick={() => setKorak("lozinka")}>
              <Smartphone size={14} /> Uključi
            </button>
          </>
        )}

        {korak === "mir" && stanje.ukljuceno && (
          <>
            <p style={{ margin: 0 }}>
              Uključena{stanje.ukljucenoAt ? ` od ${new Date(stanje.ukljucenoAt).toLocaleDateString("sr-Latn-ME")}` : ""} — rezervnih kodova ostalo:{" "}
              <strong>{stanje.rezervnihPreostalo}</strong>
              {stanje.rezervnihPreostalo <= 2 ? " — malo; isključite pa ponovo uključite da dobijete nove." : "."}
            </p>
            <button className="secondary-button" type="button" onClick={() => setKorak("iskljuci")}>
              Isključi (novi telefon)
            </button>
          </>
        )}

        {korak === "lozinka" && (
          <form className="form-grid" style={{ gridTemplateColumns: "1fr", padding: 0 }} onSubmit={pocni}>
            <label>
              Vaša lozinka
              <input type="password" value={lozinka} onChange={(e) => setLozinka(e.target.value)} autoFocus autoComplete="current-password" />
            </label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="primary-button" type="submit" disabled={saljem || !lozinka}>Dalje</button>
              <button className="secondary-button" type="button" onClick={() => { setKorak("mir"); setLozinka(""); setGreska(""); }}>Odustani</button>
            </div>
          </form>
        )}

        {korak === "skeniraj" && pocetak && (
          <form className="form-grid" style={{ gridTemplateColumns: "1fr", padding: 0 }} onSubmit={potvrdi}>
            <ol style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
              <li>Na telefonu instalirajte aplikaciju za potvrdu (Google Authenticator ili Microsoft Authenticator — besplatne).</li>
              <li>U aplikaciji: <strong>dodaj nalog → skeniraj QR kod</strong>, pa uperite kameru ovdje.</li>
              <li>Upišite kod od 6 cifara koji aplikacija pokaže.</li>
            </ol>
            <img src={pocetak.qr} alt="QR kod za aplikaciju za potvrdu" width={200} height={200} style={{ background: "#fff", padding: 6, border: "1px solid #dfe7ed", borderRadius: 8 }} />
            <small className="muted-text">
              Ne može skeniranje? U aplikaciji izaberite „unesi ključ“ i upišite: <code style={{ userSelect: "all" }}>{tajnaCitljivo}</code>
            </small>
            <label>
              Kod iz aplikacije
              <input value={kod} onChange={(e) => setKod(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123 456" maxLength={8} autoFocus />
            </label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="primary-button" type="submit" disabled={saljem || kod.replace(/\s/g, "").length !== 6}>Potvrdi i uključi</button>
              <button className="secondary-button" type="button" onClick={() => { setKorak("mir"); setPocetak(null); setKod(""); setGreska(""); }}>Odustani</button>
            </div>
          </form>
        )}

        {korak === "rezervni" && (
          <>
            <div className="auth-security-note" style={{ marginTop: 0 }}>
              <ShieldCheck size={14} />
              <span>Uključeno. Sačuvajte rezervne kodove — sada se prikazuju jedini put. Svaki važi jednom, kad telefon nije kod vas.</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, fontFamily: "monospace", fontSize: 15 }}>
              {rezervni.map((r) => <div key={r} style={{ padding: "6px 10px", background: "#f2f4f5", borderRadius: 6, textAlign: "center" }}>{r}</div>)}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="secondary-button" type="button" onClick={() => void navigator.clipboard?.writeText(rezervni.join("\n"))}><Copy size={14} /> Kopiraj</button>
              <button className="secondary-button" type="button" onClick={() => window.print()}><Printer size={14} /> Odštampaj</button>
            </div>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={sacuvao} onChange={(e) => setSacuvao(e.target.checked)} /> Sačuvao/la sam rezervne kodove na sigurnom mjestu
            </label>
            <button className="primary-button" type="button" disabled={!sacuvao} onClick={() => void zavrsi()}>Gotovo</button>
          </>
        )}

        {korak === "iskljuci" && (
          <form className="form-grid" style={{ gridTemplateColumns: "1fr", padding: 0 }} onSubmit={iskljuci}>
            <p style={{ margin: 0 }}>Za novi telefon: isključite, pa odmah ponovo uključite sa novim telefonom.</p>
            <label>
              Vaša lozinka
              <input type="password" value={lozinka} onChange={(e) => setLozinka(e.target.value)} autoComplete="current-password" autoFocus />
            </label>
            <label>
              Kod iz aplikacije ili rezervni kod
              <input value={kod} onChange={(e) => setKod(e.target.value)} autoComplete="one-time-code" maxLength={12} />
            </label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button className="primary-button" type="submit" disabled={saljem || !lozinka || kod.trim().length < 6}>Isključi</button>
              <button className="secondary-button" type="button" onClick={() => { setKorak("mir"); setLozinka(""); setKod(""); setGreska(""); }}>Odustani</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/** Kad je za ulogu 2FA obavezna (OBAVEZNA_2FA), a nije uključena — prikazuje se umjesto cijele
 * aplikacije, kao i obavezna promjena lozinke. Server u tom stanju ionako odbija sve ostalo. */
export function ObaveznaDvaKoraka() {
  const { osvjeziKorisnika, odjavi } = useAuth();
  return (
    <div className="auth-shell" style={{ gridTemplateColumns: "minmax(0, 560px)" }}>
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-mark"><span>P</span></div>
          <div className="brand-copy"><strong>PILOT</strong><span>DISTRIBUTERI CG</span></div>
        </div>
        <div className="auth-heading">
          <div className="auth-lock"><ShieldAlert size={19} /></div>
          <div>
            <div className="eyebrow">Obavezno za vašu ulogu</div>
            <h1>Uključite potvrdu u dva koraka</h1>
            <p>Vaš nalog vidi sve podatke firme. Prije nastavka uključite potvrdu kodom sa telefona — traje dva minuta.</p>
          </div>
        </div>
        <DvaKoraka poslije={() => void osvjeziKorisnika()} />
        <button className="link-button" type="button" style={{ marginTop: 12 }} onClick={() => void odjavi()}>
          <LogOut size={13} /> Odjavi se
        </button>
      </div>
    </div>
  );
}
