import { Navigate, Route, Routes, BrowserRouter } from "react-router-dom";
import { lazy, Suspense, type ReactNode } from "react";
import { AuthProvider, useAuth, type Uloga } from "./lib/auth";
import { Layout } from "./components/Layout";
import { Ucitavanje } from "./components/Zajednicko";
import { Prijava } from "./pages/Prijava";

// Strane se učitavaju tek kad se otvore (talas 6) — prvi paket je okvir, prijava i React; ostalo po strani.
// Service worker ih ipak sve čuva unaprijed (offline-spisak.json), pa rade i bez mreže.
const Tabla = lazy(() => import("./pages/Tabla").then((m) => ({ default: m.Tabla })));
const Ljudi = lazy(() => import("./pages/Ljudi").then((m) => ({ default: m.Ljudi })));
const Sifarnici = lazy(() => import("./pages/Sifarnici").then((m) => ({ default: m.Sifarnici })));
const Prijem = lazy(() => import("./pages/Prijem").then((m) => ({ default: m.Prijem })));
const Zalihe = lazy(() => import("./pages/Zalihe").then((m) => ({ default: m.Zalihe })));
const Haccp = lazy(() => import("./pages/Haccp").then((m) => ({ default: m.Haccp })));
const HaccpPlan = lazy(() => import("./pages/HaccpPlan").then((m) => ({ default: m.HaccpPlan })));
const Neusaglasenosti = lazy(() => import("./pages/Neusaglasenosti").then((m) => ({ default: m.Neusaglasenosti })));
const Vozila = lazy(() => import("./pages/Vozila").then((m) => ({ default: m.Vozila })));
const Isporuka = lazy(() => import("./pages/Isporuka").then((m) => ({ default: m.Isporuka })));
const OtpremnicaStampa = lazy(() => import("./pages/OtpremnicaStampa").then((m) => ({ default: m.OtpremnicaStampa })));
const Moja = lazy(() => import("./pages/Moja").then((m) => ({ default: m.Moja })));
const Poruke = lazy(() => import("./pages/Poruke").then((m) => ({ default: m.Poruke })));
const Sledljivost = lazy(() => import("./pages/Sledljivost").then((m) => ({ default: m.Sledljivost })));
const Prilozi = lazy(() => import("./pages/Prilozi").then((m) => ({ default: m.Prilozi })));
const Izvjestaji = lazy(() => import("./pages/Izvjestaji").then((m) => ({ default: m.Izvjestaji })));
const StanjePoslovanja = lazy(() => import("./pages/StanjePoslovanja").then((m) => ({ default: m.StanjePoslovanja })));
const Inspekcija = lazy(() => import("./pages/Inspekcija").then((m) => ({ default: m.Inspekcija })));
const Audit = lazy(() => import("./pages/Audit").then((m) => ({ default: m.Audit })));
const ProvjeraZnanja = lazy(() => import("./pages/ProvjeraZnanja").then((m) => ({ default: m.ProvjeraZnanja })));
const Admin = lazy(() => import("./pages/Admin").then((m) => ({ default: m.Admin })));
import { PromijeniLozinku } from "./pages/PromijeniLozinku";
import { ObaveznaDvaKoraka } from "./components/DvaKoraka";

function Zasticeno({ uloge, children }: { uloge?: Uloga[]; children: ReactNode }) {
  const { korisnik, ucitavanje } = useAuth();
  if (ucitavanje) return <Ucitavanje />;
  if (!korisnik) return <Navigate to="/prijava" replace />;
  if (korisnik.mora_promijeniti_lozinku) return <PromijeniLozinku />;
  if (korisnik.mora2fa) return <ObaveznaDvaKoraka />;
  if (uloge && !uloge.includes(korisnik.uloga)) return <Navigate to="/moja" replace />;
  return <Layout>{children}</Layout>;
}

/** Prijava obavezna, ali bez menija — provjera znanja je preko cijelog ekrana (telefon). */
function SamoPrijavljen({ children }: { children: ReactNode }) {
  const { korisnik, ucitavanje } = useAuth();
  if (ucitavanje) return <Ucitavanje />;
  if (!korisnik) return <Navigate to="/prijava" replace />;
  if (korisnik.mora_promijeniti_lozinku) return <PromijeniLozinku />;
  if (korisnik.mora2fa) return <ObaveznaDvaKoraka />;
  return <>{children}</>;
}

function PocetnaPreusmjeri() {
  const { korisnik, ucitavanje } = useAuth();
  if (ucitavanje) return <Ucitavanje />;
  if (!korisnik) return <Navigate to="/prijava" replace />;
  const cilj = korisnik.uloga === "bzr" || korisnik.uloga === "izvodjac" || korisnik.uloga === "uprava" ? "/tabla" : "/moja";
  return <Navigate to={cilj} replace />;
}

function Rute() {
  const { korisnik, ucitavanje } = useAuth();
  return (
    <Suspense fallback={<Ucitavanje />}>
    <Routes>
      <Route path="/prijava" element={ucitavanje ? <Ucitavanje /> : korisnik ? <Navigate to="/" replace /> : <Prijava />} />
      <Route path="/provjera-znanja" element={<SamoPrijavljen><ProvjeraZnanja /></SamoPrijavljen>} />
      <Route path="/" element={<PocetnaPreusmjeri />} />
      <Route path="/tabla" element={<Zasticeno uloge={["bzr", "izvodjac", "uprava"]}><Tabla /></Zasticeno>} />
      <Route path="/moja" element={<Zasticeno><Moja /></Zasticeno>} />
      <Route path="/poruke" element={<Zasticeno uloge={["operater", "vozac", "bzr", "izvodjac", "uprava"]}><Poruke /></Zasticeno>} />
      <Route path="/ljudi" element={<Zasticeno uloge={["bzr", "izvodjac"]}><Ljudi /></Zasticeno>} />
      <Route path="/sifarnici" element={<Zasticeno uloge={["bzr", "izvodjac"]}><Sifarnici /></Zasticeno>} />
      <Route path="/prijem" element={<Zasticeno uloge={["operater", "bzr", "izvodjac"]}><Prijem /></Zasticeno>} />
      <Route path="/zalihe" element={<Zasticeno uloge={["operater", "bzr", "izvodjac"]}><Zalihe /></Zasticeno>} />
      <Route path="/haccp" element={<Zasticeno uloge={["operater", "bzr", "izvodjac"]}><Haccp /></Zasticeno>} />
      <Route path="/haccp-plan" element={<Zasticeno uloge={["bzr", "izvodjac"]}><HaccpPlan /></Zasticeno>} />
      <Route path="/neusaglasenosti" element={<Zasticeno uloge={["operater", "vozac", "bzr", "izvodjac"]}><Neusaglasenosti /></Zasticeno>} />
      <Route path="/vozila" element={<Zasticeno uloge={["vozac", "bzr", "izvodjac"]}><Vozila /></Zasticeno>} />
      <Route path="/isporuka" element={<Zasticeno uloge={["vozac", "operater", "bzr", "izvodjac"]}><Isporuka /></Zasticeno>} />
      <Route path="/isporuka/:id/otpremnica" element={<Zasticeno uloge={["vozac", "operater", "bzr", "izvodjac"]}><OtpremnicaStampa /></Zasticeno>} />
      <Route path="/sledljivost" element={<Zasticeno uloge={["bzr", "izvodjac"]}><Sledljivost /></Zasticeno>} />
      <Route path="/prilozi" element={<Zasticeno uloge={["bzr", "izvodjac"]}><Prilozi /></Zasticeno>} />
      <Route path="/izvjestaji" element={<Zasticeno uloge={["izvodjac"]}><Izvjestaji /></Zasticeno>} />
      <Route path="/stanje" element={<Zasticeno uloge={["izvodjac"]}><StanjePoslovanja /></Zasticeno>} />
      <Route path="/inspekcija" element={<Zasticeno uloge={["bzr", "izvodjac", "uprava"]}><Inspekcija /></Zasticeno>} />
      <Route path="/audit" element={<Zasticeno uloge={["bzr", "izvodjac"]}><Audit /></Zasticeno>} />
      <Route path="/admin" element={<Zasticeno uloge={["izvodjac"]}><Admin /></Zasticeno>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Rute />
      </AuthProvider>
    </BrowserRouter>
  );
}
