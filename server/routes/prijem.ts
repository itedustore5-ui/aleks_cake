import express, { Router } from "express";
import { z } from "zod";
import { upit, pool } from "../db.js";
import { asyncRuta, ApiGreska } from "../greske.js";
import { requireUloga, ogranicenjeDatuma, provjeriProzorUpisa, samoMoje, type AuthZahtjev } from "../auth.js";
import { kljucIzZaglavlja } from "../services/kljucService.js";
import { tijelo, str } from "../validacija.js";
import { kreirajPrijem, donesiOdlukuOLotu, izmijeniStavku, javiNepoznatogDobavljaca } from "../services/prijemService.js";
import { prepoznajVrstu, provjeriVelicinuSlike, pokreniCitanje, stanjeCitanja, prekiniCitanje, dokumentZaCitanje, pripremiOcr } from "../services/otpremnicaService.js";

export const prijemRuter = Router();
prijemRuter.get(
  "/prijem",
  requireUloga("operater", "bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const ogranicenje = ogranicenjeDatuma(request.korisnik!.uloga, "p.datum_prijema");
    const rezultat = await upit(
      `select p.*, d.naziv as dobavljac_naziv, s.naziv as skladiste_naziv,
              (select count(*) from lot l where l.prijem_id = p.id) as broj_stavki,
              exists (select 1 from prijem_dokument pd where pd.prijem_id = p.id) as ima_otpremnicu,
              exists (select 1 from prijem_stavka ps join lot l on l.id = ps.lot_id where ps.prijem_id = p.id and ps.po_otpremnici is not null
                        and ((ps.po_otpremnici->>'kolicina')::numeric is distinct from ps.primljena_kolicina
                             or coalesce(ps.po_otpremnici->>'lot', l.broj_lota) <> l.broj_lota)) as odstupa_od_otpremnice,
              ((p.created_at at time zone 'Europe/Podgorica')::date - p.datum_prijema) as naknadno_dana
       from prijem p join dobavljac d on d.id = p.dobavljac_id left join skladiste s on s.id = p.skladiste_id
       where ${ogranicenje}
       order by p.datum_prijema desc, p.created_at desc`,
    );
    response.json(rezultat.rows);
  }),
);

prijemRuter.get(
  "/prijem/:id",
  requireUloga("operater", "bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    // Magacioner vidi prijem samo u svom prozoru datuma — isto kao lista (R-13).
    const uloga = request.korisnik!.uloga;
    const prijem = await upit(
      `select p.*, d.naziv as dobavljac_naziv, s.naziv as skladiste_naziv from prijem p
       join dobavljac d on d.id = p.dobavljac_id left join skladiste s on s.id = p.skladiste_id
       where p.id = $1 ${samoMoje(uloga) ? `and ${ogranicenjeDatuma(uloga, "p.datum_prijema")}` : ""}`,
      [str(request.params.id)],
    );
    if (!prijem.rows[0]) throw new ApiGreska(404, "PRIJEM_NE_POSTOJI", "Prijem nije pronađen.");
    const stavke = await upit(
      // Temperatura KKT 1 uz stavku: ocjena i granica po kojoj je ocijenjena (iz pravila — #39) i termometar.
      // Odgovorno lice odlučuje o lotu — mora vidjeti šta je izmjereno (ranije se nije vidjelo, 01.10.2026).
      `select ps.*, l.broj_lota, l.status as lot_status, l.rok_trajanja, a.naziv as artikal_naziv, a.temp_kontrolisano,
              m.rezultat as temp_rezultat, m.vrijednost as temp_izmjereno, pk.min_vrijednost as temp_min, pk.max_vrijednost as temp_max,
              u.naziv as temp_termometar
       from prijem_stavka ps join lot l on l.id = ps.lot_id join artikal a on a.id = ps.artikal_id
       left join lateral (
         select x.rezultat, x.vrijednost, x.pravilo_kontrole_id, x.mjerni_uredjaj_id from mjerenje_temperature x
         join kontrolna_tacka kt on kt.id = x.kontrolna_tacka_id
         where x.lot_id = l.id and kt.sifra = 'KKT1' order by x.izmjereno_at limit 1
       ) m on true
       left join pravilo_kontrole pk on pk.id = m.pravilo_kontrole_id
       left join mjerni_uredjaj u on u.id = m.mjerni_uredjaj_id
       where ps.prijem_id = $1 order by a.naziv`,
      [request.params.id],
    );
    const dokumenti = await upit(
      `select id, vrsta, naziv_fajla, mime, velicina, created_at from prijem_dokument where prijem_id = $1 order by created_at`,
      [request.params.id],
    );
    response.json({ ...prijem.rows[0], stavke: stavke.rows, dokumenti: dokumenti.rows });
  }),
);

// Artikal sa spiska ILI nov (roba sa otpremnice koje nema u Šifarnicima) — upisuje se uz prijem, sa
// pretpostavljenom granicom temperature koju odgovorno lice potvrđuje (invarijanta #5, #73).
const noviArtikalSchema = z.object({
  naziv: z.string().trim().min(2, "Upišite naziv novog artikla (kako piše na otpremnici)."),
  jedinicaMjere: z.string().trim().min(1).max(10).default("kom"),
  rezim: z.enum(["rashladjeno", "smrznuto", "bez"]),
});

const stavkaSchema = z.object({
  artikalId: z.string().uuid().optional(),
  noviArtikal: noviArtikalSchema.optional(),
  brojLota: z.string().min(1, "Broj lota je obavezan — bez njega nema sledljivosti."),
  proizvodniDatum: z.string().optional(),
  rokTrajanja: z.string().optional(),
  primljenaKolicina: z.number().positive(),
  temperaturaPrijema: z.number().optional(),
  poOtpremnici: z
    .object({
      sifra: z.string().nullable().optional(),
      naziv: z.string().nullable().optional(),
      kolicina: z.number().nullable().optional(),
      lot: z.string().nullable().optional(),
      rok: z.string().nullable().optional(),
    })
    .optional(),
}).refine((s) => !!s.artikalId !== !!s.noviArtikal, { message: "Za svaku stavku izaberite artikal sa spiska ili upišite novi.", path: ["artikalId"] });

// Dobavljač sa spiska ILI nov (nije u Šifarnicima) — upisuje se u istoj transakciji sa prijemom,
// da roba ne čeka na rampi. Odgovorno lice dobija obavještenje da provjeri podatke.
const noviDobavljacSchema = z.object({
  naziv: z.string().trim().min(2, "Upišite naziv dobavljača (kako piše na otpremnici)."),
  pib: z.string().trim().regex(/^\d{8,13}$/, "PIB se upisuje samo ciframa (pravno lice: 8 cifara).").optional().or(z.literal("")),
});

const noviPrijemSchema = z.object({
  dobavljacId: z.string().uuid().optional(),
  noviDobavljac: noviDobavljacSchema.optional(),
  skladisteId: z.string().uuid().optional(),
  brojDokumenta: z.string().optional(),
  datumPrijema: z.string(),
  napomena: z.string().optional(),
  dokumentId: z.string().uuid().optional(),
  mjerniUredjajId: z.string().uuid().optional(),
  stavke: z.array(stavkaSchema).min(1),
}).refine((u) => !!u.dobavljacId !== !!u.noviDobavljac, { message: "Izaberite dobavljača sa spiska ili upišite novog.", path: ["dobavljacId"] });

// Otpremnica (PDF ili fotografija) → prijedlog prijema. Čita se NA OVOM SERVERU — PDF direktno,
// slika lokalnim OCR-om; ništa ne ide spoljnim servisima. Fajl se čuva (dokaz uz prijem), a veže
// se za prijem tek kad magacioner provjeri i potvrdi. Nepotvrđeni se brišu posle 2 dana.
prijemRuter.post(
  "/prijem/otpremnica",
  requireUloga("operater", "bzr", "izvodjac"),
  express.raw({ type: () => true, limit: "12mb" }),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const sadrzaj = request.body;
    if (!Buffer.isBuffer(sadrzaj) || sadrzaj.length === 0) throw new ApiGreska(400, "FAJL_PRAZAN", "Nije poslat fajl otpremnice.");
    const vrsta = prepoznajVrstu(sadrzaj);
    if (!vrsta) throw new ApiGreska(415, "NEPOZNAT_FAJL", "Pošaljite PDF ili sliku otpremnice (JPG, PNG).");
    if (vrsta.vrsta === "slika") await provjeriVelicinuSlike(sadrzaj);
    let nazivFajla: string | null = null;
    try {
      nazivFajla = decodeURIComponent(String(request.headers["x-naziv-fajla"] ?? "")).slice(0, 200) || null;
    } catch {
      nazivFajla = null;
    }
    await pool.query(`delete from prijem_dokument where prijem_id is null and created_at < now() - interval '2 days'`);
    // Fajl se čuva ODMAH (dokaz uz prijem, i kad se ne pročita), a čita se u pozadini (#76). Kratko se
    // sačeka: PDF i dobra fotografija na jakom serveru završe odmah (201 sa rezultatom); inače 202 i
    // pregledač pita za stanje — magacioner vidi napredak i može preći na ručni unos.
    const dokument = await pool.query<{ id: string }>(
      `insert into prijem_dokument (vrsta, naziv_fajla, mime, velicina, sadrzaj, uneo_korisnik_id)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [vrsta.vrsta, nazivFajla, vrsta.mime, sadrzaj.length, sadrzaj, request.korisnik!.id],
    );
    const dokumentId = dokument.rows[0].id;
    const posao = pokreniCitanje(dokumentId, sadrzaj, vrsta.vrsta);
    const zavrseno = await Promise.race([posao.gotovo.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), CEKAJ_CITANJE_MS))]);
    if (zavrseno && posao.rezultat) {
      response.status(201).json({ status: "gotovo", dokumentId, vrsta: vrsta.vrsta, ...posao.rezultat });
      return;
    }
    response.status(202).json(await stanjeCitanja(dokumentId, request.korisnik!));
  }),
);

/** Koliko zahtjev za čitanje čeka prije nego što kaže „čitam, pitaj kasnije“ (202). */
const CEKAJ_CITANJE_MS = Number(process.env.OTPREMNICA_CEKAJ_MS) || 5000;

// Stanje čitanja: „čitam — prolaz 2, pojačavam kontrast, 23 s“, pa rezultat.
prijemRuter.get(
  "/prijem/otpremnica/:dokumentId/stanje",
  requireUloga("operater", "bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    response.json(await stanjeCitanja(str(request.params.dokumentId), request.korisnik!));
  }),
);

// Magacioner prelazi na ručni unos — čitanje staje (server se oslobađa), fajl ostaje uz prijem.
prijemRuter.post(
  "/prijem/otpremnica/:dokumentId/prekini",
  requireUloga("operater", "bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const dokumentId = str(request.params.dokumentId);
    await dokumentZaCitanje(dokumentId, request.korisnik!);
    prekiniCitanje(dokumentId);
    response.status(204).end();
  }),
);

// Otvorena je forma prijema: OCR se pali unaprijed, dok magacioner slika.
prijemRuter.post(
  "/prijem/otpremnica-priprema",
  requireUloga("operater", "bzr", "izvodjac"),
  asyncRuta(async (_request, response) => {
    pripremiOcr();
    response.status(204).end();
  }),
);

// Otpremnica uz prijem — preuzima se kroz fetch (invarijanta #31).
prijemRuter.get(
  "/prijem/:id/dokument/:dokumentId",
  requireUloga("operater", "bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const uloga = request.korisnik!.uloga;
    const r = await upit<{ mime: string; naziv_fajla: string | null; sadrzaj: Buffer }>(
      `select d.mime, d.naziv_fajla, d.sadrzaj from prijem_dokument d join prijem p on p.id = d.prijem_id
       where d.id = $1 and d.prijem_id = $2 ${samoMoje(uloga) ? `and ${ogranicenjeDatuma(uloga, "p.datum_prijema")}` : ""}`,
      [str(request.params.dokumentId), str(request.params.id)],
    );
    const d = r.rows[0];
    if (!d) throw new ApiGreska(404, "DOKUMENT_NE_POSTOJI", "Otpremnica nije pronađena.");
    response.setHeader("Content-Type", d.mime);
    response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(d.naziv_fajla ?? "otpremnica")}`);
    response.send(d.sadrzaj);
  }),
);

prijemRuter.post(
  "/prijem",
  requireUloga("operater", "bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const ulaz = tijelo(noviPrijemSchema, request.body);
    provjeriProzorUpisa(request.korisnik!.uloga, ulaz.datumPrijema);
    // Dobavljače upisuje odgovorno lice (odluka vlasnice 27.09.2026, #71); magacioner mu javlja.
    if (ulaz.noviDobavljac && !["bzr", "izvodjac"].includes(request.korisnik!.uloga)) {
      throw new ApiGreska(403, "DOBAVLJAC_SAMO_ODGOVORNO_LICE", "Novog dobavljača upisuje odgovorno lice. Javite mu, pa izaberite dobavljača sa spiska.");
    }
    const { prijemId, upozorenja } = await kreirajPrijem(ulaz, request.korisnik!.id, kljucIzZaglavlja(request.headers["x-kljuc-zahtjeva"]));
    response.status(201).json({ id: prijemId, upozorenja });
  }),
);

// Magacioner na rampi: dobavljača sa otpremnice nema u Šifarnicima — javlja odgovornom licu, koje ga
// upisuje (Šifarnici → Dobavljači), pa magacioner osvježi spisak i nastavi.
prijemRuter.post(
  "/prijem/javi-dobavljaca",
  requireUloga("operater", "bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const ulaz = tijelo(
      z.object({
        naziv: z.string().trim().min(2, "Upišite naziv dobavljača sa otpremnice."),
        pib: z.string().trim().max(20).optional(),
        brojOtpremnice: z.string().trim().max(60).optional(),
      }),
      request.body,
    );
    response.json(await javiNepoznatogDobavljaca(ulaz, request.korisnik!.id));
  }),
);

const izmjenaStavkeSchema = z.object({
  brojLota: z.string().min(1).optional(),
  proizvodniDatum: z.string().optional(),
  rokTrajanja: z.string().optional(),
  primljenaKolicina: z.number().positive().optional(),
  temperaturaPrijema: z.number().optional(),
});

prijemRuter.patch(
  "/prijem/:prijemId/lot/:lotId",
  requireUloga("operater", "bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const ulaz = tijelo(izmjenaStavkeSchema, request.body);
    const prijem = await upit<{ datum_prijema: string }>(
      `select p.datum_prijema from lot l join prijem p on p.id = l.prijem_id where l.id = $1 and l.prijem_id = $2`,
      [str(request.params.lotId), str(request.params.prijemId)],
    );
    if (!prijem.rows[0]) throw new ApiGreska(404, "LOT_NE_POSTOJI", "Stavka prijema nije pronađena.");
    // Izmjena je upis — isti prozor kao za novi prijem, inače magacioner mijenja staru stavku koja čeka odluku.
    provjeriProzorUpisa(request.korisnik!.uloga, prijem.rows[0].datum_prijema);
    await izmijeniStavku(str(request.params.lotId), ulaz, request.korisnik!.id);
    response.status(204).end();
  }),
);

const odlukaSchema = z.object({
  odluka: z.enum(["PRIHVATI", "HOLD", "ODBIJI"]),
  kolicina: z.number().nonnegative(),
  napomena: z.string().optional(),
});

prijemRuter.patch(
  "/prijem/:prijemId/lot/:lotId/odluka",
  requireUloga("bzr", "izvodjac"),
  asyncRuta(async (request: AuthZahtjev, response) => {
    const ulaz = tijelo(odlukaSchema, request.body);
    const rezultat = await donesiOdlukuOLotu(str(request.params.lotId), ulaz.odluka, ulaz.kolicina, ulaz.napomena, request.korisnik!.id);
    response.json(rezultat);
  }),
);
