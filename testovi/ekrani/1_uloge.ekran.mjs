// Svaka strana svake uloge na telefonu (375 px): otvara se, nema vodoravnog skrola, nema greške u
// konzoli; meni na telefonu se otvara i nudi samo strane te uloge.
import { telefon, otvori, siroko } from "./telefon.mjs";

export const naziv = "Ekrani: sve tri uloge, svaka strana na telefonu (375 px)";

// Isto kao meni (STAVKE u src/components/Layout.tsx).
const STRANE = {
  marko: ["/moja", "/porudzbine", "/vitrina", "/prijem", "/zalihe", "/haccp", "/neusaglasenosti", "/poruke"],
  ana: ["/tabla", "/moja", "/porudzbine", "/vitrina", "/prijem", "/zalihe", "/haccp", "/haccp-plan", "/neusaglasenosti", "/poruke", "/ljudi", "/sifarnici", "/sledljivost", "/prilozi", "/inspekcija"],
};
STRANE.konsultant = [...STRANE.ana, "/izvjestaji", "/stanje", "/audit", "/admin"];
const IME = { marko: "Zaposleni", ana: "Vlasnica", konsultant: "Konsultant" };

export async function pokreni({ provjeri }) {
  for (const [nalog, strane] of Object.entries(STRANE)) {
    const t = await telefon(nalog);
    try {
      const lose = [];
      for (const putanja of strane) {
        const prije = t.greske.length;
        try {
          await otvori(t, putanja);
        } catch (e) {
          lose.push(`${putanja}: ne otvara se (${e.message.split("\n")[0]})`);
          continue;
        }
        const s = await siroko(t.strana);
        if (s.visak > 0) lose.push(`${putanja}: šire od ekrana ${s.visak}px (${s.krivi.join(", ")})`);
        const nove = t.greske.slice(prije);
        if (nove.length) lose.push(`${putanja}: ${nove.join(" | ")}`);
      }
      provjeri(`${IME[nalog]}: ${strane.length} strana se otvara na telefonu, bez vodoravnog skrola i bez greške`, lose.length === 0, lose.join("; "));

      if (nalog === "ana") {
        // Prilozi za štampu imaju četiri kartice — svaka mora stati u telefon (tabele se skroluju same).
        await otvori(t, "/prilozi");
        const siroki = [];
        for (const kartica of ["Rješenje o imenovanju", "Prilog 13 — Plan obuke", "Prilog 14 — Evidencija", "HACCP plan"]) {
          await t.strana.getByRole("button", { name: kartica }).click();
          await t.strana.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
          const s = await siroko(t.strana);
          if (s.visak > 0) siroki.push(`${kartica}: ${s.visak}px (${s.krivi.join(", ")})`);
        }
        provjeri("Vlasnica: sva četiri priloga za štampu staju u telefon", siroki.length === 0, siroki.join("; "));
      }

      // Meni na telefonu: skriven dok se ne otvori, pa nudi tačno strane uloge.
      await otvori(t, strane[0]);
      const zatvoren = await t.strana.locator(".sidebar.is-open").count();
      await t.strana.locator(".mobile-menu").click();
      await t.strana.locator(".sidebar.is-open").waitFor({ timeout: 5000 });
      const stavke = await t.strana.locator(".sidebar .nav-item").evaluateAll((l) => l.map((a) => a.getAttribute("href")));
      provjeri(
        `${IME[nalog]}: meni je na telefonu zatvoren, otvara se i nudi samo svoje strane`,
        zatvoren === 0 && stavke.length === strane.length && strane.every((s) => stavke.includes(s)),
        `${zatvoren} · ${stavke.join(" ")}`,
      );
      // Strane distributera (vozila, isporuke) više ne postoje — adresa vodi na početnu stranu uloge.
      await t.strana.goto(`${t.strana.url().replace(/\/[^/]*$/, "")}/vozila`, { waitUntil: "domcontentloaded" });
      await t.strana.waitForSelector(".page-header h1", { timeout: 20_000 });
      provjeri(`${IME[nalog]}: adresa /vozila ne otvara ništa od distributera`, !/\/vozila$/.test(t.strana.url()) || (await t.strana.locator(".vehicle-card").count()) === 0, t.strana.url());
    } finally {
      await t.zatvori();
    }
  }
}
