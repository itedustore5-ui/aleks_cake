import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Check, ArrowRight } from "lucide-react";
import { api, ApiGreska } from "../lib/api";
import { useSlanje, noviKljuc } from "../lib/slanje";
import { upisiIliSacuvaj } from "../lib/izlaz";
import { SacuvanoNaTelefonu } from "../components/VanMreze";
import { lokalniDatum } from "../lib/vrijeme";
import { PageHeader, Modal, ZakonskaOznaka, VanMrezeOznaka } from "../components/Zajednicko";
import { StatusBadge } from "../components/StatusBadge";
import { useAuth, NAZIV_ULOGE, type Uloga } from "../lib/auth";

type Nc = {
  id: string;
  broj: string;
  ozbiljnost: string;
  status: string;
  opis: string;
  prijavio: string | null;
  prijavio_korisnik_id: string | null;
  izvor_oznaka: string | null;
  izvor_tip?: string;
  mjera_za_mene: boolean;
  mjera_kod: string | null;
  created_at: string;
  van_mreze?: boolean;
};
type Mjera = {
  id: string;
  opis: string;
  status: string;
  dodijeljeno_korisnik_id: string | null;
  dodijeljeno: string | null;
  zavrsio: string | null;
  rok: string | null;
  rezultat: string | null;
  zavrseno_at: string | null;
};
type Verifikacija = { id: string; rezultat: string; napomena: string | null; verifikovao: string | null; verifikovano_at: string; izuzetak_cetiri_oka: boolean };
/** Šta server zna prije provjere (ncService.stanjeProvjere) — da se ne saznaje iz greške. */
type StanjeProvjere = {
  fali: string | null;
  faliGdje: string | null;
  povlacenjeId: string | null;
  svojaMjera: boolean;
  izuzetakMoguc: boolean;
  /** Jedino odgovorno lice u firmi — „Riješeno je“ zatvara odmah (uz kvačicu, #41). */
  samaZatvara: boolean;
  drugoLice: string | null;
};
type NcDetalj = Nc & { zatvorio: string | null; zatvoreno_at: string | null; korektivneMjere: Mjera[]; verifikacije: Verifikacija[]; provjera?: StanjeProvjere | null };
const GDJE: Record<string, string> = {
  "/haccp": "Novo mjerenje (HACCP / DHP)",
  "/vozila": "Kontrola vozila (D1)",
  "/haccp-plan": "Termometri (HACCP plan)",
  "/sledljivost": "Otvori povlačenje",
};
type Izvrsilac = { id: string; ime: string; uloga: Uloga };

const KORACI = ["Prijavljeno", "Mjera određena", "Mjera urađena", "Provjereno i zatvoreno"];

/** Na kom je koraku neusaglašenost (0–3) — isti redoslijed kao KORACI. */
function korak(status: string) {
  if (status === "ZATVORENA") return 4;
  if (status === "CEKA_VERIFIKACIJU") return 3;
  if (status === "MJERA_U_TOKU") return 2;
  return 1; // OTVORENA, PONOVO_OTVORENA: čeka mjeru
}

const datum = (iso: string) => new Date(iso).toLocaleDateString("sr-Latn-ME");

export function Neusaglasenosti() {
  const { korisnik } = useAuth();
  const vodiSistem = korisnik?.uloga === "bzr" || korisnik?.uloga === "izvodjac";
  const FILTERI = vodiSistem
    ? [
        { kod: "aktivne", naziv: "Aktivne" },
        { kod: "provjera", naziv: "Čekaju moju provjeru" },
        { kod: "sve", naziv: "Sve" },
        { kod: "zatvorene", naziv: "Zatvorene" },
      ]
    : [
        { kod: "za-mene", naziv: "Za mene" },
        { kod: "aktivne", naziv: "Sve aktivne" },
        { kod: "zatvorene", naziv: "Zatvorene" },
      ];
  const [lista, setLista] = useState<Nc[]>([]);
  const [filter, setFilter] = useState(FILTERI[0].kod);
  const [otvoren, setOtvoren] = useState<NcDetalj | null>(null);
  const [modalNova, setModalNova] = useState(false);

  const ucitaj = () => api<Nc[]>("/neusaglasenosti").then(setLista);
  useEffect(() => {
    ucitaj();
  }, []);

  const otvoriDetalj = (id: string) => api<NcDetalj>(`/neusaglasenosti/${id}`).then(setOtvoren);

  const uslov = (nc: Nc, kod: string) =>
    kod === "za-mene"
      ? nc.status !== "ZATVORENA" && (nc.mjera_za_mene || nc.prijavio_korisnik_id === korisnik?.id)
      : kod === "aktivne"
        ? nc.status !== "ZATVORENA"
        : kod === "provjera"
          ? nc.status === "CEKA_VERIFIKACIJU"
          : kod === "zatvorene"
            ? nc.status === "ZATVORENA"
            : true;
  const prikazano = lista.filter((nc) => uslov(nc, filter));

  return (
    <>
      <PageHeader
        title="Neusaglašenosti"
        description={<>Odstupanje bez zapisane mjere je nalaz protiv firme, ne protiv zaposlenog <ZakonskaOznaka clan="36" />.</>}
        action={
          <button className="primary-button" onClick={() => setModalNova(true)}>
            <Plus size={16} /> Prijavi problem
          </button>
        }
      />

      <div className="nc-tok">
        {KORACI.map((k, i) => (
          <div key={k} className="nc-tok-korak">
            <span>{i + 1}</span>
            <div>
              <strong>{k}</strong>
              <small>
                {i === 0 && "Svako prijavi problem tamo gdje ga vidi"}
                {i === 1 && "Odgovorno lice upiše mjeru i kome je daje"}
                {i === 2 && "Taj radnik je uradi i upiše šta je urađeno"}
                {i === 3 && "Odgovorno lice provjeri i zatvori"}
              </small>
            </div>
          </div>
        ))}
      </div>

      <div className="filter-tabs" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        {FILTERI.map((f) => (
          <button key={f.kod} className={filter === f.kod ? "selected" : ""} onClick={() => setFilter(f.kod)}>
            {f.naziv} <b>{lista.filter((nc) => uslov(nc, f.kod)).length}</b>
          </button>
        ))}
      </div>
      <div className="panel full-panel">
        <div className="nc-list">
          {prikazano.map((nc) => (
            <div key={nc.id} className={`nc-row${nc.mjera_za_mene ? " nc-za-mene" : ""}`} onClick={() => otvoriDetalj(nc.id)} style={{ cursor: "pointer" }}>
              <div className={`severity-bar ${nc.ozbiljnost === "VISOK" ? "danger" : "warning"}`} />
              <div className="nc-title">
                <strong>{nc.broj}{nc.mjera_za_mene && <span className="nc-oznaka-mjera">Mjera za vas</span>}<VanMrezeOznaka da={nc.van_mreze} /></strong>
                <h3>{nc.opis}</h3>
                <span>
                  {datum(nc.created_at)} · {nc.izvor_oznaka ?? "Prijava"} · prijava: {nc.prijavio ?? "sistem"}
                  {nc.mjera_kod && ` · mjera kod: ${nc.mjera_kod}`}
                </span>
              </div>
              <div><StatusBadge status={nc.ozbiljnost} /></div>
              <div><StatusBadge status={nc.status} /></div>
              <div className="muted-text">Korak {Math.min(korak(nc.status) + 1, 4)}/4</div>
              <div />
            </div>
          ))}
          {prikazano.length === 0 && (
            <p style={{ padding: 20, color: "#9aa5ae", fontSize: 12 }}>
              {filter === "za-mene" ? "Nema ničega što čeka vas. Kad vam odgovorno lice dodijeli mjeru, stići će obavještenje." : "Nema neusaglašenosti u ovom prikazu."}
            </p>
          )}
        </div>
      </div>

      {otvoren && (
        <NcDetaljModal
          detalj={otvoren}
          vodiSistem={vodiSistem}
          mojId={korisnik?.id ?? ""}
          onClose={() => setOtvoren(null)}
          onOsvjezi={() => otvoriDetalj(otvoren.id).then(ucitaj)}
        />
      )}
      {modalNova && <NovaNcModal onClose={() => setModalNova(false)} onCreated={ucitaj} />}
    </>
  );
}

function NcDetaljModal({ detalj, vodiSistem, mojId, onClose, onOsvjezi }: { detalj: NcDetalj; vodiSistem: boolean; mojId: string; onClose: () => void; onOsvjezi: () => void }) {
  const [izvrsioci, setIzvrsioci] = useState<Izvrsilac[]>([]);
  const [opisMjere, setOpisMjere] = useState("");
  const [kome, setKome] = useState("");
  const [rok, setRok] = useState("");
  // Mala firma: odgovorno lice samo riješi problem — „Riješeno je“ upisuje mjeru kao urađenu i, kad
  // pravila dozvole, odmah zatvara (jedna radnja; proba 03.10.2026). „Dodijeli mjeru“ je za rad preko drugog.
  const [nacin, setNacin] = useState<"rijesi" | "dodijeli">("rijesi");
  const [staJeUradjeno, setStaJeUradjeno] = useState("");
  const [staJeProvjereno, setStaJeProvjereno] = useState("");
  const [bezDrugog, setBezDrugog] = useState(false);
  const [info, setInfo] = useState("");
  const navigate = useNavigate();
  const [uradjeno, setUradjeno] = useState<Record<string, string>>({});
  const [napomena, setNapomena] = useState("");
  const [greska, setGreska] = useState("");
  // Poruka „šta fali“ nestaje čim se to popravi — ne stoji crveno pored označene kvačice.
  useEffect(() => setGreska(""), [staJeUradjeno, staJeProvjereno, bezDrugog, opisMjere]);

  useEffect(() => {
    if (vodiSistem) api<Izvrsilac[]>("/zadaci/izvrsioci").then(setIzvrsioci);
  }, [vodiSistem]);

  // Četiri oka u maloj firmi (H7): server kaže da li je izuzetak moguć; tek tada se nudi.
  const [izuzetakMoguc, setIzuzetakMoguc] = useState(false);
  const [izuzetak, setIzuzetak] = useState(false);
  const greskaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (greska) greskaRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [greska]);
  const p = detalj.provjera;
  useEffect(() => {
    if (p?.izuzetakMoguc) setIzuzetakMoguc(true);
  }, [p?.izuzetakMoguc]);
  // Mjeru je uradio onaj ko gleda, a postoji drugo odgovorno lice — provjerava ono (četiri oka).
  const cekaDrugog = !!p?.svojaMjera && !p.izuzetakMoguc;
  const radnja = async (fn: () => Promise<unknown>, poruka: string) => {
    setGreska("");
    setInfo("");
    try {
      await fn();
      onOsvjezi();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : poruka);
      if (e instanceof ApiGreska && e.code === "VERIFIKACIJA_NIJE_NEZAVISNA" && e.details.izuzetakMoguc === true) setIzuzetakMoguc(true);
    }
  };
  const provjeri = (rezultat: "POTVRDJENO" | "ODBIJENO") => {
    // Ništa sivo bez objašnjenja (#74, proba 02.10.2026: „neće da se zatvori“ — dugme je bilo sivo).
    if (rezultat === "POTVRDJENO" && p?.fali) {
      setGreska(`Još ne može: ${p.fali}`);
      return;
    }
    if (izuzetakMoguc && !izuzetak) {
      setGreska("Mjeru ste uradili vi, a drugog odgovornog lica nema: označite kvačicu iznad („provjeru radim bez drugog lica“) i upišite šta ste pregledali.");
      return;
    }
    if (izuzetakMoguc && izuzetak && napomena.trim().length < 10) {
      setGreska(`Upišite šta ste pregledali — još ${10 - napomena.trim().length} znakova (najmanje 10).`);
      return;
    }
    return radnja(
      () =>
        api(`/neusaglasenosti/${detalj.id}/verifikacija`, {
          telo: { rezultat, napomena: napomena || undefined, izuzetak: izuzetak || undefined },
        }),
      "Provjera nije sačuvana.",
    );
  };

  const idiNa = (gdje: string) => navigate(gdje, gdje === "/sledljivost" && p?.povlacenjeId ? { state: { povlacenjeId: p.povlacenjeId } } : undefined);
  const zatvaraOdmah = !!p?.samaZatvara && !p.fali;
  const rijesi = () => {
    if (staJeUradjeno.trim().length < 3) {
      setGreska("Upišite šta je urađeno — taj zapis čita inspektor.");
      return;
    }
    if (zatvaraOdmah && !bezDrugog) {
      setGreska("Vi ste jedino odgovorno lice, pa sami i zatvarate: označite kvačicu „zatvaram bez drugog lica“.");
      return;
    }
    if (zatvaraOdmah && staJeProvjereno.trim().length < 10) {
      setGreska(`Upišite šta ste provjerili — još ${10 - staJeProvjereno.trim().length} znakova (najmanje 10).`);
      return;
    }
    return radnja(async () => {
      const r = await api<{ status: string; razlog: string | null }>(`/neusaglasenosti/${detalj.id}/rijesi`, {
        telo: { uradjeno: staJeUradjeno, napomena: staJeProvjereno || undefined, izuzetak: (zatvaraOdmah && bezDrugog) || undefined },
      });
      setStaJeUradjeno("");
      setStaJeProvjereno("");
      setBezDrugog(false);
      // Zatvoreno piše na vrhu prozora; potvrda je potrebna samo kad se još čeka (ko, ili šta fali).
      setInfo(r.status === "ZATVORENA" ? "" : (r.razlog ?? "Mjera je upisana."));
    }, "Nije sačuvano.");
  };
  const dodijeli = () => {
    if (opisMjere.trim().length < 3) {
      setGreska("Upišite šta treba uraditi (najmanje 3 znaka).");
      return;
    }
    return radnja(async () => {
      await api(`/neusaglasenosti/${detalj.id}/korektivna-mjera`, { telo: { opis: opisMjere, dodijeljenoKorisnikId: kome || undefined, rok: rok || undefined } });
      setOpisMjere("");
      setKome("");
      setRok("");
      setInfo(kome ? "Mjera je dodijeljena — ta osoba dobija obavještenje." : "Mjera je upisana.");
    }, "Mjera nije sačuvana.");
  };
  const zavrsiMjeru = (id: string) => {
    if ((uradjeno[id] ?? "").trim().length < 3) {
      setGreska("Upišite šta je urađeno (najmanje 3 znaka) — taj zapis čita inspektor.");
      return;
    }
    return radnja(() => api(`/korektivne-mjere/${id}/zavrsi`, { telo: { rezultat: uradjeno[id] } }), "Mjera nije označena kao urađena.");
  };

  const k = korak(detalj.status);
  const otvorenaMjera = detalj.korektivneMjere.find((m) => m.status !== "ZAVRSENA");
  // Odgovorno lice upisuje „Riješeno je“ i dok je mjera kod nekog drugog — tim upisom je završava.
  const mozeRijesiti = vodiSistem && detalj.status !== "ZATVORENA" && detalj.status !== "CEKA_VERIFIKACIJU";
  const sljedeci = (() => {
    if (detalj.status === "ZATVORENA") return `Zatvoreno ${detalj.zatvoreno_at ? datum(detalj.zatvoreno_at) : ""}${detalj.zatvorio ? ` — ${detalj.zatvorio}` : ""}.`;
    if (k === 1) {
      if (!vodiSistem) return "Odgovorno lice određuje mjeru. Kad je dodijeli vama, stići će obavještenje.";
      if (p?.fali) return `Riješili ste? Upišite ispod šta je urađeno. Zatvara se tek kad je gotovo i ovo: ${p.fali}`;
      if (p?.samaZatvara) return "Riješili ste sami? Upišite ispod šta je urađeno i šta ste provjerili — zatvara se odmah. Ili mjeru dodijelite nekome.";
      return `Riješili ste? Upišite ispod šta je urađeno — provjerava ${p?.drugoLice ?? "drugo odgovorno lice"} (četiri oka). Ili mjeru dodijelite nekome.`;
    }
    if (k === 2) {
      if (otvorenaMjera?.dodijeljeno_korisnik_id === mojId && !vodiSistem) return "Mjera je dodijeljena vama: uradite je, upišite ispod šta je urađeno i označite „Urađeno“.";
      if (vodiSistem) return `Mjera je kod: ${otvorenaMjera?.dodijeljeno ?? "nije dodijeljena"}${otvorenaMjera?.rok ? ` (rok ${datum(otvorenaMjera.rok)})` : ""}. Kad je urađena, upišite ispod šta je urađeno.`;
      return `Čeka da ${otvorenaMjera?.dodijeljeno ?? "odgovorno lice"} uradi mjeru${otvorenaMjera?.rok ? ` (rok ${datum(otvorenaMjera.rok)})` : ""}.`;
    }
    // Iz kontrole se zatvara tek kad ponovna kontrola prođe (R-22) — server to provjerava i kaže šta fali.
    const ponovo = detalj.izvor_tip === "mjerenje_temperature" ? " Prije zatvaranja mora postojati novo mjerenje u granici." : detalj.izvor_tip === "kontrola_vozila" ? " Prije zatvaranja nova kontrola vozila (D1) mora proći." : detalj.izvor_tip === "mjerni_uredjaj" ? " Prije zatvaranja termometar mora proći novu provjeru." : "";
    if (!vodiSistem) return `Mjera je urađena — čeka provjeru odgovornog lica.${ponovo}`;
    if (detalj.provjera?.izuzetakMoguc) return `Mjera je urađena. Uradili ste je vi, a drugog odgovornog lica nema — zatvarate sami: ispod označite kvačicu, upišite šta ste pregledali i „Provjereno — zatvori“.${ponovo}`;
    if (detalj.provjera?.svojaMjera) return `Mjera je urađena. Uradili ste je vi — provjerava i zatvara ${detalj.provjera.drugoLice ?? "drugo odgovorno lice"} (četiri oka).${ponovo}`;
    return `Mjera je urađena — provjerite na licu mjesta i zatvorite.${ponovo}`;
  })();

  return (
    <Modal naslov={detalj.broj} podnaslov={detalj.izvor_oznaka ?? "Prijava"} onClose={onClose}>
      <div style={{ padding: 20 }}>
        <div className="nc-koraci">
          {KORACI.map((naziv, i) => (
            <div key={naziv} className={`nc-korak${i < k ? " uradjen" : i === k ? " trenutni" : ""}`}>
              <span>{i < k ? <Check size={11} /> : i + 1}</span>
              <small>{naziv}</small>
            </div>
          ))}
        </div>
        <div className="nc-sljedeci">{sljedeci}</div>

        <p style={{ fontSize: 12, color: "#394a57", margin: "14px 0 4px" }}>{detalj.opis}</p>
        <p className="muted-text" style={{ fontSize: 10, marginBottom: 16 }}>
          Prijava: {detalj.prijavio ?? "sistem"} · {datum(detalj.created_at)} · <StatusBadge status={detalj.ozbiljnost} />
        </p>

        <h3 style={{ fontSize: 12, marginBottom: 8 }}>Korektivne mjere <ZakonskaOznaka clan="36" /></h3>
        {detalj.korektivneMjere.length === 0 && <p style={{ fontSize: 11, color: "#9aa5ae" }}>Još nema unijete mjere.</p>}
        {detalj.korektivneMjere.map((m) => {
          const mojaIliVodim = m.dodijeljeno_korisnik_id === mojId || vodiSistem;
          return (
            <div key={m.id} className="nc-mjera">
              <div className="nc-mjera-glava">
                <strong>{m.opis}</strong>
                <StatusBadge status={m.status === "ZAVRSENA" ? "ZATVORENA" : "MJERA_U_TOKU"} tekst={m.status === "ZAVRSENA" ? "Urađeno" : "U toku"} />
              </div>
              <small className="muted-text">
                Kome: {m.dodijeljeno ?? "nije dodijeljena"}{m.rok ? ` · rok ${datum(m.rok)}` : ""}
              </small>
              {m.status === "ZAVRSENA" ? (
                <p className="nc-uradjeno">
                  Urađeno: {m.rezultat ?? "—"} <span className="muted-text">— {m.zavrsio ?? ""}{m.zavrseno_at ? `, ${datum(m.zavrseno_at)}` : ""}</span>
                </p>
              ) : (
                mojaIliVodim && !vodiSistem && (
                  <div className="nc-uradi">
                    <textarea
                      rows={2}
                      placeholder="Šta je urađeno (npr. komora očišćena i dezinfikovana, termometar zamijenjen)"
                      value={uradjeno[m.id] ?? ""}
                      onChange={(e) => setUradjeno((u) => ({ ...u, [m.id]: e.target.value }))}
                    />
                    <button className="primary-button" onClick={() => zavrsiMjeru(m.id)}>
                      <Check size={14} /> Urađeno
                    </button>
                  </div>
                )
              )}
            </div>
          );
        })}

        {mozeRijesiti && (
          <div className="nc-rijesi">
            {!otvorenaMjera && (
              <div className="filter-tabs" style={{ marginBottom: 10, flexWrap: "wrap" }}>
                <button className={nacin === "rijesi" ? "selected" : ""} onClick={() => setNacin("rijesi")}>Riješeno je — upiši</button>
                <button className={nacin === "dodijeli" ? "selected" : ""} onClick={() => setNacin("dodijeli")}>Dodijeli mjeru nekome</button>
              </div>
            )}
            {nacin === "rijesi" || otvorenaMjera ? (
              <div className="form-grid">
                {p?.fali && (
                  <div className="upozorenje-traka" style={{ gridColumn: "1 / -1", flexWrap: "wrap" }}>
                    <span style={{ flex: "1 1 220px" }}>Mjera se upisuje odmah, a zatvara kad je gotovo i ovo: {p.fali}</span>
                    {p.faliGdje && (
                      <button className="small-action" onClick={() => idiNa(p.faliGdje!)}>
                        {GDJE[p.faliGdje] ?? "Otvori"} <ArrowRight size={12} />
                      </button>
                    )}
                  </div>
                )}
                <label style={{ gridColumn: "1 / -1" }}>
                  Šta je urađeno{otvorenaMjera ? ` (mjera: ${otvorenaMjera.opis})` : ""}
                  <textarea
                    rows={2}
                    value={staJeUradjeno}
                    onChange={(e) => setStaJeUradjeno(e.target.value)}
                    placeholder="npr. komora očišćena i dezinfikovana, roba premještena u komoru 1, kupci obaviješteni"
                  />
                </label>
                {zatvaraOdmah ? (
                  <>
                    <label style={{ gridColumn: "1 / -1" }}>
                      Šta ste provjerili
                      <input value={staJeProvjereno} onChange={(e) => setStaJeProvjereno(e.target.value)} placeholder="npr. pregledala komoru, temperatura 3 °C, roba uredna" />
                    </label>
                    <label className="nc-bez-drugog" style={{ gridColumn: "1 / -1" }}>
                      <input type="checkbox" checked={bezDrugog} onChange={(e) => setBezDrugog(e.target.checked)} />
                      <span>
                        Jedino sam odgovorno lice u firmi — zatvaram bez drugog lica. Zapis nosi oznaku „bez četiri oka“, a konsultant dobija
                        obavještenje.
                      </span>
                    </label>
                  </>
                ) : (
                  !p?.fali && (
                    <div className="nc-napomena" style={{ gridColumn: "1 / -1" }}>
                      Posle upisa provjerava i zatvara {p?.drugoLice ? <b>{p.drugoLice}</b> : "drugo odgovorno lice"} (pravilo četiri oka) — dobija
                      obavještenje.
                    </div>
                  )
                )}
                <button className="primary-button" style={{ gridColumn: "1 / -1" }} onClick={rijesi}>
                  <Check size={14} /> {p?.fali ? "Upiši urađenu mjeru" : zatvaraOdmah ? "Upiši i zatvori" : "Upiši — šalji na provjeru"}
                </button>
              </div>
            ) : (
              <div className="form-grid">
                <label style={{ gridColumn: "1 / -1" }}>
                  Šta treba uraditi
                  <input placeholder="npr. očistiti i dezinfikovati komoru 2" value={opisMjere} onChange={(e) => setOpisMjere(e.target.value)} />
                </label>
                <label>
                  Kome
                  <select value={kome} onChange={(e) => setKome(e.target.value)}>
                    <option value="">— bez dodjele (radi odgovorno lice) —</option>
                    {izvrsioci.map((i) => <option key={i.id} value={i.id}>{i.ime} · {NAZIV_ULOGE[i.uloga]}</option>)}
                  </select>
                </label>
                <label>Rok<input type="date" min={lokalniDatum()} value={rok} onChange={(e) => setRok(e.target.value)} /></label>
                <button className="secondary-button" style={{ gridColumn: "1 / -1" }} onClick={dodijeli}>
                  Dodijeli mjeru
                </button>
              </div>
            )}
          </div>
        )}

        {vodiSistem && detalj.status === "CEKA_VERIFIKACIJU" && (
          <div className="nc-provjera">
            {p?.fali && (
              <div className="upozorenje-traka" style={{ marginBottom: 10, flexWrap: "wrap" }}>
                <span style={{ flex: "1 1 220px" }}>{p.fali}</span>
                {p.faliGdje && (
                  <button className="small-action" onClick={() => idiNa(p.faliGdje!)}>
                    {GDJE[p.faliGdje] ?? "Otvori"} <ArrowRight size={12} />
                  </button>
                )}
              </div>
            )}
            {cekaDrugog && (
              <div className="nc-napomena" style={{ marginBottom: 10 }}>
                Mjeru ste uradili vi — provjerava je {p?.drugoLice ? <b>{p.drugoLice}</b> : "drugo odgovorno lice"} (pravilo četiri oka). Ono je vidi
                pod „Čekaju moju provjeru“.
              </div>
            )}
            <input placeholder="Napomena o provjeri (šta ste pogledali)" value={napomena} onChange={(e) => setNapomena(e.target.value)} />
            {izuzetakMoguc && (
              <label style={{ display: "flex", flexDirection: "row", gap: 8, alignItems: "flex-start", fontSize: 11, margin: "8px 0", cursor: "pointer" }}>
                <input type="checkbox" checked={izuzetak} onChange={(e) => setIzuzetak(e.target.checked)} style={{ width: "auto", height: "auto", marginTop: 2 }} />
                <span>
                  U firmi nema drugog odgovornog lica — provjeru radim bez drugog lica. Zapis će nositi oznaku „bez četiri oka", a konsultant
                  dobija obavještenje. U napomeni upišite šta ste pregledali (najmanje 10 znakova).
                </span>
              </label>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="primary-button" disabled={cekaDrugog} onClick={() => provjeri("POTVRDJENO")}>
                Provjereno — zatvori
              </button>
              <button className="secondary-button" disabled={cekaDrugog} onClick={() => provjeri("ODBIJENO")}>
                Nije riješeno — vrati
              </button>
            </div>
          </div>
        )}

        {greska && (
          <div ref={greskaRef} className="auth-error" role="alert" style={{ marginTop: 12 }}>
            {greska}
          </div>
        )}
        {info && !greska && (
          <div className="nc-info" role="status" style={{ marginTop: 12 }}>
            {info}
          </div>
        )}

        {detalj.verifikacije.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: 12, marginBottom: 6 }}>Provjere</h3>
            {detalj.verifikacije.map((v) => (
              <p key={v.id} style={{ fontSize: 11, margin: "0 0 4px" }}>
                {v.rezultat === "POTVRDJENO" ? "✓ Potvrđeno" : "✗ Vraćeno"} — {v.verifikovao ?? ""}, {datum(v.verifikovano_at)}
                {v.napomena ? `: ${v.napomena}` : ""}
                {v.izuzetak_cetiri_oka && <span className="rok-oznaka istekao" style={{ marginLeft: 6 }}>bez četiri oka</span>}
              </p>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function NovaNcModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [opis, setOpis] = useState("");
  const [ozbiljnost, setOzbiljnost] = useState("SREDNJI");
  const [greska, setGreska] = useState("");
  const [naTelefonu, setNaTelefonu] = useState(false);
  const [kljuc] = useState(noviKljuc);

  const { radim, salji } = useSlanje();
  const posalji = async () => {
    try {
      // Problem se prijavljuje i bez mreže — sačuva se na telefonu i ode kad bude signala (#85).
      const u = await upisiIliSacuvaj("/neusaglasenosti", { opis, ozbiljnost }, { kljuc, opis: `Prijava problema: ${opis.trim().slice(0, 60)}` });
      if (!u.poslato) {
        setNaTelefonu(true);
        return;
      }
      onCreated();
      onClose();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Neusaglašenost nije sačuvana.");
    }
  };

  if (naTelefonu) return <SacuvanoNaTelefonu naslov="Prijavi problem" opis="Prijava problema" onClose={onClose} />;

  return (
    <Modal
      naslov="Prijavi problem"
      podnaslov="Odgovorno lice dobija obavještenje i određuje mjeru"
      onClose={onClose}
      greska={greska}
      footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={() => salji(posalji)} disabled={radim || opis.trim().length < 3}>Prijavi</button></>}
    >
      <div className="form-grid">
        <label style={{ gridColumn: "1 / -1" }}>
          Šta se desilo
          <textarea rows={3} value={opis} onChange={(e) => setOpis(e.target.value)} placeholder="npr. rashladna komora 2 pokazuje 9 °C, vrata ne dihtuju" />
        </label>
        <label>
          Koliko je ozbiljno
          <select value={ozbiljnost} onChange={(e) => setOzbiljnost(e.target.value)}>
            <option value="NIZAK">Nisko — može da sačeka</option>
            <option value="SREDNJI">Srednje — riješiti danas</option>
            <option value="VISOK">Visoko — roba ili ljudi u riziku</option>
          </select>
        </label>
      </div>
    </Modal>
  );
}
