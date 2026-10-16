import { pool, tabelaPostoji, transakcija } from "../db.js";
import { obavijestiUlogu } from "./zadaciService.js";

/** Sve poslovne tabele — u istom redoslijedu kao db/*.sql. Namjerno bez schema_migracije
 * (samo bookkeeping migracija, ne podatak) i bez pogleda (izvode se iz ovih tabela).
 * Bez TAJNI (nalaz R-19): ovaj bekap se preuzima na računar i šalje dalje, pa u njega ne ide ništa
 * čime se može ući u aplikaciju — sesije (živi tokeni), heševi lozinki, privatni VAPID ključ,
 * ključevi uređaja za push, ključevi zahtjeva. Pun bekap baze (sa svim) je `npm run bekap` (pg_dump). */
const TABELE = [
  "firma", "korisnik", "lice",
  "dobavljac", "kupac", "artikal", "razlog_sifra", "opasnost_sifra",
  "prijem", "prijem_stavka", "lot", "zaliha", "kretanje_zalihe",
  "kontrolna_tacka", "pravilo_kontrole", "mjerenje_temperature", "zapis",
  "neusaglasenost", "korektivna_mjera", "verifikacija",
  "vozilo", "kontrola_vozila", "isporuka", "isporuka_stavka",
  "zadatak", "obavjestenje", "dogadjaj", "audit_log",
  "pitanje", "sesija_znanja", "ucesnik_znanja", "odgovor_znanja",
  "plan_obuke", "povlacenje", "povlacenje_kontakt",
  "skladiste", "poruka",
  "prijem_dokument", "artikal_dobavljaca",
  "plan_monitoringa", "mjerni_uredjaj", "provjera_uredjaja", "verifikacija_sistema",
  "izvjestaj_poslat",
] as const;
// Kolone koje ne idu u bekap: heš lozinke (tajna) i sam fajl otpremnice (velik — on je u pg_dump bekapu).
const BEZ_KOLONA: Partial<Record<(typeof TABELE)[number], string[]>> = {
  korisnik: ["lozinka_hash", "totp_tajna", "totp_rezervni", "totp_zadnji_korak"],
  prijem_dokument: ["sadrzaj"],
};

type BekapMeta = { id: string; tip: string; broj_tabela: number; broj_redova: number; velicina_bajtova: number | null; created_at: string };

/** Bekap iz aplikacije se PREUZIMA, ne čuva u bazi (04.10.2026). Ranije je svaki — i sedmični
 * automatski — bio puna kopija podataka u ISTOJ bazi, 90 dana: trošio je prostor (besplatni Supabase
 * ima 500 MB i tada prestaje da prima upise), a od gubitka baze ne štiti (ista je baza). Sada se JSON
 * piše direktno u odgovor, tabelu po tabelu (u memoriji je najviše jedna tabela), a u `bekap_log`
 * ostaje samo ko je i kad preuzeo. `pisi` vraća obećanje kad odgovor može da primi još (backpressure). */
export async function pisiBekap(pisi: (dio: string) => Promise<void> | void, korisnikId: string): Promise<BekapMeta> {
  let ukupnoRedova = 0;
  let bajtova = 0;
  const izlaz = async (dio: string) => {
    bajtova += Buffer.byteLength(dio);
    await pisi(dio);
  };
  // Sve tabele iz JEDNOG snimka baze (repeatable read) — inače isporuka upisana usred bekapa može
  // ući bez svojih stavki, ili stavke bez isporuke.
  await transakcija(async (klijent) => {
    await klijent.query("set transaction isolation level repeatable read, read only");
    let prva = true;
    await izlaz("{");
    for (const tabela of TABELE) {
      // Tabela iz dopune koja na ovoj bazi još nije pokrenuta ne smije da obori cio bekap.
      if (!(await tabelaPostoji(tabela))) continue;
      // JSON pravi baza (jedan tekst po tabeli) — server ne drži hiljade objekata u memoriji.
      const r = await klijent.query<{ n: number; json: string }>(
        `select count(*)::int as n, coalesce(jsonb_agg(to_jsonb(t) - $1::text[]), '[]'::jsonb)::text as json from ${tabela} t`,
        [BEZ_KOLONA[tabela] ?? []],
      );
      ukupnoRedova += r.rows[0].n;
      await izlaz(`${prva ? "" : ","}\n${JSON.stringify(tabela)}:${r.rows[0].json}`);
      prva = false;
    }
    await izlaz("\n}\n");
  });

  const upisano = await pool.query<{ id: string; created_at: string }>(
    `insert into bekap_log (tip, pokrenuo_korisnik_id, broj_tabela, broj_redova, velicina_bajtova)
     values ('RUCNI', $1, $2, $3, $4) returning id, created_at`,
    [korisnikId, TABELE.length, ukupnoRedova, bajtova],
  );
  return { id: upisano.rows[0].id, tip: "RUCNI", broj_tabela: TABELE.length, broj_redova: ukupnoRedova, velicina_bajtova: bajtova, created_at: upisano.rows[0].created_at };
}

export async function poslednjiBekap(): Promise<BekapMeta | null> {
  const r = await pool.query<BekapMeta>(
    `select id, tip, broj_tabela, broj_redova, velicina_bajtova, created_at from bekap_log order by created_at desc limit 1`,
  );
  return r.rows[0] ?? null;
}

export async function istorijaBekapa(limit = 12): Promise<BekapMeta[]> {
  const r = await pool.query<BekapMeta>(
    `select id, tip, broj_tabela, broj_redova, velicina_bajtova, created_at from bekap_log order by created_at desc limit $1`,
    [limit],
  );
  return r.rows;
}

/** Sedmični PODSJETNIK (ranije: sedmična kopija u bazi). Ako niko nije preuzeo bekap 7 dana, odgovorno
 * lice dobija obavještenje — najviše jednom u 7 dana. Provjerava pri startu i jednom dnevno; oslanja se na
 * vrijeme upisano u bazi, pa radi i kad Render besplatni plan uspava server. */
export function pokreniSedmicniBekap() {
  const provjeri = async () => {
    try {
      const r = await pool.query<{ preuzet: boolean; podsjecen: boolean }>(
        `select exists (select 1 from bekap_log where created_at > now() - interval '7 days') as preuzet,
                exists (select 1 from obavjestenje where izvor_tip = 'bekap_log' and created_at > now() - interval '7 days') as podsjecen`,
      );
      if (r.rows[0].preuzet || r.rows[0].podsjecen) return;
      await obavijestiUlogu(pool, "bzr", {
        naslov: "Preuzmite sedmični bekap",
        poruka: "Kontrolni centar → „Preuzmi bekap sada“ (kartica na dnu). Fajl sačuvajte van telefona i aplikacije — npr. na računaru firme.",
        izvorTip: "bekap_log",
      });
    } catch (greska) {
      console.error("Podsjetnik za bekap nije poslat:", greska);
    }
  };

  provjeri();
  setInterval(provjeri, 24 * 60 * 60 * 1000);
}
