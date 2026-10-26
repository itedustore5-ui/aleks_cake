import { Router } from "express";
import { asyncRuta } from "../greske.js";
import { requireUloga } from "../auth.js";
import { str } from "../validacija.js";
import * as tabla from "../services/tablaService.js";

// Direktorov Kontrolni centar (/tabla/direktor) je uklonjen — u ateljeu je vlasnica i odgovorno lice (PLAN.md 8.3).
export const tablaRuter = Router();

tablaRuter.get(
  "/tabla",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (_request, response) => {
    response.json(await tabla.pregledTable());
  }),
);

tablaRuter.get(
  "/aktivnost",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request, response) => {
    response.json(await tabla.aktivnost(Number(request.query.dana) || 7));
  }),
);

tablaRuter.get(
  "/tabla/detalj/:kartica",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request, response) => {
    response.json(await tabla.detaljKartice(str(request.params.kartica)));
  }),
);
