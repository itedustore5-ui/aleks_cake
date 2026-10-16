import { Router } from "express";
import { z } from "zod";
import { asyncRuta } from "../greske.js";
import { requireUloga, type AuthZahtjev, sviPrijavljeni } from "../auth.js";
import { tijelo, str } from "../validacija.js";
import * as ljudi from "../services/ljudiService.js";

export const ljudiRuter = Router();

// Moja strana: svoja šifra i svoja knjižica. Cijeli spisak vidi samo vodstvo (nalaz U1).
ljudiRuter.get(
  "/lica/ja",
  sviPrijavljeni(),
  asyncRuta(async (request: AuthZahtjev, response) => {
    response.json(await ljudi.mojeLice(request.korisnik!.id));
  }),
);

ljudiRuter.get(
  "/lica",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (_request, response) => {
    response.json(await ljudi.svaLica());
  }),
);

const ULOGE = ["bzr", "operater", "vozac", "uprava", "izvodjac"] as const;
const lozinkaPolje = z.string().optional();

const noviNalogPodaci = z.object({
  korisnickoIme: z.string().trim().min(3, "Korisničko ime mora imati bar 3 znaka."),
  uloga: z.enum(ULOGE),
  lozinka: lozinkaPolje,
});

const noviLiceSchema = z.object({
  ime: z.string().min(2),
  radnoMjesto: z.string().optional(),
  rukujeHranom: z.boolean().default(true),
  sanitarnaKnjizicaBroj: z.string().optional(),
  sanitarnaKnjizicaRok: z.string().optional(),
  nalog: noviNalogPodaci.optional(),
});

ljudiRuter.post(
  "/lica",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const { nalog, ...ulaz } = tijelo(noviLiceSchema, request.body);
    // Lozinka se prikazuje TAČNO OVDJE, jednom (invarijanta #28).
    response.status(201).json(await ljudi.novoLice(ulaz, nalog, request.korisnik!));
  }),
);

const izmjenaLiceSchema = noviLiceSchema.omit({ nalog: true }).partial().extend({ aktivan: z.boolean().optional() });

ljudiRuter.patch(
  "/lica/:id",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    await ljudi.izmijeniLice(str(request.params.id), tijelo(izmjenaLiceSchema, request.body), request.korisnik!.id);
    response.status(204).end();
  }),
);

ljudiRuter.get(
  "/vozaci",
  requireUloga("operater", "vozac", "bzr", "izvodjac"),
  asyncRuta(async (_request, response) => {
    response.json(await ljudi.vozaci());
  }),
);

// Godišnji plan obuke — Prilog 13.
ljudiRuter.get(
  "/plan-obuke",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (_request, response) => {
    response.json(await ljudi.planObuke());
  }),
);

const noviPlanSchema = z.object({
  liceId: z.string().uuid(),
  tema: z.string().min(2),
  planiraniDatum: z.string(),
  napomena: z.string().optional(),
});

ljudiRuter.post(
  "/plan-obuke",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const id = await ljudi.dodajUPlanObuke(tijelo(noviPlanSchema, request.body), request.korisnik!.id);
    response.status(201).json({ id });
  }),
);

ljudiRuter.patch(
  "/plan-obuke/:id/uradjeno",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const { obavljenoDatum } = tijelo(z.object({ obavljenoDatum: z.string().optional() }), request.body ?? {});
    await ljudi.obukaObavljena(str(request.params.id), obavljenoDatum, request.korisnik!.id);
    response.status(204).end();
  }),
);

// Nalozi za prijavu — bzr otvara samo operater/vozac (invarijanta #13).
ljudiRuter.get(
  "/nalozi",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (_request, response) => {
    response.json(await ljudi.nalozi());
  }),
);

const noviNalogSchema = noviNalogPodaci.extend({ liceId: z.string().uuid().optional() });

ljudiRuter.post(
  "/nalozi",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    // Lozinka se prikazuje TAČNO OVDJE, jednom, pri postavljanju (invarijanta #28).
    response.status(201).json(await ljudi.otvoriNalog(tijelo(noviNalogSchema, request.body), request.korisnik!));
  }),
);

ljudiRuter.patch(
  "/nalozi/:id/uloga",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const ciljUloga = z.enum(ULOGE).parse(request.body?.uloga);
    await ljudi.promijeniUlogu(str(request.params.id), ciljUloga, request.korisnik!);
    response.status(204).end();
  }),
);

ljudiRuter.patch(
  "/nalozi/:id/lozinka",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const { lozinka } = tijelo(z.object({ lozinka: lozinkaPolje }), request.body ?? {});
    response.json({ privremenaLozinka: await ljudi.novaLozinka(str(request.params.id), lozinka, request.korisnik!) });
  }),
);

ljudiRuter.patch(
  "/nalozi/:id/deaktiviraj",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    await ljudi.deaktivirajNalog(str(request.params.id), request.korisnik!);
    response.status(204).end();
  }),
);

ljudiRuter.patch(
  "/nalozi/:id/skladiste",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const { skladisteId } = tijelo(z.object({ skladisteId: z.string().uuid().nullable() }), request.body);
    await ljudi.postaviMaticnoSkladiste(str(request.params.id), skladisteId, request.korisnik!);
    response.status(204).end();
  }),
);
