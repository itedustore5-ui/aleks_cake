// Matrica pristupa: svaka uloga protiv adresa koje MORA vidjeti i onih koje NE SMIJE.
// Ovaj test je nastao poslije greške u kojoj je .use(requireUloga) jednog rutera na
// zajedničkom "/api" zaključavao sve rute registrovane poslije njega: uprava je dobijala 403 na
// svom Kontrolnom centru, a ulazak u provjeru znanja šifrom je vraćao 401.
import { prijava, anonimno, NALOZI } from "./pomoc.mjs";

export const naziv = "Ko šta smije da vidi";

const MORA = {
  ana: ["/tabla", "/prijem", "/lotovi", "/zaliha", "/zapisi", "/mjerenja", "/isporuke", "/vozila", "/kontrole-vozila", "/neusaglasenosti",
    "/lica", "/nalozi", "/plan-obuke", "/evidencija-osposobljavanja", "/provjera-znanja/sesije", "/poruke", "/poruke/primaoci", "/zadaci",
    "/zadaci/izvrsioci", "/obavjestenja", "/skladista", "/kupci", "/dobavljaci", "/artikli", "/povlacenja", "/audit",
    "/bekap/poslednji", "/firma", "/sledljivost/pretraga?q=MLJ", "/zdravlje", "/aktivnost", "/pitanja-firme",
    "/provjera-znanja/rezultati",
    "/haccp-plan", "/plan-monitoringa", "/monitoring/danas", "/monitoring/pregled", "/mjerni-uredjaji", "/verifikacija-sistema", "/tabla/detalj/monitoring", "/tabla/detalj/rokovi", "/auth/2fa",
    "/van-mreze/odbijeno", "/inspekcija?od=2026-09-01&do=2026-09-30"],
  direktor: ["/tabla", "/tabla/direktor", "/aktivnost", "/tabla/detalj/neusaglasenosti", "/povlacenja", "/lotovi", "/poruke", "/poruke/primaoci", "/zadaci", "/obavjestenja", "/skladista", "/sledljivost/pretraga?q=MLJ", "/zdravlje",
    "/haccp-plan", "/plan-monitoringa", "/monitoring/danas", "/monitoring/pregled", "/mjerni-uredjaji", "/verifikacija-sistema", "/tabla/detalj/monitoring", "/provjera-znanja/moj-termin", "/inspekcija?od=2026-09-01&do=2026-09-30"],
  marko: ["/prijem", "/zaliha", "/lotovi", "/zapisi", "/mjerenja", "/isporuke", "/neusaglasenosti", "/zadaci", "/obavjestenja", "/skladista", "/lica/ja", "/poruke", "/poruke/primaoci",
    "/kupci", "/dobavljaci", "/artikli", "/vozaci", "/zdravlje", "/monitoring/danas", "/mjerni-uredjaji"],
  petar: ["/isporuke", "/vozila", "/kontrole-vozila", "/neusaglasenosti", "/zadaci", "/obavjestenja", "/vozaci", "/skladista", "/kupci", "/zaliha", "/lica/ja", "/zdravlje", "/monitoring/danas", "/provjera-znanja/moj-termin", "/poruke", "/poruke/primaoci", "/termometri"],
  konsultant: ["/tabla", "/inspekcija", "/izvoz/izvori", "/izvoz/prijemi/pregled", "/stanje-poslovanja?vrsta=sedmica", "/audit", "/pitanja", "/nalozi", "/povlacenja", "/zdravlje", "/greske", "/auth/2fa", "/van-mreze/odbijeno"],
};

const NE_SMIJE = {
  direktor: ["/stanje-poslovanja", "/van-mreze/odbijeno", "/pitanja-firme", "/izvoz/prijemi/pregled", "/izvoz/izvori", "/audit", "/nalozi", "/pitanja", "/kontrole-vozila", "/lica", "/prijem", "/zapisi", "/plan-obuke"],
  marko: ["/stanje-poslovanja", "/tabla/direktor", "/greske", "/aktivnost", "/tabla", "/tabla/detalj/neusaglasenosti", "/lica", "/plan-obuke", "/pravila-kontrole", "/pitanja-firme", "/provjera-znanja/rezultati", "/kontrole-vozila", "/izvoz/izvori", "/nalozi", "/audit", "/povlacenja", "/sledljivost/pretraga?q=MLJ", "/pitanja",
    "/haccp-plan", "/plan-monitoringa", "/monitoring/pregled", "/verifikacija-sistema", "/tabla/detalj/monitoring", "/van-mreze/odbijeno", "/inspekcija", "/inspekcija/paket.zip"],
  petar: ["/izvoz/izvori", "/nalozi", "/audit", "/povlacenja", "/pitanja", "/sledljivost/pretraga?q=MLJ", "/tabla", "/lica", "/prijem", "/zapisi", "/mjerenja", "/dobavljaci", "/artikli", "/lotovi", "/kontrolne-tacke", "/mjerni-uredjaji", "/haccp-plan", "/plan-monitoringa", "/inspekcija", "/inspekcija/paket.zip"],
  ana: ["/pitanja", "/greske", "/tabla/direktor", "/izvoz/izvori", "/izvoz/prijemi/pregled", "/stanje-poslovanja"], // izvještaji i stanje poslovanja su konsultantovi (11.10.2026) // banka pitanja je samo konsultantova (#14); dnevnik grešaka takođe (#80)
};

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

  const direktor = await prijava(NALOZI.direktor);
  provjeri("Direktor ne mijenja plan monitoringa (403)", (await direktor("/plan-monitoringa/osnovni", { telo: {} })).status === 403);
  const petar = await prijava(NALOZI.petar);
  provjeri("Vozač ne upisuje HACCP obrasce (403)", (await petar("/zapisi", { telo: { obrazacKod: "P3", datum: "2026-01-01", podaci: {} } })).status === 403);
}
