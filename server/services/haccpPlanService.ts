// Verifikacija HACCP sistema (nalaz H6, 7. princip): termometri (interna provjera i kalibracija),
// godišnja revizija plana, interni audit, vježba povlačenja — i HACCP plan za štampu, sklopljen iz
// onoga što je stvarno podešeno (kontrolne tačke, pravila, plan monitoringa), ne iz šablona.
import { upit, transakcija } from "../db.js";
import { ApiGreska } from "../greske.js";
import { danasCG } from "../vrijeme.js";
import { logKreiranje } from "./auditService.js";
import { kreirajZadatak, obavijestiUlogu } from "./zadaciService.js";
import { sljedeciBrojNc } from "./brojeviService.js";
import { stavkePlana } from "./monitoringService.js";

// ─── Mjerni uređaji ──────────────────────────────────────────────────────────────────────────────

/** Stanje termometra: NEISPRAVAN (posljednja provjera nije prošla) · ISTEKLA (rok provjere ili
 * kalibracije prošao, ili nikad provjeren) · USKORO (provjera za ≤ 7 dana, kalibracija za ≤ 30) · VAZI. */
const UREDJAJI_SQL = `
  select u.*,
         to_char(pp.datum, 'YYYY-MM-DD') as posljednja_provjera, pp.rezultat as posljednji_rezultat, pp.vrsta as posljednja_vrsta,
         to_char(pk.datum, 'YYYY-MM-DD') as posljednja_kalibracija,
         to_char((pp.datum + make_interval(months => u.interval_provjere_mjeseci))::date, 'YYYY-MM-DD') as provjera_do,
         to_char(case when u.interval_kalibracije_mjeseci is null then null
                      else (pk.datum + make_interval(months => u.interval_kalibracije_mjeseci))::date end, 'YYYY-MM-DD') as kalibracija_do,
         case
           when pp.rezultat = 'NEISPRAVAN' then 'NEISPRAVAN'
           when pp.datum is null or (pp.datum + make_interval(months => u.interval_provjere_mjeseci))::date < $1::date then 'ISTEKLA'
           when u.interval_kalibracije_mjeseci is not null and (pk.datum is null or (pk.datum + make_interval(months => u.interval_kalibracije_mjeseci))::date < $1::date) then 'ISTEKLA'
           when (pp.datum + make_interval(months => u.interval_provjere_mjeseci))::date <= $1::date + 7 then 'USKORO'
           when u.interval_kalibracije_mjeseci is not null and (pk.datum + make_interval(months => u.interval_kalibracije_mjeseci))::date <= $1::date + 30 then 'USKORO'
           else 'VAZI'
         end as stanje
  from mjerni_uredjaj u
  left join lateral (select datum, rezultat, vrsta from provjera_uredjaja p where p.uredjaj_id = u.id order by datum desc, created_at desc limit 1) pp on true
  left join lateral (select datum from provjera_uredjaja p where p.uredjaj_id = u.id and p.vrsta = 'KALIBRACIJA' and p.rezultat = 'ISPRAVAN' order by datum desc limit 1) pk on true`;

export type Uredjaj = {
  id: string;
  naziv: string;
  oznaka: string | null;
  lokacija: string | null;
  interval_provjere_mjeseci: number;
  interval_kalibracije_mjeseci: number | null;
  aktivan: boolean;
  posljednja_provjera: string | null;
  posljednji_rezultat: string | null;
  posljednja_vrsta: string | null;
  posljednja_kalibracija: string | null;
  provjera_do: string | null;
  kalibracija_do: string | null;
  stanje: "NEISPRAVAN" | "ISTEKLA" | "USKORO" | "VAZI";
};

export async function listaUredjaja(samoAktivni = false): Promise<Uredjaj[]> {
  return (await upit<Uredjaj>(`${UREDJAJI_SQL} ${samoAktivni ? "where u.aktivan" : ""} order by u.aktivan desc, u.naziv`, [danasCG()])).rows;
}

export type ProvjeraUlaz = {
  datum: string;
  vrsta: "INTERNA" | "KALIBRACIJA";
  referentna?: number | null;
  izmjereno?: number | null;
  dozvoljenoOdstupanje?: number | null;
  rezultat?: "ISPRAVAN" | "NEISPRAVAN";
  brojSertifikata?: string;
  napomena?: string;
};

/** Upis provjere. Kad su zadate referentna i izmjerena vrijednost, rezultat računa server (van
 * dozvoljenog odstupanja = NEISPRAVAN) — ne bira ga čovjek. Neispravan termometar otvara
 * neusaglašenost: sva mjerenja njime od posljednje dobre provjere su upitna. */
export async function zabiljeziProvjeru(uredjajId: string, ulaz: ProvjeraUlaz, izvrsilac: string, korisnikId: string) {
  if (ulaz.datum > danasCG()) throw new ApiGreska(400, "DATUM_U_BUDUCNOSTI", "Provjera se upisuje kad je urađena, ne unaprijed.");
  const imaMjerenje = ulaz.referentna != null && ulaz.izmjereno != null;
  const dozvoljeno = ulaz.dozvoljenoOdstupanje ?? 0.5;
  const rezultat = imaMjerenje ? (Math.abs(Number(ulaz.izmjereno) - Number(ulaz.referentna)) <= dozvoljeno ? "ISPRAVAN" : "NEISPRAVAN") : ulaz.rezultat;
  if (!rezultat) throw new ApiGreska(400, "REZULTAT_OBAVEZAN", "Upišite referentnu i izmjerenu vrijednost (npr. ledena voda 0 °C), ili rezultat sa sertifikata.");
  if (ulaz.vrsta === "KALIBRACIJA" && !ulaz.brojSertifikata?.trim()) {
    throw new ApiGreska(400, "SERTIFIKAT_OBAVEZAN", "Za kalibraciju upišite broj sertifikata laboratorije — on je dokaz.");
  }

  return transakcija(async (klijent) => {
    const u = (await klijent.query<{ naziv: string; oznaka: string | null }>(`select naziv, oznaka from mjerni_uredjaj where id = $1 for update`, [uredjajId])).rows[0];
    if (!u) throw new ApiGreska(404, "UREDJAJ_NE_POSTOJI", "Mjerni uređaj nije pronađen.");
    const p = await klijent.query<{ id: string }>(
      `insert into provjera_uredjaja (uredjaj_id, datum, vrsta, referentna, izmjereno, dozvoljeno_odstupanje, rezultat, broj_sertifikata, izvrsilac, napomena, uneo_korisnik_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
      [uredjajId, ulaz.datum, ulaz.vrsta, ulaz.referentna ?? null, ulaz.izmjereno ?? null, imaMjerenje ? dozvoljeno : null, rezultat, ulaz.brojSertifikata?.trim() || null, izvrsilac, ulaz.napomena?.trim() || null, korisnikId],
    );
    await logKreiranje(klijent, { korisnikId, entitetTip: "provjera_uredjaja", entitetId: p.rows[0].id, noveVrijednosti: { uredjajId, ...ulaz, rezultat } });

    let neusaglasenost: string | null = null;
    let upitnaMjerenja = 0;
    if (rezultat === "NEISPRAVAN") {
      const oznaka = `${u.naziv}${u.oznaka ? ` (${u.oznaka})` : ""}`;
      const broj = await sljedeciBrojNc(klijent);
      // Koliko je mjerenja urađeno njime od posljednje ispravne provjere (R-23) — ta su upitna i
      // na strani HACCP nose oznaku; bez ovoga se nije znalo ni da postoje.
      const upitna = (
        await klijent.query<{ n: number }>(
          `select count(*)::int as n from mjerenje_temperature m
           where m.mjerni_uredjaj_id = $1
             and m.izmjereno_at > coalesce((select max(created_at) from provjera_uredjaja where uredjaj_id = $1 and rezultat = 'ISPRAVAN'), '-infinity'::timestamptz)`,
          [uredjajId],
        )
      ).rows[0].n;
      upitnaMjerenja = upitna;
      const opis = `Mjerni uređaj ${oznaka} nije prošao ${ulaz.vrsta === "KALIBRACIJA" ? "kalibraciju" : "provjeru"}${imaMjerenje ? `: referentno ${ulaz.referentna} °C, pokazao ${ulaz.izmjereno} °C` : ""}. Mjerenja njime od posljednje ispravne provjere su upitna: ${upitna} (označena na strani HACCP).`;
      const nc = await klijent.query<{ id: string }>(
        `insert into neusaglasenost (broj, ozbiljnost, status, izvor_tip, izvor_id, opis, prijavio_korisnik_id)
         values ($1, 'VISOK', 'OTVORENA', 'mjerni_uredjaj', $2, $3, $4) returning id`,
        [broj, uredjajId, opis, korisnikId],
      );
      neusaglasenost = broj;
      await logKreiranje(klijent, { korisnikId, entitetTip: "neusaglasenost", entitetId: nc.rows[0].id, noveVrijednosti: { broj, izvor: "mjerni_uredjaj", uredjajId } });
      await kreirajZadatak(klijent, {
        naslov: `Zamijeniti ili kalibrisati ${oznaka} — ${broj}`,
        opis: "Ne mjeriti tim uređajem dok ne prođe provjeru. Pregledati mjerenja od posljednje ispravne provjere.",
        prioritet: "VISOK",
        izvorTip: "neusaglasenost",
        izvorId: nc.rows[0].id,
      });
      await obavijestiUlogu(klijent, "bzr", {
        naslov: `Termometar nije prošao provjeru — ${oznaka}`,
        poruka: `${broj}. Ne mjeriti njime dok se ne zamijeni ili kalibriše.${upitna > 0 ? ` Upitnih mjerenja od posljednje ispravne provjere: ${upitna} — pregledajte ih na strani HACCP.` : ""}`,
        ozbiljnost: "VISOK",
        izvorTip: "mjerni_uredjaj",
        izvorId: uredjajId,
      });
    }
    return { id: p.rows[0].id, rezultat, neusaglasenost, upitnaMjerenja };
  });
}

// ─── Verifikacija sistema ────────────────────────────────────────────────────────────────────────

export const VRSTE_VERIFIKACIJE = {
  REVIZIJA_PLANA: { naziv: "Godišnja revizija HACCP plana", mjeseci: 12 },
  INTERNI_AUDIT: { naziv: "Interni audit", mjeseci: 12 },
  VJEZBA_POVLACENJA: { naziv: "Vježba povlačenja (sledljivost)", mjeseci: 12 },
} as const;
export type VrstaVerifikacije = keyof typeof VRSTE_VERIFIKACIJE;

/** Za svaku vrstu: posljednja, do kada treba sljedeća, i stanje NIJE_RADJENO / KASNI / USKORO / VAZI. */
export async function stanjeVerifikacije() {
  const danas = danasCG();
  const r = await upit<{ vrsta: VrstaVerifikacije; datum: string; sljedeca_do: string | null; zakljucak: string; izvrsilac: string }>(
    `select distinct on (vrsta) vrsta, to_char(datum, 'YYYY-MM-DD') as datum, to_char(sljedeca_do, 'YYYY-MM-DD') as sljedeca_do, zakljucak, izvrsilac
     from verifikacija_sistema order by vrsta, datum desc, created_at desc`,
  );
  return (Object.keys(VRSTE_VERIFIKACIJE) as VrstaVerifikacije[]).map((vrsta) => {
    const p = r.rows.find((x) => x.vrsta === vrsta);
    const doDan = p?.sljedeca_do ?? null;
    const uskoro = new Date(`${danas}T12:00:00Z`);
    uskoro.setUTCDate(uskoro.getUTCDate() + 30);
    const granica = `${uskoro.getUTCFullYear()}-${String(uskoro.getUTCMonth() + 1).padStart(2, "0")}-${String(uskoro.getUTCDate()).padStart(2, "0")}`;
    const stanje = !p ? "NIJE_RADJENO" : doDan && doDan < danas ? "KASNI" : doDan && doDan <= granica ? "USKORO" : "VAZI";
    return { vrsta, naziv: VRSTE_VERIFIKACIJE[vrsta].naziv, posljednja: p?.datum ?? null, zakljucak: p?.zakljucak ?? null, izvrsilac: p?.izvrsilac ?? null, sljedecaDo: doDan, stanje };
  });
}

export async function zabiljeziVerifikaciju(
  ulaz: { vrsta: VrstaVerifikacije; datum: string; nalaz: string; zakljucak: "USAGLASENO" | "POTREBNE_IZMJENE"; sljedecaDo?: string },
  izvrsilac: string,
  korisnikId: string,
) {
  if (ulaz.datum > danasCG()) throw new ApiGreska(400, "DATUM_U_BUDUCNOSTI", "Upisuje se ono što je urađeno, ne unaprijed.");
  const d = new Date(`${ulaz.datum}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + VRSTE_VERIFIKACIJE[ulaz.vrsta].mjeseci);
  const sljedeca = ulaz.sljedecaDo ?? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return transakcija(async (klijent) => {
    const r = await klijent.query<{ id: string }>(
      `insert into verifikacija_sistema (vrsta, datum, izvrsilac, nalaz, zakljucak, sljedeca_do, uneo_korisnik_id)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [ulaz.vrsta, ulaz.datum, izvrsilac, ulaz.nalaz.trim(), ulaz.zakljucak, sljedeca, korisnikId],
    );
    await logKreiranje(klijent, { korisnikId, entitetTip: "verifikacija_sistema", entitetId: r.rows[0].id, noveVrijednosti: ulaz });
    // Revizija koja traži izmjene nije završena dok se izmjene ne sprovedu (čl. 36 st. 2).
    if (ulaz.zakljucak === "POTREBNE_IZMJENE") {
      await kreirajZadatak(klijent, {
        naslov: `Sprovesti izmjene — ${VRSTE_VERIFIKACIJE[ulaz.vrsta].naziv.toLowerCase()} ${ulaz.datum.split("-").reverse().join(".")}.`,
        opis: ulaz.nalaz.trim(),
        prioritet: "SREDNJI",
        izvorTip: "verifikacija_sistema",
        izvorId: r.rows[0].id,
      });
    }
    return { id: r.rows[0].id, sljedecaDo: sljedeca };
  });
}

// ─── HACCP plan za štampu ────────────────────────────────────────────────────────────────────────

export async function haccpPlan() {
  const [firma, tacke, pravila, plan, uredjaji, verifikacija] = await Promise.all([
    upit(`select naziv, adresa, grad, pib, odgovorno_lice_ime from firma limit 1`),
    upit(`select id, sifra, naziv, opis, opasnost, korektivna_mjera, verifikacija from kontrolna_tacka where aktivan order by sifra`),
    upit(
      `select p.kontrolna_tacka_id, p.artikal_id, a.naziv as artikal_naziv, a.granica_potvrdio, p.min_vrijednost, p.max_vrijednost, p.jedinica,
              p.verzija, to_char(p.vazi_od at time zone 'Europe/Podgorica', 'DD.MM.YYYY.') as vazi_od
       from pravilo_kontrole p left join artikal a on a.id = p.artikal_id
       where p.aktivan order by p.kontrolna_tacka_id, a.naziv nulls first`,
    ),
    stavkePlana(),
    listaUredjaja(true),
    stanjeVerifikacije(),
  ]);
  return {
    firma: firma.rows[0] ?? null,
    datum: danasCG(),
    kontrolneTacke: tacke.rows.map((t) => ({
      ...t,
      opstaGranica: pravila.rows.find((p) => p.kontrolna_tacka_id === t.id && !p.artikal_id) ?? null,
      granicePoArtiklu: pravila.rows.filter((p) => p.kontrolna_tacka_id === t.id && p.artikal_id),
      monitoring: plan.filter((s) => s.kontrolna_tacka_id === t.id),
    })),
    ostaliMonitoring: plan.filter((s) => !s.kontrolna_tacka_id),
    uredjaji,
    verifikacija,
  };
}
