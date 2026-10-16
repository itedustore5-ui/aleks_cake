import { Suspense, useEffect, useState, type ReactNode } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  ArrowDownToLine,
  Boxes,
  Gauge,
  AlertTriangle,
  Truck,
  Contact,
  PackageCheck,
  History,
  FileCheck2,
  BarChart3,
  Printer,
  ShieldCheck,
  Smartphone,
  Menu,
  ChevronDown,
  LogOut,
  Bell,
  MessageSquare,
  ClipboardCheck,
  FolderCheck,
  TrendingUp,
} from "lucide-react";
import { useAuth, NAZIV_ULOGE, type Uloga } from "../lib/auth";
import { api } from "../lib/api";
import { GreskaGranica } from "./GreskaGranica";
import { Ucitavanje } from "./Zajednicko";
import { TrakaVanMreze } from "./VanMreze";
import { useIzlaz } from "../lib/izlaz";

type StavkaMenija = { putanja: string; naziv: string; ikonica: ReactNode; uloge: Uloga[] };

const STAVKE: StavkaMenija[] = [
  { putanja: "/tabla", naziv: "Kontrolni centar", ikonica: <LayoutDashboard size={18} />, uloge: ["bzr", "izvodjac", "uprava"] },
  { putanja: "/moja", naziv: "Moja strana", ikonica: <Smartphone size={18} />, uloge: ["bzr", "izvodjac", "uprava", "operater", "vozac"] },
  { putanja: "/prijem", naziv: "Prijem robe", ikonica: <ArrowDownToLine size={18} />, uloge: ["operater", "bzr", "izvodjac"] },
  { putanja: "/zalihe", naziv: "Zalihe", ikonica: <Boxes size={18} />, uloge: ["operater", "bzr", "izvodjac"] },
  { putanja: "/haccp", naziv: "HACCP / DHP", ikonica: <Gauge size={18} />, uloge: ["operater", "bzr", "izvodjac"] },
  { putanja: "/haccp-plan", naziv: "HACCP plan", ikonica: <ClipboardCheck size={18} />, uloge: ["bzr", "izvodjac"] },
  { putanja: "/isporuka", naziv: "Isporuka", ikonica: <PackageCheck size={18} />, uloge: ["vozac", "operater", "bzr", "izvodjac"] },
  { putanja: "/vozila", naziv: "Vozila", ikonica: <Truck size={18} />, uloge: ["vozac", "bzr", "izvodjac"] },
  { putanja: "/neusaglasenosti", naziv: "Neusaglašenosti", ikonica: <AlertTriangle size={18} />, uloge: ["operater", "vozac", "bzr", "izvodjac"] },
  { putanja: "/poruke", naziv: "Poruke", ikonica: <MessageSquare size={18} />, uloge: ["operater", "vozac", "bzr", "izvodjac", "uprava"] },
  { putanja: "/ljudi", naziv: "Ljudi", ikonica: <Users size={18} />, uloge: ["bzr", "izvodjac"] },
  { putanja: "/sifarnici", naziv: "Šifarnici", ikonica: <Contact size={18} />, uloge: ["bzr", "izvodjac"] },
  { putanja: "/sledljivost", naziv: "Sledljivost", ikonica: <History size={18} />, uloge: ["bzr", "izvodjac"] },
  { putanja: "/prilozi", naziv: "Prilozi", ikonica: <Printer size={18} />, uloge: ["bzr", "izvodjac"] },
  { putanja: "/izvjestaji", naziv: "Izvještaji", ikonica: <BarChart3 size={18} />, uloge: ["izvodjac"] },
  { putanja: "/stanje", naziv: "Stanje poslovanja", ikonica: <TrendingUp size={18} />, uloge: ["izvodjac"] },
  { putanja: "/inspekcija", naziv: "Za inspekciju", ikonica: <FolderCheck size={18} />, uloge: ["bzr", "izvodjac", "uprava"] },
  { putanja: "/audit", naziv: "Audit trag", ikonica: <FileCheck2 size={18} />, uloge: ["bzr", "izvodjac"] },
  { putanja: "/admin", naziv: "Podešavanje", ikonica: <ShieldCheck size={18} />, uloge: ["izvodjac"] },
];

const NASLOVI: Record<string, string> = Object.fromEntries(STAVKE.map((s) => [s.putanja, s.naziv]));

/** Link iz obavještenja ili zadatka se prikazuje samo ako uloga smije na tu stranu —
 * isti spisak kao meni, da se ne raziđu. */
export function mozeNa(uloga: Uloga, putanja: string) {
  return STAVKE.some((s) => s.putanja === putanja && s.uloge.includes(uloga));
}

/** Javlja zvoncu u zaglavlju da se broj nepročitanih promijenio. */
export const OBAVJESTENJA_PROMIJENJENA = "obavjestenja-promijenjena";
/** Javlja otvorenim listama (obavještenja, zadaci) da je stiglo nešto novo — da se osvježe same. */
export const OBAVJESTENJA_STIGLA = "obavjestenja-stigla";

const PROVJERA_MS = 30_000;

export function Layout({ children }: { children: ReactNode }) {
  const { korisnik, odjavi } = useAuth();
  const izlaz = useIzlaz();
  const odjava = async () => {
    if (izlaz.cekaju.length > 0 && !window.confirm(`Na telefonu ${izlaz.cekaju.length === 1 ? "čeka 1 upis" : `čeka ${izlaz.cekaju.length} upisa`} koji još nije poslat. Poslaće se kad se ponovo prijavite na ovom telefonu. Odjaviti se?`)) return;
    try {
      await odjavi();
    } catch {
      window.alert("Odjava traži internet — pokušajte kad bude signala.");
    }
  };
  const [sidebarOtvoren, setSidebarOtvoren] = useState(() => window.innerWidth > 760);
  const [korisnikMenu, setKorisnikMenu] = useState(false);
  const navigate = useNavigate();
  const lokacija = useLocation();
  // Traka „nema interneta“ (talas 5): magacioner inače klikne „Sačuvaj“ u podrumu hladnjače i misli da je upisano.
  const [naMrezi, setNaMrezi] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const da = () => setNaMrezi(true);
    const ne = () => setNaMrezi(false);
    window.addEventListener("online", da);
    window.addEventListener("offline", ne);
    return () => {
      window.removeEventListener("online", da);
      window.removeEventListener("offline", ne);
    };
  }, []);
  const [neprocitano, setNeprocitano] = useState(0);
  const [izdanje, setIzdanje] = useState("");

  useEffect(() => {
    api<{ izdanje: string }>("/zdravlje").then((z) => setIzdanje(z.izdanje)).catch(() => {});
  }, []);

  // Zvonce se osvježava samo — na svakih 30 s dok je aplikacija na ekranu, odmah kad se korisnik
  // vrati u nju (otključa telefon, prebaci se iz druge aplikacije), pri prelasku na drugu stranu i
  // kad Moja strana označi pročitano. Bez toga poruka poslata dok je magacioneru strana već
  // otvorena "ne stiže" — stigla je, ali je niko ne prikaže.
  useEffect(() => {
    if (!korisnik) return;
    let prethodniNajnoviji: string | null = null;
    const osvjezi = () =>
      api<{ id: string; procitano_at: string | null }[]>("/obavjestenja")
        .then((lista) => {
          setNeprocitano(lista.filter((o) => !o.procitano_at).length);
          const najnoviji = lista[0]?.id ?? null;
          if (prethodniNajnoviji !== null && najnoviji !== prethodniNajnoviji) window.dispatchEvent(new Event(OBAVJESTENJA_STIGLA));
          prethodniNajnoviji = najnoviji;
        })
        .catch(() => {});
    const kadJeVidljivo = () => {
      if (document.visibilityState === "visible") osvjezi();
    };
    osvjezi();
    const interval = window.setInterval(kadJeVidljivo, PROVJERA_MS);
    window.addEventListener(OBAVJESTENJA_PROMIJENJENA, osvjezi);
    document.addEventListener("visibilitychange", kadJeVidljivo);
    window.addEventListener("focus", kadJeVidljivo);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener(OBAVJESTENJA_PROMIJENJENA, osvjezi);
      document.removeEventListener("visibilitychange", kadJeVidljivo);
      window.removeEventListener("focus", kadJeVidljivo);
    };
  }, [korisnik, lokacija.pathname]);

  if (!korisnik) return null;
  const stavke = STAVKE.filter((s) => s.uloge.includes(korisnik.uloga));
  const naslov = NASLOVI[lokacija.pathname] ?? "PILOT Distributeri CG";

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOtvoren ? "is-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <span>P</span>
          </div>
          <div className="brand-copy">
            <strong>PILOT</strong>
            <span>DISTRIBUTERI CG</span>
          </div>
        </div>
        <nav className="main-nav">
          <div className="nav-group">
            {stavke.map((stavka) => (
              <NavLink
                key={stavka.putanja}
                to={stavka.putanja}
                className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                onClick={() => window.innerWidth <= 760 && setSidebarOtvoren(false)}
              >
                {stavka.ikonica}
                <span>{stavka.naziv}</span>
              </NavLink>
            ))}
          </div>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-status">
            <span className="status-dot" />
            <span>Sistem operativan{izdanje ? ` · izdanje ${izdanje}` : ""}</span>
          </div>
        </div>
      </aside>
      {sidebarOtvoren && <button className="sidebar-backdrop" aria-label="Zatvori meni" onClick={() => setSidebarOtvoren(false)} />}

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu" onClick={() => setSidebarOtvoren((o) => !o)}>
              <Menu size={20} />
            </button>
            <div className="breadcrumb">
              <strong>{naslov}</strong>
            </div>
          </div>
          <div className="topbar-actions">
            <button className="icon-button zvonce" onClick={() => navigate("/moja")} aria-label={neprocitano > 0 ? `Obavještenja: ${neprocitano} nepročitanih` : "Obavještenja"}>
              <Bell size={18} />
              {neprocitano > 0 && <span className="zvonce-broj">{neprocitano > 9 ? "9+" : neprocitano}</span>}
            </button>
            <div className="user-menu-wrap">
              <button className="user-menu user-menu-button" onClick={() => setKorisnikMenu((o) => !o)}>
                <div className="avatar">{(korisnik.lice_ime ?? korisnik.korisnicko_ime).slice(0, 2).toUpperCase()}</div>
                <div className="user-copy">
                  <strong>{korisnik.lice_ime ?? korisnik.korisnicko_ime}</strong>
                  <span>{NAZIV_ULOGE[korisnik.uloga]}</span>
                </div>
                <ChevronDown size={15} className={`muted-icon ${korisnikMenu ? "rotate-180" : ""}`} />
              </button>
              {korisnikMenu && (
                <div className="user-account-menu">
                  <div className="account-identity">
                    <div className="avatar">{(korisnik.lice_ime ?? korisnik.korisnicko_ime).slice(0, 2).toUpperCase()}</div>
                    <div>
                      <strong>{korisnik.lice_ime ?? korisnik.korisnicko_ime}</strong>
                      <span>{korisnik.korisnicko_ime}</span>
                    </div>
                  </div>
                  <button className="logout-button" onClick={() => void odjava()}>
                    <LogOut size={15} /> Odjava
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="page-content">
          {/* Bez mreže (talas 6, #85): šta se čuva na telefonu, šta čeka, šta server nije primio. */}
          <TrakaVanMreze naMrezi={naMrezi} />
          <GreskaGranica kljuc={lokacija.pathname}>
            {/* Strana se učitava tek kad se otvori (talas 6) — meni ostaje dok stiže. */}
            <Suspense fallback={<Ucitavanje />}>{children}</Suspense>
          </GreskaGranica>
        </div>
      </main>
    </div>
  );
}
