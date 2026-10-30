import { Router } from "express";
import { z } from "zod";
import { asyncRuta } from "../greske.js";
import { requireUloga, type AuthZahtjev } from "../auth.js";
import { tijelo, str } from "../validacija.js";
import { kljucIzZaglavlja } from "../services/kljucService.js";
import {
  vitrinaSada, detaljSerije, istorijaVitrine, kreirajSeriju, izmijeniSeriju, dodajLot, ukloniLot, upisiPromet, ponistiPromet, vitrinaSerijeLota,
} from "../services/vitrinaService.js";

// Kolači iz vitrine (dopuna 42). Rade ih svi u ateljeu — zaposleni, vlasnica, konsultant (kao porudžbine, P5).
// Sledljivost serije kroz kolače čita vodstvo, kao i ostatak sledljivosti.
export const vitrinaRuter = Router();
const ATELJE = ["operater", "bzr", "izvodjac"] as const;
const DATUM = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum nije ispravan.");

const osnovaSchema = {
  naziv: z.string().trim().min(2, "Upišite naziv kolača.").max(200, "Naziv je predug."),
  komada: z.number().int("Broj komada je cio broj.").min(1, "Upišite koliko je komada napravljeno.").max(10000, "Najviše 10.000 komada."),
  rok: DATUM,
  napomena: z.string().max(1000).optional(),
};

const kolicina = z.number().int("Broj komada je cio broj.").min(0, "Broj komada ne može biti manji od nule.").max(10000);

vitrinaRuter.get("/vitrina", requireUloga(...ATELJE), asyncRuta(async (request: AuthZahtjev, response) => {
  response.json(await vitrinaSada(request.korisnik!));
}));

// Prije `/vitrina/:id` — inače bi „istorija“ bio id.
vitrinaRuter.get("/vitrina/istorija", requireUloga(...ATELJE), asyncRuta(async (request: AuthZahtjev, response) => {
  const od = typeof request.query.od === "string" && request.query.od ? request.query.od : undefined;
  const doDana = typeof request.query.do === "string" && request.query.do ? request.query.do : undefined;
  response.json(await istorijaVitrine(request.korisnik!, od, doDana));
}));

// Sledljivost unaprijed: serija lota → kolači iz vitrine → koliko je prodato kog dana.
vitrinaRuter.get("/sledljivost/lot/:id/vitrina", requireUloga("bzr", "izvodjac"), asyncRuta(async (request, response) => {
  response.json(await vitrinaSerijeLota(str(request.params.id)));
}));

vitrinaRuter.get("/vitrina/:id", requireUloga(...ATELJE), asyncRuta(async (request: AuthZahtjev, response) => {
  response.json(await detaljSerije(str(request.params.id), request.korisnik!));
}));

vitrinaRuter.post("/vitrina", requireUloga(...ATELJE), asyncRuta(async (request: AuthZahtjev, response) => {
  const ulaz = tijelo(
    z.object({
      ...osnovaSchema,
      datum: DATUM.optional(),
      lotIds: z.array(z.string().uuid("Izaberite sastojak sa spiska.")).max(50, "Najviše 50 sastojaka.").default([]),
    }),
    request.body,
  );
  response.status(201).json(await kreirajSeriju(ulaz, request.korisnik!, kljucIzZaglavlja(request.headers["x-kljuc-zahtjeva"])));
}));

vitrinaRuter.patch("/vitrina/:id", requireUloga(...ATELJE), asyncRuta(async (request: AuthZahtjev, response) => {
  const ulaz = tijelo(z.object(osnovaSchema), request.body);
  await izmijeniSeriju(str(request.params.id), ulaz, request.korisnik!);
  response.status(204).end();
}));

vitrinaRuter.post("/vitrina/:id/promet", requireUloga(...ATELJE), asyncRuta(async (request: AuthZahtjev, response) => {
  const ulaz = tijelo(
    z.object({
      prodato: kolicina.default(0),
      otpisano: kolicina.default(0),
      razlog: z.string().max(500).optional(),
      datum: DATUM.optional(),
      prijeZadrzavanja: z.boolean().optional(),
    }),
    request.body,
  );
  response.json(await upisiPromet(str(request.params.id), ulaz, request.korisnik!));
}));

vitrinaRuter.post("/vitrina/promet/:id/ponisti", requireUloga(...ATELJE), asyncRuta(async (request: AuthZahtjev, response) => {
  const { razlog } = tijelo(z.object({ razlog: z.string().max(500).optional() }), request.body ?? {});
  response.json(await ponistiPromet(str(request.params.id), razlog, request.korisnik!));
}));

vitrinaRuter.post("/vitrina/:id/lotovi", requireUloga(...ATELJE), asyncRuta(async (request: AuthZahtjev, response) => {
  const { lotId } = tijelo(z.object({ lotId: z.string().uuid("Izaberite sastojak (lot).") }), request.body);
  response.json(await dodajLot(str(request.params.id), lotId, request.korisnik!));
}));

vitrinaRuter.delete("/vitrina/:id/lotovi/:lotId", requireUloga(...ATELJE), asyncRuta(async (request: AuthZahtjev, response) => {
  await ukloniLot(str(request.params.id), str(request.params.lotId), request.korisnik!);
  response.status(204).end();
}));
