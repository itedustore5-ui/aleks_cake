import { Router } from "express";
import { z } from "zod";
import { asyncRuta } from "../greske.js";
import { sviPrijavljeni, type AuthZahtjev } from "../auth.js";
import { tijelo, str } from "../validacija.js";
import * as poruke from "../services/porukeService.js";

export const porukeRuter = Router();
// Poruke šalju SVI zaposleni jedni drugima (odluka vlasnice 26.09.2026) — magacioner vozaču, vozač
// odgovornom licu, uprava svima. Primalac poruku dobija kao obavještenje (zvonce, Moja strana, telefon).

porukeRuter.get(
  "/poruke/primaoci",
  sviPrijavljeni(),
  asyncRuta(async (request: AuthZahtjev, response) => {
    response.json(await poruke.moguciPrimaoci(request.korisnik!.id));
  }),
);

const porukaSchema = z.object({
  naslov: z.string().trim().min(2, "Upišite naslov poruke.").max(200),
  tekst: z.string().trim().max(2000).optional(),
  vazno: z.boolean().default(false),
  primaoci: z.discriminatedUnion("nacin", [
    z.object({ nacin: z.literal("svi") }),
    z.object({ nacin: z.literal("uloge"), uloge: z.array(z.enum(["operater", "vozac", "bzr", "uprava", "izvodjac"])).min(1, "Izaberite bar jednu grupu.") }),
    z.object({ nacin: z.literal("pojedinacno"), korisnici: z.array(z.string().uuid()).min(1, "Izaberite bar jednu osobu.") }),
  ]),
});

porukeRuter.post(
  "/poruke",
  sviPrijavljeni(),
  asyncRuta(async (request: AuthZahtjev, response) => {
    response.status(201).json(await poruke.posaljiPoruku(tijelo(porukaSchema, request.body), request.korisnik!.id));
  }),
);

porukeRuter.get(
  "/poruke",
  sviPrijavljeni(),
  asyncRuta(async (request: AuthZahtjev, response) => {
    response.json(await poruke.poslatePoruke(request.korisnik!));
  }),
);

porukeRuter.get(
  "/poruke/primljene",
  sviPrijavljeni(),
  asyncRuta(async (request: AuthZahtjev, response) => {
    response.json(await poruke.primljenePoruke(request.korisnik!.id));
  }),
);

porukeRuter.get(
  "/poruke/:id/primaoci",
  sviPrijavljeni(),
  asyncRuta(async (request: AuthZahtjev, response) => {
    response.json(await poruke.primaociPoruke(str(request.params.id), request.korisnik!));
  }),
);
