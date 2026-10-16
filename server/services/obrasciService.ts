import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { ApiGreska } from "../greske.js";

// Dnevni obrasci (P3–P10) su definisani u public/obrasci-cg.json — isti fajl čita i pregledač.
// Server ga čita da bi SAM ocijenio podatke (nalaz R-08): odstupanje nije samo ručna kvačica,
// nego slijedi iz odgovora („tragovi štetočina: da" je odstupanje i kad kvačica nije stavljena).

export type PoljeObrasca = {
  kljuc: string;
  oznaka: string;
  tip: "text" | "number" | "checkbox";
  /** Za da/ne polje: koji odgovor je odstupanje. */
  odstupanjeAko?: boolean;
  obavezno?: boolean;
};
export type Obrazac = { kod: string; naziv: string; uloge: string[]; polja: PoljeObrasca[] };

const FAJL = fileURLToPath(new URL("../../public/obrasci-cg.json", import.meta.url));

/** Čita se pri svakom pozivu (mali fajl) — izmjena obrazaca važi bez restarta servera. */
export function obrasci(): Obrazac[] {
  return JSON.parse(fs.readFileSync(FAJL, "utf8")) as Obrazac[];
}

export function nadjiObrazac(kod: string): Obrazac {
  const o = obrasci().find((x) => x.kod === kod);
  if (!o) throw new ApiGreska(400, "OBRAZAC_NEPOZNAT", `Obrazac ${kod} ne postoji.`);
  return o;
}

/** Provjerava podatke zapisa prema obrascu i vraća ih očišćene, uz spisak odstupanja iz polja.
 * Nepoznato polje se odbija; da/ne polje mora biti odgovoreno (bez podrazumijevanog odgovora);
 * obavezan tekst mora biti upisan. */
export function ocijeniPodatke(o: Obrazac, podaci: Record<string, unknown>): { podaci: Record<string, unknown>; odstupanja: string[] } {
  const poznata = new Set(o.polja.map((p) => p.kljuc));
  const nepoznato = Object.keys(podaci).filter((k) => !poznata.has(k));
  if (nepoznato.length > 0) throw new ApiGreska(400, "POLJE_NEPOZNATO", `Obrazac ${o.kod} nema polje: ${nepoznato.join(", ")}.`);

  const cisto: Record<string, unknown> = {};
  const odstupanja: string[] = [];
  for (const p of o.polja) {
    const v = podaci[p.kljuc];
    if (p.tip === "checkbox") {
      if (typeof v !== "boolean") throw new ApiGreska(400, "POLJE_OBAVEZNO", `Odgovorite sa da ili ne: „${p.oznaka}".`);
      cisto[p.kljuc] = v;
      if (p.odstupanjeAko !== undefined && v === p.odstupanjeAko) odstupanja.push(`${p.oznaka} — ${v ? "da" : "ne"}`);
    } else if (p.tip === "number") {
      if (v === undefined || v === null || v === "") {
        if (p.obavezno) throw new ApiGreska(400, "POLJE_OBAVEZNO", `Upišite: „${p.oznaka}".`);
        continue;
      }
      const broj = typeof v === "number" ? v : Number(String(v).replace(",", "."));
      if (!Number.isFinite(broj)) throw new ApiGreska(400, "POLJE_BROJ", `„${p.oznaka}" mora biti broj.`);
      cisto[p.kljuc] = broj;
    } else {
      const tekst = v === undefined || v === null ? "" : String(v).trim();
      if (!tekst) {
        if (p.obavezno) throw new ApiGreska(400, "POLJE_OBAVEZNO", `Upišite: „${p.oznaka}".`);
        continue;
      }
      cisto[p.kljuc] = tekst;
    }
  }
  return { podaci: cisto, odstupanja };
}
