import { Router } from "express";
import { z } from "zod";
import { upit, transakcija } from "../db.js";
import { asyncRuta, ApiGreska } from "../greske.js";
import { requireUloga, izvrsilacZa, NA_TERENU, type AuthZahtjev, sviPrijavljeni } from "../auth.js";
import { tijelo, str } from "../validacija.js";
import { logKreiranje, logIzmjenaReda, stanjeReda } from "../services/auditService.js";
import { UCESTALOSTI, stavkePlana, stanjeDanas, pregledRupa, osnovniPlan } from "../services/monitoringService.js";
import { listaUredjaja, zabiljeziProvjeru, stanjeVerifikacije, zabiljeziVerifikaciju, haccpPlan, VRSTE_VERIFIKACIJE } from "../services/haccpPlanService.js";

// HACCP kao sistem (faza 3): plan monitoringa, "šta danas fali", mjerni uređaji, verifikacija
// sistema, HACCP plan za štampu. Svaka ruta nosi svoje uloge (invarijanta #26).
export const haccpPlanRuter = Router();
const VODSTVO = ["bzr", "izvodjac"] as const;
const VODSTVO_I_UPRAVA = ["bzr", "izvodjac", "uprava"] as const;

// ─── Šta danas fali ──────────────────────────────────────────────────────────────────────────────
// Magacioner i vozač vide svoje stavke (po ulozi i matičnom magacinu); ostali sve.
haccpPlanRuter.get(
  "/monitoring/danas",
  sviPrijavljeni(),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const { uloga, id } = request.korisnik!;
    let filter = {};
    if (NA_TERENU.includes(uloga)) {
      const k = await upit<{ skladiste_id: string | null }>(`select skladiste_id from korisnik where id = $1`, [id]);
      // Vozaču D1 samo za vozila sa NJEGOVIH današnjih isporuka (monitoringService.daniVoznje).
      filter = { uloga, skladisteId: k.rows[0]?.skladiste_id ?? null, korisnikId: uloga === "vozac" ? id : null };
    }
    response.json(await stanjeDanas(filter));
  }),
);

haccpPlanRuter.get(
  "/monitoring/pregled",
  requireUloga(...VODSTVO_I_UPRAVA),
  asyncRuta(async (request, response) => {
    const dana = Math.min(Math.max(Number(request.query.dana) || 30, 7), 180);
    response.json(await pregledRupa(dana));
  }),
);

// ─── Plan monitoringa ────────────────────────────────────────────────────────────────────────────
haccpPlanRuter.get(
  "/plan-monitoringa",
  requireUloga(...VODSTVO_I_UPRAVA),
  asyncRuta(async (_request, response) => {
    response.json(await stavkePlana(false));
  }),
);

const planSchema = z.object({
  naziv: z.string().trim().min(3, "Upišite šta se radi (npr. „Temperatura komore K-02\")."),
  vrsta: z.enum(["mjerenje", "obrazac", "kontrola_vozila"]),
  kontrolnaTackaId: z.string().uuid().nullable().optional(),
  obrazacKod: z.string().trim().min(1).nullable().optional(),
  voziloId: z.string().uuid().nullable().optional(),
  ucestalost: z.enum(UCESTALOSTI),
  puta: z.number().int().min(1).max(12).default(1),
  uloga: z.enum(["operater", "vozac", "bzr"]).nullable().optional(),
  skladisteId: z.string().uuid().nullable().optional(),
  napomena: z.string().optional(),
});

function provjeriVezu(u: { vrsta: string; kontrolnaTackaId?: string | null; obrazacKod?: string | null; voziloId?: string | null }) {
  if (u.vrsta === "mjerenje" && !u.kontrolnaTackaId) throw new ApiGreska(400, "KONTROLNA_TACKA_OBAVEZNA", "Izaberite kontrolnu tačku na kojoj se mjeri.");
  if (u.vrsta === "obrazac" && !u.obrazacKod) throw new ApiGreska(400, "OBRAZAC_OBAVEZAN", "Izaberite obrazac.");
  if (u.vrsta === "kontrola_vozila" && !u.voziloId) throw new ApiGreska(400, "VOZILO_OBAVEZNO", "Izaberite vozilo.");
}

haccpPlanRuter.post(
  "/plan-monitoringa",
  requireUloga(...VODSTVO),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const u = tijelo(planSchema, request.body);
    provjeriVezu(u);
    const id = await transakcija(async (klijent) => {
      const r = await klijent.query<{ id: string }>(
        `insert into plan_monitoringa (naziv, vrsta, kontrolna_tacka_id, obrazac_kod, vozilo_id, ucestalost, puta, uloga, skladiste_id, napomena, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8::uloga_t, $9, $10, $11) returning id`,
        [
          u.naziv, u.vrsta,
          u.vrsta === "mjerenje" ? u.kontrolnaTackaId : null,
          u.vrsta === "obrazac" ? u.obrazacKod : null,
          u.vrsta === "kontrola_vozila" ? u.voziloId : null,
          u.ucestalost, u.puta, u.uloga ?? null, u.skladisteId ?? null, u.napomena?.trim() || null, request.korisnik!.id,
        ],
      );
      await logKreiranje(klijent, { korisnikId: request.korisnik!.id, entitetTip: "plan_monitoringa", entitetId: r.rows[0].id, noveVrijednosti: u });
      return r.rows[0].id;
    });
    response.status(201).json({ id });
  }),
);

// Izmjena: šta, koliko često, ko. Vrsta i veza se ne mijenjaju — to bi bila druga stavka.
haccpPlanRuter.patch(
  "/plan-monitoringa/:id",
  requireUloga(...VODSTVO),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const u = tijelo(
      planSchema.pick({ naziv: true, ucestalost: true, puta: true, uloga: true, skladisteId: true, napomena: true }).partial().extend({ aktivan: z.boolean().optional() }),
      request.body,
    );
    await transakcija(async (klijent) => {
      const id = str(request.params.id);
      const prije = await stanjeReda(klijent, "plan_monitoringa", id, true);
      if (!prije) throw new ApiGreska(404, "STAVKA_NE_POSTOJI", "Stavka plana nije pronađena.");
      await klijent.query(
        `update plan_monitoringa set
           naziv = coalesce($1, naziv), ucestalost = coalesce($2, ucestalost), puta = coalesce($3, puta),
           uloga = case when $4::boolean then $5::uloga_t else uloga end,
           skladiste_id = case when $6::boolean then $7::uuid else skladiste_id end,
           napomena = coalesce($8, napomena), aktivan = coalesce($9, aktivan), updated_at = now()
         where id = $10`,
        [
          u.naziv ?? null, u.ucestalost ?? null, u.puta ?? null,
          u.uloga !== undefined, u.uloga ?? null,
          u.skladisteId !== undefined, u.skladisteId ?? null,
          u.napomena ?? null, u.aktivan ?? null, id,
        ],
      );
      await logIzmjenaReda(klijent, { korisnikId: request.korisnik!.id, entitetTip: "plan_monitoringa", entitetId: id, prije, poslije: await stanjeReda(klijent, "plan_monitoringa", id) });
    });
    response.status(204).end();
  }),
);

haccpPlanRuter.post(
  "/plan-monitoringa/osnovni",
  requireUloga(...VODSTVO),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const broj = await transakcija((klijent) => osnovniPlan(klijent, request.korisnik!.id));
    if (broj === 0) throw new ApiGreska(409, "PLAN_POSTOJI", "Plan monitoringa već postoji — izmijenite postojeće stavke.");
    response.status(201).json({ broj });
  }),
);

// ─── Kontrolne tačke (tekst za HACCP plan; nova tačka, npr. komora K-02) ────────────────────────
const tackaSchema = z.object({
  sifra: z.string().trim().min(2).max(20),
  naziv: z.string().trim().min(2),
  opis: z.string().optional(),
  opasnost: z.string().optional(),
  korektivnaMjera: z.string().optional(),
  verifikacija: z.string().optional(),
});
const NEZAMJENJIVE = ["KKT1", "KKT3"]; // na njih se oslanjaju prijem i isporuka

haccpPlanRuter.post(
  "/kontrolne-tacke",
  requireUloga(...VODSTVO),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const u = tijelo(tackaSchema, request.body);
    try {
      const id = await transakcija(async (klijent) => {
        const r = await klijent.query<{ id: string }>(
          `insert into kontrolna_tacka (sifra, naziv, opis, opasnost, korektivna_mjera, verifikacija) values ($1, $2, $3, $4, $5, $6) returning id`,
          [u.sifra.toUpperCase(), u.naziv, u.opis?.trim() || null, u.opasnost?.trim() || null, u.korektivnaMjera?.trim() || null, u.verifikacija?.trim() || null],
        );
        await logKreiranje(klijent, { korisnikId: request.korisnik!.id, entitetTip: "kontrolna_tacka", entitetId: r.rows[0].id, noveVrijednosti: u });
        return r.rows[0].id;
      });
      response.status(201).json({ id });
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new ApiGreska(409, "SIFRA_POSTOJI", "Kontrolna tačka sa tom šifrom već postoji.");
      throw e;
    }
  }),
);

haccpPlanRuter.patch(
  "/kontrolne-tacke/:id",
  requireUloga(...VODSTVO),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const u = tijelo(tackaSchema.omit({ sifra: true }).partial().extend({ aktivan: z.boolean().optional() }), request.body);
    await transakcija(async (klijent) => {
      const id = str(request.params.id);
      const t = (await stanjeReda(klijent, "kontrolna_tacka", id, true)) as { sifra: string } | null;
      if (!t) throw new ApiGreska(404, "TACKA_NE_POSTOJI", "Kontrolna tačka nije pronađena.");
      if (u.aktivan === false && NEZAMJENJIVE.includes(t.sifra)) {
        throw new ApiGreska(409, "TACKA_NEZAMJENJIVA", `${t.sifra} koriste prijem i isporuka — ne može se isključiti.`);
      }
      await klijent.query(
        `update kontrolna_tacka set naziv = coalesce($1, naziv), opis = coalesce($2, opis), opasnost = coalesce($3, opasnost),
           korektivna_mjera = coalesce($4, korektivna_mjera), verifikacija = coalesce($5, verifikacija), aktivan = coalesce($6, aktivan)
         where id = $7`,
        [u.naziv ?? null, u.opis ?? null, u.opasnost ?? null, u.korektivnaMjera ?? null, u.verifikacija ?? null, u.aktivan ?? null, id],
      );
      await logIzmjenaReda(klijent, { korisnikId: request.korisnik!.id, entitetTip: "kontrolna_tacka", entitetId: id, prije: t, poslije: await stanjeReda(klijent, "kontrolna_tacka", id) });
    });
    response.status(204).end();
  }),
);

// ─── Mjerni uređaji ──────────────────────────────────────────────────────────────────────────────
// Izbor termometra pri mjerenju (R-23) — svako ko mjeri (i vozač pri predaji) vidi samo naziv i stanje.
haccpPlanRuter.get(
  "/termometri",
  sviPrijavljeni(),
  asyncRuta(async (_request, response) => {
    response.json((await listaUredjaja(true)).map((u) => ({ id: u.id, naziv: u.naziv, oznaka: u.oznaka, lokacija: u.lokacija, stanje: u.stanje })));
  }),
);

haccpPlanRuter.get(
  "/mjerni-uredjaji",
  requireUloga("operater", "bzr", "izvodjac", "uprava"),
  asyncRuta(async (_request, response) => {
    response.json(await listaUredjaja());
  }),
);

const uredjajSchema = z.object({
  naziv: z.string().trim().min(2, "Upišite naziv (npr. „Ubodni termometar 1\")."),
  oznaka: z.string().optional(),
  lokacija: z.string().optional(),
  intervalProvjereMjeseci: z.number().int().min(1).max(24).default(1),
  intervalKalibracijeMjeseci: z.number().int().min(1).max(60).nullable().optional(),
});

haccpPlanRuter.post(
  "/mjerni-uredjaji",
  requireUloga(...VODSTVO),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const u = tijelo(uredjajSchema, request.body);
    const id = await transakcija(async (klijent) => {
      const r = await klijent.query<{ id: string }>(
        `insert into mjerni_uredjaj (naziv, oznaka, lokacija, interval_provjere_mjeseci, interval_kalibracije_mjeseci) values ($1, $2, $3, $4, $5) returning id`,
        [u.naziv, u.oznaka?.trim() || null, u.lokacija?.trim() || null, u.intervalProvjereMjeseci, u.intervalKalibracijeMjeseci ?? null],
      );
      await logKreiranje(klijent, { korisnikId: request.korisnik!.id, entitetTip: "mjerni_uredjaj", entitetId: r.rows[0].id, noveVrijednosti: u });
      return r.rows[0].id;
    });
    response.status(201).json({ id });
  }),
);

haccpPlanRuter.patch(
  "/mjerni-uredjaji/:id",
  requireUloga(...VODSTVO),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const u = tijelo(uredjajSchema.partial().extend({ aktivan: z.boolean().optional() }), request.body);
    await transakcija(async (klijent) => {
      const id = str(request.params.id);
      const prije = await stanjeReda(klijent, "mjerni_uredjaj", id, true);
      if (!prije) throw new ApiGreska(404, "UREDJAJ_NE_POSTOJI", "Mjerni uređaj nije pronađen.");
      await klijent.query(
        `update mjerni_uredjaj set naziv = coalesce($1, naziv), oznaka = coalesce($2, oznaka), lokacija = coalesce($3, lokacija),
           interval_provjere_mjeseci = coalesce($4, interval_provjere_mjeseci),
           interval_kalibracije_mjeseci = case when $5::boolean then $6::int else interval_kalibracije_mjeseci end,
           aktivan = coalesce($7, aktivan), updated_at = now()
         where id = $8`,
        [u.naziv ?? null, u.oznaka ?? null, u.lokacija ?? null, u.intervalProvjereMjeseci ?? null, u.intervalKalibracijeMjeseci !== undefined, u.intervalKalibracijeMjeseci ?? null, u.aktivan ?? null, id],
      );
      await logIzmjenaReda(klijent, { korisnikId: request.korisnik!.id, entitetTip: "mjerni_uredjaj", entitetId: id, prije, poslije: await stanjeReda(klijent, "mjerni_uredjaj", id) });
    });
    response.status(204).end();
  }),
);

haccpPlanRuter.get(
  "/mjerni-uredjaji/:id/provjere",
  requireUloga("operater", "bzr", "izvodjac", "uprava"),
  asyncRuta(async (request, response) => {
    const r = await upit(
      `select id, to_char(datum, 'YYYY-MM-DD') as datum, vrsta, referentna, izmjereno, dozvoljeno_odstupanje, rezultat, broj_sertifikata, izvrsilac, napomena, created_at
       from provjera_uredjaja where uredjaj_id = $1 order by datum desc, created_at desc`,
      [request.params.id],
    );
    response.json(r.rows);
  }),
);

const provjeraSchema = z.object({
  datum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  vrsta: z.enum(["INTERNA", "KALIBRACIJA"]),
  referentna: z.number().nullable().optional(),
  izmjereno: z.number().nullable().optional(),
  dozvoljenoOdstupanje: z.number().positive().max(5).nullable().optional(),
  rezultat: z.enum(["ISPRAVAN", "NEISPRAVAN"]).optional(),
  brojSertifikata: z.string().optional(),
  napomena: z.string().optional(),
  izvrsilac: z.string().optional(),
});

// Provjeru termometra (ledena voda) može uraditi i magacioner — potpisuje se svojim imenom.
haccpPlanRuter.post(
  "/mjerni-uredjaji/:id/provjera",
  requireUloga("operater", "bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const u = tijelo(provjeraSchema, request.body);
    const izvrsilac = izvrsilacZa(request.korisnik!, u.izvrsilac);
    response.status(201).json(await zabiljeziProvjeru(str(request.params.id), u, izvrsilac, request.korisnik!.id));
  }),
);

// ─── Verifikacija sistema ────────────────────────────────────────────────────────────────────────
haccpPlanRuter.get(
  "/verifikacija-sistema",
  requireUloga(...VODSTVO_I_UPRAVA),
  asyncRuta(async (_request, response) => {
    const [stanje, zapisi] = await Promise.all([
      stanjeVerifikacije(),
      upit(
        `select v.id, v.vrsta, to_char(v.datum, 'YYYY-MM-DD') as datum, v.izvrsilac, v.nalaz, v.zakljucak, to_char(v.sljedeca_do, 'YYYY-MM-DD') as sljedeca_do
         from verifikacija_sistema v order by v.datum desc, v.created_at desc limit 100`,
      ),
    ]);
    response.json({ stanje, zapisi: zapisi.rows });
  }),
);

const verifikacijaSchema = z.object({
  vrsta: z.enum(Object.keys(VRSTE_VERIFIKACIJE) as [keyof typeof VRSTE_VERIFIKACIJE, ...(keyof typeof VRSTE_VERIFIKACIJE)[]]),
  datum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nalaz: z.string().trim().min(10, "Upišite šta je pregledano i šta je nađeno — to čita inspektor."),
  zakljucak: z.enum(["USAGLASENO", "POTREBNE_IZMJENE"]),
  sljedecaDo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  izvrsilac: z.string().optional(),
});

haccpPlanRuter.post(
  "/verifikacija-sistema",
  requireUloga(...VODSTVO),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const u = tijelo(verifikacijaSchema, request.body);
    response.status(201).json(await zabiljeziVerifikaciju(u, izvrsilacZa(request.korisnik!, u.izvrsilac), request.korisnik!.id));
  }),
);

// ─── HACCP plan za štampu ────────────────────────────────────────────────────────────────────────
haccpPlanRuter.get(
  "/haccp-plan",
  requireUloga(...VODSTVO_I_UPRAVA),
  asyncRuta(async (_request, response) => {
    response.json(await haccpPlan());
  }),
);

