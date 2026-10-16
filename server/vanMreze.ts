import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Response } from "express";
import { pool } from "./db.js";
import { ApiGreska } from "./greske.js";
import type { AuthZahtjev } from "./auth.js";
import { kljucIzZaglavlja } from "./services/kljucService.js";

// Rad bez interneta (talas 6, invarijanta #85). Upisi sa terena — D1, predaja, mjerenje, dnevni zapis,
// prijava problema — prolaze kroz ovaj sloj:
//  • `x-kljuc-zahtjeva`: isti upis poslat dvaput (odgovor se izgubio u podrumu hladnjače, pa telefon
//    šalje ponovo) daje PRVI rezultat, ne drugi zapis. Isti mehanizam i tabela kao #52.
//  • `x-uradjeno-at`: samo za upis koji je čekao na telefonu — vrijeme kad je stvarno urađen. Ide u
//    izmjereno_at / izvrseno_at / potvrdjeno_at, a zapis dobija oznaku „van mreže“; created_at ostaje
//    vrijeme kad je stiglo. Ne prima se vrijeme u budućnosti ni starije od 36 sati.

const kontekst = new AsyncLocalStorage<{ uradjenoAt: Date }>();

/** Vrijeme radnje za upis koji je stigao sa telefona bez mreže; `null` = običan upis (vrijeme servera). */
export const vrijemeVanMreze = (): Date | null => kontekst.getStore()?.uradjenoAt ?? null;

const NAJSTARIJE_H = 36;
const TOLERANCIJA_BUDUCNOST_MS = 2 * 60 * 1000;
/** Rezervacija bez rezultata starija od ovoga = proces je pao usred upisa; ključ se oslobađa. */
const ZAGLAVLJENO_MS = 10 * 60 * 1000;

export function vanMreze(radnja: string) {
  const imeRadnje = `vm:${radnja}`.slice(0, 40);
  return async (request: AuthZahtjev, response: Response, next: NextFunction) => {
    const kljuc = kljucIzZaglavlja(request.headers["x-kljuc-zahtjeva"]);
    const zaglavljeVremena = request.headers["x-uradjeno-at"];
    let uradjenoAt: Date | null = null;
    if (typeof zaglavljeVremena === "string" && zaglavljeVremena) {
      const t = new Date(zaglavljeVremena);
      if (Number.isNaN(t.getTime())) throw new ApiGreska(400, "NEISPRAVNO_VRIJEME", "Vrijeme upisa sa telefona nije ispravno.");
      if (t.getTime() > Date.now() + TOLERANCIJA_BUDUCNOST_MS) {
        throw new ApiGreska(400, "VRIJEME_U_BUDUCNOSTI", "Sat na telefonu žuri — upis sa vremenom u budućnosti se ne prima. Podesite datum i vrijeme na telefonu.");
      }
      if (t.getTime() < Date.now() - NAJSTARIJE_H * 3600 * 1000) {
        throw new ApiGreska(400, "VAN_MREZE_PRESTARO", `Upis sa telefona je stariji od ${NAJSTARIJE_H} sati — javlja se odgovornom licu umjesto da se upiše.`);
      }
      uradjenoAt = t;
    }

    if (kljuc && request.korisnik) {
      const korisnikId = request.korisnik.id;
      await pool.query(`delete from kljuc_zahtjeva where korisnik_id = $1 and kljuc = $2 and rezultat is null and created_at < now() - $3 * interval '1 millisecond'`, [korisnikId, kljuc, ZAGLAVLJENO_MS]);
      const novo = await pool.query(`insert into kljuc_zahtjeva (korisnik_id, kljuc, radnja) values ($1, $2, $3) on conflict do nothing returning kljuc`, [korisnikId, kljuc, imeRadnje]);
      if (!novo.rowCount) {
        const ranije = (await pool.query<{ rezultat: { status: number; tijelo: unknown } | null }>(`select rezultat from kljuc_zahtjeva where korisnik_id = $1 and kljuc = $2`, [korisnikId, kljuc])).rows[0];
        if (ranije?.rezultat) {
          response.status(ranije.rezultat.status).json(ranije.rezultat.tijelo);
          return;
        }
        throw new ApiGreska(409, "U_TOKU", "Ovaj upis se upravo šalje — sačekajte trenutak.");
      }
      // Ishod se pamti PRIJE nego što odgovor ode: uspjeh ostaje uz ključ (ponovljeno slanje dobija isto),
      // a neuspjeh oslobađa ključ — ispravljen upis se smije poslati ponovo.
      let obradjeno = false;
      const zavrsi = (status: number, tijelo: unknown) => {
        obradjeno = true;
        return status >= 200 && status < 300
          ? pool.query(`update kljuc_zahtjeva set rezultat = $3 where korisnik_id = $1 and kljuc = $2`, [korisnikId, kljuc, JSON.stringify({ status, tijelo: tijelo ?? null })])
          : pool.query(`delete from kljuc_zahtjeva where korisnik_id = $1 and kljuc = $2 and rezultat is null`, [korisnikId, kljuc]);
      };
      const izvorniJson = response.json.bind(response);
      response.json = ((tijelo: unknown) => {
        void zavrsi(response.statusCode, tijelo)
          .catch((e) => console.error("Ključ zahtjeva (van mreže) nije zapamćen:", e))
          .finally(() => izvorniJson(tijelo));
        return response;
      }) as typeof response.json;
      response.on("finish", () => {
        if (!obradjeno) void zavrsi(response.statusCode, null).catch(() => undefined);
      });
    }

    if (uradjenoAt) kontekst.run({ uradjenoAt }, next);
    else next();
  };
}
