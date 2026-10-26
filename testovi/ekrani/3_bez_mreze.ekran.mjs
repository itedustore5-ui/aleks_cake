// Zaposleni bez signala (invarijanta #85) — hladna komora, dostava torte: aplikacija je sačuvana na telefonu,
// mjerenje i predaja torte se upisuju bez mreže, čekaju na telefonu (i posle ponovnog otvaranja), i odu same kad
// se signal vrati — sa oznakom „bez mreže“ i redom kojim su urađeni.
import { pool } from "../pomoc.mjs";
import { telefon, otvori, prozor, slikaj } from "./telefon.mjs";
import { napraviTeren, napraviKomoru, ocisti } from "./priprema.mjs";

export const naziv = "Ekrani: zaposleni bez signala — mjerenje i predaja torte čekaju na telefonu i odu same";

export async function pokreni({ provjeri }) {
  const oznaka = `E2EBM${Date.now().toString(36)}`;
  let trag = null;
  const t = await telefon("marko");
  try {
    const teren = await napraviTeren(oznaka);
    trag = teren.trag;
    await napraviKomoru(trag);

    // ── Sa signalom: aplikacija se sačuva na telefonu ───────────────────────────────────────
    await otvori(t, "/porudzbine");
    await t.strana.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30_000 });
    // Service worker sada vodi stranu — liste i detalji idu kroz njega i čuvaju se.
    await otvori(t, "/haccp");
    await otvori(t, "/porudzbine");
    const kartica = t.strana.locator("button.porudzbina-kartica", { hasText: teren.kupac });
    await kartica.click();
    const naslov = `${teren.broj} · ${teren.kupac}`;
    await prozor(t.strana, naslov).getByRole("button", { name: "Predaj tortu" }).waitFor();
    await prozor(t.strana, naslov).locator(".modal-footer").getByRole("button", { name: "Zatvori" }).click();
    const kes = await t.strana.evaluate(async (id) => {
      const imena = await caches.keys();
      const app = imena.find((i) => i.startsWith("pilot-app-"));
      const spisak = await fetch("/offline-spisak.json").then((r) => r.json());
      const uKesu = app ? await Promise.all(spisak.fajlovi.map(async (f) => !!(await (await caches.open(app)).match(f)))) : [];
      const api = await caches.open("pilot-api-v1");
      const detalj = await api.match(`/api/porudzbine/${id}`);
      return { app: !!app, fajlova: spisak.fajlovi.length, sacuvano: uKesu.filter(Boolean).length, detalj: !!detalj };
    }, teren.porudzbinaId);
    provjeri(
      "Sa signalom: sve strane aplikacije sačuvane na telefonu (i one koje zaposleni još nije otvorio)",
      kes.app && kes.fajlova > 10 && kes.sacuvano === kes.fajlova,
      `${kes.sacuvano}/${kes.fajlova}`,
    );
    provjeri("…i detalj današnje torte (za predaju bez signala)", kes.detalj);

    // ── Bez signala: mjerenje ──────────────────────────────────────────────────────────────
    await t.mreza(false);
    await t.strana.locator("nav").getByRole("link", { name: "HACCP / DHP", includeHidden: true }).evaluate((a) => a.click());
    await t.strana.getByRole("button", { name: "Novo mjerenje" }).waitFor({ timeout: 15_000 });
    const traka = t.strana.locator(".upozorenje-traka", { hasText: "Nema interneta" });
    provjeri("Bez signala: traka kaže da se mjerenje, predaja… čuvaju na telefonu", await traka.isVisible());
    await t.strana.getByRole("button", { name: "Novo mjerenje" }).click();
    const m = prozor(t.strana, "Novo temperaturno mjerenje");
    await m.getByLabel("Kontrolna tačka").selectOption({ label: `${oznaka} komora` });
    await m.getByLabel("Vrijednost").fill("3.6");
    const termometar = m.locator("select").filter({ has: t.strana.locator("option", { hasText: `${oznaka} termometar` }) });
    await termometar.selectOption({ label: await termometar.locator("option", { hasText: `${oznaka} termometar` }).first().textContent() });
    await m.getByRole("button", { name: "Sačuvaj" }).click();
    const sacuvanoM = prozor(t.strana, "Temperaturno mjerenje");
    await sacuvanoM.getByText("Sačuvano na telefonu").waitFor({ timeout: 10_000 });
    await slikaj(t.strana, "1-mjerenje-sacuvano-na-telefonu");
    await sacuvanoM.getByRole("button", { name: "U redu" }).click();
    provjeri("Mjerenje bez signala: „Sačuvano na telefonu“", true);

    // ── Bez signala: predaja torte ─────────────────────────────────────────────────────────
    await t.strana.locator("nav").getByRole("link", { name: "Porudžbine", includeHidden: true }).evaluate((a) => a.click());
    await kartica.click();
    await prozor(t.strana, naslov).getByRole("button", { name: "Predaj tortu" }).click();
    const sacuvanoP = prozor(t.strana, `Predaja ${teren.broj}`);
    await sacuvanoP.getByText("Sačuvano na telefonu").waitFor({ timeout: 10_000 });
    await sacuvanoP.getByRole("button", { name: "U redu" }).click();
    await prozor(t.strana, naslov).locator(".ceka-mrezu", { hasText: "Predaja je na telefonu" }).waitFor({ timeout: 5000 });
    provjeri("Predaja bez signala: sačuvana na telefonu, „Predaj tortu“ zamijenjeno porukom da čeka mrežu (ne predaje se dvaput)", (await prozor(t.strana, naslov).getByRole("button", { name: "Predaj tortu" }).count()) === 0);
    await prozor(t.strana, naslov).locator(".modal-footer").getByRole("button", { name: "Zatvori" }).click();
    const cekaju = t.strana.locator(".izlaz-traka", { hasText: "čekaju mrežu" });
    await t.strana.evaluate(() => window.scrollTo(0, 0));
    await slikaj(t.strana, "2-torta-ceka-mrezu");
    provjeri("…na vrhu: „2 upisa čekaju mrežu“", (await cekaju.innerText()).includes("2 upisa"));
    const naServeru = (await pool.query(`select status from porudzbina where id = $1`, [teren.porudzbinaId])).rows[0]?.status;
    provjeri("…a na serveru još ništa (torta nije predata)", naServeru !== "PREDATA", naServeru);

    // ── Telefon zaključan i ponovo otvoren, i dalje bez signala ───────────────────────────
    await t.strana.reload({ waitUntil: "domcontentloaded" });
    await t.strana.waitForSelector(".page-header h1", { timeout: 20_000 });
    provjeri("Aplikacija se otvara i bez signala, a upisi i dalje čekaju", (await t.strana.locator(".izlaz-traka", { hasText: "2 upisa" }).count()) === 1);

    // ── Signal se vratio ───────────────────────────────────────────────────────────────────
    const t0 = new Date();
    await t.mreza(true);
    // „2 upisa čekaju“ → „1 upis čeka“ → ništa: čeka se da ne čeka NIJEDAN (jednina i množina).
    await t.strana.locator(".izlaz-traka", { hasText: /čeka(ju)? mrežu/ }).waitFor({ state: "detached", timeout: 30_000 });
    const mj = (await pool.query(`select izmjereno_at, van_mreze from mjerenje_temperature where kontrolna_tacka_id = $1`, [trag.tacka])).rows;
    const p = (await pool.query(`select status, predato_at, predaja_van_mreze from porudzbina where id = $1`, [teren.porudzbinaId])).rows[0];
    provjeri("Signal se vratio: mjerenje stiglo samo, sa oznakom „bez mreže“ i vremenom kad je urađeno", mj.length === 1 && mj[0].van_mreze && new Date(mj[0].izmjereno_at) < t0, JSON.stringify(mj));
    provjeri(
      "…predaja stigla posle njega, PREDATA, sa oznakom i vremenom predaje",
      p?.status === "PREDATA" && p.predaja_van_mreze && new Date(p.predato_at) < t0 && new Date(p.predato_at) >= new Date(mj[0]?.izmjereno_at),
      JSON.stringify(p),
    );
    await t.strana.locator("button.porudzbina-kartica", { hasText: teren.kupac }).first().waitFor({ timeout: 5000 }).catch(() => undefined);
    await slikaj(t.strana, "3-poslato-kad-je-dosao-signal");
    provjeri("Bez greške u konzoli (osim očekivanih grešaka mreže)", t.greske.length === 0, t.greske.join(" | "));
  } finally {
    await t.zatvori();
    if (trag) await ocisti(trag);
  }
}
