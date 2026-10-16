import "dotenv/config";
import { Pool } from "pg";
import { primijeniMigracije } from "../server/migracije.js";

const zeliDemo = process.argv.includes("--demo");

// Demo nalozi postoje samo na demo bazi (db/13_demo_cg.sql, fiksni heševi). Početne lozinke su iste kao
// u testovima — na demo bazi koju vide drugi ljudi odmah ih promijeniti: `npm run demo-lozinke`.
const DEMO_NALOZI = [
  { korisnickoIme: "konsultant", uloga: "izvodjac" },
  { korisnickoIme: "ana.b", uloga: "bzr" },
  { korisnickoIme: "marko.v", uloga: "operater" },
  { korisnickoIme: "petar.j", uloga: "vozac" },
  { korisnickoIme: "direktor", uloga: "uprava" },
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL nije podešen u .env.");
  const pool = new Pool({ connectionString, ssl: connectionString.includes("localhost") ? undefined : { rejectUnauthorized: false } });
  try {
    await primijeniMigracije(pool, { demo: zeliDemo, ispis: (red) => console.log(red) });
  } finally {
    await pool.end();
  }

  if (zeliDemo) {
    console.log("\nDemo nalozi (SAMO za demo bazu — nikad na pravoj bazi klijenta):");
    for (const nalog of DEMO_NALOZI) console.log(`  ${nalog.korisnickoIme.padEnd(12)} (${nalog.uloga})`);
    console.log("Početne lozinke su iste kao u testovima (testovi/pomoc.mjs). Demo koji vide drugi: npm run demo-lozinke\n");
  }
  console.log("Gotovo.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
