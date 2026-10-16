/** Današnji datum po podgoričkom vremenu — toISOString() se za datum ne koristi nigdje
 * (UTC bi blizu ponoći dao pogrešan dan). */
export function lokalniDatum(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Podgorica" });
}
