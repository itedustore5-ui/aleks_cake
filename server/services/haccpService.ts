import { transakcija, upit } from "../db.js";
import { ApiGreska } from "../greske.js";
import { logKreiranje, logPromjenaStatusa } from "./auditService.js";
import { kreirajZadatak, obavijestiUlogu } from "./zadaciService.js";
import { sljedeciBrojNc } from "./brojeviService.js";
import { javiIsporukeSaLotom } from "./lotBlokadaService.js";
import { skladisteUnosa } from "./skladisteService.js";
import { vrijemeVanMreze } from "../vanMreze.js";

export type RezultatMjerenja = "PASS" | "FAIL" | "WARNING";

export type PraviloKontrole = {
  id: string;
  min_vrijednost: string | null;
  max_vrijednost: string | null;
};

const TOLERANCIJA = 0.5; // °C blizu granice → upozorenje umjesto prolaza bez traga

/** Centralni decision-engine za HACCP mjerenja. Limiti dolaze iz baze (pravilo_kontrole),
 * nikad iz koda — konsultant ih mijenja kroz podešavanje artikla/kontrolne tačke. */
export function evaluirajPravilo(pravilo: Pick<PraviloKontrole, "min_vrijednost" | "max_vrijednost">, vrijednost: number): RezultatMjerenja {
  const min = pravilo.min_vrijednost === null ? null : Number(pravilo.min_vrijednost);
  const max = pravilo.max_vrijednost === null ? null : Number(pravilo.max_vrijednost);
  if (min !== null && vrijednost < min) return "FAIL";
  if (max !== null && vrijednost > max) return "FAIL";
  if (min !== null && vrijednost < min + TOLERANCIJA) return "WARNING";
  if (max !== null && vrijednost > max - TOLERANCIJA) return "WARNING";
  return "PASS";
}

/** Pravilo po kom se ocjenjuje mjerenje na tački: pravilo ARTIKLA lota, pa opšte pravilo tačke —
 * isto na prijemu, u magacinu i pri predaji (nalaz R-09: ručno mjerenje je uzimalo posljednje
 * pravilo tačke, bez obzira na artikal, pa je lot mogao biti ocijenjen po granici drugog artikla). */
export async function praviloZaMjerenje(kontrolnaTackaId: string, lotId?: string | null) {
  let artikalId: string | null = null;
  if (lotId) {
    const lot = (await upit<{ artikal_id: string }>(`select artikal_id from lot where id = $1`, [lotId])).rows[0];
    if (!lot) throw new ApiGreska(404, "LOT_NE_POSTOJI", "Lot nije pronađen.");
    artikalId = lot.artikal_id;
  }
  const r = await upit<PraviloKontrole>(
    `select id, min_vrijednost, max_vrijednost from pravilo_kontrole
     where kontrolna_tacka_id = $1 and aktivan and (artikal_id = $2 or artikal_id is null)
     order by artikal_id nulls last, created_at desc limit 1`,
    [kontrolnaTackaId, artikalId],
  );
  return r.rows[0] ?? null;
}

/** Termometar kojim je mjereno (nalaz R-23): mora biti u upotrebi i ne smije biti pao na posljednjoj
 * provjeri — mjerenje neispravnim termometrom ne dokazuje ništa. */
export async function provjeriTermometar(uredjajId: string | null | undefined) {
  if (!uredjajId) return null;
  const u = (
    await upit<{ naziv: string; oznaka: string | null; aktivan: boolean; posljednji: string | null }>(
      `select u.naziv, u.oznaka, u.aktivan,
              (select p.rezultat from provjera_uredjaja p where p.uredjaj_id = u.id order by p.datum desc, p.created_at desc limit 1) as posljednji
       from mjerni_uredjaj u where u.id = $1`,
      [uredjajId],
    )
  ).rows[0];
  if (!u || !u.aktivan) throw new ApiGreska(404, "UREDJAJ_NE_POSTOJI", "Izabrani termometar ne postoji ili više nije u upotrebi.");
  if (u.posljednji === "NEISPRAVAN") {
    throw new ApiGreska(409, "UREDJAJ_NEISPRAVAN", `${u.naziv}${u.oznaka ? ` (${u.oznaka})` : ""} nije prošao posljednju provjeru — mjerite drugim termometrom.`);
  }
  return uredjajId;
}

type NoviMjerenjeInput = {
  kontrolnaTackaId: string;
  praviloKontroleId: string | null;
  lotId?: string | null;
  vozilId?: string | null;
  vrijednost: number;
  izmjerioKorisnikId: string;
  napomena?: string;
  /** Termometar (R-23) — provjeren sa provjeriTermometar prije poziva. */
  mjerniUredjajId?: string | null;
  /** false kad je lot samo trag (npr. KKT 3 pri predaji) — roba u magacinu nije bila u vozilu. */
  holdLota?: boolean;
  /** Magacin u kom je izmjereno (#77). Nije zadat → magacin lota, matični magacin naloga ili jedini. */
  skladisteId?: string | null;
};

/** Mjerenje + posljedice ako je FAIL: NC, zadatak, obavještenje bzr-u, i HOLD na LOT-u gdje
 * je primjenjivo. Sve u jednoj transakciji — ili sve ili ništa. */
export async function zabiljeziMjerenje(pravilo: Pick<PraviloKontrole, "min_vrijednost" | "max_vrijednost">, ulaz: NoviMjerenjeInput) {
  const ocjena = evaluirajPravilo(pravilo, ulaz.vrijednost);

  // Invarijanta #5 na JEDNOM mjestu za sve KKT-ove (nalaz H4): mjerenje vezano za lot čiji artikal
  // nema potvrđenu granicu se ne ocjenjuje automatski — nepotvrđena granica je pretpostavka
  // konsultanta i po njoj se ne zadržava roba. Očitavanje van nje se upisuje kao upozorenje i
  // odgovorno lice dobija obavještenje da odluči samo.
  const artikal = ulaz.lotId
    ? (await upit<{ naziv: string; temp_kontrolisano: boolean; granica_potvrdio: boolean }>(
        `select a.naziv, a.temp_kontrolisano, a.granica_potvrdio from lot l join artikal a on a.id = l.artikal_id where l.id = $1`,
        [ulaz.lotId],
      )).rows[0]
    : undefined;
  const nepotvrdjena = !!artikal && artikal.temp_kontrolisano && !artikal.granica_potvrdio;
  const rezultat: RezultatMjerenja = nepotvrdjena && ocjena === "FAIL" ? "WARNING" : ocjena;
  const napomena = nepotvrdjena && ocjena === "FAIL" ? [ulaz.napomena, "van nepotvrđene granice — ne ocjenjuje se automatski"].filter(Boolean).join("; ") : ulaz.napomena;

  return transakcija(async (klijent) => {
    const skladisteId =
      ulaz.skladisteId !== undefined ? ulaz.skladisteId : await skladisteUnosa(klijent, { lotId: ulaz.lotId, korisnikId: ulaz.izmjerioKorisnikId });
    const mjerenje = await klijent.query<{ id: string }>(
      // Bez mreže (#85): izmjereno je u vrijeme sa telefona, uz oznaku — i na KKT 3 pri predaji.
      `insert into mjerenje_temperature (kontrolna_tacka_id, pravilo_kontrole_id, lot_id, vozilo_id, vrijednost, izmjereno_at, izmjerio_korisnik_id, rezultat, napomena, mjerni_uredjaj_id, skladiste_id, van_mreze)
       values ($1, $2, $3, $4, $5, coalesce($11::timestamptz, now()), $6, $7, $8, $9, $10, $11::timestamptz is not null) returning id`,
      [ulaz.kontrolnaTackaId, ulaz.praviloKontroleId, ulaz.lotId ?? null, ulaz.vozilId ?? null, ulaz.vrijednost, ulaz.izmjerioKorisnikId, rezultat, napomena ?? null, ulaz.mjerniUredjajId ?? null, skladisteId, vrijemeVanMreze()],
    );
    const mjerenjeId = mjerenje.rows[0].id;
    if (nepotvrdjena && ocjena === "FAIL") {
      await obavijestiUlogu(klijent, "bzr", {
        naslov: `Temperatura van NEPOTVRĐENE granice — ${artikal!.naziv}`,
        poruka: `${ulaz.vrijednost} °C${ulaz.napomena ? ` (${ulaz.napomena})` : ""}. Granica artikla nije potvrđena, pa roba nije automatski zadržana — odlučite vi, i potvrdite granicu u Šifarnicima.`,
        ozbiljnost: "SREDNJI",
        izvorTip: "lot",
        izvorId: ulaz.lotId!,
      });
    }

    await logKreiranje(klijent, {
      korisnikId: ulaz.izmjerioKorisnikId,
      entitetTip: "mjerenje_temperature",
      entitetId: mjerenjeId,
      noveVrijednosti: { vrijednost: ulaz.vrijednost, rezultat, mjerniUredjajId: ulaz.mjerniUredjajId ?? null },
    });

    let neusaglasenostId: string | null = null;
    if (rezultat === "FAIL") {
      const broj = await sljedeciBrojNc(klijent);
      const nc = await klijent.query<{ id: string }>(
        `insert into neusaglasenost (broj, ozbiljnost, status, izvor_tip, izvor_id, opis, prijavio_korisnik_id, van_mreze)
         values ($1, 'VISOK', 'OTVORENA', 'mjerenje_temperature', $2, $3, $4, $5) returning id`,
        [broj, mjerenjeId, `Mjerenje van opsega: ${ulaz.vrijednost}°C.${ulaz.napomena ? ` ${ulaz.napomena}.` : ""}`, ulaz.izmjerioKorisnikId, vrijemeVanMreze() !== null],
      );
      neusaglasenostId = nc.rows[0].id;

      await kreirajZadatak(klijent, {
        naslov: `Riješi neusaglašenost ${broj}`,
        opis: `Temperaturno mjerenje van opsega (${ulaz.vrijednost}°C).${ulaz.napomena ? ` ${ulaz.napomena}.` : ""}`,
        prioritet: "VISOK",
        izvorTip: "neusaglasenost",
        izvorId: neusaglasenostId,
      });
      // Važno za upravu: vidi i direktor, ne samo odgovorno lice.
      for (const uloga of ["bzr", "uprava"]) await obavijestiUlogu(klijent, uloga, {
        naslov: "Temperatura van opsega",
        poruka: `${ulaz.vrijednost}°C — otvorena neusaglašenost ${broj}.`,
        ozbiljnost: "VISOK",
        izvorTip: "neusaglasenost",
        izvorId: neusaglasenostId,
      });

      if (ulaz.lotId && ulaz.holdLota !== false) {
        await klijent.query(`update lot set status = 'HOLD', updated_at = now() where id = $1`, [ulaz.lotId]);
        // Slobodna zaliha prelazi u karantin; ako karantin već postoji, sabira se (jedan red po statusu).
        await klijent.query(
          `insert into zaliha (lot_id, artikal_id, kolicina, status)
           select lot_id, artikal_id, kolicina, 'KARANTIN' from zaliha where lot_id = $1 and status = 'DOSTUPNO' and kolicina > 0
           on conflict (lot_id, status) do update set kolicina = zaliha.kolicina + excluded.kolicina, updated_at = now()`,
          [ulaz.lotId],
        );
        await klijent.query(`update zaliha set kolicina = 0, updated_at = now() where lot_id = $1 and status = 'DOSTUPNO'`, [ulaz.lotId]);
        await klijent.query(
          `insert into kretanje_zalihe (lot_id, artikal_id, kolicina_delta, tip, referenca_tip, referenca_id, izvrsio_korisnik_id, napomena)
           select $1, artikal_id, 0, 'HOLD', 'neusaglasenost', $2, $3, 'Automatski HOLD zbog neuspješnog mjerenja' from lot where id = $1`,
          [ulaz.lotId, neusaglasenostId, ulaz.izmjerioKorisnikId],
        );
        await logPromjenaStatusa(klijent, {
          korisnikId: ulaz.izmjerioKorisnikId,
          entitetTip: "lot",
          entitetId: ulaz.lotId,
          noveVrijednosti: { status: "HOLD", razlog: "temperatura_van_opsega" },
        });
        await javiIsporukeSaLotom(klijent, ulaz.lotId, `Temperatura van granice (${ulaz.vrijednost} °C) — lot je zadržan`, ulaz.izmjerioKorisnikId);
      }
    }

    return { mjerenjeId, rezultat, neusaglasenostId };
  });
}
