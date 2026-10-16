// Inspekcijski paket na telefonu: dokument se sklopi, odjeljci se uključuju/isključuju (brojevi idu redom),
// ZIP se preuzima, a u štampi ostaje samo dokument (bez menija, filtera i dugmadi).
import { telefon, otvori, siroko, slikaj } from "./telefon.mjs";

export const naziv = "Ekrani: inspekcijski paket — dokument, izbor odjeljaka, ZIP, štampa";

export async function pokreni({ provjeri }) {
  const t = await telefon("ana");
  try {
    await otvori(t, "/inspekcija");
    const odjeljci = t.strana.locator(".insp-dokument .insp-odjeljak h2");
    await odjeljci.first().waitFor({ timeout: 20_000 });
    const naslovi = await odjeljci.allInnerTexts();
    const s = await siroko(t.strana);
    await slikaj(t.strana, "10-inspekcija");
    provjeri(
      "Paket se sklopi: 12 odjeljaka, prvi je kontinuitet zapisa, strana ne viri van telefona",
      naslovi.length === 12 && naslovi[0].startsWith("1. Kontinuitet zapisa") && s.visak === 0,
      `${naslovi.length} · ${naslovi[0]} · ${s.visak}px ${s.krivi.join(", ")}`,
    );

    await t.strana.locator(".insp-odjeljci summary").click();
    await t.strana.locator(".insp-odjeljci label", { hasText: "Povlačenja" }).locator("input").uncheck();
    const posle = await odjeljci.allInnerTexts();
    provjeri(
      "Isključen odjeljak nestaje iz dokumenta i iz sadržaja, brojevi idu redom",
      posle.length === 11 && !posle.some((n) => n.includes("Povlačenja")) && posle[10].startsWith("11.") &&
        !(await t.strana.locator(".insp-sadrzaj li", { hasText: "Povlačenja" }).count()),
      posle.join(" | "),
    );

    const [preuzimanje] = await Promise.all([
      t.strana.waitForEvent("download", { timeout: 20_000 }),
      t.strana.getByRole("button", { name: /Podaci za inspektora/ }).click(),
    ]);
    provjeri("„Podaci za inspektora (ZIP)“ preuzima arhivu sa periodom u imenu", /^inspekcijski-paket-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.zip$/.test(preuzimanje.suggestedFilename()), preuzimanje.suggestedFilename());

    await t.strana.emulateMedia({ media: "print" });
    const vidljivo = async (sel) => t.strana.locator(sel).first().isVisible();
    provjeri(
      "Štampa: samo dokument — bez menija, filtera perioda i dugmadi",
      (await vidljivo(".insp-naslovna")) && !(await vidljivo(".insp-akcije")) && !(await vidljivo(".filter-vremena")) && !(await vidljivo(".topbar")),
    );
    if (process.env.EKRANI_SLIKE) await t.strana.pdf({ path: `${process.env.EKRANI_SLIKE}/inspekcijski-paket.pdf`, preferCSSPageSize: true }).catch(() => undefined);
    await t.strana.emulateMedia({ media: "screen" });
    provjeri("…bez greške u konzoli", t.greske.length === 0, t.greske.join(" | "));
  } finally {
    await t.zatvori();
  }
}
