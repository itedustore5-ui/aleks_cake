// Testovi na SOPSTVENOJ bazi — ne na demo bazi koju koristi Render (nalaz A5, faza 4).
//
// npm test                  — privremena baza na ovom računaru: PostgreSQL iz C:/Program Files/PostgreSQL
//                             (ili PG_BIN=), sopstveni klaster u .testbaza/ na portu 54329, bez lozinke,
//                             samo za localhost. Vaši postojeći PostgreSQL servisi se ne diraju.
// npm test -- povlacenje    — samo testovi čiji naziv fajla sadrži "povlacenje"
// npm run test:ci           — isto, ali baza je TEST_DATABASE_URL (GitHub Actions daje praznu bazu)
// npm run test:ekrani       — testovi ekrana na telefonu (talas 6): aplikacija se izgradi kao za Render,
//                             server u produkcijskom režimu (service worker, paket po stranama), Chrome
//                             bez prozora u veličini telefona (testovi/ekrani/). `--sve` = API pa ekrani.
//
// Svaki put: čista baza → sve migracije + demo podaci → server na portu 5055 (samo /api) →
// svi testovi → server i baza se gase. Izlazni kod 1 ako išta padne.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const korijen = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lokalno = process.argv.includes("--lokalno");
const samoEkrani = process.argv.includes("--ekrani");
const iEkrani = samoEkrani || process.argv.includes("--sve");
const filter = process.argv.slice(2).find((a) => !a.startsWith("--"));
const PORT_APP = 5055;
const PORT_BAZE = 54329;
const FOLDER_BAZE = path.join(korijen, ".testbaza");
const TSX = ["--import", "tsx"]; // jedan proces (ne tsx CLI koji pravi dijete) — gasi se čisto

const korak = (tekst) => console.log(`\n■ ${tekst}`);

function pgAlat(ime) {
  const exe = process.platform === "win32" ? `${ime}.exe` : ime;
  if (process.env.PG_BIN) return path.join(process.env.PG_BIN, exe);
  const osnova = "C:/Program Files/PostgreSQL";
  if (process.platform === "win32" && fs.existsSync(osnova)) {
    const verzije = fs.readdirSync(osnova).filter((v) => /^\d+$/.test(v)).sort((a, b) => Number(b) - Number(a));
    for (const v of verzije) if (fs.existsSync(path.join(osnova, v, "bin", exe))) return path.join(osnova, v, "bin", exe);
  }
  return exe; // iz PATH-a
}

function izvrsi(alat, args) {
  const r = spawnSync(alat, args, { encoding: "utf8" });
  if (r.error) throw new Error(`${path.basename(alat)} nije pokrenut: ${r.error.message}. PostgreSQL mora biti instaliran (ili postavite PG_BIN=).`);
  if (r.status !== 0) throw new Error(`${path.basename(alat)} ${args.join(" ")}\n${r.stderr || r.stdout}`);
  return r.stdout;
}

const glavnaVerzija = (alat) => Number(/(\d+)\./.exec(izvrsi(alat, ["--version"]))?.[1] ?? 0);

/** Lokalni klaster: napravi ga prvi put, pokreni, i daj čistu bazu pilot_test. */
async function lokalnaBaza() {
  const initdb = pgAlat("initdb");
  const pgCtl = pgAlat("pg_ctl");
  const verzija = glavnaVerzija(initdb);
  const postojeca = fs.existsSync(path.join(FOLDER_BAZE, "PG_VERSION")) ? Number(fs.readFileSync(path.join(FOLDER_BAZE, "PG_VERSION"), "utf8").trim()) : null;
  if (postojeca !== null && postojeca !== verzija) {
    // Klaster iz starije verzije PostgreSQL-a se ne može pokrenuti novom — pravi se iznova (podaci su ionako probni).
    spawnSync(pgCtl, ["-D", FOLDER_BAZE, "-m", "immediate", "stop"], { stdio: "ignore" });
    fs.rmSync(FOLDER_BAZE, { recursive: true, force: true });
  }
  if (!fs.existsSync(path.join(FOLDER_BAZE, "PG_VERSION"))) {
    korak(`pravim test klaster u .testbaza/ (PostgreSQL ${verzija})`);
    // Od verzije 17: ugrađen C.UTF-8 — velika/mala slova rade i za č, ć, š, đ, ž (ilike u pretrazi).
    const jezik = verzija >= 17 ? ["--locale-provider=builtin", "--builtin-locale=C.UTF-8"] : ["--no-locale"];
    izvrsi(initdb, ["-D", FOLDER_BAZE, "-U", "postgres", "-A", "trust", "-E", "UTF8", ...jezik]);
  }
  if (spawnSync(pgCtl, ["-D", FOLDER_BAZE, "status"], { stdio: "ignore" }).status !== 0) {
    korak(`pokrećem test bazu na portu ${PORT_BAZE}`);
    // stdio "ignore": server baze nasljeđuje ručke i inače bi pg_ctl čekao zauvijek.
    const r = spawnSync(pgCtl, ["-D", FOLDER_BAZE, "-o", `-p ${PORT_BAZE} -c listen_addresses=localhost`, "-l", path.join(FOLDER_BAZE, "log.txt"), "-w", "-t", "60", "start"], { stdio: "ignore" });
    if (r.status !== 0) {
      const log = fs.existsSync(path.join(FOLDER_BAZE, "log.txt")) ? fs.readFileSync(path.join(FOLDER_BAZE, "log.txt"), "utf8").slice(-1500) : "";
      throw new Error(`Test baza nije krenula (port ${PORT_BAZE} zauzet?).\n${log}`);
    }
  }
  const admin = new pg.Client({ connectionString: `postgres://postgres@localhost:${PORT_BAZE}/postgres` });
  await admin.connect();
  await admin.query("drop database if exists pilot_test with (force)");
  await admin.query("create database pilot_test");
  await admin.end();
  return {
    url: `postgres://postgres@localhost:${PORT_BAZE}/pilot_test`,
    ugasi: () => spawnSync(pgCtl, ["-D", FOLDER_BAZE, "-m", "fast", "stop"], { stdio: "ignore" }),
  };
}

function nodeProces(args, env, stdio = "inherit") {
  return spawn(process.execPath, args, { cwd: korijen, env: { ...process.env, ...env }, stdio });
}

const zavrsen = (proces) => new Promise((ok) => proces.on("exit", (kod) => ok(kod ?? 1)));

async function sacekajServer(server) {
  const kraj = Date.now() + 60_000;
  let pao = false;
  server.on("exit", () => (pao = true));
  while (Date.now() < kraj && !pao) {
    const r = await fetch(`http://localhost:${PORT_APP}/api/zdravlje`).catch(() => null);
    if (r?.status === 200) return;
    await new Promise((ok) => setTimeout(ok, 500));
  }
  throw new Error(pao ? "Test server se ugasio pri pokretanju (vidi ispis iznad)." : "Test server nije odgovorio za 60 s.");
}

let baza = null;
let server = null;
let kod = 1;
try {
  if (lokalno) {
    baza = await lokalnaBaza();
  } else {
    const url = process.env.TEST_DATABASE_URL;
    // Zaštita: izolovani testovi prave i brišu podatke — samo lokalna baza, nikad Supabase.
    if (!url || !url.includes("localhost")) throw new Error("TEST_DATABASE_URL mora biti lokalna, prazna baza (localhost).");
    baza = { url, ugasi: () => undefined };
  }

  // Kao Supabase: javne uloge Data API-ja (anon, authenticated) i podrazumijevana prava na sve što se
  // napravi u public — da test `bezbjednost_baze` provjeri da ih dopuna 32 stvarno zatvara (R-12).
  const supa = new pg.Client({ connectionString: baza.url });
  await supa.connect();
  await supa.query(`do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  end $$`);
  await supa.query(`grant usage on schema public to anon, authenticated`);
  await supa.query(`alter default privileges in schema public grant all on tables to anon, authenticated`);
  await supa.query(`alter default privileges in schema public grant all on sequences to anon, authenticated`);
  await supa.end();

  korak("migracije + demo podaci");
  const migracije = nodeProces([...TSX, "db/migriraj.ts", "--demo"], { DATABASE_URL: baza.url }, ["ignore", "ignore", "inherit"]);
  if ((await zavrsen(migracije)) !== 0) throw new Error("Migracije nisu prošle na test bazi.");

  if (!samoEkrani) {
    korak(`test server na portu ${PORT_APP}`);
    // SMTP = lažni server testa `stanje` (127.0.0.1:54327, samo dok taj test traje) — pravi mejl nikad ne ide.
    const posta = { SMTP_HOST: "127.0.0.1", SMTP_PORT: "54327", SMTP_KORISNIK: "proba@pilot.test", SMTP_LOZINKA: "proba", SMTP_POSILJALAC: "PILOT proba <proba@pilot.test>" };
    server = nodeProces([...TSX, "server/index.ts"], { DATABASE_URL: baza.url, PORT: String(PORT_APP), SAMO_API: "1", NODE_ENV: "development", ...posta }, ["ignore", "ignore", "inherit"]);
    await sacekajServer(server);

    korak("testovi");
    const testovi = nodeProces(["testovi/pokreni.mjs", ...(filter && !iEkrani ? [filter] : [])], { DATABASE_URL: baza.url, APP_URL: `http://localhost:${PORT_APP}` });
    kod = await zavrsen(testovi);
    server.kill();
    await zavrsen(server);
    server = null;
  }

  if (iEkrani) {
    // Kao na Renderu: izgrađena aplikacija (service worker, spisak za rad bez mreže, paket po stranama)
    // i server u produkcijskom režimu. Dopune su već primijenjene gore.
    korak("gradnja aplikacije (vite build)");
    const gradnja = nodeProces([path.join(korijen, "node_modules/vite/bin/vite.js"), "build", "--logLevel", "warn"], {}, ["ignore", "ignore", "inherit"]);
    if ((await zavrsen(gradnja)) !== 0) throw new Error("Gradnja aplikacije nije uspjela.");
    korak(`server kao na Renderu (produkcija) na portu ${PORT_APP}`);
    server = nodeProces([...TSX, "server/index.ts"], { DATABASE_URL: baza.url, PORT: String(PORT_APP), NODE_ENV: "production", MIGRACIJE_PRI_STARTU: "0" }, ["ignore", "ignore", "inherit"]);
    await sacekajServer(server);
    korak("testovi ekrana (telefon 375 px)");
    const ekrani = nodeProces(["testovi/ekrani/pokreni.mjs", ...(filter ? [filter] : [])], { DATABASE_URL: baza.url, APP_URL: `http://localhost:${PORT_APP}` });
    const kodEkrana = await zavrsen(ekrani);
    kod = samoEkrani ? kodEkrana : Math.max(kod, kodEkrana);
  }
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  kod = 2;
} finally {
  if (server && server.exitCode === null) {
    server.kill();
    await zavrsen(server);
  }
  baza?.ugasi();
}
process.exit(kod);
