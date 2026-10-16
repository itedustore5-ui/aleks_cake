// Javljanje grešaka iz pregledača u dnevnik grešaka na serveru (#80): pad ekrana (GreskaGranica),
// neuhvaćena greška i odbačeno obećanje. Najviše 5 u minuti sa jednog ekrana, i nikad ne smeta
// korisniku — ako javljanje ne uspije (npr. nema interneta), tiho se odustaje.

let prozorOd = 0;
let uProzoru = 0;
const vecJavljeno = new Set<string>();

export function prijaviGresku(greska: unknown, komponente?: string) {
  try {
    const e = greska instanceof Error ? greska : new Error(String(greska));
    const potpis = `${e.message}|${(e.stack ?? "").split("\n")[1] ?? ""}`;
    if (vecJavljeno.has(potpis)) return; // ista greška u petlji se javlja jednom
    const sada = Date.now();
    if (sada - prozorOd > 60_000) {
      prozorOd = sada;
      uProzoru = 0;
    }
    if (++uProzoru > 5) return;
    vecJavljeno.add(potpis);
    void fetch("/api/greske/pregledac", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "x-zahtjev-app": "1" },
      body: JSON.stringify({
        poruka: (e.message || e.name || "Greška").slice(0, 1000),
        stek: e.stack?.slice(0, 6000),
        komponente: komponente?.slice(0, 3000),
        putanja: window.location.pathname.slice(0, 300),
      }),
    }).catch(() => undefined);
  } catch {
    // javljanje greške ne smije napraviti novu
  }
}

/** Jednom, pri pokretanju aplikacije: greške koje niko nije uhvatio. */
export function javljajNeuhvaceneGreske() {
  window.addEventListener("error", (dogadjaj) => {
    if (dogadjaj.error) prijaviGresku(dogadjaj.error);
  });
  window.addEventListener("unhandledrejection", (dogadjaj) => {
    const razlog = dogadjaj.reason as { code?: string } | undefined;
    // Greške sa servera (ApiGreska) su već obrađene na ekranu — nisu pad aplikacije.
    if (razlog && typeof razlog === "object" && "code" in razlog && "status" in razlog) return;
    prijaviGresku(dogadjaj.reason);
  });
}
