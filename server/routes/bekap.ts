import { once } from "node:events";
import { Router } from "express";
import { asyncRuta } from "../greske.js";
import { requireUloga, type AuthZahtjev } from "../auth.js";
import { pisiBekap, poslednjiBekap, istorijaBekapa } from "../services/bekapService.js";
import { danasCG } from "../vrijeme.js";

export const bekapRuter = Router();
bekapRuter.get(
  "/bekap/poslednji",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (_request, response) => {
    response.json(await poslednjiBekap());
  }),
);

bekapRuter.get(
  "/bekap/istorija",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (_request, response) => {
    response.json(await istorijaBekapa());
  }),
);

// Preuzimanje odmah, bez kopije u bazi (dopuna 35). JSON ide tabelu po tabelu; ako baza pukne usred
// pisanja, veza se prekida — pregledač javlja da preuzimanje nije uspjelo, umjesto da sačuva pola fajla.
bekapRuter.get(
  "/bekap/preuzmi",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="bekap-cg-${danasCG()}.json"`);
    response.setHeader("Cache-Control", "no-store");
    try {
      await pisiBekap(async (dio) => {
        if (response.write(dio)) return;
        // Pun bafer: čeka se da pregledač preuzme — ili da veza pukne (tada se transakcija ne ostavlja otvorenom).
        await Promise.race([once(response, "drain"), once(response, "close")]);
        if (response.destroyed) throw new Error("Veza je prekinuta usred preuzimanja bekapa.");
      }, request.korisnik!.id);
      response.end();
    } catch (greska) {
      if (!response.headersSent) throw greska;
      if (!response.destroyed) console.error("Bekap prekinut usred pisanja:", greska);
      response.destroy();
    }
  }),
);
