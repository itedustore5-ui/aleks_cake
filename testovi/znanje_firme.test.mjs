// Pitanja firme: odgovorno lice ih unosi, termin ih koristi, rezultat pokazuje ko je položio i sa
// kojim skorom, statistika po pitanju. Konsultantova banka ostaje skrivena (provjerava pristup.test).
import { pool, prijava, NALOZI } from "./pomoc.mjs";

export const naziv = "Pitanja firme i rezultati";

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const marko = await prijava(NALOZI.marko);
  const trag = { pitanjeId: null, sesije: [] };

  try {
    const novo = await ana("/pitanja-firme", {
      telo: { tema: "E2E prijem", tekst: "E2E: šta radite ako je jogurt pri prijemu na 8 °C?", ponudjeniOdgovori: ["Primim ga", "Stavim na HOLD i javim odgovornom licu", "Bacim ga"], tacanIndeks: 1 },
    });
    trag.pitanjeId = novo.tijelo?.id;
    provjeri("Ana unosi pitanje firme", novo.status === 201);
    provjeri("Pitanje je na njenoj listi, bez odgovora", (await ana("/pitanja-firme")).tijelo.some((p) => p.id === trag.pitanjeId && p.broj_odgovora === 0));
    provjeri("Pitanje bez označenog tačnog odgovora se odbija (400)", (await ana("/pitanja-firme", { telo: { tema: "E2E", tekst: "E2E bez tačnog?", ponudjeniOdgovori: ["a", "b"], tacanIndeks: 5 } })).status === 400);

    const termin = await ana("/provjera-znanja/sesije", { telo: { naziv: "E2E pitanja firme", brojPitanja: 1, cuvaImena: true, izvorPitanja: "firma", pragProlaza: 100 } });
    trag.sesije.push(termin.tijelo?.id);
    provjeri("Termin samo sa pitanjima firme, prag 100 %", termin.status === 201);
    const s = (await ana("/provjera-znanja/sesije")).tijelo.find((x) => x.id === termin.tijelo.id);
    provjeri("Termin pamti izvor i prag", s?.izvor_pitanja === "firma" && s?.prag_prolaza === 100);

    const ulaz = await marko("/provjera-znanja/uci", { telo: { lozinka: NALOZI.marko.lozinka } });
    provjeri("Zaposleni dobija pitanje firme", ulaz.status === 200 && ulaz.tijelo.pitanja.length === 1, `${ulaz.status}`);
    const p = ulaz.tijelo.pitanja[0];
    const izvor = (await pool.query(`select izvor, tacan_indeks from pitanje where id = $1`, [p.id])).rows[0];
    provjeri("Pitanje je iz izvora 'firma'", izvor.izvor === "firma");
    await marko("/provjera-znanja/odgovor", { telo: { ucesnikId: ulaz.tijelo.ucesnikId, pitanjeId: p.id, datIndeks: izvor.tacan_indeks } });
    await marko("/provjera-znanja/zavrsi", { telo: { ucesnikId: ulaz.tijelo.ucesnikId } });

    const rez = (await ana(`/provjera-znanja/rezultati?sesijaId=${termin.tijelo.id}`)).tijelo;
    provjeri("Rezultat: ime, 100 %, položeno", rez.length === 1 && rez[0].ime === "Marko Vuković" && rez[0].posto === 100 && rez[0].prosao === true, JSON.stringify(rez[0]));
    const s2 = (await ana("/provjera-znanja/sesije")).tijelo.find((x) => x.id === termin.tijelo.id);
    provjeri("Termin broji završilo/položilo", s2?.broj_zavrsilo === 1 && s2?.broj_proslo === 1);

    if (p.id === trag.pitanjeId) {
      const stat = (await ana("/pitanja-firme")).tijelo.find((x) => x.id === trag.pitanjeId);
      provjeri("Statistika po pitanju: 1 odgovor, 1 tačan", stat?.broj_odgovora === 1 && stat?.broj_tacnih === 1);
      const izmjena = await ana(`/pitanja-firme/${trag.pitanjeId}`, { method: "PATCH", telo: { tema: "E2E", tekst: "E2E promijenjeno pitanje", ponudjeniOdgovori: ["a", "b"], tacanIndeks: 0 } });
      provjeri("Pitanje na koje se već odgovaralo se ne mijenja (409)", izmjena.status === 409 && izmjena.tijelo.error.code === "PITANJE_VEC_KORISCENO");
      provjeri("…ali se može isključiti", (await ana(`/pitanja-firme/${trag.pitanjeId}`, { method: "PATCH", telo: { aktivno: false } })).status === 204);
    }
  } finally {
    for (const id of trag.sesije.filter(Boolean)) {
      await pool.query(`delete from odgovor_znanja where ucesnik_id in (select id from ucesnik_znanja where sesija_id = $1)`, [id]);
      await pool.query(`delete from ucesnik_znanja where sesija_id = $1`, [id]);
      await pool.query(`delete from sesija_znanja where id = $1`, [id]);
    }
    if (trag.pitanjeId) {
      await pool.query(`delete from odgovor_znanja where pitanje_id = $1`, [trag.pitanjeId]);
      await pool.query(`delete from pitanje where id = $1`, [trag.pitanjeId]);
    }
  }
}
