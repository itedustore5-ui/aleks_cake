import { Router } from "express";
import { z } from "zod";
import { asyncRuta } from "../greske.js";
import { requireUloga, sviPrijavljeni, type AuthZahtjev } from "../auth.js";
import { tijelo } from "../validacija.js";
import { posljednjeGreske, zapisiGresku } from "../services/greskeLogService.js";

// Dnevnik grešaka (#80). Pregledač javlja pad ekrana (GreskaGranica) — samo prijavljeni, najviše 20
// na sat po korisniku. Spisak čita konsultant.
export const greskeRuter = Router();

const PO_KORISNIKU_NA_SAT = 20;
const brojac = new Map<string, { n: number; od: number }>();

const greskaPregledaca = z.object({
  poruka: z.string().min(1).max(1000),
  stek: z.string().max(6000).optional(),
  putanja: z.string().max(300).optional(),
  komponente: z.string().max(3000).optional(),
});

greskeRuter.post(
  "/greske/pregledac",
  sviPrijavljeni(),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const g = tijelo(greskaPregledaca, request.body);
    const id = request.korisnik!.id;
    const s = brojac.get(id);
    const sada = Date.now();
    const stanje = s && sada - s.od < 3_600_000 ? s : { n: 0, od: sada };
    stanje.n++;
    brojac.set(id, stanje);
    if (stanje.n <= PO_KORISNIKU_NA_SAT) {
      await zapisiGresku({
        izvor: "pregledac", putanja: g.putanja ?? null, poruka: g.poruka,
        detalji: [g.stek, g.komponente, `pregledač: ${String(request.headers["user-agent"] ?? "").slice(0, 200)}`].filter(Boolean).join("\n---\n"),
        korisnikId: id,
      });
    }
    response.status(204).end();
  }),
);

greskeRuter.get(
  "/greske",
  requireUloga("izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const sati = Math.min(Math.max(Number(request.query.sati) || 72, 1), 24 * 90);
    response.json(await posljednjeGreske(sati));
  }),
);
