// npm run bekap — pravi bekap VAN Supabase-a: pg_dump svake baze iz alati/klijenti.txt (ili, ako
// tog fajla nema, baze iz DATABASE_URL u .env) u folder bekap/<klijent>/.
//
// Zašto ovo postoji: bekap sa table (bekap_log) stoji u ISTOJ bazi — štiti od greške u aplikaciji,
// ali ne od gubitka same baze. Ovo je kopija na računaru konsultantkinje.
//
// Svaki bekap se odmah provjeri (pg_restore --list mora da ga pročita i nađe podatke tabela).
// Stariji od 90 dana se brišu. Izlazni kod 1 ako ijedan klijent nije uspio — za Task Scheduler.
//
// Vraćanje (u NOVU, praznu bazu — nikad preko žive):
//   pg_restore --no-owner --no-privileges --dbname "<adresa nove baze>" bekap/<klijent>/<fajl>.dump
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const KORIJEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FOLDER = process.env.BEKAP_FOLDER || path.join(KORIJEN, "bekap");
const CUVAJ_DANA = 90;

/** pg_dump mora biti iste ili novije verzije od servera — uzima se najnovija instalirana. */
function nadjiAlat(ime: "pg_dump" | "pg_restore"): string {
  const izEnv = process.env[ime === "pg_dump" ? "PG_DUMP" : "PG_RESTORE"];
  if (izEnv) return izEnv;
  const windows = "C:/Program Files/PostgreSQL";
  if (fs.existsSync(windows)) {
    const verzije = fs.readdirSync(windows).filter((d) => /^\d+$/.test(d)).sort((a, b) => Number(b) - Number(a));
    for (const v of verzije) {
      const p = path.join(windows, v, "bin", `${ime}.exe`);
      if (fs.existsSync(p)) return p;
    }
  }
  return ime; // iz PATH-a
}

function klijenti(): { naziv: string; url: string }[] {
  const fajl = path.join(KORIJEN, "alati", "klijenti.txt");
  if (fs.existsSync(fajl)) {
    return fs
      .readFileSync(fajl, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return { naziv: l.slice(0, i).trim(), url: l.slice(i + 1).trim() };
      });
  }
  if (process.env.DATABASE_URL) return [{ naziv: "tekuca-baza", url: process.env.DATABASE_URL }];
  return [];
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[šś]/g, "s")
    .replace(/[čć]/g, "c")
    .replace(/ž/g, "z")
    .replace(/đ/g, "dj")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "klijent";

const oznakaVremena = () => {
  const d = new Date();
  const dvije = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dvije(d.getMonth() + 1)}-${dvije(d.getDate())}_${dvije(d.getHours())}${dvije(d.getMinutes())}`;
};

/** Lozinka ide kroz PGPASSWORD, ne kroz komandnu liniju (vidljiva drugim procesima). */
function bezLozinke(url: string): { adresa: string; lozinka: string } {
  const u = new URL(url);
  const lozinka = decodeURIComponent(u.password);
  u.password = "";
  return { adresa: u.toString(), lozinka };
}

function obrisiStare(folder: string): number {
  const granica = Date.now() - CUVAJ_DANA * 86_400_000;
  let obrisano = 0;
  for (const f of fs.readdirSync(folder)) {
    const p = path.join(folder, f);
    if (f.endsWith(".dump") && fs.statSync(p).mtimeMs < granica) {
      fs.unlinkSync(p);
      obrisano++;
    }
  }
  return obrisano;
}

const pgDump = nadjiAlat("pg_dump");
const pgRestore = nadjiAlat("pg_restore");
const spisak = klijenti();
if (spisak.length === 0) {
  console.error("Nema nijednog klijenta: ni alati/klijenti.txt ni DATABASE_URL u .env.");
  process.exit(1);
}

const izvjestaj: string[] = [`Bekap ${new Date().toLocaleString("sr-Latn-ME")} — ${pgDump}`];
let pali = 0;

for (const k of spisak) {
  const folder = path.join(FOLDER, slug(k.naziv));
  fs.mkdirSync(folder, { recursive: true });
  const fajl = path.join(folder, `${slug(k.naziv)}-${oznakaVremena()}.dump`);
  const { adresa, lozinka } = bezLozinke(k.url);

  // Samo šema public (Supabase ima i svoje sistemske šeme). Sesije se ne kopiraju — to su živi
  // tokeni prijave i ne smiju ležati u fajlu na disku; tabela ostaje, prazna.
  const argumenti = ["--format=custom", "--schema=public", "--exclude-table-data=public.sesija_prijave", "--exclude-table-data=public.prijava_izazov", "--exclude-table-data=public.bekap_log", "--no-owner", "--no-privileges"];
  const dump = spawnSync(pgDump, [...argumenti, "--file", fajl, "--dbname", adresa], {
    encoding: "utf8",
    env: { ...process.env, PGPASSWORD: lozinka },
  });
  if (dump.error || dump.status !== 0 || !fs.existsSync(fajl) || fs.statSync(fajl).size === 0) {
    pali++;
    // Poruka pg_dump-a može sadržati adresu baze — ispisuje se bez lozinke (lozinka nije ni bila u njoj).
    const razlog = (dump.error?.message ?? dump.stderr ?? "").trim().split("\n").slice(-2).join(" ");
    izvjestaj.push(`✗ ${k.naziv}: NIJE USPIO — ${razlog || "nepoznat razlog"}`);
    if (fs.existsSync(fajl)) fs.unlinkSync(fajl);
    continue;
  }

  // Provjera: bekap koji se ne može pročitati nije bekap.
  const lista = spawnSync(pgRestore, ["--list", fajl], { encoding: "utf8" });
  const tabelaSaPodacima = (lista.stdout ?? "").split("\n").filter((l) => l.includes("TABLE DATA")).length;
  if (lista.status !== 0 || tabelaSaPodacima === 0) {
    pali++;
    izvjestaj.push(`✗ ${k.naziv}: fajl napravljen, ali se NE MOŽE PROČITATI (${fajl})`);
    continue;
  }

  const mb = (fs.statSync(fajl).size / 1024 / 1024).toFixed(2);
  const obrisano = obrisiStare(folder);
  izvjestaj.push(`✓ ${k.naziv}: ${path.relative(KORIJEN, fajl)} · ${mb} MB · ${tabelaSaPodacima} tabela sa podacima${obrisano ? ` · obrisano starih: ${obrisano}` : ""}`);
}

izvjestaj.push(pali === 0 ? "Sve uspjelo." : `NIJE USPJELO: ${pali} od ${spisak.length}.`);
fs.mkdirSync(FOLDER, { recursive: true });
fs.writeFileSync(path.join(FOLDER, "POSLJEDNJI-BEKAP.txt"), izvjestaj.join("\n") + "\n");
console.log(izvjestaj.join("\n"));
process.exit(pali === 0 ? 0 : 1);
