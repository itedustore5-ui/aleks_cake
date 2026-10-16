const ZONA = "Europe/Podgorica";

/** Današnji datum po podgoričkom vremenu (YYYY-MM-DD), ne po UTC-u. */
export function danasCG(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: ZONA });
}

export function jeDatumUBuducnosti(datum: string): boolean {
  return datum > danasCG();
}

export function danaUnazad(datum: string): number {
  const danas = new Date(`${danasCG()}T00:00:00Z`).getTime();
  const dan = new Date(`${datum}T00:00:00Z`).getTime();
  return Math.round((danas - dan) / (24 * 60 * 60 * 1000));
}
