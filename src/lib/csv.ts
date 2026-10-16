/** CSV od onoga što je na ekranu (poslije filtera) — za Excel: tačka-zarez i BOM, da č/ć/š/ž
 * ostanu ispravni. Isti format kao serverski izvoz. */
export function preuzmiCsv(nazivFajla: string, kolone: { kljuc: string; naziv: string }[], redovi: Record<string, unknown>[]) {
  const vrijednost = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const tekst = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[";\n,]/.test(tekst) ? `"${tekst.replace(/"/g, '""')}"` : tekst;
  };
  const sadrzaj = [kolone.map((k) => vrijednost(k.naziv)).join(";"), ...redovi.map((r) => kolone.map((k) => vrijednost(r[k.kljuc])).join(";"))].join("\n");
  const blob = new Blob([`﻿${sadrzaj}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nazivFajla.endsWith(".csv") ? nazivFajla : `${nazivFajla}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
