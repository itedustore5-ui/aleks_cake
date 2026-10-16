import { Router } from "express";
import { z } from "zod";
import { pool, upit, transakcija } from "../db.js";
import { asyncRuta, ApiGreska } from "../greske.js";
import { requireUloga, ogranicenjeDatuma, izvrsilacZa, samoMoje, provjeriProzorUpisa, type AuthZahtjev } from "../auth.js";
import { tijelo } from "../validacija.js";
import { zabiljeziMjerenje, praviloZaMjerenje, provjeriTermometar } from "../services/haccpService.js";
import { logKreiranje } from "../services/auditService.js";
import { neusaglasenostIzZapisa } from "../services/ncService.js";
import { nadjiObrazac, ocijeniPodatke } from "../services/obrasciService.js";
import { skladisteUnosa } from "../services/skladisteService.js";
import { vanMreze, vrijemeVanMreze } from "../vanMreze.js";

export const haccpRuter = Router();
haccpRuter.get("/kontrolne-tacke", requireUloga("operater", "bzr", "izvodjac"), asyncRuta(async (_request, response) => {
  response.json((await upit(`select * from kontrolna_tacka where aktivan order by sifra`)).rows);
}));

haccpRuter.get(
  "/pravila-kontrole",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request, response) => {
    const { kontrolnaTackaId, artikalId } = request.query;
    const rezultat = await upit(
      `select * from pravilo_kontrole
       where aktivan and ($1::uuid is null or kontrolna_tacka_id = $1) and ($2::uuid is null or artikal_id = $2 or artikal_id is null)
       order by artikal_id nulls last`,
      [kontrolnaTackaId ?? null, artikalId ?? null],
    );
    response.json(rezultat.rows);
  }),
);

const novoPraviloSchema = z.object({
  kontrolnaTackaId: z.string().uuid(),
  artikalId: z.string().uuid().optional(),
  naziv: z.string().min(2),
  minVrijednost: z.number().optional(),
  maxVrijednost: z.number().optional(),
  jedinica: z.string().default("°C"),
  ozbiljnost: z.enum(["NIZAK", "SREDNJI", "VISOK"]).default("SREDNJI"),
});

// Pravila su versionisana — nova verzija zatvara prethodnu, ne prepisuje je.
haccpRuter.post(
  "/pravila-kontrole",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const ulaz = tijelo(novoPraviloSchema, request.body);
    // Gašenje stare verzije i upis nove su jedna radnja: ranije je pad upisa ostavljao tačku BEZ
    // ijednog aktivnog pravila, a dva istovremena upisa su pravila dvije aktivne verzije.
    const rezultat = await transakcija(async (klijent) => {
      const prethodno = await klijent.query<{ id: string; verzija: number }>(
        `select id, verzija from pravilo_kontrole where kontrolna_tacka_id = $1 and artikal_id is not distinct from $2 and aktivan for update`,
        [ulaz.kontrolnaTackaId, ulaz.artikalId ?? null],
      );
      if (prethodno.rows[0]) {
        await klijent.query(`update pravilo_kontrole set aktivan = false, vazi_do = now() where id = $1`, [prethodno.rows[0].id]);
      }
      const verzija = (prethodno.rows[0]?.verzija ?? 0) + 1;
      const novo = await klijent.query<{ id: string }>(
        `insert into pravilo_kontrole (kontrolna_tacka_id, artikal_id, naziv, min_vrijednost, max_vrijednost, jedinica, ozbiljnost, verzija)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [ulaz.kontrolnaTackaId, ulaz.artikalId ?? null, ulaz.naziv, ulaz.minVrijednost ?? null, ulaz.maxVrijednost ?? null, ulaz.jedinica, ulaz.ozbiljnost, verzija],
      );
      await logKreiranje(klijent, { korisnikId: request.korisnik!.id, entitetTip: "pravilo_kontrole", entitetId: novo.rows[0].id, noveVrijednosti: ulaz });
      return { id: novo.rows[0].id, verzija };
    });
    response.status(201).json(rezultat);
  }),
);

haccpRuter.get(
  "/mjerenja",
  requireUloga("operater", "bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const ogranicenje = ogranicenjeDatuma(request.korisnik!.uloga, "m.izmjereno_at::date");
    const rezultat = await upit(
      `select m.*, kt.naziv as kontrolna_tacka_naziv, l.broj_lota, coalesce(li.ime, k.korisnicko_ime) as izmjerio,
              u.naziv as termometar, u.oznaka as termometar_oznaka,
              exists (
                select 1 from provjera_uredjaja p
                where p.uredjaj_id = m.mjerni_uredjaj_id and p.rezultat = 'NEISPRAVAN' and p.created_at > m.izmjereno_at
                  and not exists (select 1 from provjera_uredjaja d where d.uredjaj_id = p.uredjaj_id and d.rezultat = 'ISPRAVAN'
                                  and d.created_at > m.izmjereno_at and d.created_at < p.created_at)
              ) as upitno
       from mjerenje_temperature m
       join kontrolna_tacka kt on kt.id = m.kontrolna_tacka_id
       left join lot l on l.id = m.lot_id
       left join korisnik k on k.id = m.izmjerio_korisnik_id
       left join lice li on li.id = k.lice_id
       left join mjerni_uredjaj u on u.id = m.mjerni_uredjaj_id
       where ${ogranicenje}
       order by m.izmjereno_at desc limit 200`,
    );
    response.json(rezultat.rows);
  }),
);

const novoMjerenjeSchema = z.object({
  kontrolnaTackaId: z.string().uuid(),
  lotId: z.string().uuid().optional(),
  vozilId: z.string().uuid().optional(),
  vrijednost: z.number(),
  napomena: z.string().optional(),
  mjerniUredjajId: z.string().uuid().optional(),
  /** Magacin u kom je izmjereno (#77) — kad firma ima više magacina; inače se zna sam. */
  skladisteId: z.string().uuid().optional(),
});

haccpRuter.post(
  "/mjerenja",
  requireUloga("operater", "bzr", "izvodjac"),
  vanMreze("mjerenje"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const ulaz = tijelo(novoMjerenjeSchema, request.body);
    // Lot se ocjenjuje po granici SVOG artikla, ne po posljednjem pravilu tačke (R-09).
    const pravilo = await praviloZaMjerenje(ulaz.kontrolnaTackaId, ulaz.lotId);
    if (!pravilo) {
      throw new ApiGreska(409, "PRAVILO_NE_POSTOJI", "Za ovu kontrolnu tačku još nije podešeno pravilo — obratite se odgovornom licu.");
    }
    // Kad firma vodi termometre, zna se kojim je mjereno (R-23) — kad padne na provjeri, zna se šta pregledati.
    if (!ulaz.mjerniUredjajId) {
      const u = (
        await upit<{ ukupno: number; ispravnih: number }>(
          `select count(*)::int as ukupno,
                  count(*) filter (where coalesce((select p.rezultat from provjera_uredjaja p where p.uredjaj_id = u.id order by p.datum desc, p.created_at desc limit 1), '') <> 'NEISPRAVAN')::int as ispravnih
           from mjerni_uredjaj u where u.aktivan`,
        )
      ).rows[0];
      if (u.ukupno > 0 && u.ispravnih === 0) {
        throw new ApiGreska(409, "NEMA_ISPRAVNOG_TERMOMETRA", "Nijedan termometar u upotrebi nije prošao provjeru — provjerite ili zamijenite termometar (HACCP plan → Termometri), pa mjerite.");
      }
      if (u.ukupno > 0) throw new ApiGreska(400, "TERMOMETAR_OBAVEZAN", "Izaberite termometar kojim ste mjerili.");
    }
    await provjeriTermometar(ulaz.mjerniUredjajId);
    const skladisteId = await skladisteUnosa(pool, { trazeno: ulaz.skladisteId, lotId: ulaz.lotId, korisnikId: request.korisnik!.id });
    const rezultat = await zabiljeziMjerenje(pravilo, { ...ulaz, praviloKontroleId: pravilo.id, izmjerioKorisnikId: request.korisnik!.id, skladisteId });
    response.status(201).json(rezultat);
  }),
);

// Dnevni obrasci (P1/P3/P7/P8...), generički. Šema polja je u public/obrasci-cg.json.
haccpRuter.get(
  "/zapisi",
  requireUloga("operater", "bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const obrazacKod = typeof request.query.obrazacKod === "string" ? request.query.obrazacKod : undefined;
    const ogranicenje = ogranicenjeDatuma(request.korisnik!.uloga, "z.datum");
    const filterMoje = samoMoje(request.korisnik!.uloga) ? "and z.uneo_korisnik_id = $2" : "";
    const parametri = filterMoje ? [obrazacKod ?? null, request.korisnik!.id] : [obrazacKod ?? null];
    const rezultat = await upit(
      `select z.*, not exists(select 1 from zapis n where n.ispravlja_id = z.id) as vazeci,
              ((z.created_at at time zone 'Europe/Podgorica')::date - z.datum) as naknadno_dana
       from zapis z
       where ${ogranicenje} and ($1::text is null or z.obrazac_kod = $1) ${filterMoje}
       order by z.datum desc, z.created_at desc limit 300`,
      parametri,
    );
    response.json(rezultat.rows);
  }),
);

const noviZapisSchema = z.object({
  obrazacKod: z.string().min(1),
  datum: z.string(),
  podaci: z.record(z.string(), z.unknown()).default({}),
  odstupanje: z.boolean().default(false),
  korektivnaMjera: z.string().optional(),
  izvrsilac: z.string().optional(),
  ispravljaId: z.string().uuid().optional(),
  /** Magacin u kom je obrazac rađen (#77) — kad firma ima više magacina; inače se zna sam. */
  skladisteId: z.string().uuid().optional(),
});

haccpRuter.post(
  "/zapisi",
  requireUloga("operater", "bzr", "izvodjac"),
  vanMreze("zapis"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const ulaz = tijelo(noviZapisSchema, request.body);
    const korisnik = request.korisnik!;
    const obrazac = nadjiObrazac(ulaz.obrazacKod);
    // Invarijanta #25 i na serveru: obrazac upisuje samo uloga za koju je.
    if (!obrazac.uloge.includes(korisnik.uloga)) throw new ApiGreska(403, "OBRAZAC_NIJE_ZA_ULOGU", `Obrazac ${obrazac.kod} ne upisuje vaša uloga.`);
    // Odstupanje slijedi iz odgovora, ne samo iz kvačice (R-08).
    const { podaci, odstupanja } = ocijeniPodatke(obrazac, ulaz.podaci);
    const odstupanje = ulaz.odstupanje || odstupanja.length > 0;
    if (odstupanje && (!ulaz.korektivnaMjera || ulaz.korektivnaMjera.trim() === "")) {
      throw new ApiGreska(
        400,
        "MJERA_OBAVEZNA",
        `${odstupanja.length ? `Odstupanje: ${odstupanja.join("; ")}. ` : ""}Odstupanje bez zapisane mjere je nalaz protiv firme, ne protiv zaposlenog — upišite korektivnu mjeru.`,
        { odstupanja },
      );
    }
    const izvrsilac = izvrsilacZa(korisnik, ulaz.izvrsilac);
    // Zapis sa odstupanjem i njegova neusaglašenost nastaju zajedno ili nikako — inače bi ostao
    // zapis sa odstupanjem koje niko ne provjerava (nalaz H3).
    const rezultat = await transakcija(async (klijent) => {
      let datum = ulaz.datum;
      let lanacImaNc = false;
      let skladisteId = await skladisteUnosa(klijent, { trazeno: ulaz.skladisteId, korisnikId: korisnik.id });
      if (ulaz.ispravljaId) {
        // Ispravka (R-07): istog obrasca, posljednje verzije, svog zapisa (terenska uloga), u svom prozoru.
        const stari = (
          await klijent.query<{ obrazac_kod: string; datum: string; uneo_korisnik_id: string | null; ispravljen: boolean; skladiste_id: string | null }>(
            `select z.obrazac_kod, z.datum, z.uneo_korisnik_id, z.skladiste_id, exists (select 1 from zapis n where n.ispravlja_id = z.id) as ispravljen
             from zapis z where z.id = $1 for update`,
            [ulaz.ispravljaId],
          )
        ).rows[0];
        if (!stari) throw new ApiGreska(404, "ZAPIS_NE_POSTOJI", "Zapis koji se ispravlja nije pronađen.");
        if (stari.obrazac_kod !== obrazac.kod) throw new ApiGreska(400, "ISPRAVKA_DRUGI_OBRAZAC", "Ispravka mora biti istog obrasca kao zapis koji ispravlja.");
        if (stari.ispravljen) throw new ApiGreska(409, "ZAPIS_VEC_ISPRAVLJEN", "Ovaj zapis je već ispravljen — ispravlja se posljednja verzija.");
        if (samoMoje(korisnik.uloga) && stari.uneo_korisnik_id !== korisnik.id) {
          throw new ApiGreska(403, "NIJE_VAS_ZAPIS", "Ispravlja se samo svoj zapis — tuđi ispravlja odgovorno lice.");
        }
        // Ispravka nosi datum zapisa koji ispravlja — to je isti dan rada, drugačije upisan.
        datum = stari.datum;
        // …i isti magacin: ispravka je isti rad, ne nov zapis u drugom magacinu.
        if (!ulaz.skladisteId && stari.skladiste_id) skladisteId = stari.skladiste_id;
        lanacImaNc = (
          await klijent.query<{ ima: boolean }>(
            `with recursive lanac as (
               select id, ispravlja_id from zapis where id = $1
               union all select z.id, z.ispravlja_id from zapis z join lanac on z.id = lanac.ispravlja_id
             )
             select exists (select 1 from neusaglasenost n where n.izvor_tip = 'zapis' and n.izvor_id in (select id from lanac)) as ima`,
            [ulaz.ispravljaId],
          )
        ).rows[0].ima;
      }
      provjeriProzorUpisa(korisnik.uloga, datum);
      let id: string;
      try {
        id = (
          await klijent.query<{ id: string }>(
            `insert into zapis (obrazac_kod, datum, podaci, odstupanje, korektivna_mjera, izvrsilac, uneo_korisnik_id, ispravlja_id, skladiste_id, van_mreze)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
            [obrazac.kod, datum, JSON.stringify(podaci), odstupanje, odstupanje ? ulaz.korektivnaMjera!.trim() : ulaz.korektivnaMjera?.trim() || null, izvrsilac, korisnik.id, ulaz.ispravljaId ?? null, skladisteId, vrijemeVanMreze() !== null],
          )
        ).rows[0].id;
      } catch (e) {
        if ((e as { code?: string }).code === "23505") throw new ApiGreska(409, "ZAPIS_VEC_ISPRAVLJEN", "Ovaj zapis je upravo ispravljen — osvježite listu i ispravite posljednju verziju.");
        throw e;
      }
      await logKreiranje(klijent, {
        korisnikId: korisnik.id,
        entitetTip: "zapis",
        entitetId: id,
        noveVrijednosti: { obrazacKod: obrazac.kod, datum, odstupanje, odstupanja, ispravlja: ulaz.ispravljaId ?? null },
      });
      // Neusaglašenost otvara odstupanje koje još nema svoju — i kad ga tek ispravka unese (R-07).
      // Ispravka istog odstupanja ne otvara drugu.
      const nc = odstupanje && !lanacImaNc
        ? await neusaglasenostIzZapisa(klijent, { zapisId: id, obrazacKod: obrazac.kod, datum, korektivnaMjera: ulaz.korektivnaMjera!, korisnikId: korisnik.id, odstupanja })
        : null;
      return { id, odstupanje, odstupanja, neusaglasenost: nc?.broj ?? null };
    });
    response.status(201).json(rezultat);
  }),
);
