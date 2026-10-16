import { Router } from "express";
import { z } from "zod";
import { upit, transakcija } from "../db.js";
import { asyncRuta, ApiGreska } from "../greske.js";
import { requireUloga, type AuthZahtjev } from "../auth.js";
import { tijelo, str } from "../validacija.js";
import { zabiljeziKontroluVozila, provjeriGranicuVozila, D1_DANAS } from "../services/vozilaService.js";
import { logKreiranje, logIzmjenaReda, stanjeReda } from "../services/auditService.js";
import { vanMreze } from "../vanMreze.js";

export const vozilaRuter = Router();
vozilaRuter.get("/vozila", requireUloga("operater", "vozac", "bzr", "izvodjac"), asyncRuta(async (_request, response) => {
  response.json(
    (
      await upit(
        `select v.*,
                (select kv.ukupan_status from kontrola_vozila kv where kv.vozilo_id = v.id and ${D1_DANAS} order by kv.izvrseno_at desc limit 1) as d1_danas,
                -- D1 je prije utovara: vozilo koje danas ne vozi nije „čeka D1“ (01.10.2026).
                exists (select 1 from isporuka i where i.vozilo_id = v.id and i.status::text <> 'OTKAZANA'
                        and i.datum_isporuke = (now() at time zone 'Europe/Podgorica')::date) as vozi_danas
         from vozilo v where v.aktivan order by v.registarski_broj`,
      )
    ).rows,
  );
}));

const novoVoziloSchema = z.object({
  registarskiBroj: z.string().min(3),
  tip: z.string().optional(),
  tempKontrolisano: z.boolean().default(false),
  tempMin: z.number().optional(),
  tempMax: z.number().optional(),
});

vozilaRuter.post(
  "/vozila",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const ulaz = tijelo(novoVoziloSchema, request.body);
    provjeriGranicuVozila(ulaz);
    const rezultat = await transakcija(async (klijent) => {
      const rezultat = await klijent.query<{ id: string }>(
        `insert into vozilo (registarski_broj, tip, temp_kontrolisano, temp_min, temp_max) values ($1, $2, $3, $4, $5) returning id`,
        [ulaz.registarskiBroj, ulaz.tip ?? null, ulaz.tempKontrolisano, ulaz.tempMin ?? null, ulaz.tempMax ?? null],
      );
      await logKreiranje(klijent, { korisnikId: request.korisnik!.id, entitetTip: "vozilo", entitetId: rezultat.rows[0].id, noveVrijednosti: ulaz });
      return rezultat;
    });
    response.status(201).json({ id: rezultat.rows[0].id });
  }),
);

vozilaRuter.patch(
  "/vozila/:id",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const ulaz = tijelo(novoVoziloSchema.partial().extend({ tempMin: z.number().nullable().optional(), tempMax: z.number().nullable().optional(), aktivan: z.boolean().optional() }), request.body);
    const id = str(request.params.id);
    await transakcija(async (klijent) => {
      const prije = await stanjeReda(klijent, "vozilo", id, true);
      if (!prije) throw new ApiGreska(404, "VOZILO_NE_POSTOJI", "Vozilo nije pronađeno.");
      const novo = {
        tempKontrolisano: ulaz.tempKontrolisano ?? (prije.temp_kontrolisano as boolean),
        tempMin: ulaz.tempMin !== undefined ? ulaz.tempMin : prije.temp_min === null ? null : Number(prije.temp_min),
        tempMax: ulaz.tempMax !== undefined ? ulaz.tempMax : prije.temp_max === null ? null : Number(prije.temp_max),
      };
      provjeriGranicuVozila(novo);
      try {
        await klijent.query(
          `update vozilo set registarski_broj = coalesce($1, registarski_broj), tip = coalesce($2, tip), temp_kontrolisano = $3,
             temp_min = $4, temp_max = $5, aktivan = coalesce($6, aktivan) where id = $7`,
          [ulaz.registarskiBroj?.trim() ?? null, ulaz.tip ?? null, novo.tempKontrolisano, novo.tempMin, novo.tempMax, ulaz.aktivan ?? null, id],
        );
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw new ApiGreska(409, "VOZILO_POSTOJI", "Vozilo sa tim registarskim brojem već postoji.");
        throw e;
      }
      await logIzmjenaReda(klijent, { korisnikId: request.korisnik!.id, entitetTip: "vozilo", entitetId: id, prije, poslije: await stanjeReda(klijent, "vozilo", id) });
    });
    response.status(204).end();
  }),
);

// D1 vidi SAMO vozač (i bzr/izvodjac radi nadzora) — invarijanta #24. Magacioner ovo ne vidi
// čak ni kad postoji aktivan vozač, jer zapis o vozilu potpisuje onaj ko je stajao pored njega.
vozilaRuter.get(
  "/kontrole-vozila",
  requireUloga("vozac", "bzr", "izvodjac"),
  asyncRuta(async (request, response) => {
    const voziloId = typeof request.query.voziloId === "string" ? request.query.voziloId : undefined;
    const rezultat = await upit(
      `select kv.*, v.registarski_broj, coalesce(l.ime, k.korisnicko_ime) as izvrsio,
              to_char(kv.izvrseno_at at time zone 'Europe/Podgorica', 'YYYY-MM-DD') as datum
       from kontrola_vozila kv
       join vozilo v on v.id = kv.vozilo_id
       left join korisnik k on k.id = kv.izvrsio_korisnik_id
       left join lice l on l.id = k.lice_id
       where ($1::uuid is null or kv.vozilo_id = $1) order by kv.izvrseno_at desc limit 100`,
      [voziloId ?? null],
    );
    response.json(rezultat.rows);
  }),
);

const kontrolaSchema = z.object({
  vozilId: z.string().uuid(),
  cistoca: z.boolean(),
  temperatura: z.number().nullable().optional(),
  opremaOk: z.boolean(),
  vrataOk: z.boolean(),
  napomena: z.string().optional(),
});

vozilaRuter.post(
  "/kontrole-vozila",
  requireUloga("vozac", "bzr", "izvodjac"),
  vanMreze("kontrola_vozila"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const ulaz = tijelo(kontrolaSchema, request.body);
    const rezultat = await zabiljeziKontroluVozila(ulaz, request.korisnik!.id);
    response.status(201).json(rezultat);
  }),
);
