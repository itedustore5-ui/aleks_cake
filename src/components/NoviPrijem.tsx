// Novi prijem robe (P1, KKT 1) — forma za magacionera, prvo za telefon.
//
// Tok je u četiri koraka, istim redom kojim se radi na rampi:
//   0. Kako unosite: slika otpremnice / PDF / ručno. Otpremnica samo POPUNI formu (invarijanta #37).
//   1. Dobavljač i dokument — prepoznat po PIB-u; nov upisuje SAMO odgovorno lice (#71), magacioner
//      mu javlja jednim dugmetom i osvježi spisak.
//   2. Roba — po stavka: artikal (ili nov, #73 — sa otpremnice se predlaže sam), lot, rok, količina.
//   3. Temperatura — JEDNOM po grupi robe istog režima (rashlađeno, smrznuto), sa odmah vidljivom
//      ocjenom; „različito po stavci“ ostaje kao izbor. Server i dalje prima temperaturu po stavci.
//   4. Potvrda — kvačica „uporedio sa robom“ kad je forma popunjena sa otpremnice.
// „Sačuvaj“ nikad nije sivo bez objašnjenja: kad nešto fali, piše ŠTA i skroluje do tog polja.
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, FileText, PenLine, CheckCircle2, AlertTriangle, Plus, Trash2, Thermometer, Snowflake, Loader2 } from "lucide-react";
import { api, ApiGreska, posaljiFajl } from "../lib/api";
import { useSlanje, noviKljuc } from "../lib/slanje";
import { IzborTermometra, useIzborTermometra } from "./Termometar";
import { lokalniDatum } from "../lib/vrijeme";
import { Modal, ZakonskaOznaka } from "./Zajednicko";
import type { Skladiste } from "../lib/skladista";

export type DobavljacPrijema = { id: string; naziv: string };
export type ArtikalPrijema = {
  id: string;
  naziv: string;
  jedinica_mjere?: string | null;
  temp_kontrolisano: boolean;
  temp_min?: string | number | null;
  temp_max?: string | number | null;
  granica_potvrdio?: boolean;
  rok_obavezan?: boolean;
};

type PoOtpremnici = { sifra?: string | null; naziv?: string | null; kolicina?: number | null; lot?: string | null; rok?: string | null; jm?: string | null };
type Rezim = "rashladjeno" | "smrznuto" | "bez";

type Red = {
  kljuc: number;
  /** "" = nije izabran, NOVI = nov artikal (nije u Šifarnicima), inače id. */
  artikalId: string;
  novi: { naziv: string; jedinicaMjere: string; rezim: Rezim | "" };
  brojLota: string;
  rokTrajanja: string;
  kolicina: string;
  /** Samo kad je izabrano „različito po stavci“. */
  temperatura: string;
  po?: PoOtpremnici;
  /** Polja koja je aplikacija nesigurno pročitala — žuta dok ih magacioner ne dirne. */
  nesigurno: string[];
  napomena: string | null;
  zapamceno: boolean;
  /** Odakle je pretpostavljen režim novog artikla (sa otpremnice) — prikazuje se uz izbor. */
  rezimPo: "naziv" | "temperatura" | "dobavljac" | null;
};

type PrijedlogStavke = {
  sifra: string | null;
  naziv: string | null;
  jm: string | null;
  kolicina: number | null;
  lot: string | null;
  rok: string | null;
  nesigurno: string[];
  artikalId: string | null;
  artikalSigurno: boolean;
  artikalNapomena: string | null;
  noviArtikal?: { naziv: string; jedinicaMjere: string; rezim: Rezim | null; rezimPo: "naziv" | "temperatura" | "dobavljac" | null } | null;
  rokIstekao: boolean;
};
type Prijedlog = {
  strana: number;
  broj: string | null;
  datum: string | null;
  temperaturaNaOtpremnici: number | null;
  dobavljac: { id: string | null; naziv: string | null; pib: string | null; sigurno: boolean };
  stavke: PrijedlogStavke[];
  upozorenja: string[];
};
type Procitano = { dokumentId: string; vrsta: "pdf" | "slika"; otpremnice: Prijedlog[]; pouzdanostOcr: number | null; nijeProcitano?: string | null };
/** Odgovor servera dok čita u pozadini (#76): „cita“ sa napretkom, pa „gotovo“ ili „prekinuto“. */
type StanjeCitanja = Procitano & { status: "cita" | "gotovo" | "prekinuto"; prolaz?: number; opis?: string; sekundi?: number };
type Napredak = { faza: "priprema" | "saljem" | "cita"; od: number; opis?: string; prolaz?: number };
/** Najduže što forma čeka čitanje — posle toga prelazi na ručni unos (fajl ostaje uz prijem). */
const NAJDUZE_CEKANJE_MS = 180_000;

const NOVI = "__novi";
const ZUTO = { background: "#fff6d6", borderColor: "#e0b400" };
/** Pretpostavljena granica novog artikla — ista kao na serveru (GRANICA_REZIMA), nepotvrđena. */
const GRANICA_REZIMA = { rashladjeno: { min: 0, max: 4 }, smrznuto: { min: -25, max: -18 } } as const;
const JEDINICE = ["kom", "kg", "l", "pak", "kut"];

let brojac = 0;
const prazanRed = (): Red => ({
  kljuc: ++brojac,
  artikalId: "",
  novi: { naziv: "", jedinicaMjere: "kom", rezim: "" },
  brojLota: "",
  rokTrajanja: "",
  kolicina: "",
  temperatura: "",
  nesigurno: [],
  napomena: null,
  zapamceno: false,
  rezimPo: null,
});

/** 1 stavka · 2 stavke · 5 stavki */
const stavkiPadez = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "stavka" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "stavke" : "stavki"}`;
const broj = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
const uBroj = (s: string) => (s.trim() === "" ? NaN : Number(s.trim().replace(",", ".")));
const stepen = (n: number) => `${n.toLocaleString("sr-Latn-ME")} °C`;

type Granica = { min: number | null; max: number | null; potvrdjena: boolean };
/** Grupa za jedno mjerenje: vrsta robe (rashlađeno / smrznuto), ne tačna granica — jogurt 0–5 °C i
 * file 0–4 °C se mjere jednom, a svaki se ocjenjuje po SVOJOJ granici. */
const kategorija = (g: Granica) =>
  g.max !== null && g.max <= -10 ? "smrznuto" : g.max !== null && g.max <= 10 ? "rashladjeno" : `drugo:${g.min ?? ""}|${g.max ?? ""}`;
const NAZIV_KATEGORIJE: Record<string, string> = { smrznuto: "Smrznuta roba", rashladjeno: "Rashlađena roba" };
const opseg = (g: Granica) =>
  g.min !== null && g.max !== null ? `${stepen(g.min)} do ${stepen(g.max)}` : g.max !== null ? `najviše ${stepen(g.max)}` : g.min !== null ? `najmanje ${stepen(g.min)}` : "granica nije upisana";
const uGranici = (g: Granica, v: number) => (g.min === null || v >= g.min) && (g.max === null || v <= g.max);
type Clan = { naziv: string; granica: Granica };

/** Fotografija sa telefona je 3–8 MB. Šalje se duža strana od 2200 px (A4 ≈ 190 dpi): izmjereno jednako
 * tačno kao 3200 px, a slanje i čitanje su brži — na slabom signalu u magacinu i na slabom serveru to je
 * razlika između nekoliko sekundi i „beskonačnog učitavanja“. Crtanje preko platna usput okrene sliku
 * kako je telefon snimio (EXIF). */
async function pripremiSliku(fajl: File): Promise<Blob> {
  if (!fajl.type.startsWith("image/") || typeof createImageBitmap !== "function") return fajl;
  try {
    const slika = await createImageBitmap(fajl);
    const razmjera = Math.min(1, 2200 / Math.max(slika.width, slika.height));
    const platno = document.createElement("canvas");
    platno.width = Math.round(slika.width * razmjera);
    platno.height = Math.round(slika.height * razmjera);
    platno.getContext("2d")!.drawImage(slika, 0, 0, platno.width, platno.height);
    return await new Promise<Blob>((ok) => platno.toBlob((b) => ok(b ?? fajl), "image/jpeg", 0.85));
  } catch {
    return fajl;
  }
}

export function NoviPrijemModal({
  dobavljaci: pocetniDobavljaci,
  mozeNovogDobavljaca,
  artikli,
  skladista,
  podrazumijevanoSkladiste,
  onClose,
  onCreated,
}: {
  dobavljaci: DobavljacPrijema[];
  /** Novog dobavljača upisuje samo odgovorno lice (i konsultant) — #71. */
  mozeNovogDobavljaca: boolean;
  artikli: ArtikalPrijema[];
  /** Prazno kad firma ima jedno skladište — tada se polje ne prikazuje. */
  skladista: Skladiste[];
  podrazumijevanoSkladiste: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [nacin, setNacin] = useState<"" | "otpremnica" | "rucno">("");
  const [dobavljaci, setDobavljaci] = useState(pocetniDobavljaci);
  const [javljeno, setJavljeno] = useState<"" | "saljem" | "javljeno">("");
  // Nikad prvi sa spiska: prijem bi tiho otišao pogrešnom dobavljaču.
  const [dobavljacId, setDobavljacId] = useState("");
  const [noviDobavljac, setNoviDobavljac] = useState({ naziv: "", pib: "" });
  const [skladisteId, setSkladisteId] = useState(podrazumijevanoSkladiste);
  const [brojDokumenta, setBrojDokumenta] = useState("");
  const [datum, setDatum] = useState(lokalniDatum());
  const [redovi, setRedovi] = useState<Red[]>([prazanRed()]);
  const [temperatureGrupa, setTemperatureGrupa] = useState<Record<string, string>>({});
  const [poStavci, setPoStavci] = useState(false);
  const [greska, setGreska] = useState("");
  const [pokusano, setPokusano] = useState(false);
  // Otpremnica
  const [citam, setCitam] = useState<"" | "pdf" | "slika">("");
  const [napredak, setNapredak] = useState<Napredak | null>(null);
  const [sekunde, setSekunde] = useState(0);
  // Tekuće čitanje — da „Ne čekaj“ i zatvaranje forme mogu da ga prekinu.
  const citanjeRef = useRef<{ dokumentId: string | null; odustao: boolean } | null>(null);
  const [procitano, setProcitano] = useState<Procitano | null>(null);
  const [prijedlog, setPrijedlog] = useState<Prijedlog | null>(null);
  const [poruka, setPoruka] = useState<string | null>(null);
  const [uporedjeno, setUporedjeno] = useState(false);
  const { termometri, termometarId, setTermometarId } = useIzborTermometra();
  const [upozorenja, setUpozorenja] = useState<string[]>([]);

  // OCR se pali unaprijed, dok magacioner slika — prvo čitanje ne čeka paljenje (#76).
  useEffect(() => {
    api("/prijem/otpremnica-priprema", { method: "POST" }).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!napredak) return;
    setSekunde(Math.round((Date.now() - napredak.od) / 1000));
    const t = setInterval(() => setSekunde(Math.round((Date.now() - napredak.od) / 1000)), 1000);
    return () => clearInterval(t);
  }, [napredak?.od]);

  const artikal = (id: string) => artikli.find((a) => a.id === id);
  const azuriraj = (kljuc: number, izmjena: Partial<Red>, polje?: string) =>
    setRedovi((rr) => rr.map((r) => (r.kljuc === kljuc ? { ...r, ...izmjena, nesigurno: polje ? r.nesigurno.filter((p) => p !== polje) : r.nesigurno } : r)));

  // ── Otpremnica ────────────────────────────────────────────────────────────────────────────
  const primijeni = (p: Prijedlog) => {
    setPrijedlog(p);
    setUporedjeno(false);
    setNacin("otpremnica");
    if (p.dobavljac.id) setDobavljacId(p.dobavljac.id);
    else if (p.dobavljac.naziv && mozeNovogDobavljaca) {
      setDobavljacId(NOVI);
      setNoviDobavljac({ naziv: p.dobavljac.naziv, pib: p.dobavljac.pib ?? "" });
    } else setDobavljacId("");
    setJavljeno("");
    setBrojDokumenta(p.broj ?? "");
    if (p.stavke.length === 0) {
      setRedovi([prazanRed()]);
      setPoruka("Broj i dobavljač su pročitani, ali tabela sa robom nije — upišite stavke ručno. Otpremnica je sačuvana uz prijem.");
      return;
    }
    setPoruka(null);
    setRedovi(
      p.stavke.map((s) => ({
        ...prazanRed(),
        // Nema ga u Šifarnicima → sam se postavi kao nov artikal sa otpremnice (#73); magacioner pregleda.
        artikalId: s.artikalId ?? (s.noviArtikal ? NOVI : ""),
        novi: s.noviArtikal
          ? { naziv: s.noviArtikal.naziv, jedinicaMjere: s.noviArtikal.jedinicaMjere, rezim: s.noviArtikal.rezim ?? "" }
          : { naziv: s.naziv ?? "", jedinicaMjere: "kom", rezim: "" },
        rezimPo: s.noviArtikal?.rezimPo ?? null,
        brojLota: s.lot ?? "",
        rokTrajanja: s.rok ?? "",
        kolicina: s.kolicina != null ? String(s.kolicina) : "",
        po: { sifra: s.sifra, naziv: s.naziv, kolicina: s.kolicina, lot: s.lot, rok: s.rok, jm: s.jm },
        nesigurno: [
          ...s.nesigurno.filter((n) => n !== "sifra" && n !== "jm" && (n !== "naziv" || !s.noviArtikal)),
          ...(s.artikalSigurno ? [] : ["artikal"]),
          ...(s.noviArtikal ? ["rezim"] : []),
        ],
        napomena: s.artikalNapomena,
        zapamceno: s.artikalSigurno,
      })),
    );
  };

  const ucitajOtpremnicu = async (fajl: File | undefined) => {
    if (!fajl) return;
    setGreska("");
    const vrsta = fajl.type === "application/pdf" ? "pdf" : "slika";
    setCitam(vrsta);
    const od = Date.now();
    const ovo = { dokumentId: null as string | null, odustao: false };
    citanjeRef.current = ovo;
    setNapredak({ faza: "priprema", od });
    try {
      const za = await pripremiSliku(fajl);
      if (ovo.odustao) return;
      setNapredak({ faza: "saljem", od });
      let r = await posaljiFajl<StanjeCitanja>("/prijem/otpremnica", za, fajl.name);
      ovo.dokumentId = r.dokumentId;
      if (ovo.odustao) {
        if (r.status === "cita") api(`/prijem/otpremnica/${r.dokumentId}/prekini`, { method: "POST" }).catch(() => undefined);
        return;
      }
      // Server čita u pozadini — pita se za stanje dok ne završi (napredak se vidi na ekranu).
      let greskeZaredom = 0;
      while (r.status === "cita") {
        setNapredak({ faza: "cita", od, opis: r.opis, prolaz: r.prolaz });
        if (Date.now() - od > NAJDUZE_CEKANJE_MS) {
          api(`/prijem/otpremnica/${r.dokumentId}/prekini`, { method: "POST" }).catch(() => undefined);
          r = { ...r, status: "prekinuto", otpremnice: [], nijeProcitano: "Čitanje traje predugo. Otpremnica je sačuvana uz prijem — upišite stavke ručno." };
          break;
        }
        await new Promise((ok) => setTimeout(ok, 1500));
        if (ovo.odustao) return;
        try {
          r = await api<StanjeCitanja>(`/prijem/otpremnica/${ovo.dokumentId}/stanje`);
          greskeZaredom = 0;
        } catch (e) {
          if (++greskeZaredom >= 6) throw e;
        }
      }
      if (ovo.odustao) return;
      setProcitano(r);
      if (r.otpremnice.length > 0) primijeni(r.otpremnice[0]);
      else {
        // Nije pročitana — ali nije slijepa ulica: slika ostaje uz prijem, stavke se upisuju ručno.
        setPrijedlog(null);
        setNacin("rucno");
        setPoruka(r.nijeProcitano ?? "Otpremnica nije pročitana — upišite stavke ručno. Slika je sačuvana uz prijem.");
      }
    } catch (e) {
      if (ovo.odustao) return;
      if (ovo.dokumentId) {
        // Fajl je stigao, a veza je pukla tokom čitanja: ne gubi se ništa — prilaže se, stavke ručno.
        setProcitano({ dokumentId: ovo.dokumentId, vrsta, otpremnice: [], pouzdanostOcr: null });
        setNacin((n) => (n === "" ? "rucno" : n));
        setPoruka("Veza je prekinuta tokom čitanja. Otpremnica je sačuvana uz prijem — upišite stavke ručno ili slikajte ponovo.");
      } else {
        setGreska(`${e instanceof ApiGreska ? e.message : "Otpremnica nije poslata."} Pokušajte ponovo ili izaberite „Upiši ručno“.`);
      }
    } finally {
      if (citanjeRef.current === ovo) {
        citanjeRef.current = null;
        setCitam("");
        setNapredak(null);
      }
    }
  };

  /** „Ne čekaj — upiši ručno“: čitanje staje (i na serveru), otpremnica ostaje priložena uz prijem. */
  const neCekaj = () => {
    const ovo = citanjeRef.current;
    if (!ovo) return;
    ovo.odustao = true;
    citanjeRef.current = null;
    if (ovo.dokumentId) {
      api(`/prijem/otpremnica/${ovo.dokumentId}/prekini`, { method: "POST" }).catch(() => undefined);
      // Traka iznad forme već kaže „Ručni unos — otpremnica je priložena uz prijem“.
      setProcitano({ dokumentId: ovo.dokumentId, vrsta: citam === "pdf" ? "pdf" : "slika", otpremnice: [], pouzdanostOcr: null });
      setPoruka(null);
    }
    setCitam("");
    setNapredak(null);
    setNacin((n) => (n === "" ? "rucno" : n));
  };
  const zatvori = () => {
    const ovo = citanjeRef.current;
    if (ovo) {
      ovo.odustao = true;
      if (ovo.dokumentId) api(`/prijem/otpremnica/${ovo.dokumentId}/prekini`, { method: "POST" }).catch(() => undefined);
    }
    onClose();
  };
  const opisNapretka =
    !napredak ? "" : napredak.faza === "priprema" ? "Pripremam sliku…" : napredak.faza === "saljem" ? "Šaljem otpremnicu…" : citam === "pdf" ? "Čitam PDF…" : `Čitam — ${napredak.opis ?? "čeka na red"}…`;

  // ── Dobavljač kog nema u Šifarnicima (magacioner javlja, odgovorno lice upisuje) ───────────
  const cifre = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
  const osvjeziDobavljace = async () => {
    try {
      const spisak = await api<(DobavljacPrijema & { pib?: string | null })[]>("/dobavljaci");
      setDobavljaci(spisak);
      const d = prijedlog?.dobavljac;
      const nadjen =
        (d?.pib && spisak.find((x) => cifre(x.pib) && cifre(x.pib) === cifre(d.pib))) ||
        (d?.naziv && spisak.find((x) => x.naziv.trim().toLowerCase() === d.naziv!.trim().toLowerCase()));
      if (nadjen) {
        setDobavljacId(nadjen.id);
        setGreska("");
      } else if (d?.naziv) setGreska(`„${d.naziv}“ još nije na spisku — sačekajte da ga odgovorno lice upiše, pa osvježite ponovo.`);
    } catch {
      setGreska("Spisak dobavljača nije osvježen — provjerite vezu.");
    }
  };
  const javiOdgovornom = async () => {
    const d = prijedlog?.dobavljac;
    if (!d?.naziv) return;
    setJavljeno("saljem");
    try {
      await api("/prijem/javi-dobavljaca", { telo: { naziv: d.naziv, pib: d.pib ?? undefined, brojOtpremnice: prijedlog?.broj ?? undefined } });
      setJavljeno("javljeno");
    } catch (e) {
      setJavljeno("");
      setGreska(e instanceof ApiGreska ? e.message : "Nije javljeno — provjerite vezu.");
    }
  };

  // ── Temperatura po grupi režima ───────────────────────────────────────────────────────────
  const granicaReda = (r: Red): Granica | null => {
    if (r.artikalId === NOVI) {
      if (!r.novi.rezim || r.novi.rezim === "bez") return null;
      return { ...GRANICA_REZIMA[r.novi.rezim], potvrdjena: false };
    }
    const a = artikal(r.artikalId);
    if (!a?.temp_kontrolisano) return null;
    return { min: broj(a.temp_min), max: broj(a.temp_max), potvrdjena: !!a.granica_potvrdio };
  };
  const grupe = useMemo(() => {
    const m = new Map<string, Clan[]>();
    for (const r of redovi) {
      const g = granicaReda(r);
      if (!g) continue;
      const k = kategorija(g);
      const naziv = r.artikalId === NOVI ? r.novi.naziv.trim() || "nov artikal" : artikal(r.artikalId)?.naziv ?? "";
      const clanovi = m.get(k) ?? [];
      if (!clanovi.some((c) => c.naziv === naziv)) clanovi.push({ naziv, granica: g });
      m.set(k, clanovi);
    }
    return [...m.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redovi, artikli]);
  const temperaturaReda = (r: Red) => {
    const g = granicaReda(r);
    if (!g) return undefined;
    const t = poStavci ? r.temperatura : temperatureGrupa[kategorija(g)] ?? "";
    return t.trim() === "" ? undefined : uBroj(t);
  };

  // ── Šta fali ──────────────────────────────────────────────────────────────────────────────
  const serija = (r: Red) => `${r.artikalId === NOVI ? `novi:${r.novi.naziv.trim().toLowerCase()}` : r.artikalId}|${r.brojLota.trim().toUpperCase()}`;
  const fali = useMemo(() => {
    const f: { id: string; tekst: string }[] = [];
    if (!dobavljacId) f.push({ id: "p-dobavljac", tekst: "dobavljač" });
    if (dobavljacId === NOVI) {
      if (noviDobavljac.naziv.trim().length < 2) f.push({ id: "p-novi-dobavljac", tekst: "naziv novog dobavljača" });
      if (noviDobavljac.pib.trim() && !/^\d{8,13}$/.test(noviDobavljac.pib.trim())) f.push({ id: "p-novi-pib", tekst: "PIB (samo cifre, 8–13)" });
    }
    if (!datum) f.push({ id: "p-datum", tekst: "datum prijema" });
    if (redovi.length === 0) f.push({ id: "p-dodaj", tekst: "bar jedna stavka robe" });
    redovi.forEach((r, i) => {
      const n = redovi.length > 1 ? `stavka ${i + 1}: ` : "";
      if (!r.artikalId) f.push({ id: `p-${r.kljuc}-artikal`, tekst: `${n}artikal` });
      if (r.artikalId === NOVI) {
        if (r.novi.naziv.trim().length < 2) f.push({ id: `p-${r.kljuc}-novi`, tekst: `${n}naziv novog artikla` });
        if (!r.novi.rezim) f.push({ id: `p-${r.kljuc}-rezim`, tekst: `${n}čuvanje (rashlađeno / smrznuto / bez režima)` });
      }
      if (!r.brojLota.trim()) f.push({ id: `p-${r.kljuc}-lot`, tekst: `${n}broj lota` });
      const rokObavezan = r.artikalId === NOVI || artikal(r.artikalId)?.rok_obavezan !== false;
      if (rokObavezan && !r.rokTrajanja) f.push({ id: `p-${r.kljuc}-rok`, tekst: `${n}rok trajanja` });
      if (!(uBroj(r.kolicina) > 0)) f.push({ id: `p-${r.kljuc}-kolicina`, tekst: `${n}količina` });
      if (r.brojLota.trim() && redovi.filter((x) => serija(x) === serija(r)).length > 1 && redovi.findIndex((x) => serija(x) === serija(r)) === i) {
        f.push({ id: `p-${r.kljuc}-lot`, tekst: `${n}ista serija je upisana dvaput — spojite je u jednu stavku` });
      }
      if (poStavci && granicaReda(r) && !Number.isFinite(temperaturaReda(r) ?? NaN)) f.push({ id: `p-${r.kljuc}-temp`, tekst: `${n}temperatura` });
    });
    if (!poStavci) {
      for (const [k] of grupe) {
        const t = temperatureGrupa[k] ?? "";
        if (!Number.isFinite(uBroj(t))) f.push({ id: `p-grupa-${k}`, tekst: `temperatura: ${(NAZIV_KATEGORIJE[k] ?? "roba pod režimom").toLowerCase()}` });
      }
    }
    if (prijedlog && prijedlog.stavke.length > 0 && !uporedjeno) f.push({ id: "p-uporedjeno", tekst: "kvačica „uporedio/la sam sa robom“" });
    return f;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dobavljacId, noviDobavljac, datum, redovi, grupe, temperatureGrupa, poStavci, prijedlog, uporedjeno, artikli]);
  const nedostaje = (id: string) => pokusano && fali.some((f) => f.id === id);
  const crveno = (id: string) => (nedostaje(id) ? { borderColor: "#d64545", boxShadow: "0 0 0 2px #d6454522" } : undefined);

  // ── Slanje ────────────────────────────────────────────────────────────────────────────────
  const [kljuc] = useState(noviKljuc);
  const { radim, salji } = useSlanje();
  const posalji = async () => {
    setPokusano(true);
    setGreska("");
    if (fali.length > 0) {
      const prvo = document.getElementById(fali[0].id);
      prvo?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (prvo instanceof HTMLInputElement || prvo instanceof HTMLSelectElement) setTimeout(() => prvo.focus({ preventScroll: true }), 300);
      return;
    }
    setGreska("");
    try {
      const r = await api<{ id: string; upozorenja?: string[] }>("/prijem", {
        kljuc,
        telo: {
          ...(dobavljacId === NOVI
            ? { noviDobavljac: { naziv: noviDobavljac.naziv.trim(), pib: noviDobavljac.pib.trim() || undefined } }
            : { dobavljacId }),
          skladisteId: skladisteId || undefined,
          brojDokumenta: brojDokumenta.trim() || undefined,
          datumPrijema: datum,
          dokumentId: procitano?.dokumentId,
          mjerniUredjajId: termometarId || undefined,
          stavke: redovi.map((r) => ({
            ...(r.artikalId === NOVI
              ? { noviArtikal: { naziv: r.novi.naziv.trim(), jedinicaMjere: r.novi.jedinicaMjere || "kom", rezim: r.novi.rezim || "bez" } }
              : { artikalId: r.artikalId }),
            brojLota: r.brojLota.trim(),
            rokTrajanja: r.rokTrajanja || undefined,
            primljenaKolicina: uBroj(r.kolicina),
            temperaturaPrijema: temperaturaReda(r),
            poOtpremnici: r.po ? { sifra: r.po.sifra, naziv: r.po.naziv, kolicina: r.po.kolicina, lot: r.po.lot, rok: r.po.rok } : undefined,
          })),
        },
      });
      onCreated();
      if (r.upozorenja?.length) setUpozorenja(r.upozorenja);
      else onClose();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Prijem nije sačuvan — provjerite vezu i pokušajte ponovo.");
    }
  };

  if (upozorenja.length > 0) {
    return (
      <Modal naslov="Prijem je sačuvan — provjerite" onClose={onClose} footer={<button className="primary-button" onClick={zatvori}>Zatvori</button>}>
        <div style={{ padding: 20, fontSize: 12 }}>
          {upozorenja.map((u) => <p key={u} className="danas-fali" style={{ margin: "0 0 8px" }}><AlertTriangle size={12} style={{ verticalAlign: "-1px" }} /> {u}</p>)}
          <p className="muted-text" style={{ fontSize: 11 }}>Odgovorno lice je obaviješteno. Ako je greška u kucanju, ispravite stavku dok lot čeka odluku.</p>
        </div>
      </Modal>
    );
  }

  const zutih = redovi.reduce((n, r) => n + r.nesigurno.length, 0);
  // Poruka „šta fali“ se računa iz forme — osvježava se sama dok magacioner popunjava, i nestaje.
  const porukaFali = pokusano && fali.length > 0 ? `Za čuvanje još fali: ${fali.map((f) => f.tekst).join(" · ")}.` : "";
  const odOtpremnice = nacin === "otpremnica" && !!prijedlog && prijedlog.stavke.length > 0;

  return (
    <Modal
      naslov="Novi prijem robe"
      podnaslov="P1 · KKT 1"
      siroki
      onClose={zatvori}
      greska={greska || porukaFali}
      footer={
        nacin === "" ? (
          <button className="secondary-button" onClick={zatvori}>Otkaži</button>
        ) : (
          <>
            <button className="secondary-button" onClick={zatvori}>Otkaži</button>
            <button className="primary-button" onClick={() => salji(posalji)} disabled={radim}>
              {radim ? "Čuvam…" : "Sačuvaj prijem"}
            </button>
          </>
        )
      }
    >
      {/* ── 0. Kako unosite ─────────────────────────────────────────────────────────────── */}
      {nacin === "" && (
        <div className="prijem-izbor">
          {citam ? (
            <>
              <div className="prijem-citam" role="status" aria-live="polite">
                <Loader2 size={22} className="vrti" />
                <div>
                  <strong>{opisNapretka}</strong>
                  <span>
                    {sekunde} s{napredak?.prolaz && citam !== "pdf" ? ` · prolaz ${napredak.prolaz}` : ""}.{" "}
                    {citam === "pdf" ? "PDF se čita za nekoliko sekundi." : "Dobra slika — nekoliko sekundi; tamna, mutna ili okrenuta — do jednog minuta."}
                  </span>
                </div>
              </div>
              <div className="prijem-citam-traka" aria-hidden="true">
                <span style={{ width: `${Math.min(95, 8 + (sekunde / 75) * 87)}%` }} />
              </div>
              <button type="button" className="prijem-dugme" onClick={neCekaj}>
                <PenLine size={22} />
                <span><strong>Ne čekaj — upiši ručno</strong><small>Otpremnica ostaje priložena uz prijem; stavke upisujete sami.</small></span>
              </button>
            </>
          ) : (
            <>
              <p className="prijem-pitanje">Kako unosite prijem?</p>
              <label className="prijem-dugme glavno">
                <Camera size={22} />
                <span><strong>Slikaj otpremnicu</strong><small>Aplikacija sama popuni dobavljača, robu, lotove, rokove i količine — vi ih samo uporedite sa robom.</small></span>
                <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { ucitajOtpremnicu(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
              <label className="prijem-dugme">
                <FileText size={22} />
                <span><strong>Učitaj PDF ili sliku</strong><small>Otpremnica koju je dobavljač poslao mejlom, ili slika iz galerije.</small></span>
                <input type="file" accept="application/pdf,image/*" hidden onChange={(e) => { ucitajOtpremnicu(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
              <button type="button" className="prijem-dugme" onClick={() => { setGreska(""); setPoruka(null); setNacin("rucno"); }}>
                <PenLine size={22} />
                <span><strong>Upiši ručno</strong><small>Kad otpremnice nema, ili je pisana rukom.</small></span>
              </button>
              <p className="muted-text prijem-savjet">Za dobru sliku: cijela otpremnica u kadru, odozgo, na ravnoj podlozi, bez sjenke telefona.</p>
            </>
          )}
        </div>
      )}

      {nacin !== "" && (
        <>
          {/* Šta je pročitano — i kako nazad */}
          <div className="prijem-traka">
            {nacin === "otpremnica" && prijedlog ? (
              <div>
                <CheckCircle2 size={14} color="#20a477" style={{ verticalAlign: "-2px" }} /> Popunjeno sa otpremnice <b>{prijedlog.broj ?? "bez broja"}</b>
                {prijedlog.datum ? ` od ${prijedlog.datum.split("-").reverse().join(".")}.` : ""} — {stavkiPadez(prijedlog.stavke.length)}
                {procitano?.vrsta === "slika" && procitano.pouzdanostOcr != null ? ` · čitljivost ${procitano.pouzdanostOcr} %` : ""}.{" "}
                <b>Sve uporedite sa robom i etiketom.</b>
              </div>
            ) : (
              <div>
                <PenLine size={13} style={{ verticalAlign: "-2px" }} /> <b>Ručni unos</b>
                {procitano ? " — otpremnica je priložena uz prijem." : " — sve upisujete sami."}
              </div>
            )}
            {poruka && <div className="danas-fali" style={{ marginTop: 4 }}><AlertTriangle size={12} style={{ verticalAlign: "-2px" }} /> {poruka}</div>}
            {prijedlog?.upozorenja.filter((u) => !u.startsWith("Dobavljač") && !u.startsWith("Neke stavke")).map((u) => (
              <div key={u} className="danas-fali" style={{ marginTop: 4 }}><AlertTriangle size={12} style={{ verticalAlign: "-2px" }} /> {u}</div>
            ))}
            {procitano && procitano.otpremnice.length > 1 && prijedlog && (
              <label style={{ display: "block", marginTop: 6 }}>
                U fajlu je {procitano.otpremnice.length} otpremnica — koju primate?{" "}
                <select value={prijedlog.strana} onChange={(e) => primijeni(procitano.otpremnice.find((o) => o.strana === Number(e.target.value))!)}>
                  {procitano.otpremnice.map((o) => <option key={o.strana} value={o.strana}>{o.broj ?? `strana ${o.strana}`} · {stavkiPadez(o.stavke.length)}</option>)}
                </select>
              </label>
            )}
            {zutih > 0 && <div style={{ marginTop: 4 }}><span style={{ ...ZUTO, padding: "0 4px", border: "1px solid" }}>Žuta polja</span> aplikacija nije sigurno pročitala — njih pogledajte posebno.</div>}
            <div className="prijem-traka-akcije">
              <label className="link-button" style={{ cursor: "pointer" }}>
                <Camera size={13} /> {procitano ? "Slikaj ponovo" : "Ipak slikaj otpremnicu"}
                <input type="file" accept="image/*" capture="environment" hidden disabled={!!citam} onChange={(e) => { ucitajOtpremnicu(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
              {citam && (
                <span className="muted-text">
                  <Loader2 size={12} className="vrti" /> {opisNapretka} {sekunde} s ·{" "}
                  <button type="button" className="link-button" style={{ fontSize: 11 }} onClick={neCekaj}>ne čekaj</button>
                </span>
              )}
            </div>
          </div>

          {/* ── 1. Dobavljač i dokument ─────────────────────────────────────────────────── */}
          <section className="prijem-korak">
            <h3><span className="korak-broj">1</span> Dobavljač i dokument</h3>
            <div className="form-grid">
              <label style={dobavljacId === NOVI ? { gridColumn: "1 / -1" } : undefined}>
                Dobavljač
                <select
                  id="p-dobavljac"
                  value={dobavljacId}
                  onChange={(e) => setDobavljacId(e.target.value)}
                  style={crveno("p-dobavljac") ?? (odOtpremnice && prijedlog && !(prijedlog.dobavljac.sigurno && dobavljacId === prijedlog.dobavljac.id) ? ZUTO : undefined)}
                >
                  {!dobavljacId && <option value="">— izaberite dobavljača —</option>}
                  {dobavljaci.map((d) => <option key={d.id} value={d.id}>{d.naziv}</option>)}
                  {mozeNovogDobavljaca && <option value={NOVI}>+ Nov dobavljač (nije na spisku)</option>}
                </select>
                {nacin === "otpremnica" && prijedlog && (
                  <small className={prijedlog.dobavljac.id ? "muted-text" : "danas-fali"} style={{ fontWeight: 400 }}>
                    {prijedlog.dobavljac.id
                      ? prijedlog.dobavljac.sigurno ? "prepoznat po PIB-u sa otpremnice" : "prepoznat po nazivu — provjerite"
                      : !prijedlog.dobavljac.naziv
                        ? "nije pročitan sa otpremnice — izaberite ga sa spiska"
                        : mozeNovogDobavljaca
                          ? "nije u Šifarnicima — upisaće se kao nov; ako je na spisku pod drugim imenom, izaberite ga"
                          : `„${prijedlog.dobavljac.naziv}“${prijedlog.dobavljac.pib ? ` (PIB ${prijedlog.dobavljac.pib})` : ""} nije u Šifarnicima — dobavljače upisuje odgovorno lice`}
                  </small>
                )}
                {nacin === "otpremnica" && prijedlog && !prijedlog.dobavljac.id && prijedlog.dobavljac.naziv && !mozeNovogDobavljaca && !dobavljacId && (
                  <span className="prijem-javi">
                    <button type="button" className="small-action" onClick={javiOdgovornom} disabled={javljeno !== ""}>
                      {javljeno === "javljeno" ? "✓ Javljeno odgovornom licu" : javljeno === "saljem" ? "Šaljem…" : "Javi odgovornom licu"}
                    </button>
                    <button type="button" className="small-action" onClick={osvjeziDobavljace}>Dodat je — osvježi spisak</button>
                  </span>
                )}
              </label>
              {dobavljacId === NOVI && (
                <>
                  <label>
                    Naziv novog dobavljača
                    <input id="p-novi-dobavljac" value={noviDobavljac.naziv} style={crveno("p-novi-dobavljac")} onChange={(e) => setNoviDobavljac((n) => ({ ...n, naziv: e.target.value }))} placeholder="kako piše na otpremnici" />
                  </label>
                  <label>
                    PIB (ako piše)
                    <input id="p-novi-pib" value={noviDobavljac.pib} inputMode="numeric" style={crveno("p-novi-pib")} onChange={(e) => setNoviDobavljac((n) => ({ ...n, pib: e.target.value.replace(/\s/g, "") }))} placeholder="8 cifara" />
                  </label>
                  <small className="muted-text" style={{ gridColumn: "1 / -1", marginTop: -6 }}>Upisuje se u Šifarnike kad sačuvate prijem; odgovorno lice dobija obavještenje da provjeri podatke.</small>
                </>
              )}
              <label>
                Broj otpremnice
                <input value={brojDokumenta} onChange={(e) => setBrojDokumenta(e.target.value)} placeholder="sa dokumenta dobavljača" />
              </label>
              <label>
                Datum prijema
                <input id="p-datum" type="date" value={datum} style={crveno("p-datum")} onChange={(e) => setDatum(e.target.value)} />
              </label>
              {skladista.length > 0 && (
                <label style={{ gridColumn: "1 / -1" }}>
                  U magacin
                  <select value={skladisteId} onChange={(e) => setSkladisteId(e.target.value)}>
                    {skladista.map((sk) => <option key={sk.id} value={sk.id}>{sk.naziv}</option>)}
                  </select>
                </label>
              )}
            </div>
          </section>

          {/* ── 2. Roba ───────────────────────────────────────────────────────────────────── */}
          <section className="prijem-korak">
            <h3><span className="korak-broj">2</span> Roba <small>{odOtpremnice ? "— izbrojite i upišite koliko je STVARNO stiglo" : ""}</small></h3>
            {redovi.map((r, i) => {
              const a = artikal(r.artikalId);
              const jm = r.artikalId === NOVI ? r.novi.jedinicaMjere : a?.jedinica_mjere ?? r.po?.jm ?? "";
              const razlika = r.po?.kolicina != null && Number.isFinite(uBroj(r.kolicina)) ? uBroj(r.kolicina) - Number(r.po.kolicina) : 0;
              const zuto = (polje: string) => (r.nesigurno.includes(polje) ? ZUTO : undefined);
              const rokObavezan = r.artikalId === NOVI || a?.rok_obavezan !== false;
              return (
                <div key={r.kljuc} className="prijem-stavka">
                  <div className="prijem-stavka-glava">
                    <b>{redovi.length > 1 ? `Stavka ${i + 1}` : "Stavka"}</b>
                    {r.po && (
                      <span className="muted-text">
                        na otpremnici: {[r.po.sifra, r.po.naziv, r.po.kolicina != null ? `${r.po.kolicina.toLocaleString("sr-Latn-ME")} ${r.po.jm ?? ""}`.trim() : null].filter(Boolean).join(" · ")}
                      </span>
                    )}
                    <button type="button" className="link-button" title="Ova roba nije stigla ili je ne primate" onClick={() => setRedovi((rr) => rr.filter((x) => x.kljuc !== r.kljuc))}>
                      <Trash2 size={13} /> Ne primam
                    </button>
                  </div>
                  <div className="form-grid">
                    <label style={{ gridColumn: "1 / -1" }}>
                      Artikal
                      <select
                        id={`p-${r.kljuc}-artikal`}
                        value={r.artikalId}
                        style={crveno(`p-${r.kljuc}-artikal`) ?? zuto("artikal")}
                        onChange={(e) => azuriraj(r.kljuc, { artikalId: e.target.value, novi: { ...r.novi, naziv: r.novi.naziv || r.po?.naziv || "" } }, "artikal")}
                      >
                        {!r.artikalId && <option value="">— izaberite vaš artikal —</option>}
                        {artikli.map((x) => <option key={x.id} value={x.id}>{x.naziv}</option>)}
                        <option value={NOVI}>+ Nov artikal (nije na spisku)</option>
                      </select>
                      {r.po && r.zapamceno && !r.nesigurno.includes("artikal") && r.artikalId && r.artikalId !== NOVI && (
                        <small className="muted-text" style={{ fontWeight: 400 }}><CheckCircle2 size={11} color="#20a477" style={{ verticalAlign: "-1px" }} /> zapamćeno za ovog dobavljača</small>
                      )}
                      {r.po && r.napomena && r.nesigurno.includes("artikal") && (
                        <small className={r.artikalId ? "muted-text" : "danas-fali"} style={{ fontWeight: 400 }}>
                          {r.artikalId === NOVI
                            ? r.napomena.startsWith("Na otpremnici je")
                              ? r.napomena.replace("Izaberite pravi sa spiska.", "Zato se upisuje kao nov artikal — ako ga ipak imate na spisku, izaberite ga.")
                              : "Nema ga u Šifarnicima — upisuje se kao nov artikal. Ako ga ipak imate na spisku (pod drugim imenom), izaberite ga."
                            : `${r.napomena}${!r.artikalId ? " Ako ga nema na spisku — „+ Nov artikal“." : ""}`}
                        </small>
                      )}
                    </label>
                    {r.artikalId === NOVI && (
                      <>
                        <label style={{ gridColumn: "1 / -1" }}>
                          Naziv novog artikla
                          <input id={`p-${r.kljuc}-novi`} value={r.novi.naziv} style={crveno(`p-${r.kljuc}-novi`) ?? zuto("naziv")} onChange={(e) => azuriraj(r.kljuc, { novi: { ...r.novi, naziv: e.target.value } }, "naziv")} placeholder="npr. Pileći file 1 kg" />
                        </label>
                        <div id={`p-${r.kljuc}-rezim`} className="rezim-izbor" style={{ gridColumn: "1 / -1", ...(crveno(`p-${r.kljuc}-rezim`) ?? {}) }}>
                          <span>Čuva se:</span>
                          {([["rashladjeno", "Rashlađeno", Thermometer], ["smrznuto", "Smrznuto", Snowflake], ["bez", "Bez režima", null]] as const).map(([v, t, Ikona]) => (
                            <button key={v} type="button" className={r.novi.rezim === v ? `izabrano${r.nesigurno.includes("rezim") ? " pretpostavka" : ""}` : ""} onClick={() => azuriraj(r.kljuc, { novi: { ...r.novi, rezim: v } }, "rezim")}>
                              {Ikona && <Ikona size={13} />} {t}
                            </button>
                          ))}
                          <select value={r.novi.jedinicaMjere} onChange={(e) => azuriraj(r.kljuc, { novi: { ...r.novi, jedinicaMjere: e.target.value } })} aria-label="Jedinica mjere">
                            {[...new Set([r.novi.jedinicaMjere, ...JEDINICE])].filter(Boolean).map((j) => <option key={j} value={j}>{j}</option>)}
                          </select>
                        </div>
                        <small className="muted-text" style={{ gridColumn: "1 / -1", marginTop: -6, fontSize: 11 }}>
                          {r.po ? "Naziv i jedinica su sa otpremnice — ispravite ako je nešto pogrešno pročitano. " : "Upisuje se u Šifarnike uz prijem. "}
                          {r.rezimPo && r.nesigurno.includes("rezim")
                            ? `Čuvanje je pretpostavljeno ${r.rezimPo === "naziv" ? "po nazivu robe" : r.rezimPo === "temperatura" ? "po temperaturi sa otpremnice" : "po robi koju ovaj dobavljač inače donosi"} — potvrdite ili promijenite. `
                            : ""}
                          Granicu temperature potvrđuje odgovorno lice.
                        </small>
                      </>
                    )}
                    <label>
                      <span>Broj lota <ZakonskaOznaka clan="27" /></span>
                      <input id={`p-${r.kljuc}-lot`} value={r.brojLota} style={crveno(`p-${r.kljuc}-lot`) ?? zuto("lot")} onChange={(e) => azuriraj(r.kljuc, { brojLota: e.target.value }, "lot")} placeholder="sa etikete" autoCapitalize="characters" />
                      {r.po?.lot && r.brojLota.trim() && r.brojLota.trim().toUpperCase() !== r.po.lot.toUpperCase() && (
                        <small className="danas-fali" style={{ fontWeight: 400 }}>na otpremnici piše {r.po.lot}</small>
                      )}
                    </label>
                    <label>
                      Rok trajanja{!rokObavezan && <small className="muted-text"> (ako ga ima)</small>}
                      <input id={`p-${r.kljuc}-rok`} type="date" value={r.rokTrajanja} style={crveno(`p-${r.kljuc}-rok`) ?? zuto("rok")} onChange={(e) => azuriraj(r.kljuc, { rokTrajanja: e.target.value }, "rok")} />
                      {r.rokTrajanja && r.rokTrajanja < datum && <small className="danas-fali" style={{ fontWeight: 400 }}>rok je istekao — upisuje se, ali se ne može prihvatiti</small>}
                    </label>
                    <label>
                      Primljeno{jm ? ` (${jm})` : ""}
                      <input id={`p-${r.kljuc}-kolicina`} type="number" inputMode="decimal" min="0" step="any" value={r.kolicina} style={crveno(`p-${r.kljuc}-kolicina`) ?? zuto("kolicina")} onChange={(e) => azuriraj(r.kljuc, { kolicina: e.target.value }, "kolicina")} />
                      {razlika !== 0 && <small className="danas-fali" style={{ fontWeight: 400 }}>{razlika < 0 ? "manjak" : "višak"} {Math.abs(razlika).toLocaleString("sr-Latn-ME")} prema otpremnici</small>}
                    </label>
                    {poStavci && granicaReda(r) && (
                      <label>
                        Temperatura (°C)
                        <input id={`p-${r.kljuc}-temp`} type="number" step="0.1" value={r.temperatura} style={crveno(`p-${r.kljuc}-temp`)} onChange={(e) => azuriraj(r.kljuc, { temperatura: e.target.value })} />
                      </label>
                    )}
                  </div>
                </div>
              );
            })}
            <button id="p-dodaj" className="link-button" onClick={() => setRedovi((rr) => [...rr, prazanRed()])} style={{ margin: "4px 20px 0" }}>
              <Plus size={14} /> Dodaj stavku
            </button>
          </section>

          {/* ── 3. Temperatura ────────────────────────────────────────────────────────────── */}
          {grupe.length === 0 && redovi.some((r) => r.artikalId) && (
            <section className="prijem-korak">
              <h3><span className="korak-broj">3</span> Temperatura robe <ZakonskaOznaka clan="36" /></h3>
              <p className="prijem-uputstvo">
                Ova roba nema temperaturni režim (npr. keks, konzerve, piće) — temperatura se pri prijemu ne mjeri. Ako artikal treba
                da se čuva hladno, odgovorno lice mu u Šifarnicima uključi „temperaturni režim“ i granicu — od tada se ovdje traži
                temperatura.
              </p>
            </section>
          )}
          {grupe.length > 0 && (
            <section className="prijem-korak">
              <h3><span className="korak-broj">3</span> Temperatura robe <ZakonskaOznaka clan="36" /></h3>
              <p className="prijem-uputstvo">
                Izmjerite sada, svojim termometrom — jednom za svaku grupu robe.
                {prijedlog?.temperaturaNaOtpremnici != null && (
                  <> Na otpremnici piše {stepen(prijedlog.temperaturaNaOtpremnici)} — to je mjerenje dobavljača i ne računa se.</>
                )}
              </p>
              <div className="form-grid">
                {termometri.length > 0 && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <IzborTermometra termometri={termometri} value={termometarId} onChange={setTermometarId} />
                  </div>
                )}
                {!poStavci &&
                  grupe.map(([k, clanovi]) => {
                    const naziv = NAZIV_KATEGORIJE[k] ?? "Roba pod režimom";
                    const opsezi = [...new Set(clanovi.map((c) => opseg(c.granica)))];
                    const opis =
                      opsezi.length === 1
                        ? `dozvoljeno ${opsezi[0]} · ${clanovi.map((c) => c.naziv).join(", ")}`
                        : clanovi.map((c) => `${c.naziv} (${opseg(c.granica)})`).join(", ");
                    const v = uBroj(temperatureGrupa[k] ?? "");
                    const ima = Number.isFinite(v);
                    const van = ima ? clanovi.filter((c) => !uGranici(c.granica, v)) : [];
                    const vanPotvrdjeno = van.filter((c) => c.granica.potvrdjena);
                    const vanPretpostavka = van.filter((c) => !c.granica.potvrdjena);
                    const ok = ima && van.length === 0;
                    const imena = (niz: Clan[]) => (clanovi.length > 1 ? ` (${niz.map((c) => c.naziv).join(", ")})` : "");
                    return (
                      <label key={k} style={{ gridColumn: "1 / -1" }}>
                        <span>{naziv} <span className="muted-text" style={{ fontWeight: 400 }}>· {opis}</span></span>
                        <input
                          id={`p-grupa-${k}`}
                          type="number"
                          step="0.1"
                          value={temperatureGrupa[k] ?? ""}
                          style={crveno(`p-grupa-${k}`)}
                          placeholder="°C"
                          onChange={(e) => setTemperatureGrupa((t) => ({ ...t, [k]: e.target.value }))}
                        />
                        {ok && <small style={{ color: "#1e7f55", fontWeight: 600 }}><CheckCircle2 size={11} style={{ verticalAlign: "-1px" }} /> u granici</small>}
                        {vanPotvrdjeno.length > 0 && (
                          <small className="danas-fali" style={{ fontWeight: 600 }}>
                            van granice{imena(vanPotvrdjeno)} — roba se prima, ali lot ide na zadržavanje (HOLD) i odgovorno lice odlučuje
                          </small>
                        )}
                        {vanPretpostavka.length > 0 && (
                          <small className="danas-fali" style={{ fontWeight: 600 }}>van pretpostavljene granice{imena(vanPretpostavka)} — odgovorno lice dobija upozorenje</small>
                        )}
                      </label>
                    );
                  })}
              </div>
              <label className="prijem-kvacica" style={{ margin: "0 20px 8px" }}>
                <input type="checkbox" checked={poStavci} onChange={(e) => setPoStavci(e.target.checked)} />
                Različita temperatura po stavci (upisuje se kod svake stavke)
              </label>
            </section>
          )}

          {/* ── 4. Potvrda ────────────────────────────────────────────────────────────────── */}
          {odOtpremnice && (
            <section className="prijem-korak">
              <h3><span className="korak-broj">{grupe.length > 0 || redovi.some((r) => r.artikalId) ? 4 : 3}</span> Potvrda</h3>
              <label id="p-uporedjeno" className="prijem-kvacica" style={{ margin: "0 20px 12px", ...(crveno("p-uporedjeno") ? { color: "#b53030" } : {}) }}>
                <input type="checkbox" checked={uporedjeno} onChange={(e) => setUporedjeno(e.target.checked)} />
                Uporedio/la sam svaku stavku sa robom i etiketom — artikal, lot, rok i količina su tačni.
              </label>
            </section>
          )}
          {fali.length > 0 && !pokusano && (
            <p className="muted-text" style={{ margin: "0 20px 14px", fontSize: 11 }}>
              Još fali: {fali.slice(0, 4).map((f) => f.tekst).join(" · ")}{fali.length > 4 ? ` · i još ${fali.length - 4}` : ""}.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
