// Otpremnica → prijedlog prijema. Sve se radi NA NAŠEM SERVERU, bez spoljnih servisa:
//   PDF    — tekst se čita direktno iz fajla (pdfjs), tačno do slova;
//   slika  — lokalni OCR (Tesseract, srpska latinica), uz prilagodljivo crno-bijelo (sjenka) i
//            ispravljanje nagiba. Nesigurna polja se označavaju za provjeru.
// Rezultat je SAMO PRIJEDLOG: magacioner ga upoređuje sa robom i etiketom i tek onda potvrđuje.
import path from "node:path";
import { createRequire } from "node:module";
import { upit } from "../db.js";
import { ApiGreska } from "../greske.js";
import { danasCG } from "../vrijeme.js";

/** Ćelija reda; x0/x1 = položaj na strani (PDF tačke ili pikseli slike), kad je poznat. */
export type Celija = { tekst: string; pouzdanost: number; x0?: number; x1?: number };
export type Linija = Celija[];

export type StavkaOtpremnice = {
  sifra: string | null;
  naziv: string | null;
  jm: string | null;
  kolicina: number | null;
  lot: string | null;
  rok: string | null; // YYYY-MM-DD
  /** Polja koja treba posebno provjeriti (niska pouzdanost OCR-a, ispravljen znak, nečitljivo). */
  nesigurno: string[];
};

export type Otpremnica = {
  strana: number;
  broj: string | null;
  datum: string | null;
  pibovi: string[];
  /** PIB ispod labele "Isporučilac/Dobavljač" — samo kad se to može pouzdano reći. */
  pibIsporucioca: string | null;
  isporucilac: string | null;
  kupac: string | null;
  temperatura: number | null;
  stavke: StavkaOtpremnice[];
  /** Kolone prepoznate u zaglavlju tabele (prazno kad zaglavlje nije nađeno). */
  kolone?: string[];
};

/** Ispod ovoga je OCR riječ nesigurna i polje se boji žuto. */
const PRAG_POUZDANOSTI = 80;

// ─── Čitanje ─────────────────────────────────────────────────────────────────────────────────────

/** Najviše piksela slike koja se obrađuje (50 MP — i neumanjena fotografija sa telefona od 50 MP).
 * Mali PNG može imati 30.000 × 30.000 piksela: raširen u memoriji to je preko 1 GB i ruši server
 * („slikovna bomba“, talas 5). Provjerava se iz zaglavlja slike, bez raspakivanja. */
export const NAJVISE_PIKSELA = 50_000_000;

/** Odbija sliku prevelikih dimenzija PRIJE čuvanja i čitanja. PDF se ne dira (pdfjs ga ne raspakuje u piksele). */
export async function provjeriVelicinuSlike(sadrzaj: Buffer): Promise<void> {
  let sharp: (typeof import("sharp"))["default"];
  try {
    sharp = (await import("sharp")).default;
  } catch {
    return; // bez sharp-a nema ni obrade slike u pikselima (OCR dobija fajl kakav jeste)
  }
  let sirina = 0;
  let visina = 0;
  try {
    const m = await sharp(sadrzaj, { failOn: "none", limitInputPixels: false }).metadata();
    sirina = m.width ?? 0;
    visina = m.height ?? 0;
  } catch {
    throw new ApiGreska(415, "NEPOZNAT_FAJL", "Slika se ne može otvoriti — slikajte otpremnicu ponovo.");
  }
  if (sirina * visina > NAJVISE_PIKSELA) {
    throw new ApiGreska(
      400,
      "SLIKA_PREVELIKA",
      `Slika je prevelika (${sirina} × ${visina} piksela). Slikajte otpremnicu telefonom iz aplikacije ili pošaljite manju sliku.`,
    );
  }
}

export function prepoznajVrstu(sadrzaj: Buffer): { vrsta: "pdf" | "slika"; mime: string } | null {
  if (sadrzaj.subarray(0, 5).toString("latin1") === "%PDF-") return { vrsta: "pdf", mime: "application/pdf" };
  if (sadrzaj[0] === 0xff && sadrzaj[1] === 0xd8 && sadrzaj[2] === 0xff) return { vrsta: "slika", mime: "image/jpeg" };
  if (sadrzaj.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { vrsta: "slika", mime: "image/png" };
  if (sadrzaj.subarray(0, 4).toString("latin1") === "RIFF" && sadrzaj.subarray(8, 12).toString("latin1") === "WEBP") return { vrsta: "slika", mime: "image/webp" };
  return null;
}

type PdfStavka = { str: string; transform: number[]; width: number; height: number };

/** Svaka strana → redovi → ćelije. Dijelovi teksta u istoj visini su jedan red; razmak veći od
 * pola visine slova je nova ćelija (tako se ćelije tabele ne slijepe). */
export async function procitajPdf(sadrzaj: Buffer): Promise<Linija[][]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Fajl dolazi spolja: pdfjs od verzije 6 uopšte ne izvršava kod iz fonta (CVE-2024-4367 zatvoren u
  // samoj biblioteci — opcija isEvalSupported više ne postoji). Ne vraćati se na verziju ispod 4.2.67.
  const ucitavanje = pdfjs.getDocument({ data: new Uint8Array(sadrzaj), useSystemFonts: false, verbosity: 0 });
  const dokument = await ucitavanje.promise;
  const strane: Linija[][] = [];
  let ukupnoTeksta = 0;
  for (let broj = 1; broj <= dokument.numPages; broj++) {
    const strana = await dokument.getPage(broj);
    const sadrzajStrane = await strana.getTextContent();
    const redovi: { y: number; dijelovi: PdfStavka[] }[] = [];
    for (const it of sadrzajStrane.items as PdfStavka[]) {
      if (!("str" in it) || !it.str.trim()) continue;
      ukupnoTeksta += it.str.length;
      const y = it.transform[5];
      let red = redovi.find((r) => Math.abs(r.y - y) < Math.max(2, (it.height || 8) * 0.4));
      if (!red) redovi.push((red = { y, dijelovi: [] }));
      red.dijelovi.push(it);
    }
    redovi.sort((a, b) => b.y - a.y);
    strane.push(
      redovi.map((r) => {
        const dijelovi = r.dijelovi.sort((a, b) => a.transform[4] - b.transform[4]);
        const celije: Celija[] = [];
        let prethodni: PdfStavka | null = null;
        for (const d of dijelovi) {
          const razmak = prethodni ? d.transform[4] - (prethodni.transform[4] + prethodni.width) : Infinity;
          if (prethodni && razmak < Math.max(1.5, (d.height || 8) * 0.5)) {
            celije[celije.length - 1].tekst += (razmak > 0.8 ? " " : "") + d.str;
          } else {
            celije.push({ tekst: d.str, pouzdanost: 100 });
          }
          prethodni = d;
        }
        return celije.map((c) => ({ ...c, tekst: c.tekst.replace(/\s+/g, " ").trim() })).filter((c) => c.tekst);
      }),
    );
  }
  await ucitavanje.destroy();
  if (ukupnoTeksta < 20) {
    throw new ApiGreska(422, "PDF_BEZ_TEKSTA", "Ovaj PDF je skeniran kao slika i nema teksta. Sačuvan je uz prijem — slikajte papirnu otpremnicu telefonom, ili upišite stavke ručno.");
  }
  return strane;
}

// Jedan OCR radnik za cijeli server, poslovi idu jedan za drugim (Render ima malo memorije i slab
// procesor). Pali se UNAPRIJED, čim se otvori „Novi prijem“ (pripremiOcr) — dok magacioner slika, a ne
// kad slika stigne. Gasi se posle 5 min bez posla; posle 20 slika se zamijeni novim (Tesseract ne
// vraća zauzetu memoriju, a Render ima 512 MB).
type OcrRadnik = Awaited<ReturnType<typeof import("tesseract.js").createWorker>>;
let radnik: Promise<OcrRadnik> | null = null;
let gasenje: NodeJS.Timeout | null = null;
let red: Promise<unknown> = Promise.resolve();
let upotreba = 0;

async function dajRadnika(): Promise<OcrRadnik> {
  if (!radnik) {
    upotreba = 0;
    radnik = (async () => {
      const { createWorker } = await import("tesseract.js");
      const require = createRequire(import.meta.url);
      const langPath = path.join(path.dirname(require.resolve("@tesseract.js-data/srp_latn/package.json")), "4.0.0_best_int");
      const w = await createWorker("srp_latn", 1, { langPath, cacheMethod: "none", gzip: true });
      // Sauvola (2) umjesto Otsu: lokalni prag ne "pojede" dio papira u sjenci (Otsu na fotografiji sa
      // sjenkom ne pročita ništa — mjereno). Razmaci se čuvaju da se vide kolone.
      await w.setParameters({ thresholding_method: "2", preserve_interword_spaces: "1", tessedit_pageseg_mode: "6" } as Record<string, string>);
      return w;
    })();
    radnik.catch(() => {
      radnik = null;
    });
  }
  return radnik;
}

function ugasiRadnika() {
  const r = radnik;
  radnik = null;
  upotreba = 0;
  r?.then((x) => x.terminate()).catch(() => undefined);
}

function zakaziGasenje() {
  if (gasenje) clearTimeout(gasenje);
  gasenje = setTimeout(ugasiRadnika, 5 * 60_000);
  gasenje.unref();
}

/** Pali OCR radnika unaprijed (pozove se kad se otvori forma prijema). Ne čeka ništa. */
export function pripremiOcr() {
  dajRadnika()
    .then(() => zakaziGasenje())
    .catch(() => undefined);
}

type Okvir = { x0: number; y0: number; x1: number; y1: number };
type OcrRijec = { text: string; confidence: number; bbox: Okvir };
type OcrLinija = { words: unknown[]; bbox: Okvir; baseline?: Okvir & { has_baseline?: boolean } };

const medijana = (niz: number[]) => {
  if (niz.length === 0) return 0;
  const s = [...niz].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Redovi papira iz RIJEČI i njihovog položaja — ne iz Tesseractovih blokova. Tesseract tabelu često
 * podijeli u više blokova (kolone lijevo i desno), pa isti red papira dođe kao dvije „linije“ sa malo
 * različitom visinom: zaglavlje „LOT Rok“ iznad „Proizvod JM Kol“, a lot odvojen od svog naziva. Zato:
 * nagib papira iz osnovnih linija teksta, pa riječi u isti red kad im je (ispravljena) visina ista. */
export function redoviIzRijeci(ocrLinije: OcrLinija[]): Linija[] {
  const nagibi = ocrLinije
    .map((l) => l.baseline)
    .filter((b): b is NonNullable<OcrLinija["baseline"]> => !!b && b.x1 - b.x0 > 60)
    .map((b) => (b.y1 - b.y0) / (b.x1 - b.x0))
    .filter((k) => Math.abs(k) < 0.2);
  const k = medijana(nagibi);
  const rijeci = ocrLinije.flatMap((l) => l.words as OcrRijec[]).filter((r) => r.text.trim());
  if (rijeci.length === 0) return [];
  const visina = medijana(rijeci.map((r) => r.bbox.y1 - r.bbox.y0)) || 20;
  const saVisinom = rijeci
    .map((r) => ({ r, y: (r.bbox.y0 + r.bbox.y1) / 2 - k * ((r.bbox.x0 + r.bbox.x1) / 2) }))
    .sort((a, b) => a.y - b.y);
  const redovi: { y: number; n: number; rijeci: OcrRijec[] }[] = [];
  for (const w of saVisinom) {
    const zadnji = redovi[redovi.length - 1];
    if (zadnji && w.y - zadnji.y < visina * 0.6) {
      zadnji.rijeci.push(w.r);
      zadnji.y = (zadnji.y * zadnji.n + w.y) / (zadnji.n + 1);
      zadnji.n++;
    } else redovi.push({ y: w.y, n: 1, rijeci: [w.r] });
  }
  const linije: Linija[] = [];
  for (const red of redovi) {
    const sortirane = red.rijeci.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const znakova = sortirane.reduce((z, r) => z + r.text.length, 0);
    const sirinaZnaka = sortirane.reduce((z, r) => z + (r.bbox.x1 - r.bbox.x0), 0) / Math.max(1, znakova);
    const celije: { rijeci: OcrRijec[] }[] = [];
    let prethodna: OcrRijec | null = null;
    for (const r of sortirane) {
      if (prethodna && r.bbox.x0 - prethodna.bbox.x1 < sirinaZnaka * 1.6) celije[celije.length - 1].rijeci.push(r);
      else celije.push({ rijeci: [r] });
      prethodna = r;
    }
    linije.push(
      celije.map((c) => ({
        tekst: c.rijeci.map((r) => r.text).join(" "),
        pouzdanost: Math.min(...c.rijeci.map((r) => r.confidence)),
        x0: c.rijeci[0].bbox.x0,
        x1: c.rijeci[c.rijeci.length - 1].bbox.x1,
      })),
    );
  }
  return linije;
}

/** Jedno čitanje slike, u redu sa ostalima (jedan radnik za cijeli server). `psm` = kako Tesseract
 * dijeli stranu: 6 — jedan blok (najbolje za otpremnicu, trpi nagib), 11 — rijedak tekst (mala slika),
 * 3 — automatski. Sauvola prag uvijek: Otsu na fotografiji sa sjenkom ne pročita ništa (mjereno). */
async function ocr(sadrzaj: Buffer, psm = "6") {
  const posao = red.then(async () => {
    if (gasenje) clearTimeout(gasenje);
    const w = await dajRadnika();
    try {
      await w.setParameters({ tessedit_pageseg_mode: psm } as Record<string, string>);
      const { data } = await w.recognize(sadrzaj, { rotateAuto: true }, { text: true, blocks: true });
      upotreba++;
      return data;
    } finally {
      if (upotreba >= 20) ugasiRadnika();
      else zakaziGasenje();
    }
  });
  red = posao.catch(() => undefined);
  const data = await posao;
  const ocrLinije = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines as unknown as OcrLinija[]));
  // „Dobre riječi“ (sigurno pročitana slova) — po njima se vidi je li slika uspravna: u pravom
  // položaju ih je 40–60, u pogrešnom 0–2 (mjereno i na tamnoj i na mutnoj slici).
  const dobrihRijeci = ocrLinije
    .flatMap((l) => l.words as OcrRijec[])
    .filter((r) => r.confidence >= 85 && /[A-Za-zČĆŠŽĐčćšžđ]{3,}/.test(r.text)).length;
  return { linije: redoviIzRijeci(ocrLinije), pouzdanost: Math.round(data.confidence ?? 0), dobrihRijeci };
}

type Priprema = "sirovo" | "kontrast" | "ostro" | "kontrast-ostro";

/** Najveća slika koja se čita. Mjereno: 2200 px je jednako tačno kao 3200 (90/99 polja), a ~30 % brže;
 * na slabom serveru to je razlika između pola minuta i dva minuta. */
const NAJVECA = 2400;
let sharpPodesen = false;

/** Slika za jedan prolaz: okrenuta (fotografija „položena“ ili naopako), smanjena i pripremljena.
 * kontrast = CLAHE (lokalni kontrast — spašava tamnu sliku), ostro = izoštravanje (mutna slika).
 * Mala slika se za te prolaze uveća (mala + tamna se tek tada pročita). Globalno razvlačenje
 * kontrasta (normalise) je na probi POGORŠAVALO — pojača sjenku. */
async function pripremljena(sadrzaj: Buffer, ugao: number, priprema: Priprema, najvise = NAJVECA): Promise<Buffer> {
  let sharp: (typeof import("sharp"))["default"];
  try {
    sharp = (await import("sharp")).default;
  } catch {
    // Bez biblioteke za slike: čita se samo original, uspravno.
    if (ugao === 0 && priprema === "sirovo") return sadrzaj;
    throw new Error("sharp nije dostupan");
  }
  if (!sharpPodesen) {
    // Render ima malo memorije: bez keša, jedna nit.
    sharp.cache(false);
    sharp.concurrency(1);
    sharpPodesen = true;
  }
  const m = await sharp(sadrzaj, { failOn: "none", limitInputPixels: NAJVISE_PIKSELA }).metadata();
  const duza = Math.max(m.width ?? 0, m.height ?? 0) || 2000;
  const uspravna = !m.orientation || m.orientation === 1;
  if (ugao === 0 && priprema === "sirovo" && duza <= najvise && uspravna) return sadrzaj;
  let s = sharp(sadrzaj, { failOn: "none", limitInputPixels: NAJVISE_PIKSELA }).autoOrient();
  if (ugao) s = s.rotate(ugao);
  const cilj = priprema !== "sirovo" && duza < 1800 ? najvise : Math.min(najvise, duza);
  s = s.resize({ width: cilj, height: cilj, fit: "inside" });
  if (priprema !== "sirovo") s = s.grayscale();
  if (priprema.includes("kontrast")) {
    const plocica = Math.max(24, Math.min(128, Math.round(cilj / 37)));
    s = s.clahe({ width: plocica, height: plocica, maxSlope: 3 });
  }
  if (priprema.includes("ostro")) s = s.sharpen({ sigma: 1.5, m1: 1, m2: 3 });
  return s.jpeg({ quality: 90 }).toBuffer();
}

/** Koliko je čitanje upotrebljivo: stavke sa količinom, lotom i rokom (onim kolonama koje otpremnica
 * ima), minus nesigurna polja. „potpuno“ = svaka stavka ima sve — tada se dalje ne čita. */
function ocjenaCitanja(otpremnice: Otpremnica[]) {
  const o = otpremnice.find((x) => x.stavke.length > 0) ?? otpremnice[0];
  if (!o) return { ocjena: -1, potpuno: false };
  const kolone = o.kolone ?? [];
  // Količina uvijek (bez nje nema prijema); lot i rok kad ih otpremnica ima kao kolonu.
  const trazi = (["kolicina", "lot", "rok"] as const).filter((k) => k === "kolicina" || kolone.includes(k));
  let ocjena = o.broj ? 1 : 0;
  let potpuno = o.stavke.length > 0;
  for (const s of o.stavke) {
    ocjena += 1 + (s.naziv ? 0.5 : 0) - 0.5 * s.nesigurno.length;
    for (const k of trazi) {
      if (s[k] !== null) ocjena += 1;
      else potpuno = false;
    }
  }
  return { ocjena, potpuno };
}

// Redoslijed prolaza je izmjeren na probnim fotografijama (tamna, mutna, mala, nagnuta, okrenuta i
// njihove kombinacije): svaki sljedeći spašava ono što prethodni ne pročita.
const PROLAZI: { priprema: Priprema; psm: string }[] = [
  { priprema: "sirovo", psm: "6" },
  { priprema: "kontrast", psm: "6" },
  { priprema: "ostro", psm: "6" },
  { priprema: "kontrast-ostro", psm: "6" },
  { priprema: "sirovo", psm: "11" },
  { priprema: "kontrast", psm: "11" },
];
const OPIS_PROLAZA: Record<string, string> = {
  "sirovo:6": "čitam otpremnicu",
  "kontrast:6": "pojačavam kontrast",
  "ostro:6": "izoštravam sliku",
  "kontrast-ostro:6": "kontrast i izoštravanje",
  "sirovo:11": "tražim sitan tekst",
  "kontrast:11": "sitan tekst, pojačan kontrast",
};
const NAJVISE_PROLAZA = 9;
/** Ukupno vrijeme čitanja jedne slike. Novi prolaz se ne počinje ako ne bi stao u ovo vrijeme (po
 * trajanju prethodnog) — na slabom serveru se uzima najbolje do tada, umjesto da magacioner čeka. */
const NAJDUZE_MS = Number(process.env.OCR_NAJDUZE_MS) || 75_000;
/** Ispod ovoliko dobrih riječi slika nije uspravna (ili na njoj nema teksta). */
const USPRAVNA = 12;

export type OpcijeCitanja = {
  /** Pozove se prije svakog prolaza — za prikaz napretka. */
  naNapredak?: (prolaz: number, opis: string) => void;
  /** Magacioner je odustao (prešao na ručni unos) — dalje se ne čita. */
  prekinuto?: () => boolean;
};

/** Fotografija otpremnice → otpremnice. Jedno čitanje je krhko (mala promjena veličine, svjetla ili
 * nagiba ga obori — mjereno), pa se čita u prolazima dok jedan ne da sve: obično → kontrast →
 * izoštreno → oboje → sitan tekst. Ako u prvom čitanju skoro nema sigurnih riječi, slika je
 * „položena“ ili naopako: brza proba na manjoj kopiji za 90°, 270° i 180° bira položaj sa najviše
 * sigurnih riječi. Uzima se najbolje čitanje. Dobra fotografija završi posle prvog prolaza. */
export async function procitajSliku(sadrzaj: Buffer, opcije: OpcijeCitanja = {}): Promise<{ otpremnice: Otpremnica[]; pouzdanost: number; prolaza: number }> {
  const pocetak = Date.now();
  let najbolje: { otpremnice: Otpremnica[]; pouzdanost: number; ocjena: number } | null = null;
  let prolaza = 0;
  let zadnjeTrajanje = 0;
  const isteklo = () =>
    prolaza >= NAJVISE_PROLAZA || !!opcije.prekinuto?.() || (prolaza > 0 && Date.now() - pocetak + zadnjeTrajanje > NAJDUZE_MS);

  const citaj = async (ugao: number, p: { priprema: Priprema; psm: string }, najvise = NAJVECA, opis?: string) => {
    const slika = await pripremljena(sadrzaj, ugao, p.priprema, najvise).catch(() => null);
    if (!slika) return { potpuno: false, dobrihRijeci: 0 };
    prolaza++;
    opcije.naNapredak?.(prolaza, opis ?? OPIS_PROLAZA[`${p.priprema}:${p.psm}`] ?? "čitam");
    const t0 = Date.now();
    const { linije, pouzdanost, dobrihRijeci } = await ocr(slika, p.psm);
    zadnjeTrajanje = Date.now() - t0;
    const otpremnice = parsiraj([linije]);
    const o = ocjenaCitanja(otpremnice);
    if (!najbolje || o.ocjena > najbolje.ocjena || (o.ocjena === najbolje.ocjena && pouzdanost > najbolje.pouzdanost)) {
      najbolje = { otpremnice, pouzdanost, ocjena: o.ocjena };
    }
    return { potpuno: o.potpuno, dobrihRijeci };
  };
  const gotovo = () => ({ otpremnice: najbolje?.otpremnice ?? [], pouzdanost: najbolje?.pouzdanost ?? 0, prolaza });

  const prvi = await citaj(0, PROLAZI[0]);
  if (prvi.potpuno) return gotovo();

  let ugao = 0;
  if (prvi.dobrihRijeci < USPRAVNA) {
    let naj = { ugao: 0, dobrih: prvi.dobrihRijeci };
    for (const u of [90, 270, 180]) {
      if (isteklo()) break;
      const r = await citaj(u, PROLAZI[0], 1600, "provjeravam da li je slika okrenuta");
      if (r.potpuno) return gotovo();
      if (r.dobrihRijeci > naj.dobrih) naj = { ugao: u, dobrih: r.dobrihRijeci };
    }
    ugao = naj.ugao;
  }
  for (const [i, p] of PROLAZI.entries()) {
    if (isteklo()) break;
    if (ugao === 0 && i === 0) continue;
    const r = await citaj(ugao, p);
    if (r.potpuno) return gotovo();
  }
  return gotovo();
}

// ─── Prepoznavanje ───────────────────────────────────────────────────────────────────────────────

/** mala slova, bez kvačica — za poređenje naziva i labela. */
export const normalizuj = (s: string) =>
  s.toLowerCase().replace(/đ/g, "dj").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

const DATUM = /(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})\.?/;

export function uDatum(tekst: string | null | undefined): string | null {
  const m = tekst?.match(DATUM);
  if (!m) return null;
  const dan = Number(m[1]);
  const mjesec = Number(m[2]);
  let godina = Number(m[3]);
  if (godina < 100) godina += 2000;
  if (mjesec < 1 || mjesec > 12 || dan < 1 || dan > 31 || godina < 2000 || godina > 2100) return null;
  const d = new Date(Date.UTC(godina, mjesec - 1, dan));
  if (d.getUTCDate() !== dan) return null;
  return `${godina}-${String(mjesec).padStart(2, "0")}-${String(dan).padStart(2, "0")}`;
}

export function uBroj(tekst: string | null | undefined): number | null {
  if (!tekst) return null;
  let t = tekst.replace(/\s/g, "");
  if (!/^\d{1,3}([.,]?\d{3})*([.,]\d{1,3})?$/.test(t)) return null;
  // 1.250,5 → 1250.5 ; 1,250.5 → 1250.5 ; 25,5 → 25.5
  const zadnji = Math.max(t.lastIndexOf(","), t.lastIndexOf("."));
  if (zadnji >= 0 && t.length - zadnji - 1 === 3 && (t.match(/[.,]/g) ?? []).length >= 1 && !/[.,]\d{1,2}$/.test(t)) {
    // samo separator hiljada (1.250) — tri cifre posle posljednjeg znaka
    t = t.replace(/[.,]/g, "");
  } else if (zadnji >= 0) {
    t = t.slice(0, zadnji).replace(/[.,]/g, "") + "." + t.slice(zadnji + 1);
  }
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const JM = /^(kom|kom\.|kg|kg\.|g|gr|l|lit|lit\.|ml|pak|pak\.|kut|kut\.|kart|kd|fl|boca|bok|kanta|par|m)$/i;

// Kolone tabele: po nazivu u zaglavlju.
// "ostalo" = kolona koju prijem ne koristi (cijena, rabat, iznos, redni broj…) — prepoznaje se da bi
// se znao njen POLOŽAJ: inače bi iznos sa kraja reda bio pročitan kao količina.
type Kolona = "sifra" | "naziv" | "jm" | "kolicina" | "lot" | "rok" | "ostalo";
const ZAGLAVLJE: [Kolona, RegExp][] = [
  ["ostalo", /^(r\.? ?br\.?|rb|red\.? ?br\.?|redni broj|br\.?|ean|bar ?kod|barkod|cijena\w*|cena\w*|vp cijena|mp cijena|jed\.? cijena|rabat\w*|popust|pdv\w*|osnovica|iznos\w*|vrijednost\w*|vrednost\w*|ukupno\w*|total|neto|bruto|tezina|masa|pakovanje|pak)$/],
  ["sifra", /^(sifra|ifra|fra|sif|kod|sifra artikla|sif\. art|br\. art\w*|artikal br\.?|kat\.? ?br\.?|kataloski broj)$/],
  ["naziv", /^(proizvod|naziv|artikal|opis|naziv artikla|naziv proizvoda|naziv robe|roba|artikli|opis robe|naziv i opis)$/],
  ["jm", /^(jm|j\.m|j\. m|jed\. ?mj\w*|jedinica\w*|mj|jed\.)$/],
  ["kolicina", /^(kol|kolicina|kolic\w*|kom|isporuceno|isporucena kolicina|kol\. isp\.?)$/],
  ["lot", /^(lot|serija|sarza|lot\/serija|serija\/lot|batch|lot br|lot broj|br\. lota|broj lota|broj serije|partija|lot\/sarza|sarza\/lot|lot no)$/],
  ["rok", /^(rok|rok trajanja|upotrebljivo do|najbolje upotrijebiti do|najbolje do|datum isteka|datum isteka roka|istek|exp|exp\. date|best before|rok upotrebe|rok vazenja|bbd)$/],
];

const bezInterpunkcije = (s: string) => normalizuj(s).replace(/[^a-z0-9 ./\\]/g, "").replace(/[.:]+$/, "").trim();

function kolonaZaglavlja(tekst: string): Kolona | null {
  const t = bezInterpunkcije(tekst);
  for (const [k, re] of ZAGLAVLJE) if (re.test(t)) return k;
  return null;
}

/** Zaglavlje tabele: red u kom su bar tri prepoznate kolone, među njima lot ili količina. Kolone
 * „ostalo“ (cijena, iznos…) ostaju na svom mjestu, svaka; prave kolone se broje jednom. */
function redoslijedKolona(linija: Linija): Kolona[] | null {
  // Ćelija koja nije jedna labela razlaže se na riječi: OCR na manjoj slici spoji susjedne labele
  // („Cijena Rabat %“) — bez toga se izgube dvije kolone i vrijednosti reda se pomjere.
  // Samo KRATKA ćelija u kojoj su labele većina — rečenica „roba …, lot i rok provjereni“ nije zaglavlje.
  let kolone = linija.flatMap((c): (Kolona | null)[] => {
    const k = kolonaZaglavlja(c.tekst);
    if (k) return [k];
    const rijeci = c.tekst.split(/\s+/).filter(Boolean);
    const nadjene = rijeci.map((r) => kolonaZaglavlja(r)).filter((x): x is Kolona => x !== null);
    return nadjene.length > 0 && rijeci.length <= 4 && nadjene.length * 2 >= rijeci.length ? nadjene : [null];
  });
  // OCR ponekad spoji dvije labele u jednu ćeliju ("Šifra Proizvod") — probaj po riječima.
  if (kolone.filter((k) => k && k !== "ostalo").length < 3) {
    const poRijecima = linija.flatMap((c) => c.tekst.split(/\s+/).map((r) => kolonaZaglavlja(r)));
    if (poRijecima.filter((k) => k && k !== "ostalo").length > kolone.filter((k) => k && k !== "ostalo").length) kolone = poRijecima;
  }
  // Zaglavlje je kratak red u kom su labele većina — rečenica "…istekao rok, LOT…" nije zaglavlje.
  if (kolone.length > 14 || kolone.filter(Boolean).length * 2 < kolone.length) return null;
  const rezultat: Kolona[] = [];
  for (const k of kolone) if (k && (k === "ostalo" || !rezultat.includes(k))) rezultat.push(k);
  const prave = rezultat.filter((k) => k !== "ostalo");
  if (prave.length < 3 || !(prave.includes("lot") || prave.includes("kolicina"))) return null;
  // „ostalo“ na samom početku bez šifre (redni broj) i na kraju (iznosi) se zadržava; bez prave kolone
  // pored sebe ne znači ništa, ali ne smeta.
  return rezultat;
}

const KRAJ_TABELE = /^(napomena|ukupno|svega|predao|preuzeo|potpis|napomene|total|iznos|vozac|status)/;

/** OCR tipično čita "J" kao ")", "}" ili "|" na početku koda (JG26… → )G26…). Takav znak u kodu
 * ne može biti, pa se vraća u "J" — ali polje ostaje označeno za provjeru. */
function ocistiKod(tekst: string): { vrijednost: string | null; ispravljeno: boolean } {
  let t = tekst.trim().replace(/\s+/g, "");
  let ispravljeno = false;
  if (/^[)}\]|]/.test(t) && t.length > 1) {
    t = "J" + t.slice(1);
    ispravljeno = true;
  }
  const cisto = t.replace(/[^A-Za-z0-9\-\/.]/g, "");
  if (cisto !== t) ispravljeno = true;
  const v = cisto.replace(/^[.\-/]+|[.\-/]+$/g, "").toUpperCase();
  if (v !== cisto.toUpperCase()) ispravljeno = true;
  return { vrijednost: v || null, ispravljeno };
}

/** Da li riječ može biti vrijednost te kolone — po obliku, ne po položaju. */
/** Odsječen ili nepotpun datum („02.10.202“) — nije lot, nego rok koji treba provjeriti. */
const LICI_NA_DATUM = /^\d{1,2}[.\/-]\d{1,2}[.\/-]\d{0,4}\.?$/;

function lici(k: Kolona, tekst: string): boolean {
  if (k === "jm") return JM.test(tekst.replace(/[^A-Za-z.]/g, ""));
  if (k === "kolicina") return uBroj(tekst.replace(/[^0-9.,]/g, "")) !== null && /^[|]?[\d.,]+$/.test(tekst);
  if (k === "rok") return uDatum(tekst) !== null || LICI_NA_DATUM.test(tekst.trim());
  if (k === "lot") {
    const v = ocistiKod(tekst).vrijednost ?? "";
    return v.length >= 3 && /\d/.test(v) && uDatum(v) === null && !LICI_NA_DATUM.test(tekst.trim());
  }
  if (k === "ostalo") return /^[|]?[-+]?[\d.,]+\s*[%€]?$|^[%€]$/.test(tekst.trim());
  return true;
}

/** Datum kome je OCR odsjekao posljednju cifru godine („02.10.202“): dopuni tekućom godinom, a polje
 * ostaje označeno za provjeru. Sve ostalo — null. */
function dopuniDatum(tekst: string | null | undefined): string | null {
  const m = tekst?.trim().match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](20\d)\.?$/);
  if (!m) return null;
  const godina = danasCG().slice(0, 4);
  if (!godina.startsWith(m[3])) return null;
  return uDatum(`${m[1]}.${m[2]}.${godina}`);
}

function parsirajRed(linija: Linija, kolone: Kolona[]): StavkaOtpremnice | null {
  // Samostalne linije tabele ("|", "___") nisu ćelije. "|" zalijepljen uz kod ostaje — to je
  // često pogrešno pročitano "J" (vidi ocistiKod).
  const celije = linija
    .filter((c) => !/^[|_\-—–\s]+$/.test(c.tekst))
    .map((c) => ({ ...c, tekst: c.tekst.replace(/^\|+\s+|\s+\|+$/g, "").replace(/\s+\|+\s+/g, " ").trim() }));
  if (celije.length === 0) return null;
  const vrijednosti: Partial<Record<Kolona, Celija>> = {};

  const imaNaziv = kolone.includes("naziv");
  if (imaNaziv && celije.length === kolone.length) {
    kolone.forEach((k, i) => (vrijednosti[k] = celije[i]));
  } else {
    // Broj ćelija se ne slaže (spojene ili razbijene ćelije), ili OCR nije pročitao labelu
    // "Proizvod" (nagnut papir → labele u dva reda). Kolone desno od naziva se uzimaju s desna,
    // svaka SAMO ako riječ liči na nju (datum, lot, broj, jedinica); lijevo od naziva s lijeva;
    // naziv je ono što ostane. Svaka riječ je ćelija.
    const rijeci: Celija[] = celije.flatMap((c) => c.tekst.split(/\s+/).map((t) => ({ tekst: t, pouzdanost: c.pouzdanost })));
    const iNaziv = imaNaziv ? kolone.indexOf("naziv") : kolone.filter((k) => k === "sifra").length;
    const bezNaziva = kolone.filter((k) => k !== "naziv");
    const lijevo = bezNaziva.slice(0, iNaziv);
    const desno = bezNaziva.slice(iNaziv);
    let pocetak = 0;
    let kraj = rijeci.length;
    for (const k of lijevo) if (pocetak < kraj) vrijednosti[k] = rijeci[pocetak++];
    for (const k of [...desno].reverse()) {
      if (kraj <= pocetak) break;
      if (!lici(k, rijeci[kraj - 1].tekst)) continue;
      vrijednosti[k] = rijeci[--kraj];
    }
    if (kraj > pocetak) {
      const dio = rijeci.slice(pocetak, kraj);
      vrijednosti.naziv = { tekst: dio.map((r) => r.tekst).join(" "), pouzdanost: Math.min(...dio.map((r) => r.pouzdanost)) };
    }
  }

  const nesigurno: string[] = [];
  const nisko = (k: Kolona) => (vrijednosti[k]?.pouzdanost ?? 100) < PRAG_POUZDANOSTI;

  const kolicina = uBroj(vrijednosti.kolicina?.tekst.replace(/[^0-9.,]/g, ""));
  if (vrijednosti.kolicina && (kolicina === null || nisko("kolicina"))) nesigurno.push("kolicina");

  const rokTekst = vrijednosti.rok?.tekst ?? null;
  const rokTacan = uDatum(rokTekst);
  const rok = rokTacan ?? dopuniDatum(rokTekst);
  if (rokTekst && (rokTacan === null || nisko("rok"))) nesigurno.push("rok");

  let lot: string | null = null;
  if (vrijednosti.lot) {
    const c = ocistiKod(vrijednosti.lot.tekst);
    lot = c.vrijednost && /\d/.test(c.vrijednost) && c.vrijednost.length >= 3 && !uDatum(c.vrijednost) ? c.vrijednost : null;
    if (!lot || c.ispravljeno || nisko("lot")) nesigurno.push("lot");
  }

  let sifra: string | null = null;
  if (vrijednosti.sifra) {
    const c = ocistiKod(vrijednosti.sifra.tekst);
    sifra = c.vrijednost;
    if (c.ispravljeno || nisko("sifra")) nesigurno.push("sifra");
  }

  let naziv = vrijednosti.naziv?.tekst.replace(/^\s+|[|\s]+$/g, "") || null;
  if (!sifra && naziv) {
    const [prva, ...ostalo] = naziv.split(/\s+/);
    if (ostalo.length > 0 && (/^[)}\]|]?[A-Za-z]{0,4}-\d{1,6}$/.test(prva) || /^[A-Za-z]{1,4}\d{2,6}$/.test(prva) || /^[)}\]|][A-Za-z]{0,3}\d{2,6}$/.test(prva))) {
      const c = ocistiKod(prva);
      sifra = c.vrijednost;
      naziv = ostalo.join(" ");
      if (c.ispravljeno || nisko("naziv")) nesigurno.push("sifra");
    }
  }
  naziv = naziv?.replace(/^[|\s]+/, "") || null;
  if (naziv && nisko("naziv")) nesigurno.push("naziv");
  const jmTekst = vrijednosti.jm?.tekst.replace(/[^A-Za-z.]/g, "") ?? "";
  const jm = JM.test(jmTekst) ? jmTekst.toLowerCase().replace(/\.$/, "") : null;

  // Red tabele mora imati bar količinu ili lot — inače je to tekst ispod tabele.
  if (kolicina === null && lot === null) return null;
  return { sifra, naziv, jm, kolicina, lot, rok, nesigurno };
}

const tekstLinije = (l: Linija) => l.map((c) => c.tekst).join("  ");
const LABELA_ISPORUCILAC = /(rucilac|dobavlja|prodavac|posiljalac|izdavalac|isporucio)/;
const LABELA_KUPAC = /^(kupac|primalac|narucilac|kupac\/primalac)\b/;
const jeLabela = (tekst: string, labela: RegExp) => {
  const t = bezInterpunkcije(tekst).replace(/^[^a-z]+/, "");
  return t.split(" ").length <= 2 && labela.test(t);
};

/** Vrijednost iza labele: sljedeća ćelija u istom redu (tabela zaglavlja), ili ostatak iste ćelije. */
function iza(linije: Linija[], labela: RegExp): string | null {
  for (const l of linije) {
    for (let i = 0; i < l.length; i++) {
      if (!jeLabela(l[i].tekst, labela)) continue;
      const ostatak = l[i].tekst.replace(/^[^:]*:\s*/, "");
      if (ostatak && ostatak !== l[i].tekst && ostatak.length > 2) return ostatak.trim();
      if (l[i + 1]) return l[i + 1].tekst.trim();
    }
  }
  return null;
}

function stavkeIspod(linije: Linija[], iZaglavlja: number): StavkaOtpremnice[] {
  const kolone = redoslijedKolona(linije[iZaglavlja])!;
  const stavke: StavkaOtpremnice[] = [];
  let promasaja = 0;
  for (const l of linije.slice(iZaglavlja + 1)) {
    if (KRAJ_TABELE.test(bezInterpunkcije(l[0]?.tekst ?? "").replace(/^[^a-z]+/, ""))) break;
    const s = parsirajRed(l, kolone);
    if (s) {
      stavke.push(s);
      promasaja = 0;
    } else if (++promasaja >= 3) break;
  }
  return stavke;
}

function parsirajStranu(linije: Linija[], strana: number): Otpremnica | null {
  let iZaglavlja = -1;
  let stavke: StavkaOtpremnice[] = [];
  for (let i = 0; i < linije.length; i++) {
    if (redoslijedKolona(linije[i]) === null) continue;
    const nadjene = stavkeIspod(linije, i);
    if (iZaglavlja < 0) iZaglavlja = i;
    if (nadjene.length > 0) {
      iZaglavlja = i;
      stavke = nadjene;
      break;
    }
  }
  const glava = iZaglavlja >= 0 ? linije.slice(0, iZaglavlja) : linije;
  const glavaTekst = glava.map(tekstLinije).join("\n");

  let broj: string | null = null;
  const brojRe = /(broj\s+otpremnice|otpremnica\s+(?:br\.?|broj)|br\.?\s*otpremnice|broj\s+dokumenta|dokument\s+br\.?)\s*[:#]?\s*(?:\|\s*)?([A-Z0-9][A-Z0-9\-\/.]*\d[A-Z0-9\-\/]*)/i;
  for (const l of glava) {
    const m = tekstLinije(l).replace(/\s{2,}/g, " ").match(brojRe);
    if (m) {
      broj = m[2].replace(/\.$/, "");
      break;
    }
  }
  const datumIzaLabele = glavaTekst.match(/datum[^0-9\n]{0,40}(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})/i);
  const datum = uDatum(datumIzaLabele?.[1] ?? glavaTekst.match(DATUM)?.[0]);
  const pibovi = [...glavaTekst.matchAll(/PIB[:\s]*([0-9]{8,13})/gi)].map((m) => m[1]);
  // Čiji je PIB: posljednja labela (Isporučilac / Kupac) iznad njega. Ako su obje labele u istom
  // redu (stranke jedna pored druge), ne zna se — tada se ne pogađa.
  let stranka: "isporucilac" | "kupac" | null = null;
  let pibIsporucioca: string | null = null;
  for (const l of glava) {
    const isp = l.some((c) => jeLabela(c.tekst, LABELA_ISPORUCILAC));
    const kup = l.some((c) => jeLabela(c.tekst, LABELA_KUPAC));
    if (isp && kup) stranka = null;
    else if (isp) stranka = "isporucilac";
    else if (kup) stranka = "kupac";
    const pib = tekstLinije(l).match(/PIB[:\s]*([0-9]{8,13})/i)?.[1];
    if (pib && stranka === "isporucilac" && !pibIsporucioca) pibIsporucioca = pib;
  }
  const temperaturaM = linije.map(tekstLinije).join("\n").match(/temperatur\w*[^:\n]{0,30}:\s*([+\-−]?\s?\d{1,2}(?:[.,]\d)?)\s*[°*o]?\s*C/i);
  const temperatura = temperaturaM ? Number(temperaturaM[1].replace(/\s/g, "").replace("−", "-").replace(",", ".")) : null;

  if (!broj && stavke.length === 0) return null;
  return {
    strana,
    broj,
    datum,
    pibovi: [...new Set(pibovi)],
    pibIsporucioca,
    isporucilac: iza(glava, LABELA_ISPORUCILAC),
    kupac: iza(glava, LABELA_KUPAC),
    temperatura: temperatura !== null && Number.isFinite(temperatura) ? temperatura : null,
    stavke,
    kolone: iZaglavlja >= 0 ? (redoslijedKolona(linije[iZaglavlja]) ?? []) : [],
  };
}

/** Jedan fajl može imati više otpremnica (PDF sa više strana). Strana bez broja, a sa stavkama, je
 * nastavak prethodne otpremnice. */
export function parsiraj(strane: Linija[][]): Otpremnica[] {
  const otpremnice: Otpremnica[] = [];
  strane.forEach((linije, i) => {
    const o = parsirajStranu(linije, i + 1);
    if (!o) return;
    const prethodna = otpremnice[otpremnice.length - 1];
    if (!o.broj && prethodna) prethodna.stavke.push(...o.stavke);
    else otpremnice.push(o);
  });
  return otpremnice.filter((o) => o.stavke.length > 0 || o.broj);
}

// ─── Uparivanje sa šifarnikom ────────────────────────────────────────────────────────────────────

/** Dice koeficijent na parovima slova — trpi OCR greške ("Mliijeko" ≈ "Mlijeko"). */
export function slicnost(a: string, b: string): number {
  const cist = (s: string) => normalizuj(s).replace(/\b(d\.?o\.?o\.?|a\.?d\.?|doo)\b/g, "").replace(/[^a-z0-9%]/g, "");
  const x = cist(a);
  const y = cist(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const parovi = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const px = parovi(x);
  const py = parovi(y);
  let zajedno = 0;
  for (const [p, n] of px) zajedno += Math.min(n, py.get(p) ?? 0);
  return (2 * zajedno) / (x.length - 1 + y.length - 1);
}

// Pakovanje i procenat iz naziva („Pileći file 1 kg“, „Mlijeko 2,8% 1 L“). Isti naziv sa drugim
// pakovanjem ili procentom je DRUGI artikal — „1 kg“ se nikad ne upari sa „500 g“ samo zato što
// je ostatak naziva isti.
export type Mjere = { masa: number | null; zapremina: number | null; procenat: number | null; tekst: string | null };
const JEDINICE: Record<string, [keyof Pick<Mjere, "masa" | "zapremina">, number]> = {
  kg: ["masa", 1000], g: ["masa", 1], gr: ["masa", 1], gram: ["masa", 1], grama: ["masa", 1],
  l: ["zapremina", 1000], lit: ["zapremina", 1000], litar: ["zapremina", 1000], litara: ["zapremina", 1000],
  ml: ["zapremina", 1], cl: ["zapremina", 10], dl: ["zapremina", 100],
};
const RE_PAKOVANJE = /(\d+(?:[.,]\d+)?)\s*(kg|grama|gram|gr|g|litara|litar|lit|l|ml|cl|dl)(?![a-z])/g;
const RE_PROCENAT = /(\d+(?:[.,]\d+)?)\s*%/g;

export function mjereIzNaziva(naziv: string | null | undefined): Mjere {
  const s = normalizuj(naziv ?? "");
  const m: Mjere = { masa: null, zapremina: null, procenat: null, tekst: null };
  for (const p of s.matchAll(RE_PAKOVANJE)) {
    const [vrsta, faktor] = JEDINICE[p[2]];
    // Posljednje pakovanje u nazivu je neto („6x1 l“ → 1 l).
    m[vrsta] = Math.round(Number(p[1].replace(",", ".")) * faktor);
    m.tekst = p[0].replace(/\s+/g, " ");
  }
  for (const p of s.matchAll(RE_PROCENAT)) m.procenat = Number(p[1].replace(",", "."));
  return m;
}

/** Naziv bez pakovanja i procenta — za poređenje ostatka („pileci file“). */
const bezMjera = (naziv: string) => normalizuj(naziv).replace(RE_PAKOVANJE, " ").replace(RE_PROCENAT, " ");

/** Opis razlike u pakovanju/procentu, ili null kad se ne sukobljavaju. Masa naspram zapremine
 * („1 kg“ i „1 L“ jogurta) nije sukob — to može biti isti artikal. */
export function sukobMjera(a: Mjere, b: Mjere): string | null {
  const razno = (x: number | null, y: number | null) => x !== null && y !== null && Math.abs(x - y) > Math.max(x, y) * 0.01;
  if (razno(a.masa, b.masa) || razno(a.zapremina, b.zapremina)) return "pakovanje";
  if (razno(a.procenat, b.procenat)) return "procenat";
  return null;
}

const opisMjera = (m: Mjere) =>
  [
    m.procenat !== null ? `${String(m.procenat).replace(".", ",")}%` : null,
    m.masa !== null ? (m.masa >= 1000 ? `${String(m.masa / 1000).replace(".", ",")} kg` : `${m.masa} g`) : null,
    m.zapremina !== null ? (m.zapremina >= 1000 ? `${String(m.zapremina / 1000).replace(".", ",")} L` : `${m.zapremina} ml`) : null,
  ].filter(Boolean).join(" ");

/** Najbolji artikal iz šifarnika za naziv sa otpremnice. Ne bira kad: pakovanje ili procenat se ne
 * slažu, ostatak naziva nije dovoljno sličan, ili su dva artikla podjednako slična. */
export function upariPoNazivu(naziv: string, artikli: { id: string; naziv: string }[]) {
  const otp = mjereIzNaziva(naziv);
  const ocjene = artikli
    .map((a) => ({ a, v: slicnost(bezMjera(a.naziv), bezMjera(naziv)), sukob: sukobMjera(otp, mjereIzNaziva(a.naziv)) }))
    .sort((x, y) => y.v - x.v);
  const PRAG = 0.45;
  const dobri = ocjene.filter((o) => !o.sukob && o.v >= PRAG);
  // O „drugom pakovanju“ se govori samo kad je ostatak naziva stvarno isti proizvod.
  const sukobljen = ocjene.find((o) => o.sukob && o.v >= 0.6);
  if (dobri.length > 1 && dobri[0].v - dobri[1].v < 0.05) {
    return { artikalId: null, napomena: `Više sličnih artikala („${dobri[0].a.naziv}“, „${dobri[1].a.naziv}“) — izaberite pravi.` };
  }
  if (dobri[0] && (!sukobljen || dobri[0].v >= sukobljen.v - 0.15)) {
    return { artikalId: dobri[0].a.id, napomena: "Predlog po nazivu — provjerite da je isti artikal i pakovanje." };
  }
  if (sukobljen) {
    const naOtp = opisMjera(otp) || "drugo pakovanje";
    const kodVas = opisMjera(mjereIzNaziva(sukobljen.a.naziv));
    return {
      artikalId: null,
      napomena: `Na otpremnici je ${naOtp}, a vaš „${sukobljen.a.naziv}“ je ${kodVas || "drugo pakovanje"} — to nije isti artikal. Izaberite pravi sa spiska.`,
    };
  }
  return { artikalId: null, napomena: "Nije prepoznat — izaberite vaš artikal." };
}

/** Ključ artikla dobavljača: njegova šifra, a kad je nema — naziv (malim slovima, bez kvačica). */
export const kljucArtikla = (sifra: string | null | undefined, naziv: string | null | undefined) =>
  sifra?.trim() ? `s:${normalizuj(sifra)}` : `n:${normalizuj(naziv ?? "")}`;

export type PrijedlogStavke = StavkaOtpremnice & {
  artikalId: string | null;
  /** Samo kad je čovjek ranije potvrdio vezu za ovog dobavljača. */
  artikalSigurno: boolean;
  /** Odakle je artikal: zapamćena veza, ista šifra, sličan naziv — ili nije izabran. */
  artikalIzvor: "zapamceno" | "sifra" | "naziv" | null;
  /** Šta magacioner treba da pogleda (drugo pakovanje, više sličnih, nije prepoznat). */
  artikalNapomena: string | null;
  /** Kad artikla nema u Šifarnicima: predlog novog, sa otpremnice (#73). `rezim` je pretpostavka. */
  noviArtikal?: { naziv: string; jedinicaMjere: string; rezim: Rezim | null; rezimPo: "naziv" | "temperatura" | "dobavljac" | null } | null;
  rokIstekao: boolean;
};

export type Rezim = "rashladjeno" | "smrznuto" | "bez";

// Pretpostavka režima novog artikla — samo predlog (granica ostaje NEPOTVRĐENA, #5, #73).
// Redom: naziv robe → temperatura upisana na otpremnici → roba koju ovaj dobavljač inače donosi.
const SMRZNUTO = /(smrznut|zamrznut|duboko ?smrz|frozen|sladoled|pomfrit|ledeno)/;
const RASHLADJENO =
  /(mlijek|mleko|jogurt|kefir|\bsir\b|\bsira\b|kajmak|pavlak|maslac|mlijecn|mlecn|namaz|\bmeso\b|mesn|pilet|pilec|pileci|\bfile\b|kobasic|salam|sunk|prsut|slanin|hrenovk|pastet|riba|\bribe\b|losos|tunj|\bjaja\b|svjez|svez|salat|puding|krem)/;

const BEZ_REZIMA =
  /(hljeb|hleb|pecivo|brasn|secer|\bso\b|\bulje\b|sirce|konzerv|tjestenin|testenin|pirinac|\bpasta\b|\bvoda\b|\bsok\b|sokovi|pivo|\bvino\b|kafa|\bcaj\b|keks|cokolad|bombon|grickal|cips|deterdzent|sapun|papir|salvet|zacin|supa u kesici)/;

export function pretpostaviRezim(naziv: string, temperaturaOtpremnice: number | null, istorija: Rezim[]): { rezim: Rezim; po: "naziv" | "temperatura" | "dobavljac" } | null {
  const n = normalizuj(naziv);
  if (SMRZNUTO.test(n)) return { rezim: "smrznuto", po: "naziv" };
  if (RASHLADJENO.test(n)) return { rezim: "rashladjeno", po: "naziv" };
  if (BEZ_REZIMA.test(n)) return { rezim: "bez", po: "naziv" };
  if (temperaturaOtpremnice !== null) {
    if (temperaturaOtpremnice <= -10) return { rezim: "smrznuto", po: "temperatura" };
    if (temperaturaOtpremnice <= 10) return { rezim: "rashladjeno", po: "temperatura" };
  }
  if (istorija.length > 0) {
    const broj = (r: Rezim) => istorija.filter((x) => x === r).length;
    const najcesci = (["rashladjeno", "smrznuto", "bez"] as const).reduce((a, b) => (broj(b) > broj(a) ? b : a));
    if (broj(najcesci) * 2 > istorija.length) return { rezim: najcesci, po: "dobavljac" };
  }
  return null;
}

/** Jedinica mjere sa otpremnice za novi artikal: „kom.“ → kom, „lit“ → l; nepoznata → kom. */
function jedinicaIzOtpremnice(jm: string | null): string {
  const j = (jm ?? "").toLowerCase().replace(/\.$/, "");
  if (["lit", "l"].includes(j)) return "l";
  if (["kg", "g", "gr"].includes(j)) return j === "kg" ? "kg" : "g";
  if (["pak", "kut", "kart", "fl", "boca", "kanta", "ml"].includes(j)) return j;
  return "kom";
}
export type Prijedlog = {
  strana: number;
  broj: string | null;
  datum: string | null;
  temperaturaNaOtpremnici: number | null;
  dobavljac: { id: string | null; naziv: string | null; pib: string | null; sigurno: boolean };
  stavke: PrijedlogStavke[];
  upozorenja: string[];
};

export async function uskladi(o: Otpremnica): Promise<Prijedlog> {
  const [dobavljaci, firma, artikli] = await Promise.all([
    upit<{ id: string; naziv: string; pib: string | null }>(`select id, naziv, pib from dobavljac where aktivan`),
    upit<{ pib: string | null }>(`select pib from firma limit 1`),
    upit<{ id: string; sifra: string | null; naziv: string }>(`select id, sifra, naziv from artikal where aktivan`),
  ]);
  const cifre = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
  const upozorenja: string[] = [];
  const pibFirme = cifre(firma.rows[0]?.pib);

  if (pibFirme && o.pibovi.length > 0 && !o.pibovi.includes(pibFirme)) {
    upozorenja.push("Na otpremnici nije PIB vaše firme — provjerite da je roba stvarno za vas.");
  }
  const tudjiPibovi = o.pibovi.filter((p) => p !== pibFirme);

  // PIB za NOVOG dobavljača samo kad se zna da je njegov — tuđi PIB (kupca) bi napravio pogrešnog.
  // Bez labele: jedini PIB pored PIB-a vaše firme je dobavljačev — samo ako je vaš PIB tu.
  const pibNovog = o.pibIsporucioca ?? (pibFirme && o.pibovi.includes(pibFirme) && tudjiPibovi.length === 1 ? tudjiPibovi[0] : null);
  let dobavljac: Prijedlog["dobavljac"] = { id: null, naziv: o.isporucilac, pib: pibNovog, sigurno: false };
  const poPibu = dobavljaci.rows.find((d) => cifre(d.pib) && o.pibovi.includes(cifre(d.pib)));
  if (poPibu) {
    dobavljac = { id: poPibu.id, naziv: poPibu.naziv, pib: poPibu.pib, sigurno: true };
  } else if (o.isporucilac) {
    const najbolji = dobavljaci.rows.map((d) => ({ d, s: slicnost(d.naziv, o.isporucilac!) })).sort((a, b) => b.s - a.s)[0];
    if (najbolji && najbolji.s >= 0.6) dobavljac = { id: najbolji.d.id, naziv: najbolji.d.naziv, pib: najbolji.d.pib, sigurno: false };
  }
  if (!dobavljac.id) {
    upozorenja.push(
      `Dobavljač ${o.isporucilac ?? "sa otpremnice"}${dobavljac.pib ? ` (PIB ${dobavljac.pib})` : ""} nije u šifarniku — upisuje ga odgovorno lice (Šifarnici → Dobavljači).`,
    );
  }

  const mapiranja = dobavljac.id
    ? (await upit<{ kljuc: string; artikal_id: string }>(`select kljuc, artikal_id from artikal_dobavljaca where dobavljac_id = $1`, [dobavljac.id])).rows
    : [];
  // Kakvu robu ovaj dobavljač inače donosi — za pretpostavku režima novog artikla.
  const istorija = dobavljac.id
    ? (
        await upit<{ temp_kontrolisano: boolean; temp_max: string | null }>(
          `select a.temp_kontrolisano, a.temp_max from artikal_dobavljaca ad join artikal a on a.id = ad.artikal_id where ad.dobavljac_id = $1`,
          [dobavljac.id],
        )
      ).rows.map((a): Rezim => (!a.temp_kontrolisano ? "bez" : a.temp_max !== null && Number(a.temp_max) <= -10 ? "smrznuto" : "rashladjeno"))
    : [];
  const danas = danasCG();
  const stavke: PrijedlogStavke[] = o.stavke.map((s) => {
    const kljucevi = [kljucArtikla(s.sifra, s.naziv), kljucArtikla(null, s.naziv)];
    const zapamceno = mapiranja.find((m) => kljucevi.includes(m.kljuc));
    const rokIstekao = !!s.rok && s.rok < danas;
    if (zapamceno) return { ...s, artikalId: zapamceno.artikal_id, artikalSigurno: true, artikalIzvor: "zapamceno" as const, artikalNapomena: null, rokIstekao };
    // Ista šifra kod dobavljača i kod vas je slučajnost dok naziv to ne potvrdi — i pakovanje se mora slagati.
    if (s.sifra) {
      const istaSifra = artikli.rows.find((a) => a.sifra && normalizuj(a.sifra) === normalizuj(s.sifra!));
      if (istaSifra && (!s.naziv || (!sukobMjera(mjereIzNaziva(s.naziv), mjereIzNaziva(istaSifra.naziv)) && slicnost(bezMjera(istaSifra.naziv), bezMjera(s.naziv)) >= 0.3))) {
        return { ...s, artikalId: istaSifra.id, artikalSigurno: false, artikalIzvor: "sifra" as const, artikalNapomena: "Ista šifra kao kod vas — provjerite da je isti artikal i pakovanje.", rokIstekao };
      }
    }
    if (!s.naziv) return { ...s, artikalId: null, artikalSigurno: false, artikalIzvor: null, artikalNapomena: "Nije prepoznat — izaberite vaš artikal.", rokIstekao };
    const u = upariPoNazivu(s.naziv, artikli.rows);
    if (u.artikalId) return { ...s, artikalId: u.artikalId, artikalSigurno: false, artikalIzvor: "naziv" as const, artikalNapomena: u.napomena, rokIstekao };
    // Nema ga u Šifarnicima → predlog NOVOG artikla sa otpremnice (#73): upisuje se uz prijem, magacioner
    // samo pregleda. Kad su dva postojeća podjednako slična, ne predlaže se nov — bira se jedan od njih.
    const visePostojecih = u.napomena.startsWith("Više sličnih");
    const rezim = visePostojecih ? null : pretpostaviRezim(s.naziv, o.temperatura, istorija);
    return {
      ...s,
      artikalId: null,
      artikalSigurno: false,
      artikalIzvor: null,
      artikalNapomena: u.napomena,
      noviArtikal: visePostojecih ? null : { naziv: s.naziv, jedinicaMjere: jedinicaIzOtpremnice(s.jm), rezim: rezim?.rezim ?? null, rezimPo: rezim?.po ?? null },
      rokIstekao,
    };
  });
  if (stavke.some((s) => s.rokIstekao)) upozorenja.push("Na otpremnici je roba sa isteklim rokom — takva stavka se ne može prihvatiti.");
  if (stavke.some((s) => !s.artikalId && !s.noviArtikal)) upozorenja.push("Neke stavke nisu prepoznate kao vaš artikal — izaberite ih (napomena je uz stavku); izbor se pamti za ovog dobavljača.");

  return { strana: o.strana, broj: o.broj, datum: o.datum, temperaturaNaOtpremnici: o.temperatura, dobavljac, stavke, upozorenja };
}

/** Cijeli tok: fajl → tekst → otpremnice → prijedlozi. */
export async function procitajOtpremnicu(sadrzaj: Buffer, vrsta: "pdf" | "slika", opcije: OpcijeCitanja = {}) {
  const { otpremnice, pouzdanost } =
    vrsta === "pdf" ? { otpremnice: parsiraj(await procitajPdf(sadrzaj)), pouzdanost: null } : await procitajSliku(sadrzaj, opcije);
  if (otpremnice.length === 0) {
    throw new ApiGreska(
      422,
      "OTPREMNICA_NIJE_PROCITANA",
      vrsta === "slika"
        ? "Na slici nije pronađena tabela sa robom. Slika je sačuvana uz prijem — upišite stavke ručno, ili slikajte ponovo: cijela otpremnica, odozgo, bez sjenke."
        : "U PDF-u nije pronađena tabela sa robom (kolone kao Šifra, Naziv, Količina, Lot, Rok). PDF je sačuvan uz prijem — upišite stavke ručno.",
    );
  }
  return { otpremnice: await Promise.all(otpremnice.map(uskladi)), pouzdanostOcr: pouzdanost };
}


// ─── Čitanje u pozadini ──────────────────────────────────────────────────────────────────────────
// Fotografija se na slabom serveru (Render) čita i do minut. Zahtjev zato NE čeka čitanje do kraja:
// server sačuva fajl, čita u pozadini, a pregledač pita za stanje (napredak, prekid, rezultat) — i
// magacioner u svakom trenutku može preći na ručni unos. Ranije je telefon samo „učitavao“.
export type RezultatCitanja = { otpremnice: Prijedlog[]; pouzdanostOcr: number | null; nijeProcitano: string | null };
type Posao = {
  pocetak: number;
  prolaz: number;
  opis: string;
  prekini: boolean;
  gotovo: Promise<void>;
  rezultat?: RezultatCitanja;
};
const poslovi = new Map<string, Posao>();
const NEPROCITANO = ["OTPREMNICA_NIJE_PROCITANA", "PDF_BEZ_TEKSTA"];

export function pokreniCitanje(dokumentId: string, sadrzaj: Buffer, vrsta: "pdf" | "slika"): Posao {
  const posao: Posao = { pocetak: Date.now(), prolaz: 0, opis: "čeka na red", prekini: false, gotovo: Promise.resolve() };
  poslovi.set(dokumentId, posao);
  posao.gotovo = (async () => {
    let rezultat: RezultatCitanja;
    try {
      const r = await procitajOtpremnicu(sadrzaj, vrsta, {
        naNapredak: (prolaz, opis) => {
          posao.prolaz = prolaz;
          posao.opis = opis;
        },
        prekinuto: () => posao.prekini,
      });
      rezultat = { ...r, nijeProcitano: null };
    } catch (e) {
      if (e instanceof ApiGreska && NEPROCITANO.includes(e.code)) rezultat = { otpremnice: [], pouzdanostOcr: null, nijeProcitano: e.message };
      else {
        console.error("Čitanje otpremnice nije uspjelo:", e);
        rezultat = { otpremnice: [], pouzdanostOcr: null, nijeProcitano: "Čitanje nije uspjelo. Otpremnica je sačuvana uz prijem — upišite stavke ručno ili slikajte ponovo." };
      }
    }
    posao.rezultat = rezultat;
    await upit(`update prijem_dokument set procitano = $1 where id = $2`, [JSON.stringify(rezultat), dokumentId]).catch(() => undefined);
    // Gotov posao se pamti još 15 minuta (zakašnjelo pitanje za stanje), pa se briše.
    setTimeout(() => poslovi.delete(dokumentId), 15 * 60_000).unref();
  })();
  return posao;
}

/** Magacioner je prešao na ručni unos: posle tekućeg prolaza se više ne čita (oslobađa server). */
export function prekiniCitanje(dokumentId: string) {
  const p = poslovi.get(dokumentId);
  if (p) p.prekini = true;
}

/** Dokument otpremnice: magacioner vidi samo svoje, vodstvo sve. */
export async function dokumentZaCitanje(dokumentId: string, korisnik: { id: string; uloga: string }) {
  const d = (
    await upit<{ vrsta: "pdf" | "slika"; procitano: (RezultatCitanja & { status?: string }) | null; uneo_korisnik_id: string }>(
      `select vrsta, procitano, uneo_korisnik_id from prijem_dokument where id = $1`,
      [dokumentId],
    )
  ).rows[0];
  if (!d || (!["bzr", "izvodjac"].includes(korisnik.uloga) && d.uneo_korisnik_id !== korisnik.id)) {
    throw new ApiGreska(404, "DOKUMENT_NE_POSTOJI", "Otpremnica nije pronađena.");
  }
  return d;
}

export async function stanjeCitanja(dokumentId: string, korisnik: { id: string; uloga: string }) {
  const d = await dokumentZaCitanje(dokumentId, korisnik);
  const p = poslovi.get(dokumentId);
  if (p?.rezultat) return { status: "gotovo" as const, dokumentId, vrsta: d.vrsta, ...p.rezultat };
  if (p) return { status: "cita" as const, dokumentId, vrsta: d.vrsta, prolaz: p.prolaz, opis: p.opis, sekundi: Math.round((Date.now() - p.pocetak) / 1000) };
  if (d.procitano && Array.isArray(d.procitano.otpremnice)) {
    return { status: "gotovo" as const, dokumentId, vrsta: d.vrsta, otpremnice: d.procitano.otpremnice, pouzdanostOcr: d.procitano.pouzdanostOcr ?? null, nijeProcitano: d.procitano.nijeProcitano ?? null };
  }
  // Fajl je tu, a posla nema: server je ponovo pokrenut usred čitanja.
  return {
    status: "prekinuto" as const,
    dokumentId,
    vrsta: d.vrsta,
    otpremnice: [] as Prijedlog[],
    pouzdanostOcr: null,
    nijeProcitano: "Čitanje je prekinuto (server je ponovo pokrenut). Otpremnica je sačuvana uz prijem — slikajte ponovo ili upišite stavke ručno.",
  };
}
