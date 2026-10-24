// 14 alergena iz Uredbe (EU) br. 1169/2011, Prilog II — spisak koji se navodi kupcu. Crnogorski propis o
// informisanju o alergenima za NEUPAKOVANU hranu još nije provjeren (PLAN.md, dio 3); ako se razlikuje,
// mijenja se ovdje I u CHECK-u u bazi (nova dopuna — isto pravilo kao za izvore, invarijanta #36).
// Spisak u bazi: db/38_alergeni_cg.sql (artikal.alergeni) i db/39_porudzbina_cg.sql (porudzbina.alergeni).
export const ALERGENI = [
  { sifra: "GLUTEN", naziv: "Gluten", opis: "žitarice sa glutenom — pšenica (spelta, kamut), raž, ječam, ovas i proizvodi od njih" },
  { sifra: "RAKOVI", naziv: "Rakovi", opis: "rakovi i proizvodi od njih" },
  { sifra: "JAJA", naziv: "Jaja", opis: "jaja i proizvodi od jaja" },
  { sifra: "RIBA", naziv: "Riba", opis: "riba i proizvodi od ribe" },
  { sifra: "KIKIRIKI", naziv: "Kikiriki", opis: "kikiriki i proizvodi od kikirikija" },
  { sifra: "SOJA", naziv: "Soja", opis: "soja i proizvodi od soje" },
  { sifra: "MLIJEKO", naziv: "Mlijeko", opis: "mlijeko i mliječni proizvodi, uključujući laktozu" },
  { sifra: "ORASASTI", naziv: "Orašasti plodovi", opis: "bademi, lješnici, orasi, indijski orah, pekan, brazilski orah, pistaći, makadamija i proizvodi od njih" },
  { sifra: "CELER", naziv: "Celer", opis: "celer i proizvodi od celera" },
  { sifra: "SENF", naziv: "Slačica (senf)", opis: "slačica i proizvodi od nje" },
  { sifra: "SUSAM", naziv: "Susam", opis: "sjeme susama i proizvodi od njega" },
  { sifra: "SULFITI", naziv: "Sumpor-dioksid i sulfiti", opis: "više od 10 mg/kg ili 10 mg/l, izraženo kao SO₂" },
  { sifra: "LUPINA", naziv: "Lupina", opis: "lupina i proizvodi od nje" },
  { sifra: "MEKUSCI", naziv: "Mekušci", opis: "mekušci i proizvodi od njih" },
] as const;

export type SifraAlergena = (typeof ALERGENI)[number]["sifra"];
export const SIFRE_ALERGENA = ALERGENI.map((a) => a.sifra) as [SifraAlergena, ...SifraAlergena[]];

/** Bez ponavljanja, redom iz Priloga II — isti spisak uvijek izgleda isto (i u auditu „prije → poslije“). */
export const urediAlergene = (lista: readonly string[]): SifraAlergena[] => SIFRE_ALERGENA.filter((s) => lista.includes(s));

export const nazivAlergena = (sifra: string) => ALERGENI.find((a) => a.sifra === sifra)?.naziv ?? sifra;
