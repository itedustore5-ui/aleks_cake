import type { PoolClient } from "pg";
import { transakcija, upit } from "../db.js";
import { ApiGreska } from "../greske.js";
import { logKreiranje, logPromjenaStatusa } from "./auditService.js";
import { sljedeciBrojNc } from "./brojeviService.js";
import { zatvoriZadatkeIzvora, kreirajObavjestenje, kreirajZadatak, obavijestiUlogu } from "./zadaciService.js";
import { vrijemeVanMreze } from "../vanMreze.js";

/** Prijava sa terena (ručno ili sa isporuke). Isto kao automatska NC: nedodijeljen zadatak i
 * obavještenje odgovornom licu — ranije ručna prijava nije javljala nikome, pa je magacioner
 * prijavio problem u prazno. Visoku ozbiljnost vidi i uprava. */
export async function kreirajRucnuNeusaglasenost(
  ulaz: { ozbiljnost?: string; opis: string; izvorTip?: "rucno" | "isporuka"; izvorId?: string },
  korisnikId: string,
) {
  let izvorOpis = "";
  if (ulaz.izvorTip === "isporuka") {
    if (!ulaz.izvorId) throw new ApiGreska(400, "ISPORUKA_OBAVEZNA", "Izaberite isporuku na koju se odstupanje odnosi.");
    const isp = await upit<{ broj: string; kupac: string }>(
      `select i.broj, k.naziv as kupac from isporuka i join kupac k on k.id = i.kupac_id where i.id = $1`,
      [ulaz.izvorId],
    );
    if (!isp.rows[0]) throw new ApiGreska(404, "ISPORUKA_NE_POSTOJI", "Isporuka nije pronađena.");
    izvorOpis = ` (isporuka ${isp.rows[0].broj}, ${isp.rows[0].kupac})`;
  }
  const ozbiljnost = ulaz.ozbiljnost ?? "SREDNJI";
  return transakcija(async (klijent) => {
    const broj = await sljedeciBrojNc(klijent);
    const nc = await klijent.query<{ id: string }>(
      `insert into neusaglasenost (broj, ozbiljnost, status, izvor_tip, izvor_id, opis, prijavio_korisnik_id, van_mreze)
       values ($1, $2, 'OTVORENA', $3, $4, $5, $6, $7) returning id`,
      [broj, ozbiljnost, ulaz.izvorTip ?? "rucno", ulaz.izvorId ?? null, ulaz.opis, korisnikId, vrijemeVanMreze() !== null],
    );
    const id = nc.rows[0].id;
    await logKreiranje(klijent, { korisnikId, entitetTip: "neusaglasenost", entitetId: id, noveVrijednosti: { broj, izvor: ulaz.izvorTip ?? "rucno", opis: ulaz.opis } });
    await kreirajZadatak(klijent, {
      naslov: `Riješi neusaglašenost ${broj}`,
      opis: `${ulaz.opis}${izvorOpis}`,
      prioritet: ozbiljnost === "VISOK" ? "VISOK" : "SREDNJI",
      izvorTip: "neusaglasenost",
      izvorId: id,
    });
    const obavjestenje = {
      naslov: `Prijavljena neusaglašenost ${broj}`,
      poruka: `${ulaz.opis}${izvorOpis}`,
      ozbiljnost: ozbiljnost as "NIZAK" | "SREDNJI" | "VISOK",
      izvorTip: "neusaglasenost" as const,
      izvorId: id,
    };
    await obavijestiUlogu(klijent, "bzr", obavjestenje);
    if (ozbiljnost === "VISOK") await obavijestiUlogu(klijent, "uprava", obavjestenje);
    return { id, broj };
  });
}

export async function dodajKorektivnuMjeru(
  neusaglasenostId: string,
  ulaz: { opis: string; dodijeljenoKorisnikId?: string | null; rok?: string | null },
  korisnikId: string,
) {
  if (!ulaz.opis || ulaz.opis.trim() === "") {
    throw new ApiGreska(400, "MJERA_OBAVEZNA", "Odstupanje bez zapisane mjere je nalaz protiv firme, ne protiv zaposlenog — upišite korektivnu mjeru.");
  }
  return transakcija(async (klijent) => {
    const mjera = await klijent.query<{ id: string }>(
      `insert into korektivna_mjera (neusaglasenost_id, opis, dodijeljeno_korisnik_id, rok)
       values ($1, $2, $3, $4) returning id`,
      [neusaglasenostId, ulaz.opis, ulaz.dodijeljenoKorisnikId ?? null, ulaz.rok ?? null],
    );
    await klijent.query(`update neusaglasenost set status = 'MJERA_U_TOKU', updated_at = now() where id = $1`, [neusaglasenostId]);
    await logPromjenaStatusa(klijent, { korisnikId, entitetTip: "neusaglasenost", entitetId: neusaglasenostId, noveVrijednosti: { status: "MJERA_U_TOKU" } });
    if (ulaz.dodijeljenoKorisnikId && ulaz.dodijeljenoKorisnikId !== korisnikId) {
      const nc = await klijent.query<{ broj: string }>(`select broj from neusaglasenost where id = $1`, [neusaglasenostId]);
      await kreirajObavjestenje(klijent, {
        korisnikId: ulaz.dodijeljenoKorisnikId,
        naslov: `Korektivna mjera za vas — ${nc.rows[0]?.broj ?? "neusaglašenost"}`,
        poruka: `${ulaz.opis}${ulaz.rok ? ` Rok: ${ulaz.rok}.` : ""} Kad je urađeno, označite je kao završenu na strani Neusaglašenosti.`,
        ozbiljnost: "SREDNJI",
        izvorTip: "neusaglasenost",
        izvorId: neusaglasenostId,
      });
    }
    return mjera.rows[0].id;
  });
}

/** Mjeru završava onaj kome je dodijeljena (terenske uloge SAMO svoju), uz zapis šta je urađeno —
 * taj zapis čita inspektor. Odgovorno lice dobija obavještenje da čeka njena provjera. */
export async function zavrsiKorektivnuMjeru(mjeraId: string, rezultat: string | undefined, korisnikId: string, uloga: string) {
  if (!rezultat || rezultat.trim().length < 3) {
    throw new ApiGreska(400, "REZULTAT_OBAVEZAN", "Upišite šta je urađeno — taj zapis čita inspektor.");
  }
  const postojeca = await upit<{ dodijeljeno_korisnik_id: string | null; status: string }>(
    `select dodijeljeno_korisnik_id, status from korektivna_mjera where id = $1`,
    [mjeraId],
  );
  if (!postojeca.rows[0]) throw new ApiGreska(404, "MJERA_NE_POSTOJI", "Korektivna mjera nije pronađena.");
  if (postojeca.rows[0].status === "ZAVRSENA") throw new ApiGreska(409, "MJERA_VEC_ZAVRSENA", "Ova mjera je već označena kao urađena.");
  const vodiSistem = uloga === "bzr" || uloga === "izvodjac";
  if (!vodiSistem && postojeca.rows[0].dodijeljeno_korisnik_id !== korisnikId) {
    throw new ApiGreska(403, "NIJE_VASA_MJERA", "Ova mjera nije dodijeljena vama — završava je onaj kome je dodijeljena.");
  }
  return transakcija(async (klijent) => {
    const mjera = await klijent.query<{ neusaglasenost_id: string }>(
      `update korektivna_mjera set status = 'ZAVRSENA', zavrseno_at = now(), zavrsio_korisnik_id = $1, rezultat = $2
       where id = $3 returning neusaglasenost_id`,
      [korisnikId, rezultat.trim(), mjeraId],
    );
    if (!mjera.rows[0]) throw new ApiGreska(404, "MJERA_NE_POSTOJI", "Korektivna mjera nije pronađena.");
    const neusaglasenostId = mjera.rows[0].neusaglasenost_id;
    await klijent.query(`update neusaglasenost set status = 'CEKA_VERIFIKACIJU', updated_at = now() where id = $1`, [neusaglasenostId]);
    await logPromjenaStatusa(klijent, { korisnikId, entitetTip: "neusaglasenost", entitetId: neusaglasenostId, noveVrijednosti: { status: "CEKA_VERIFIKACIJU" } });
    if (!vodiSistem) {
      const nc = await klijent.query<{ broj: string }>(`select broj from neusaglasenost where id = $1`, [neusaglasenostId]);
      await obavijestiUlogu(klijent, "bzr", {
        naslov: `Mjera urađena — ${nc.rows[0]?.broj ?? "neusaglašenost"} čeka vašu provjeru`,
        poruka: rezultat.trim(),
        ozbiljnost: "SREDNJI",
        izvorTip: "neusaglasenost",
        izvorId: neusaglasenostId,
      });
    }
    return neusaglasenostId;
  });
}

/** Neusaglašenost nastala iz KONTROLE zatvara se tek kad ponovna kontrola prođe (nalaz R-22):
 * urađena mjera bez novog mjerenja ne dokazuje da je problem otklonjen. Vraća šta još treba, ili null.
 * - mjerenje pri predaji (KKT 3) → nova D1 tog vozila, prošla;
 * - mjerenje lota koji je još u magacinu → novo mjerenje tog lota u granici (odbijen/prodat lot — ne treba);
 * - mjerenje bez lota (komora, prostor) → novo mjerenje na istoj tački u granici;
 * - D1 → nova D1 tog vozila, prošla (vozilo isključeno iz upotrebe — ne treba);
 * - termometar → nova ispravna provjera ili kalibracija (isključen iz upotrebe — ne treba). */
async function stoFaliZaZatvaranje(klijent: PoolClient, nc: { izvor_tip: string; izvor_id: string | null; created_at: string }): Promise<string | null> {
  if (!nc.izvor_id) return null;
  const vozilo = async (voziloId: string) => {
    const v = (
      await klijent.query<{ registarski_broj: string; aktivan: boolean; prosla: boolean }>(
        `select v.registarski_broj, v.aktivan,
                exists (select 1 from kontrola_vozila kv where kv.vozilo_id = v.id and kv.ukupan_status = 'PROSAO' and kv.izvrseno_at > $2) as prosla
         from vozilo v where v.id = $1`,
        [voziloId, nc.created_at],
      )
    ).rows[0];
    if (!v || !v.aktivan || v.prosla) return null;
    return `Prije zatvaranja vozilo ${v.registarski_broj} mora proći novu kontrolu (D1) — to je dokaz da je problem otklonjen.`;
  };

  if (nc.izvor_tip === "mjerenje_temperature") {
    const m = (
      await klijent.query<{ kontrolna_tacka_id: string; lot_id: string | null; vozilo_id: string | null; sifra: string; tacka: string }>(
        `select m.kontrolna_tacka_id, m.lot_id, m.vozilo_id, kt.sifra, kt.naziv as tacka
         from mjerenje_temperature m join kontrolna_tacka kt on kt.id = m.kontrolna_tacka_id where m.id = $1`,
        [nc.izvor_id],
      )
    ).rows[0];
    if (!m) return null;
    if (m.sifra === "KKT3" && m.vozilo_id) return vozilo(m.vozilo_id);
    if (m.lot_id) {
      const lot = (
        await klijent.query<{ broj_lota: string; status: string; zaliha: string; izmjereno: boolean }>(
          `select l.broj_lota, l.status,
                  coalesce((select sum(z.kolicina) from zaliha z where z.lot_id = l.id and z.status in ('DOSTUPNO', 'KARANTIN')), 0) as zaliha,
                  exists (select 1 from mjerenje_temperature n where n.lot_id = l.id and n.rezultat <> 'FAIL' and n.izmjereno_at > $2) as izmjereno
           from lot l where l.id = $1`,
          [m.lot_id, nc.created_at],
        )
      ).rows[0];
      if (!lot || lot.status === "ODBIJEN" || Number(lot.zaliha) === 0 || lot.izmjereno) return null;
      return `Prije zatvaranja izmjerite ponovo lot ${lot.broj_lota} (HACCP → Novo mjerenje) — roba je još u magacinu, a nova temperatura mora biti u granici.`;
    }
    const izmjereno = (
      await klijent.query<{ ima: boolean }>(
        `select exists (select 1 from mjerenje_temperature n where n.kontrolna_tacka_id = $1 and n.lot_id is null
                        and n.vozilo_id is not distinct from $2 and n.rezultat <> 'FAIL' and n.izmjereno_at > $3) as ima`,
        [m.kontrolna_tacka_id, m.vozilo_id, nc.created_at],
      )
    ).rows[0].ima;
    return izmjereno ? null : `Prije zatvaranja izmjerite ponovo na tački „${m.tacka}“ — nova temperatura mora biti u granici.`;
  }

  if (nc.izvor_tip === "kontrola_vozila") {
    const kv = (await klijent.query<{ vozilo_id: string }>(`select vozilo_id from kontrola_vozila where id = $1`, [nc.izvor_id])).rows[0];
    return kv ? vozilo(kv.vozilo_id) : null;
  }

  if (nc.izvor_tip === "mjerni_uredjaj") {
    const u = (
      await klijent.query<{ naziv: string; aktivan: boolean; ispravan: boolean }>(
        `select u.naziv, u.aktivan,
                exists (select 1 from provjera_uredjaja p where p.uredjaj_id = u.id and p.rezultat = 'ISPRAVAN' and p.created_at > $2) as ispravan
         from mjerni_uredjaj u where u.id = $1`,
        [nc.izvor_id, nc.created_at],
      )
    ).rows[0];
    if (!u || !u.aktivan || u.ispravan) return null;
    return `Prije zatvaranja termometar „${u.naziv}“ mora proći novu provjeru ili kalibraciju — ili ga isključite iz upotrebe (HACCP plan → Termometri).`;
  }

  // Neusaglašenost „pokrenuto povlačenje“ (čl. 28) je riješena tek kad je povlačenje završeno —
  // svi kupci obaviješteni. Zatvorena dok kupci još nisu zvani bila bi nalaz.
  if (nc.izvor_tip === "povlacenje") {
    const pv = (
      await klijent.query<{ broj: string; status: string; nezvani: string }>(
        `select p.broj, p.status,
                (select count(*) from povlacenje_kontakt k where k.povlacenje_id = p.id and not k.kontaktiran) as nezvani
         from povlacenje p where p.id = $1`,
        [nc.izvor_id],
      )
    ).rows[0];
    if (!pv || pv.status === "ZAVRSENO") return null;
    const n = Number(pv.nezvani);
    return `Prije zatvaranja povlačenje ${pv.broj} mora biti završeno${n > 0 ? ` — još ${n} ${n === 1 ? "kupac nije obaviješten" : "kupaca nije obaviješteno"}` : " — svi kupci su obaviješteni, ostaje „Završi povlačenje“"} (Sledljivost → Povlačenja).`;
  }
  return null;
}

export type StanjeProvjere = {
  /** Šta mora postojati prije zatvaranja (ponovna kontrola, R-22) — null kad ništa ne fali. */
  fali: string | null;
  /** Gdje se to radi u aplikaciji. */
  faliGdje: "/haccp" | "/vozila" | "/haccp-plan" | "/sledljivost" | null;
  /** Povlačenje iz kog je neusaglašenost — ekran ga otvara direktno. */
  povlacenjeId: string | null;
  /** Mjeru je uradio onaj ko gleda — četiri oka (#15a). Samo dok neusaglašenost čeka provjeru. */
  svojaMjera: boolean;
  /** …a u firmi nema drugog odgovornog lica: smije sam, uz obrazloženje (#41). */
  izuzetakMoguc: boolean;
  /** Ko gleda je JEDINO odgovorno lice u firmi — ako sam uradi mjeru, sam je i zatvara (uz izuzetak #41). */
  samaZatvara: boolean;
  /** Ko drugi može provjeriti. */
  drugoLice: string | null;
};

const DRUGO_ODGOVORNO_LICE = `select k.id, coalesce(l.ime, k.korisnicko_ime) as ime from korisnik k left join lice l on l.id = k.lice_id
   where k.uloga = 'bzr' and k.aktivan and k.id <> $1 order by 2`;

function gdjeSeRadi(fali: string | null, izvorTip: string): StanjeProvjere["faliGdje"] {
  if (!fali) return null;
  if (izvorTip === "povlacenje") return "/sledljivost";
  if (fali.includes("(D1)")) return "/vozila";
  return izvorTip === "mjerni_uredjaj" ? "/haccp-plan" : "/haccp";
}

/** Isto što provjeravaju `verifikuj` i `rijesiOdmah`, ali UNAPRIJED — ekran kaže šta fali i ko
 * provjerava prije nego što se išta pritisne (ranije se to saznavalo tek iz greške; proba 01.10.2026). */
export async function stanjeProvjere(neusaglasenostId: string, korisnikId: string, uloga: string): Promise<StanjeProvjere | null> {
  return transakcija(async (klijent) => {
    const nc = (
      await klijent.query<{ status: string; izvor_tip: string; izvor_id: string | null; created_at: string }>(
        `select status, izvor_tip, izvor_id, created_at from neusaglasenost where id = $1`,
        [neusaglasenostId],
      )
    ).rows[0];
    if (!nc || nc.status === "ZATVORENA") return null;
    const ceka = nc.status === "CEKA_VERIFIKACIJU";
    const zavrsio = ceka
      ? (
          await klijent.query<{ zavrsio_korisnik_id: string | null }>(
            `select zavrsio_korisnik_id from korektivna_mjera where neusaglasenost_id = $1 and status = 'ZAVRSENA' order by zavrseno_at desc limit 1`,
            [neusaglasenostId],
          )
        ).rows[0]?.zavrsio_korisnik_id
      : undefined;
    const fali = await stoFaliZaZatvaranje(klijent, nc);
    const svojaMjera = ceka && zavrsio === korisnikId;
    const drugi = (await klijent.query<{ ime: string }>(DRUGO_ODGOVORNO_LICE, [korisnikId])).rows[0];
    const samaZatvara = uloga === "bzr" && !drugi;
    return {
      fali,
      faliGdje: gdjeSeRadi(fali, nc.izvor_tip),
      povlacenjeId: nc.izvor_tip === "povlacenje" ? nc.izvor_id : null,
      svojaMjera,
      izuzetakMoguc: svojaMjera && samaZatvara,
      samaZatvara,
      drugoLice: drugi?.ime ?? null,
    };
  });
}

type UlazProvjere = { korektivnaMjeraId?: string | null; rezultat: "POTVRDJENO" | "ODBIJENO"; napomena?: string; izuzetak?: boolean };

export async function verifikuj(neusaglasenostId: string, ulaz: UlazProvjere, korisnikId: string, uloga?: string) {
  return transakcija((klijent) => verifikujU(klijent, neusaglasenostId, ulaz, korisnikId, uloga));
}

/** Provjera u transakciji pozivaoca — zove je i `rijesiOdmah` (mjera i provjera zajedno ili nikako). */
async function verifikujU(klijent: PoolClient, neusaglasenostId: string, ulaz: UlazProvjere, korisnikId: string, uloga?: string) {
  // Provjerava se samo ono što je urađeno (nalaz H2): neusaglašenost mora čekati provjeru, a
  // mjeru koju provjeravamo bira SERVER — posljednju završenu — ne pregledač. Ranije se mogla
  // zatvoriti i otvorena neusaglašenost bez ijedne mjere, a "četiri oka" su se zaobilazila
  // time što se id mjere jednostavno ne pošalje.
  const nc = await klijent.query<{ status: string; izvor_tip: string; izvor_id: string | null; created_at: string }>(
    `select status, izvor_tip, izvor_id, created_at from neusaglasenost where id = $1 for update`,
    [neusaglasenostId],
  );
  if (!nc.rows[0]) throw new ApiGreska(404, "NC_NE_POSTOJI", "Neusaglašenost nije pronađena.");
  if (nc.rows[0].status !== "CEKA_VERIFIKACIJU") {
    throw new ApiGreska(409, "NIJE_SPREMNO_ZA_PROVJERU", "Provjerava se tek kad je korektivna mjera urađena — neusaglašenost se ne zatvara bez nje.");
  }
  const mjera = await klijent.query<{ id: string; zavrsio_korisnik_id: string | null }>(
    `select id, zavrsio_korisnik_id from korektivna_mjera
     where neusaglasenost_id = $1 and status = 'ZAVRSENA' order by zavrseno_at desc limit 1`,
    [neusaglasenostId],
  );
  const zavrsena = mjera.rows[0];
  if (!zavrsena) throw new ApiGreska(409, "NEMA_URADJENE_MJERE", "Nema urađene korektivne mjere — neusaglašenost se ne zatvara bez nje.");
  if (ulaz.rezultat === "POTVRDJENO") {
    const fali = await stoFaliZaZatvaranje(klijent, nc.rows[0]);
    if (fali) throw new ApiGreska(409, "PONOVNA_KONTROLA_POTREBNA", fali);
  }
  // Četiri oka (invarijanta #15a). Izlaz za malu firmu (nalaz H7): kad u firmi NEMA drugog
  // odgovornog lica, bzr smije provjeriti i sopstvenu mjeru — ali svjesno, uz obrazloženje, sa
  // oznakom na zapisu i obavještenjem konsultantu da to pogleda pri posjeti.
  let izuzetak = false;
  if (zavrsena.zavrsio_korisnik_id === korisnikId) {
    const drugi = (await klijent.query<{ ime: string }>(DRUGO_ODGOVORNO_LICE, [korisnikId])).rows[0];
    const moguc = uloga === "bzr" && !drugi;
    if (!ulaz.izuzetak) {
      throw new ApiGreska(409, "VERIFIKACIJA_NIJE_NEZAVISNA", moguc
        ? "Mjeru ste uradili vi. U firmi nema drugog odgovornog lica — možete provjeriti sami, uz obrazloženje (zapis nosi oznaku)."
        : "Ko je završio korektivnu mjeru ne može istu i verifikovati.", { izuzetakMoguc: moguc });
    }
    if (!moguc) {
      throw new ApiGreska(409, "IZUZETAK_NIJE_DOZVOLJEN", drugi
        ? `Postoji drugo odgovorno lice (${drugi.ime}) — ono provjerava ovu mjeru.`
        : "Izuzetak od četiri oka ima samo odgovorno lice u firmi bez drugog odgovornog lica.");
    }
    if (!ulaz.napomena || ulaz.napomena.trim().length < 10) {
      throw new ApiGreska(400, "OBRAZLOZENJE_OBAVEZNO", "Upišite zašto provjeravate sami i šta ste pregledali (najmanje 10 znakova).");
    }
    izuzetak = true;
  }
  await klijent.query(
    `insert into verifikacija (neusaglasenost_id, korektivna_mjera_id, verifikovao_korisnik_id, rezultat, napomena, izuzetak_cetiri_oka)
     values ($1, $2, $3, $4, $5, $6)`,
    [neusaglasenostId, zavrsena.id, korisnikId, ulaz.rezultat, ulaz.napomena ?? null, izuzetak],
  );
  if (izuzetak) {
    const broj = (await klijent.query<{ broj: string }>(`select broj from neusaglasenost where id = $1`, [neusaglasenostId])).rows[0]?.broj;
    await obavijestiUlogu(klijent, "izvodjac", {
      naslov: `Provjera bez četiri oka — ${broj ?? "neusaglašenost"}`,
      poruka: `Odgovorno lice je samo uradilo i provjerilo mjeru (nema drugog odgovornog lica). Obrazloženje: ${ulaz.napomena!.trim()}. Pogledati pri posjeti.`,
      ozbiljnost: "SREDNJI",
      izvorTip: "neusaglasenost",
      izvorId: neusaglasenostId,
    });
  }

  const noviStatus = ulaz.rezultat === "POTVRDJENO" ? "ZATVORENA" : "PONOVO_OTVORENA";
  await klijent.query(
    `update neusaglasenost set status = $1::nc_status_t, updated_at = now(),
     zatvoreno_at = case when $1::nc_status_t = 'ZATVORENA' then now() else null end,
     zatvorio_korisnik_id = case when $1::nc_status_t = 'ZATVORENA' then $2::uuid else null end
     where id = $3`,
    [noviStatus, korisnikId, neusaglasenostId],
  );

  await logPromjenaStatusa(klijent, { korisnikId, entitetTip: "neusaglasenost", entitetId: neusaglasenostId, noveVrijednosti: { status: noviStatus, rezultat: ulaz.rezultat } });

  if (noviStatus === "ZATVORENA") {
    await zatvoriZadatkeIzvora(klijent, "neusaglasenost", neusaglasenostId);
    // Ko je prijavio problem saznaje da je riješen — inače magacioner koji je izmjerio 8 °C
    // nikad ne sazna šta je bilo dalje, i sljedeći put ne prijavi.
    const nc = await klijent.query<{ broj: string; prijavio_korisnik_id: string | null }>(
      `select broj, prijavio_korisnik_id from neusaglasenost where id = $1`,
      [neusaglasenostId],
    );
    const prijavio = nc.rows[0]?.prijavio_korisnik_id;
    if (prijavio && prijavio !== korisnikId) {
      await kreirajObavjestenje(klijent, {
        korisnikId: prijavio,
        naslov: `Neusaglašenost ${nc.rows[0].broj} je zatvorena`,
        poruka: ulaz.napomena ?? "Korektivna mjera je sprovedena i provjerena.",
        ozbiljnost: "NIZAK",
        izvorTip: "neusaglasenost",
        izvorId: neusaglasenostId,
      });
    }
  }

  return { status: noviStatus };
}

/** „Riješila sam“ — mjera upisana kao urađena i, kad može, provjerena i zatvorena: JEDNA radnja,
 * JEDNA transakcija (proba vlasnice 03.10.2026: u maloj firmi odgovorno lice samo riješi problem, a
 * zatvaranje je tražilo četiri koraka i dva prozora). Pravila ostaju ista:
 * - fali ponovna kontrola (R-22) ili završeno povlačenje → mjera je upisana, neusaglašenost čeka provjeru;
 * - u firmi postoji drugo odgovorno lice (ili radi konsultant) → četiri oka: provjerava DRUGI, dobija obavještenje;
 * - jedino odgovorno lice → zatvara samo, ali svjesno: kvačica i obrazloženje (izuzetak #41).
 * Otvorena mjera (dodijeljena nekome) se završava ovim upisom; inače nastaje nova, već urađena. */
export async function rijesiOdmah(
  neusaglasenostId: string,
  ulaz: { uradjeno: string; napomena?: string; izuzetak?: boolean },
  korisnikId: string,
  uloga: string,
): Promise<{ status: string; razlog: string | null }> {
  const uradjeno = (ulaz.uradjeno ?? "").trim();
  if (uradjeno.length < 3) throw new ApiGreska(400, "REZULTAT_OBAVEZAN", "Upišite šta je urađeno — taj zapis čita inspektor.");
  return transakcija(async (klijent) => {
    const nc = (
      await klijent.query<{ broj: string; status: string; izvor_tip: string; izvor_id: string | null; created_at: string }>(
        `select broj, status, izvor_tip, izvor_id, created_at from neusaglasenost where id = $1 for update`,
        [neusaglasenostId],
      )
    ).rows[0];
    if (!nc) throw new ApiGreska(404, "NC_NE_POSTOJI", "Neusaglašenost nije pronađena.");
    if (nc.status === "ZATVORENA") throw new ApiGreska(409, "NC_ZATVORENA", "Neusaglašenost je već zatvorena.");
    if (nc.status === "CEKA_VERIFIKACIJU") throw new ApiGreska(409, "MJERA_VEC_URADJENA", "Mjera je već urađena — ispod je samo provjera i zatvaranje.");

    const fali = await stoFaliZaZatvaranje(klijent, nc);
    const drugi = (await klijent.query<{ id: string; ime: string }>(DRUGO_ODGOVORNO_LICE, [korisnikId])).rows;
    const samaZatvara = uloga === "bzr" && drugi.length === 0;
    const napomena = (ulaz.napomena ?? "").trim();
    if (samaZatvara && !fali) {
      if (!ulaz.izuzetak) {
        throw new ApiGreska(400, "IZUZETAK_POTREBAN", "Vi ste jedino odgovorno lice, pa sami i zatvarate: označite kvačicu „zatvaram bez drugog lica“ i upišite šta ste provjerili.");
      }
      if (napomena.length < 10) {
        throw new ApiGreska(400, "OBRAZLOZENJE_OBAVEZNO", `Upišite šta ste provjerili — još ${10 - napomena.length} znakova (najmanje 10).`);
      }
    }

    // Otvorena mjera (dodijeljena nekome ili bez dodjele) se završava; inače nova, odmah urađena.
    const zavrsene = await klijent.query(
      `update korektivna_mjera set status = 'ZAVRSENA', zavrseno_at = now(), zavrsio_korisnik_id = $1, rezultat = $2
       where neusaglasenost_id = $3 and status <> 'ZAVRSENA' returning id`,
      [korisnikId, uradjeno, neusaglasenostId],
    );
    if (zavrsene.rowCount === 0) {
      await klijent.query(
        `insert into korektivna_mjera (neusaglasenost_id, opis, dodijeljeno_korisnik_id, status, zavrseno_at, zavrsio_korisnik_id, rezultat)
         values ($1, $2, $3, 'ZAVRSENA', now(), $3, $2)`,
        [neusaglasenostId, uradjeno, korisnikId],
      );
    }
    await klijent.query(`update neusaglasenost set status = 'CEKA_VERIFIKACIJU', updated_at = now() where id = $1`, [neusaglasenostId]);
    await logPromjenaStatusa(klijent, {
      korisnikId,
      entitetTip: "neusaglasenost",
      entitetId: neusaglasenostId,
      stareVrijednosti: { status: nc.status },
      noveVrijednosti: { status: "CEKA_VERIFIKACIJU", mjera: uradjeno },
    });

    if (fali) return { status: "CEKA_VERIFIKACIJU", razlog: fali };
    if (!samaZatvara) {
      // Četiri oka: provjerava drugo odgovorno lice — saznaje odmah.
      for (const d of drugi) {
        await kreirajObavjestenje(klijent, {
          korisnikId: d.id,
          naslov: `Mjera urađena — ${nc.broj} čeka vašu provjeru`,
          poruka: uradjeno,
          ozbiljnost: "SREDNJI",
          izvorTip: "neusaglasenost",
          izvorId: neusaglasenostId,
        });
      }
      return {
        status: "CEKA_VERIFIKACIJU",
        razlog: drugi.length
          ? `Mjera je upisana. Provjerava i zatvara ${drugi.map((d) => d.ime).join(" ili ")} (četiri oka) — dobija obavještenje.`
          : "Mjera je upisana. Provjerava i zatvara odgovorno lice firme (četiri oka).",
      };
    }
    const r = await verifikujU(klijent, neusaglasenostId, { rezultat: "POTVRDJENO", napomena, izuzetak: true }, korisnikId, uloga);
    return { status: r.status, razlog: null };
  });
}

/** Odstupanje upisano u dnevni obrazac (nalaz H3) ulazi u isti tok kao svaka neusaglašenost.
 * Radnik je hitnu mjeru već upisao u obrazac (bez nje se zapis ni ne snima — invarijanta #2), pa
 * neusaglašenost odmah čeka provjeru: mjera je "urađena" od strane onoga ko je upisao zapis, a
 * provjerava je DRUGO lice (četiri oka). Ranije je odstupanje ostajalo samo u listi zapisa.
 * Radi u transakciji pozivaoca — zapis i njegova neusaglašenost nastaju zajedno ili nikako. */
export async function neusaglasenostIzZapisa(
  klijent: PoolClient,
  ulaz: { zapisId: string; obrazacKod: string; datum: string; korektivnaMjera: string; korisnikId: string; odstupanja?: string[] },
) {
  const broj = await sljedeciBrojNc(klijent);
  // Iz kog odgovora je odstupanje (R-08) — „Ima li tragova štetočina? — da", ne samo „odstupanje".
  const opis = `Odstupanje u obrascu ${ulaz.obrazacKod} (${ulaz.datum})${ulaz.odstupanja?.length ? `: ${ulaz.odstupanja.join("; ")}` : ""}`;
  const nc = await klijent.query<{ id: string }>(
    `insert into neusaglasenost (broj, ozbiljnost, status, izvor_tip, izvor_id, opis, prijavio_korisnik_id, van_mreze)
     values ($1, 'SREDNJI', 'CEKA_VERIFIKACIJU', 'zapis', $2, $3, $4, $5) returning id`,
    [broj, ulaz.zapisId, opis, ulaz.korisnikId, vrijemeVanMreze() !== null],
  );
  const id = nc.rows[0].id;
  await klijent.query(
    `insert into korektivna_mjera (neusaglasenost_id, opis, dodijeljeno_korisnik_id, status, zavrseno_at, zavrsio_korisnik_id, rezultat)
     values ($1, $2, $3, 'ZAVRSENA', now(), $3, $2)`,
    [id, ulaz.korektivnaMjera.trim(), ulaz.korisnikId],
  );
  await logKreiranje(klijent, { korisnikId: ulaz.korisnikId, entitetTip: "neusaglasenost", entitetId: id, noveVrijednosti: { broj, izvor: "zapis", zapisId: ulaz.zapisId } });
  await kreirajZadatak(klijent, {
    naslov: `Provjeri odstupanje ${broj} (obrazac ${ulaz.obrazacKod})`,
    opis: `Preduzeto: ${ulaz.korektivnaMjera.trim()}`,
    prioritet: "SREDNJI",
    izvorTip: "neusaglasenost",
    izvorId: id,
  });
  await obavijestiUlogu(klijent, "bzr", {
    naslov: `Odstupanje u obrascu ${ulaz.obrazacKod} — čeka vašu provjeru`,
    poruka: `${ulaz.datum}. Preduzeto: ${ulaz.korektivnaMjera.trim()}`,
    ozbiljnost: "SREDNJI",
    izvorTip: "neusaglasenost",
    izvorId: id,
  });
  return { id, broj };
}
