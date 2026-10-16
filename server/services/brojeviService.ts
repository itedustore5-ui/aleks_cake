import type { PoolClient } from "pg";
import { danasCG } from "../vrijeme.js";

// Tabela → kolona sa brojem. Ime ide direktno u SQL, zato samo sa ovog spiska.
const KOLONA = { neusaglasenost: "broj", isporuka: "broj", povlacenje: "broj", lice: "sifra" } as const;
type Tabela = keyof typeof KOLONA;

/** YYMMDD po podgoričkom vremenu — dio broja dokumenta (NC-260924-001). */
export const danasKratko = () => danasCG().replace(/-/g, "").slice(2);

/** Sljedeći broj dokumenta — JEDNO mjesto za sve brojeve (nalaz B1).
 *
 * Ranije `count(*) + 1` na četiri mjesta: dva istovremena unosa dobiju isti broj i drugi padne na
 * unique; povlačenje i kontrola vozila su pravili treći format sa nasumičnim brojem (`NC-…-P417`).
 *
 * Sada: ključ po prefiksu (`pg_advisory_xact_lock`) drži drugog da čeka dok prvi ne završi
 * transakciju, pa tek onda čita najveći postojeći broj. Zato se zove UNUTAR transakcije koja i
 * upisuje red — van nje se ključ pušta odmah i ne štiti ništa. Stari nasumični brojevi ne
 * odgovaraju obrascu i ne smetaju. */
export async function sljedeciBroj(klijent: PoolClient, tabela: Tabela, prefiks: string, cifara = 3): Promise<string> {
  const kolona = KOLONA[tabela];
  await klijent.query(`select pg_advisory_xact_lock(hashtext($1))`, [`broj:${tabela}:${prefiks}`]);
  const rezultat = await klijent.query<{ n: number }>(
    `select coalesce(max(substring(${kolona} from '^' || $1 || '-(\\d+)$')::int), 0) + 1 as n
     from ${tabela} where ${kolona} like $1 || '-%'`,
    [prefiks],
  );
  return `${prefiks}-${String(rezultat.rows[0].n).padStart(cifara, "0")}`;
}

export const sljedeciBrojNc = (klijent: PoolClient) => sljedeciBroj(klijent, "neusaglasenost", `NC-${danasKratko()}`);
