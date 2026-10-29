// Predlog za HACCP plan ateljea — granica i tekst kontrolne tačke (29.10.2026, jedno mjesto za server i ekran).
// Upisuje se SAMO na izričitu radnju („Predloži osnovni plan“, „Predloži tekst“, nov uređaj u „Prvim koracima“,
// prvi-korisnik) i samo gdje je prazno; konsultant ga prilagođava ateljeu. Ocjena mjerenja čita samo pravilo
// (P3, #39) — nikad ovaj fajl.

export type VrstaUredjaja = "frizider" | "vitrina" | "zamrzivac";

// Uređaji za čuvanje: svaki je svoja kontrolna tačka sa svojom granicom. Šifra počinje sa KKT2 — po tome ih osnovni
// plan prepoznaje. Prvi svake vrste je „osnovna“ tačka (prvi-korisnik), svaki sljedeći dobija broj (KKT2-F2, KKT2-V2…).
export const UREDJAJI: Record<VrstaUredjaja, { naziv: string; osnovna: string; prefiks: string; opis: string; granica: [number, number]; pravilo: string }> = {
  frizider: { naziv: "Frižider", osnovna: "KKT2", prefiks: "KKT2-F", opis: "Temperatura frižidera sa kremovima, filovima i gotovim tortama", granica: [0, 4], pravilo: "Frižider — rashlađeno" },
  vitrina: { naziv: "Vitrina", osnovna: "KKT2-V", prefiks: "KKT2-V", opis: "Temperatura vitrine sa tortama i kolačima u prodaji", granica: [0, 4], pravilo: "Vitrina — rashlađeno" },
  zamrzivac: { naziv: "Zamrzivač", osnovna: "KKT2-Z", prefiks: "KKT2-Z", opis: "Temperatura zamrzivača (smrznuto voće, biskvit, poluproizvodi)", granica: [-25, -18], pravilo: "Zamrzivač — smrznuto" },
};
export const VRSTE_UREDJAJA = Object.keys(UREDJAJI) as [VrstaUredjaja, ...VrstaUredjaja[]];

/** Vrsta uređaja po šifri tačke (KKT2-Z… zamrzivač, KKT2-V… vitrina, ostalo KKT2… frižider); null za ostale tačke. */
export function vrstaPoSifri(sifra: string): VrstaUredjaja | null {
  if (!sifra.startsWith("KKT2")) return null;
  if (sifra.startsWith("KKT2-Z")) return "zamrzivac";
  if (sifra.startsWith("KKT2-V")) return "vitrina";
  return "frizider";
}

/** Predložena opšta granica tačke (iste kao demo, 27.10.2026). */
export function predlogGranice(sifra: string): { naziv: string; min: number; max: number } | null {
  if (sifra === "KKT3") return { naziv: "Torta pri predaji — rashlađeno", min: 0, max: 6 };
  const vrsta = vrstaPoSifri(sifra);
  if (!vrsta) return null;
  const u = UREDJAJI[vrsta];
  return { naziv: u.pravilo, min: u.granica[0], max: u.granica[1] };
}

export type TekstTacke = { opasnost: string; korektivnaMjera: string; verifikacija: string };

// Tekst za HACCP plan (PLAN.md, dio 4) — polazni prijedlog; konsultant ga prilagođava ateljeu (npr. bez jaja).
const TEKST: Record<string, TekstTacke> = {
  KKT1: {
    opasnost: "Salmonela iz jaja; umnožavanje Listerije i drugih mikroorganizama ako mliječni sastojci stignu topliji od granice; kontaminacija kroz oštećenu ambalažu ili napukla jaja.",
    korektivnaMjera: "Sastojak van granice se ne koristi — zadržava se (HOLD) do odluke odgovornog lica; dobavljač se obavještava; odluka i razlog se upisuju.",
    verifikacija: "Odgovorno lice sedmično pregleda zapise prijema; termometar se provjerava mjesečno (ledena voda 0 °C) i kalibriše godišnje.",
  },
  frizider: {
    opasnost: "Umnožavanje mikroorganizama (Listeria, stafilokok) u kremovima, šlagu i mliječnim filovima kad je temperatura frižidera iznad granice.",
    korektivnaMjera: "Proizvode premjestiti u ispravan frižider, pozvati servis, procijeniti koliko dugo su bili van granice i odlučiti o otpisu; upisati šta je urađeno.",
    verifikacija: "Mjerenja dva puta dnevno; odgovorno lice sedmično pregleda zapise i provjerava da nema propuštenih dana.",
  },
  vitrina: {
    opasnost: "Umnožavanje mikroorganizama u tortama i kolačima sa kremom u vitrini — vrata se često otvaraju, a roba stoji cio dan.",
    korektivnaMjera: "Torte premjestiti u frižider, provjeriti vrata i zaptivku, pozvati servis; procijeniti koliko su dugo bile van granice i odlučiti o otpisu; upisati šta je urađeno.",
    verifikacija: "Mjerenja dva puta dnevno; odgovorno lice sedmično pregleda zapise.",
  },
  zamrzivac: {
    opasnost: "Otapanje i ponovno zamrzavanje (smrznuto voće, biskvit, poluproizvodi) — umnožavanje mikroorganizama i gubitak kvaliteta.",
    korektivnaMjera: "Robu premjestiti u ispravan zamrzivač; otopljeno se ne zamrzava ponovo — upotrijebiti odmah ili otpisati; pozvati servis; upisati šta je urađeno.",
    verifikacija: "Mjerenja dva puta dnevno; odgovorno lice sedmično pregleda zapise.",
  },
  KKT3: {
    opasnost: "Prekid hladnog lanca tokom dostave torte do kupca (sala, hotel).",
    korektivnaMjera: "Torta van granice se ne predaje bez procjene odgovornog lica; otvara se neusaglašenost; prevoz (rashladna kutija, vrijeme) se mijenja prije sljedeće dostave.",
    verifikacija: "Pregled temperatura pri predaji uz porudžbine; odgovorno lice provjerava da svaka dostava ima temperaturu.",
  },
};
const TEKST_OPSTI: TekstTacke = {
  opasnost: "Umnožavanje mikroorganizama pri temperaturi van granice.",
  korektivnaMjera: "Utvrditi uzrok, zaštititi proizvode (premjestiti ili zadržati), otvoriti neusaglašenost i upisati šta je urađeno.",
  verifikacija: "Odgovorno lice sedmično pregleda zapise.",
};

export function predlogTeksta(sifra: string): TekstTacke {
  const s = sifra.toUpperCase();
  return TEKST[s] ?? TEKST[vrstaPoSifri(s) ?? ""] ?? TEKST_OPSTI;
}
