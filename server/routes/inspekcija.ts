import { Router } from "express";
import { upit } from "../db.js";
import { asyncRuta } from "../greske.js";
import { requireUloga, type AuthZahtjev } from "../auth.js";
import { paket, paketZip } from "../services/inspekcijaService.js";
import { IME } from "../services/sqlDijelovi.js";

export const inspekcijaRuter = Router();

const tekst = (v: unknown) => (typeof v === "string" && v.length <= 20 ? v : undefined);

// Inspekcijski paket samo čita. Pravi ga odgovorno lice ili konsultant; direktor (odgovorno lice u
// pravnom licu, čl. 82) ga može izvući i sam kad je on taj koji dočekuje inspektora.
const ULOGE = ["bzr", "izvodjac", "uprava"] as const;

inspekcijaRuter.get(
  "/inspekcija",
  requireUloga(...ULOGE),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const ime = (await upit<{ ime: string | null }>(`select ${IME("$1::uuid")} as ime`, [request.korisnik!.id])).rows[0]?.ime ?? undefined;
    response.json(await paket(tekst(request.query.od), tekst(request.query.do), ime));
  }),
);

inspekcijaRuter.get(
  "/inspekcija/paket.zip",
  requireUloga(...ULOGE),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const firma = (await upit<{ naziv: string }>(`select naziv from firma limit 1`)).rows[0]?.naziv;
    const { od, do: doDan, zip } = await paketZip(tekst(request.query.od), tekst(request.query.do), firma);
    response.setHeader("Content-Type", "application/zip");
    response.setHeader("Content-Disposition", `attachment; filename="inspekcijski-paket-${od}_${doDan}.zip"`);
    response.send(zip);
  }),
);
