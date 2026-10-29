// „Prvi koraci“ na telefonu (29.10.2026): vlasnica sama podešava atelje uz video uputstvo — spisak na Kontrolnom centru,
// uređaji bez šifara (dodaj zamrzivač: vrsta sama predloži granicu), podaci ateljea u prozoru. Ništa ne viri van ekrana.
import { pool } from "../pomoc.mjs";
import { telefon, otvori, prozor, siroko, slikaj } from "./telefon.mjs";

export const naziv = "Ekrani: prvi koraci — vlasnica sama dodaje uređaj i upisuje podatke ateljea";

export async function pokreni({ provjeri }) {
  const oznaka = `E2E7-${Date.now().toString(36)}`;
  const t = await telefon("ana");
  try {
    await otvori(t, "/tabla");
    const panel = t.strana.locator("section.prvi-koraci");
    await panel.waitFor({ timeout: 10_000 });
    const koraci = await panel.locator("li.prvi-korak strong").allTextContents();
    const s1 = await siroko(t.strana);
    await slikaj(t.strana, "7-prvi-koraci");
    provjeri(
      "Kontrolni centar vlasnice: „Prvi koraci“ sa deset koraka, svaki sa dugmetom; ne viri van ekrana",
      koraci.length === 10 && /Podaci ateljea/.test(koraci[0]) && (await panel.locator("li.prvi-korak button").count()) === 10 && s1.visak === 0,
      `${koraci.length} ${koraci.slice(0, 3).join(" | ")} · ${s1.visak}px ${s1.krivi.join(",")}`,
    );

    // ── Uređaji: dodati zamrzivač bez šifre ─────────────────────────────────────────────────
    await panel.locator("li.prvi-korak", { hasText: "Frižideri, vitrina, zamrzivač" }).getByRole("button").click();
    const m = prozor(t.strana, "Frižideri, vitrina, zamrzivač");
    await m.locator(".uredjaj-red:not(.uredjaj-nov)").first().waitFor({ timeout: 10_000 });
    const prije = await m.locator(".uredjaj-red:not(.uredjaj-nov)").count();
    const nov = m.locator(".uredjaj-nov");
    await nov.getByLabel("Vrsta").selectOption("zamrzivac");
    const predlogOd = await nov.getByLabel("Od °C").inputValue();
    await nov.getByLabel("Naziv").fill(`${oznaka} Zamrzivač za voće`);
    await nov.getByRole("button", { name: "Dodaj" }).click();
    await m.locator(".nc-info", { hasText: "je dodat" }).waitFor({ timeout: 10_000 });
    await t.strana.waitForTimeout(300);
    const poslije = await m.locator(".uredjaj-red:not(.uredjaj-nov)").count();
    const s2 = await siroko(t.strana);
    await slikaj(t.strana, "7-uredjaji");
    const upisan = (await pool.query(
      `select kt.sifra, p.min_vrijednost::float as min, p.max_vrijednost::float as max from kontrolna_tacka kt
       join pravilo_kontrole p on p.kontrolna_tacka_id = kt.id and p.artikal_id is null and p.aktivan where kt.naziv = $1`,
      [`${oznaka} Zamrzivač za voće`],
    )).rows[0];
    provjeri(
      "Uređaji: vrsta „Zamrzivač“ sama predloži −25; dodat bez šifre (server bira KKT2-Z…), sa granicom; prozor ne viri van ekrana",
      predlogOd === "-25" && poslije === prije + 1 && /^KKT2-Z\d+$/.test(upisan?.sifra ?? "") && upisan.min === -25 && upisan.max === -18 && s2.visak === 0,
      `${predlogOd} ${prije}→${poslije} ${JSON.stringify(upisan)} · ${s2.visak}px ${s2.krivi.join(",")}`,
    );
    await m.getByRole("button", { name: "Gotovo" }).click();

    // ── Podaci ateljea u prozoru ────────────────────────────────────────────────────────────
    await panel.locator("li.prvi-korak", { hasText: "Podaci ateljea" }).getByRole("button").click();
    const f = prozor(t.strana, "Podaci ateljea");
    await f.getByLabel("Naziv firme").waitFor({ timeout: 10_000 });
    const nazivFirme = await f.getByLabel("Naziv firme").inputValue();
    const polja = await f.locator("input").count();
    const s3 = await siroko(t.strana);
    await f.getByRole("button", { name: "Otkaži" }).click();
    provjeri("Podaci ateljea: prozor sa upisanim podacima (naziv, adresa, PIB, odgovorno lice…); ne viri van ekrana", nazivFirme.length > 2 && polja === 7 && s3.visak === 0, `„${nazivFirme}“ ${polja} polja · ${s3.visak}px`);
    provjeri("Bez greške u konzoli", t.greske.length === 0, t.greske.join(" | "));
  } finally {
    await t.zatvori();
    const k = await pool.connect();
    try {
      await k.query("begin");
      const tacke = (await k.query(`select id from kontrolna_tacka where naziv like $1`, [`${oznaka}%`])).rows.map((r) => r.id);
      if (tacke.length) {
        const pravila = (await k.query(`select id from pravilo_kontrole where kontrolna_tacka_id = any($1)`, [tacke])).rows.map((r) => r.id);
        const plan = (await k.query(`select id from plan_monitoringa where kontrolna_tacka_id = any($1)`, [tacke])).rows.map((r) => r.id);
        await k.query(`delete from audit_log where entitet_id = any($1)`, [[...tacke, ...pravila, ...plan]]);
        await k.query(`delete from plan_monitoringa where id = any($1)`, [plan]);
        await k.query(`delete from pravilo_kontrole where id = any($1)`, [pravila]);
        await k.query(`delete from kontrolna_tacka where id = any($1)`, [tacke]);
      }
      await k.query("commit");
    } catch (e) {
      await k.query("rollback");
      throw e;
    } finally {
      k.release();
    }
  }
}
