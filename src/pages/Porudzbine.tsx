import { useEffect, useMemo, useState } from "react";
import { Plus, Phone, Truck, Store, AlertTriangle, Copy, X } from "lucide-react";
import { api, ApiGreska } from "../lib/api";
import { useSlanje, noviKljuc } from "../lib/slanje";
import { upisiIliSacuvaj, useIzlaz, IZLAZ_POSLAT } from "../lib/izlaz";
import { lokalniDatum } from "../lib/vrijeme";
import { useAlergeni } from "../lib/alergeni";
import { PageHeader, Modal, ZakonskaOznaka, VanMrezeOznaka } from "../components/Zajednicko";
import { StatusBadge } from "../components/StatusBadge";
import { IzborAlergena, AlergeniOznaka } from "../components/Alergeni";
import { IzborTermometra, useIzborTermometra } from "../components/Termometar";
import { SacuvanoNaTelefonu } from "../components/VanMreze";

// Porudžbine torti (poslastičarnica, dopuna 39). Svaka torta: kupac sa telefonom (#4), serije sastojaka (P2),
// alergeni koje je čovjek potvrdio prije predaje (P1), predaja sa temperaturom kod dostave (P3). Server sve
// provjerava sam — ekran samo unaprijed kaže šta fali (#74).

type Red = {
  id: string;
  broj: string;
  kupac_ime: string;
  kupac_telefon: string;
  dan: string;
  vrijeme: string;
  nacin: "PREUZIMA" | "DOSTAVA";
  adresa_dostave: string | null;
  opis: string;
  napomena: string | null;
  status: string;
  alergeni: string[];
  alergeni_potvrdjeno_at: string | null;
  predaja_van_mreze: boolean;
  razlog_otkaza: string | null;
  broj_sastojaka: number;
  otvorena_odstupanja: number;
  sastojak_zadrzan: boolean;
  fali_alergen: boolean;
};
type LotPorudzbine = {
  lot_id: string;
  broj_lota: string;
  lot_status: string;
  rok: string | null;
  artikal: string;
  alergeni: string[];
  alergeni_upisani: boolean;
  dobavljac: string;
  dodao: string;
};
type Detalj = Red & {
  uneo: string;
  alergene_potvrdio: string | null;
  predao: string | null;
  otkazao: string | null;
  predato_at: string | null;
  preuzeo_ime: string | null;
  temperatura_predaje: string | null;
  rezultat_temperature: string | null;
  termometar: string | null;
  lotovi: LotPorudzbine[];
  predlog: string[];
  sastojciBezAlergena: string[];
  faliAlergen: string[];
};
type Sastojak = { lot_id: string; broj_lota: string; rok: string | null; artikal: string; alergeni: string[]; alergeni_upisani: boolean; dobavljac: string };

const OTVORENA = (s: string) => s === "PRIMLJENA" || s === "U_IZRADI";
const datumPlus = (dana: number) => {
  const d = new Date(`${lokalniDatum()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dana);
  return d.toISOString().slice(0, 10);
};
const prikazDana = (dan: string) => {
  if (dan === lokalniDatum()) return "danas";
  if (dan === datumPlus(1)) return "sutra";
  if (dan === datumPlus(-1)) return "juče";
  const [g, m, d] = dan.split("-");
  return `${d}.${m}.${g}.`;
};
const prikazRoka = (rok: string | null) => (rok ? rok.split("-").reverse().join(".") + "." : "bez roka");
const telefonLink = (t: string) => `tel:${t.replace(/[^+\d]/g, "")}`;
const greskaTekst = (e: unknown, opsta: string) => (e instanceof ApiGreska ? e.message : opsta);
/** Stalni kupac iz Šifarnika (kafić, hotel, sala) — samo popunjava formu; porudžbina čuva svoje ime i telefon. */
type StalniKupac = { id: string; naziv: string; telefon: string; adresa: string | null; adresa_isporuke: string | null; aktivan: boolean };

const TABOVI = [
  { kod: "izrada", naziv: "Za izradu" },
  { kod: "danas", naziv: "Danas" },
  { kod: "sutra", naziv: "Sutra" },
  { kod: "sve", naziv: "Sve" },
] as const;

export function Porudzbine() {
  const [lista, setLista] = useState<Red[]>([]);
  const [ucitano, setUcitano] = useState(false);
  const [tab, setTab] = useState<(typeof TABOVI)[number]["kod"]>("izrada");
  const [forma, setForma] = useState<Detalj | "nova" | null>(null);
  const [otvorena, setOtvorena] = useState<string | null>(null);
  const izlaz = useIzlaz();

  const ucitaj = () =>
    api<Red[]>("/porudzbine")
      .then((l) => {
        setLista(l);
        setUcitano(true);
      })
      .catch(() => setUcitano(true));
  useEffect(() => {
    void ucitaj();
    // Predaja koja je čekala na telefonu je stigla — status se mijenja.
    window.addEventListener(IZLAZ_POSLAT, ucitaj);
    return () => window.removeEventListener(IZLAZ_POSLAT, ucitaj);
  }, []);

  const prikazano = lista.filter((p) =>
    tab === "izrada" ? OTVORENA(p.status) : tab === "danas" ? p.dan === lokalniDatum() : tab === "sutra" ? p.dan === datumPlus(1) : true,
  );

  return (
    <>
      <PageHeader
        eyebrow="Atelje"
        title="Porudžbine torti"
        description={<>Kupac sa telefonom, serije sastojaka i potvrđeni alergeni — da se zna u kojoj je torti bila koja serija i kome je otišla <ZakonskaOznaka clan="27" />.</>}
        action={
          <button className="primary-button" onClick={() => setForma("nova")}>
            <Plus size={16} /> Nova porudžbina
          </button>
        }
      />
      <div className="filter-bar">
        {TABOVI.map((t) => (
          <button key={t.kod} className={`small-action${tab === t.kod ? " selected" : ""}`} onClick={() => setTab(t.kod)}>
            {t.naziv}
          </button>
        ))}
        <span className="filter-broj">{prikazano.length} od {lista.length}</span>
      </div>

      {ucitano && prikazano.length === 0 && (
        <div className="panel full-panel" style={{ padding: 20 }}>
          <span className="muted-text">{tab === "izrada" ? "Nema porudžbina za izradu." : "Nema porudžbina za izabrani dan."}</span>
        </div>
      )}
      <div className="porudzbine-lista">
        {prikazano.map((p) => (
          <button key={p.id} className={`porudzbina-kartica status-${p.status.toLowerCase()}`} onClick={() => setOtvorena(p.id)}>
            <div className="porudzbina-vrh">
              <strong className="porudzbina-vrijeme">{prikazDana(p.dan)} · {p.vrijeme}</strong>
              <StatusBadge status={p.status} />
            </div>
            <div className="porudzbina-kupac">
              {p.kupac_ime}
              <span className="muted-text"> · {p.kupac_telefon}</span>
            </div>
            <div className="porudzbina-opis">{p.opis}</div>
            <div className="porudzbina-oznake">
              {p.nacin === "DOSTAVA" ? <span className="oznaka-nacin"><Truck size={11} /> dostava{p.adresa_dostave ? `: ${p.adresa_dostave}` : ""}</span> : <span className="oznaka-nacin"><Store size={11} /> preuzima u ateljeu</span>}
              {OTVORENA(p.status) && (!p.alergeni_potvrdjeno_at || p.fali_alergen) ? (
                <span className="alergeni-nisu">alergeni nisu potvrđeni</span>
              ) : p.alergeni_potvrdjeno_at ? (
                <AlergeniOznaka sifre={p.alergeni} />
              ) : null}
              {p.sastojak_zadrzan && OTVORENA(p.status) && <span className="alergeni-nisu"><AlertTriangle size={11} /> sastojak zadržan — ne predaje se</span>}
              {OTVORENA(p.status) && p.broj_sastojaka === 0 && <span className="muted-text">bez sastojaka po seriji</span>}
              {p.otvorena_odstupanja > 0 && <span className="alergeni-nisu"><AlertTriangle size={11} /> {p.otvorena_odstupanja} problem</span>}
              {OTVORENA(p.status) && izlaz.ceka(`porudzbina:${p.id}`) && <span className="ceka-mrezu">Predaja je na telefonu — čeka mrežu</span>}
              <VanMrezeOznaka da={p.predaja_van_mreze} />
            </div>
            <div className="muted-text porudzbina-broj">{p.broj}</div>
          </button>
        ))}
      </div>

      {forma && (
        <FormaPorudzbine
          postojeca={forma === "nova" ? undefined : forma}
          onClose={() => setForma(null)}
          onSacuvano={(id) => {
            void ucitaj();
            setForma(null);
            setOtvorena(id);
          }}
        />
      )}
      {otvorena && !forma && (
        <DetaljPorudzbine
          id={otvorena}
          onClose={() => setOtvorena(null)}
          onPromjena={ucitaj}
          onIzmijeni={(d) => setForma(d)}
        />
      )}
    </>
  );
}

function FormaPorudzbine({ postojeca, onClose, onSacuvano }: { postojeca?: Detalj; onClose: () => void; onSacuvano: (id: string) => void }) {
  const [kupacIme, setKupacIme] = useState(postojeca?.kupac_ime ?? "");
  const [kupacTelefon, setKupacTelefon] = useState(postojeca?.kupac_telefon ?? "");
  const [datum, setDatum] = useState(postojeca?.dan ?? datumPlus(1));
  const [vrijeme, setVrijeme] = useState(postojeca?.vrijeme ?? "12:00");
  const [nacin, setNacin] = useState<"PREUZIMA" | "DOSTAVA">(postojeca?.nacin ?? "PREUZIMA");
  const [adresa, setAdresa] = useState(postojeca?.adresa_dostave ?? "");
  const [opis, setOpis] = useState(postojeca?.opis ?? "");
  const [napomena, setNapomena] = useState(postojeca?.napomena ?? "");
  const [greska, setGreska] = useState("");
  const [kljuc] = useState(noviKljuc);
  const { radim, salji } = useSlanje();
  const [stalni, setStalni] = useState<StalniKupac[]>([]);
  useEffect(() => {
    if (postojeca) return;
    api<StalniKupac[]>("/kupci")
      .then((l) => setStalni(l.filter((k) => k.aktivan !== false)))
      .catch(() => setStalni([]));
  }, []);
  const izaberiStalnog = (id: string) => {
    const k = stalni.find((x) => x.id === id);
    if (!k) return;
    setKupacIme(k.naziv);
    setKupacTelefon(k.telefon);
    const adresaDostave = k.adresa_isporuke || k.adresa;
    if (adresaDostave) setAdresa(adresaDostave);
  };

  // „Sačuvaj“ nikad sivo (#74) — klik kaže šta fali.
  const fali: string[] = [];
  if (kupacIme.trim().length < 2) fali.push("ime kupca");
  if (kupacTelefon.trim().length < 6) fali.push("telefon kupca (povlačenje počinje telefonom)");
  if (!datum) fali.push("datum preuzimanja");
  if (!vrijeme) fali.push("vrijeme preuzimanja");
  if (nacin === "DOSTAVA" && !adresa.trim()) fali.push("adresa dostave");
  if (opis.trim().length < 3) fali.push("opis torte");

  const posalji = async () => {
    const telo = { kupacIme, kupacTelefon, preuzimanjeDatum: datum, preuzimanjeVrijeme: vrijeme, nacin, adresaDostave: nacin === "DOSTAVA" ? adresa : undefined, opis, napomena: napomena || undefined };
    try {
      if (postojeca) {
        await api(`/porudzbine/${postojeca.id}`, { method: "PATCH", telo });
        onSacuvano(postojeca.id);
      } else {
        const r = await api<{ id: string }>("/porudzbine", { telo, kljuc });
        onSacuvano(r.id);
      }
    } catch (e) {
      setGreska(greskaTekst(e, "Porudžbina nije sačuvana."));
    }
  };
  const sacuvaj = () => {
    if (fali.length > 0) {
      setGreska(`Za čuvanje još fali: ${fali.join(", ")}.`);
      return;
    }
    setGreska("");
    void salji(posalji);
  };

  return (
    <Modal
      naslov={postojeca ? `Izmjena — ${postojeca.broj}` : "Nova porudžbina"}
      podnaslov="Kupac, preuzimanje i opis torte"
      onClose={onClose}
      greska={greska}
      siroki
      footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={sacuvaj} disabled={radim}>Sačuvaj</button></>}
    >
      <div className="form-grid">
        {stalni.length > 0 && (
          <label style={{ gridColumn: "1 / -1" }}>
            Stalni kupac (opciono)
            <select value="" onChange={(e) => izaberiStalnog(e.target.value)}>
              <option value="">— izaberite da se popune ime, telefon i adresa —</option>
              {stalni.map((k) => <option key={k.id} value={k.id}>{k.naziv} · {k.telefon}</option>)}
            </select>
          </label>
        )}
        <label>Ime kupca<input value={kupacIme} onChange={(e) => setKupacIme(e.target.value)} placeholder="npr. Marija Petrović" autoComplete="off" /></label>
        <label>
          Telefon kupca <ZakonskaOznaka clan="28" />
          <input type="tel" inputMode="tel" value={kupacTelefon} onChange={(e) => setKupacTelefon(e.target.value)} placeholder="067 123 456" autoComplete="off" />
        </label>
        <label>Datum preuzimanja<input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} /></label>
        <label>Vrijeme<input type="time" value={vrijeme} onChange={(e) => setVrijeme(e.target.value)} /></label>
        <label>
          Način
          <select value={nacin} onChange={(e) => setNacin(e.target.value as "PREUZIMA" | "DOSTAVA")}>
            <option value="PREUZIMA">Kupac preuzima u ateljeu</option>
            <option value="DOSTAVA">Dostava (sala, hotel, kuća)</option>
          </select>
        </label>
        {nacin === "DOSTAVA" && <label>Adresa dostave<input value={adresa} onChange={(e) => setAdresa(e.target.value)} placeholder="npr. Sala Montenegro, Bar" /></label>}
        <label style={{ gridColumn: "1 / -1" }}>
          Opis torte
          <textarea rows={3} value={opis} onChange={(e) => setOpis(e.target.value)} placeholder="vrsta, veličina, punjenje, natpis — npr. „Rođendanska, 20 osoba, čokolada i malina, natpis Srećan 7. rođendan, Luka“" />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>Napomena (opciono)<input value={napomena} onChange={(e) => setNapomena(e.target.value)} placeholder="npr. dekoracija sa živim cvijećem — kupcu reći da se skine prije sječenja" /></label>
      </div>
    </Modal>
  );
}

function DetaljPorudzbine({ id, onClose, onPromjena, onIzmijeni }: { id: string; onClose: () => void; onPromjena: () => void; onIzmijeni: (d: Detalj) => void }) {
  const [d, setD] = useState<Detalj | null>(null);
  const [greska, setGreska] = useState("");
  const [obavijest, setObavijest] = useState("");
  const [sastojci, setSastojci] = useState<Sastojak[]>([]);
  const [trazi, setTrazi] = useState("");
  const [izabraniLot, setIzabraniLot] = useState("");
  const [alergeni, setAlergeni] = useState<string[]>([]);
  const [bezAlergena, setBezAlergena] = useState(false);
  const [podmeni, setPodmeni] = useState<"otkaz" | "problem" | null>(null);
  const { nazivi } = useAlergeni();
  const { radim, salji } = useSlanje();

  const ucitaj = async () => {
    try {
      const det = await api<Detalj>(`/porudzbine/${id}`);
      setD(det);
      // Polazno: ono što je potvrđeno + ono što dolazi iz sastojaka.
      setAlergeni(Array.from(new Set([...det.alergeni, ...det.predlog])));
      setBezAlergena(!!det.alergeni_potvrdjeno_at && det.alergeni.length === 0);
    } catch (e) {
      setGreska(greskaTekst(e, "Porudžbina se nije otvorila."));
    }
  };
  useEffect(() => {
    void ucitaj();
    api<Sastojak[]>("/porudzbine/sastojci").then(setSastojci).catch(() => {});
  }, [id]);

  const osvjezi = async (poruka = "") => {
    setObavijest(poruka);
    await ucitaj();
    onPromjena();
  };
  const radnja = (fn: () => Promise<void>) =>
    salji(async () => {
      setGreska("");
      try {
        await fn();
      } catch (e) {
        setGreska(greskaTekst(e, "Nije sačuvano."));
      }
    });

  const ponuda = useMemo(() => {
    const vec = new Set(d?.lotovi.map((l) => l.lot_id));
    const t = trazi.trim().toLowerCase();
    return sastojci.filter((s) => !vec.has(s.lot_id) && (!t || `${s.artikal} ${s.broj_lota} ${s.dobavljac}`.toLowerCase().includes(t)));
  }, [sastojci, d, trazi]);

  if (!d) {
    return (
      <Modal naslov="Porudžbina" onClose={onClose} greska={greska}>
        <div style={{ padding: 20 }} className="muted-text">{greska ? "" : "Učitavanje..."}</div>
      </Modal>
    );
  }

  const otvorena = OTVORENA(d.status);
  const potvrdjeno = !!d.alergeni_potvrdjeno_at && d.faliAlergen.length === 0;
  const sastav = [
    `Torta: ${d.opis}`,
    `Alergeni: ${d.alergeni.length ? nazivi(d.alergeni) : "nema nijednog od 14 alergena"}`,
    d.lotovi.length ? `Sastojci: ${Array.from(new Set(d.lotovi.map((l) => l.artikal))).join(", ")}` : "",
    d.napomena ? `Napomena: ${d.napomena}` : "",
  ].filter(Boolean).join("\n");

  return (
    <Modal
      naslov={`${d.broj} · ${d.kupac_ime}`}
      podnaslov={`${prikazDana(d.dan)} u ${d.vrijeme} · ${d.nacin === "DOSTAVA" ? "dostava" : "preuzima u ateljeu"}`}
      onClose={onClose}
      greska={greska}
      siroki
      footer={<button className="secondary-button" onClick={onClose}>Zatvori</button>}
    >
      <div className="porudzbina-detalj">
        {obavijest && <div className="info-traka" role="status">{obavijest}</div>}
        <section>
          <div className="porudzbina-vrh">
            <StatusBadge status={d.status} />
            <a className="link-button" href={telefonLink(d.kupac_telefon)}><Phone size={13} /> {d.kupac_telefon}</a>
          </div>
          <p className="porudzbina-opis-veliki">{d.opis}</p>
          {d.napomena && <p className="muted-text">Napomena: {d.napomena}</p>}
          {d.nacin === "DOSTAVA" && <p className="muted-text">Dostava: {d.adresa_dostave}</p>}
          <p className="muted-text" style={{ fontSize: 10 }}>Upisao/la: {d.uneo}</p>
          {otvorena && (
            <div className="dugmad-red">
              <button className="small-action" onClick={() => onIzmijeni(d)}>Izmijeni</button>
              {d.status === "PRIMLJENA" && <button className="small-action" onClick={() => radnja(async () => { await api(`/porudzbine/${id}/izrada`, { telo: {} }); await osvjezi("Torta je u izradi."); })}>Počni izradu</button>}
              <button className="small-action" onClick={() => setPodmeni(podmeni === "otkaz" ? null : "otkaz")}>Otkaži</button>
            </div>
          )}
          {d.status === "OTKAZANA" && <p className="muted-text">Otkazao/la: {d.otkazao} — {d.razlog_otkaza}</p>}
          {podmeni === "otkaz" && <Otkaz id={id} onGotovo={() => { setPodmeni(null); void osvjezi("Porudžbina je otkazana."); }} />}
        </section>

        <section>
          <h3>Sastojci po seriji <ZakonskaOznaka clan="27" /></h3>
          <p className="muted-text sekcija-objasnjenje">Lotovi ključnih sastojaka (jaja, pavlaka, maskarpone, mlijeko…) — ako serija bude sporna, zna se u kojoj je torti i kome je otišla.</p>
          {d.lotovi.length === 0 && <p className="muted-text">Još nijedan sastojak.</p>}
          <ul className="sastojci-lista">
            {d.lotovi.map((l) => (
              <li key={l.lot_id} className={l.lot_status !== "PRIHVACEN" ? "zadrzan" : ""}>
                <div>
                  <strong>{l.artikal}</strong> · lot {l.broj_lota}
                  <span className="muted-text"> · rok {prikazRoka(l.rok)} · {l.dobavljac}</span>
                  <div className="sastojak-alergeni">
                    {l.alergeni_upisani ? <AlergeniOznaka sifre={l.alergeni} prazno="bez alergena" /> : <span className="alergeni-nisu">alergeni nisu upisani u Šifarnicima</span>}
                    {l.lot_status !== "PRIHVACEN" && <span className="alergeni-nisu"><AlertTriangle size={11} /> zadržan — torta se ne predaje</span>}
                  </div>
                </div>
                {otvorena && (
                  <button className="row-action" aria-label={`Ukloni ${l.artikal}`} title="Pogrešno izabran — ukloni" onClick={() => radnja(async () => { await api(`/porudzbine/${id}/lotovi/${l.lot_id}`, { method: "DELETE" }); await osvjezi(); })}>
                    <X size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {otvorena && (
            <div className="form-grid dodaj-sastojak">
              <label>
                Traži sastojak
                <input value={trazi} onChange={(e) => setTrazi(e.target.value)} placeholder="jaja, pavlaka, broj lota…" />
              </label>
              <label>
                Serija (lot)
                <select value={izabraniLot} onChange={(e) => setIzabraniLot(e.target.value)}>
                  <option value="">— izaberite —</option>
                  {ponuda.map((s) => (
                    <option key={s.lot_id} value={s.lot_id}>
                      {s.artikal} · {s.broj_lota} · rok {prikazRoka(s.rok)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="secondary-button"
                style={{ alignSelf: "end" }}
                onClick={() => {
                  if (!izabraniLot) {
                    setGreska("Izaberite seriju sastojka sa spiska.");
                    return;
                  }
                  void radnja(async () => {
                    const r = await api<{ potvrdaPonistena: boolean; noviAlergeni?: string[] }>(`/porudzbine/${id}/lotovi`, { telo: { lotId: izabraniLot } });
                    setIzabraniLot("");
                    await osvjezi(r.potvrdaPonistena ? `Nov sastojak donosi: ${nazivi(r.noviAlergeni ?? [])} — potvrdite alergene ponovo.` : "");
                  });
                }}
              >
                <Plus size={14} /> Dodaj
              </button>
              {sastojci.length === 0 && <small className="muted-text" style={{ gridColumn: "1 / -1" }}>Nema prihvaćenih sastojaka sa rokom — prvo prijem robe.</small>}
            </div>
          )}
        </section>

        <section>
          <h3>Alergeni torte</h3>
          {d.alergeni_potvrdjeno_at && d.faliAlergen.length === 0 ? (
            <p className="potvrdjeno-red">Potvrdio/la: {d.alergene_potvrdio} — <AlergeniOznaka sifre={d.alergeni} prazno="nema nijednog od 14 alergena" /></p>
          ) : (
            <p className="alergeni-nisu" style={{ display: "block" }}>
              {d.faliAlergen.length > 0 ? `Sastojak dodat posle potvrde donosi: ${nazivi(d.faliAlergen)} — potvrdite ponovo.` : "Alergeni još nisu potvrđeni — torta se ne predaje bez potvrde."}
            </p>
          )}
          {d.sastojciBezAlergena.length > 0 && (
            <p className="upozorenje-tekst"><AlertTriangle size={12} /> Alergeni nisu upisani za: {d.sastojciBezAlergena.join(", ")} — pogledajte deklaraciju (upisuje se u Šifarnicima).</p>
          )}
          {otvorena && (
            <>
              <p className="muted-text sekcija-objasnjenje">Isprekidano su alergeni iz sastojaka — ne mogu se skinuti. Dodajte ono što nije vođeno po seriji (npr. orasi u dekoraciji).</p>
              <IzborAlergena izabrani={alergeni} zakljucani={d.predlog} onChange={(s) => { setAlergeni(s); if (s.length) setBezAlergena(false); }} />
              {alergeni.length === 0 && (
                <label className="potvrda-red potvrda-izvan">
                  <input type="checkbox" checked={bezAlergena} onChange={(e) => setBezAlergena(e.target.checked)} /> Provjereno — torta nema nijedan od 14 alergena
                </label>
              )}
              <button
                className="primary-button"
                style={{ marginTop: 10 }}
                disabled={radim}
                onClick={() => {
                  if (alergeni.length === 0 && !bezAlergena) {
                    setGreska("Označite alergene torte, ili potvrdite da nema nijednog.");
                    return;
                  }
                  void radnja(async () => {
                    await api(`/porudzbine/${id}/alergeni`, { telo: { alergeni, bezAlergena } });
                    await osvjezi("Alergeni su potvrđeni.");
                  });
                }}
              >
                {potvrdjeno ? "Potvrdi ponovo" : "Potvrdi alergene"}
              </button>
            </>
          )}
        </section>

        {potvrdjeno && <SastavZaKupca tekst={sastav} />}

        {otvorena && <Predaja d={d} potvrdjeno={potvrdjeno} onPredato={(poruka) => void osvjezi(poruka)} />}
        {d.status === "PREDATA" && (
          <section>
            <h3>Predaja</h3>
            <p>
              Predao/la: <strong>{d.predao}</strong>
              {d.preuzeo_ime && <> · preuzeo/la: <strong>{d.preuzeo_ime}</strong></>}
              {d.predato_at && <span className="muted-text"> · {new Date(d.predato_at).toLocaleString("sr-Latn-ME", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>}
              <VanMrezeOznaka da={d.predaja_van_mreze} />
            </p>
            {d.temperatura_predaje !== null && (
              <p>
                Temperatura pri predaji: <strong>{Number(d.temperatura_predaje)} °C</strong>
                {d.termometar && <span className="muted-text"> · {d.termometar}</span>}{" "}
                {d.rezultat_temperature ? <StatusBadge status={d.rezultat_temperature} /> : <span className="muted-text">(granica nije podešena u HACCP planu — ne ocjenjuje se)</span>}
              </p>
            )}
          </section>
        )}

        <section>
          {podmeni === "problem" ? (
            <Problem id={id} onGotovo={() => { setPodmeni(null); void osvjezi("Problem je prijavljen — odgovorno lice je dobilo obavještenje."); }} />
          ) : (
            <button className="small-action odstupanje-dugme" onClick={() => setPodmeni("problem")}>
              <AlertTriangle size={12} /> Problem / reklamacija
            </button>
          )}
        </section>
      </div>
    </Modal>
  );
}

function SastavZaKupca({ tekst }: { tekst: string }) {
  const [kopirano, setKopirano] = useState(false);
  const kopiraj = async () => {
    try {
      await navigator.clipboard.writeText(tekst);
      setKopirano(true);
      window.setTimeout(() => setKopirano(false), 2500);
    } catch {
      window.prompt("Kopirajte tekst:", tekst);
    }
  };
  return (
    <section>
      <h3>Sastav i alergeni za kupca</h3>
      <pre className="sastav-tekst">{tekst}</pre>
      <button className="small-action" onClick={() => void kopiraj()}><Copy size={12} /> {kopirano ? "Kopirano" : "Kopiraj za poruku kupcu"}</button>
    </section>
  );
}

function Predaja({ d, potvrdjeno, onPredato }: { d: Detalj; potvrdjeno: boolean; onPredato: (poruka: string) => void }) {
  const [preuzeo, setPreuzeo] = useState("");
  const [temperatura, setTemperatura] = useState("");
  const [greska, setGreska] = useState("");
  const [naTelefonu, setNaTelefonu] = useState(false);
  const [kljuc] = useState(noviKljuc);
  const { termometri, termometarId, setTermometarId } = useIzborTermometra();
  const { radim, salji } = useSlanje();
  const izlaz = useIzlaz();
  const dostava = d.nacin === "DOSTAVA";
  const zadrzan = d.lotovi.some((l) => l.lot_status !== "PRIHVACEN");

  // Prvo potvrda „Sačuvano na telefonu“ — upis je u tom trenutku već u redu, pa bi je „čeka mrežu“ inače sakrilo.
  if (naTelefonu) return <SacuvanoNaTelefonu naslov={`Predaja ${d.broj}`} opis={`Predaja torte ${d.broj}`} onClose={() => setNaTelefonu(false)} />;
  if (izlaz.ceka(`porudzbina:${d.id}`)) return <section><span className="ceka-mrezu">Predaja je na telefonu — šalje se čim bude signala</span></section>;

  const predaj = () => {
    const fali: string[] = [];
    if (!potvrdjeno) fali.push("potvrđeni alergeni (gore)");
    if (zadrzan) fali.push("sastojak je zadržan — torta se ne predaje");
    if (dostava && temperatura.trim() === "") fali.push("temperatura torte pri predaji");
    if (temperatura.trim() !== "" && termometri.length > 0 && !termometarId) fali.push("termometar");
    if (fali.length) {
      setGreska(`Za predaju još fali: ${fali.join(", ")}.`);
      return;
    }
    setGreska("");
    void salji(async () => {
      try {
        const u = await upisiIliSacuvaj<{ rezultat: string | null; bezGranice: boolean }>(
          `/porudzbine/${d.id}/predaja`,
          { temperatura: temperatura.trim() === "" ? null : Number(temperatura.replace(",", ".")), mjerniUredjajId: termometarId || null, preuzeoIme: preuzeo.trim() || undefined },
          { kljuc, opis: `Predaja torte ${d.broj} — ${d.kupac_ime}`, vezano: `porudzbina:${d.id}` },
        );
        if (!u.poslato) {
          setNaTelefonu(true);
          return;
        }
        const r = u.rezultat;
        onPredato(
          r.rezultat === "FAIL"
            ? "Torta je predata, ali temperatura je van granice — otvorena je neusaglašenost i odgovorno lice je obaviješteno."
            : r.bezGranice
              ? "Torta je predata. Temperatura je zapisana, ali granica za predaju nije podešena u HACCP planu."
              : "Torta je predata.",
        );
      } catch (e) {
        setGreska(greskaTekst(e, "Predaja nije sačuvana."));
      }
    });
  };

  return (
    <section>
      <h3>Predaja kupcu</h3>
      <div className="form-grid" style={{ padding: 0 }}>
        <label>Ko preuzima (opciono)<input value={preuzeo} onChange={(e) => setPreuzeo(e.target.value)} placeholder="npr. kupac lično, menadžer sale" /></label>
        <label>
          Temperatura torte (°C){dostava ? "" : " — opciono"} <ZakonskaOznaka clan="36" />
          <input type="number" step="0.1" inputMode="decimal" value={temperatura} onChange={(e) => setTemperatura(e.target.value)} placeholder={dostava ? "izmjereno pri predaji" : ""} />
        </label>
        {temperatura.trim() !== "" && termometri.length > 0 && <IzborTermometra termometri={termometri} value={termometarId} onChange={setTermometarId} obavezan />}
      </div>
      {greska && <div className="auth-error" role="alert" style={{ marginTop: 10 }}>{greska}</div>}
      <button className="primary-button" style={{ marginTop: 10 }} disabled={radim} onClick={predaj}>Predaj tortu</button>
    </section>
  );
}

function Otkaz({ id, onGotovo }: { id: string; onGotovo: () => void }) {
  const [razlog, setRazlog] = useState("");
  const [greska, setGreska] = useState("");
  const { radim, salji } = useSlanje();
  return (
    <div className="podforma">
      <label className="podforma-polje">
        Razlog otkaza
        <input value={razlog} onChange={(e) => setRazlog(e.target.value)} placeholder="npr. kupac otkazao telefonom" />
      </label>
      {greska && <div className="auth-error" role="alert">{greska}</div>}
      <button
        className="secondary-button"
        disabled={radim}
        onClick={() => {
          if (razlog.trim().length < 5) {
            setGreska("Upišite zašto se porudžbina otkazuje.");
            return;
          }
          void salji(async () => {
            try {
              await api(`/porudzbine/${id}/otkaz`, { telo: { razlog: razlog.trim() } });
              onGotovo();
            } catch (e) {
              setGreska(greskaTekst(e, "Porudžbina nije otkazana."));
            }
          });
        }}
      >
        Otkaži porudžbinu
      </button>
    </div>
  );
}

function Problem({ id, onGotovo }: { id: string; onGotovo: () => void }) {
  const [opis, setOpis] = useState("");
  const [ozbiljnost, setOzbiljnost] = useState("SREDNJI");
  const [greska, setGreska] = useState("");
  const [kljuc] = useState(noviKljuc);
  const { radim, salji } = useSlanje();
  return (
    <div className="podforma">
      <label className="podforma-polje">
        Šta se desilo
        <textarea rows={2} value={opis} onChange={(e) => setOpis(e.target.value)} placeholder="npr. kupac javio da je krem bio kiseo; torta oštećena u prevozu" />
      </label>
      <label className="podforma-polje">
        Koliko je ozbiljno
        <select value={ozbiljnost} onChange={(e) => setOzbiljnost(e.target.value)}>
          <option value="NIZAK">Nisko</option>
          <option value="SREDNJI">Srednje</option>
          <option value="VISOK">Visoko — bezbjednost hrane</option>
        </select>
      </label>
      {greska && <div className="auth-error" role="alert">{greska}</div>}
      <button
        className="secondary-button"
        disabled={radim}
        onClick={() => {
          if (opis.trim().length < 3) {
            setGreska("Opišite šta se desilo.");
            return;
          }
          void salji(async () => {
            try {
              const u = await upisiIliSacuvaj("/neusaglasenosti", { opis: opis.trim(), ozbiljnost, izvorTip: "porudzbina", izvorId: id }, { kljuc, opis: "Problem na porudžbini" });
              if (u.poslato) onGotovo();
              else setGreska("Bez mreže — prijava je sačuvana na telefonu i šalje se sama.");
            } catch (e) {
              setGreska(greskaTekst(e, "Problem nije prijavljen."));
            }
          });
        }}
      >
        Prijavi problem
      </button>
    </div>
  );
}
