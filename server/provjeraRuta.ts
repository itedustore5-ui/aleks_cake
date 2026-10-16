import { Router, type Express } from "express";
import { requireAuth } from "./auth.js";

type Rukovalac = ((...a: never[]) => unknown) & { uloge?: unknown; stack?: Sloj[]; javni?: boolean };
type Sloj = {
  name: string;
  handle: Rukovalac;
  route?: { path: string | string[]; methods: Record<string, boolean>; stack: { handle: Rukovalac }[] };
};

/** Ruter čije su adrese dostupne BEZ prijave. Montira se ispred granice prijave u `index.ts`. */
export const javniRuter = () => Object.assign(Router(), { javni: true as const });

/** Nalaz A3 (faza 4): ko smije šta ne smije zavisiti od redoslijeda montiranja rutera. Ova provjera
 * ide kroz sve montirano u aplikaciji i vraća spisak prekršaja:
 *  1. ispred granice prijave (`app.use("/api", requireAuth)`) smiju biti samo javni ruteri;
 *  2. iza granice ruter nema svoj `.use(...)` — takav je nekad zaključao upravu i provjeru znanja;
 *  3. iza granice svaka ruta nosi `requireUloga(...)` (za sve prijavljene: `sviPrijavljeni()`).
 * Prazan spisak = u redu. */
export function provjeriRute(app: Express): string[] {
  const greske: string[] = [];
  let izaGranice = false;
  const opis = (s: Sloj) => `${Object.keys(s.route!.methods).map((m) => m.toUpperCase()).join(",")} ${[s.route!.path].flat().join(" | ")}`;
  const imaUloge = (s: Sloj) => s.route!.stack.some((h) => Array.isArray(h.handle.uloge));

  for (const sloj of (app.router as unknown as { stack: Sloj[] }).stack) {
    if (sloj.handle === (requireAuth as unknown)) {
      izaGranice = true;
      continue;
    }
    const ruter = sloj.handle.stack ? sloj.handle : null;
    if (!izaGranice) {
      if (ruter && !ruter.javni) greske.push(`ruter sa adresama ${ruter.stack!.filter((s) => s.route).map(opis).join(", ")} je montiran ISPRED granice prijave — ili je javni (javniRuter()), ili ide iza granice`);
      continue;
    }
    if (sloj.route) {
      if (!imaUloge(sloj)) greske.push(`${opis(sloj)} — nema requireUloga(...)`);
      continue;
    }
    if (!ruter) continue; // obična međuobrada aplikacije (404 za /api, greške) — ne dodjeljuje prava
    if (ruter.javni) greske.push("javni ruter je montiran IZA granice prijave — nikad neće biti javan");
    for (const s of ruter.stack!) {
      if (!s.route) greske.push(`ruter ima .use(${s.name}) — uloge se pišu na svakoj ruti, ne na ruteru`);
      else if (!imaUloge(s)) greske.push(`${opis(s)} — nema requireUloga(...)`);
    }
  }
  if (!izaGranice) greske.push("granica prijave (app.use(\"/api\", requireAuth)) nije montirana");
  return greske;
}
