// Podaci za štampu priloga i izvoz klijentu (invarijante #30, #31): svaki izvor se izvozi, nijedan
// ne nedostaje, i kolone koje se prodaju kao dokaz (naknadni unos, temperatura pri predaji,
// skladište) stvarno stoje u CSV-u. Ništa ne upisuje.
import { prijava, NALOZI } from "./pomoc.mjs";

export const naziv = "Prilozi za štampu i izvoz";

const zaglavlje = (csv) => (typeof csv === "string" ? csv.replace(/^﻿/, "").split(/\r?\n/)[0].split(/[;,]/).map((k) => k.replace(/"/g, "").trim()) : []);

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const direktor = await prijava(NALOZI.direktor);
  // Izvještaji i izvoz su konsultantovi (odluka vlasnice 11.10.2026).
  const konsultant = await prijava(NALOZI.konsultant);

  const firma = await ana("/firma");
  provjeri("Rješenje o imenovanju: podaci o firmi", firma.status === 200 && firma.tijelo?.naziv, firma.tijelo?.naziv);
  const plan = await ana("/plan-obuke");
  provjeri("Prilog 13: plan obuke sa stanjem", plan.status === 200 && Array.isArray(plan.tijelo) && plan.tijelo.every((p) => "stanje" in p), `${plan.tijelo?.length} stavki`);
  const ev = await ana("/evidencija-osposobljavanja");
  provjeri("Prilog 14: evidencija osposobljavanja", ev.status === 200 && Array.isArray(ev.tijelo) && ev.tijelo.every((e) => "ime" in e), `${ev.tijelo?.length} lica`);

  const izvori = (await konsultant("/izvoz/izvori")).tijelo;
  provjeri("Spisak izvora za izvoz", Array.isArray(izvori) && izvori.length >= 10, `${izvori?.length}`);
  provjeri("Nijedan izvor ne nedostaje u bazi", izvori.every((i) => !i.nedostaje), izvori.filter((i) => i.nedostaje).map((i) => i.kod).join(", "));

  const pali = [];
  const csv = {};
  for (const i of izvori) {
    const r = await konsultant(`/izvoz/${i.kod}.csv`);
    if (r.status !== 200) pali.push(`${i.kod} → ${r.status}`);
    csv[i.kod] = r.tijelo;
  }
  provjeri(`Svih ${izvori.length} CSV fajlova se preuzima`, pali.length === 0, pali.join(", "));
  provjeri("Prijemi: kolone naknadno_dana i skladiste_naziv", ["naknadno_dana", "skladiste_naziv"].every((k) => zaglavlje(csv.prijemi).includes(k)));
  provjeri("Isporuke: kolone naknadno_dana i skladiste_naziv", ["naknadno_dana", "skladiste_naziv"].every((k) => zaglavlje(csv.isporuke).includes(k)));
  provjeri("Stavke isporuka: temperatura_predaje", zaglavlje(csv.isporuke_stavke).includes("temperatura_predaje"));
  provjeri("Dnevni zapisi: naknadno_dana", zaglavlje(csv.zapisi).includes("naknadno_dana"));

  const pregled = await konsultant("/izvoz/prijemi/pregled");
  provjeri("Pregled prije preuzimanja: kolone, redovi i ukupan broj", pregled.status === 200 && pregled.tijelo.kolone.includes("naknadno_dana") && Array.isArray(pregled.tijelo.redovi) && pregled.tijelo.ukupno >= pregled.tijelo.redovi.length, `${pregled.tijelo?.redovi?.length}/${pregled.tijelo?.ukupno}`);

  const sve = await konsultant("/izvoz/sve.json");
  provjeri("Sve u jednom JSON-u, bez nedostajućih", sve.status === 200 && (sve.tijelo?.nedostaje ?? []).length === 0 && Object.keys(sve.tijelo?.podaci ?? {}).length === izvori.length);
  provjeri("Uprava ne izvozi podatke (403)", (await direktor("/izvoz/sve.json")).status === 403);
  provjeri("Odgovorno lice više ne izvozi tabele (403) — izvještaji su kod konsultanta; ostaje mu „Za inspekciju“",
    (await ana("/izvoz/sve.json")).status === 403 && (await ana("/izvoz/prijemi.csv")).status === 403 && (await ana("/inspekcija")).status === 200);
}
