import { Router } from "express";
import { z } from "zod";
import { transakcija, upit } from "../db.js";
import { asyncRuta, ApiGreska } from "../greske.js";
import { requireUloga, type AuthZahtjev } from "../auth.js";
import { tijelo } from "../validacija.js";
import { logIzmjena, logKreiranje } from "../services/auditService.js";
import { RITMOVI, VRSTE, izvjestaj, posalji, sacuvajPrimaoce, sacuvajRitam, slanjePodeseno, stanjeRasporeda, type Vrsta } from "../services/stanjeService.js";

export const stanjeRuter = Router();

// „Stanje poslovanja“ je konsultantov izvještaj (odluka vlasnice 11.10.2026; u ateljeu ide vlasnici) — odgovorno lice
// ga ne pravi, nego ga dobija mejlom: ručno ili po rasporedu (dodatak, 27.10.2026).
const KONSULTANT = "izvodjac" as const;
const DAN = /^\d{4}-\d{2}-\d{2}$/;

function vrstaIDan(upitnik: Record<string, unknown>): { vrsta: Vrsta; dan?: string } {
  const vrsta = (typeof upitnik.vrsta === "string" ? upitnik.vrsta : "mjesec") as Vrsta;
  if (!VRSTE.includes(vrsta)) throw new ApiGreska(400, "VRSTA_NEPOZNATA", "Izaberite dan, sedmicu, mjesec, kvartal, polugodište ili godinu.");
  const dan = typeof upitnik.dan === "string" && DAN.test(upitnik.dan) ? upitnik.dan : undefined;
  return { vrsta, dan };
}

stanjeRuter.get(
  "/stanje-poslovanja",
  requireUloga(KONSULTANT),
  asyncRuta(async (request, response) => {
    const { vrsta, dan } = vrstaIDan(request.query);
    const iz = await izvjestaj(vrsta, dan);
    const istorija = await upit(
      `select vrsta, to_char(period_od, 'YYYY-MM-DD') as od, to_char(period_do, 'YYYY-MM-DD') as do, primaoci, automatski, created_at
       from izvjestaj_poslat order by created_at desc limit 10`,
    );
    response.json({
      ...iz,
      slanje: { podeseno: slanjePodeseno(), posiljalac: process.env.SMTP_POSILJALAC || process.env.SMTP_KORISNIK || null },
      raspored: await stanjeRasporeda(),
      istorija: istorija.rows,
    });
  }),
);

// Isti izvještaj kao fajl — da se pošalje kao prilog kad slanje sa servera nije podešeno.
stanjeRuter.get(
  "/stanje-poslovanja/izvjestaj.html",
  requireUloga(KONSULTANT),
  asyncRuta(async (request, response) => {
    const { vrsta, dan } = vrstaIDan(request.query);
    const iz = await izvjestaj(vrsta, dan);
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="stanje-poslovanja-${vrsta}-${iz.period.od}.html"`);
    response.send(iz.html);
  }),
);

const primaociSchema = z.object({ primaoci: z.string().max(1000) });

stanjeRuter.patch(
  "/stanje-poslovanja/primaoci",
  requireUloga(KONSULTANT),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const { primaoci } = tijelo(primaociSchema, request.body);
    const rez = await transakcija(async (klijent) => {
      const r = await sacuvajPrimaoce(klijent, primaoci);
      await logIzmjena(klijent, { korisnikId: request.korisnik!.id, entitetTip: "firma", entitetId: r.id, stareVrijednosti: { izvjestaj_primaoci: r.prije }, noveVrijednosti: { izvjestaj_primaoci: r.poslije } });
      return r;
    });
    response.json({ primaoci: rez.poslije });
  }),
);

// Raspored slanja — dodatak koji konsultant uključuje klijentu koji ga plati; null = ne šalje se samo.
const rasporedSchema = z.object({ ritam: z.enum(RITMOVI).nullable() });

stanjeRuter.patch(
  "/stanje-poslovanja/raspored",
  requireUloga(KONSULTANT),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const { ritam } = tijelo(rasporedSchema, request.body);
    await transakcija(async (klijent) => {
      const r = await sacuvajRitam(klijent, ritam);
      if (r.prije !== r.poslije) {
        await logIzmjena(klijent, { korisnikId: request.korisnik!.id, entitetTip: "firma", entitetId: r.id, stareVrijednosti: { izvjestaj_ritam: r.prije }, noveVrijednosti: { izvjestaj_ritam: r.poslije } });
      }
    });
    response.json(await stanjeRasporeda());
  }),
);

const slanjeSchema = z.object({ vrsta: z.enum(VRSTE), dan: z.string().regex(DAN).optional() });

stanjeRuter.post(
  "/stanje-poslovanja/posalji",
  requireUloga(KONSULTANT),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const ulaz = tijelo(slanjeSchema, request.body);
    const { iz, primaoci } = await posalji(ulaz.vrsta, ulaz.dan);
    // Mejl je otišao — trag se upisuje poslije (slanje se ne može „vratiti“ rollback-om).
    await transakcija(async (klijent) => {
      const r = await klijent.query<{ id: string }>(
        `insert into izvjestaj_poslat (vrsta, period_od, period_do, primaoci, poslao_korisnik_id) values ($1, $2, $3, $4, $5) returning id`,
        [ulaz.vrsta, iz.period.od, iz.period.do, primaoci.join(", "), request.korisnik!.id],
      );
      await logKreiranje(klijent, { korisnikId: request.korisnik!.id, entitetTip: "izvjestaj_poslat", entitetId: r.rows[0].id, noveVrijednosti: { vrsta: ulaz.vrsta, od: iz.period.od, do: iz.period.do, primaoci } });
    });
    response.status(201).json({ poslato: primaoci, period: iz.period.naziv });
  }),
);
