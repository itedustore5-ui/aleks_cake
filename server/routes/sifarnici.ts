import { Router } from "express";
import { z } from "zod";
import { pool, upit, transakcija } from "../db.js";
import { asyncRuta, ApiGreska } from "../greske.js";
import { requireUloga, type AuthZahtjev, sviPrijavljeni } from "../auth.js";
import { tijelo, str } from "../validacija.js";
import { logKreiranje, logIzmjenaReda, stanjeReda } from "../services/auditService.js";
import { uskladiPravilaArtikla } from "../services/pravilaService.js";

export const sifarniciRuter = Router();
// PIB je jedinstven (R-28) — otpremnica prepoznaje dobavljača po PIB-u, a dva ista PIB-a znače dupli unos.
const JEDINSTVEN_PIB = (e: unknown, ko: string) => {
  if ((e as { code?: string }).code === "23505") throw new ApiGreska(409, "PIB_POSTOJI", `${ko} sa tim PIB-om već postoji — izaberite ga sa spiska.`);
  throw e;
};
const pibSchema = z.string().trim().regex(/^\d{8,13}$/, "PIB se upisuje samo ciframa (pravno lice: 8 cifara).").optional().or(z.literal(""));
const dobavljacSchema = z.object({
  naziv: z.string().min(2),
  pib: z.string().trim().optional(),
  adresa: z.string().optional(),
  telefon: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
});

sifarniciRuter.get("/dobavljaci", requireUloga("operater", "bzr", "izvodjac"), asyncRuta(async (_request, response) => {
  response.json((await upit(`select * from dobavljac where aktivan order by naziv`)).rows);
}));

sifarniciRuter.post(
  "/dobavljaci",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const ulaz = tijelo(dobavljacSchema, request.body);
    const rezultat = await transakcija(async (klijent) => {
      const rezultat = await klijent.query<{ id: string }>(
        `insert into dobavljac (naziv, pib, adresa, telefon, email) values ($1, $2, $3, $4, $5) returning id`,
        [ulaz.naziv, ulaz.pib || null, ulaz.adresa ?? null, ulaz.telefon ?? null, ulaz.email || null],
      );
      await logKreiranje(klijent, { korisnikId: request.korisnik!.id, entitetTip: "dobavljac", entitetId: rezultat.rows[0].id, noveVrijednosti: ulaz });
      return rezultat;
    }).catch((e) => JEDINSTVEN_PIB(e, "Dobavljač"));
    response.status(201).json({ id: rezultat.rows[0].id });
  }),
);

sifarniciRuter.patch(
  "/dobavljaci/:id",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const ulaz = tijelo(dobavljacSchema, request.body);
    const id = str(request.params.id);
    await transakcija(async (klijent) => {
      const prije = await stanjeReda(klijent, "dobavljac", id, true);
      if (!prije) throw new ApiGreska(404, "DOBAVLJAC_NE_POSTOJI", "Dobavljač nije pronađen.");
      await klijent.query(
        `update dobavljac set naziv = $1, pib = $2, adresa = $3, telefon = $4, email = $5 where id = $6`,
        [ulaz.naziv, ulaz.pib || null, ulaz.adresa ?? null, ulaz.telefon ?? null, ulaz.email || null, id],
      );
      await logIzmjenaReda(klijent, { korisnikId: request.korisnik!.id, entitetTip: "dobavljac", entitetId: id, prije, poslije: await stanjeReda(klijent, "dobavljac", id) });
    }).catch((e) => JEDINSTVEN_PIB(e, "Dobavljač"));
    response.status(204).end();
  }),
);

// Kupac bez telefona se ne upisuje (invarijanta #4) — telefon je NOT NULL i u zod šemi i u bazi.
const kupacSchema = z.object({
  naziv: z.string().min(2),
  adresa: z.string().optional(),
  telefon: z.string().min(6, "Telefon je obavezan — povlačenje robe počinje telefonom."),
  email: z.string().email().optional().or(z.literal("")),
  // Za otpremnicu (R-28): PIB kupca i adresa na koju roba ide, kad nije sjedište.
  pib: pibSchema,
  adresaIsporuke: z.string().optional(),
});

sifarniciRuter.get("/kupci", requireUloga("operater", "vozac", "bzr", "izvodjac"), asyncRuta(async (_request, response) => {
  response.json((await upit(`select * from kupac where aktivan order by naziv`)).rows);
}));

sifarniciRuter.post(
  "/kupci",
  requireUloga("bzr", "izvodjac", "operater"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const ulaz = tijelo(kupacSchema, request.body);
    const rezultat = await transakcija(async (klijent) => {
      const rezultat = await klijent.query<{ id: string }>(
        `insert into kupac (naziv, adresa, telefon, email, pib, adresa_isporuke) values ($1, $2, $3, $4, $5, $6) returning id`,
        [ulaz.naziv, ulaz.adresa ?? null, ulaz.telefon, ulaz.email || null, ulaz.pib || null, ulaz.adresaIsporuke?.trim() || null],
      );
      await logKreiranje(klijent, { korisnikId: request.korisnik!.id, entitetTip: "kupac", entitetId: rezultat.rows[0].id, noveVrijednosti: ulaz });
      return rezultat;
    }).catch((e) => JEDINSTVEN_PIB(e, "Kupac"));
    response.status(201).json({ id: rezultat.rows[0].id });
  }),
);

sifarniciRuter.patch(
  "/kupci/:id",
  requireUloga("bzr", "izvodjac", "operater"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const ulaz = tijelo(kupacSchema, request.body);
    const id = str(request.params.id);
    await transakcija(async (klijent) => {
      const prije = await stanjeReda(klijent, "kupac", id, true);
      if (!prije) throw new ApiGreska(404, "KUPAC_NE_POSTOJI", "Kupac nije pronađen.");
      await klijent.query(
        `update kupac set naziv = $1, adresa = $2, telefon = $3, email = $4, pib = $6, adresa_isporuke = $7 where id = $5`,
        [ulaz.naziv, ulaz.adresa ?? null, ulaz.telefon, ulaz.email || null, id, ulaz.pib || null, ulaz.adresaIsporuke?.trim() || null],
      );
      await logIzmjenaReda(klijent, { korisnikId: request.korisnik!.id, entitetTip: "kupac", entitetId: id, prije, poslije: await stanjeReda(klijent, "kupac", id) });
    }).catch((e) => JEDINSTVEN_PIB(e, "Kupac"));
    response.status(204).end();
  }),
);

const artikalSchema = z.object({
  sifra: z.string().optional(),
  naziv: z.string().min(2),
  jedinicaMjere: z.string().default("kom"),
  zahtijevaLot: z.boolean().default(true),
  tempKontrolisano: z.boolean().default(false),
  tempMin: z.number().optional(),
  tempMax: z.number().optional(),
  rokTrajanjaDana: z.number().int().optional(),
  granicaPotvrdio: z.boolean().default(false),
  // Rok trajanja se upisuje pri prijemu (R-17); isključuje se samo za izuzetke.
  rokObavezan: z.boolean().default(true),
});

sifarniciRuter.get("/artikli", requireUloga("operater", "bzr", "izvodjac"), asyncRuta(async (_request, response) => {
  response.json((await upit(`select * from artikal where aktivan order by naziv`)).rows);
}));

sifarniciRuter.post(
  "/artikli",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const ulaz = tijelo(artikalSchema, request.body);
    const rezultat = await transakcija(async (klijent) => {
      const rezultat = await klijent.query<{ id: string }>(
        `insert into artikal (sifra, naziv, jedinica_mjere, zahtijeva_lot, temp_kontrolisano, temp_min, temp_max, rok_trajanja_dana, granica_potvrdio, rok_obavezan)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
        [ulaz.sifra ?? null, ulaz.naziv, ulaz.jedinicaMjere, ulaz.zahtijevaLot, ulaz.tempKontrolisano, ulaz.tempMin ?? null, ulaz.tempMax ?? null, ulaz.rokTrajanjaDana ?? null, ulaz.granicaPotvrdio, ulaz.rokObavezan],
      );
      await logKreiranje(klijent, { korisnikId: request.korisnik!.id, entitetTip: "artikal", entitetId: rezultat.rows[0].id, noveVrijednosti: ulaz });
      // Granica sa artikla postaje pravilo za prijem i predaju — ocjenjuje se samo po pravilu.
      await uskladiPravilaArtikla(klijent, rezultat.rows[0].id, request.korisnik!.id);
      return rezultat;
    });
    response.status(201).json({ id: rezultat.rows[0].id });
  }),
);

sifarniciRuter.patch(
  "/artikli/:id",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const ulaz = tijelo(artikalSchema.partial(), request.body);
    const id = str(request.params.id);
    await transakcija(async (klijent) => {
      const prije = await stanjeReda(klijent, "artikal", id, true);
      if (!prije) throw new ApiGreska(404, "ARTIKAL_NE_POSTOJI", "Artikal nije pronađen.");
      await klijent.query(
        `update artikal set
           naziv = coalesce($1, naziv), jedinica_mjere = coalesce($2, jedinica_mjere),
           zahtijeva_lot = coalesce($3, zahtijeva_lot), temp_kontrolisano = coalesce($4, temp_kontrolisano),
           temp_min = coalesce($5, temp_min), temp_max = coalesce($6, temp_max), rok_trajanja_dana = coalesce($7, rok_trajanja_dana),
           granica_potvrdio = coalesce($8, granica_potvrdio), rok_obavezan = coalesce($10, rok_obavezan), updated_at = now()
         where id = $9`,
        [
          ulaz.naziv ?? null,
          ulaz.jedinicaMjere ?? null,
          ulaz.zahtijevaLot ?? null,
          ulaz.tempKontrolisano ?? null,
          ulaz.tempMin ?? null,
          ulaz.tempMax ?? null,
          ulaz.rokTrajanjaDana ?? null,
          ulaz.granicaPotvrdio ?? null,
          id,
          ulaz.rokObavezan ?? null,
        ],
      );
      await logIzmjenaReda(klijent, { korisnikId: request.korisnik!.id, entitetTip: "artikal", entitetId: id, prije, poslije: await stanjeReda(klijent, "artikal", id) });
      await uskladiPravilaArtikla(klijent, id, request.korisnik!.id);
    });
    response.status(204).end();
  }),
);

// Skladišta (magacini). Firma sa jednim ih ne vidi nigdje osim ovdje — izbor skladišta se u
// formama pojavljuje tek kad postoji više od jednog aktivnog.
sifarniciRuter.get(
  "/skladista",
  sviPrijavljeni(),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const [skladista, maticno] = await Promise.all([
      upit(`select id, naziv, adresa, aktivan from skladiste order by aktivan desc, naziv`),
      upit<{ skladiste_id: string | null }>(`select skladiste_id from korisnik where id = $1`, [request.korisnik!.id]),
    ]);
    response.json({ skladista: skladista.rows, maticno: maticno.rows[0]?.skladiste_id ?? null });
  }),
);

const skladisteSchema = z.object({
  naziv: z.string().trim().min(2, "Naziv skladišta je obavezan."),
  adresa: z.string().optional(),
  aktivan: z.boolean().optional(),
});

const JEDINSTVEN_NAZIV = "23505";

sifarniciRuter.post(
  "/skladista",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const ulaz = tijelo(skladisteSchema, request.body);
    try {
      const rezultat = await transakcija(async (klijent) => {
        const rezultat = await klijent.query<{ id: string }>(`insert into skladiste (naziv, adresa) values ($1, $2) returning id`, [ulaz.naziv, ulaz.adresa || null]);
        await logKreiranje(klijent, { korisnikId: request.korisnik!.id, entitetTip: "skladiste", entitetId: rezultat.rows[0].id, noveVrijednosti: ulaz });
        return rezultat;
      });
      response.status(201).json({ id: rezultat.rows[0].id });
    } catch (e) {
      if ((e as { code?: string }).code === JEDINSTVEN_NAZIV) throw new ApiGreska(409, "SKLADISTE_POSTOJI", "Skladište sa tim nazivom već postoji.");
      throw e;
    }
  }),
);

sifarniciRuter.patch(
  "/skladista/:id",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const ulaz = tijelo(skladisteSchema, request.body);
    const id = str(request.params.id);
    if (ulaz.aktivan === false) {
      const ostala = await pool.query(`select 1 from skladiste where aktivan and id <> $1 limit 1`, [id]);
      if (!ostala.rows[0]) throw new ApiGreska(409, "POSLJEDNJE_SKLADISTE", "Firma mora imati bar jedno aktivno skladište.");
    }
    try {
      await transakcija(async (klijent) => {
        const prije = await stanjeReda(klijent, "skladiste", id, true);
        if (!prije) throw new ApiGreska(404, "SKLADISTE_NE_POSTOJI", "Skladište nije pronađeno.");
        await klijent.query(
          `update skladiste set naziv = $1, adresa = $2, aktivan = coalesce($3, aktivan) where id = $4`,
          [ulaz.naziv, ulaz.adresa || null, ulaz.aktivan ?? null, id],
        );
        await logIzmjenaReda(klijent, { korisnikId: request.korisnik!.id, entitetTip: "skladiste", entitetId: id, prije, poslije: await stanjeReda(klijent, "skladiste", id) });
      });
    } catch (e) {
      if ((e as { code?: string }).code === JEDINSTVEN_NAZIV) throw new ApiGreska(409, "SKLADISTE_POSTOJI", "Skladište sa tim nazivom već postoji.");
      throw e;
    }
    response.status(204).end();
  }),
);
