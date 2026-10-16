import type { PoolClient } from "pg";
import { kreirajObavjestenje } from "./zadaciService.js";

// Kad lot bude zadržan (povlačenje, temperatura van granice), isporuke koje su već pripremljene sa
// tim lotom ne smiju otići kupcu (nalaz R-01). Potvrda ih ionako odbija; ovo samo javlja vozaču i
// onome ko je isporuku pripremio, prije nego što roba krene.
export async function javiIsporukeSaLotom(klijent: PoolClient, lotId: string, razlog: string, pokrenuoKorisnikId: string) {
  const isporuke = await klijent.query<{ id: string; broj: string; kupac: string; broj_lota: string; vozac_korisnik_id: string | null; uneo_korisnik_id: string | null }>(
    `select distinct i.id, i.broj, k.naziv as kupac, l.broj_lota, i.vozac_korisnik_id, i.uneo_korisnik_id
     from isporuka i
     join isporuka_stavka s on s.isporuka_id = i.id
     join lot l on l.id = s.lot_id
     join kupac k on k.id = i.kupac_id
     where s.lot_id = $1 and i.status = 'U_PRIPREMI'`,
    [lotId],
  );
  for (const i of isporuke.rows) {
    const primaoci = new Set([i.vozac_korisnik_id, i.uneo_korisnik_id].filter((x): x is string => !!x && x !== pokrenuoKorisnikId));
    for (const korisnikId of primaoci) {
      await kreirajObavjestenje(klijent, {
        korisnikId,
        naslov: `Ne predajte lot ${i.broj_lota} — isporuka ${i.broj}`,
        poruka: `${razlog}. Isporuka ${i.broj} (${i.kupac}) sadrži taj lot. Za tu stavku upišite 0 i razlog, i javite se odgovornom licu.`,
        ozbiljnost: "VISOK",
        izvorTip: "isporuka",
        izvorId: i.id,
      });
    }
  }
  return isporuke.rows.length;
}

/** Otpis (razbijeno, oštećeno) može ostaviti isporuke u pripremi bez dovoljno robe (R-14) — otpis se
 * ne odbija, jer je roba stvarno propala, ali ko je isporuku spremio i vozač saznaju odmah. */
export async function javiManjakRezervacije(klijent: PoolClient, lotId: string, pokrenuoKorisnikId: string) {
  const s = (
    await klijent.query<{ broj_lota: string; dostupno: string; rezervisano: string }>(
      `select l.broj_lota,
              coalesce((select z.kolicina from zaliha z where z.lot_id = l.id and z.status = 'DOSTUPNO'), 0) as dostupno,
              coalesce((select sum(ist.planirana_kolicina) from isporuka_stavka ist join isporuka i on i.id = ist.isporuka_id
                        where ist.lot_id = l.id and i.status = 'U_PRIPREMI'), 0) as rezervisano
       from lot l where l.id = $1`,
      [lotId],
    )
  ).rows[0];
  if (!s || Number(s.rezervisano) <= Number(s.dostupno)) return 0;
  const isporuke = await klijent.query<{ id: string; broj: string; vozac_korisnik_id: string | null; uneo_korisnik_id: string | null }>(
    `select distinct i.id, i.broj, i.vozac_korisnik_id, i.uneo_korisnik_id from isporuka i join isporuka_stavka st on st.isporuka_id = i.id
     where st.lot_id = $1 and i.status = 'U_PRIPREMI'`,
    [lotId],
  );
  for (const i of isporuke.rows) {
    for (const korisnikId of new Set([i.vozac_korisnik_id, i.uneo_korisnik_id].filter((x): x is string => !!x && x !== pokrenuoKorisnikId))) {
      await kreirajObavjestenje(klijent, {
        korisnikId,
        naslov: `Nema dovoljno robe za isporuku ${i.broj}`,
        poruka: `Lot ${s.broj_lota}: na zalihi ${Number(s.dostupno)}, za isporuke u pripremi ${Number(s.rezervisano)}. Izmijenite isporuku (količinu ili lot).`,
        ozbiljnost: "SREDNJI",
        izvorTip: "isporuka",
        izvorId: i.id,
      });
    }
  }
  return isporuke.rows.length;
}
