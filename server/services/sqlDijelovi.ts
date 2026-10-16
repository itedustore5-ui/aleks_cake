// Zajednički SQL dijelovi koje čita više servisa. Ranije su stajali u ruti neusaglašenosti, pa je
// ruta Kontrolnog centra uvozila drugu rutu (faza 4: SQL iz ruta u servise).

/** Ime iz spiska zaposlenih za nalog (`alias` = kolona sa id-jem korisnika); bez lica — korisničko ime. */
export const IME = (alias: string) => `(select coalesce(l.ime, k.korisnicko_ime) from korisnik k left join lice l on l.id = k.lice_id where k.id = ${alias})`;

/** Odakle je neusaglašenost došla — čitljivo, da se na listi vidi „Isporuka ISP-…", a ne samo broj. */
export const IZVOR_OZNAKA = `
  case nc.izvor_tip
    when 'isporuka' then (select 'Isporuka ' || i.broj || ' · ' || k.naziv from isporuka i join kupac k on k.id = i.kupac_id where i.id = nc.izvor_id)
    when 'mjerenje_temperature' then (select 'Temperatura · ' || kt.naziv || ' ' || m.vrijednost || ' °C' from mjerenje_temperature m join kontrolna_tacka kt on kt.id = m.kontrolna_tacka_id where m.id = nc.izvor_id)
    when 'kontrola_vozila' then (select 'Vozilo ' || v.registarski_broj from kontrola_vozila kv join vozilo v on v.id = kv.vozilo_id where kv.id = nc.izvor_id)
    when 'povlacenje' then (select 'Povlačenje ' || p.broj from povlacenje p where p.id = nc.izvor_id)
    when 'zapis' then (select 'Obrazac ' || z.obrazac_kod || ' · ' || to_char(z.datum, 'DD.MM.YYYY.') from zapis z where z.id = nc.izvor_id)
    when 'mjerni_uredjaj' then (select 'Mjerni uređaj ' || u.naziv || coalesce(' (' || u.oznaka || ')', '') from mjerni_uredjaj u where u.id = nc.izvor_id)
    when 'prijem' then (select 'Prijem ' || coalesce(p.broj_dokumenta || ' · ', '') || d.naziv from prijem p join dobavljac d on d.id = p.dobavljac_id where p.id = nc.izvor_id)
    else 'Prijava sa terena'
  end`;

/** Magacioner i vozač vide neusaglašenosti koje su SAMI prijavili i one gdje je mjera dodijeljena
 * NJIMA (invarijanta #26) — ne sve u firmi. $2 = id korisnika. */
export const SAMO_MOJE_NC = `(nc.prijavio_korisnik_id = $2 or exists (select 1 from korektivna_mjera m where m.neusaglasenost_id = nc.id and m.dodijeljeno_korisnik_id = $2))`;

/** Serija lota (R-17): isti dobavljač, artikal i broj lota — kroz SVE prijeme. Povlačenje ide po
 * seriji, ne po jednom prijemu. Parametar $1 = id lota; vraća id-jeve svih lotova serije (i njega). */
export const SERIJA_LOTA = `
  select s.id from lot l
  join lot s on s.artikal_id = l.artikal_id and s.dobavljac_id = l.dobavljac_id and upper(btrim(s.broj_lota)) = upper(btrim(l.broj_lota))
  where l.id = $1`;
