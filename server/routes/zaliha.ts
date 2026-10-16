import { Router } from "express";
import { z } from "zod";
import { upit } from "../db.js";
import { asyncRuta, ApiGreska } from "../greske.js";
import { requireUloga, type AuthZahtjev } from "../auth.js";
import { lanacNaprijedZaLot } from "../services/sledljivostService.js";
import { otpisiZalihu, odlukaOKarantinu } from "../services/otpisService.js";
import { str, tijelo } from "../validacija.js";

export const zalihaRuter = Router();
zalihaRuter.get(
  "/zaliha",
  requireUloga("operater", "vozac", "bzr", "izvodjac"),
  asyncRuta(async (_request, response) => {
    response.json((await upit(`select * from v_zaliha_dostupna`)).rows);
  }),
);

zalihaRuter.get(
  "/lotovi",
  requireUloga("operater", "bzr", "izvodjac", "uprava"),
  asyncRuta(async (request, response) => {
    const status = typeof request.query.status === "string" ? request.query.status : undefined;
    const rezultat = await upit(
      `select l.*, a.naziv as artikal_naziv, d.naziv as dobavljac_naziv, p.skladiste_id, s.naziv as skladiste_naziv,
              coalesce((select sum(z.kolicina) from zaliha z where z.lot_id = l.id and z.status = 'DOSTUPNO'), 0) as dostupno,
              coalesce((select sum(z.kolicina) from zaliha z where z.lot_id = l.id and z.status = 'KARANTIN'), 0) as karantin,
              -- Rezervacija (R-14): koliko drže isporuke u pripremi; slobodno = dostupno − rezervisano.
              coalesce((select sum(ist.planirana_kolicina) from isporuka_stavka ist join isporuka i on i.id = ist.isporuka_id
                        where ist.lot_id = l.id and i.status = 'U_PRIPREMI'), 0) as rezervisano
       from lot l join artikal a on a.id = l.artikal_id join dobavljac d on d.id = l.dobavljac_id
       left join prijem p on p.id = l.prijem_id left join skladiste s on s.id = p.skladiste_id
       where ($1::text is null or l.status::text = $1)
       order by l.rok_trajanja nulls last`,
      [status ?? null],
    );
    response.json(rezultat.rows);
  }),
);

zalihaRuter.get(
  "/lotovi/:id",
  requireUloga("operater", "bzr", "izvodjac", "uprava"),
  asyncRuta(async (request, response) => {
    const lot = await upit(
      `select l.*, a.naziv as artikal_naziv, d.naziv as dobavljac_naziv from lot l
       join artikal a on a.id = l.artikal_id join dobavljac d on d.id = l.dobavljac_id where l.id = $1`,
      [request.params.id],
    );
    if (!lot.rows[0]) throw new ApiGreska(404, "LOT_NE_POSTOJI", "Lot nije pronađen.");
    const lanac = await lanacNaprijedZaLot(str(request.params.id));
    response.json({ ...lot.rows[0], lanac });
  }),
);

const otpisSchema = z.object({
  kolicina: z.number().positive(),
  razlog: z.string().trim().min(3, "Razlog otpisa mora biti opisan (npr. oštećeno, isteklo, izgubljeno)."),
});

zalihaRuter.post(
  "/lotovi/:id/otpis",
  requireUloga("operater", "bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const ulaz = tijelo(otpisSchema, request.body);
    await otpisiZalihu(str(request.params.id), ulaz, request.korisnik!.id);
    response.status(204).end();
  }),
);

// Roba vraćena sa isporuke (karantin prihvaćenog lota): odgovorno lice je pušta ili otpisuje (R-03).
const karantinSchema = z.object({
  odluka: z.enum(["PUSTI", "OTPISI"]),
  kolicina: z.number().positive(),
  razlog: z.string().trim().min(3, "Upišite šta je pregledano (npr. temperatura u redu, ambalaža čitava)."),
});

zalihaRuter.post(
  "/lotovi/:id/karantin",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    await odlukaOKarantinu(str(request.params.id), tijelo(karantinSchema, request.body), request.korisnik!.id);
    response.status(204).end();
  }),
);
