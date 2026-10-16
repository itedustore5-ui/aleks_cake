import type { PoolClient } from "pg";
import { transakcija } from "../db.js";
import { ApiGreska } from "../greske.js";
import { logKreiranje, logPromjenaStatusa } from "./auditService.js";
import { kreirajZadatak, obavijestiUlogu } from "./zadaciService.js";
import { sljedeciBrojNc } from "./brojeviService.js";
import { vrijemeVanMreze } from "../vanMreze.js";

export type NovaKontrolaVozilaUlaz = {
  vozilId: string;
  cistoca: boolean;
  temperatura?: number | null;
  opremaOk: boolean;
  vrataOk: boolean;
  napomena?: string;
};

/** Današnji dan po Podgorici (invarijanta #11) — „spremno" važi samo za dan u kom je D1 urađena. */
export const D1_DANAS = `(kv.izvrseno_at at time zone 'Europe/Podgorica')::date = (now() at time zone 'Europe/Podgorica')::date`;

/** Granica rashladnog vozila je obavezna i smislena — bez nje D1 ne može ocijeniti temperaturu. */
export function provjeriGranicuVozila(v: { tempKontrolisano: boolean; tempMin?: number | null; tempMax?: number | null }) {
  if (!v.tempKontrolisano) return;
  if (v.tempMin == null || v.tempMax == null) {
    throw new ApiGreska(400, "GRANICA_VOZILA_OBAVEZNA", "Za rashladno vozilo upišite temperaturni režim (od–do °C) — po njemu se ocjenjuje kontrola prije utovara.");
  }
  if (v.tempMin >= v.tempMax) throw new ApiGreska(400, "GRANICA_VOZILA", "Donja granica mora biti manja od gornje.");
}

/** D1 — kontrola vozila prije utovara (nalaz R-05). Prolazi samo ako su čistoća, oprema i vrata u
 * redu I, za rashladno vozilo, temperatura u granici vozila. Granica po kojoj je ocijenjeno se
 * upisuje uz kontrolu (vozilu se granica kasnije može promijeniti). */
export async function zabiljeziKontroluVozila(ulaz: NovaKontrolaVozilaUlaz, korisnikId: string) {
  return transakcija(async (klijent) => {
    const v = (
      await klijent.query<{ registarski_broj: string; status: string; aktivan: boolean; temp_kontrolisano: boolean; temp_min: string | null; temp_max: string | null }>(
        `select registarski_broj, status, aktivan, temp_kontrolisano, temp_min, temp_max from vozilo where id = $1 for update`,
        [ulaz.vozilId],
      )
    ).rows[0];
    if (!v) throw new ApiGreska(404, "VOZILO_NE_POSTOJI", "Vozilo nije pronađeno.");
    if (!v.aktivan) throw new ApiGreska(409, "VOZILO_NEAKTIVNO", "Vozilo je isključeno iz upotrebe.");
    const temperatura = ulaz.temperatura ?? null;
    if (v.temp_kontrolisano && temperatura === null) {
      throw new ApiGreska(400, "TEMPERATURA_OBAVEZNA", `Upišite temperaturu tovarnog prostora — ${v.registarski_broj} je rashladno vozilo.`);
    }
    const min = v.temp_min === null ? null : Number(v.temp_min);
    const max = v.temp_max === null ? null : Number(v.temp_max);
    const ocjenjuje = v.temp_kontrolisano && temperatura !== null && (min !== null || max !== null);
    const temperaturaOk = ocjenjuje ? (min === null || temperatura! >= min) && (max === null || temperatura! <= max) : null;

    const pali = [
      !ulaz.cistoca && "čistoća",
      !ulaz.opremaOk && "oprema",
      !ulaz.vrataOk && "vrata/brtve",
      temperaturaOk === false && `temperatura ${temperatura} °C (granica ${min ?? "—"}–${max ?? "—"} °C)`,
    ].filter(Boolean) as string[];
    const prosao = pali.length === 0;
    const ukupanStatus = prosao ? "PROSAO" : "NIJE_PROSAO";

    const kontrola = await klijent.query<{ id: string }>(
      // Bez mreže (#85): vrijeme kontrole je vrijeme sa telefona, uz oznaku; inače vrijeme servera.
      `insert into kontrola_vozila (vozilo_id, izvrsio_korisnik_id, cistoca, temperatura, oprema_ok, vrata_ok, ukupan_status, napomena, granica_min, granica_max, temperatura_ok, izvrseno_at, van_mreze)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, coalesce($12::timestamptz, now()), $12::timestamptz is not null) returning id`,
      [ulaz.vozilId, korisnikId, ulaz.cistoca, temperatura, ulaz.opremaOk, ulaz.vrataOk, ukupanStatus, ulaz.napomena?.trim() || null, min, max, temperaturaOk, vrijemeVanMreze()],
    );
    const kontrolaId = kontrola.rows[0].id;

    // Status vozila mijenja samo NAJNOVIJA kontrola: D1 koja je čekala na telefonu (#85) i stigla posle
    // novije ne vraća vozilo u staro stanje (npr. jučerašnja „prošla“ preko današnje pale).
    const najnovija = (
      await klijent.query<{ da: boolean }>(
        `select not exists (select 1 from kontrola_vozila where vozilo_id = $1 and id <> $2 and izvrseno_at > (select izvrseno_at from kontrola_vozila where id = $2)) as da`,
        [ulaz.vozilId, kontrolaId],
      )
    ).rows[0].da;
    const noviStatusVozila = najnovija ? (prosao ? "SPREMNO" : "NIJE_SPREMNO") : v.status;
    if (najnovija) await klijent.query(`update vozilo set status = $1 where id = $2`, [noviStatusVozila, ulaz.vozilId]);

    await logKreiranje(klijent, {
      korisnikId,
      entitetTip: "kontrola_vozila",
      entitetId: kontrolaId,
      noveVrijednosti: { voziloId: ulaz.vozilId, ukupanStatus, temperatura, granica: ocjenjuje ? `${min ?? "—"}–${max ?? "—"}` : null, nijeURedu: pali },
    });
    if (v.status !== noviStatusVozila) {
      await logPromjenaStatusa(klijent, { korisnikId, entitetTip: "vozilo", entitetId: ulaz.vozilId, stareVrijednosti: { status: v.status }, noveVrijednosti: { status: noviStatusVozila, kontrolaId } });
    }

    let neusaglasenostId: string | null = null;
    if (!prosao) neusaglasenostId = await neusaglasenostVozila(klijent, { kontrolaId, registarskiBroj: v.registarski_broj, pali, napomena: ulaz.napomena, korisnikId, temperaturno: temperaturaOk === false });

    return { kontrolaId, ukupanStatus, neusaglasenostId, temperaturaOk, nijeURedu: pali };
  });
}

async function neusaglasenostVozila(
  klijent: PoolClient,
  u: { kontrolaId: string; registarskiBroj: string; pali: string[]; napomena?: string; korisnikId: string; temperaturno: boolean },
) {
  const broj = await sljedeciBrojNc(klijent);
  const opis = `Vozilo ${u.registarskiBroj} nije prošlo kontrolu prije utovara — nije u redu: ${u.pali.join(", ")}.${u.napomena?.trim() ? ` ${u.napomena.trim()}` : ""}`;
  // Hladni lanac je visoka ozbiljnost — roba u tom vozilu bi se kvarila na putu.
  const ozbiljnost = u.temperaturno ? "VISOK" : "SREDNJI";
  const nc = await klijent.query<{ id: string }>(
    `insert into neusaglasenost (broj, ozbiljnost, status, izvor_tip, izvor_id, opis, prijavio_korisnik_id, van_mreze)
     values ($1, $2, 'OTVORENA', 'kontrola_vozila', $3, $4, $5, $6) returning id`,
    [broj, ozbiljnost, u.kontrolaId, opis, u.korisnikId, vrijemeVanMreze() !== null],
  );
  const id = nc.rows[0].id;
  await logKreiranje(klijent, { korisnikId: u.korisnikId, entitetTip: "neusaglasenost", entitetId: id, noveVrijednosti: { broj, izvor: "kontrola_vozila", kontrolaId: u.kontrolaId } });
  await kreirajZadatak(klijent, {
    naslov: `Dovesti vozilo ${u.registarskiBroj} u red prije naredne isporuke — ${broj}`,
    opis: `${opis} Zatvara se tek kad nova kontrola (D1) prođe.`,
    prioritet: ozbiljnost,
    izvorTip: "neusaglasenost",
    izvorId: id,
  });
  // Važno za upravu: vidi i direktor, ne samo odgovorno lice.
  for (const uloga of ["bzr", "uprava"]) {
    await obavijestiUlogu(klijent, uloga, {
      naslov: `Vozilo ${u.registarskiBroj} nije spremno`,
      poruka: `${u.pali.join(", ")} — otvorena neusaglašenost ${broj}. Isporuka tim vozilom se ne priprema dok nova kontrola ne prođe.`,
      ozbiljnost,
      izvorTip: "neusaglasenost",
      izvorId: id,
    });
  }
  return id;
}
