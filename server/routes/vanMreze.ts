import { Router } from "express";
import { z } from "zod";
import { asyncRuta } from "../greske.js";
import { requireUloga, type AuthZahtjev } from "../auth.js";
import { tijelo } from "../validacija.js";
import { pool, transakcija } from "../db.js";
import { obavijestiUlogu } from "../services/zadaciService.js";

// Upis bez mreže koji je server kasnije ODBIO (#85): telefon ga ne briše tiho, nego ga pošalje ovdje —
// čuva se sa svim podacima, a odgovorna lica dobijaju obavještenje. Primjer: vozač je bez signala predao
// robu, a lot je u međuvremenu zadržan (povlačenje) — kupac ima robu, a zapis predaje server ne prima.
export const vanMrezeRuter = Router();

const odbijenoSchema = z.object({
  putanja: z.string().min(1).max(300),
  opis: z.string().min(1).max(300),
  telo: z.unknown().optional(),
  greskaKod: z.string().max(80).optional(),
  greskaPoruka: z.string().max(1000).optional(),
  uradjenoAt: z.string().max(40).optional(),
});

vanMrezeRuter.post(
  "/van-mreze/odbijeno",
  requireUloga("operater", "vozac", "bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const u = tijelo(odbijenoSchema, request.body);
    const k = request.korisnik!;
    const uradjeno = u.uradjenoAt && !Number.isNaN(new Date(u.uradjenoAt).getTime()) ? new Date(u.uradjenoAt) : null;
    const telo = JSON.stringify(u.telo ?? null);
    const id = await transakcija(async (klijent) => {
      const r = await klijent.query<{ id: string }>(
        `insert into van_mreze_odbijeno (korisnik_id, putanja, opis, telo, greska_kod, greska_poruka, uradjeno_at)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [k.id, u.putanja, u.opis, telo.length > 20000 ? JSON.stringify({ skraceno: true }) : telo, u.greskaKod ?? null, u.greskaPoruka ?? null, uradjeno],
      );
      const ko = k.lice_ime ?? k.korisnicko_ime;
      const kada = uradjeno
        ? new Intl.DateTimeFormat("sr-Latn-ME", { timeZone: "Europe/Podgorica", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(uradjeno)
        : "ranije";
      await obavijestiUlogu(klijent, "bzr", {
        naslov: `Upis bez mreže nije primljen: ${u.opis}`.slice(0, 200),
        poruka: `${ko} je ${kada} bez interneta upisao/la „${u.opis}“, a server ga nije primio: ${u.greskaPoruka ?? u.greskaKod ?? "nepoznat razlog"}. Provjerite na licu mjesta i upišite ručno ako je radnja stvarno obavljena.`,
        ozbiljnost: "VISOK",
      });
      return r.rows[0].id;
    });
    response.status(201).json({ id });
  }),
);

vanMrezeRuter.get(
  "/van-mreze/odbijeno",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (_request: AuthZahtjev, response) => {
    const r = await pool.query(
      `select o.id, o.putanja, o.opis, o.telo, o.greska_kod, o.greska_poruka, o.uradjeno_at, o.created_at,
              coalesce(l.ime, k.korisnicko_ime) as ko
       from van_mreze_odbijeno o join korisnik k on k.id = o.korisnik_id left join lice l on l.id = k.lice_id
       where o.created_at > now() - interval '30 days' order by o.created_at desc limit 100`,
    );
    response.json(r.rows);
  }),
);
