import { Router } from "express";
import { z } from "zod";
import { asyncRuta } from "../greske.js";
import { requireUloga, type AuthZahtjev } from "../auth.js";
import { tijelo, str } from "../validacija.js";
import { kljucIzZaglavlja } from "../services/kljucService.js";
import { vanMreze } from "../vanMreze.js";
import { SIFRE_ALERGENA } from "../alergeni.js";
import {
  listaPorudzbina, detaljPorudzbine, lotoviZaIzbor, kreirajPorudzbinu, izmijeniPorudzbinu, dodajLot, ukloniLot,
  potvrdiAlergene, pocniIzradu, otkaziPorudzbinu, predajPorudzbinu, porudzbineSerije, pretraziPorudzbine,
} from "../services/porudzbinaService.js";

// Porudžbine torti (poslastičarnica, dopuna 39). Rade ih svi koji prave torte — zaposleni, odgovorno lice,
// konsultant (P5). Uprava i vozač ne (te uloge se u ovoj aplikaciji uklanjaju). Sledljivost čita i uprava,
// kao i ostatak sledljivosti, dok se ta uloga ne ukloni.
export const porudzbineRuter = Router();
const ATELJE = ["operater", "bzr", "izvodjac"] as const;

const porudzbinaSchema = z.object({
  kupacIme: z.string().trim().min(2, "Upišite ime kupca."),
  // Kupac bez telefona se ne upisuje (#4) — povlačenje počinje telefonom.
  kupacTelefon: z.string().trim().min(6, "Telefon kupca je obavezan — povlačenje počinje telefonom."),
  preuzimanjeDatum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Upišite datum preuzimanja."),
  preuzimanjeVrijeme: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Upišite vrijeme preuzimanja (npr. 17:30)."),
  nacin: z.enum(["PREUZIMA", "DOSTAVA"]).default("PREUZIMA"),
  adresaDostave: z.string().optional(),
  opis: z.string().trim().min(3, "Opišite tortu (vrsta, veličina, punjenje, natpis)."),
  napomena: z.string().optional(),
});

porudzbineRuter.get("/porudzbine", requireUloga(...ATELJE), asyncRuta(async (request: AuthZahtjev, response) => {
  response.json(await listaPorudzbina(request.korisnik!));
}));

// Prije `/porudzbine/:id` — inače bi „sastojci“ bio id.
porudzbineRuter.get("/porudzbine/sastojci", requireUloga(...ATELJE), asyncRuta(async (_request, response) => {
  response.json(await lotoviZaIzbor());
}));

porudzbineRuter.get("/porudzbine/pretraga", requireUloga("bzr", "izvodjac"), asyncRuta(async (request, response) => {
  const q = typeof request.query.q === "string" ? request.query.q.trim() : "";
  response.json(q.length < 2 ? [] : await pretraziPorudzbine(q));
}));

// Sledljivost unaprijed: serija lota → torte → kupci (telefoni).
porudzbineRuter.get("/sledljivost/lot/:id/porudzbine", requireUloga("bzr", "izvodjac"), asyncRuta(async (request, response) => {
  response.json(await porudzbineSerije(str(request.params.id)));
}));

porudzbineRuter.get("/porudzbine/:id", requireUloga(...ATELJE), asyncRuta(async (request, response) => {
  response.json(await detaljPorudzbine(str(request.params.id)));
}));

porudzbineRuter.post("/porudzbine", requireUloga(...ATELJE), asyncRuta(async (request: AuthZahtjev, response) => {
  const ulaz = tijelo(porudzbinaSchema, request.body);
  response.status(201).json(await kreirajPorudzbinu(ulaz, request.korisnik!, kljucIzZaglavlja(request.headers["x-kljuc-zahtjeva"])));
}));

porudzbineRuter.patch("/porudzbine/:id", requireUloga(...ATELJE), asyncRuta(async (request: AuthZahtjev, response) => {
  const ulaz = tijelo(porudzbinaSchema, request.body);
  await izmijeniPorudzbinu(str(request.params.id), ulaz, request.korisnik!);
  response.status(204).end();
}));

porudzbineRuter.post("/porudzbine/:id/lotovi", requireUloga(...ATELJE), asyncRuta(async (request: AuthZahtjev, response) => {
  const { lotId } = tijelo(z.object({ lotId: z.string().uuid("Izaberite sastojak (lot).") }), request.body);
  response.json(await dodajLot(str(request.params.id), lotId, request.korisnik!));
}));

porudzbineRuter.delete("/porudzbine/:id/lotovi/:lotId", requireUloga(...ATELJE), asyncRuta(async (request: AuthZahtjev, response) => {
  await ukloniLot(str(request.params.id), str(request.params.lotId), request.korisnik!);
  response.status(204).end();
}));

porudzbineRuter.post("/porudzbine/:id/alergeni", requireUloga(...ATELJE), asyncRuta(async (request: AuthZahtjev, response) => {
  const ulaz = tijelo(z.object({ alergeni: z.array(z.enum(SIFRE_ALERGENA)), bezAlergena: z.boolean().optional() }), request.body);
  response.json(await potvrdiAlergene(str(request.params.id), ulaz, request.korisnik!));
}));

porudzbineRuter.post("/porudzbine/:id/izrada", requireUloga(...ATELJE), asyncRuta(async (request: AuthZahtjev, response) => {
  await pocniIzradu(str(request.params.id), request.korisnik!);
  response.status(204).end();
}));

porudzbineRuter.post("/porudzbine/:id/otkaz", requireUloga(...ATELJE), asyncRuta(async (request: AuthZahtjev, response) => {
  const { razlog } = tijelo(z.object({ razlog: z.string().trim().min(5, "Upišite zašto se porudžbina otkazuje.") }), request.body);
  await otkaziPorudzbinu(str(request.params.id), razlog, request.korisnik!);
  response.status(204).end();
}));

// Predaja radi i bez interneta (#85): isti ključ ne upisuje dvaput, vrijeme je vrijeme sa telefona.
porudzbineRuter.post("/porudzbine/:id/predaja", requireUloga(...ATELJE), vanMreze("predaja_porudzbine"), asyncRuta(async (request: AuthZahtjev, response) => {
  const ulaz = tijelo(
    z.object({
      temperatura: z.number().min(-40, "Temperatura nije ispravna.").max(60, "Temperatura nije ispravna.").nullable().optional(),
      mjerniUredjajId: z.string().uuid().nullable().optional(),
      preuzeoIme: z.string().max(200).optional(),
    }),
    request.body,
  );
  response.json(await predajPorudzbinu(str(request.params.id), ulaz, request.korisnik!));
}));
