import { Router } from "express";
import { z } from "zod";
import { upit, transakcija } from "../db.js";
import { asyncRuta, ApiGreska } from "../greske.js";
import { requireUloga, sviPrijavljeni, type AuthZahtjev } from "../auth.js";
import { tijelo } from "../validacija.js";
import { logIzmjenaReda, stanjeReda } from "../services/auditService.js";

export const firmaRuter = Router();
firmaRuter.get(
  "/firma",
  sviPrijavljeni(),
  asyncRuta(async (_request, response) => {
    const rezultat = await upit(`select * from firma limit 1`);
    response.json(rezultat.rows[0] ?? null);
  }),
);

const firmaSchema = z.object({
  naziv: z.string().min(2),
  pib: z.string().optional(),
  adresa: z.string().optional(),
  grad: z.string().optional(),
  telefon: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  odgovornoLiceIme: z.string().optional(),
});

firmaRuter.patch(
  "/firma",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const ulaz = tijelo(firmaSchema, request.body);
    // Podaci firme idu na svaku štampu (rješenje, prilozi) — izmjena ostavlja trag šta je bilo (R-06).
    await transakcija(async (klijent) => {
      const id = (await klijent.query<{ id: string }>(`select id from firma limit 1`)).rows[0]?.id;
      if (!id) throw new ApiGreska(404, "FIRMA_NE_POSTOJI", "Podaci firme još nisu upisani.");
      const prije = await stanjeReda(klijent, "firma", id, true);
      await klijent.query(
        `update firma set naziv = $1, pib = $2, adresa = $3, grad = $4, telefon = $5, email = $6, odgovorno_lice_ime = $7, updated_at = now()
         where id = $8`,
        [ulaz.naziv, ulaz.pib ?? null, ulaz.adresa ?? null, ulaz.grad ?? null, ulaz.telefon ?? null, ulaz.email || null, ulaz.odgovornoLiceIme ?? null, id],
      );
      await logIzmjenaReda(klijent, { korisnikId: request.korisnik!.id, entitetTip: "firma", entitetId: id, prije, poslije: await stanjeReda(klijent, "firma", id) });
    });
    response.status(204).end();
  }),
);
