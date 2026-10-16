import { pool, upit, transakcija } from "../db.js";
import { ApiGreska } from "../greske.js";
import { provjeriOgranicenjeLogina, zabiljeziNeuspjeliPokusaj, ocistiNeuspjelePokusaje } from "../auth.js";
import { provjeriLozinku } from "../lozinke.js";
import { logSigurnosniDogadjaj, logKreiranje } from "./auditService.js";

// Provjera znanja: termini, ulazak prijavljenog zaposlenog SVOJOM šifrom (invarijanta #32), odgovori koji se ne mogu naduvati,
// banka pitanja konsultanta (samo njegova — #14) i pitanja firme. Ruta samo provjeri ulaz i ulogu.

export type IzvorPitanja = "sva" | "firma" | "konsultant";
type OtvorenTermin = { id: string; naziv: string; broj_pitanja: number; cuva_imena: boolean; izvor_pitanja: IzvorPitanja };

async function otvorenTermin(): Promise<OtvorenTermin | null> {
  const r = await upit<OtvorenTermin>(
    `select id, naziv, broj_pitanja, cuva_imena, izvor_pitanja from sesija_znanja where otvoren order by created_at desc limit 1`,
  );
  return r.rows[0] ?? null;
}

/** Lice prijavljenog naloga — provjeru radi SAMO on (invarijanta #32). Zaposleni se prepoznaje po
 * nalogu i lozinci; šifra lica je samo unutrašnji ključ učesnika i zaposlenom se ne pokazuje. */
async function mojeLice(korisnikId: string) {
  const r = await upit<{ id: string; ime: string; sifra: string; rukuje_hranom: boolean }>(
    `select l.id, l.ime, l.sifra, l.rukuje_hranom from korisnik k join lice l on l.id = k.lice_id where k.id = $1 and l.aktivan and l.sifra is not null`,
    [korisnikId],
  );
  if (!r.rows[0]) throw new ApiGreska(409, "NALOG_BEZ_SIFRE", "Vaš nalog nije vezan za zaposlenog u spisku ljudi — javite se odgovornom licu.");
  return r.rows[0];
}

/** Provjera je samo njegova: odgovara i završava je samo onaj ko ju je počeo. */
async function mojUcesnik(ucesnikId: string, korisnikId: string) {
  const lice = await mojeLice(korisnikId);
  const u = await upit<{ lice_id: string }>(`select lice_id from ucesnik_znanja where id = $1`, [ucesnikId]);
  if (!u.rows[0]) throw new ApiGreska(404, "UCESNIK_NE_POSTOJI", "Provjera nije pronađena — uđite ponovo sa svoje strane.");
  if (u.rows[0].lice_id !== lice.id) throw new ApiGreska(403, "TUDJA_PROVJERA", "Ovo nije vaša provjera.");
}

/** Provjeru radi samo onaj ČIJI je nalog: na zajedničkom telefonu u magacinu neko drugi može ostati
 * prijavljen, pa se prije početka upisuje lozinka prijavljenog. Pogrešni pokušaji se broje isto kao
 * na prijavi (IP + korisničko ime) — lozinka se ne može pogađati ni odavde. */
async function potvrdiDaJeOn(korisnikId: string, lozinka: string, ip: string | undefined) {
  const k = (await upit<{ korisnicko_ime: string; lozinka_hash: string }>(`select korisnicko_ime, lozinka_hash from korisnik where id = $1`, [korisnikId])).rows[0];
  if (!k) throw new ApiGreska(404, "NALOG_NE_POSTOJI", "Nalog nije pronađen.");
  const kljuc = `${ip || "nepoznato"}|${k.korisnicko_ime}`;
  provjeriOgranicenjeLogina(kljuc);
  if (!(await provjeriLozinku(lozinka, k.lozinka_hash))) {
    zabiljeziNeuspjeliPokusaj(kljuc);
    await logSigurnosniDogadjaj(pool, { korisnikId, entitetTip: "korisnik", entitetId: korisnikId, ipAdresa: ip ?? null, noveVrijednosti: { radnja: "provjera znanja — pogrešna lozinka" } });
    throw new ApiGreska(403, "POGRESNA_LOZINKA", "Lozinka nije tačna. Provjeru radi samo onaj ko je prijavljen — svojom lozinkom.");
  }
  ocistiNeuspjelePokusaje(kljuc);
}

/** Ulazak u otvoren termin — prijavljeni zaposleni, svojom lozinkom. Isti učesnik se
 * vraća dok ne završi. */
export async function udji(korisnikId: string, lozinka: string, ip?: string) {
  await potvrdiDaJeOn(korisnikId, lozinka, ip);
  const termin = await otvorenTermin();
  if (!termin) throw new ApiGreska(404, "NEMA_OTVORENE_SESIJE", "Trenutno nije otvorena nijedna provjera znanja.");
  const lice = await mojeLice(korisnikId);
  // Provjera je dokaz o obuci zaposlenih koji rukuju hranom (#20) — direktor i ostali van hrane je ne rade.
  if (!lice.rukuje_hranom) throw new ApiGreska(403, "PROVJERA_NIJE_ZA_VAS", "Provjera znanja je za zaposlene koji rukuju hranom — vi je ne radite.");

  const postojeci = await upit<{ id: string; zavrseno_at: string | null }>(
    `select id, zavrseno_at from ucesnik_znanja where sesija_id = $1 and sifra = $2`,
    [termin.id, lice.sifra],
  );
  if (postojeci.rows[0]?.zavrseno_at) throw new ApiGreska(409, "VEC_ZAVRSENO", "Ovu provjeru ste već završili.");

  const ucesnikId =
    postojeci.rows[0]?.id ??
    (
      await pool.query<{ id: string }>(
        `insert into ucesnik_znanja (sesija_id, lice_id, sifra, ime_snapshot) values ($1, $2, $3, $4) returning id`,
        [termin.id, lice.id, lice.sifra, termin.cuva_imena ? lice.ime : null],
      )
    ).rows[0].id;

  const pitanja = await upit<{ id: string; tema: string; tekst: string; ponudjeni_odgovori: string[] }>(
    `select id, tema, tekst, ponudjeni_odgovori from pitanje
     where aktivno and ($2 = 'sva' or izvor = $2) order by random() limit $1`,
    [termin.broj_pitanja, termin.izvor_pitanja],
  );
  return { ucesnikId, ime: lice.ime, termin: termin.naziv, pitanja: pitanja.rows };
}

/** Rezultat ide na Prilog 14 — ne smije se naduvati: jedan odgovor po pitanju, ne više odgovora
 * nego što provjera ima pitanja, i ništa poslije završetka. */
export async function odgovori(ulaz: { ucesnikId: string; pitanjeId: string; datIndeks: number }, korisnikId: string) {
  await mojUcesnik(ulaz.ucesnikId, korisnikId);
  const stanje = await upit<{ zavrseno_at: string | null; broj_pitanja: number; odgovoreno: number; vec_odgovoreno: boolean }>(
    `select u.zavrseno_at, s.broj_pitanja,
            (select count(*)::int from odgovor_znanja o where o.ucesnik_id = u.id) as odgovoreno,
            exists(select 1 from odgovor_znanja o where o.ucesnik_id = u.id and o.pitanje_id = $2) as vec_odgovoreno
     from ucesnik_znanja u join sesija_znanja s on s.id = u.sesija_id where u.id = $1`,
    [ulaz.ucesnikId, ulaz.pitanjeId],
  );
  const st = stanje.rows[0];
  if (!st) throw new ApiGreska(404, "UCESNIK_NE_POSTOJI", "Provjera nije pronađena — uđite ponovo svojom šifrom.");
  if (st.zavrseno_at) throw new ApiGreska(409, "VEC_ZAVRSENO", "Provjera je već završena — odgovori se više ne mijenjaju.");
  if (st.vec_odgovoreno) throw new ApiGreska(409, "VEC_ODGOVORENO", "Na ovo pitanje je već odgovoreno.");
  if (st.odgovoreno >= st.broj_pitanja) throw new ApiGreska(409, "SVA_PITANJA_ODGOVORENA", "Odgovoreno je na sva pitanja — završite provjeru.");
  const pitanje = await upit<{ tacan_indeks: number }>(`select tacan_indeks from pitanje where id = $1`, [ulaz.pitanjeId]);
  if (!pitanje.rows[0]) throw new ApiGreska(404, "PITANJE_NE_POSTOJI", "Pitanje nije pronađeno.");
  await pool.query(`insert into odgovor_znanja (ucesnik_id, pitanje_id, dat_indeks, tacan) values ($1, $2, $3, $4)`, [
    ulaz.ucesnikId,
    ulaz.pitanjeId,
    ulaz.datIndeks,
    pitanje.rows[0].tacan_indeks === ulaz.datIndeks,
  ]);
}

/** Ponovljeno „završi" vraća upisani rezultat — ne računa ga iznova. */
export async function zavrsi(ucesnikId: string, korisnikId: string) {
  await mojUcesnik(ucesnikId, korisnikId);
  const vec = await upit<{ zavrseno_at: string | null; broj_tacnih: number | null; broj_pitanja: number | null }>(
    `select zavrseno_at, broj_tacnih, broj_pitanja from ucesnik_znanja where id = $1`,
    [ucesnikId],
  );
  if (!vec.rows[0]) throw new ApiGreska(404, "UCESNIK_NE_POSTOJI", "Provjera nije pronađena — uđite ponovo svojom šifrom.");
  if (vec.rows[0].zavrseno_at) return { brojTacnih: vec.rows[0].broj_tacnih, brojPitanja: vec.rows[0].broj_pitanja };
  const rezultat = await pool.query<{ broj_tacnih: number; broj_pitanja: number }>(
    `select count(*) filter (where tacan)::int as broj_tacnih, count(*)::int as broj_pitanja from odgovor_znanja where ucesnik_id = $1`,
    [ucesnikId],
  );
  const { broj_tacnih, broj_pitanja } = rezultat.rows[0];
  await pool.query(`update ucesnik_znanja set zavrseno_at = now(), broj_tacnih = $1, broj_pitanja = $2 where id = $3`, [broj_tacnih, broj_pitanja, ucesnikId]);
  return { brojTacnih: broj_tacnih, brojPitanja: broj_pitanja };
}

/** Za početnu stranu prijavljenog: da li je termin otvoren, da li mu je nalog vezan za zaposlenog i
 * da li je već završio. Šifra se ne vraća — zaposlenom ne treba.
 * Ulaz u provjeru se nudi odatle, a ne sa strane za prijavu. */
export async function mojTermin(korisnikId: string) {
  const termin = await otvorenTermin();
  const lice = await upit<{ sifra: string | null; rukuje_hranom: boolean }>(
    `select l.sifra, l.rukuje_hranom from korisnik k join lice l on l.id = k.lice_id where k.id = $1 and l.aktivan`,
    [korisnikId],
  );
  const sifra = lice.rows[0]?.sifra ?? null;
  if (!termin || !sifra) return { otvoren: !!termin, naziv: termin?.naziv ?? null, vezan: !!sifra, zavrseno: false };
  // Ko ne rukuje hranom (direktor, administracija) — provjera mu se ni ne nudi (#20).
  if (!lice.rows[0].rukuje_hranom) return { otvoren: false, naziv: termin.naziv, vezan: true, zavrseno: false };
  const u = await upit<{ zavrseno: boolean }>(
    `select zavrseno_at is not null as zavrseno from ucesnik_znanja where sesija_id = $1 and sifra = $2`,
    [termin.id, sifra],
  );
  return { otvoren: true, naziv: termin.naziv, vezan: true, zavrseno: u.rows[0]?.zavrseno ?? false };
}

export async function termini() {
  const r = await upit(
    `select s.*,
            (select count(*)::int from ucesnik_znanja u where u.sesija_id = s.id and u.zavrseno_at is not null) as broj_zavrsilo,
            (select count(*)::int from ucesnik_znanja u where u.sesija_id = s.id and u.zavrseno_at is not null
               and u.broj_pitanja > 0 and u.broj_tacnih * 100 >= s.prag_prolaza * u.broj_pitanja) as broj_proslo,
            (select round(avg(u.broj_tacnih * 100.0 / nullif(u.broj_pitanja, 0)))::int from ucesnik_znanja u
               where u.sesija_id = s.id and u.zavrseno_at is not null) as prosjek_posto
     from sesija_znanja s order by s.created_at desc`,
  );
  return r.rows;
}

/** Termin bez dovoljno pitanja iz izabranog izvora bi tiho davao kraći test — kaže se unaprijed. */
export async function otvoriTermin(
  ulaz: { naziv: string; brojPitanja: number; cuvaImena: boolean; pragProlaza: number; izvorPitanja: IzvorPitanja },
  korisnikId: string,
) {
  const dostupno = await upit<{ n: number }>(`select count(*)::int as n from pitanje where aktivno and ($1 = 'sva' or izvor = $1)`, [ulaz.izvorPitanja]);
  if (dostupno.rows[0].n === 0) {
    throw new ApiGreska(
      409,
      "NEMA_PITANJA",
      ulaz.izvorPitanja === "firma" ? "Još nema pitanja firme — unesite ih na kartici „Pitanja firme“ pa otvorite termin." : "Nema aktivnih pitanja za ovaj termin.",
    );
  }
  const r = await pool.query<{ id: string }>(
    `insert into sesija_znanja (naziv, broj_pitanja, cuva_imena, created_by, prag_prolaza, izvor_pitanja)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [ulaz.naziv, ulaz.brojPitanja, ulaz.cuvaImena, korisnikId, ulaz.pragProlaza, ulaz.izvorPitanja],
  );
  return r.rows[0].id;
}

export async function zatvoriTermin(id: string) {
  await pool.query(`update sesija_znanja set otvoren = false where id = $1`, [id]);
}

type NovoPitanje = { tema: string; tekst: string; ponudjeniOdgovori: string[]; tacanIndeks: number };

export async function dodajPitanje(ulaz: NovoPitanje, izvor: "konsultant" | "firma", korisnikId: string) {
  if (ulaz.tacanIndeks >= ulaz.ponudjeniOdgovori.length) throw new ApiGreska(400, "TACAN_ODGOVOR", "Označite koji je odgovor tačan.");
  const r = await pool.query<{ id: string }>(
    `insert into pitanje (tema, tekst, ponudjeni_odgovori, tacan_indeks, izvor, created_by) values ($1, $2, $3, $4, $5, $6) returning id`,
    [ulaz.tema, ulaz.tekst, JSON.stringify(ulaz.ponudjeniOdgovori), ulaz.tacanIndeks, izvor, korisnikId],
  );
  return r.rows[0].id;
}

/** Banka pitanja konsultanta — samo njegova (invarijanta #14). */
export async function bankaPitanja() {
  return (await upit(`select * from pitanje order by tema, created_at`)).rows;
}

export async function evidencijaOsposobljavanja() {
  return (await upit(`select * from v_evidencija_osposobljavanja order by ime`)).rows;
}

/** Pitanja firme sa brojem odgovora — odgovorno lice vidi SVOJA pitanja i koliko je ljudi tačno odgovorilo. */
export async function pitanjaFirme() {
  const r = await upit(
    `select p.id, p.tema, p.tekst, p.ponudjeni_odgovori, p.tacan_indeks, p.aktivno, p.created_at,
            count(o.id)::int as broj_odgovora,
            count(o.id) filter (where o.tacan)::int as broj_tacnih
     from pitanje p left join odgovor_znanja o on o.pitanje_id = p.id
     where p.izvor = 'firma'
     group by p.id order by p.aktivno desc, p.tema, p.created_at`,
  );
  return r.rows;
}

async function pitanjeFirme(id: string) {
  const r = await upit<{ izvor: string; broj: number }>(
    `select p.izvor, (select count(*)::int from odgovor_znanja o where o.pitanje_id = p.id) as broj from pitanje p where p.id = $1`,
    [id],
  );
  if (!r.rows[0] || r.rows[0].izvor !== "firma") throw new ApiGreska(404, "PITANJE_NE_POSTOJI", "Pitanje nije pronađeno.");
  return r.rows[0];
}

export async function ukljuciPitanjeFirme(id: string, aktivno: boolean) {
  await pitanjeFirme(id);
  await pool.query(`update pitanje set aktivno = $1 where id = $2`, [aktivno, id]);
}

/** Tekst se mijenja samo dok niko nije odgovorio — poslije bi rezultati pokazivali odgovore na
 * pitanje koje više ne postoji. Tada se pitanje samo isključi i unese novo. */
export async function izmijeniPitanjeFirme(id: string, ulaz: NovoPitanje) {
  const p = await pitanjeFirme(id);
  if (p.broj > 0) {
    throw new ApiGreska(409, "PITANJE_VEC_KORISCENO", "Na ovo pitanje su zaposleni već odgovarali — isključite ga i unesite novo, da rezultati ostanu tačni.");
  }
  if (ulaz.tacanIndeks >= ulaz.ponudjeniOdgovori.length) throw new ApiGreska(400, "TACAN_ODGOVOR", "Označite koji je odgovor tačan.");
  await pool.query(`update pitanje set tema = $1, tekst = $2, ponudjeni_odgovori = $3, tacan_indeks = $4 where id = $5`, [
    ulaz.tema,
    ulaz.tekst,
    JSON.stringify(ulaz.ponudjeniOdgovori),
    ulaz.tacanIndeks,
    id,
  ]);
}

/** Pitanje na koje se već odgovaralo mijenja se kao NOVA VERZIJA: novo pitanje + staro isključeno, u
 * jednoj transakciji (#35), sa auditom. Rezultati ostaju vezani za staro pitanje (01.10.2026). */
export async function novaVerzijaPitanjaFirme(id: string, ulaz: NovoPitanje, korisnikId: string) {
  await pitanjeFirme(id);
  if (ulaz.tacanIndeks >= ulaz.ponudjeniOdgovori.length) throw new ApiGreska(400, "TACAN_ODGOVOR", "Označite koji je odgovor tačan.");
  return transakcija(async (klijent) => {
    const novo = await klijent.query<{ id: string }>(
      `insert into pitanje (tema, tekst, ponudjeni_odgovori, tacan_indeks, izvor, created_by) values ($1, $2, $3, $4, 'firma', $5) returning id`,
      [ulaz.tema, ulaz.tekst, JSON.stringify(ulaz.ponudjeniOdgovori), ulaz.tacanIndeks, korisnikId],
    );
    await klijent.query(`update pitanje set aktivno = false where id = $1`, [id]);
    await logKreiranje(klijent, { korisnikId, entitetTip: "pitanje", entitetId: novo.rows[0].id, noveVrijednosti: { tema: ulaz.tema, tekst: ulaz.tekst, zamjenjuje: id } });
    return novo.rows[0].id;
  });
}

/** Ko je radio, koliko je tačno i je li prošao — po terminu. Bez imena kad termin ne čuva imena. */
export async function rezultati(sesijaId: string | null) {
  const r = await upit(
    `select u.id, s.id as sesija_id, s.naziv as sesija, s.prag_prolaza, u.sifra,
            case when s.cuva_imena then coalesce(u.ime_snapshot, l.ime) end as ime, l.radno_mjesto,
            u.broj_tacnih, u.broj_pitanja, u.zavrseno_at,
            round(u.broj_tacnih * 100.0 / nullif(u.broj_pitanja, 0))::int as posto,
            (u.broj_pitanja > 0 and u.broj_tacnih * 100 >= s.prag_prolaza * u.broj_pitanja) as prosao
     from ucesnik_znanja u join sesija_znanja s on s.id = u.sesija_id left join lice l on l.id = u.lice_id
     where u.zavrseno_at is not null and ($1::uuid is null or s.id = $1)
     order by u.zavrseno_at desc limit 500`,
    [sesijaId],
  );
  return r.rows;
}
