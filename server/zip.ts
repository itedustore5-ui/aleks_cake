// ZIP arhiva bez spoljne biblioteke — Node ima i kompresiju (deflate) i kontrolni zbir (crc32).
// Dovoljno za izvoz nekoliko CSV fajlova (inspekcijski paket); nije za velike fajlove (sve u memoriji,
// bez ZIP64 — do 4 GB, a ovdje se radi o megabajtima).
import { crc32, deflateRawSync } from "node:zlib";

export type FajlUZipu = { ime: string; sadrzaj: Buffer | string };

/** Datum i vrijeme u DOS formatu (ZIP ga tako pamti) — po podgoričkom satu (#11). */
function dosVrijeme(d: Date) {
  const dio = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Podgorica", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    })
      .formatToParts(d)
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  return {
    vrijeme: (dio.hour % 24 << 11) | (dio.minute << 5) | Math.floor(dio.second / 2),
    datum: ((dio.year - 1980) << 9) | (dio.month << 5) | dio.day,
  };
}

export function napraviZip(fajlovi: FajlUZipu[], kada = new Date()): Buffer {
  const { vrijeme, datum } = dosVrijeme(kada);
  const lokalni: Buffer[] = [];
  const centralni: Buffer[] = [];
  let pomak = 0;
  for (const f of fajlovi) {
    const ime = Buffer.from(f.ime, "utf8");
    const podaci = typeof f.sadrzaj === "string" ? Buffer.from(f.sadrzaj, "utf8") : f.sadrzaj;
    const sazeto = deflateRawSync(podaci);
    const zbir = crc32(podaci);

    const zaglavlje = Buffer.alloc(30);
    zaglavlje.writeUInt32LE(0x04034b50, 0);
    zaglavlje.writeUInt16LE(20, 4); // verzija potrebna za raspakivanje
    zaglavlje.writeUInt16LE(0x0800, 6); // imena fajlova u UTF-8 (č, ć, š…)
    zaglavlje.writeUInt16LE(8, 8); // deflate
    zaglavlje.writeUInt16LE(vrijeme, 10);
    zaglavlje.writeUInt16LE(datum, 12);
    zaglavlje.writeUInt32LE(zbir, 14);
    zaglavlje.writeUInt32LE(sazeto.length, 18);
    zaglavlje.writeUInt32LE(podaci.length, 22);
    zaglavlje.writeUInt16LE(ime.length, 26);
    zaglavlje.writeUInt16LE(0, 28);
    lokalni.push(zaglavlje, ime, sazeto);

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(vrijeme, 12);
    c.writeUInt16LE(datum, 14);
    c.writeUInt32LE(zbir, 16);
    c.writeUInt32LE(sazeto.length, 20);
    c.writeUInt32LE(podaci.length, 24);
    c.writeUInt16LE(ime.length, 28);
    // 30–41: dodatak, komentar, disk, atributi — nule
    c.writeUInt32LE(pomak, 42);
    centralni.push(c, ime);

    pomak += zaglavlje.length + ime.length + sazeto.length;
  }
  const dir = Buffer.concat(centralni);
  const kraj = Buffer.alloc(22);
  kraj.writeUInt32LE(0x06054b50, 0);
  kraj.writeUInt16LE(fajlovi.length, 8);
  kraj.writeUInt16LE(fajlovi.length, 10);
  kraj.writeUInt32LE(dir.length, 12);
  kraj.writeUInt32LE(pomak, 16);
  return Buffer.concat([...lokalni, dir, kraj]);
}
