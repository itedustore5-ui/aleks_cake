import { Router } from "express";
import { z } from "zod";
import { upit } from "../db.js";
import { asyncRuta, ApiGreska } from "../greske.js";
import { requireUloga, type AuthZahtjev } from "../auth.js";
import { tijelo, str } from "../validacija.js";
import { pokreniPovlacenje, oznaciKontaktiran, zavrsiPovlacenje } from "../services/povlacenjeService.js";

export const povlacenjeRuter = Router();
// Provjera važi SAMO za adrese ovog rutera. Ruter je montiran na zajednički "/api", pa bi
// .use(...) bez putanje važio za SVAKI zahtjev koji prođe kroz njega — i zaključao bi rute
// registrovane poslije (ovako je uprava dobijala 403 na /api/tabla).
// Uprava ČITA povlačenja (Kontrolni centar vodi na Sledljivost); pokreće, zove i zatvara samo vodstvo.

povlacenjeRuter.get(
  "/povlacenja",
  requireUloga("bzr", "izvodjac", "uprava"),
  asyncRuta(async (_request, response) => {
    const rezultat = await upit(
      `select p.*, l.broj_lota, a.naziv as artikal_naziv,
              (select count(*) from povlacenje_kontakt pk where pk.povlacenje_id = p.id) as broj_kontakata,
              (select count(*) from povlacenje_kontakt pk where pk.povlacenje_id = p.id and pk.kontaktiran) as broj_kontaktiranih
       from povlacenje p join lot l on l.id = p.lot_id join artikal a on a.id = l.artikal_id
       order by p.pokrenuto_at desc`,
    );
    response.json(rezultat.rows);
  }),
);

povlacenjeRuter.get(
  "/povlacenja/:id",
  requireUloga("bzr", "izvodjac", "uprava"),
  asyncRuta(async (request, response) => {
    const povlacenje = await upit(
      `select p.*, l.broj_lota, a.naziv as artikal_naziv from povlacenje p join lot l on l.id = p.lot_id join artikal a on a.id = l.artikal_id where p.id = $1`,
      [request.params.id],
    );
    if (!povlacenje.rows[0]) throw new ApiGreska(404, "POVLACENJE_NE_POSTOJI", "Povlačenje nije pronađeno.");
    const kontakti = await upit(`select * from povlacenje_kontakt where povlacenje_id = $1 order by kupac_naziv`, [request.params.id]);
    response.json({ ...povlacenje.rows[0], kontakti: kontakti.rows });
  }),
);

const pokreniSchema = z.object({ razlog: z.string().min(3, "Razlog povlačenja je obavezan.") });

povlacenjeRuter.post(
  "/sledljivost/lot/:id/povlacenje",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const { razlog } = tijelo(pokreniSchema, request.body);
    const rezultat = await pokreniPovlacenje(str(request.params.id), razlog, request.korisnik!.id);
    response.status(201).json(rezultat);
  }),
);

const kontaktSchema = z.object({ napomena: z.string().optional() });

povlacenjeRuter.patch(
  "/povlacenja/:id/kontakt/:kontaktId",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const { napomena } = tijelo(kontaktSchema, request.body);
    await oznaciKontaktiran(str(request.params.kontaktId), napomena, request.korisnik!.id);
    response.status(204).end();
  }),
);

povlacenjeRuter.patch(
  "/povlacenja/:id/zavrsi",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    await zavrsiPovlacenje(str(request.params.id), request.korisnik!.id);
    response.status(204).end();
  }),
);
