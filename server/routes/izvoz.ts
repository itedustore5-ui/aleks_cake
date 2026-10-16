import { Router } from "express";
import { asyncRuta } from "../greske.js";
import { requireUloga } from "../auth.js";
import { IZVORI_IZVOZA, izvezi, izveziSve, nizUCsv, pregled, spisakIzvora, type FilterIzvoza } from "../services/izvozService.js";
import { str } from "../validacija.js";

export const izvozRuter = Router();
// Izvještaji (tabele, CSV, sve.json) su konsultantovi (odluka vlasnice 11.10.2026) — odgovorno lice ima
// „Za inspekciju“ (svoj paket i ZIP, routes/inspekcija.ts), direktor dobija „Stanje poslovanja“ mejlom.
// Provjera važi SAMO za adrese ovog rutera. Ruter je montiran na zajednički "/api", pa bi
// .use(...) bez putanje važio za SVAKI zahtjev koji prođe kroz njega — i zaključao bi rute
// registrovane poslije (ovako je uprava dobijala 403 na /api/tabla).

/** HTTP zaglavlja moraju biti ASCII — "š"/"č"/"ž"/"đ" u nazivu izvještaja (npr.
 * "Neusaglašenosti", "Povlačenja") su rušili preuzimanje sa ERR_INVALID_CHAR. Fajl dobija
 * ASCII naziv kao osnovu (filename=) i pravi naziv preko RFC 5987 dodatka (filename*=), pa
 * savremeni pregledač i dalje snimi fajl sa kvačicama u imenu. */
function nazivZaZaglavlje(naziv: string, ekstenzija: string) {
  const osnova = naziv.replaceAll(/\s+/g, "-").toLowerCase();
  const ascii = osnova
    .replaceAll(/[šŠ]/g, "s")
    .replaceAll(/[čćČĆ]/g, "c")
    .replaceAll(/[žŽ]/g, "z")
    .replaceAll(/[đĐ]/g, "dj");
  return `attachment; filename="${ascii}.${ekstenzija}"; filename*=UTF-8''${encodeURIComponent(`${osnova}.${ekstenzija}`)}`;
}

/** `?od=2026-09-01&do=2026-09-30&f_status=PRIHVACEN` → filter izvoza (provjerava ga izvozService). */
function filterIzUpita(upit: Record<string, unknown>): FilterIzvoza {
  const tekst = (v: unknown) => (typeof v === "string" && v.length <= 200 ? v : undefined);
  const polja: Record<string, string> = {};
  for (const [k, v] of Object.entries(upit)) {
    const vr = tekst(v);
    if (k.startsWith("f_") && vr) polja[k.slice(2)] = vr;
  }
  return { od: tekst(upit.od), do: tekst(upit.do), polja };
}

izvozRuter.get(
  "/izvoz/izvori",
  requireUloga("izvodjac"),
  asyncRuta(async (_request, response) => {
    response.json(await spisakIzvora());
  }),
);

izvozRuter.get(
  "/izvoz/:kod/pregled",
  requireUloga("izvodjac"),
  asyncRuta(async (request, response) => {
    response.json(await pregled(str(request.params.kod), filterIzUpita(request.query)));
  }),
);

izvozRuter.get(
  "/izvoz/:kod.csv",
  requireUloga("izvodjac"),
  asyncRuta(async (request, response) => {
    const { naziv, csv } = await izvezi(str(request.params.kod), filterIzUpita(request.query));
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", nazivZaZaglavlje(naziv, "csv"));
    response.send(csv);
  }),
);

izvozRuter.get(
  "/izvoz/sve.json",
  requireUloga("izvodjac"),
  asyncRuta(async (_request, response) => {
    const { podaci, nedostaje } = await izveziSve();
    response.json({ podaci, nedostaje, izvezenoAt: new Date().toISOString() });
  }),
);

izvozRuter.get(
  "/izvoz/sve.csv-arhiva",
  requireUloga("izvodjac"),
  asyncRuta(async (_request, response) => {
    const { podaci, nedostaje } = await izveziSve();
    const dijelovi = Object.entries(podaci).map(([kod, redovi]) => `--- ${kod} ---\n${nizUCsv(redovi)}`);
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.send([...dijelovi, nedostaje.length ? `\nNedostaje: ${nedostaje.map((n) => n.naziv).join(", ")}` : ""].join("\n\n"));
  }),
);
