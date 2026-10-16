import { upit, transakcija } from "../db.js";
import { ApiGreska } from "../greske.js";
import type { Uloga } from "../auth.js";
import { kreirajObavjestenje } from "./zadaciService.js";
import { logKreiranje } from "./auditService.js";

// Poruke: primalac poruku dobija kao obavještenje; ko je pročitao vidi se iz obavjestenje.procitano_at.

const NAZIV_GRUPE: Record<Uloga, string> = {
  operater: "Magacioneri",
  vozac: "Vozači",
  bzr: "Odgovorno lice",
  uprava: "Uprava",
  izvodjac: "Konsultant",
};

export type Primaoci = { nacin: "svi" } | { nacin: "uloge"; uloge: Uloga[] } | { nacin: "pojedinacno"; korisnici: string[] };

export async function moguciPrimaoci(posiljalacId: string) {
  const r = await upit(
    `select k.id, coalesce(l.ime, k.korisnicko_ime) as ime, k.uloga
     from korisnik k left join lice l on l.id = k.lice_id
     where k.aktivan and k.id <> $1 order by k.uloga, 2`,
    [posiljalacId],
  );
  return r.rows;
}

export async function posaljiPoruku(ulaz: { naslov: string; tekst?: string; vazno: boolean; primaoci: Primaoci }, posiljalacId: string) {
  // Primaoci se uvijek biraju iz AKTIVNIH naloga, i nikad sam pošiljalac.
  const p = ulaz.primaoci;
  const primaoci = await upit<{ id: string; ime: string }>(
    `select k.id, coalesce(l.ime, k.korisnicko_ime) as ime
     from korisnik k left join lice l on l.id = k.lice_id
     where k.aktivan and k.id <> $1
       and ($2::text = 'svi' or ($2 = 'uloge' and k.uloga::text = any($3::text[])) or ($2 = 'pojedinacno' and k.id = any($4::uuid[])))
     order by 2`,
    [posiljalacId, p.nacin, p.nacin === "uloge" ? p.uloge : [], p.nacin === "pojedinacno" ? p.korisnici : []],
  );
  if (primaoci.rows.length === 0) {
    throw new ApiGreska(400, "NEMA_PRIMALACA", "Poruka nema kome da ode — u izabranoj grupi nema nijednog aktivnog naloga.");
  }

  const opis =
    p.nacin === "svi"
      ? "Svi zaposleni"
      : p.nacin === "uloge"
        ? p.uloge.map((u) => NAZIV_GRUPE[u]).join(", ")
        : primaoci.rows.length <= 4
          ? primaoci.rows.map((r) => r.ime).join(", ")
          : `${primaoci.rows.slice(0, 3).map((r) => r.ime).join(", ")} i još ${primaoci.rows.length - 3}`;

  const id = await transakcija(async (klijent) => {
    const red = await klijent.query<{ id: string }>(
      `insert into poruka (posiljalac_korisnik_id, naslov, tekst, vazno, primaoci_opis, broj_primalaca)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [posiljalacId, ulaz.naslov, ulaz.tekst || null, ulaz.vazno, opis, primaoci.rows.length],
    );
    const porukaId = red.rows[0].id;
    for (const primalac of primaoci.rows) {
      await kreirajObavjestenje(klijent, {
        korisnikId: primalac.id,
        naslov: ulaz.naslov,
        poruka: ulaz.tekst || undefined,
        ozbiljnost: ulaz.vazno ? "VISOK" : "NIZAK",
        izvorTip: "poruka",
        izvorId: porukaId,
      });
    }
    await logKreiranje(klijent, { korisnikId: posiljalacId, entitetTip: "poruka", entitetId: porukaId, noveVrijednosti: { naslov: ulaz.naslov, primaoci: opis, broj: primaoci.rows.length } });
    return porukaId;
  });
  return { id, brojPrimalaca: primaoci.rows.length, primaoci: opis };
}

// Vodstvo (odgovorno lice, konsultant, uprava) vidi i poruke drugih iz vodstva — da dvoje ne šalje
// različita uputstva istim ljudima. Poruke između zaposlenih vide samo pošiljalac i primaoci.
const VODSTVO: Uloga[] = ["bzr", "izvodjac", "uprava"];

/** Poslate poruke koje korisnik smije vidjeti: svoje, a vodstvo i poruke drugih iz vodstva. */
export async function poslatePoruke(korisnik: { id: string; uloga: Uloga }) {
  const r = await upit(
    `select p.id, p.naslov, p.tekst, p.vazno, p.primaoci_opis, p.broj_primalaca, p.created_at,
            coalesce(l.ime, k.korisnicko_ime) as posiljalac,
            (select count(*)::int from obavjestenje o where o.izvor_tip = 'poruka' and o.izvor_id = p.id and o.procitano_at is not null) as procitalo
     from poruka p join korisnik k on k.id = p.posiljalac_korisnik_id left join lice l on l.id = k.lice_id
     where p.posiljalac_korisnik_id = $1 or ($2::boolean and k.uloga::text = any($3::text[]))
     order by p.created_at desc limit 100`,
    [korisnik.id, VODSTVO.includes(korisnik.uloga), VODSTVO],
  );
  return r.rows;
}

/** Poruke koje je korisnik PRIMIO (svaka je njegovo obavještenje) — da na strani Poruke stoje zajedno
 * sa poslatim, po vremenu, a ne samo izmiješane sa ostalim obavještenjima (01.10.2026). */
export async function primljenePoruke(korisnikId: string) {
  const r = await upit(
    `select p.id, p.naslov, p.tekst, p.vazno, p.created_at, p.posiljalac_korisnik_id,
            coalesce(l.ime, k.korisnicko_ime) as posiljalac, k.uloga as posiljalac_uloga,
            o.id as obavjestenje_id, o.procitano_at
     from obavjestenje o join poruka p on p.id = o.izvor_id
     join korisnik k on k.id = p.posiljalac_korisnik_id left join lice l on l.id = k.lice_id
     where o.korisnik_id = $1 and o.izvor_tip = 'poruka'
     order by p.created_at desc limit 100`,
    [korisnikId],
  );
  return r.rows;
}

/** Ko je pročitao — samo pošiljalac, a za poruke vodstva i ostalo vodstvo. */
export async function primaociPoruke(porukaId: string, korisnik: { id: string; uloga: Uloga }) {
  const p = (
    await upit<{ posiljalac_korisnik_id: string; uloga: Uloga }>(
      `select p.posiljalac_korisnik_id, k.uloga from poruka p join korisnik k on k.id = p.posiljalac_korisnik_id where p.id = $1`,
      [porukaId],
    )
  ).rows[0];
  if (!p || (p.posiljalac_korisnik_id !== korisnik.id && !(VODSTVO.includes(korisnik.uloga) && VODSTVO.includes(p.uloga)))) {
    throw new ApiGreska(404, "PORUKA_NE_POSTOJI", "Poruka nije pronađena.");
  }
  const r = await upit(
    `select coalesce(l.ime, k.korisnicko_ime) as ime, k.uloga, o.procitano_at
     from obavjestenje o join korisnik k on k.id = o.korisnik_id left join lice l on l.id = k.lice_id
     where o.izvor_tip = 'poruka' and o.izvor_id = $1
     order by o.procitano_at is null, 1`,
    [porukaId],
  );
  return r.rows;
}
