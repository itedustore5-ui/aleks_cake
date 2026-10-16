// Aplikacija na LOKALNOJ probnoj bazi sa demo podacima — da se ekrani proklikaju bez diranja žive
// (Render/Supabase) baze. Talas 5: dosad su faza 3 i talas 3 provjereni samo kroz API.
//
//   npm run demo:lokalno            → http://localhost:5059 (prijava demo nalozima, npr. ana.b / Podgorica-2026!)
//   PORT=5070 npm run demo:lokalno
//
// Isti klaster kao npm test (.testbaza/, port 54329), ali posebna baza „pilot_lokalno“ — svaki put čista.
// Ne pokretati istovremeno sa npm test (test gasi klaster na kraju). Ctrl+C gasi i server i bazu.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const korijen = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT_APP = Number(process.env.PORT) || 5059;
const PORT_BAZE = 54329;
const FOLDER_BAZE = path.join(korijen, ".testbaza");
const URL = `postgres://postgres@localhost:${PORT_BAZE}/pilot_lokalno`;

function pgAlat(ime) {
  const exe = process.platform === "win32" ? `${ime}.exe` : ime;
  if (process.env.PG_BIN) return path.join(process.env.PG_BIN, exe);
  const osnova = "C:/Program Files/PostgreSQL";
  if (process.platform === "win32" && fs.existsSync(osnova)) {
    const verzije = fs.readdirSync(osnova).filter((v) => /^\d+$/.test(v)).sort((a, b) => Number(b) - Number(a));
    for (const v of verzije) if (fs.existsSync(path.join(osnova, v, "bin", exe))) return path.join(osnova, v, "bin", exe);
  }
  return exe;
}

const pgCtl = pgAlat("pg_ctl");
if (!fs.existsSync(path.join(FOLDER_BAZE, "PG_VERSION"))) {
  console.error("Nema lokalnog klastera — pokrenite jednom `npm test` (napravi ga), pa ponovo ovo.");
  process.exit(1);
}
if (spawnSync(pgCtl, ["-D", FOLDER_BAZE, "status"], { stdio: "ignore" }).status !== 0) {
  const r = spawnSync(pgCtl, ["-D", FOLDER_BAZE, "-o", `-p ${PORT_BAZE} -c listen_addresses=localhost`, "-l", path.join(FOLDER_BAZE, "log.txt"), "-w", "-t", "60", "start"], { stdio: "ignore" });
  if (r.status !== 0) throw new Error(`Lokalna baza nije krenula (port ${PORT_BAZE} zauzet?).`);
}
const admin = new pg.Client({ connectionString: `postgres://postgres@localhost:${PORT_BAZE}/postgres` });
await admin.connect();
await admin.query("drop database if exists pilot_lokalno with (force)");
await admin.query("create database pilot_lokalno");
await admin.end();

console.log("■ dopune baze + demo podaci");
const m = spawnSync(process.execPath, ["--import", "tsx", "db/migriraj.ts", "--demo"], { cwd: korijen, env: { ...process.env, DATABASE_URL: URL }, stdio: ["ignore", "ignore", "inherit"] });
if (m.status !== 0) throw new Error("Dopune baze nisu prošle.");

console.log(`■ aplikacija na http://localhost:${PORT_APP} (lokalna probna baza — demo nalozi sa početnim lozinkama iz testovi/pomoc.mjs)`);
const server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
  cwd: korijen,
  env: { ...process.env, DATABASE_URL: URL, PORT: String(PORT_APP), NODE_ENV: "development", SAMO_API: "", OBAVEZNA_2FA: process.env.OBAVEZNA_2FA ?? "" },
  stdio: "inherit",
});
const ugasi = () => {
  if (server.exitCode === null) server.kill();
  spawnSync(pgCtl, ["-D", FOLDER_BAZE, "-m", "fast", "stop"], { stdio: "ignore" });
  process.exit(0);
};
process.on("SIGINT", ugasi);
process.on("SIGTERM", ugasi);
server.on("exit", () => ugasi());
