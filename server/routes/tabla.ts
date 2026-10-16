import { Router } from "express";
import { asyncRuta } from "../greske.js";
import { requireUloga } from "../auth.js";
import { str } from "../validacija.js";
import * as tabla from "../services/tablaService.js";
import { pregledDirektora } from "../services/stanjeService.js";

export const tablaRuter = Router();

tablaRuter.get(
  "/tabla",
  requireUloga("bzr", "izvodjac", "uprava"),
  asyncRuta(async (_request, response) => {
    response.json(await tabla.pregledTable());
  }),
);

// Direktorov Kontrolni centar: semafor, četiri broja, zapisi po danu, povlačenja u toku (11.10.2026).
tablaRuter.get(
  "/tabla/direktor",
  requireUloga("uprava"),
  asyncRuta(async (_request, response) => {
    response.json(await pregledDirektora());
  }),
);

tablaRuter.get(
  "/aktivnost",
  requireUloga("bzr", "izvodjac", "uprava"),
  asyncRuta(async (request, response) => {
    response.json(await tabla.aktivnost(Number(request.query.dana) || 7));
  }),
);

tablaRuter.get(
  "/tabla/detalj/:kartica",
  requireUloga("bzr", "izvodjac", "uprava"),
  asyncRuta(async (request, response) => {
    response.json(await tabla.detaljKartice(str(request.params.kartica)));
  }),
);
