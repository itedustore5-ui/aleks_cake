import { Router } from "express";
import { z } from "zod";
import { asyncRuta } from "../greske.js";
import { requireUloga, type AuthZahtjev, sviPrijavljeni } from "../auth.js";
import { tijelo, str } from "../validacija.js";
import * as zadaci from "../services/zadaciService.js";

export const zadaciRuter = Router();

zadaciRuter.get(
  "/zadaci",
  sviPrijavljeni(),
  asyncRuta(async (request: AuthZahtjev, response) => {
    response.json(await zadaci.listaZadataka(request.korisnik!, request.query.moji === "1"));
  }),
);

zadaciRuter.get(
  "/zadaci/izvrsioci",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (_request, response) => {
    response.json(await zadaci.izvrsioci());
  }),
);

const noviZadatakSchema = z.object({
  naslov: z.string().trim().min(3, "Upišite šta treba uraditi."),
  opis: z.string().trim().optional(),
  dodijeljenoKorisnikId: z.string().uuid().nullable().optional(),
  prioritet: z.enum(["NIZAK", "SREDNJI", "VISOK"]).default("SREDNJI"),
  rok: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Rok mora biti datum.").optional(),
});

zadaciRuter.post(
  "/zadaci",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const id = await zadaci.kreirajRucniZadatak(tijelo(noviZadatakSchema, request.body), request.korisnik!.id);
    response.status(201).json({ id });
  }),
);

const izmjenaSchema = z
  .object({
    status: z.enum(["OTVOREN", "U_TOKU", "ZAVRSEN", "OTKAZAN"]).optional(),
    dodijeljenoKorisnikId: z.string().uuid().nullable().optional(),
  })
  .refine((u) => u.status !== undefined || u.dodijeljenoKorisnikId !== undefined, { message: "Nema izmjene." });

zadaciRuter.patch(
  "/zadaci/:id",
  sviPrijavljeni(),
  asyncRuta(async (request: AuthZahtjev, response) => {
    await zadaci.izmijeniZadatak(str(request.params.id), tijelo(izmjenaSchema, request.body), request.korisnik!);
    response.status(204).end();
  }),
);

zadaciRuter.get(
  "/obavjestenja",
  sviPrijavljeni(),
  asyncRuta(async (request: AuthZahtjev, response) => {
    response.json(await zadaci.obavjestenjaKorisnika(request.korisnik!.id));
  }),
);

zadaciRuter.patch(
  "/obavjestenja/procitano-sve",
  sviPrijavljeni(),
  asyncRuta(async (request: AuthZahtjev, response) => {
    await zadaci.procitajSvaObavjestenja(request.korisnik!.id);
    response.status(204).end();
  }),
);

zadaciRuter.patch(
  "/obavjestenja/:id/procitano",
  sviPrijavljeni(),
  asyncRuta(async (request: AuthZahtjev, response) => {
    await zadaci.procitajObavjestenje(str(request.params.id), request.korisnik!.id);
    response.status(204).end();
  }),
);
