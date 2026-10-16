// Vozač bez signala (invarijanta #85): aplikacija je sačuvana na telefonu, D1 i predaja se upisuju bez
// mreže, čekaju na telefonu (i posle ponovnog otvaranja), i odu same kad se signal vrati — sa oznakom
// „bez mreže“ i redom kojim su urađene (D1 prije predaje).
import { pool } from "../pomoc.mjs";
import { telefon, otvori, prozor, slikaj } from "./telefon.mjs";
import { napraviTeren, ocisti } from "./priprema.mjs";

export const naziv = "Ekrani: vozač bez signala — D1 i predaja čekaju na telefonu i odu same";

export async function pokreni({ provjeri }) {
  const oznaka = `E2EBM${Date.now().toString(36)}`;
  let trag = null;
  const t = await telefon("petar");
  try {
    const teren = await napraviTeren(oznaka);
    trag = teren.trag;

    // ── Sa signalom: aplikacija se sačuva na telefonu ───────────────────────────────────────
    await otvori(t, "/vozila");
    await t.strana.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 30_000 });
    // Service worker sada vodi stranu — liste i detalji isporuka idu kroz njega i čuvaju se.
    await otvori(t, "/vozila");
    await otvori(t, "/isporuka");
    await t.strana.locator("tr", { hasText: teren.broj }).waitFor();
    const kes = await t.strana.evaluate(async (id) => {
      const imena = await caches.keys();
      const app = imena.find((i) => i.startsWith("pilot-app-"));
      const spisak = await fetch("/offline-spisak.json").then((r) => r.json());
      const uKesu = app ? await Promise.all(spisak.fajlovi.map(async (f) => !!(await (await caches.open(app)).match(f)))) : [];
      const api = await caches.open("pilot-api-v1");
      const detalj = await api.match(`/api/isporuke/${id}`);
      return { app: !!app, fajlova: spisak.fajlovi.length, sacuvano: uKesu.filter(Boolean).length, detalj: !!detalj };
    }, teren.isporukaId);
    provjeri(
      "Sa signalom: sve strane aplikacije sačuvane na telefonu (i one koje vozač još nije otvorio)",
      kes.app && kes.fajlova > 10 && kes.sacuvano === kes.fajlova,
      `${kes.sacuvano}/${kes.fajlova}`,
    );
    provjeri("…i stavke današnje isporuke (za predaju bez signala)", kes.detalj);

    // ── Bez signala: D1 ────────────────────────────────────────────────────────────────────
    await t.mreza(false);
    await t.strana.locator("nav").getByRole("link", { name: "Vozila", includeHidden: true }).evaluate((a) => a.click());
    await t.strana.waitForSelector(".vehicle-card");
    const traka = t.strana.locator(".upozorenje-traka", { hasText: "Nema interneta" });
    provjeri("Bez signala: traka kaže da se D1, predaja, mjerenje… čuvaju na telefonu", await traka.isVisible());
    const kartica = t.strana.locator(".vehicle-card", { hasText: teren.registarski });
    await kartica.getByRole("button", { name: "Nova kontrola (D1)" }).click();
    const d1 = prozor(t.strana, "Kontrola vozila");
    for (const pitanje of ["Tovarni prostor čist", "Oprema ispravna", "Vrata i brtve ispravni"]) await d1.getByLabel(pitanje).selectOption("da");
    await d1.getByRole("button", { name: "Sačuvaj" }).click();
    await d1.getByText("Sačuvano na telefonu").waitFor({ timeout: 10_000 });
    await slikaj(t.strana, "1-d1-sacuvano-na-telefonu");
    await d1.getByRole("button", { name: "U redu" }).click();
    provjeri("D1 bez signala: „Sačuvano na telefonu“, vozilo pokazuje „čeka mrežu“", await kartica.getByText("čeka mrežu").isVisible());

    // ── Bez signala: predaja ───────────────────────────────────────────────────────────────
    await t.strana.locator("nav").getByRole("link", { name: "Isporuka", includeHidden: true }).evaluate((a) => a.click());
    const red = t.strana.locator("tr", { hasText: teren.broj });
    await red.getByRole("button", { name: "Potvrdi" }).click();
    const potvrda = prozor(t.strana, `Potvrda isporuke ${teren.broj}`);
    await potvrda.getByRole("button", { name: "Potvrdi" }).click();
    await potvrda.getByText("Sačuvano na telefonu").waitFor({ timeout: 10_000 });
    await potvrda.getByRole("button", { name: "U redu" }).click();
    provjeri("Predaja bez signala: sačuvana na telefonu, „Potvrdi“ zamijenjeno sa „čeka mrežu“ (ne potvrđuje se dvaput)", (await red.getByText("čeka mrežu").isVisible()) && (await red.getByRole("button", { name: "Potvrdi" }).count()) === 0);
    const cekaju = t.strana.locator(".izlaz-traka", { hasText: "čekaju mrežu" });
    await t.strana.evaluate(() => window.scrollTo(0, 0));
    await slikaj(t.strana, "2-isporuka-ceka-mrezu");
    provjeri("…na vrhu: „2 upisa čekaju mrežu“", (await cekaju.innerText()).includes("2 upisa"));
    const naServeru = (await pool.query(`select status from isporuka where id = $1`, [teren.isporukaId])).rows[0]?.status;
    provjeri("…a na serveru još ništa (isporuka u pripremi)", naServeru === "U_PRIPREMI", naServeru);

    // ── Telefon zaključan i ponovo otvoren, i dalje bez signala ───────────────────────────
    await t.strana.reload({ waitUntil: "domcontentloaded" });
    await t.strana.waitForSelector(".page-header h1", { timeout: 20_000 });
    provjeri("Aplikacija se otvara i bez signala, a upisi i dalje čekaju", (await t.strana.locator(".izlaz-traka", { hasText: "2 upisa" }).count()) === 1);

    // ── Signal se vratio ───────────────────────────────────────────────────────────────────
    const t0 = new Date();
    await t.mreza(true);
    // „2 upisa čekaju“ → „1 upis čeka“ → ništa: čeka se da ne čeka NIJEDAN (jednina i množina).
    await t.strana.locator(".izlaz-traka", { hasText: /čeka(ju)? mrežu/ }).waitFor({ state: "detached", timeout: 30_000 });
    const d1Red = (await pool.query(`select izvrseno_at, van_mreze, created_at from kontrola_vozila where vozilo_id = $1`, [trag.vozilo])).rows;
    const isp = (await pool.query(`select status, potvrdjeno_at, potvrda_van_mreze from isporuka where id = $1`, [teren.isporukaId])).rows[0];
    provjeri("Signal se vratio: D1 stigla sama, sa oznakom „bez mreže“ i vremenom kad je urađena", d1Red.length === 1 && d1Red[0].van_mreze && new Date(d1Red[0].izvrseno_at) < t0, JSON.stringify(d1Red));
    provjeri(
      "…predaja stigla posle nje, potvrđena, sa oznakom i vremenom predaje",
      isp?.status === "POTVRDJENA" && isp.potvrda_van_mreze && new Date(isp.potvrdjeno_at) < t0 && new Date(isp.potvrdjeno_at) >= new Date(d1Red[0]?.izvrseno_at),
      JSON.stringify(isp),
    );
    // Posle slanja „Potvrdi“ se ne vraća ni na trenutak (lista kaže „Predaja poslata“ dok se ne osvježi).
    let potvrdiSeVratilo = false;
    const kraj = Date.now() + 10_000;
    while (Date.now() < kraj) {
      if ((await red.getByRole("button", { name: "Potvrdi" }).count()) > 0) potvrdiSeVratilo = true;
      if ((await red.getByText(/čeka mrežu|Predaja poslata/).count()) === 0) break;
      await t.strana.waitForTimeout(100);
    }
    const tekstReda = await red.innerText();
    provjeri("…lista se osvježila sama, a „Potvrdi“ se nije vratilo ni na trenutak", !potvrdiSeVratilo && !/čeka mrežu|Predaja poslata/.test(tekstReda), tekstReda.replace(/\s+/g, " "));
    provjeri("…i predaja u listi nosi oznaku „bez mreže“", await red.getByText("bez mreže").isVisible());
    await slikaj(t.strana, "3-poslato-kad-je-dosao-signal");
    provjeri("Bez greške u konzoli (osim očekivanih grešaka mreže)", t.greske.length === 0, t.greske.join(" | "));
  } finally {
    await t.zatvori();
    if (trag) await ocisti(trag);
  }
}
