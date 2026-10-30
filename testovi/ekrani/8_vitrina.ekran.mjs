// Vitrina na telefonu (dopuna 42): zaposleni upisuje „Napravljeno“ (kolač, komada, sastojak po seriji), pa „Prodat 1“
// jednim dodirom i otpis uz razlog; „Sastojci i upisi“ i istorija po danima. Ništa ne viri van ekrana od 375 px.
import { pool, prijava, NALOZI, danasCG, rokZaDana } from "../pomoc.mjs";
import { telefon, otvori, prozor, siroko, slikaj } from "./telefon.mjs";

export const naziv = "Ekrani: vitrina — zaposleni upisuje kolače, „Prodat 1“ jednim dodirom, otpis";

export async function pokreni({ provjeri }) {
  const oznaka = `E2E8-${Date.now().toString(36)}`;
  const trag = { artikal: null, prijem: null, lot: null };
  // Svoj sastojak sa prihvaćenim lotom — ne zavisi od demo lotova.
  const ana = await prijava(NALOZI.ana);
  trag.artikal = (await ana("/artikli", { telo: { naziv: `${oznaka} Maskarpone`, jedinicaMjere: "kg", alergeni: ["MLIJEKO"] } })).tijelo?.id;
  const dobavljac = (await pool.query(`select id from dobavljac where aktivan order by naziv limit 1`)).rows[0].id;
  trag.prijem = (await pool.query(`insert into prijem (dobavljac_id, broj_dokumenta, datum_prijema, status, primio_korisnik_id) values ($1, $2, $3, 'PRIHVACEN', $4) returning id`, [dobavljac, oznaka, danasCG(), NALOZI.marko.id])).rows[0].id;
  trag.lot = (await pool.query(
    `insert into lot (artikal_id, dobavljac_id, prijem_id, broj_lota, rok_trajanja, status, primljena_kolicina, prihvacena_kolicina) values ($1, $2, $3, $4, $5, 'PRIHVACEN', 10, 10) returning id`,
    [trag.artikal, dobavljac, trag.prijem, `${oznaka}-M1`, rokZaDana(5)],
  )).rows[0].id;
  await pool.query(`insert into zaliha (lot_id, artikal_id, kolicina, status) values ($1, $2, 10, 'DOSTUPNO')`, [trag.lot, trag.artikal]);

  const t = await telefon("marko");
  try {
    await otvori(t, "/vitrina");
    const s1 = await siroko(t.strana);
    provjeri(
      "Vitrina se otvara zaposlenom: „Napravljeno“, „U vitrini sada“, istorija po danima; ne viri van ekrana",
      (await t.strana.getByRole("button", { name: "Napravljeno" }).count()) === 1 && (await t.strana.getByText("U vitrini sada").count()) === 1 && (await t.strana.getByText("Istorija po danima").count()) === 1 && s1.visak === 0,
      `${s1.visak}px ${s1.krivi.join(",")}`,
    );

    // ── Napravljeno ─────────────────────────────────────────────────────────────────────
    await t.strana.getByRole("button", { name: "Napravljeno" }).click();
    const m = prozor(t.strana, "Napravljeno");
    await m.locator('input[list="vitrina-nazivi"]').fill(`${oznaka} Tiramisu`);
    await m.locator(".broj-komada input").fill("8");
    await m.getByLabel("Traži sastojak").fill(oznaka);
    await m.locator(".vitrina-ponuda-red", { hasText: `${oznaka} Maskarpone` }).click();
    await m.locator(".vitrina-izabrani li", { hasText: `${oznaka} Maskarpone` }).waitFor({ timeout: 5_000 });
    const alergeni = await m.locator(".alergeni-oznaka").first().textContent();
    const s2 = await siroko(t.strana);
    await slikaj(t.strana, "8-napravljeno");
    provjeri("Forma „Napravljeno“: sastojak dodirom ulazi u izabrane, alergeni odmah (Mlijeko); ne viri van ekrana", /Mlijeko/.test(alergeni ?? "") && s2.visak === 0, `${alergeni} · ${s2.visak}px ${s2.krivi.join(",")}`);
    await m.getByRole("button", { name: "Sačuvaj" }).click();
    const kartica = t.strana.locator(".vitrina-kartica", { hasText: `${oznaka} Tiramisu` });
    await kartica.waitFor({ timeout: 10_000 });
    provjeri("Kolač je u vitrini: 8 komada", (await kartica.locator(".vitrina-broj strong").textContent()) === "8");

    // ── Prodat 1 ────────────────────────────────────────────────────────────────────────
    await kartica.getByRole("button", { name: "Prodat 1" }).click();
    await kartica.locator(".vitrina-broj strong", { hasText: /^7$/ }).waitFor({ timeout: 10_000 });
    const potvrda = await kartica.locator(".vitrina-poruka").textContent();
    const ponisti = await kartica.getByRole("button", { name: /Poništi/ }).count();
    await slikaj(t.strana, "8-prodat");
    provjeri("„Prodat 1“ jednim dodirom: 8 → 7, potvrda uz karticu i „Poništi“ za pogrešan dodir", /Prodat 1/.test(potvrda ?? "") && ponisti === 1, `${potvrda} · poništi ${ponisti}`);

    // ── Otpis ───────────────────────────────────────────────────────────────────────────
    await kartica.getByRole("button", { name: "Otpis" }).click();
    const o = prozor(t.strana, "Otpis");
    await o.locator(".broj-komada input").fill("1");
    await o.getByRole("button", { name: "Oštećen" }).click();
    const s3 = await siroko(t.strana);
    await o.getByRole("button", { name: "Upiši otpis" }).click();
    await kartica.locator(".vitrina-broj strong", { hasText: /^6$/ }).waitFor({ timeout: 10_000 });
    provjeri("Otpis uz razlog (brzi izbor „Oštećen“): 7 → 6; prozor ne viri van ekrana", s3.visak === 0, `${s3.visak}px ${s3.krivi.join(",")}`);

    // ── Sastojci i upisi, istorija ──────────────────────────────────────────────────────
    await kartica.getByRole("button", { name: /Sastojci i upisi/ }).click();
    const d = prozor(t.strana, `${oznaka} Tiramisu`);
    await d.locator(".sastojci-lista li", { hasText: `${oznaka} Maskarpone` }).waitFor({ timeout: 10_000 });
    const upisa = await d.locator("section").last().locator(".sastojci-lista li").count();
    const s4 = await siroko(t.strana);
    await slikaj(t.strana, "8-detalj");
    provjeri("„Sastojci i upisi“: serija sastojka i oba upisa (prodato, otpis); ne viri van ekrana", upisa === 2 && s4.visak === 0, `${upisa} upisa · ${s4.visak}px ${s4.krivi.join(",")}`);
    await d.getByRole("button", { name: "Zatvori" }).last().click();
    // Istorija se osvježi posle svakog upisa — čeka se dan u kom je već i otpis.
    const dan = t.strana.locator(".vitrina-dan", { hasText: `${oznaka} Tiramisu 1 (Oštećen)` });
    await dan.first().waitFor({ timeout: 10_000 });
    const tekstDana = (await dan.first().textContent()) ?? "";
    const s5 = await siroko(t.strana);
    await slikaj(t.strana, "8-vitrina");
    provjeri("Istorija po danima: danas napravljeno 8, prodato 1, otpis 1 (Oštećen); strana ne viri van ekrana", /Napravljeno:.*Tiramisu 8/.test(tekstDana) && /Prodato:.*Tiramisu 1/.test(tekstDana) && /Otpis:.*Tiramisu 1 \(Oštećen\)/.test(tekstDana) && s5.visak === 0, `${tekstDana.slice(0, 200)} · ${s5.visak}px`);
    provjeri("Bez greške u konzoli", t.greske.length === 0, t.greske.join(" | "));
  } finally {
    await t.zatvori();
    const k = await pool.connect();
    try {
      await k.query("begin");
      const serije = (await k.query(`select id from serija_vitrine where naziv like $1`, [`${oznaka}%`])).rows.map((r) => r.id);
      const sve = [...serije, trag.artikal, trag.lot, trag.prijem].filter(Boolean);
      await k.query(`delete from obavjestenje where izvor_id = any($1)`, [sve]);
      await k.query(`delete from audit_log where entitet_id = any($1)`, [sve]);
      await k.query(`delete from serija_vitrine_promet where serija_id = any($1)`, [serije]);
      await k.query(`delete from serija_vitrine_lot where serija_id = any($1)`, [serije]);
      await k.query(`delete from serija_vitrine where id = any($1)`, [serije]);
      await k.query(`delete from kljuc_zahtjeva where rezultat->>'id' = any($1)`, [serije]);
      if (trag.lot) {
        await k.query(`delete from zaliha where lot_id = $1`, [trag.lot]);
        await k.query(`delete from lot where id = $1`, [trag.lot]);
      }
      if (trag.prijem) await k.query(`delete from prijem where id = $1`, [trag.prijem]);
      await k.query(`delete from pravilo_kontrole where artikal_id = $1`, [trag.artikal]);
      await k.query(`delete from artikal where id = $1 or naziv like $2`, [trag.artikal, `${oznaka}%`]);
      await k.query("commit");
    } catch (e) {
      await k.query("rollback");
      throw e;
    } finally {
      k.release();
    }
  }
}
