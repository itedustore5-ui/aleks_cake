import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { spisakZaRadBezMreze } from "./vite.offline.ts";

export default defineConfig({
  plugins: [react(), spisakZaRadBezMreze()],
  // .env je SERVEROV (baza, tajne, NODE_ENV=development za lokalni rad) — pregledaču ne treba ništa iz
  // njega. Vite ga inače čita i pri `vite build`, pa je NODE_ENV=development iz .env pravio razvojnu
  // gradnju: paket 970 KB umjesto ~270 KB (talas 6). Samo `define` za NODE_ENV to nije popravljao —
  // JSX je ostajao razvojni (jsxDEV) uz produkcijski React i strana je pucala (našao test ekrana).
  envFile: false,
  server: {
    host: "0.0.0.0",
    port: 5000,
    allowedHosts: true,
  },
});
