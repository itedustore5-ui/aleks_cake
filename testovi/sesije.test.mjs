// Prijave u bazi (db/20): sesija je u bazi kao heš, odjava je poništava, promjena lozinke odjavljuje
// sve DRUGE uređaje. Radi na privremenom nalogu koji sam otvori i obriše — demo nalozi se ne diraju,
// da test ne odjavi nekoga ko baš tada radi u demo aplikaciji.
import crypto from "node:crypto";
import { pool, prijava, NALOZI } from "./pomoc.mjs";

export const naziv = "Prijave u bazi";

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const ime = `e2e.sesija.${crypto.randomBytes(3).toString("hex")}`;
  let nalogId = null;

  try {
    const nalog = await ana("/nalozi", { telo: { korisnickoIme: ime, uloga: "operater" } });
    nalogId = nalog.tijelo?.id;
    provjeri("Privremeni nalog za test", nalog.status === 201);
    const lozinka = nalog.tijelo.privremenaLozinka;

    const uredjaj1 = await prijava({ ime, lozinka, id: nalogId });
    const uredjaj2 = await prijava({ ime, lozinka, id: nalogId });
    const uredjaj3 = await prijava({ ime, lozinka, id: nalogId });
    const redovi = (await pool.query(`select token_hash from sesija_prijave where korisnik_id = $1`, [nalogId])).rows;
    provjeri("Tri prijave = tri sesije u bazi", redovi.length === 3);
    provjeri("U bazi je heš tokena, ne token", redovi.every((r) => /^[0-9a-f]{64}$/.test(r.token_hash)));

    await uredjaj1("/auth/odjava", { method: "POST" });
    provjeri("Odjava poništava samo tu prijavu", (await uredjaj1("/auth/ja")).status === 401 && (await uredjaj2("/auth/ja")).status === 200);

    const promjena = await uredjaj2("/auth/promijeni-lozinku", { telo: { staraLozinka: lozinka, novaLozinka: "E2E-nova-lozinka-2026" } });
    provjeri("Promjena lozinke", promjena.status === 204, `${promjena.status}`);
    provjeri("Uređaj na kom je promijenjena ostaje prijavljen", (await uredjaj2("/auth/ja")).status === 200);
    provjeri("Ostali uređaji su odjavljeni", (await uredjaj3("/auth/ja")).status === 401);

    await ana(`/nalozi/${nalogId}/deaktiviraj`, { method: "PATCH", telo: {} });
    provjeri("Deaktivacija naloga odjavljuje i posljednji uređaj", (await uredjaj2("/auth/ja")).status === 401);
  } finally {
    if (nalogId) {
      await pool.query(`delete from sesija_prijave where korisnik_id = $1`, [nalogId]);
      await pool.query(`delete from audit_log where entitet_id = $1 or korisnik_id = $1`, [nalogId]);
      await pool.query(`delete from korisnik where id = $1`, [nalogId]);
    }
  }
}
