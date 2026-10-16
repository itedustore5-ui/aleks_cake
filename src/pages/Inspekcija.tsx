import { useEffect, useState, type ReactNode } from "react";
import { Printer, Download, FolderCheck, AlertCircle } from "lucide-react";
import { api, preuzmiFajl, ApiGreska } from "../lib/api";
import { lokalniDatum } from "../lib/vrijeme";
import { PageHeader, NaknadnoOznaka, VanMrezeOznaka } from "../components/Zajednicko";
import { FilterVremena, type Period } from "../components/FilterVremena";
import { NAZIVI } from "../components/StatusBadge";

// Inspekcijski paket: sve evidencije za period na jednom mjestu, za štampu / PDF i kao podaci (ZIP).
// Prvo kontinuitet (dokaz da zapisi nastaju svaki dan), pa same evidencije. Server: inspekcijaService.

type Red = Record<string, unknown>;
type Paket = {
  firma: { naziv: string; adresa: string | null; grad: string | null; pib: string | null; odgovorno_lice_ime: string | null } | null;
  period: { od: string; do: string; dana: number };
  izradjeno: { vrijeme: string; izradio: string | null };
  sazetak: {
    grupe: { naziv: string; ukupno: number; naknadno: number }[];
    ukupno: number;
    naknadno: number;
    istogDana: number | null;
    osoba: number;
    daniSaZapisom: number;
    radniDani: number;
    vanMreze: number;
    izmjenaPodataka: number;
    isporuka: number;
    neusaglasenosti: number;
    neusaglasenostiOtvorene: number;
    povlacenja: number;
    mjerenjaVanGranice: number;
    planPropusteno: number;
    planPerioda: number;
  };
  kalendar: { dan: string; dan_u_sedmici: number; mjerenja: number; zapisi: number; d1: number; prijemi: number; isporuke: number }[];
  plan: { do: string; stavke: { naziv: string; ucestalost: string; puta: number; magacin: string | null; periodaUkupno: number; uradjeno: number; propusteno: { od: string; do: string; uradjeno: number }[] }[] };
  prijemi: Red[];
  mjerenja: Red[];
  zapisi: Red[];
  kontroleVozila: Red[];
  isporuke: Red[];
  neusaglasenosti: Red[];
  povlacenja: Red[];
  termometri: { provjere: Red[]; stanje: Red[] };
  verifikacija: { uPeriodu: Red[]; stanje: { vrsta: string; naziv: string; posljednja: string | null; zakljucak: string | null; sljedecaDo: string | null; stanje: string }[] };
  knjizice: Red[];
  obuka: { plan: Red[]; provjere: Red[] };
};

const ODJELJCI = [
  { kod: "kontinuitet", naziv: "Kontinuitet zapisa" },
  { kod: "plan", naziv: "Plan monitoringa — izvršenje" },
  { kod: "prijemi", naziv: "Prijem robe (KKT 1)" },
  { kod: "mjerenja", naziv: "Temperaturna mjerenja (KKT 2, KKT 3)" },
  { kod: "zapisi", naziv: "Dnevni obrasci dobre higijenske prakse" },
  { kod: "d1", naziv: "Kontrola vozila prije utovara (D1)" },
  { kod: "isporuke", naziv: "Isporuke kupcima" },
  { kod: "nc", naziv: "Neusaglašenosti i korektivne mjere" },
  { kod: "povlacenja", naziv: "Povlačenja" },
  { kod: "termometri", naziv: "Termometri — provjere i kalibracije" },
  { kod: "verifikacija", naziv: "Verifikacija HACCP sistema" },
  { kod: "ljudi", naziv: "Zaposleni — sanitarne knjižice i obuka" },
] as const;
type Odjeljak = (typeof ODJELJCI)[number]["kod"];

const UCESTALOST: Record<string, string> = { DNEVNO: "svaki dan", RADNIM_DANIMA: "radnim danima", SEDMICNO: "sedmično", MJESECNO: "mjesečno" };
const STANJE: Record<string, string> = {
  VAZI: "važi", USKORO: "uskoro ističe", ISTEKLA: "istekla", NEISPRAVAN: "neispravan", KASNI: "kasni", NIJE_RADJENO: "nije rađeno",
  URADJENO: "urađeno", PLANIRANO: "planirano",
  VAZILA: "važila cio period", ISTEKLA_U_PERIODU: "istekla u periodu", ISTEKLA_PRIJE: "istekla prije perioda", NIJE_UPISAN: "rok nije upisan",
};
const LOSE = new Set(["ISTEKLA", "NEISPRAVAN", "KASNI", "NIJE_RADJENO", "ISTEKLA_U_PERIODU", "ISTEKLA_PRIJE", "NIJE_UPISAN"]);

const dat = (s: unknown) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(0, 10).split("-").reverse().join(".")}.${s.length > 10 ? s.slice(10) : ""}` : "—");
const kratakDan = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}.`;
const broj = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : Number(v).toLocaleString("sr-Latn-ME", { maximumFractionDigits: 3 }));
const temp = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : `${broj(v)} °C`);
const granica = (min: unknown, max: unknown) => {
  const a = min === null || min === undefined ? null : broj(min);
  const b = max === null || max === undefined ? null : broj(max);
  return a && b ? `${a} do ${b} °C` : b ? `do ${b} °C` : a ? `od ${a} °C` : "—";
};
const status = (v: unknown) => (typeof v === "string" ? NAZIVI[v] ?? v.toLowerCase().replace(/_/g, " ") : "—");
const tekst = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
const daNe = (v: unknown) => (v === true ? "da" : v === false ? "ne" : "—");
const DANI = ["", "pon", "uto", "sri", "čet", "pet", "sub", "ned"];

function zadnjih30(): Period {
  const d = new Date(`${lokalniDatum()}T12:00:00`);
  d.setDate(d.getDate() - 29);
  return { od: d.toLocaleDateString("sv-SE"), do: lokalniDatum() };
}

export function Inspekcija() {
  const [period, setPeriod] = useState<Period>(zadnjih30);
  const [paket, setPaket] = useState<Paket | null>(null);
  const [ucitavam, setUcitavam] = useState(false);
  const [greska, setGreska] = useState("");
  const [preuzimam, setPreuzimam] = useState(false);
  const [ukljuceno, setUkljuceno] = useState<Set<Odjeljak>>(() => new Set(ODJELJCI.map((o) => o.kod)));

  const upit = (p: Period) => {
    const q = new URLSearchParams();
    if (p.od) q.set("od", p.od);
    if (p.do) q.set("do", p.do);
    const s = q.toString();
    return s ? `?${s}` : "";
  };

  useEffect(() => {
    let vazi = true;
    setUcitavam(true);
    setGreska("");
    api<Paket>(`/inspekcija${upit(period)}`)
      .then((p) => vazi && setPaket(p))
      .catch((e) => vazi && setGreska(e instanceof ApiGreska ? e.message : "Paket nije učitan."))
      .finally(() => vazi && setUcitavam(false));
    return () => {
      vazi = false;
    };
  }, [period.od, period.do]);

  const preuzmiZip = async () => {
    if (!paket) return;
    setGreska("");
    setPreuzimam(true);
    try {
      await preuzmiFajl(`/inspekcija/paket.zip${upit({ od: paket.period.od, do: paket.period.do })}`, `inspekcijski-paket-${paket.period.od}_${paket.period.do}.zip`);
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Preuzimanje nije uspjelo.");
    } finally {
      setPreuzimam(false);
    }
  };

  const ima = (k: Odjeljak) => ukljuceno.has(k);
  const prebaci = (k: Odjeljak) =>
    setUkljuceno((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const redni = ODJELJCI.filter((o) => ima(o.kod)).map((o) => o.kod);
  const rb = (k: Odjeljak) => redni.indexOf(k) + 1;

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="Za inspekciju"
          description="Sve evidencije za izabrani period na jednom mjestu: prvo dokaz da zapisi nastaju svaki dan, pa prijem, temperature, obrasci, vozila, isporuke, neusaglašenosti i zaposleni."
        />
        <FilterVremena period={period} onChange={setPeriod} oznaka="Period paketa (najviše godinu dana)" />
        <div className="insp-akcije">
          <button className="primary-button" onClick={() => window.print()} disabled={!paket || ucitavam}>
            <Printer size={15} /> Štampaj / sačuvaj PDF
          </button>
          <button className="secondary-button" onClick={preuzmiZip} disabled={!paket || preuzimam}>
            <Download size={15} /> {preuzimam ? "Pravim ZIP…" : "Podaci za inspektora (ZIP)"}
          </button>
          <span className="muted-text">
            {ucitavam ? "Učitavanje…" : "Za PDF: u prozoru za štampu izaberite „Sačuvaj kao PDF“. ZIP nosi iste podatke kao tabele (CSV za Excel)."}
          </span>
        </div>
        <details className="insp-odjeljci">
          <summary>Šta ulazi u paket ({ukljuceno.size} od {ODJELJCI.length})</summary>
          <div>
            {ODJELJCI.map((o) => (
              <label key={o.kod}>
                <input type="checkbox" checked={ima(o.kod)} onChange={() => prebaci(o.kod)} /> {o.naziv}
              </label>
            ))}
          </div>
        </details>
        {greska && (
          <div className="auth-error" role="alert" style={{ marginBottom: 14 }}>
            <AlertCircle size={14} /> {greska}
          </div>
        )}
        {paket && (paket.sazetak.planPropusteno > 0 || paket.sazetak.neusaglasenostiOtvorene > 0 || paket.knjizice.some((k) => LOSE.has(String(k.stanje)))) && (
          <div className="upozorenje-traka" style={{ marginBottom: 14 }}>
            Pregledajte paket prije inspekcije — crveno označeno vidi i inspektor:{" "}
            {[
              paket.sazetak.planPropusteno > 0 && `propušteno po planu ${paket.sazetak.planPropusteno}`,
              paket.sazetak.neusaglasenostiOtvorene > 0 && `otvorenih neusaglašenosti ${paket.sazetak.neusaglasenostiOtvorene}`,
              paket.knjizice.some((k) => LOSE.has(String(k.stanje))) && "sanitarne knjižice",
            ]
              .filter(Boolean)
              .join(" · ")}
            .
          </div>
        )}
      </div>

      {paket && (
        <div className="panel insp-dokument">
          <Naslovna paket={paket} sadrzaj={ODJELJCI.filter((o) => ima(o.kod))} />

          {ima("kontinuitet") && <Kontinuitet rb={rb("kontinuitet")} paket={paket} />}

          {ima("plan") && (
            <Odjeljak rb={rb("plan")} naslov="Plan monitoringa — izvršenje" opis={`Završeni periodi zaključno sa ${dat(paket.plan.do)}; tekući dan, sedmica i mjesec se ne ocjenjuju dok ne prođu.`}>
              <Tabela
                kolone={["Šta se radi", "Koliko često", "Magacin", "Urađeno", "Propušteno"]}
                redovi={paket.plan.stavke.map((s) => [
                  s.naziv,
                  `${UCESTALOST[s.ucestalost] ?? s.ucestalost}${s.puta > 1 ? `, ${s.puta}×` : ""}`,
                  s.magacin ?? "svi",
                  s.periodaUkupno ? `${s.uradjeno} od ${s.periodaUkupno}` : "—",
                  s.propusteno.length ? (
                    <span className="insp-lose">
                      {s.propusteno.map((x) => (x.od === x.do ? kratakDan(x.od) : `${kratakDan(x.od)}–${kratakDan(x.do)}`)).join(", ")}
                    </span>
                  ) : s.periodaUkupno ? (
                    "ništa"
                  ) : (
                    "—"
                  ),
                ])}
                prazno="Plan monitoringa nije podešen (HACCP plan → Plan monitoringa)."
              />
            </Odjeljak>
          )}

          {ima("prijemi") && (
            <Odjeljak rb={rb("prijemi")} naslov="Prijem robe — KKT 1" opis="Svaka stavka sa lotom i rokom (sledljivost, čl. 27); temperatura je izmjerena pri prijemu, ocijenjena po granici artikla.">
              <Tabela
                kolone={["Datum", "Dobavljač · dokument", "Artikal", "Lot · rok", "Primljeno", "Temperatura", "Odluka", "Primio"]}
                redovi={paket.prijemi.map((r) => [
                  <>{dat(r.datum)}<NaknadnoOznaka dana={Number(r.naknadno_dana)} /></>,
                  `${tekst(r.dobavljac)}${r.broj_dokumenta ? ` · ${r.broj_dokumenta}` : ""}`,
                  tekst(r.artikal),
                  `${tekst(r.broj_lota)} · ${dat(r.rok)}`,
                  `${broj(r.primljena_kolicina)} ${tekst(r.jedinica_mjere)}`,
                  r.temp_kontrolisano ? (
                    <span className={r.temp_rezultat === "FAIL" ? "insp-lose" : undefined}>
                      {temp(r.temperatura)} ({granica(r.temp_min, r.temp_max)}) · {status(r.temp_rezultat)}
                      {r.termometar ? ` · ${r.termometar}` : ""}
                    </span>
                  ) : (
                    "bez režima"
                  ),
                  `${status(r.lot_status)}${Number(r.odbijena_kolicina) > 0 ? ` · odbijeno ${broj(r.odbijena_kolicina)}` : ""}`,
                  tekst(r.primio),
                ])}
                prazno="U periodu nema prijema."
              />
            </Odjeljak>
          )}

          {ima("mjerenja") && (
            <Odjeljak rb={rb("mjerenja")} naslov="Temperaturna mjerenja" opis="Magacin i komore (KKT 2), predaja kupcu (KKT 3) i ostale tačke. Mjerenja pri prijemu su uz prijem.">
              <Tabela
                kolone={["Vrijeme", "Tačka", "Gdje / šta", "Izmjereno", "Granica", "Ocjena", "Termometar", "Izmjerio"]}
                redovi={paket.mjerenja.map((r) => [
                  <>{dat(r.vrijeme)}<NaknadnoOznaka dana={Number(r.naknadno_dana)} /><VanMrezeOznaka da={r.van_mreze === true} /></>,
                  `${tekst(r.sifra)} · ${tekst(r.tacka)}`,
                  [r.magacin, r.vozilo, r.broj_lota ? `lot ${r.broj_lota}` : null, r.artikal, r.napomena].filter(Boolean).join(" · ") || "—",
                  temp(r.vrijednost),
                  granica(r.granica_min, r.granica_max),
                  <span className={r.rezultat === "FAIL" ? "insp-lose" : undefined}>{status(r.rezultat)}</span>,
                  tekst(r.termometar),
                  tekst(r.izmjerio),
                ])}
                prazno="U periodu nema mjerenja."
              />
            </Odjeljak>
          )}

          {ima("zapisi") && (
            <Odjeljak rb={rb("zapisi")} naslov="Dnevni obrasci dobre higijenske prakse" opis="Ispravka je nov zapis — prethodna verzija ostaje i vidi se („zamijenjen ispravkom“). Obrasci su radni obrasci firme, ne zvanični.">
              <Tabela
                kolone={["Datum", "Obrazac", "Odgovori", "Odstupanje i mjera", "Izvršilac", "Upisano", "Verzija"]}
                redovi={paket.zapisi.map((r) => [
                  dat(r.datum),
                  `${tekst(r.obrazac_kod)} · ${tekst(r.obrazac)}${r.magacin ? ` · ${r.magacin}` : ""}`,
                  tekst(r.odgovori),
                  r.odstupanje ? <span className="insp-lose">da — {tekst(r.korektivna_mjera)}</span> : "ne",
                  tekst(r.izvrsilac),
                  <>{dat(r.upisano)}<NaknadnoOznaka dana={Number(r.naknadno_dana)} /><VanMrezeOznaka da={r.van_mreze === true} /></>,
                  tekst(r.verzija),
                ])}
                prazno="U periodu nema dnevnih zapisa."
              />
            </Odjeljak>
          )}

          {ima("d1") && (
            <Odjeljak rb={rb("d1")} naslov="Kontrola vozila prije utovara (D1)" opis="Uredba o higijeni hrane, Dio 4 — vozila čista i održavana, temperatura koja se može pratiti. Radni obrazac firme.">
              <Tabela
                kolone={["Vrijeme", "Vozilo", "Čistoća", "Oprema", "Vrata", "Temperatura", "Rezultat", "Izvršio"]}
                redovi={paket.kontroleVozila.map((r) => [
                  <>{dat(r.vrijeme)}<NaknadnoOznaka dana={Number(r.naknadno_dana)} /><VanMrezeOznaka da={r.van_mreze === true} /></>,
                  tekst(r.vozilo),
                  daNe(r.cistoca),
                  daNe(r.oprema_ok),
                  daNe(r.vrata_ok),
                  r.temperatura === null ? "—" : `${temp(r.temperatura)} (${granica(r.granica_min, r.granica_max)})`,
                  <span className={r.ukupan_status !== "PROSAO" ? "insp-lose" : undefined}>{status(r.ukupan_status)}{r.napomena ? ` · ${r.napomena}` : ""}</span>,
                  tekst(r.izvrsio),
                ])}
                prazno="U periodu nema kontrola vozila."
              />
            </Odjeljak>
          )}

          {ima("isporuke") && (
            <Odjeljak rb={rb("isporuke")} naslov="Isporuke kupcima — KKT 3" opis="Koji lot je otišao kom kupcu (sledljivost naprijed, čl. 27) i temperatura pri predaji.">
              <Tabela
                kolone={["Datum", "Broj", "Kupac", "Vozilo · vozač", "Lotovi", "Planirano / predato / odbijeno", "Temp. pri predaji", "Status"]}
                redovi={paket.isporuke.map((r) => [
                  dat(r.datum),
                  tekst(r.broj),
                  tekst(r.kupac),
                  [r.vozilo, r.vozac].filter(Boolean).join(" · ") || "—",
                  tekst(r.lotovi),
                  `${broj(r.planirano)} / ${broj(r.predato)} / ${broj(r.odbijeno)}`,
                  r.temp_min === null ? "—" : r.temp_min === r.temp_max ? temp(r.temp_min) : `${broj(r.temp_min)} – ${temp(r.temp_max)}`,
                  <>
                    {status(r.status)}
                    {r.predato_at ? ` · ${dat(r.predato_at)}` : ""}
                    {r.razlog_otkaza ? ` · ${r.razlog_otkaza}` : ""}
                    <VanMrezeOznaka da={r.potvrda_van_mreze === true} />
                  </>,
                ])}
                prazno="U periodu nema isporuka."
              />
            </Odjeljak>
          )}

          {ima("nc") && (
            <Odjeljak rb={rb("nc")} naslov="Neusaglašenosti i korektivne mjere" opis="Sve koje su bile otvorene u periodu: šta je urađeno, ko je uradio i ko je provjerio (četiri oka).">
              <Tabela
                kolone={["Broj · datum", "Odakle", "Opis", "Korektivna mjera — urađeno", "Provjera", "Status"]}
                redovi={paket.neusaglasenosti.map((r) => [
                  `${tekst(r.broj)} · ${dat(r.datum)}`,
                  tekst(r.izvor),
                  `${tekst(r.opis)} (${status(r.ozbiljnost).toLowerCase()})`,
                  r.uradjeno ? `${r.uradjeno} — ${tekst(r.uradio)}, ${dat(r.zavrseno)}` : r.mjera ? `u toku: ${r.mjera}` : "—",
                  r.provjera ? (
                    <>
                      {r.provjera === "POTVRDJENO" ? "potvrđeno" : "vraćeno"} — {tekst(r.provjerio)}, {dat(r.provjereno)}
                      {r.izuzetak_cetiri_oka ? " · bez četiri oka" : ""}
                    </>
                  ) : (
                    "—"
                  ),
                  <span className={r.status !== "ZATVORENA" ? "insp-lose" : undefined}>
                    {status(r.status)}
                    {r.zatvoreno ? ` ${dat(r.zatvoreno)}` : ""}
                  </span>,
                ])}
                prazno="U periodu nije bilo neusaglašenosti."
              />
            </Odjeljak>
          )}

          {ima("povlacenja") && (
            <Odjeljak rb={rb("povlacenja")} naslov="Povlačenja" opis="Povlačenje nebezbjedne hrane i obavještavanje kupaca (čl. 28).">
              <Tabela
                kolone={["Broj", "Pokrenuto", "Artikal · lot", "Razlog", "Kupci obaviješteni", "Status"]}
                redovi={paket.povlacenja.map((r) => [
                  tekst(r.broj),
                  dat(r.pokrenuto),
                  `${tekst(r.artikal)} · ${tekst(r.broj_lota)}`,
                  tekst(r.razlog),
                  `${broj(r.obavijesteno)} od ${broj(r.kupaca)}`,
                  r.status === "ZAVRSENO" ? `završeno ${dat(r.zavrseno)}` : <span className="insp-lose">u toku</span>,
                ])}
                prazno="U periodu nije bilo povlačenja."
              />
            </Odjeljak>
          )}

          {ima("termometri") && (
            <Odjeljak rb={rb("termometri")} naslov="Termometri — provjere i kalibracije" opis="Stanje na dan izrade paketa, pa provjere urađene u periodu.">
              <Tabela
                kolone={["Termometar", "Posljednja provjera", "Sljedeća do", "Kalibracija važi do", "Stanje"]}
                redovi={paket.termometri.stanje.map((u) => [
                  `${tekst(u.naziv)}${u.oznaka ? ` (${u.oznaka})` : ""}`,
                  dat(u.posljednja_provjera),
                  dat(u.provjera_do),
                  u.interval_kalibracije_mjeseci ? dat(u.kalibracija_do) : "—",
                  <span className={LOSE.has(String(u.stanje)) ? "insp-lose" : undefined}>{STANJE[String(u.stanje)] ?? tekst(u.stanje)}</span>,
                ])}
                prazno="Nema aktivnih termometara."
              />
              <Tabela
                kolone={["Datum", "Termometar", "Vrsta", "Referentna / izmjereno", "Sertifikat", "Rezultat", "Izvršio"]}
                redovi={paket.termometri.provjere.map((r) => [
                  dat(r.datum),
                  `${tekst(r.uredjaj)}${r.oznaka ? ` (${r.oznaka})` : ""}`,
                  r.vrsta === "KALIBRACIJA" ? "kalibracija" : "interna provjera",
                  r.referentna === null ? "—" : `${temp(r.referentna)} / ${temp(r.izmjereno)}`,
                  tekst(r.broj_sertifikata),
                  <span className={r.rezultat !== "ISPRAVAN" ? "insp-lose" : undefined}>{r.rezultat === "ISPRAVAN" ? "ispravan" : "neispravan"}</span>,
                  tekst(r.izvrsilac),
                ])}
                prazno="U periodu nije bilo provjera termometara."
              />
            </Odjeljak>
          )}

          {ima("verifikacija") && (
            <Odjeljak rb={rb("verifikacija")} naslov="Verifikacija HACCP sistema" opis="Godišnja revizija plana, interni audit i vježba povlačenja (čl. 36 — kontinuirano održavanje postupaka).">
              <Tabela
                kolone={["Šta", "Posljednja", "Zaključak", "Sljedeća do", "Stanje"]}
                redovi={paket.verifikacija.stanje.map((v) => [
                  v.naziv,
                  dat(v.posljednja),
                  v.zakljucak === "USAGLASENO" ? "usaglašeno" : v.zakljucak === "POTREBNE_IZMJENE" ? "potrebne izmjene" : "—",
                  dat(v.sljedecaDo),
                  <span className={LOSE.has(v.stanje) ? "insp-lose" : undefined}>{STANJE[v.stanje] ?? v.stanje}</span>,
                ])}
              />
              {paket.verifikacija.uPeriodu.length > 0 && (
                <Tabela
                  kolone={["Datum", "Šta", "Izvršilac", "Nalaz", "Zaključak"]}
                  redovi={paket.verifikacija.uPeriodu.map((v) => [
                    dat(v.datum),
                    tekst(v.naziv),
                    tekst(v.izvrsilac),
                    tekst(v.nalaz),
                    v.zakljucak === "USAGLASENO" ? "usaglašeno" : "potrebne izmjene",
                  ])}
                />
              )}
            </Odjeljak>
          )}

          {ima("ljudi") && (
            <Odjeljak
              rb={rb("ljudi")}
              naslov="Zaposleni — sanitarne knjižice i obuka"
              opis="Knjižice za sve koji rukuju hranom (Zakon o zaštiti stanovništva od zaraznih bolesti, čl. 31) — broj i rok, ne nalaz. Obuka i nadzor zaposlenih: Uredba o higijeni hrane, Dio 13."
            >
              <Tabela
                kolone={["Zaposleni", "Radno mjesto", "Broj knjižice", "Važi do", "U periodu"]}
                redovi={paket.knjizice.map((k) => [
                  tekst(k.ime),
                  tekst(k.radno_mjesto),
                  tekst(k.sanitarna_knjizica_broj),
                  dat(k.knjizica_rok),
                  <span className={LOSE.has(String(k.stanje)) ? "insp-lose" : undefined}>{STANJE[String(k.stanje)] ?? tekst(k.stanje)}</span>,
                ])}
                prazno="Nema upisanih zaposlenih koji rukuju hranom."
              />
              <Tabela
                kolone={["Zaposleni", "Tema obuke", "Planirano", "Obavljeno", "Stanje"]}
                redovi={paket.obuka.plan.map((o) => [
                  tekst(o.lice_ime),
                  tekst(o.tema),
                  dat(o.planirano),
                  dat(o.obavljeno),
                  <span className={o.stanje === "KASNI" ? "insp-lose" : undefined}>{STANJE[String(o.stanje)] ?? tekst(o.stanje)}</span>,
                ])}
                prazno="U periodu nema planirane ni obavljene obuke."
              />
              {paket.obuka.provjere.length > 0 && (
                <Tabela
                  kolone={["Provjera znanja (termin)", "Održano", "Učesnika", "Prosječno tačnih"]}
                  redovi={paket.obuka.provjere.map((p) => [
                    tekst(p.naziv),
                    p.od === p.do ? dat(p.od) : `${dat(p.od)} – ${dat(p.do)}`,
                    broj(p.ucesnika),
                    p.prosjek === null ? "—" : `${p.prosjek} %`,
                  ])}
                />
              )}
            </Odjeljak>
          )}

          <div className="insp-potpisi">
            <div>Pripremio/la: ______________________</div>
            <div>Odgovorno lice: ______________________</div>
            <div>Datum: ______________</div>
          </div>
        </div>
      )}
    </>
  );
}

function Naslovna({ paket, sadrzaj }: { paket: Paket; sadrzaj: readonly { kod: string; naziv: string }[] }) {
  const f = paket.firma;
  const izradjeno = new Date(paket.izradjeno.vrijeme).toLocaleString("sr-Latn-ME", { timeZone: "Europe/Podgorica", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <section className="insp-naslovna">
      <FolderCheck size={24} />
      <h1>{f?.naziv ?? "Firma"}</h1>
      <p className="muted-text">
        {f?.adresa}
        {f?.adresa && f?.grad ? ", " : ""}
        {f?.grad}
        {f?.pib ? ` · PIB ${f.pib}` : ""}
      </p>
      <h2>Inspekcijski paket</h2>
      <p className="insp-podnaslov">Evidencije o primjeni postupaka zasnovanih na HACCP principima i dobre higijenske prakse</p>
      <dl>
        <dt>Period</dt>
        <dd>
          {dat(paket.period.od)} – {dat(paket.period.do)} ({paket.period.dana} {paket.period.dana === 1 ? "dan" : "dana"})
        </dd>
        <dt>Odgovorno lice</dt>
        <dd>{f?.odgovorno_lice_ime ?? "—"}</dd>
        <dt>Izrađeno</dt>
        <dd>
          {izradjeno}
          {paket.izradjeno.izradio ? ` · ${paket.izradjeno.izradio}` : ""}
        </dd>
      </dl>
      <p className="insp-osnov">
        Zakon o bezbjednosti hrane („Sl. list CG“, br. 59/2026) — čl. 27 (sledljivost), čl. 28 (povlačenje), čl. 36 (HACCP); Uredba o higijeni hrane
        („Sl. list CG“, br. 91/2026) — čl. 7 st. 5 (dokazi i evidencije). Zapisi su vođeni u aplikaciji u trenutku rada; svaki naknadan upis nosi oznaku
        „naknadno +N“, a upis sa telefona bez interneta oznaku „bez mreže“. Obrasci dnevnih zapisa i kontrole vozila (D1) su radni obrasci firme, ne
        zvanični obrasci.
      </p>
      <h3>Sadržaj</h3>
      <ol className="insp-sadrzaj">
        {sadrzaj.map((o) => (
          <li key={o.kod}>{o.naziv}</li>
        ))}
      </ol>
    </section>
  );
}

function Kontinuitet({ rb, paket }: { rb: number; paket: Paket }) {
  const s = paket.sazetak;
  // Do dva mjeseca — po danu; duže — po sedmici (godina po danu je 365 redova koje niko ne čita).
  const poDanu = paket.kalendar.length <= 62;
  const redovi = poDanu
    ? paket.kalendar.map((d) => ({ oznaka: `${DANI[d.dan_u_sedmici]} ${dat(d.dan)}`, ...d, bez: d.dan_u_sedmici !== 7 && d.mjerenja + d.zapisi + d.d1 + d.prijemi === 0 ? 1 : 0 }))
    : sedmice(paket.kalendar);
  return (
    <Odjeljak rb={rb} naslov="Kontinuitet zapisa" opis="Dokaz da zapisi nastaju svakog dana, u trenutku rada — a ne naknadno, pred inspekciju.">
      <div className="insp-brojke">
        <Brojka vrijednost={s.ukupno} oznaka="zapisa u periodu" />
        <Brojka vrijednost={s.istogDana === null ? "—" : `${s.istogDana} %`} oznaka={`upisano istog dana (naknadno: ${s.naknadno})`} />
        <Brojka vrijednost={`${s.daniSaZapisom} / ${s.radniDani}`} oznaka="dana sa zapisima / radnih dana" />
        <Brojka vrijednost={s.osoba} oznaka={s.osoba === 1 ? "osoba upisuje" : "osoba upisuje (svako svoje)"} />
        <Brojka vrijednost={s.planPerioda ? `${s.planPerioda - s.planPropusteno} / ${s.planPerioda}` : "—"} oznaka="obaveza po planu urađeno" losa={s.planPropusteno > 0} />
        <Brojka vrijednost={s.mjerenjaVanGranice} oznaka="mjerenja van granice" />
      </div>
      <Tabela
        kolone={["Vrsta zapisa", "Ukupno", "Od toga upisano naknadno"]}
        redovi={[
          ...s.grupe.map((g) => [g.naziv, broj(g.ukupno), g.naknadno ? <span className="insp-lose">{g.naknadno}</span> : "0"]),
          ["Isporuke (bez otkazanih)", broj(s.isporuka), "—"],
          ["Neusaglašenosti otvorene u periodu", broj(s.neusaglasenosti), s.neusaglasenostiOtvorene ? `još otvoreno: ${s.neusaglasenostiOtvorene}` : "sve zatvorene"],
          ["Izmjene podataka (dnevnik izmjena)", broj(s.izmjenaPodataka), "svaka sa vrijednošću prije i poslije"],
          ...(s.vanMreze ? [["Upisano na telefonu bez interneta", broj(s.vanMreze), "vrijeme je vrijeme rada, ne prijema na server"]] : []),
        ]}
      />
      <Tabela
        kolone={[poDanu ? "Dan" : "Sedmica", "Mjerenja", "Obrasci", "D1", "Prijemi", "Isporuke", ""]}
        redovi={redovi.map((d) => [
          d.oznaka,
          broj(d.mjerenja),
          broj(d.zapisi),
          broj(d.d1),
          broj(d.prijemi),
          broj(d.isporuke),
          d.bez ? <span className="insp-lose">{poDanu ? "nema zapisa" : `${d.bez} ${d.bez === 1 ? "radni dan" : "radnih dana"} bez zapisa`}</span> : "",
        ])}
        uska
      />
    </Odjeljak>
  );
}

function sedmice(kalendar: Paket["kalendar"]) {
  const r: { oznaka: string; mjerenja: number; zapisi: number; d1: number; prijemi: number; isporuke: number; bez: number }[] = [];
  for (const d of kalendar) {
    if (!r.length || d.dan_u_sedmici === 1) r.push({ oznaka: `od ${dat(d.dan)}`, mjerenja: 0, zapisi: 0, d1: 0, prijemi: 0, isporuke: 0, bez: 0 });
    const s = r[r.length - 1];
    s.mjerenja += d.mjerenja;
    s.zapisi += d.zapisi;
    s.d1 += d.d1;
    s.prijemi += d.prijemi;
    s.isporuke += d.isporuke;
    if (d.dan_u_sedmici !== 7 && d.mjerenja + d.zapisi + d.d1 + d.prijemi === 0) s.bez += 1;
  }
  return r;
}

function Brojka({ vrijednost, oznaka, losa }: { vrijednost: ReactNode; oznaka: string; losa?: boolean }) {
  return (
    <div className={`insp-brojka${losa ? " losa" : ""}`}>
      <strong>{vrijednost}</strong>
      <span>{oznaka}</span>
    </div>
  );
}

function Odjeljak({ rb, naslov, opis, children }: { rb: number; naslov: string; opis?: string; children: ReactNode }) {
  return (
    <section className="insp-odjeljak">
      <h2>
        {rb}. {naslov}
      </h2>
      {opis && <p className="insp-opis">{opis}</p>}
      {children}
    </section>
  );
}

function Tabela({ kolone, redovi, prazno, uska }: { kolone: string[]; redovi: ReactNode[][]; prazno?: string; uska?: boolean }) {
  return (
    <div className="data-table-wrap insp-tabela">
      <table className={`data-table${uska ? " uska" : ""}`}>
        <thead>
          <tr>{kolone.map((k, i) => <th key={i}>{k}</th>)}</tr>
        </thead>
        <tbody>
          {redovi.length === 0 && (
            <tr>
              <td colSpan={kolone.length} className="muted-text">{prazno ?? "Nema podataka."}</td>
            </tr>
          )}
          {redovi.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
