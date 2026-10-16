import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";
import { registrujServiceWorker } from "./lib/push";
import { javljajNeuhvaceneGreske } from "./lib/greske";
import { ukljuciSlanjeIzlaza } from "./lib/izlaz";

registrujServiceWorker();
javljajNeuhvaceneGreske();
ukljuciSlanjeIzlaza();

// Poslije novog izdanja stara otvorena strana traži fajlove koji više ne postoje (paket po stranama,
// talas 6) — jednom se sama osvježi umjesto da pukne. Samo jednom u 30 s, da nema petlje.
window.addEventListener("vite:preloadError", (dogadjaj) => {
  try {
    const zadnje = Number(sessionStorage.getItem("pilot-osvjezeno-zbog-izdanja") ?? 0);
    if (Date.now() - zadnje < 30_000) return;
    sessionStorage.setItem("pilot-osvjezeno-zbog-izdanja", String(Date.now()));
  } catch {
    // bez sessionStorage — ipak osvježi jednom
  }
  dogadjaj.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);