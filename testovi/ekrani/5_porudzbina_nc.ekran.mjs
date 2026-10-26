// Na telefonu:
//   • nova porudžbina torte kroz formu — „Sačuvaj“ nikad sivo (#74): bez telefona kupca kaže šta fali, pa se čuva;
//   • prijava vlasnice 02.10.2026: „kod Ane neusaglašenost neće da se zatvori“ — dugme je bilo sivo dok se ne označi kvačica ispod;
//     03.10.: „treba da je funkcionalnije“ — sada „Riješeno je“: jedan upis, mjera + provjera + zatvaranje.
import { pool, prijava, NALOZI } from "../pomoc.mjs";
import { telefon, otvori, prozor, slikaj } from "./telefon.mjs";

export const naziv = "Ekrani: zaposleni upisuje porudžbinu torte; Ana sama zatvara neusaglašenost";

export async function pokreni({ provjeri }) {
  const ana = await prijava(NALOZI.ana);
  const oznaka = `E2E5-${Date.now().toString(36)}`;
  const t0 = new Date();
  const trag = { nc: null, porudzbine: [] };
  try {
    // ── Zaposleni: nova porudžbina torte ────────────────────────────────────────────────────
    const t = await telefon("marko");
    try {
      await otvori(t, "/porudzbine");
      await t.strana.getByRole("button", { name: "Nova porudžbina" }).click();
      const m = prozor(t.strana, "Nova porudžbina");
      await m.waitFor();
      await m.getByLabel("Ime kupca").fill(`${oznaka} Jovana`);
      await m.getByLabel("Opis torte").fill("Rođendanska, 12 osoba, čokolada");
      const sacuvaj = m.getByRole("button", { name: "Sačuvaj" });
      const sivo = await sacuvaj.isDisabled();
      await sacuvaj.click();
      const poruka = await m.locator(".auth-error").first().textContent().catch(() => "");
      provjeri("Zaposleni: „Sačuvaj“ bez telefona kupca nije sivo, nego kaže šta fali", !sivo && /Za čuvanje još fali: .*telefon kupca/.test(poruka ?? ""), `${sivo} · ${poruka}`);
      await m.getByLabel(/Telefon kupca/).fill("067 321 654");
      await sacuvaj.click();
      await m.waitFor({ state: "detached", timeout: 15_000 }).catch(() => undefined);
      const nove = (await pool.query(`select id, kupac_telefon from porudzbina where uneo_korisnik_id = $1 and created_at >= $2 and kupac_ime like $3`, [NALOZI.marko.id, t0, `${oznaka}%`])).rows;
      trag.porudzbine.push(...nove.map((r) => r.id));
      await slikaj(t.strana, "7-zaposleni-porudzbina");
      provjeri("…i porudžbina se čuva, sa telefonom kupca", nove.length === 1 && nove[0].kupac_telefon === "067 321 654", JSON.stringify(nove));
      // Stalni kupac iz Šifarnika (demo: kafić) popunjava ime i telefon jednim izborom. Posle čuvanja je otvoren
      // detalj nove porudžbine — strana se otvara ponovo.
      await otvori(t, "/porudzbine");
      await t.strana.getByRole("button", { name: "Nova porudžbina" }).click();
      const m2 = prozor(t.strana, "Nova porudžbina");
      await m2.waitFor();
      const izbor = m2.getByLabel("Stalni kupac (opciono)");
      const kafic = await izbor.locator("option", { hasText: "Kafe Demo Centar" }).getAttribute("value");
      await izbor.selectOption(kafic ?? "");
      const ime = await m2.getByLabel("Ime kupca").inputValue();
      const tel = await m2.getByLabel(/Telefon kupca/).inputValue();
      provjeri("…stalni kupac iz Šifarnika popuni ime i telefon", ime === "Kafe Demo Centar" && tel === "+382 67 200 100", `${ime} · ${tel}`);
      await m2.getByRole("button", { name: "Otkaži" }).click();
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
      const porudzbine = trag.porudzbine.filter(Boolean);
      const ncIds = trag.nc ? [trag.nc] : [];
      const sve = [...porudzbine, ...ncIds].filter(Boolean);
      await k.query(`delete from obavjestenje where izvor_id = any($1) or naslov like $2 or poruka like $2`, [sve, `%${oznaka}%`]);
      await k.query(`delete from zadatak where izvor_id = any($1)`, [sve]);
      await k.query(`delete from audit_log where entitet_id = any($1)`, [sve]);
      await k.query(`delete from verifikacija where neusaglasenost_id = any($1)`, [ncIds]);
      await k.query(`delete from korektivna_mjera where neusaglasenost_id = any($1)`, [ncIds]);
      await k.query(`delete from neusaglasenost where id = any($1)`, [ncIds]);
      await k.query(`delete from porudzbina where id = any($1)`, [porudzbine]);
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
