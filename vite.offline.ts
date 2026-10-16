import { createHash } from "node:crypto";
import type { Plugin } from "vite";

/** Rad bez mreže (talas 6, invarijanta #85): pri svakoj gradnji zapiše `offline-spisak.json` — sve fajlove
 * aplikacije (i strane koje se učitavaju tek kad se otvore) i verziju. Service worker (public/sw.js) ih
 * sačuva unaprijed, pa se aplikacija na telefonu otvara i bez signala, i strana koju vozač nikad nije
 * otvorio. Nova verzija = novi keš, stari se briše. */
export function spisakZaRadBezMreze(): Plugin {
  return {
    name: "pilot-spisak-za-rad-bez-mreze",
    apply: "build",
    generateBundle(_opcije, paket) {
      const fajlovi = Object.keys(paket)
        .filter((f) => !f.endsWith(".map") && f !== "offline-spisak.json")
        .map((f) => `/${f}`)
        .sort();
      // Iz public/ — potrebni i bez mreže: obrasci (HACCP), manifest i ikonice.
      const javni = ["/obrasci-cg.json", "/manifest.webmanifest", "/favicon.svg", "/ikona-192.png"];
      const verzija = createHash("sha256").update(fajlovi.join("\n")).digest("hex").slice(0, 12);
      this.emitFile({
        type: "asset",
        fileName: "offline-spisak.json",
        source: JSON.stringify({ verzija, fajlovi: ["/", ...fajlovi, ...javni] }, null, 1),
      });
    },
  };
}
