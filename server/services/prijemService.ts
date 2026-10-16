import type { PoolClient } from "pg";
import { transakcija, upit, pool } from "../db.js";
import { ApiGreska } from "../greske.js";
import { logKreiranje, logOdluka, logIzmjenaReda } from "./auditService.js";
import { evaluirajPravilo, zabiljeziMjerenje, provjeriTermometar } from "./haccpService.js";
import { kreirajObavjestenje, obavijestiUlogu } from "./zadaciService.js";
import { kljucArtikla } from "./otpremnicaService.js";
import { danasCG } from "../vrijeme.js";
import { odrediSkladiste } from "./skladisteService.js";
import { zauzmiKljuc, upisiRezultatKljuca } from "./kljucService.js";
import { SERIJA_LOTA } from "./sqlDijelovi.js";
import { uskladiPravilaArtikla } from "./pravilaService.js";

const KKT1_SIFRA = "KKT1";

/** Stavka kako piše na otpremnici — čuva se uz stavku (manjak, lot koji se ne slaže). */
export type PoOtpremnici = { sifra?: string | null; naziv?: string | null; kolicina?: number | null; lot?: string | null; rok?: string | null };

/** Režim novog artikla → pretpostavljena granica (NEPOTVRĐENA — samo upozorava, invarijanta #5). */
export const GRANICA_REZIMA = { rashladjeno: { min: 0, max: 4 }, smrznuto: { min: -25, max: -18 } } as const;
export type NoviArtikalUlaz = { naziv: string; jedinicaMjere: string; rezim: "rashladjeno" | "smrznuto" | "bez" };

export type StavkaUlaz = {
  /** Artikal sa spiska — ili `noviArtikal`, kad ga nema u Šifarnicima (tačno jedno od dva). */
  artikalId?: string;
  noviArtikal?: NoviArtikalUlaz;
  brojLota: string;
  proizvodniDatum?: string | null;
  rokTrajanja?: string | null;
  primljenaKolicina: number;
  temperaturaPrijema?: number | null;
  poOtpremnici?: PoOtpremnici;
};

export type NoviPrijemUlaz = {
  /** Dobavljač sa spiska — ili `noviDobavljac`, kad ga nema u Šifarnicima (tačno jedno od dva). */
  dobavljacId?: string;
  noviDobavljac?: { naziv: string; pib?: string };
  skladisteId?: string | null;
  brojDokumenta?: string;
  datumPrijema: string;
  napomena?: string;
  /** Otpremnica (PDF/slika) poslata na čitanje — veže se za ovaj prijem. */
  dokumentId?: string;
  /** Termometar kojim su izmjerene temperature prijema (R-23). */
  mjerniUredjajId?: string;
  stavke: StavkaUlaz[];
};

/** Magacioner javlja da dobavljača sa otpremnice nema u Šifarnicima (dobavljače upisuje odgovorno
 * lice, #71). Obavještenje ide svim aktivnim odgovornim licima, osim onome ko javlja. */
export async function javiNepoznatogDobavljaca(ulaz: { naziv: string; pib?: string; brojOtpremnice?: string }, korisnikId: string) {
  return transakcija(async (klijent) => {
    const ko = await klijent.query<{ ime: string }>(
      `select coalesce(l.ime, k.korisnicko_ime) as ime from korisnik k left join lice l on l.id = k.lice_id where k.id = $1`,
      [korisnikId],
    );
    const bzr = await klijent.query<{ id: string }>(`select id from korisnik where uloga = 'bzr' and aktivan and id <> $1`, [korisnikId]);
    for (const b of bzr.rows) {
      await kreirajObavjestenje(klijent, {
        korisnikId: b.id,
        naslov: `Dodajte dobavljača: ${ulaz.naziv}`,
        poruka: `${ko.rows[0]?.ime ?? "Magacioner"} prima robu${ulaz.brojOtpremnice ? ` po otpremnici ${ulaz.brojOtpremnice}` : ""} od dobavljača kog nema u Šifarnicima${
          ulaz.pib ? ` (PIB ${ulaz.pib})` : ""
        }. Upišite ga u Šifarnike → Dobavljači; magacioner zatim osvježi spisak i nastavlja prijem.`,
        ozbiljnost: "VISOK",
      });
    }
    return { javljeno: bzr.rows.length };
  });
}

/** Artikal kog nema u Šifarnicima, upisan pri prijemu (u istoj transakciji). Granica temperature je
 * PRETPOSTAVKA po režimu i nije potvrđena (invarijanta #5): mjerenje van nje samo upozorava, dok je
 * odgovorno lice ne potvrdi. Isti naziv već postoji → bira se sa spiska. */
async function upisiNoviArtikal(klijent: PoolClient, novi: NoviArtikalUlaz, korisnikId: string) {
  const naziv = novi.naziv.trim();
  const postoji = await klijent.query<{ naziv: string }>(`select naziv from artikal where lower(btrim(naziv)) = lower($1) limit 1`, [naziv]);
  if (postoji.rows[0]) {
    throw new ApiGreska(409, "ARTIKAL_POSTOJI", `Artikal „${postoji.rows[0].naziv}“ već postoji — izaberite ga sa spiska.`);
  }
  const granica = novi.rezim === "bez" ? null : GRANICA_REZIMA[novi.rezim];
  const r = await klijent.query<{ id: string }>(
    `insert into artikal (naziv, jedinica_mjere, zahtijeva_lot, temp_kontrolisano, temp_min, temp_max, granica_potvrdio, rok_obavezan)
     values ($1, $2, true, $3, $4, $5, false, true) returning id`,
    [naziv, novi.jedinicaMjere.trim() || "kom", !!granica, granica?.min ?? null, granica?.max ?? null],
  );
  const id = r.rows[0].id;
  await logKreiranje(klijent, { korisnikId, entitetTip: "artikal", entitetId: id, noveVrijednosti: { naziv, jedinicaMjere: novi.jedinicaMjere, rezim: novi.rezim, pri_prijemu: true } });
  // Granica postaje pravilo za prijem i predaju (invarijanta #39) — nepotvrđeno.
  await uskladiPravilaArtikla(klijent, id, korisnikId);
  return { id, naziv, rezim: novi.rezim };
}

/** Dobavljač kog nema u Šifarnicima, upisan pri prijemu (u istoj transakciji). Isti PIB ili isti
 * naziv već postoji → to je dupli unos: bira se sa spiska. */
async function upisiNovogDobavljaca(klijent: PoolClient, novi: { naziv: string; pib?: string }, korisnikId: string) {
  const naziv = novi.naziv.trim();
  const pib = novi.pib?.trim() || null;
  const postoji = await klijent.query<{ naziv: string; pib: string | null }>(
    `select naziv, pib from dobavljac where ($1::text is not null and btrim(pib) = $1) or lower(btrim(naziv)) = lower($2) limit 1`,
    [pib, naziv],
  );
  const d = postoji.rows[0];
  if (d) {
    throw new ApiGreska(
      409,
      pib && d.pib?.trim() === pib ? "PIB_POSTOJI" : "DOBAVLJAC_POSTOJI",
      `Dobavljač „${d.naziv}“${d.pib ? ` (PIB ${d.pib})` : ""} već postoji — izaberite ga sa spiska.`,
    );
  }
  const r = await klijent.query<{ id: string }>(`insert into dobavljac (naziv, pib) values ($1, $2) returning id`, [naziv, pib]);
  await logKreiranje(klijent, { korisnikId, entitetTip: "dobavljac", entitetId: r.rows[0].id, noveVrijednosti: { naziv, pib, pri_prijemu: true } });
  return { id: r.rows[0].id, naziv, pib };
}

export async function kreirajPrijem(ulaz: NoviPrijemUlaz, korisnikId: string, kljuc?: string) {
  if (ulaz.stavke.length === 0) {
    throw new ApiGreska(400, "PRIJEM_BEZ_STAVKI", "Prijem mora imati najmanje jednu stavku.");
  }
  for (const stavka of ulaz.stavke) {
    if (!stavka.brojLota || stavka.brojLota.trim() === "") {
      throw new ApiGreska(400, "LOT_OBAVEZAN", "Broj lota je obavezan za svaku stavku — bez njega nema sledljivosti.");
    }
  }
  // Ista serija se u jednom prijemu upisuje jednom, sa ukupnom količinom (R-17) — dva lota iste
  // serije u istom prijemu su dva reda za istu robu na polici.
  const vidjene = new Set<string>();
  for (const s of ulaz.stavke) {
    if (!s.artikalId === !s.noviArtikal) throw new ApiGreska(400, "NEVALIDAN_UNOS", "Za svaku stavku izaberite artikal sa spiska ili upišite novi.");
    const kljucSerije = `${s.artikalId ?? `novi:${s.noviArtikal!.naziv.trim().toLowerCase()}`}|${s.brojLota.trim().toUpperCase()}`;
    if (vidjene.has(kljucSerije)) {
      throw new ApiGreska(400, "SERIJA_DVAPUT", `Serija ${s.brojLota.trim()} istog artikla je upisana dvaput — upišite je jednom, sa ukupnom količinom.`);
    }
    vidjene.add(kljucSerije);
  }
  // Rok trajanja se upisuje pri prijemu (R-17) — bez njega nema FEFO-a ni blokade istekle robe.
  // Konsultant ga isključuje po artiklu, za rijetke izuzetke.
  const idjevi = ulaz.stavke.map((s) => s.artikalId).filter((id): id is string => !!id);
  const saRokom = await upit<{ id: string; naziv: string }>(`select id, naziv from artikal where rok_obavezan and id = any($1)`, [idjevi]);
  for (const s of ulaz.stavke) {
    const naziv = s.noviArtikal ? s.noviArtikal.naziv.trim() : saRokom.rows.find((r) => r.id === s.artikalId)?.naziv;
    if (naziv && !s.rokTrajanja) {
      throw new ApiGreska(400, "ROK_OBAVEZAN", `Upišite rok trajanja za „${naziv}“ (lot ${s.brojLota.trim()}) — sa etikete ili otpremnice.`);
    }
  }

  // KKT 1 se prati uz SVAKI prijem robe pod temperaturnim režimom — bez temperature nema dokaza da
  // je hladni lanac održan do magacina (isto kao KKT 3 pri predaji kupcu).
  const podRezimom = await upit<{ id: string; naziv: string }>(`select id, naziv from artikal where temp_kontrolisano and id = any($1)`, [idjevi]);
  for (const s of ulaz.stavke) {
    const naziv =
      s.noviArtikal && s.noviArtikal.rezim !== "bez" ? s.noviArtikal.naziv.trim() : podRezimom.rows.find((r) => r.id === s.artikalId)?.naziv;
    if (naziv && (s.temperaturaPrijema === null || s.temperaturaPrijema === undefined)) {
      throw new ApiGreska(400, "TEMPERATURA_OBAVEZNA", `Upišite temperaturu pri prijemu za "${naziv}" — roba je pod temperaturnim režimom (KKT 1).`);
    }
  }

  // Neispravan termometar se odbija PRIJE upisa prijema — inače bi prijem ostao bez mjerenja KKT 1.
  await provjeriTermometar(ulaz.mjerniUredjajId);
  const skladisteId = await odrediSkladiste(pool, ulaz.skladisteId, korisnikId);
  const kktRed = await upit<{ id: string }>(`select id from kontrolna_tacka where sifra = $1`, [KKT1_SIFRA]);
  const kkt1Id = kktRed.rows[0]?.id;

  if (!ulaz.dobavljacId === !ulaz.noviDobavljac) {
    throw new ApiGreska(400, "NEVALIDAN_UNOS", "Izaberite dobavljača sa spiska ili upišite novog.");
  }

  const { prijemId, lotoviZaProvjeru, upozorenja } = await transakcija(async (klijent) => {
    // Isti ključ = isti prijem (dupli klik, ponovljeno slanje): vraća se prvi, drugi se ne upisuje (R-10).
    if (kljuc) {
      const ranije = await zauzmiKljuc(klijent, korisnikId, kljuc, "prijem");
      if (ranije?.id) return { prijemId: String(ranije.id), lotoviZaProvjeru: [] as { lotId: string; artikalId: string; temperatura: number | null }[], upozorenja: [] as string[] };
    }
    const novi = ulaz.noviDobavljac ? await upisiNovogDobavljaca(klijent, ulaz.noviDobavljac, korisnikId) : null;
    const dobavljacId = novi?.id ?? ulaz.dobavljacId!;
    // Novi artikli (roba koje nema u Šifarnicima) — jednom po nazivu, i kad je u više stavki (više lotova).
    const noviArtikli = new Map<string, { id: string; naziv: string; rezim: NoviArtikalUlaz["rezim"] }>();
    for (const s of ulaz.stavke) {
      if (!s.noviArtikal) continue;
      const k = s.noviArtikal.naziv.trim().toLowerCase();
      if (!noviArtikli.has(k)) noviArtikli.set(k, await upisiNoviArtikal(klijent, s.noviArtikal, korisnikId));
    }
    const stavke = ulaz.stavke.map((s) => ({ ...s, artikalId: s.artikalId ?? noviArtikli.get(s.noviArtikal!.naziv.trim().toLowerCase())!.id }));
    const prijem = await klijent.query<{ id: string }>(
      `insert into prijem (dobavljac_id, broj_dokumenta, datum_prijema, status, primio_korisnik_id, napomena, skladiste_id)
       values ($1, $2, $3, 'CEKA_ODLUKU', $4, $5, $6) returning id`,
      [dobavljacId, ulaz.brojDokumenta ?? null, ulaz.datumPrijema, korisnikId, ulaz.napomena ?? null, skladisteId],
    );
    const prijemId = prijem.rows[0].id;
    await logKreiranje(klijent, { korisnikId, entitetTip: "prijem", entitetId: prijemId, noveVrijednosti: { dobavljacId, noviDobavljac: !!novi } });
    if (noviArtikli.size > 0) {
      const ko = await klijent.query<{ ime: string }>(
        `select coalesce(l.ime, k.korisnicko_ime) as ime from korisnik k left join lice l on l.id = k.lice_id where k.id = $1`,
        [korisnikId],
      );
      const bzrOstali = await klijent.query<{ id: string }>(`select id from korisnik where uloga = 'bzr' and aktivan and id <> $1`, [korisnikId]);
      const spisak = [...noviArtikli.values()];
      for (const b of bzrOstali.rows) {
        await kreirajObavjestenje(klijent, {
          korisnikId: b.id,
          naslov: `Nov artikal upisan pri prijemu: ${spisak.map((a) => a.naziv).join(", ")}`,
          poruka: `${ko.rows[0]?.ime ?? "Zaposleni"} je primio robu koje nije bilo u Šifarnicima. Granica temperature je pretpostavka (${spisak
            .map((a) => `${a.naziv}: ${a.rezim === "bez" ? "bez režima" : a.rezim === "rashladjeno" ? "rashlađeno 0–4 °C" : "smrznuto −25 do −18 °C"}`)
            .join("; ")}) i NIJE potvrđena — dok je ne potvrdite u Šifarnicima, mjerenje van nje samo upozorava. Provjerite i jedinicu mjere i rok.`,
          ozbiljnost: "SREDNJI",
          izvorTip: "prijem",
          izvorId: prijemId,
        });
      }
    }
    if (novi) {
      const ko = await klijent.query<{ ime: string }>(
        `select coalesce(l.ime, k.korisnicko_ime) as ime from korisnik k left join lice l on l.id = k.lice_id where k.id = $1`,
        [korisnikId],
      );
      // Ko je sam odgovorno lice, ne treba da obavještava sebe.
      const bzrOstali = await klijent.query<{ id: string }>(`select id from korisnik where uloga = 'bzr' and aktivan and id <> $1`, [korisnikId]);
      for (const b of bzrOstali.rows) {
        await kreirajObavjestenje(klijent, {
          korisnikId: b.id,
          naslov: `Nov dobavljač upisan pri prijemu: ${novi.naziv}`,
          poruka: `${ko.rows[0]?.ime ?? "Zaposleni"} je primio robu od dobavljača kog nije bilo u Šifarnicima${novi.pib ? ` (PIB ${novi.pib})` : ""}. Provjerite naziv i PIB i dopunite adresu i telefon u Šifarnicima.`,
          ozbiljnost: "SREDNJI",
          izvorTip: "prijem",
          izvorId: prijemId,
        });
      }
    }

    const lotoviZaProvjeru: { lotId: string; artikalId: string; temperatura: number | null }[] = [];

    for (const stavka of stavke) {
      const lot = await klijent.query<{ id: string }>(
        `insert into lot (artikal_id, dobavljac_id, prijem_id, broj_lota, proizvodni_datum, rok_trajanja, status, primljena_kolicina)
         values ($1, $2, $3, $4, $5, $6, 'PRIMLJEN', $7) returning id`,
        [stavka.artikalId, dobavljacId, prijemId, stavka.brojLota.trim(), stavka.proizvodniDatum ?? null, stavka.rokTrajanja ?? null, stavka.primljenaKolicina],
      );
      const lotId = lot.rows[0].id;

      await klijent.query(
        `insert into prijem_stavka (prijem_id, artikal_id, lot_id, primljena_kolicina, temperatura_prijema, po_otpremnici)
         values ($1, $2, $3, $4, $5, $6)`,
        [prijemId, stavka.artikalId, lotId, stavka.primljenaKolicina, stavka.temperaturaPrijema ?? null, stavka.poOtpremnici ? JSON.stringify(stavka.poOtpremnici) : null],
      );

      // "Njihov" artikal → naš artikal, zapamćeno za ovog dobavljača: sljedeća otpremnica se
      // prepozna sama. Pamti se ono što je čovjek potvrdio, ne ono što je aplikacija pogodila.
      const nj = stavka.poOtpremnici;
      if (nj && (nj.sifra?.trim() || nj.naziv?.trim())) {
        await klijent.query(
          `insert into artikal_dobavljaca (dobavljac_id, kljuc, sifra, naziv, artikal_id, potvrdio_korisnik_id)
           values ($1, $2, $3, $4, $5, $6)
           on conflict (dobavljac_id, kljuc) do update
             set artikal_id = excluded.artikal_id, sifra = excluded.sifra, naziv = excluded.naziv,
                 potvrdio_korisnik_id = excluded.potvrdio_korisnik_id, updated_at = now()`,
          [dobavljacId, kljucArtikla(nj.sifra, nj.naziv), nj.sifra ?? null, nj.naziv ?? null, stavka.artikalId, korisnikId],
        );
      }

      lotoviZaProvjeru.push({ lotId, artikalId: stavka.artikalId, temperatura: stavka.temperaturaPrijema ?? null });
    }

    if (ulaz.dokumentId) {
      const vezano = await klijent.query(
        `update prijem_dokument set prijem_id = $1 where id = $2 and prijem_id is null returning id`,
        [prijemId, ulaz.dokumentId],
      );
      if (!vezano.rows[0]) {
        throw new ApiGreska(409, "OTPREMNICA_VEC_VEZANA", "Ova otpremnica je već vezana za prijem ili je istekla — učitajte je ponovo.");
      }
    }

    // Serija već primljena sa DRUGIM rokom: ili greška u kucanju, ili dobavljač — odgovorno lice
    // provjerava etiketu. Ne zaustavlja prijem (roba je stigla), ali ostaje trag (R-17).
    const upozorenja: string[] = [];
    for (const s of stavke) {
      if (!s.rokTrajanja) continue;
      const drugi = await klijent.query<{ rok: string }>(
        `select distinct to_char(rok_trajanja, 'DD.MM.YYYY.') as rok from lot
         where artikal_id = $1 and dobavljac_id = $2 and upper(btrim(broj_lota)) = upper(btrim($3)) and prijem_id <> $4
           and rok_trajanja is not null and rok_trajanja <> $5::date`,
        [s.artikalId, dobavljacId, s.brojLota, prijemId, s.rokTrajanja],
      );
      if (drugi.rows.length > 0) upozorenja.push(`Serija ${s.brojLota.trim()} je ranije primljena sa rokom ${drugi.rows.map((r) => r.rok).join(", ")} — provjerite etiketu.`);
    }
    if (upozorenja.length > 0) {
      await obavijestiUlogu(klijent, "bzr", {
        naslov: "Ista serija, drugi rok — provjerite etiketu",
        poruka: upozorenja.join(" "),
        ozbiljnost: "SREDNJI",
        izvorTip: "prijem",
        izvorId: prijemId,
      });
    }

    // Roba sa isteklim rokom se upisuje (to je ono što je stiglo), ali odgovorno lice odmah saznaje
    // — i takva stavka se ne može prihvatiti (donesiOdlukuOLotu).
    const istekli = ulaz.stavke.filter((s) => s.rokTrajanja && s.rokTrajanja < ulaz.datumPrijema);
    if (istekli.length > 0) {
      await obavijestiUlogu(klijent, "bzr", {
        naslov: `Primljena roba sa isteklim rokom — ${istekli.length === 1 ? "1 stavka" : `${istekli.length} stavke`}`,
        poruka: `${istekli.map((s) => `lot ${s.brojLota.trim()} (rok ${s.rokTrajanja})`).join(", ")}. Ne može se prihvatiti — odbijte je (povrat ili uništenje).`,
        ozbiljnost: "VISOK",
        izvorTip: "prijem",
        izvorId: prijemId,
      });
    }

    if (kljuc) await upisiRezultatKljuca(klijent, korisnikId, kljuc, { id: prijemId });
    return { prijemId, lotoviZaProvjeru, upozorenja };
  });

  // HACCP provjera na KKT1 se radi poslije upisa prijema — odvojena transakcija po lotu,
  // da jedan neuspio nalaz ne obori upis cijelog prijema.
  if (kkt1Id) {
    for (const stavka of lotoviZaProvjeru) {
      if (stavka.temperatura === null) continue;
      const pravilo = await upit<{ id: string; min_vrijednost: string | null; max_vrijednost: string | null }>(
        `select id, min_vrijednost, max_vrijednost from pravilo_kontrole
         where kontrolna_tacka_id = $1 and (artikal_id = $2 or artikal_id is null) and aktivan
         order by artikal_id nulls last limit 1`,
        [kkt1Id, stavka.artikalId],
      );
      const p = pravilo.rows[0];
      if (!p) continue;
      await zabiljeziMjerenje(p, {
        kontrolnaTackaId: kkt1Id,
        praviloKontroleId: p.id,
        lotId: stavka.lotId,
        vrijednost: stavka.temperatura,
        izmjerioKorisnikId: korisnikId,
        napomena: "Izmjereno pri prijemu",
        mjerniUredjajId: ulaz.mjerniUredjajId ?? null,
      });
    }
  }

  return { prijemId, upozorenja };
}

export type StavkaIzmjenaUlaz = {
  brojLota?: string;
  proizvodniDatum?: string | null;
  rokTrajanja?: string | null;
  primljenaKolicina?: number;
  temperaturaPrijema?: number | null;
};

/** Ispravka unosa je dozvoljena SAMO dok lot čeka odluku — čim je lot PRIHVAĆEN/HOLD/ODBIJEN,
 * mijenjanje bi pokvarilo sledljivost i zalihu koja je već zavisna od unesenih brojki. */
export async function izmijeniStavku(lotId: string, ulaz: StavkaIzmjenaUlaz, korisnikId: string) {
  // Lot se zaključava: odluka o prijemu (donesiOdlukuOLotu) zaključava isti red, pa izmjena i
  // odluka ne mogu da se prepletu — ranije je stavka mogla biti izmijenjena poslije prihvatanja.
  await transakcija(async (klijent) => {
    const lotRed = await klijent.query<{ status: string }>(`select status from lot where id = $1 for update`, [lotId]);
    if (!lotRed.rows[0]) throw new ApiGreska(404, "LOT_NE_POSTOJI", "Lot nije pronađen.");
    if (lotRed.rows[0].status !== "PRIMLJEN") {
      throw new ApiGreska(409, "ODLUKA_VEC_DONESENA", "Stavka se više ne može mijenjati — odluka o prijemu je već donesena.");
    }
    if (ulaz.brojLota !== undefined && ulaz.brojLota.trim() === "") {
      throw new ApiGreska(400, "LOT_OBAVEZAN", "Broj lota je obavezan — bez njega nema sledljivosti.");
    }
    // Šta je pisalo prije izmjene — spor sa dobavljačem i inspektor traže baš to (R-06).
    const stanjeStavke = async () =>
      (
        await klijent.query<Record<string, unknown>>(
          `select l.broj_lota, l.proizvodni_datum, l.rok_trajanja, l.primljena_kolicina, ps.temperatura_prijema
           from lot l join prijem_stavka ps on ps.lot_id = l.id where l.id = $1`,
          [lotId],
        )
      ).rows[0] ?? null;
    const prije = await stanjeStavke();

    await klijent.query(
      `update lot set
         broj_lota = coalesce($1, broj_lota),
         proizvodni_datum = coalesce($2, proizvodni_datum),
         rok_trajanja = coalesce($3, rok_trajanja),
         primljena_kolicina = coalesce($4, primljena_kolicina),
         updated_at = now()
       where id = $5`,
      [ulaz.brojLota?.trim() ?? null, ulaz.proizvodniDatum ?? null, ulaz.rokTrajanja ?? null, ulaz.primljenaKolicina ?? null, lotId],
    ).catch((e) => {
      if ((e as { code?: string }).code === "23505") throw new ApiGreska(409, "SERIJA_DVAPUT", "Ta serija istog artikla već postoji u ovom prijemu — izmijenite količinu na njoj.");
      throw e;
    });
    await klijent.query(
      `update prijem_stavka set
         primljena_kolicina = coalesce($1, primljena_kolicina),
         temperatura_prijema = coalesce($2, temperatura_prijema)
       where lot_id = $3`,
      [ulaz.primljenaKolicina ?? null, ulaz.temperaturaPrijema ?? null, lotId],
    );
    await logIzmjenaReda(klijent, { korisnikId, entitetTip: "lot", entitetId: lotId, prije, poslije: await stanjeStavke() });
  });
}

export type Odluka = "PRIHVATI" | "HOLD" | "ODBIJI";

/** Magacioner koji je primio robu saznaje šta je odlučeno. Zadržavanje i odbijanje traže od
 * njega da robu fizički izdvoji, pa se javljaju odmah, po lotu. Prihvatanje se ne javlja po
 * stavci, nego jednom kad je cio prijem riješen — da deset stavki ne napravi deset poruka. */
async function obavijestiPrimaoca(
  klijent: PoolClient,
  ulaz: { prijemId: string; lotId: string; odluka: Odluka; prijemStatus: string; napomena?: string; korisnikId: string },
) {
  const red = await klijent.query<{ primio_korisnik_id: string; broj_dokumenta: string | null; broj_lota: string; artikal: string; dobavljac: string }>(
    `select p.primio_korisnik_id, p.broj_dokumenta, l.broj_lota, a.naziv as artikal, d.naziv as dobavljac
     from prijem p join lot l on l.prijem_id = p.id join artikal a on a.id = l.artikal_id join dobavljac d on d.id = p.dobavljac_id
     where p.id = $1 and l.id = $2`,
    [ulaz.prijemId, ulaz.lotId],
  );
  const r = red.rows[0];
  if (!r || r.primio_korisnik_id === ulaz.korisnikId) return;
  const prijem = r.broj_dokumenta ? `Prijem ${r.broj_dokumenta} (${r.dobavljac})` : `Prijem od ${r.dobavljac}`;
  const razlog = ulaz.napomena?.trim() ? ` Razlog: ${ulaz.napomena.trim()}` : "";

  if (ulaz.odluka === "HOLD") {
    await kreirajObavjestenje(klijent, {
      korisnikId: r.primio_korisnik_id,
      naslov: `Zadržano: ${r.artikal} · lot ${r.broj_lota}`,
      poruka: `${prijem}. Izdvojite robu i označite je — ne ide u isporuku dok se ne odluči.${razlog}`,
      ozbiljnost: "SREDNJI",
      izvorTip: "lot",
      izvorId: ulaz.lotId,
    });
  } else if (ulaz.odluka === "ODBIJI") {
    await kreirajObavjestenje(klijent, {
      korisnikId: r.primio_korisnik_id,
      naslov: `Odbijeno: ${r.artikal} · lot ${r.broj_lota}`,
      poruka: `${prijem}. Izdvojite robu za povrat dobavljaču.${razlog}`,
      ozbiljnost: "VISOK",
      izvorTip: "lot",
      izvorId: ulaz.lotId,
    });
  }

  if (ulaz.prijemStatus !== "CEKA_ODLUKU") {
    const ishod =
      ulaz.prijemStatus === "PRIHVACEN" ? "sve je prihvaćeno, roba može na policu" : ulaz.prijemStatus === "ODBIJEN" ? "sve je odbijeno" : "djelimično prihvaćeno — pogledajte stavke";
    await kreirajObavjestenje(klijent, {
      korisnikId: r.primio_korisnik_id,
      naslov: `${prijem}: odluka donesena`,
      poruka: `Odgovorno lice je odlučilo: ${ishod}.`,
      ozbiljnost: "NIZAK",
      izvorTip: "prijem",
      izvorId: ulaz.prijemId,
    });
  }
}

export async function donesiOdlukuOLotu(lotId: string, odluka: Odluka, kolicina: number, napomena: string | undefined, korisnikId: string) {
  return transakcija(async (klijent) => {
    const lotRed = await klijent.query<{ id: string; artikal_id: string; prijem_id: string; status: string; prihvacena_kolicina: string | null }>(
      `select id, artikal_id, prijem_id, status, prihvacena_kolicina from lot where id = $1 for update`,
      [lotId],
    );
    const lot = lotRed.rows[0];
    if (!lot) throw new ApiGreska(404, "LOT_NE_POSTOJI", "Lot nije pronađen.");
    // Lot na HOLD-u NIJE kraj puta (nalaz H1): pušta se ili odbija — ranije je roba zadržana zbog
    // temperature, povlačenja ili odluke "HOLD" ostajala u karantinu zauvijek.
    const odHolda = lot.status === "HOLD";
    if (odHolda && odluka === "HOLD") throw new ApiGreska(409, "VEC_NA_HOLDU", "Lot je već zadržan — pustite ga ili odbijte.");
    if (!odHolda && lot.status !== "PRIMLJEN") {
      throw new ApiGreska(409, "ODLUKA_VEC_DONESENA", "Odluka o ovom lotu je već donesena.");
    }
    if (odluka === "PRIHVATI") {
      const rok = await klijent.query<{ rok_trajanja: string | null }>(`select rok_trajanja from lot where id = $1`, [lotId]);
      const r = rok.rows[0]?.rok_trajanja;
      if (r && r < danasCG()) {
        const rokCitljiv = `${String(r).slice(0, 10).split("-").reverse().join(".")}.`;
        throw new ApiGreska(
          409,
          "ROK_ISTEKAO",
          `Rok trajanja je istekao ${rokCitljiv} — istekla roba se ne prihvata. Odbijte je (povrat dobavljaču ili uništenje). Ako je rok pogrešno ukucan, ispravite ga na stavci („Izmijeni“), pa prihvatite.`,
        );
      }
    }
    if (odluka === "ODBIJI" && (!napomena || napomena.trim() === "")) {
      throw new ApiGreska(400, "RAZLOG_OBAVEZAN", "Odbijanje robe mora imati zapisan razlog.");
    }
    if (odHolda && odluka === "PRIHVATI") {
      if (!napomena || napomena.trim().length < 3) {
        throw new ApiGreska(400, "RAZLOG_OBAVEZAN", "Upišite zašto se zadržana roba pušta (npr. ponovljeno mjerenje 3,8 °C, nalaz laboratorije).");
      }
      const povlacenje = await klijent.query(`select 1 from povlacenje where status = 'U_TOKU' and lot_id in (${SERIJA_LOTA})`, [lotId]);
      if (povlacenje.rows[0]) {
        throw new ApiGreska(409, "LOT_POD_POVLACENJEM", "Lot je pod povlačenjem u toku — ne pušta se dok se povlačenje ne zatvori.");
      }
    }

    // Koliko je robe već u karantinu (HOLD poslije prijema) — 0 kad je lot zadržan odmah pri
    // prijemu (temperatura na KKT 1), pa zaliha još nije ni nastala.
    const karantinRed = await klijent.query<{ kolicina: string }>(
      `select kolicina from zaliha where lot_id = $1 and status = 'KARANTIN' for update`,
      [lotId],
    );
    const uKarantinu = Number(karantinRed.rows[0]?.kolicina ?? 0);
    const kolicinaOdluke = odHolda && uKarantinu > 0 ? uKarantinu : kolicina;
    const razlogKretanja = napomena?.trim() || null;

    const noviStatus = odluka === "PRIHVATI" ? "PRIHVACEN" : odluka === "HOLD" ? "HOLD" : "ODBIJEN";
    // Već prihvaćen lot koji je kasnije zadržan zadržava svoju prihvaćenu količinu.
    const vecPrihvaceno = Number(lot.prihvacena_kolicina ?? 0);
    const prihvaceno = odluka === "PRIHVATI" ? (vecPrihvaceno > 0 ? vecPrihvaceno : kolicinaOdluke) : odHolda ? vecPrihvaceno : 0;
    const odbijeno = odluka === "ODBIJI" ? kolicinaOdluke : 0;
    await klijent.query(`update lot set status = $1, prihvacena_kolicina = $2, odbijena_kolicina = $3, updated_at = now() where id = $4`, [
      noviStatus,
      prihvaceno,
      odbijeno,
      lotId,
    ]);
    await klijent.query(
      `update prijem_stavka set prihvacena_kolicina = $1, odbijena_kolicina = $2, napomena = coalesce($3, napomena) where lot_id = $4`,
      [prihvaceno, odbijeno, napomena ?? null, lotId],
    );

    const kretanje = (delta: number, tip: string, opis: string | null) =>
      klijent.query(
        `insert into kretanje_zalihe (lot_id, artikal_id, kolicina_delta, tip, referenca_tip, referenca_id, izvrsio_korisnik_id, napomena)
         values ($1, $2, $3, $4, 'prijem', $5, $6, $7)`,
        [lotId, lot.artikal_id, delta, tip, lot.prijem_id, korisnikId, opis],
      );
    const uZalihu = (status: string, kol: number) =>
      klijent.query(
        `insert into zaliha (lot_id, artikal_id, kolicina, status) values ($1, $2, $3, $4)
         on conflict (lot_id, status) do update set kolicina = zaliha.kolicina + excluded.kolicina, updated_at = now()`,
        [lotId, lot.artikal_id, kol, status],
      );

    if (odluka === "PRIHVATI" && odHolda && uKarantinu > 0) {
      // Iz karantina u slobodnu zalihu — ukupna količina se ne mijenja, samo status.
      await klijent.query(`update zaliha set kolicina = 0, updated_at = now() where lot_id = $1 and status = 'KARANTIN'`, [lotId]);
      await uZalihu("DOSTUPNO", uKarantinu);
      await kretanje(0, "RELEASE", `Pušteno iz karantina: ${razlogKretanja}`);
    } else if (odluka === "PRIHVATI") {
      await uZalihu("DOSTUPNO", kolicinaOdluke);
      await kretanje(kolicinaOdluke, "PRIJEM", odHolda ? `Pušteno poslije zadržavanja pri prijemu: ${razlogKretanja}` : razlogKretanja);
    } else if (odluka === "HOLD") {
      // Roba ulazi u magacin (karantin) — to je PRIJEM u dnevniku kretanja, ranije se nije upisivao.
      await uZalihu("KARANTIN", kolicinaOdluke);
      await kretanje(kolicinaOdluke, "PRIJEM", `Primljeno u karantin (HOLD)${razlogKretanja ? `: ${razlogKretanja}` : ""}`);
    } else if (odHolda && uKarantinu > 0) {
      // Odbijeno iz karantina: roba izlazi (povrat dobavljaču ili uništenje).
      await klijent.query(`update zaliha set kolicina = 0, updated_at = now() where lot_id = $1 and status = 'KARANTIN'`, [lotId]);
      await kretanje(-uKarantinu, "OTPIS", `Odbijeno iz karantina: ${razlogKretanja}`);
    }

    await logOdluka(klijent, { korisnikId, entitetTip: "lot", entitetId: lotId, noveVrijednosti: { status: noviStatus, kolicina: kolicinaOdluke, napomena, izHolda: odHolda } });

    const preostaliRed = await klijent.query<{ status: string }>(`select status from lot where prijem_id = $1`, [lot.prijem_id]);
    const statusi = preostaliRed.rows.map((r) => r.status);
    let prijemStatus: string;
    if (statusi.some((s) => s === "PRIMLJEN")) prijemStatus = "CEKA_ODLUKU";
    else if (statusi.every((s) => s === "PRIHVACEN")) prijemStatus = "PRIHVACEN";
    else if (statusi.every((s) => s === "ODBIJEN")) prijemStatus = "ODBIJEN";
    else prijemStatus = "DJELIMICNO_PRIHVACEN";
    await klijent.query(`update prijem set status = $1, odluku_donio_korisnik_id = $2, odluka_at = now(), updated_at = now() where id = $3`, [
      prijemStatus,
      korisnikId,
      lot.prijem_id,
    ]);
    await obavijestiPrimaoca(klijent, { prijemId: lot.prijem_id, lotId, odluka, prijemStatus, napomena, korisnikId });

    return { status: noviStatus, prijemStatus };
  });
}

export { evaluirajPravilo };
