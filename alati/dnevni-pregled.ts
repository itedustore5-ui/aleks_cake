// Dnevni pregled stanja SVIH klijenata — pokreće se ručno (ili iz Task Scheduler-a) sa
// računara konsultantkinje. Čita alati/klijenti.txt ("Naziv = postgresql://..." po redu; drugi fajl:
// KLIJENTI_FAJL=); bez tog fajla gleda samo DATABASE_URL iz .env. Izlazni kod 1 ako je neko u zastoju
// ili mu je baza blizu granice (BAZA_UPOZORENJE_MB, podrazumijevano 400 — besplatni Supabase na 500 MB
// prelazi u „samo čitanje“ i aplikacija više ne prima upise; za klijenta na plaćenom planu postaviti više).
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { migracijeNaCekanju } from "../server/migracije.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const FAJL_KLIJENATA = process.env.KLIJENTI_FAJL || path.join(dir, "klijenti.txt");
const UPOZORENJE_MB = Number(process.env.BAZA_UPOZORENJE_MB) || 400;
const MB = (b: string | number | null) => Math.round(Number(b ?? 0) / 1048576);

async function ucitajKlijente(): Promise<{ naziv: string; url: string }[]> {
  try {
    const sadrzaj = await fs.readFile(FAJL_KLIJENATA, "utf8");
    return sadrzaj
      .split("\n")
      .map((red) => red.trim())
      .filter((red) => red && !red.startsWith("#"))
      .map((red) => {
        // Samo PRVI znak „=“ dijeli naziv od adrese — adresa baze i sama može imati „=“ (?sslmode=require).
        const i = red.indexOf("=");
        return { naziv: red.slice(0, i).trim(), url: red.slice(i + 1).trim() };
      });
  } catch {
    if (!process.env.DATABASE_URL) throw new Error("Nema alati/klijenti.txt ni DATABASE_URL u .env.");
    return [{ naziv: "ova instanca", url: process.env.DATABASE_URL }];
  }
}

async function provjeriKlijenta(naziv: string, url: string): Promise<boolean> {
  const pool = new Pool({ connectionString: url, ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false } });
  try {
    const zadnjiZapis = await pool.query<{ max: string | null }>(`select max(created_at) from zapis`);
    const zadnjaIsporuka = await pool.query<{ max: string | null }>(`select max(created_at) from isporuka`);
    const otvoreneNc = await pool.query<{ broj: string }>(`select count(*) as broj from neusaglasenost where status not in ('ZATVORENA')`);

    const poslednja = [zadnjiZapis.rows[0].max, zadnjaIsporuka.rows[0].max].filter(Boolean).sort().pop();
    const danaOdZadnjeg = poslednja ? Math.floor((Date.now() - new Date(poslednja).getTime()) / 86400000) : null;
    const uZastoju = danaOdZadnjeg === null || danaOdZadnjeg > 2;

    // Talas 5: greške servera i ekrana (dnevnik #80), dopune baze koje nisu primijenjene (#79) i
    // nalozi vodstva bez potvrde u dva koraka (#81). Stara baza bez tih tabela — samo se preskoči.
    const napomene: string[] = [];
    let problem = false;
    try {
      const g = (await pool.query<{ n: number; zadnja: string | null }>(
        `select count(*)::int as n, (array_agg(left(poruka, 80) order by vrijeme desc))[1] as zadnja from greska_log where vrijeme > now() - interval '24 hours'`,
      )).rows[0];
      if (g.n > 0) napomene.push(`grešaka 24 h: ${g.n} (posljednja: ${g.zadnja})`);
    } catch {
      napomene.push("dnevnik grešaka još ne postoji (dopuna 33)");
    }
    try {
      const fale = await migracijeNaCekanju(pool);
      if (fale.length) {
        problem = true;
        napomene.push(`NEPRIMIJENJENE DOPUNE: ${fale.join(", ")}`);
      }
    } catch {
      // bez schema_migracije — javiće se kao greška povezivanja ili prazna baza
    }
    try {
      const bez2fa = (await pool.query<{ ime: string }>(
        `select korisnicko_ime as ime from korisnik where aktivan and uloga in ('izvodjac', 'bzr') and totp_ukljucen_at is null order by 1`,
      )).rows.map((r) => r.ime);
      if (bez2fa.length) napomene.push(`bez potvrde u dva koraka: ${bez2fa.join(", ")}`);
    } catch {
      // kolone 2FA još nema (dopuna 33)
    }

    // Veličina baze (04.10.2026): fotografije otpremnica su u bazi i najbrže je pune.
    const v = (await pool.query<{ baza: string; otpremnice: string | null }>(
      `select pg_database_size(current_database())::bigint as baza,
              case when to_regclass('public.prijem_dokument') is null then null else pg_total_relation_size('public.prijem_dokument') end as otpremnice`,
    )).rows[0];
    const bazaMb = MB(v.baza);
    if (bazaMb >= UPOZORENJE_MB) {
      problem = true;
      napomene.push(`BAZA ${bazaMb} MB (granica upozorenja ${UPOZORENJE_MB} MB) — besplatni Supabase na 500 MB prestaje da prima upise: pređite na Pro`);
    }

    const znak = uZastoju || problem ? "⚠" : "✓";
    const dodatak = napomene.map((n) => `\n    ${n}`).join("");
    const velicina = `baza ${bazaMb} MB${v.otpremnice !== null ? ` (otpremnice ${MB(v.otpremnice)} MB)` : ""}`;
    console.log(`${znak} ${naziv}: poslednji unos ${danaOdZadnjeg === null ? "nikad" : `prije ${danaOdZadnjeg} dana`}, otvorenih NC: ${otvoreneNc.rows[0].broj}, ${velicina}${dodatak}`);
    return !uZastoju && !problem;
  } catch (greska) {
    console.log(`✗ ${naziv}: greška pri povezivanju — ${(greska as Error).message}`);
    return false;
  } finally {
    await pool.end();
  }
}

async function main() {
  const klijenti = await ucitajKlijente();
  let sveDobro = true;
  for (const klijent of klijenti) {
    const dobro = await provjeriKlijenta(klijent.naziv, klijent.url);
    sveDobro = sveDobro && dobro;
  }
  process.exit(sveDobro ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
