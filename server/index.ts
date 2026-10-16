import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { greskaHandler } from "./greske.js";
import { zahtjevAppZaglavlje, requireAuth } from "./auth.js";
import { provjeriRute } from "./provjeraRuta.js";

import { authRuter, authJavniRuter } from "./routes/auth.js";
import { ljudiRuter } from "./routes/ljudi.js";
import { sifarniciRuter } from "./routes/sifarnici.js";
import { prijemRuter } from "./routes/prijem.js";
import { zalihaRuter } from "./routes/zaliha.js";
import { haccpRuter } from "./routes/haccp.js";
import { ncRuter } from "./routes/neusaglasenosti.js";
import { vozilaRuter } from "./routes/vozila.js";
import { isporukaRuter } from "./routes/isporuka.js";
import { zadaciRuter } from "./routes/zadaci.js";
import { porukeRuter } from "./routes/poruke.js";
import { sledljivostRuter } from "./routes/sledljivost.js";
import { izvozRuter } from "./routes/izvoz.js";
import { auditRuter } from "./routes/audit.js";
import { tablaRuter } from "./routes/tabla.js";
import { provjeraZnanjaRuter } from "./routes/provjeraZnanja.js";
import { firmaRuter } from "./routes/firma.js";
import { haccpPlanRuter } from "./routes/haccpPlan.js";
import { povlacenjeRuter } from "./routes/povlacenje.js";
import { bekapRuter } from "./routes/bekap.js";
import { pushRuter } from "./routes/push.js";
import { greskeRuter } from "./routes/greske.js";
import { vanMrezeRuter } from "./routes/vanMreze.js";
import { inspekcijaRuter } from "./routes/inspekcija.js";
import { stanjeRuter } from "./routes/stanje.js";
import { migracijeNaCekanju, primijeniMigracije } from "./migracije.js";
import { opisGreske, pokreniCiscenjeGresaka, zapisiGresku } from "./services/greskeLogService.js";
import { pokreniSlanjePush } from "./services/pushService.js";
import { pokreniProvjeruRokova } from "./services/rokoviService.js";
import { pokreniSedmicniBekap } from "./services/bekapService.js";
import { pripremiSesije } from "./auth.js";
import { pool, tabeleBezPristupa } from "./db.js";

const port = Number(process.env.PORT || 5000);
const isProduction = process.env.NODE_ENV === "production";
// Render sam postavlja RENDER_GIT_COMMIT — izdanje je commit koji STVARNO radi, pa se u
// /api/zdravlje (i u dnu menija) vidi je li deploy prošao. Lokalno: "lokalno".
const IZDANJE = process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? "lokalno";

const app = express();
app.disable("x-powered-by");
// Render stoji ispred servera kao jedan proksi: bez ovoga je request.ip adresa proksija za sve
// korisnike (ograničenje pokušaja prijave i IP u auditu — nalaz R-11).
app.set("trust proxy", 1);
app.use(express.json({ limit: "200kb" })); // MORA ostati i MORA biti prvo

// Politika sadržaja (nalaz R-27): skripte samo sa našeg servera — ubačena skripta (XSS) se ne izvršava.
// Stilovi i fontovi i sa Google Fonts (styles.css), slike i data:/blob: (otpremnica, ikonice), blob:
// za PDF otpremnice otvoren u novoj kartici. Samo u produkciji — razvoj (Vite) koristi inline skripte.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'self' blob:",
  "frame-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

app.use((_request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "same-origin");
  // Kamera samo za slikanje otpremnice; mikrofon i lokacija se ne koriste.
  response.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  if (isProduction) {
    response.setHeader("Content-Security-Policy", CSP);
    // Render je samo na HTTPS — pregledač ne pokušava više http (180 dana).
    response.setHeader("Strict-Transport-Security", "max-age=15552000");
  }
  if (!_request.path.startsWith("/api")) {
    next();
    return;
  }
  response.setHeader("Cache-Control", "no-store");
  next();
});

app.use("/api", zahtjevAppZaglavlje);

// ── JAVNO: jedino što radi bez prijave (nalaz A3, faza 4). Provjera znanja NIJE javna — radi je
// prijavljeni zaposleni svojom šifrom (invarijanta #32). ──
// Zdravlje provjerava i bazu (nalaz R-25): Render i dnevni pregled vide kad baza ne odgovara, ne samo
// kad server ne radi. Najviše 3 s čekanja. I da aplikacija vidi svoje tabele (RLS, dopuna 32) — inače
// bi radila „prazna“ bez ijedne greške.
// I da su sve dopune baze primijenjene (#79) — nov kod bez svoje dopune pada tek kad neko klikne.
app.get("/api/zdravlje", async (_request, response) => {
  const provjera = Promise.all([tabeleBezPristupa(), migracijeNaCekanju(pool)]).catch(() => null);
  const rezultat = await Promise.race([provjera, new Promise<null>((kraj) => setTimeout(() => kraj(null), 3000).unref())]);
  let baza = "ok";
  if (rezultat === null) baza = "ne odgovara";
  else if (rezultat[0].length) baza = `aplikacija ne vidi tabele (RLS): ${rezultat[0].join(", ")}`;
  else if (rezultat[1].length) baza = `dopune baze nisu primijenjene: ${rezultat[1].join(", ")} — npm run migriraj`;
  const ok = baza === "ok";
  response.status(ok ? 200 : 503).json({ ok, baza, izdanje: IZDANJE });
});
app.use("/api", authJavniRuter); // prijava, odjava

// ── GRANICA PRIJAVE: sve ispod traži sesiju. Ruteri NE kače requireAuth sami i nemaju svoj
// .use — uloge stoje na svakoj ruti, a provjeriRute() ispod to provjerava pri pokretanju. ──
app.use("/api", requireAuth);
app.use("/api", authRuter);
app.use("/api", provjeraZnanjaRuter);
app.use("/api", ljudiRuter);
app.use("/api", sifarniciRuter);
app.use("/api", prijemRuter);
app.use("/api", zalihaRuter);
app.use("/api", haccpRuter);
app.use("/api", ncRuter);
app.use("/api", vozilaRuter);
app.use("/api", isporukaRuter);
app.use("/api", zadaciRuter);
app.use("/api", porukeRuter);
app.use("/api", sledljivostRuter);
app.use("/api", izvozRuter);
app.use("/api", auditRuter);
app.use("/api", tablaRuter);
app.use("/api", firmaRuter);
app.use("/api", haccpPlanRuter);
app.use("/api", povlacenjeRuter);
app.use("/api", bekapRuter);
app.use("/api", pushRuter);
app.use("/api", greskeRuter);
app.use("/api", vanMrezeRuter);
app.use("/api", inspekcijaRuter);
app.use("/api", stanjeRuter);

app.use("/api", (_request: Request, response: Response, _next: NextFunction) => {
  response.status(404).json({ error: { code: "RUTA_NE_POSTOJI", message: "Traženi API resurs ne postoji." } });
});

app.use(greskaHandler);

// Ruta bez uloga, ruter sa svojim .use ili zaštićen ruter ispred granice: u razvoju server ne
// kreće (greška se vidi odmah), u produkciji se samo zapiše — klijent ne ostaje bez aplikacije.
const prekrsajiRuta = provjeriRute(app);
if (prekrsajiRuta.length) {
  const poruka = `Prava na rutama nisu podešena kako treba:\n  - ${prekrsajiRuta.join("\n  - ")}`;
  if (isProduction) console.error(poruka);
  else throw new Error(poruka);
}

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(rootDirectory, "..");

const start = async () => {
  let vite: ViteDevServer | undefined;
  // SAMO_API=1: server bez stranica — izolovani testovi (testovi/izolovano.mjs) zovu samo /api, a
  // Vite bi se sudario sa „npm run dev" koji možda radi u drugom prozoru.
  if (process.env.SAMO_API === "1") {
    // ništa — samo /api
  } else if (!isProduction) {
    vite = await createViteServer({
      configFile: path.resolve(projectRoot, "vite.config.ts"),
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(projectRoot, "dist");
    app.use(express.static(distPath, { index: false }));
    // Stranica aplikacije i za HEAD, ne samo GET: nadzor dostupnosti (UptimeRobot, besplatni plan) pita
    // metodom HEAD — bez ovoga je dobijao 404 i javljao „aplikacija pala“ dok je radila (27.09.2026).
    app.use((request, response, next) => {
      if ((request.method !== "GET" && request.method !== "HEAD") || request.path.startsWith("/api/")) {
        next();
        return;
      }
      response.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Dopune baze prije prvog zahtjeva (#79): u produkciji podrazumijevano, inače uz MIGRACIJE_PRI_STARTU=1.
  // Ako dopuna padne, server NE kreće — Render tada ostavlja prethodno izdanje da radi.
  if (process.env.MIGRACIJE_PRI_STARTU === "1" || (isProduction && process.env.MIGRACIJE_PRI_STARTU !== "0")) {
    try {
      const primijenjeno = await primijeniMigracije(pool);
      if (primijenjeno.length) console.log(`Dopune baze primijenjene pri pokretanju: ${primijenjeno.join(", ")}`);
    } catch (e) {
      console.error("Dopuna baze nije uspjela — server ne kreće:", e);
      process.exit(1);
    }
  }

  try {
    await pripremiSesije();
  } catch (e) {
    // Server se ipak diže (da /api/zdravlje javi stanje), ali prijava neće raditi dok baza ne odgovori.
    console.error("Tabela sesija nije spremna — prijava neće raditi:", e);
  }

  const server = app.listen(port, "0.0.0.0", () => {
    console.log(`PILOT DISTRIBUTERI CG sluša na 0.0.0.0:${port} (${isProduction ? "produkcija" : "razvoj"}, izdanje ${IZDANJE})`);
  });
  pokreniSedmicniBekap();
  pokreniSlanjePush().catch((e) => console.error("Push obavještenja nisu pokrenuta:", e));
  pokreniProvjeruRokova();
  pokreniCiscenjeGresaka();

  const shutdown = async () => {
    await vite?.close();
    server.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
};

// Greške koje niko nije uhvatio idu i u dnevnik (#80). Odbačeno obećanje se zapiše i server radi dalje;
// neuhvaćena greška ostavlja proces u nepoznatom stanju — zapiše se pa proces izlazi (Render ga podiže).
process.on("unhandledRejection", (razlog) => {
  console.error("Neuhvaćeno odbijeno obećanje:", razlog);
  void zapisiGresku({ izvor: "proces", kod: "UNHANDLED_REJECTION", ...opisGreske(razlog) });
});
process.on("uncaughtException", (greska) => {
  console.error("Neuhvaćena greška:", greska);
  const izlaz = setTimeout(() => process.exit(1), 2000);
  zapisiGresku({ izvor: "proces", kod: "UNCAUGHT_EXCEPTION", ...opisGreske(greska) }).finally(() => {
    clearTimeout(izlaz);
    process.exit(1);
  });
});

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
