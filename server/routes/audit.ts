import { Router } from "express";
import { upit } from "../db.js";
import { asyncRuta } from "../greske.js";
import { requireUloga } from "../auth.js";

export const auditRuter = Router();
// Provjera važi SAMO za adrese ovog rutera. Ruter je montiran na zajednički "/api", pa bi
// .use(...) bez putanje važio za SVAKI zahtjev koji prođe kroz njega — i zaključao bi rute
// registrovane poslije (ovako je uprava dobijala 403 na /api/tabla).

// Filteri (01.10.2026): period (dan po Podgorici — #11), ko, šta (akcija), nad čim (entitet) i tekst u
// vrijednostima. Bez filtera — posljednjih 500 promjena.
const tekst = (v: unknown, max = 200) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null);
const dan = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const uuid = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

auditRuter.get(
  "/audit",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request, response) => {
    const q = request.query;
    const rezultat = await upit(
      `select a.*, k.korisnicko_ime, coalesce(l.ime, k.korisnicko_ime) as korisnik_ime
       from audit_log a left join korisnik k on k.id = a.korisnik_id left join lice l on l.id = k.lice_id
       where ($1::text is null or a.entitet_tip = $1)
         and ($2::text is null or a.akcija = $2)
         and ($3::uuid is null or a.korisnik_id = $3)
         and ($4::date is null or (a.created_at at time zone 'Europe/Podgorica')::date >= $4)
         and ($5::date is null or (a.created_at at time zone 'Europe/Podgorica')::date <= $5)
         and ($6::text is null or concat_ws(' ', a.stare_vrijednosti::text, a.nove_vrijednosti::text) ilike '%' || $6 || '%')
       order by a.created_at desc limit 500`,
      [tekst(q.entitetTip, 60), tekst(q.akcija, 40), uuid(q.korisnikId), dan(q.od), dan(q.do), tekst(q.q)],
    );
    response.json(rezultat.rows);
  }),
);

/** Vrijednosti za spiskove filtera — šta u dnevniku uopšte postoji. */
auditRuter.get(
  "/audit/filteri",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (_request, response) => {
    const [tipovi, akcije, korisnici] = await Promise.all([
      upit<{ v: string }>(`select distinct entitet_tip as v from audit_log order by 1`),
      upit<{ v: string }>(`select distinct akcija as v from audit_log order by 1`),
      upit<{ id: string; ime: string }>(
        `select distinct k.id, coalesce(l.ime, k.korisnicko_ime) as ime from audit_log a join korisnik k on k.id = a.korisnik_id
         left join lice l on l.id = k.lice_id order by 2`,
      ),
    ]);
    response.json({ tipovi: tipovi.rows.map((r) => r.v), akcije: akcije.rows.map((r) => r.v), korisnici: korisnici.rows });
  }),
);
