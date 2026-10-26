import { Router } from "express";
import { asyncRuta, ApiGreska } from "../greske.js";
import { requireUloga } from "../auth.js";
import { pretraziSledljivost, lanacNaprijedZaLot } from "../services/sledljivostService.js";
import { str } from "../validacija.js";

export const sledljivostRuter = Router();
// Provjera važi SAMO za adrese ovog rutera. Ruter je montiran na zajednički "/api", pa bi
// .use(...) bez putanje važio za SVAKI zahtjev koji prođe kroz njega — i zaključao bi rute
// registrovane poslije (ovako je uprava dobijala 403 na /api/tabla).

sledljivostRuter.get(
  "/sledljivost/pretraga",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request, response) => {
    const q = typeof request.query.q === "string" ? request.query.q.trim() : "";
    if (q.length < 2) {
      response.json([]);
      return;
    }
    response.json(await pretraziSledljivost(q));
  }),
);

sledljivostRuter.get(
  "/sledljivost/lot/:id",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request, response) => {
    const lanac = await lanacNaprijedZaLot(str(request.params.id));
    if (lanac.length === 0) throw new ApiGreska(404, "LOT_NE_POSTOJI", "Lot nije pronađen ili nema podataka o sledljivosti.");
    response.json(lanac);
  }),
);
// Torte serije: /sledljivost/lot/:id/porudzbine (routes/porudzbine.ts). Lanac unazad za isporuku je uklonjen sa isporukama.
