import { Router } from "express";
import { z } from "zod";
import { asyncRuta, ApiGreska } from "../greske.js";
import { requireUloga, sviPrijavljeni, type AuthZahtjev } from "../auth.js";
import { tijelo } from "../validacija.js";
import * as znanje from "../services/provjeraZnanjaService.js";

export const provjeraZnanjaRuter = Router();

// --- Provjeru radi PRIJAVLJENI zaposleni, SVOJOM šifrom (invarijanta #32): šifru server uzima iz
// naloga — ne kuca se, pa se tuđa ne može upisati. Na početku se upisuje lozinka prijavljenog — na
// zajedničkom telefonu provjeru ne može uraditi neko drugi. Odgovara i završava samo onaj ko je počeo. ---
provjeraZnanjaRuter.post(
  "/provjera-znanja/uci",
  sviPrijavljeni(),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const { lozinka } = tijelo(z.object({ lozinka: z.string().optional() }), request.body);
    if (!lozinka) throw new ApiGreska(400, "NEVALIDAN_UNOS", "Upišite svoju lozinku.");
    response.json(await znanje.udji(request.korisnik!.id, lozinka, request.ip));
  }),
);

const odgovorSchema = z.object({ ucesnikId: z.string().uuid(), pitanjeId: z.string().uuid(), datIndeks: z.number().int() });

provjeraZnanjaRuter.post(
  "/provjera-znanja/odgovor",
  sviPrijavljeni(),
  asyncRuta(async (request: AuthZahtjev, response) => {
    await znanje.odgovori(tijelo(odgovorSchema, request.body), request.korisnik!.id);
    response.status(204).end();
  }),
);

provjeraZnanjaRuter.post(
  "/provjera-znanja/zavrsi",
  sviPrijavljeni(),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const ucesnikId = z.string().uuid().parse(request.body?.ucesnikId);
    response.json(await znanje.zavrsi(ucesnikId, request.korisnik!.id));
  }),
);

// --- Termini, banka pitanja (samo izvodjac — invarijanta #14), pitanja firme, rezultati. ---

// Početna strana prijavljenog nudi ulaz kad je termin otvoren (ne strana za prijavu).
provjeraZnanjaRuter.get(
  "/provjera-znanja/moj-termin",
  sviPrijavljeni(),
  asyncRuta(async (request: AuthZahtjev, response) => {
    response.json(await znanje.mojTermin(request.korisnik!.id));
  }),
);

provjeraZnanjaRuter.get(
  "/provjera-znanja/sesije",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (_request, response) => {
    response.json(await znanje.termini());
  }),
);

const sesijaSchema = z.object({
  naziv: z.string().min(2),
  brojPitanja: z.number().int().positive().default(10),
  cuvaImena: z.boolean().default(true),
  pragProlaza: z.number().int().min(1).max(100).default(70),
  izvorPitanja: z.enum(["sva", "firma", "konsultant"]).default("sva"),
});

provjeraZnanjaRuter.post(
  "/provjera-znanja/sesije",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const id = await znanje.otvoriTermin(tijelo(sesijaSchema, request.body), request.korisnik!.id);
    response.status(201).json({ id });
  }),
);

provjeraZnanjaRuter.patch(
  "/provjera-znanja/sesije/:id/zatvori",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request, response) => {
    await znanje.zatvoriTermin(z.string().uuid().parse(request.params.id));
    response.status(204).end();
  }),
);

provjeraZnanjaRuter.get(
  "/pitanja",
  requireUloga("izvodjac"),
  asyncRuta(async (_request, response) => {
    response.json(await znanje.bankaPitanja());
  }),
);

const pitanjeSchema = z.object({
  tema: z.string().min(2),
  tekst: z.string().min(5),
  ponudjeniOdgovori: z.array(z.string().min(1)).min(2),
  tacanIndeks: z.number().int().nonnegative(),
});

provjeraZnanjaRuter.post(
  "/pitanja",
  requireUloga("izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const id = await znanje.dodajPitanje(tijelo(pitanjeSchema, request.body), "konsultant", request.korisnik!.id);
    response.status(201).json({ id });
  }),
);

provjeraZnanjaRuter.get(
  "/evidencija-osposobljavanja",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (_request, response) => {
    response.json(await znanje.evidencijaOsposobljavanja());
  }),
);

// --- Pitanja firme: unosi ih odgovorno lice, o procedurama svoje firme. ---
provjeraZnanjaRuter.get(
  "/pitanja-firme",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (_request, response) => {
    response.json(await znanje.pitanjaFirme());
  }),
);

const pitanjeFirmeSchema = z.object({
  tema: z.string().trim().min(2, "Upišite temu (npr. Prijem robe)."),
  tekst: z.string().trim().min(5, "Upišite pitanje."),
  ponudjeniOdgovori: z.array(z.string().trim().min(1)).min(2, "Potrebna su bar dva odgovora.").max(6),
  tacanIndeks: z.number().int().min(0),
});

provjeraZnanjaRuter.post(
  "/pitanja-firme",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const id = await znanje.dodajPitanje(tijelo(pitanjeFirmeSchema, request.body), "firma", request.korisnik!.id);
    response.status(201).json({ id });
  }),
);

provjeraZnanjaRuter.patch(
  "/pitanja-firme/:id",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const id = z.string().uuid().parse(request.params.id);
    // Samo {aktivno} = uključi/isključi; sve ostalo je izmjena teksta.
    if (typeof request.body?.aktivno === "boolean" && Object.keys(request.body).length === 1) {
      await znanje.ukljuciPitanjeFirme(id, request.body.aktivno);
    } else {
      await znanje.izmijeniPitanjeFirme(id, tijelo(pitanjeFirmeSchema, request.body));
    }
    response.status(204).end();
  }),
);

provjeraZnanjaRuter.post(
  "/pitanja-firme/:id/nova-verzija",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const id = z.string().uuid().parse(request.params.id);
    response.status(201).json({ id: await znanje.novaVerzijaPitanjaFirme(id, tijelo(pitanjeFirmeSchema, request.body), request.korisnik!.id) });
  }),
);

provjeraZnanjaRuter.get(
  "/provjera-znanja/rezultati",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request, response) => {
    const sesijaId = typeof request.query.sesijaId === "string" ? z.string().uuid().parse(request.query.sesijaId) : null;
    response.json(await znanje.rezultati(sesijaId));
  }),
);
