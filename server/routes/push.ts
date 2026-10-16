import { Router } from "express";
import { z } from "zod";
import { pool } from "../db.js";
import { asyncRuta } from "../greske.js";
import { sviPrijavljeni, type AuthZahtjev } from "../auth.js";
import { tijelo } from "../validacija.js";
import { kreirajObavjestenje } from "../services/zadaciService.js";
import * as push from "../services/pushService.js";

// Obavještenja na telefon — svako uključuje za SVOJ uređaj, na Mojoj strani.
export const pushRuter = Router();

pushRuter.get(
  "/push/kljuc",
  sviPrijavljeni(),
  asyncRuta(async (request: AuthZahtjev, response) => {
    response.json({ javniKljuc: await push.javniKljuc(), brojUredjaja: await push.brojPretplata(request.korisnik!.id) });
  }),
);

const pretplataSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
  uredjaj: z.string().max(200).optional(),
});

pushRuter.post(
  "/push/pretplata",
  sviPrijavljeni(),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const { uredjaj, ...pretplata } = tijelo(pretplataSchema, request.body);
    await push.sacuvajPretplatu(request.korisnik!.id, pretplata, uredjaj ?? null);
    response.status(201).json({ brojUredjaja: await push.brojPretplata(request.korisnik!.id) });
  }),
);

pushRuter.post(
  "/push/odjava",
  sviPrijavljeni(),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const { endpoint } = tijelo(z.object({ endpoint: z.string().max(1000) }), request.body);
    await push.obrisiPretplatu(request.korisnik!.id, endpoint);
    response.status(204).end();
  }),
);

// Probno — da se odmah vidi stiže li na zaključan telefon. Ide istim putem kao svako obavještenje.
pushRuter.post(
  "/push/proba",
  sviPrijavljeni(),
  asyncRuta(async (request: AuthZahtjev, response) => {
    await kreirajObavjestenje(pool, {
      korisnikId: request.korisnik!.id,
      naslov: "Probno obavještenje",
      poruka: "Obavještenja na ovom uređaju rade.",
      ozbiljnost: "NIZAK",
    });
    response.status(202).json({ ok: true });
  }),
);
