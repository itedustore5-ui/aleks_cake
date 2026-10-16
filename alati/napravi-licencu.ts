// Generiše licencni ključ za ugovor sa klijentom. Aplikacija ga NE provjerava automatski —
// ovo je administrativni trag (koji klijent, od kad), ne tehnička brava.
// Upotreba: node alati/napravi-licencu.ts "Naziv klijenta"
import crypto from "node:crypto";

const nazivKlijenta = process.argv[2];
if (!nazivKlijenta) {
  console.error('Upotreba: node alati/napravi-licencu.ts "Naziv klijenta"');
  process.exit(1);
}

const datumIzdavanja = new Date().toISOString().slice(0, 10);
const sirovo = `${nazivKlijenta}|${datumIzdavanja}`;
const potpis = crypto.createHash("sha256").update(sirovo).digest("hex").slice(0, 12).toUpperCase();

console.log(`\nKlijent: ${nazivKlijenta}`);
console.log(`Datum izdavanja: ${datumIzdavanja}`);
console.log(`Licencni ključ: PILOT-${potpis}\n`);
