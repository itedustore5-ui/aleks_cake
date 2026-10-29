// Matrica pristupa: svaka uloga protiv adresa koje MORA vidjeti i onih koje NE SMIJE.
// Ovaj test je nastao poslije greške u kojoj je .use(requireUloga) jednog rutera na
// zajedničkom "/api" zaključavao sve rute registrovane poslije njega: uprava (kod distributera) je dobijala
// 403 na svom Kontrolnom centru, a ulazak u provjeru znanja šifrom je vraćao 401.
import { prijava, anonimno, NALOZI } from "./pomoc.mjs";

export const naziv = "Ko šta smije da vidi";

// Atelje (PLAN.md 8.3): tri uloge — konsultant, vlasnica (odgovorno lice) i zaposleni. Vozila, isporuke, vozač i
// direktorov pregled su uklonjeni iz koda — njihove adrese više ne postoje (404 za svakoga).
const MORA = {
  ana: ["/tabla", "/prijem", "/lotovi", "/zaliha", "/zapisi", "/mjerenja", "/neusaglasenosti",
    "/lica", "/nalozi", "/plan-obuke", "/evidencija-osposobljavanja", "/provjera-znanja/sesije", "/poruke", "/poruke/primaoci", "/zadaci",
    "/zadaci/izvrsioci", "/obavjestenja", "/skladista", "/kupci", "/dobavljaci", "/artikli", "/povlacenja", "/audit",
    "/bekap/poslednji", "/firma", "/sledljivost/pretraga?q=PV", "/zdravlje", "/aktivnost", "/pitanja-firme",
    "/provjera-znanja/rezultati",
    "/haccp-plan", "/plan-monitoringa", "/monitoring/danas", "/monitoring/pregled", "/mjerni-uredjaji", "/verifikacija-sistema", "/tabla/detalj/monitoring", "/tabla/detalj/rokovi",
    "/tabla/detalj/porudzbine-alergeni", "/tabla/detalj/porudzbine", "/auth/2fa",
    "/van-mreze/odbijeno", "/inspekcija?od=2026-09-01&do=2026-09-30",
    "/alergeni", "/porudzbine", "/porudzbine/sastojci", "/porudzbine/pretraga?q=PRD",
    "/prvi-koraci", "/uredjaji-cuvanja", "/kontrolne-tacke/predlog-teksta?sifra=KKT2"],
  marko: ["/prijem", "/zaliha", "/lotovi", "/zapisi", "/mjerenja", "/neusaglasenosti", "/zadaci", "/obavjestenja", "/skladista", "/lica/ja", "/poruke", "/poruke/primaoci",
    "/kupci", "/dobavljaci", "/artikli", "/zdravlje", "/monitoring/danas", "/mjerni-uredjaji", "/termometri", "/provjera-znanja/moj-termin",
    "/alergeni", "/porudzbine", "/porudzbine/sastojci"],
  konsultant: ["/tabla", "/inspekcija", "/izvoz/izvori", "/izvoz/prijemi/pregled", "/izvoz/porudzbine/pregled", "/porudzbine", "/stanje-poslovanja?vrsta=sedmica", "/audit", "/pitanja", "/nalozi", "/povlacenja", "/zdravlje", "/greske", "/auth/2fa", "/van-mreze/odbijeno",
    "/prvi-koraci", "/uredjaji-cuvanja"],
};

const NE_SMIJE = {
  marko: ["/porudzbine/pretraga?q=PRD", "/stanje-poslovanja", "/greske", "/aktivnost", "/tabla", "/tabla/detalj/neusaglasenosti", "/lica", "/plan-obuke", "/pravila-kontrole", "/pitanja-firme", "/provjera-znanja/rezultati", "/izvoz/izvori", "/nalozi", "/audit", "/povlacenja", "/sledljivost/pretraga?q=PV", "/pitanja",
    "/haccp-plan", "/plan-monitoringa", "/monitoring/pregled", "/verifikacija-sistema", "/tabla/detalj/monitoring", "/van-mreze/odbijeno", "/inspekcija", "/inspekcija/paket.zip",
    "/prvi-koraci", "/uredjaji-cuvanja", "/kontrolne-tacke/predlog-teksta?sifra=KKT2"],
  ana: ["/pitanja", "/greske", "/izvoz/izvori", "/izvoz/prijemi/pregled", "/stanje-poslovanja"], // izvještaji i stanje poslovanja su konsultantovi (11.10.2026) // banka pitanja je samo konsultantova (#14); dnevnik grešaka takođe (#80)
};

/** Adrese distributera kojih u ateljeu nema — ni za koga. */
const UKLONJENO = ["/isporuke", "/vozila", "/kontrole-vozila", "/vozaci", "/tabla/direktor", "/isporuke/kupci"];

export async function pokreni({ provjeri }) {
  const anon = anonimno();
  provjeri("Bez prijave: /zdravlje radi", (await anon("/zdravlje")).status === 200);
  // Provjeru znanja radi samo prijavljeni zaposleni, svojom šifrom (invarijanta #32).
  const uci = await anon("/provjera-znanja/uci", { telo: { sifra: "M-02" } });
  provjeri("Bez prijave: u provjeru znanja se ne ulazi ni sa tačnom šifrom (401)", uci.status === 401, `${uci.status} ${uci.tijelo?.error?.code ?? ""}`);
  provjeri("Bez prijave: Kontrolni centar je zaključan (401)", (await anon("/tabla")).status === 401);

  for (const [kljuc, adrese] of Object.entries(MORA)) {
    const k = await prijava(NALOZI[kljuc]);
    const pali = [];
    for (const a of adrese) {
      const r = await k(a);
      if (r.status !== 200) pali.push(`${a} → ${r.status}`);
    }
    provjeri(`${NALOZI[kljuc].ime}: vidi svih ${adrese.length} svojih adresa`, pali.length === 0, pali.join(", "));
  }
  for (const [kljuc, adrese] of Object.entries(NE_SMIJE)) {
    const k = await prijava(NALOZI[kljuc]);
    const propusteno = [];
    for (const a of adrese) {
      const r = await k(a);
      if (r.status !== 403) propusteno.push(`${a} → ${r.status}`);
    }
    provjeri(`${NALOZI[kljuc].ime}: ne vidi ${adrese.length} tuđih adresa (403)`, propusteno.length === 0, propusteno.join(", "));
  }

  for (const kljuc of ["ana", "marko", "konsultant"]) {
    const k = await prijava(NALOZI[kljuc]);
    const ima = [];
    for (const a of UKLONJENO) {
      const r = await k(a);
      if (r.status !== 404) ima.push(`${a} → ${r.status}`);
    }
    provjeri(`${NALOZI[kljuc].ime}: adrese vozila, isporuka i direktora ne postoje (404)`, ima.length === 0, ima.join(", "));
  }

  const marko = await prijava(NALOZI.marko);
  provjeri("Zaposleni ne mijenja plan monitoringa (403)", (await marko("/plan-monitoringa/osnovni", { telo: {} })).status === 403);
  const ana = await prijava(NALOZI.ana);
  const vozac = await ana("/nalozi", { telo: { korisnickoIme: "e2e.vozac", lozinka: "Proba-2026-vozac", uloga: "vozac" } });
  provjeri("Vlasnica ne otvara nalog vozača — te uloge više nema (400/403)", vozac.status === 400 || vozac.status === 403, `${vozac.status}`);
}
