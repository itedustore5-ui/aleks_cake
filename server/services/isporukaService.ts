import type { PoolClient } from "pg";
import { transakcija, upit, pool } from "../db.js";
import { ApiGreska } from "../greske.js";
import { logKreiranje, logIzmjenaReda, logPromjenaStatusa } from "./auditService.js";
import { kreirajObavjestenje, obavijestiUlogu } from "./zadaciService.js";
import { zauzmiKljuc, upisiRezultatKljuca } from "./kljucService.js";
import { NA_TERENU, ogranicenjeDatuma, type Uloga } from "../auth.js";
import { IME } from "./sqlDijelovi.js";
import { zabiljeziMjerenje, provjeriTermometar } from "./haccpService.js";
import { odrediSkladiste } from "./skladisteService.js";
import { vrijemeVanMreze } from "../vanMreze.js";
import { sljedeciBroj, danasKratko } from "./brojeviService.js";

export type StavkaIsporukeUlaz = { lotId: string; planiranaKolicina: number };
type Korisnik = { id: string; uloga: Uloga };

/** Magacioner i vozač rade samo sa svojim isporukama: onom koju su sami unijeli ili koja im je
 * dodijeljena (nalaz R-04). Vodstvo — sa svima. */
function provjeriSvojuIsporuku(korisnik: Korisnik, red: { uneo_korisnik_id: string | null; vozac_korisnik_id: string | null }) {
  if (!NA_TERENU.includes(korisnik.uloga)) return;
  if (red.uneo_korisnik_id !== korisnik.id && red.vozac_korisnik_id !== korisnik.id) {
    throw new ApiGreska(403, "NIJE_VASA_ISPORUKA", "Ova isporuka nije vaša — radi je onaj ko ju je pripremio ili vozač kome je dodijeljena.");
  }
}
export type NovaIsporukaUlaz = {
  kupacId: string;
  skladisteId?: string | null;
  vozilId?: string | null;
  vozacKorisnikId?: string | null;
  datumIsporuke: string;
  napomena?: string;
  stavke: StavkaIsporukeUlaz[];
};

/** Vozač saznaje i kad mu isporuka ODE (prebačena drugom vozaču ili bez vozača) i kad se promijeni
 * dok je njegova (datum, vozilo, kupac, roba) — ranije je dobijao samo „Nova isporuka za vas“, pa je
 * spremao robu za isporuku koja više nije njegova (01.10.2026). Ko je sam izmijenio — ne obavještava se. */
async function javiVozacuIzmjenu(
  klijent: PoolClient,
  isporukaId: string,
  u: { prethodniVozac: string | null; noviVozac: string | null; korisnikId: string; prije: Record<string, unknown>; poslije: Record<string, unknown> },
) {
  const i = (
    await klijent.query<{ broj: string; kupac: string; datum: string; vozilo: string | null }>(
      `select i.broj, k.naziv as kupac, to_char(i.datum_isporuke, 'DD.MM.YYYY.') as datum, v.registarski_broj as vozilo
       from isporuka i join kupac k on k.id = i.kupac_id left join vozilo v on v.id = i.vozilo_id where i.id = $1`,
      [isporukaId],
    )
  ).rows[0];
  if (!i) return;
  if (u.prethodniVozac && u.prethodniVozac !== u.noviVozac && u.prethodniVozac !== u.korisnikId) {
    const kome = u.noviVozac
      ? (await klijent.query<{ ime: string }>(`select coalesce(l.ime, k.korisnicko_ime) as ime from korisnik k left join lice l on l.id = k.lice_id where k.id = $1`, [u.noviVozac])).rows[0]?.ime
      : null;
    await kreirajObavjestenje(klijent, {
      korisnikId: u.prethodniVozac,
      naslov: `Isporuka ${i.broj} više nije vaša`,
      poruka: `${i.kupac} · ${i.datum}: ${kome ? `prebačena je vozaču ${kome}` : "vozač je skinut sa isporuke"}. Ne utovarujte robu za ovu isporuku.`,
      ozbiljnost: "SREDNJI",
      izvorTip: "isporuka",
      izvorId: isporukaId,
    });
  }
  if (u.noviVozac && u.noviVozac === u.prethodniVozac && u.noviVozac !== u.korisnikId) {
    const promjene: string[] = [];
    if (String(u.prije.datum_isporuke) !== String(u.poslije.datum_isporuke)) promjene.push(`datum je sada ${i.datum}`);
    if (u.prije.vozilo_id !== u.poslije.vozilo_id) promjene.push(i.vozilo ? `vozilo je sada ${i.vozilo}` : "vozilo je skinuto");
    if (u.prije.kupac_id !== u.poslije.kupac_id) promjene.push(`kupac je sada ${i.kupac}`);
    if (JSON.stringify(u.prije.stavke) !== JSON.stringify(u.poslije.stavke)) promjene.push("promijenjena je roba ili količina");
    if (promjene.length === 0) return;
    await kreirajObavjestenje(klijent, {
      korisnikId: u.noviVozac,
      naslov: `Isporuka ${i.broj} je izmijenjena`,
      poruka: `${i.kupac}: ${promjene.join(", ")}. Pogledajte isporuku prije utovara.`,
      ozbiljnost: "SREDNJI",
      izvorTip: "isporuka",
      izvorId: isporukaId,
    });
  }
}

/** Vozač saznaje za isporuku iz aplikacije, ne iz poziva — i ima trag kad mu je dodijeljena.
 * Ne obavještava se ko je sam sebi upisao isporuku. */
async function obavijestiVozaca(klijent: PoolClient, isporukaId: string, vozacId: string | null | undefined, korisnikId: string) {
  if (!vozacId || vozacId === korisnikId) return;
  const red = await klijent.query<{ broj: string; datum_isporuke: string; kupac: string; registarski_broj: string | null }>(
    `select i.broj, i.datum_isporuke, k.naziv as kupac, v.registarski_broj from isporuka i
     join kupac k on k.id = i.kupac_id left join vozilo v on v.id = i.vozilo_id where i.id = $1`,
    [isporukaId],
  );
  const i = red.rows[0];
  if (!i) return;
  const vozilo = i.registarski_broj ? `vozilo ${i.registarski_broj}` : "vozilo nije izabrano";
  await kreirajObavjestenje(klijent, {
    korisnikId: vozacId,
    naslov: `Nova isporuka za vas: ${i.broj}`,
    poruka: `${i.kupac} · ${i.datum_isporuke} · ${vozilo}. Prije utovara uradite kontrolu vozila (D1).`,
    ozbiljnost: "SREDNJI",
    izvorTip: "isporuka",
    izvorId: isporukaId,
  });
}

/** Vozilo isporuke (nalaz R-05): postoji, u upotrebi je i nije palo na posljednjoj kontroli (D1).
 * Roba pod temperaturnim režimom ide samo rashladnim vozilom — bez vozila nema ni kontrole
 * tovarnog prostora ni temperature u prevozu. */
async function provjeriVoziloZaIsporuku(klijent: PoolClient, vozilId: string | null | undefined, stavke: StavkaIsporukeUlaz[]) {
  const podRezimom = (
    await klijent.query<{ naziv: string }>(
      `select distinct a.naziv from lot l join artikal a on a.id = l.artikal_id where l.id = any($1) and a.temp_kontrolisano order by 1`,
      [stavke.map((s) => s.lotId)],
    )
  ).rows.map((r) => r.naziv);
  if (!vozilId) {
    if (podRezimom.length > 0) {
      throw new ApiGreska(400, "VOZILO_OBAVEZNO", `Roba pod temperaturnim režimom (${podRezimom.join(", ")}) ide samo rashladnim vozilom — izaberite vozilo.`);
    }
    return;
  }
  const v = (
    await klijent.query<{ registarski_broj: string; status: string; aktivan: boolean; temp_kontrolisano: boolean }>(
      `select registarski_broj, status, aktivan, temp_kontrolisano from vozilo where id = $1`,
      [vozilId],
    )
  ).rows[0];
  if (!v || !v.aktivan) throw new ApiGreska(404, "VOZILO_NE_POSTOJI", "Izabrano vozilo ne postoji ili više nije u upotrebi.");
  if (v.status !== "SPREMNO") {
    throw new ApiGreska(409, "VOZILO_NIJE_SPREMNO", `Isporuka nije dozvoljena zato što vozilo ${v.registarski_broj} nije prošlo kontrolu — nova kontrola (D1) mora proći.`);
  }
  if (podRezimom.length > 0 && !v.temp_kontrolisano) {
    throw new ApiGreska(409, "VOZILO_BEZ_REZIMA", `${v.registarski_broj} nije rashladno vozilo, a ${podRezimom.join(", ")} je roba pod temperaturnim režimom.`);
  }
}

/** Lot mora biti prihvaćen, nije istekao, stoji u skladištu iz kog isporuka ide (premještanje nije u
 * ovoj verziji) i ima dovoljno SLOBODNE robe: na zalihi minus ono što drže druge isporuke u pripremi
 * (rezervacija, nalaz R-14). Više stavki istog lota se sabira. Red zalihe se zaključava do kraja
 * transakcije — dvije istovremene pripreme istog lota ne mogu obje „vidjeti" istu robu. */
async function provjeriLotoveZaIsporuku(klijent: PoolClient, stavke: StavkaIsporukeUlaz[], skladisteId: string, izuzmiIsporukuId: string | null = null) {
  const poLotu = new Map<string, number>();
  for (const s of stavke) poLotu.set(s.lotId, (poLotu.get(s.lotId) ?? 0) + s.planiranaKolicina);
  for (const [lotId, planirano] of poLotu) await provjeriLotZaIsporuku(klijent, { lotId, planiranaKolicina: planirano }, skladisteId, izuzmiIsporukuId);
}

async function provjeriLotZaIsporuku(klijent: PoolClient, stavka: StavkaIsporukeUlaz, skladisteId: string, izuzmiIsporukuId: string | null) {
  const lot = await klijent.query<{ status: string; dostupno: string | null; broj_lota: string; skladiste_id: string | null; skladiste_naziv: string | null; rok: string | null; istekao: boolean | null }>(
    `select l.status, z.kolicina as dostupno, l.broj_lota, p.skladiste_id, s.naziv as skladiste_naziv,
            to_char(l.rok_trajanja, 'DD.MM.YYYY.') as rok, l.rok_trajanja < (now() at time zone 'Europe/Podgorica')::date as istekao
     from lot l
     left join zaliha z on z.lot_id = l.id and z.status = 'DOSTUPNO'
     left join prijem p on p.id = l.prijem_id
     left join skladiste s on s.id = p.skladiste_id
     where l.id = $1`,
    [stavka.lotId],
  );
  const red = lot.rows[0];
  if (!red || red.status !== "PRIHVACEN") {
    throw new ApiGreska(409, "LOT_NIJE_DOSTUPAN", "Isporuka nije dozvoljena jer izabrani lot nije u statusu PRIHVAĆEN.");
  }
  if (red.istekao) {
    throw new ApiGreska(409, "ROK_ISTEKAO", `Lot ${red.broj_lota} je istekao (${red.rok}) — ne isporučuje se. Otpišite ga ili vratite dobavljaču.`);
  }
  if (red.skladiste_id && red.skladiste_id !== skladisteId) {
    throw new ApiGreska(
      409,
      "LOT_U_DRUGOM_SKLADISTU",
      `Lot ${red.broj_lota} je u skladištu "${red.skladiste_naziv}" — isporuka ide iz drugog. Izaberite skladište u kom je roba.`,
    );
  }
  const dostupno = Number(
    (await klijent.query<{ kolicina: string }>(`select kolicina from zaliha where lot_id = $1 and status = 'DOSTUPNO' for update`, [stavka.lotId])).rows[0]?.kolicina ?? 0,
  );
  const rezervisano = Number(
    (
      await klijent.query<{ r: string }>(
        `select coalesce(sum(ist.planirana_kolicina), 0) as r from isporuka_stavka ist join isporuka i on i.id = ist.isporuka_id
         where ist.lot_id = $1 and i.status = 'U_PRIPREMI' and ($2::uuid is null or i.id <> $2)`,
        [stavka.lotId, izuzmiIsporukuId],
      )
    ).rows[0].r,
  );
  const slobodno = dostupno - rezervisano;
  if (slobodno < stavka.planiranaKolicina) {
    throw new ApiGreska(
      409,
      "NEDOVOLJNO_ZALIHE",
      rezervisano > 0
        ? `Za lot ${red.broj_lota} slobodno je ${Math.max(slobodno, 0)} — na zalihi ${dostupno}, a ${rezervisano} drže druge isporuke u pripremi.`
        : `Na zalihi je dostupno samo ${dostupno} za lot ${red.broj_lota}.`,
    );
  }
}

export async function kreirajIsporuku(ulaz: NovaIsporukaUlaz, korisnikId: string, kljuc?: string) {
  if (ulaz.stavke.length === 0) {
    throw new ApiGreska(400, "ISPORUKA_BEZ_STAVKI", "Isporuka mora imati najmanje jednu stavku.");
  }

  const skladisteId = await odrediSkladiste(pool, ulaz.skladisteId, korisnikId);

  return transakcija(async (klijent) => {
    if (kljuc) {
      const ranije = await zauzmiKljuc(klijent, korisnikId, kljuc, "isporuka");
      if (ranije?.id) return String(ranije.id);
    }
    await provjeriLotoveZaIsporuku(klijent, ulaz.stavke, skladisteId);
    await provjeriVoziloZaIsporuku(klijent, ulaz.vozilId, ulaz.stavke);

    const broj = await sljedeciBroj(klijent, "isporuka", `ISP-${danasKratko()}`);
    const isporuka = await klijent.query<{ id: string }>(
      `insert into isporuka (broj, kupac_id, vozilo_id, vozac_korisnik_id, uneo_korisnik_id, datum_isporuke, status, napomena, skladiste_id)
       values ($1, $2, $3, $4, $5, $6, 'U_PRIPREMI', $7, $8) returning id`,
      [broj, ulaz.kupacId, ulaz.vozilId ?? null, ulaz.vozacKorisnikId ?? null, korisnikId, ulaz.datumIsporuke, ulaz.napomena ?? null, skladisteId],
    );
    const isporukaId = isporuka.rows[0].id;

    for (const stavka of ulaz.stavke) {
      await klijent.query(
        `insert into isporuka_stavka (isporuka_id, lot_id, planirana_kolicina) values ($1, $2, $3)`,
        [isporukaId, stavka.lotId, stavka.planiranaKolicina],
      );
    }

    await obavijestiVozaca(klijent, isporukaId, ulaz.vozacKorisnikId, korisnikId);
    await logKreiranje(klijent, { korisnikId, entitetTip: "isporuka", entitetId: isporukaId, noveVrijednosti: { broj, kupacId: ulaz.kupacId } });
    if (kljuc) await upisiRezultatKljuca(klijent, korisnikId, kljuc, { id: isporukaId });

    return isporukaId;
  });
}

export type IzmjenaIsporukeUlaz = {
  kupacId?: string;
  skladisteId?: string | null;
  vozilId?: string | null;
  vozacKorisnikId?: string | null;
  datumIsporuke: string;
  stavke: StavkaIsporukeUlaz[];
};

/** Izmjena je dozvoljena samo dok je isporuka U_PRIPREMI — čim je potvrđena, zaliha je već
 * umanjena i ispravka ide kroz novi događaj, ne kroz prepravku ove isporuke. Cijeli spisak
 * stavki se zamjenjuje (isto kao pri kreiranju) da bi se izbjeglo dupliranje logike. */
export async function izmijeniIsporuku(isporukaId: string, ulaz: IzmjenaIsporukeUlaz, korisnik: Korisnik) {
  const korisnikId = korisnik.id;
  if (ulaz.stavke.length === 0) {
    throw new ApiGreska(400, "ISPORUKA_BEZ_STAVKI", "Isporuka mora imati najmanje jednu stavku.");
  }

  return transakcija(async (klijent) => {
    const isporukaRed = await klijent.query<{ status: string; vozac_korisnik_id: string | null; uneo_korisnik_id: string | null; skladiste_id: string | null }>(
      `select status, vozac_korisnik_id, uneo_korisnik_id, skladiste_id from isporuka where id = $1 for update`,
      [isporukaId],
    );
    if (!isporukaRed.rows[0]) throw new ApiGreska(404, "ISPORUKA_NE_POSTOJI", "Isporuka nije pronađena.");
    provjeriSvojuIsporuku(korisnik, isporukaRed.rows[0]);
    if (isporukaRed.rows[0].status !== "U_PRIPREMI") {
      throw new ApiGreska(409, "ISPORUKA_VEC_POTVRDJENA", "Isporuka se više ne može mijenjati — već je potvrđena.");
    }
    const prethodniVozac = isporukaRed.rows[0].vozac_korisnik_id;
    // Audit pamti i šta je bilo prije: vozilo, vozač, datum, magacin i stavke (R-06).
    const stanjeIsporuke = async () => ({
      ...(await klijent.query(`select kupac_id, vozilo_id, vozac_korisnik_id, datum_isporuke, skladiste_id from isporuka where id = $1`, [isporukaId])).rows[0],
      stavke: (
        await klijent.query(
          `select l.broj_lota as lot, s.planirana_kolicina::float as kolicina from isporuka_stavka s join lot l on l.id = s.lot_id
           where s.isporuka_id = $1 order by l.broj_lota, s.planirana_kolicina`,
          [isporukaId],
        )
      ).rows,
    });
    const prije = await stanjeIsporuke();
    const skladisteId = await odrediSkladiste(klijent, ulaz.skladisteId ?? isporukaRed.rows[0].skladiste_id, korisnikId);

    await provjeriLotoveZaIsporuku(klijent, ulaz.stavke, skladisteId, isporukaId);
    await provjeriVoziloZaIsporuku(klijent, ulaz.vozilId, ulaz.stavke);

    await klijent.query(`delete from isporuka_stavka where isporuka_id = $1`, [isporukaId]);
    for (const stavka of ulaz.stavke) {
      await klijent.query(
        `insert into isporuka_stavka (isporuka_id, lot_id, planirana_kolicina) values ($1, $2, $3)`,
        [isporukaId, stavka.lotId, stavka.planiranaKolicina],
      );
    }
    await klijent.query(
      `update isporuka set vozilo_id = $1, vozac_korisnik_id = $2, datum_isporuke = $3, skladiste_id = $4, kupac_id = coalesce($6, kupac_id), updated_at = now() where id = $5`,
      [ulaz.vozilId ?? null, ulaz.vozacKorisnikId ?? null, ulaz.datumIsporuke, skladisteId, isporukaId, ulaz.kupacId ?? null],
    );

    const poslije = await stanjeIsporuke();
    await logIzmjenaReda(klijent, { korisnikId, entitetTip: "isporuka", entitetId: isporukaId, prije, poslije });
    if (ulaz.vozacKorisnikId && ulaz.vozacKorisnikId !== prethodniVozac) {
      await obavijestiVozaca(klijent, isporukaId, ulaz.vozacKorisnikId, korisnikId);
    }
    await javiVozacuIzmjenu(klijent, isporukaId, { prethodniVozac, noviVozac: ulaz.vozacKorisnikId ?? null, korisnikId, prije, poslije });
  });
}

/** Otkaz isporuke prije predaje (nalaz R-15): samo iz pripreme, uz razlog. Rezervacija robe se time
 * oslobađa (računa se iz isporuka u pripremi). Vozač i onaj ko je isporuku spremio saznaju odmah.
 * Predaja koju kupac odbije NIJE otkaz — to je potvrda sa 0 i razlogom (roba ide u karantin). */
export async function otkaziIsporuku(isporukaId: string, razlog: string, korisnik: Korisnik) {
  const tekst = razlog.trim();
  if (tekst.length < 5) throw new ApiGreska(400, "RAZLOG_OBAVEZAN", "Upišite zašto se isporuka otkazuje (npr. kupac otkazao narudžbu).");
  return transakcija(async (klijent) => {
    const red = (
      await klijent.query<{ status: string; broj: string; vozac_korisnik_id: string | null; uneo_korisnik_id: string | null; kupac: string }>(
        `select i.status, i.broj, i.vozac_korisnik_id, i.uneo_korisnik_id, k.naziv as kupac from isporuka i join kupac k on k.id = i.kupac_id
         where i.id = $1 for update of i`,
        [isporukaId],
      )
    ).rows[0];
    if (!red) throw new ApiGreska(404, "ISPORUKA_NE_POSTOJI", "Isporuka nije pronađena.");
    provjeriSvojuIsporuku(korisnik, red);
    if (red.status !== "U_PRIPREMI") {
      throw new ApiGreska(409, "ISPORUKA_NIJE_U_PRIPREMI", "Otkazuje se samo isporuka u pripremi — predata se ispravlja prijavom odstupanja.");
    }
    await klijent.query(
      `update isporuka set status = 'OTKAZANA', otkazano_at = now(), otkazao_korisnik_id = $1, razlog_otkaza = $2, updated_at = now() where id = $3`,
      [korisnik.id, tekst, isporukaId],
    );
    await logPromjenaStatusa(klijent, {
      korisnikId: korisnik.id,
      entitetTip: "isporuka",
      entitetId: isporukaId,
      stareVrijednosti: { status: red.status },
      noveVrijednosti: { status: "OTKAZANA", razlog: tekst },
    });
    for (const primalac of new Set([red.vozac_korisnik_id, red.uneo_korisnik_id].filter((x): x is string => !!x && x !== korisnik.id))) {
      await kreirajObavjestenje(klijent, {
        korisnikId: primalac,
        naslov: `Isporuka ${red.broj} je otkazana`,
        poruka: `${red.kupac}: ${tekst}. Ne utovarujte robu; ako je već utovarena, vratite je na mjesto.`,
        ozbiljnost: "SREDNJI",
        izvorTip: "isporuka",
        izvorId: isporukaId,
      });
    }
    return { status: "OTKAZANA" };
  });
}

export type StavkaPotvrdeUlaz = {
  stavkaId: string;
  isporucenaKolicina: number;
  odbijenaKolicina?: number;
  razlogOdbijanja?: string;
  temperaturaPredaje?: number | null;
};

type MjerenjePredaje = { lotId: string; artikalId: string; temperatura: number };

const KKT3_SIFRA = "KKT3";

/** Predaja kupcu. Sve se provjerava ovdje, u trenutku predaje, a ne samo pri pripremi (nalaz R-01):
 * između pripreme i predaje lot može biti zadržan ili pod povlačenjem, isteći mu rok, a zaliha
 * može biti otpisana. Roba koja se vraća (odbijena ili nepredata) ide u KARANTIN, ne nazad u
 * slobodnu zalihu — odgovorno lice je pregleda pa pusti ili otpiše (nalaz R-03). */
export async function potvrdiIsporuku(isporukaId: string, stavke: StavkaPotvrdeUlaz[], korisnik: Korisnik, mjerniUredjajId: string | null = null) {
  const korisnikId = korisnik.id;
  const mjerenjaPredaje: MjerenjePredaje[] = [];
  // Termometar kojim je izmjereno pri predaji (R-23) — neispravan se odbija prije potvrde.
  if (stavke.some((s) => s.temperaturaPredaje != null)) await provjeriTermometar(mjerniUredjajId);

  const potvrda = await transakcija(async (klijent) => {
    const isporukaRed = await klijent.query<{ status: string; vozilo_id: string | null; broj: string; vozac_korisnik_id: string | null; uneo_korisnik_id: string | null }>(
      `select status, vozilo_id, broj, vozac_korisnik_id, uneo_korisnik_id from isporuka where id = $1 for update`,
      [isporukaId],
    );
    if (!isporukaRed.rows[0]) throw new ApiGreska(404, "ISPORUKA_NE_POSTOJI", "Isporuka nije pronađena.");
    // Predaju potvrđuje vozač kome je dodijeljena; bez vozača — onaj ko ju je pripremio (R-04).
    const ir = isporukaRed.rows[0];
    if (NA_TERENU.includes(korisnik.uloga) && (ir.vozac_korisnik_id ? ir.vozac_korisnik_id !== korisnikId : ir.uneo_korisnik_id !== korisnikId)) {
      throw new ApiGreska(403, "NIJE_VASA_ISPORUKA", "Ovu isporuku potvrđuje vozač kome je dodijeljena.");
    }
    if (ir.status !== "U_PRIPREMI") {
      throw new ApiGreska(409, "ISPORUKA_VEC_POTVRDJENA", "Ova isporuka je već potvrđena.");
    }
    // Roba je išla vozilom — mora postojati današnja kontrola tog vozila (R-05). Pala kontrola ne
    // zaustavlja potvrdu (roba je već predata, a neusaglašenost vozila je otvorena), izostala da.
    if (ir.vozilo_id) {
      const d1 = (
        await klijent.query<{ registarski_broj: string; ima: boolean }>(
          // Dan predaje: kod predaje bez mreže (#85) to je dan sa telefona — D1 je morala biti tog dana.
          `select v.registarski_broj, exists (
             select 1 from kontrola_vozila kv where kv.vozilo_id = v.id
               and (kv.izvrseno_at at time zone 'Europe/Podgorica')::date = (coalesce($2::timestamptz, now()) at time zone 'Europe/Podgorica')::date
           ) as ima from vozilo v where v.id = $1`,
          [ir.vozilo_id, vrijemeVanMreze()],
        )
      ).rows[0];
      if (d1 && !d1.ima) {
        const vm = vrijemeVanMreze();
        if (vm) {
          const dan = vm.toLocaleDateString("sr-Latn-ME", { timeZone: "Europe/Podgorica", day: "2-digit", month: "2-digit", year: "numeric" });
          throw new ApiGreska(409, "D1_NIJE_URADJENA", `Kontrola vozila ${d1.registarski_broj} (D1) nije urađena na dan predaje (${dan}) — predaja upisana bez mreže se zato ne prima.`);
        }
        throw new ApiGreska(409, "D1_NIJE_URADJENA", `Danas nije urađena kontrola vozila ${d1.registarski_broj} (D1) — uradite je na strani Vozila, pa potvrdite predaju.`);
      }
    }
    // Sve stavke, svaka jednom — izostavljena stavka bi ostala ni predata ni vraćena (R-16).
    const sveStavke = (await klijent.query<{ id: string }>(`select id from isporuka_stavka where isporuka_id = $1`, [isporukaId])).rows.map((r) => r.id);
    const poslate = stavke.map((s) => s.stavkaId);
    if (new Set(poslate).size !== poslate.length || sveStavke.length !== poslate.length || !sveStavke.every((id) => poslate.includes(id))) {
      throw new ApiGreska(400, "STAVKE_NEPOTPUNE", "Potvrda mora obuhvatiti sve stavke isporuke — za ono što nije predato upišite 0.");
    }
    const povrati: { lotId: string; brojLota: string; artikal: string; kolicina: number; razlog: string }[] = [];

    let ukupnoPlanirano = 0;
    let ukupnoIsporuceno = 0;

    for (const stavka of stavke) {
      if ((stavka.odbijenaKolicina ?? 0) > 0 && (!stavka.razlogOdbijanja || stavka.razlogOdbijanja.trim() === "")) {
        throw new ApiGreska(400, "RAZLOG_OBAVEZAN", "Odbijanje pri isporuci mora imati zapisan razlog.");
      }
      const stavkaRed = await klijent.query<{
        lot_id: string;
        planirana_kolicina: string;
        artikal_id: string;
        artikal_naziv: string;
        temp_kontrolisano: boolean;
        temp_min: string | null;
        temp_max: string | null;
        granica_potvrdio: boolean;
      }>(
        `select is2.lot_id, is2.planirana_kolicina, l.artikal_id, a.naziv as artikal_naziv,
                a.temp_kontrolisano, a.temp_min, a.temp_max, a.granica_potvrdio
         from isporuka_stavka is2 join lot l on l.id = is2.lot_id join artikal a on a.id = l.artikal_id
         where is2.id = $1 and is2.isporuka_id = $2`,
        [stavka.stavkaId, isporukaId],
      );
      const red = stavkaRed.rows[0];
      if (!red) throw new ApiGreska(404, "STAVKA_NE_POSTOJI", "Stavka isporuke nije pronađena.");
      const temperatura = stavka.temperaturaPredaje ?? null;
      if (red.temp_kontrolisano && stavka.isporucenaKolicina > 0 && temperatura === null) {
        throw new ApiGreska(
          400,
          "TEMPERATURA_OBAVEZNA",
          `Upišite temperaturu pri predaji za "${red.artikal_naziv}" — to je dokaz da je hladni lanac održan do kupca.`,
        );
      }
      const planirano = Number(red.planirana_kolicina);
      const isporuceno = stavka.isporucenaKolicina;
      const odbijeno = stavka.odbijenaKolicina ?? 0;
      if (isporuceno + odbijeno > planirano) {
        throw new ApiGreska(400, "KOLICINA_PREKORACENA", "Isporučena i odbijena količina ne mogu biti veće od planirane.");
      }
      ukupnoPlanirano += planirano;
      ukupnoIsporuceno += isporuceno;

      await klijent.query(
        `update isporuka_stavka set isporucena_kolicina = $1, odbijena_kolicina = $2, razlog_odbijanja = $3, temperatura_predaje = $4 where id = $5`,
        [isporuceno, odbijeno, stavka.razlogOdbijanja ?? null, temperatura, stavka.stavkaId],
      );
      if (temperatura !== null) {
        mjerenjaPredaje.push({ lotId: red.lot_id, artikalId: red.artikal_id, temperatura });
      }

      // Stanje lota i zalihe U TRENUTKU PREDAJE (R-01, R-02). Red zalihe se zaključava do kraja transakcije.
      const lotRed = (
        await klijent.query<{ status: string; broj_lota: string; rok: string | null; istekao: boolean | null }>(
          `select status, broj_lota, to_char(rok_trajanja, 'DD.MM.YYYY.') as rok,
                  rok_trajanja < (coalesce($2::timestamptz, now()) at time zone 'Europe/Podgorica')::date as istekao
           from lot where id = $1`,
          [red.lot_id, vrijemeVanMreze()],
        )
      ).rows[0];
      const dostupno = Number(
        (await klijent.query<{ kolicina: string }>(`select kolicina from zaliha where lot_id = $1 and status = 'DOSTUPNO' for update`, [red.lot_id])).rows[0]
          ?.kolicina ?? 0,
      );
      if (isporuceno > 0) {
        if (lotRed.status !== "PRIHVACEN") {
          throw new ApiGreska(
            409,
            "LOT_BLOKIRAN",
            `Lot ${lotRed.broj_lota} je zadržan (povlačenje ili odstupanje) — ne predajte ovu robu. Za tu stavku upišite 0 i razlog, pa se javite odgovornom licu.`,
          );
        }
        if (lotRed.istekao) {
          throw new ApiGreska(409, "ROK_ISTEKAO", `Lot ${lotRed.broj_lota} je istekao (${lotRed.rok}) — ne predaje se kupcu. Upišite 0 i razlog.`);
        }
        if (dostupno < isporuceno) {
          throw new ApiGreska(409, "NEDOVOLJNO_ZALIHE", `Na zalihi je samo ${dostupno} za lot ${lotRed.broj_lota} — provjerite sa magacinom.`);
        }
        await klijent.query(
          `update zaliha set kolicina = kolicina - $1, updated_at = now() where lot_id = $2 and status = 'DOSTUPNO'`,
          [isporuceno, red.lot_id],
        );
        await klijent.query(
          `insert into kretanje_zalihe (lot_id, artikal_id, kolicina_delta, tip, referenca_tip, referenca_id, izvrsio_korisnik_id)
           values ($1, $2, $3, 'ISPORUKA', 'isporuka', $4, $5)`,
          [red.lot_id, red.artikal_id, -isporuceno, isporukaId, korisnikId],
        );
      }

      // Povrat (R-03): ono što nije predato vraća se u KARANTIN. Lot koji je već zadržan ima svu
      // robu u karantinu od trenutka zadržavanja, pa tada nema šta da se premješta.
      const premjesti = Math.min(planirano - isporuceno, Math.max(dostupno - isporuceno, 0));
      if (lotRed.status === "PRIHVACEN" && premjesti > 0) {
        const razlog = stavka.razlogOdbijanja?.trim() || (odbijeno > 0 ? "odbijeno" : "nije predato");
        await klijent.query(`update zaliha set kolicina = kolicina - $1, updated_at = now() where lot_id = $2 and status = 'DOSTUPNO'`, [premjesti, red.lot_id]);
        await klijent.query(
          `insert into zaliha (lot_id, artikal_id, kolicina, status) values ($1, $2, $3, 'KARANTIN')
           on conflict (lot_id, status) do update set kolicina = zaliha.kolicina + excluded.kolicina, updated_at = now()`,
          [red.lot_id, red.artikal_id, premjesti],
        );
        await klijent.query(
          `insert into kretanje_zalihe (lot_id, artikal_id, kolicina_delta, tip, referenca_tip, referenca_id, izvrsio_korisnik_id, napomena)
           values ($1, $2, 0, 'HOLD', 'isporuka', $3, $4, $5)`,
          [red.lot_id, red.artikal_id, isporukaId, korisnikId, `Povrat u karantin (${premjesti}) sa isporuke ${ir.broj}: ${razlog}`],
        );
        povrati.push({ lotId: red.lot_id, brojLota: lotRed.broj_lota, artikal: red.artikal_naziv, kolicina: premjesti, razlog });
      }
    }

    for (const p of povrati) {
      await obavijestiUlogu(klijent, "bzr", {
        naslov: `Povrat u karantin — ${p.artikal}, lot ${p.brojLota}`,
        poruka: `${p.kolicina} sa isporuke ${ir.broj} (${p.razlog}). Pregledajte robu, pa je pustite ili otpišite (Zalihe → karantin).`,
        ozbiljnost: "SREDNJI",
        izvorTip: "lot",
        izvorId: p.lotId,
      });
    }

    const status = ukupnoIsporuceno === 0 ? "ODBIJENA" : ukupnoIsporuceno < ukupnoPlanirano ? "DJELIMICNA" : "POTVRDJENA";
    await klijent.query(
      `update isporuka set status = $1, potvrdio_korisnik_id = $2, potvrdjeno_at = coalesce($4::timestamptz, now()),
              potvrda_van_mreze = $4::timestamptz is not null, updated_at = now() where id = $3`,
      [status, korisnikId, isporukaId, vrijemeVanMreze()],
    );

    await logPromjenaStatusa(klijent, { korisnikId, entitetTip: "isporuka", entitetId: isporukaId, noveVrijednosti: { status, povrat: povrati.map((p) => ({ lot: p.brojLota, kolicina: p.kolicina })) } });

    return { status, voziloId: isporukaRed.rows[0].vozilo_id, broj: isporukaRed.rows[0].broj, uKarantin: povrati.reduce((s, p) => s + p.kolicina, 0) };
  });

  // Mjerenje na KKT 3 ide poslije potvrde, u svojoj transakciji po stavci — kao KKT 1 na prijemu:
  // nalaz van granice ne smije poništiti potvrdu isporuke koja se već desila.
  const rezultati = await zabiljeziTemperaturePredaje(mjerenjaPredaje, potvrda.voziloId, potvrda.broj, korisnikId, mjerniUredjajId);
  return { status: potvrda.status, vanGranice: rezultati.filter((r) => r === "FAIL").length, uKarantin: potvrda.uKarantin };
}

/** Granica je pravilo KKT 3 za taj artikal — pravi ga Šifarnik iz granice artikla
 * (pravilaService, jedan izvor granica). Nepotvrđenu granicu zabiljeziMjerenje ocjenjuje samo kao
 * upozorenje (invarijanta #5). Artikal bez granice se ne ocjenjuje; temperatura ostaje na stavci.
 * Opšte pravilo KKT 3 (rashladni režim vozila, 0–5 °C) se ovdje namjerno NE koristi — po njemu
 * bi svaki smrznuti artikal na −18 °C ispao "van opsega". Lot se ne stavlja na HOLD: problem
 * je nastao u prevozu, a roba koja je ostala u magacinu nije bila u tom vozilu. */
async function zabiljeziTemperaturePredaje(mjerenja: MjerenjePredaje[], voziloId: string | null, brojIsporuke: string, korisnikId: string, mjerniUredjajId: string | null) {
  if (mjerenja.length === 0) return [];
  const kkt = await upit<{ id: string }>(`select id from kontrolna_tacka where sifra = $1 and aktivan`, [KKT3_SIFRA]);
  const kkt3Id = kkt.rows[0]?.id;
  if (!kkt3Id) return [];

  const rezultati: string[] = [];
  for (const m of mjerenja) {
    const pravilo = await upit<{ id: string; min_vrijednost: string | null; max_vrijednost: string | null }>(
      `select id, min_vrijednost, max_vrijednost from pravilo_kontrole
       where kontrolna_tacka_id = $1 and artikal_id = $2 and aktivan order by created_at desc limit 1`,
      [kkt3Id, m.artikalId],
    );
    // Samo pravilo artikla (jedan izvor granica — pravilaService). Nepotvrđenu granicu ocjenjuje
    // zabiljeziMjerenje kao upozorenje (invarijanta #5), ali se mjerenje ipak zapiše.
    const p = pravilo.rows[0];
    if (!p) continue;
    const r = await zabiljeziMjerenje(p, {
      kontrolnaTackaId: kkt3Id,
      praviloKontroleId: p.id,
      lotId: m.lotId,
      vozilId: voziloId,
      vrijednost: m.temperatura,
      izmjerioKorisnikId: korisnikId,
      napomena: `Pri predaji kupcu — ${brojIsporuke}`,
      holdLota: false,
      mjerniUredjajId,
    });
    rezultati.push(r.rezultat);
  }
  return rezultati;
}

/** Otpremnica za štampu (nalaz R-21): prati robu do kupca — broj, lotovi, rokovi, temperatura pri
 * predaji i mjesta za potpis. Isto pravo čitanja kao detalj isporuke (R-04). Nosi vrijeme posljednje
 * izmjene, da se na papiru vidi koja je verzija odštampana. */
export async function otpremnicaZaStampu(isporukaId: string, korisnik: Korisnik) {
  const naTerenu = NA_TERENU.includes(korisnik.uloga);
  const isporuka = (
    await upit(
      `select i.id, i.broj, i.datum_isporuke, i.status, i.napomena, i.updated_at, i.potvrdjeno_at, i.otkazano_at, i.razlog_otkaza,
              k.naziv as kupac_naziv, k.pib as kupac_pib, k.adresa as kupac_adresa, k.adresa_isporuke as kupac_adresa_isporuke, k.telefon as kupac_telefon,
              v.registarski_broj, s.naziv as skladiste_naziv, s.adresa as skladiste_adresa,
              ${IME("i.vozac_korisnik_id")} as vozac, ${IME("i.uneo_korisnik_id")} as pripremio, ${IME("i.potvrdio_korisnik_id")} as predao
       from isporuka i join kupac k on k.id = i.kupac_id
       left join vozilo v on v.id = i.vozilo_id left join skladiste s on s.id = i.skladiste_id
       where i.id = $1 ${naTerenu ? `and (i.uneo_korisnik_id = $2 or i.vozac_korisnik_id = $2) and ${ogranicenjeDatuma(korisnik.uloga, "i.datum_isporuke")}` : ""}`,
      naTerenu ? [isporukaId, korisnik.id] : [isporukaId],
    )
  ).rows[0];
  if (!isporuka) throw new ApiGreska(404, "ISPORUKA_NE_POSTOJI", "Isporuka nije pronađena.");
  const firma = (await upit(`select naziv, pib, adresa, grad, telefon from firma limit 1`)).rows[0] ?? null;
  const stavke = (
    await upit(
      `select a.sifra, a.naziv as artikal, a.jedinica_mjere, a.temp_kontrolisano, l.broj_lota, l.rok_trajanja,
              ist.planirana_kolicina, ist.isporucena_kolicina, ist.odbijena_kolicina, ist.razlog_odbijanja, ist.temperatura_predaje
       from isporuka_stavka ist join lot l on l.id = ist.lot_id join artikal a on a.id = l.artikal_id
       where ist.isporuka_id = $1 order by a.naziv, l.rok_trajanja nulls last`,
      [isporukaId],
    )
  ).rows;
  return { firma, isporuka, stavke };
}
