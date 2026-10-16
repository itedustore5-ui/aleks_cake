import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { opisGreske, zapisiGresku } from "./services/greskeLogService.js";

export class ApiGreska extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const posalji = (response: Response, status: number, code: string, message: string, details: Record<string, unknown> = {}) => {
  response.status(status).json({ error: { code, message, details } });
};

/** Greške koje nisu ApiGreska, a krivica je u zahtjevu, ne u serveru (nalaz R-26): odgovor je 4xx sa
 * porukom šta da se uradi — ne 500 „neočekivana greška". Kodovi PostgreSQL-a: 22P02 loš format
 * (npr. identifikator), 22007/22008 datum, 22003 broj van opsega, 23503 veza na nepostojeći zapis,
 * 23505 dupli, 23514 pravilo u bazi (CHECK). */
const PG_GRESKE: Record<string, [number, string, string]> = {
  "22P02": [400, "NEISPRAVAN_PODATAK", "Neispravan podatak u zahtjevu — osvježite stranu i pokušajte ponovo."],
  "22007": [400, "NEISPRAVAN_DATUM", "Neispravan datum — upišite ga ponovo."],
  "22008": [400, "NEISPRAVAN_DATUM", "Neispravan datum — upišite ga ponovo."],
  "22003": [400, "BROJ_VAN_OPSEGA", "Broj je prevelik ili premali."],
  "23503": [409, "VEZA_NE_POSTOJI", "Izabrani zapis ne postoji ili je uklonjen — osvježite stranu i izaberite ponovo."],
  "23505": [409, "VEC_POSTOJI", "Takav zapis već postoji."],
  "23514": [409, "PRAVILO_BAZE", "Podatak nije dozvoljen pravilima (npr. količina u minusu) — provjerite unos."],
};

export function greskaHandler(err: unknown, _request: Request, response: Response, _next: NextFunction) {
  if (err instanceof ApiGreska) {
    posalji(response, err.status, err.code, err.message, err.details);
    return;
  }
  if (err instanceof ZodError) {
    posalji(response, 400, "NEVALIDAN_UNOS", "Podaci nisu ispravni — provjerite označena polja.", {
      greske: err.issues.map((i) => ({ putanja: i.path.join("."), poruka: i.message })),
    });
    return;
  }
  const e = err as { type?: string; code?: string };
  if (e?.type === "entity.parse.failed") {
    posalji(response, 400, "NEVALIDAN_ZAHTJEV", "Zahtjev nije ispravno poslat — osvježite stranu i pokušajte ponovo.");
    return;
  }
  if (e?.type === "entity.too.large") {
    posalji(response, 413, "PREVELIKO", "Poslato je previše podataka odjednom.");
    return;
  }
  if (typeof e?.code === "string" && PG_GRESKE[e.code]) {
    const [status, kod, poruka] = PG_GRESKE[e.code];
    posalji(response, status, kod, poruka);
    return;
  }
  console.error(err);
  // Dnevnik grešaka (#80): ruta, status, ko — nikad tijelo zahtjeva (lozinke, lični podaci).
  const { poruka, detalji } = opisGreske(err);
  void zapisiGresku({
    izvor: "server", metod: _request.method, putanja: _request.originalUrl?.split("?")[0] ?? null, status: 500, kod: e?.code ?? null,
    poruka, detalji, korisnikId: (_request as Request & { korisnik?: { id: string } }).korisnik?.id ?? null,
  });
  posalji(response, 500, "GRESKA_SERVERA", "Došlo je do neočekivane greške na serveru.");
}

export const asyncRuta = <Req extends Request>(
  fn: (request: Req, response: Response, next: NextFunction) => Promise<void>,
) => (request: Req, response: Response, next: NextFunction) => {
  fn(request, response, next).catch(next);
};
