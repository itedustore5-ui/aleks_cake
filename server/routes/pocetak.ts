import { Router } from "express";
import { asyncRuta } from "../greske.js";
import { requireUloga, type AuthZahtjev } from "../auth.js";
import { prviKoraci } from "../services/pocetakService.js";

// „Prvi koraci“ — vlasnica sama podešava atelje (29.10.2026); konsultant vidi isto da je vodi telefonom.
export const pocetakRuter = Router();

pocetakRuter.get(
  "/prvi-koraci",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    response.json(await prviKoraci(request.korisnik!.id));
  }),
);
