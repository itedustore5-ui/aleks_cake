import { pool, upit, tabelaPostoji } from "../db.js";
import { obavijestiUlogu } from "./zadaciService.js";

// Rok trajanja robe na zalihi (nalaz R-02). Rok se provjeravao samo pri prihvatanju; lot kome rok
// istekne na polici ostajao je dostupan za isporuku. Sada: isporuka ga odbija (isporukaService),
// Kontrolni centar ga broji, a odgovorno lice dobija obavještenje jednom po lotu.

const DAN = `(now() at time zone 'Europe/Podgorica')::date`;
const NA_ZALIHI = `join zaliha z on z.lot_id = l.id and z.status = 'DOSTUPNO' and z.kolicina > 0`;

/** Broj lotova na slobodnoj zalihi: istekao rok · ističe u narednih 7 dana. */
export async function brojPoRoku() {
  const r = await upit<{ istekao: number; uskoro: number }>(
    `select count(distinct l.id) filter (where l.rok_trajanja < ${DAN})::int as istekao,
            count(distinct l.id) filter (where l.rok_trajanja >= ${DAN} and l.rok_trajanja <= ${DAN} + 7)::int as uskoro
     from lot l ${NA_ZALIHI} where l.rok_trajanja is not null`,
  );
  return r.rows[0];
}

/** Lista iza broja na kartici — isti uslov kao brojanje. */
export const SQL_ROK_ROBE = `
  select a.naziv as artikal, l.broj_lota as lot, d.naziv as dobavljac, s.naziv as magacin,
         to_char(l.rok_trajanja, 'DD.MM.YYYY.') as rok, z.kolicina::text as dostupno,
         case when l.rok_trajanja < ${DAN} then 'ISTEKLA' else 'USKORO' end as stanje
  from lot l ${NA_ZALIHI}
  join artikal a on a.id = l.artikal_id join dobavljac d on d.id = l.dobavljac_id
  left join prijem p on p.id = l.prijem_id left join skladiste s on s.id = p.skladiste_id
  where l.rok_trajanja is not null and l.rok_trajanja <= ${DAN} + 7
  order by l.rok_trajanja, a.naziv`;

/** Jednom po lotu: „Istekao rok" odgovornom licu, dok je roba još na slobodnoj zalihi. */
export async function javiIstekleLotove() {
  const lotovi = await upit<{ id: string; artikal: string; broj_lota: string; rok: string; kolicina: string }>(
    `select l.id, a.naziv as artikal, l.broj_lota, to_char(l.rok_trajanja, 'DD.MM.YYYY.') as rok, z.kolicina::text as kolicina
     from lot l ${NA_ZALIHI} join artikal a on a.id = l.artikal_id
     where l.rok_trajanja < ${DAN}
       and not exists (select 1 from obavjestenje o where o.izvor_tip = 'lot' and o.izvor_id = l.id and o.naslov like 'Istekao rok%')`,
  );
  for (const l of lotovi.rows) {
    await obavijestiUlogu(pool, "bzr", {
      naslov: `Istekao rok — ${l.artikal}, lot ${l.broj_lota}`,
      poruka: `${l.kolicina} na zalihi, rok ${l.rok}. Ne isporučuje se — otpišite ili vratite dobavljaču (Zalihe).`,
      ozbiljnost: "VISOK",
      izvorTip: "lot",
      izvorId: l.id,
    });
  }
  return lotovi.rows.length;
}

/** Provjera pri pokretanju i zatim svaki sat — rok ističe u ponoć, a server radi danima. */
export function pokreniProvjeruRokova() {
  const provjeri = async () => {
    if (!(await tabelaPostoji("obavjestenje"))) return;
    await javiIstekleLotove();
  };
  setTimeout(() => provjeri().catch((e) => console.error("Provjera rokova:", (e as Error).message)), 30_000).unref();
  setInterval(() => provjeri().catch((e) => console.error("Provjera rokova:", (e as Error).message)), 60 * 60 * 1000).unref();
}
