// Dorada posle probe vlasnice (01.10.2026) na telefonu: filteri izvještaja i audita, poruke po vremenu,
// plan obuke i pitanja — da se nađu bez traženja.
import { telefon, otvori, siroko, prozor, slikaj } from "./telefon.mjs";

export const naziv = "Ekrani: filteri izvještaja i audita, poruke, plan obuke (konsultant)";

export async function pokreni({ provjeri }) {
  // Izvještaji su konsultantovi (11.10.2026).
  const t = await telefon("konsultant");
  try {
    // ── Izvještaji: period i kategorije ─────────────────────────────────────────────────────
    await otvori(t, "/izvjestaji");
    await t.strana.getByRole("button", { name: "Lotovi" }).click();
    await t.strana.getByRole("button", { name: "Ovaj mjesec" }).waitFor({ timeout: 10_000 });
    await t.strana.getByRole("button", { name: "Sve", exact: true }).first().click();
    await t.strana.waitForLoadState("networkidle").catch(() => undefined);
    const statusFilter = t.strana.locator(".filter-bar label", { hasText: "Status" }).locator("select");
    const imaStatus = (await statusFilter.count()) > 0;
    if (imaStatus) {
      // Tabela se čita tek kad stigne filtrirani odgovor.
      const odgovor = t.strana.waitForResponse((r) => r.url().includes("f_status=PRIHVACEN"));
      await statusFilter.selectOption("PRIHVACEN");
      await odgovor;
      await t.strana.waitForTimeout(200);
    }
    const statusi = await t.strana.locator(".data-table tbody tr").evaluateAll((r) => r.map((x) => x.textContent ?? ""));
    await slikaj(t.strana, "4-izvjestaj-filteri");
    const s1 = await siroko(t.strana);
    provjeri(
      "Izvještaj: traka perioda i filter po statusu; tabela prati filter; ne viri van ekrana",
      imaStatus && statusi.length > 0 && statusi.every((x) => /Prihvać/i.test(x)) && s1.visak === 0,
      `${imaStatus} ${statusi.length} ${s1.visak}px ${s1.krivi.join(",")}`,
    );

    // ── Stanje poslovanja: pregled mejla direktoru, „Pošalji“ nikad ćuti (#74) ──────────────────
    await otvori(t, "/stanje");
    await t.strana.getByRole("button", { name: "Sedmica", exact: true }).click();
    await t.strana.waitForFunction(() => /sedmica/.test(document.querySelector(".stanje-period strong")?.textContent ?? ""), null, { timeout: 15_000 });
    const okvir = t.strana.frameLocator("iframe.stanje-okvir");
    await okvir.getByText(/Potrebna je vaša odluka|Uglavnom u redu|Sve pod kontrolom/).first().waitFor({ timeout: 15_000 });
    await t.strana.waitForTimeout(300);
    const mjere = await t.strana.evaluate(() => {
      const f = document.querySelector("iframe.stanje-okvir");
      const d = f?.contentDocument?.documentElement;
      return { visina: f?.getBoundingClientRect().height ?? 0, sirina: f?.clientWidth ?? 0, unutra: d?.scrollWidth ?? 9999 };
    });
    await t.strana.getByRole("button", { name: "Pošalji direktoru" }).click();
    const javljeno = (await t.strana.locator(".stanje-slanje [role=alert]").textContent({ timeout: 5_000 }).catch(() => "")) ?? "";
    await slikaj(t.strana, "4-stanje-poslovanja");
    if (process.env.EKRANI_SLIKE) await t.strana.screenshot({ path: `${process.env.EKRANI_SLIKE}/4-stanje-cijelo.png`, fullPage: true }).catch(() => undefined);
    const s0 = await siroko(t.strana);
    provjeri(
      "Stanje poslovanja: sedmica, mejl u okviru čitav (bez skrola u stranu), „Pošalji“ kaže šta fali; ne viri van ekrana",
      mjere.visina > 600 && mjere.unutra <= mjere.sirina + 1 && /SMTP|primaoce|mejl direktora/.test(javljeno) && s0.visak === 0,
      `okvir ${Math.round(mjere.visina)}px ${mjere.unutra}/${mjere.sirina} · „${javljeno.trim().slice(0, 60)}“ · ${s0.visak}px ${s0.krivi.join(",")}`,
    );

    // „Sačuvaj PDF“: izvještaj u novom prozoru + štampa (pregledač bez prozora je ne prikazuje — ovdje se samo bilježi).
    await t.strana.context().addInitScript(() => {
      window.print = () => {
        window.__stampa = true;
      };
    });
    const [pdfProzor] = await Promise.all([t.strana.context().waitForEvent("page"), t.strana.getByRole("button", { name: "Sačuvaj PDF" }).click()]);
    await pdfProzor.waitForFunction(() => window.__stampa === true, null, { timeout: 5_000 }).catch(() => undefined);
    const pdfNaslov = await pdfProzor.title();
    const stampa = await pdfProzor.evaluate(() => window.__stampa === true);
    if (process.env.EKRANI_SLIKE) await pdfProzor.pdf({ path: `${process.env.EKRANI_SLIKE}/stanje-poslovanja.pdf`, format: "A4", printBackground: true }).catch(() => undefined);
    await pdfProzor.close();
    provjeri("„Sačuvaj PDF“: izvještaj se otvori sam za sebe i ponudi štampu (Sačuvaj kao PDF)", /^Stanje poslovanja — /.test(pdfNaslov) && stampa, `„${pdfNaslov}“ ${stampa}`);

    // ── Audit ───────────────────────────────────────────────────────────────────────────────
    await otvori(t, "/audit");
    // Radnja koja u dnevniku postoji (na čistoj bazi ih je malo) — spisak dolazi sa servera.
    const izborRadnje = t.strana.locator(".filter-bar label", { hasText: "Radnja" }).locator("select");
    await t.strana.waitForFunction(() => [...document.querySelectorAll(".filter-bar select")].some((s) => s.options.length > 1), null, { timeout: 10_000 }).catch(() => undefined);
    const opcije = await izborRadnje.locator("option").evaluateAll((o) => o.map((x) => ({ v: x.value, t: x.textContent ?? "" })).filter((x) => x.v));
    if (opcije.length === 0) {
      provjeri("Audit: filter po radnji · preskočeno (dnevnik je prazan)", true);
    } else {
      const odgovor = t.strana.waitForResponse((r) => r.url().includes(`akcija=${opcije[0].v}`));
      await izborRadnje.selectOption(opcije[0].v);
      await odgovor;
      await t.strana.waitForTimeout(200);
      const radnje = await t.strana.locator(".data-table tbody tr td:nth-child(3)").allTextContents();
      await slikaj(t.strana, "5-audit-filteri");
      provjeri(`Audit: filter po radnji (samo „${opcije[0].t}“), čitljivi nazivi`, radnje.length > 0 && radnje.every((x) => x === opcije[0].t) && !/^[A-Z_]+$/.test(opcije[0].t), `${radnje.length} ${[...new Set(radnje)].join(",")}`);
    }

    // ── Poruke ──────────────────────────────────────────────────────────────────────────────
    await otvori(t, "/poruke");
    const tabovi = await Promise.all(["Sve", "Primljene", "Poslate"].map((n) => t.strana.locator(".panel-header .filter-tabs button", { hasText: n }).count()));
    provjeri("Poruke: jedan spisak — Sve / Primljene / Poslate", tabovi.every((n) => n > 0), tabovi.join(","));

    // ── Plan obuke: sa HACCP plana direktno, za sve koji rukuju hranom ───────────────────────
    await otvori(t, "/haccp-plan");
    await t.strana.getByRole("button", { name: "Plan obuke" }).click();
    await t.strana.getByText("Godišnji plan obuke", { exact: false }).first().waitFor();
    const izabrana = await t.strana.locator(".filter-tabs button.selected").first().textContent();
    await t.strana.getByRole("button", { name: "Nova stavka plana" }).click();
    const modal = prozor(t.strana, "Nova stavka plana obuke");
    const zaKoga = await modal.getByLabel("Za koga").locator("option").allTextContents();
    await slikaj(t.strana, "6-plan-obuke");
    provjeri(
      "Plan obuke: ulaz sa HACCP plana otvara pravu karticu; nova stavka za sve koji rukuju hranom odjednom",
      /Godišnji plan obuke/.test(izabrana ?? "") && zaKoga.some((o) => o.startsWith("Svi koji rukuju hranom")),
      `${izabrana} · ${zaKoga.slice(0, 3).join(" | ")}`,
    );
    provjeri("Bez greške u konzoli", t.greske.length === 0, t.greske.join(" | "));
  } finally {
    await t.zatvori();
  }
}
