// Prijava vlasnice 02.10.2026, na telefonu:
//   • „kod vozača nova isporuka se čuva, kod magacionera ne“ — magacioneru je matični magacin bio bez robe
//     (kao „Magacin Bar“ na demo bazi), forma je nudila samo taj magacin i sivo „Sačuvaj“ bez objašnjenja;
//   • „kod Ane neusaglašenost neće da se zatvori“ — dugme je bilo sivo dok se ne označi kvačica ispod;
//     03.10.: „treba da je funkcionalnije“ — sada „Riješeno je“: jedan upis, mjera + provjera + zatvaranje.
import { pool, prijava, NALOZI } from "../pomoc.mjs";
import { telefon, otvori, prozor, slikaj } from "./telefon.mjs";

export const naziv = "Ekrani: magacioner sa praznim matičnim magacinom sprema isporuku; Ana sama zatvara neusaglašenost";

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const oznaka = `E2E5-${Date.now().toString(36)}`;
  const t0 = new Date();
  const trag = { skladiste: null, nc: null, isporuke: [] };
  try {
    // ── Magacioner: matični magacin bez robe ────────────────────────────────────────────────
    const sk = await ana("/skladista", { telo: { naziv: `${oznaka} magacin` } });
    trag.skladiste = sk.tijelo?.id;
    const nalog = (await ana("/nalozi")).tijelo.find((n) => n.korisnicko_ime === NALOZI.marko.ime);
    await ana(`/nalozi/${nalog.id}/skladiste`, { method: "PATCH", telo: { skladisteId: trag.skladiste } });

    const t = await telefon("marko");
    try {
      await otvori(t, "/isporuka");
      await t.strana.waitForTimeout(500);
      await t.strana.getByRole("button", { name: "Nova isporuka" }).click();
      const m = prozor(t.strana, "Nova isporuka");
      await m.waitFor();
      await t.strana.waitForTimeout(400);
      const magacin = await m.getByLabel("Iz magacina").locator("option:checked").textContent();
      const lot = await m.getByLabel("Artikal / lot").first().locator("option:checked").textContent();
      provjeri(
        "Magacioner: matični magacin je prazan — forma sama nudi magacin u kom ima robe",
        !!magacin && !magacin.includes(oznaka) && !!lot && !/nema robe/.test(lot),
        `${magacin} · ${lot}`,
      );
      // Bez količine: dugme nije sivo, nego kaže šta fali (#74).
      const sacuvaj = m.getByRole("button", { name: "Sačuvaj" });
      const sivo = await sacuvaj.isDisabled();
      await sacuvaj.click();
      const poruka = await m.locator(".auth-error").first().textContent().catch(() => "");
      provjeri("…„Sačuvaj“ bez količine nije sivo, nego kaže šta fali", !sivo && /Za čuvanje još fali: .*količina/.test(poruka ?? ""), `${sivo} · ${poruka}`);
      await m.getByLabel("Količina").first().fill("1");
      await sacuvaj.click();
      await m.waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
      const nove = (await pool.query(`select id from isporuka where uneo_korisnik_id = $1 and created_at >= $2`, [NALOZI.marko.id, t0])).rows.map((r) => r.id);
      trag.isporuke.push(...nove);
      await slikaj(t.strana, "7-magacioner-isporuka");
      provjeri("…i isporuka se čuva", nove.length === 1 && (await m.count()) === 0, `${nove.length}`);
      provjeri("…bez greške u konzoli", t.greske.length === 0, t.greske.join(" | "));
    } finally {
      await t.zatvori();
    }

    // ── Ana zatvara neusaglašenost sama (jedino odgovorno lice) ──────────────────────────────
    const jednoBzr = (await pool.query(`select count(*)::int as n from korisnik where uloga = 'bzr' and aktivan`)).rows[0].n === 1;
    const nc = await ana("/neusaglasenosti", { telo: { opis: `${oznaka} proba zatvaranja`, ozbiljnost: "NIZAK" } });
    trag.nc = nc.tijelo?.id;
    const a = await telefon("ana");
    try {
      await otvori(a, "/neusaglasenosti");
      await a.strana.getByRole("button", { name: /^Sve aktivne|^Sve/ }).first().click().catch(() => undefined);
      await a.strana.getByText(`${oznaka} proba zatvaranja`).first().click();
      // Proba 03.10.2026: „Riješeno je“ — jedan upis umjesto mjera → urađeno → provjera u dva prozora.
      const m = a.strana.locator(".modal");
      const upisi = m.getByRole("button", { name: jednoBzr ? "Upiši i zatvori" : "Upiši — šalji na provjeru" });
      await upisi.waitFor({ timeout: 10_000 });
      const prvi = await m.getByRole("button", { name: "Riješeno je — upiši" }).getAttribute("class");
      provjeri("Ana: „Riješeno je — upiši“ je prvi izbor (dodjela nekome je drugi)", /selected/.test(prvi ?? ""), prvi);
      await m.getByLabel("Šta je urađeno").fill("Pregledano i očišćeno");
      const sivo = await upisi.isDisabled();
      if (jednoBzr) {
        await upisi.click();
        const poruka = await m.locator(".auth-error").first().textContent().catch(() => "");
        provjeri("…„Upiši i zatvori“ nije sivo; bez kvačice kaže šta da se uradi", !sivo && /označite kvačicu/.test(poruka ?? ""), `${sivo} · ${poruka}`);
        await m.getByLabel("Šta ste provjerili").fill("Pregledala sam komoru lično");
        await m.locator(".nc-bez-drugog input[type=checkbox]").check();
        await slikaj(a.strana, "8-nc-rijeseno-je");
        await upisi.click();
        await m.locator(".nc-sljedeci", { hasText: "Zatvoreno" }).waitFor({ timeout: 10_000 }).catch(() => undefined);
        await slikaj(a.strana, "9-nc-zatvorena");
        const status = (await pool.query(`select status from neusaglasenost where id = $1`, [trag.nc])).rows[0]?.status;
        const mjere = (await pool.query(`select count(*)::int as n from korektivna_mjera where neusaglasenost_id = $1 and status = 'ZAVRSENA'`, [trag.nc])).rows[0].n;
        provjeri("…uz kvačicu i šta je provjereno — JEDAN upis: mjera urađena i neusaglašenost zatvorena", status === "ZATVORENA" && mjere === 1, `${status} · mjera ${mjere}`);
      } else {
        await upisi.click();
        await a.strana.waitForTimeout(1500);
        const status = (await pool.query(`select status from neusaglasenost where id = $1`, [trag.nc])).rows[0]?.status;
        provjeri("…sa dva odgovorna lica: upisano, čeka provjeru drugog", !sivo && status === "CEKA_VERIFIKACIJU", status);
      }
      provjeri("…bez greške u konzoli", a.greske.length === 0, a.greske.join(" | "));
    } finally {
      await a.zatvori();
    }
  } finally {
    const k = await pool.connect();
    try {
      await k.query("begin");
      await k.query(`update korisnik set skladiste_id = null where id = $1 and skladiste_id = $2`, [NALOZI.marko.id, trag.skladiste]);
      const isporuke = trag.isporuke.filter(Boolean);
      const ncIds = trag.nc ? [trag.nc] : [];
      const sve = [...isporuke, ...ncIds, trag.skladiste].filter(Boolean);
      await k.query(`delete from obavjestenje where izvor_id = any($1) or naslov like $2 or poruka like $2`, [sve, `%${oznaka}%`]);
      await k.query(`delete from zadatak where izvor_id = any($1)`, [sve]);
      await k.query(`delete from audit_log where entitet_id = any($1)`, [sve]);
      await k.query(`delete from verifikacija where neusaglasenost_id = any($1)`, [ncIds]);
      await k.query(`delete from korektivna_mjera where neusaglasenost_id = any($1)`, [ncIds]);
      await k.query(`delete from neusaglasenost where id = any($1)`, [ncIds]);
      await k.query(`delete from isporuka_stavka where isporuka_id = any($1)`, [isporuke]);
      await k.query(`delete from isporuka where id = any($1)`, [isporuke]);
      if (trag.skladiste) await k.query(`delete from skladiste where id = $1`, [trag.skladiste]);
      await k.query(`delete from kljuc_zahtjeva where korisnik_id = $1 and created_at >= $2 and radnja not like 'vm:%'`, [NALOZI.marko.id, t0]);
      await k.query("commit");
    } catch (e) {
      await k.query("rollback");
      throw new Error(`Čišćenje nije uspjelo: ${e.message} ${JSON.stringify(trag)}`);
    } finally {
      k.release();
    }
  }
}
