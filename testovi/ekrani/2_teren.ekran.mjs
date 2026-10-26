// Rad u ateljeu kroz ekran telefona, kao što ga radi čovjek: zaposleni predaje tortu, mjeri temperaturu,
// upisuje dnevni obrazac i počinje prijem; vlasnica vidi Kontrolni centar (torte bez potvrđenih alergena)
// i ide na paket za inspekciju.
import { pool, NALOZI } from "../pomoc.mjs";
import { telefon, otvori, siroko, prozor, slikaj } from "./telefon.mjs";
import { napraviTeren, napraviKomoru, ocisti } from "./priprema.mjs";

export const naziv = "Ekrani: zaposleni (predaja torte, mjerenje, obrazac, prijem), vlasnica (Kontrolni centar)";

/** Čeka da uslov u bazi postane tačan (ekran upisuje u pozadini). */
async function sacekaj(upit, parametri, uslov, ms = 15_000) {
  const kraj = Date.now() + ms;
  let red = null;
  while (Date.now() < kraj) {
    red = (await pool.query(upit, parametri)).rows[0];
    if (uslov(red)) return red;
    await new Promise((ok) => setTimeout(ok, 200));
  }
  return red;
}

export async function pokreni({ provjeri }) {
  const oznaka = `E2EEK${Date.now().toString(36)}`;
  let trag = null;
  try {
    const teren = await napraviTeren(oznaka);
    trag = teren.trag;
    await napraviKomoru(trag);

    const zaposleni = await telefon("marko");
    try {
      // ── Predaja torte ──────────────────────────────────────────────────────────────────────
      await otvori(zaposleni, "/porudzbine");
      await zaposleni.strana.locator("button.porudzbina-kartica", { hasText: teren.kupac }).click();
      const detalj = prozor(zaposleni.strana, `${teren.broj} · ${teren.kupac}`);
      await detalj.getByRole("button", { name: "Predaj tortu" }).click();
      const status = await sacekaj(`select status, predaja_van_mreze from porudzbina where id = $1`, [teren.porudzbinaId], (r) => r?.status === "PREDATA");
      provjeri("Zaposleni: predaja torte kroz ekran — PREDATA (sa mrežom, bez oznake „bez mreže“)", status?.status === "PREDATA" && status.predaja_van_mreze === false, JSON.stringify(status));
      const s0 = await siroko(zaposleni.strana);
      provjeri("…ekran porudžbine ne viri van telefona, bez greške", s0.visak === 0 && zaposleni.greske.length === 0, `${s0.visak}px ${s0.krivi.join(",")} ${zaposleni.greske.join(" | ")}`);

      // ── Mjerenje, obrazac, prijem ───────────────────────────────────────────────────────────
      await otvori(zaposleni, "/haccp");
      await zaposleni.strana.getByRole("button", { name: "Novo mjerenje" }).click();
      const m = prozor(zaposleni.strana, "Novo temperaturno mjerenje");
      await m.getByLabel("Kontrolna tačka").selectOption({ label: `${oznaka} komora` });
      await m.getByLabel("Vrijednost").fill("3.4");
      const termometar = m.locator("select").filter({ has: zaposleni.strana.locator("option", { hasText: `${oznaka} termometar` }) });
      await termometar.selectOption({ label: await termometar.locator("option", { hasText: `${oznaka} termometar` }).first().textContent() });
      await m.getByRole("button", { name: "Sačuvaj" }).click();
      const rezultat = prozor(zaposleni.strana, "Mjerenje zabilježeno");
      await rezultat.waitFor({ timeout: 15_000 });
      await rezultat.locator(".modal-footer").getByRole("button", { name: "Zatvori" }).click();
      const mjerenje = (await pool.query(`select vrijednost::float as v, mjerni_uredjaj_id from mjerenje_temperature where kontrolna_tacka_id = $1`, [trag.tacka])).rows;
      provjeri("Zaposleni: mjerenje kroz ekran — upisano sa izabranim termometrom", mjerenje.length === 1 && mjerenje[0].v === 3.4 && mjerenje[0].mjerni_uredjaj_id === trag.uredjaj, JSON.stringify(mjerenje));

      const t0 = new Date();
      await zaposleni.strana.getByRole("button", { name: /^P9 — / }).click();
      const z = prozor(zaposleni.strana, "P9");
      const sacuvajZ = z.getByRole("button", { name: "Sačuvaj" });
      const zakljucano = await sacuvajZ.isDisabled();
      for (const izbor of await z.locator("select").all()) await izbor.selectOption("da");
      await sacuvajZ.click();
      await z.waitFor({ state: "detached", timeout: 15_000 });
      const zapis = (await pool.query(`select id from zapis where uneo_korisnik_id = $1 and obrazac_kod = 'P9' and created_at >= $2 order by created_at desc`, [NALOZI.marko.id, t0])).rows;
      trag.zapisi.push(...zapis.map((r) => r.id));
      provjeri("Zaposleni: obrazac P9 — bez odgovora se ne čuva, sa odgovorima je upisan", zakljucano && zapis.length === 1, `${zakljucano} ${zapis.length}`);

      await otvori(zaposleni, "/prijem");
      await zaposleni.strana.getByRole("button", { name: "Novi prijem" }).click();
      const prijem = prozor(zaposleni.strana, "Novi prijem robe");
      await prijem.getByText("Kako unosite prijem?").waitFor({ timeout: 10_000 });
      const izbori = await Promise.all(["Slikaj otpremnicu", "Učitaj PDF ili sliku", "Upiši ručno"].map((x) => prijem.getByText(x).isVisible()));
      const s = await siroko(zaposleni.strana);
      provjeri("Zaposleni: prijem prvo pita kako se unosi (slikaj / PDF / ručno), prozor ne viri van ekrana", izbori.every(Boolean) && s.visak === 0, `${izbori} ${s.visak}px ${s.krivi.join(",")}`);
      provjeri("…bez greške u konzoli", zaposleni.greske.length === 0, zaposleni.greske.join(" | "));
    } finally {
      await zaposleni.zatvori();
    }

    // ── Vlasnica: Kontrolni centar ateljea ───────────────────────────────────────────────────
    const vlasnica = await telefon("ana");
    try {
      await otvori(vlasnica, "/tabla");
      const strana = vlasnica.strana;
      // Demo ima današnju tortu bez potvrđenih alergena (99_demo_atelje).
      const kartica = strana.getByText("Torte (danas, sutra) bez potvrđenih alergena");
      await kartica.first().waitFor({ timeout: 10_000 });
      const meni = await strana.evaluate(() => [...document.querySelectorAll("nav a")].map((a) => a.getAttribute("href")));
      await slikaj(strana, "2-vlasnica-tabla");
      const s = await siroko(strana);
      provjeri(
        "Vlasnica: Kontrolni centar pokazuje torte bez potvrđenih alergena; meni bez vozila i isporuka; ne viri van ekrana",
        (await kartica.count()) >= 1 && !meni.some((h) => ["/vozila", "/isporuka"].includes(h)) && s.visak === 0,
        `${meni.join(",")} ${s.visak}px ${s.krivi.join(",")}`,
      );
      await otvori(vlasnica, "/inspekcija");
      await strana.locator(".insp-dokument .insp-odjeljak h2", { hasText: "Porudžbine torti" }).first().waitFor({ timeout: 20_000 });
      provjeri("Vlasnica: paket za inspekciju ima odjeljak porudžbina torti", true);
      provjeri("…bez greške u konzoli", vlasnica.greske.length === 0, vlasnica.greske.join(" | "));
    } finally {
      await vlasnica.zatvori();
    }
  } finally {
    if (trag) await ocisti(trag);
  }
}
