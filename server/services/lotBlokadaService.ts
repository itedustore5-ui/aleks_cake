import type { PoolClient } from "pg";
import { kreirajObavjestenje } from "./zadaciService.js";

// Kad sastojak bude zadržan (povlačenje, temperatura van granice), torta koja još nije predata, a sadrži
// ga, ne smije kupcu — predaju ionako odbija server (`SASTOJAK_ZADRZAN`, porudzbinaService); ovo javlja onome
// ko je upisao porudžbinu i vlasnici (odgovornom licu), dok se torta još može napraviti od druge serije.
// (Distributerske „Ne predajte lot“ za isporuke i manjak rezervacije su uklonjeni sa isporukama — PLAN.md 8.3.)
export async function javiPorudzbineSaLotom(klijent: PoolClient, lotId: string, razlog: string, pokrenuoKorisnikId: string) {
  const porudzbine = await klijent.query<{ id: string; broj: string; kupac_ime: string; dan: string; uneo_korisnik_id: string; sastojak: string }>(
    `select p.id, p.broj, p.kupac_ime, to_char(p.preuzimanje_at at time zone 'Europe/Podgorica', 'DD.MM. HH24:MI') as dan, p.uneo_korisnik_id,
            a.naziv || ' (lot ' || l.broj_lota || ')' as sastojak
     from porudzbina p join porudzbina_lot pl on pl.porudzbina_id = p.id join lot l on l.id = pl.lot_id join artikal a on a.id = l.artikal_id
     where pl.lot_id = $1 and p.status in ('PRIMLJENA', 'U_IZRADI')`,
    [lotId],
  );
  if (porudzbine.rows.length === 0) return 0;
  const vodstvo = (await klijent.query<{ id: string }>(`select id from korisnik where uloga = 'bzr' and aktivan`)).rows.map((r) => r.id);
  for (const p of porudzbine.rows) {
    for (const korisnikId of new Set([p.uneo_korisnik_id, ...vodstvo].filter((x) => x !== pokrenuoKorisnikId))) {
      await kreirajObavjestenje(klijent, {
        korisnikId,
        naslov: `Ne predajte tortu ${p.broj} — ${p.kupac_ime}`,
        poruka: `${razlog}. U torti je ${p.sastojak} (preuzimanje ${p.dan}). Napravite je od druge serije i zamijenite lot u porudžbini, ili javite kupcu.`,
        ozbiljnost: "VISOK",
        izvorTip: "porudzbina",
        izvorId: p.id,
      });
    }
  }
  return porudzbine.rows.length;
}
