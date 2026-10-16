import { useEffect, useState } from "react";
import { Plus, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, ApiGreska } from "../lib/api";
import { useSlanje, noviKljuc } from "../lib/slanje";
import { upisiIliSacuvaj, useIzlaz, IZLAZ_POSLAT } from "../lib/izlaz";
import { SacuvanoNaTelefonu } from "../components/VanMreze";
import { IzborTermometra, useIzborTermometra } from "../components/Termometar";
import { lokalniDatum } from "../lib/vrijeme";
import { PageHeader, Modal, ZakonskaOznaka, NaknadnoOznaka, VanMrezeOznaka } from "../components/Zajednicko";
import { StatusBadge } from "../components/StatusBadge";
import { useAuth } from "../lib/auth";
import { useSkladista, type Skladiste } from "../lib/skladista";

type Kupac = { id: string; naziv: string; telefon: string };
type Vozilo = { id: string; registarski_broj: string; status: string; temp_kontrolisano: boolean; d1_danas: string | null };
type Vozac = { id: string; ime: string };
type LotDostupan = {
  lot_id: string;
  artikal_naziv: string;
  broj_lota: string;
  kolicina: string;
  skladiste_id: string | null;
  rok_trajanja: string | null;
  /** Drže isporuke u pripremi (R-14); slobodno = kolicina − rezervisano. */
  rezervisano: string;
  slobodno: string;
};
type IsporukaRed = {
  id: string;
  broj: string;
  kupac_id: string;
  kupac_naziv: string;
  razlog_otkaza: string | null;
  datum_isporuke: string;
  status: string;
  vozilo_id: string | null;
  registarski_broj: string | null;
  vozac_korisnik_id: string | null;
  skladiste_id: string | null;
  skladiste_naziv: string | null;
  naknadno_dana: number;
  otvorena_odstupanja: number;
  potvrda_van_mreze?: boolean;
};
type StavkaIsporuke = {
  id: string;
  artikal_naziv: string;
  broj_lota: string;
  planirana_kolicina: string;
  isporucena_kolicina: string;
  temp_kontrolisano: boolean;
  temp_min: string | null;
  temp_max: string | null;
  granica_potvrdio: boolean;
};

function opisGranice(s: StavkaIsporuke) {
  if (s.temp_min !== null && s.temp_max !== null) return `${Number(s.temp_min)} do ${Number(s.temp_max)} °C`;
  if (s.temp_max !== null) return `najviše ${Number(s.temp_max)} °C`;
  if (s.temp_min !== null) return `najmanje ${Number(s.temp_min)} °C`;
  return null;
}

/** Samo za potvrđenu granicu (invarijanta #5) — nepotvrđena je pretpostavka, ne podatak klijenta. */
function vanGranice(s: StavkaIsporuke, unos: string) {
  if (!s.granica_potvrdio || unos.trim() === "") return false;
  const t = Number(unos);
  if (Number.isNaN(t)) return false;
  return (s.temp_min !== null && t < Number(s.temp_min)) || (s.temp_max !== null && t > Number(s.temp_max));
}

export function Isporuka() {
  const skladista = useSkladista();
  const [lista, setLista] = useState<IsporukaRed[]>([]);
  const [filterDatum, setFilterDatum] = useState("");
  const [filterVozilo, setFilterVozilo] = useState("");
  const [filterSkladiste, setFilterSkladiste] = useState("");
  const [kupci, setKupci] = useState<Kupac[]>([]);
  const [vozila, setVozila] = useState<Vozilo[]>([]);
  const [vozaci, setVozaci] = useState<Vozac[]>([]);
  const [zaliha, setZaliha] = useState<LotDostupan[]>([]);
  const [modalNova, setModalNova] = useState(false);
  const [modalIzmjena, setModalIzmjena] = useState<{ isporuka: IsporukaRed; stavke: StavkaIsporuke[] } | null>(null);
  const [modalPotvrda, setModalPotvrda] = useState<IsporukaRed | null>(null);
  const [stavke, setStavke] = useState<StavkaIsporuke[]>([]);
  const [modalOdstupanje, setModalOdstupanje] = useState<IsporukaRed | null>(null);
  const [modalOtkaz, setModalOtkaz] = useState<IsporukaRed | null>(null);
  const [poruka, setPoruka] = useState("");
  const navigate = useNavigate();
  const { korisnik } = useAuth();
  const izlaz = useIzlaz();
  // Otkazuje magacioner (svoju) i vodstvo; vozač ne — kupac koji odbije robu je potvrda sa 0 (R-15).
  const mozeOtkazati = korisnik?.uloga !== "vozac";

  const ucitaj = () => {
    api<IsporukaRed[]>("/isporuke").then((l) => {
      setLista(l);
      // Vozač kreće na teren: detalji isporuka u pripremi se učitaju dok ima mreže, pa se predaja
      // može upisati i u podrumu kupca (#85) — service worker čuva posljednji odgovor.
      if (navigator.onLine) {
        for (const i of l.filter((x) => x.status === "U_PRIPREMI").slice(0, 25)) api(`/isporuke/${i.id}`).catch(() => undefined);
      }
    });
    api<LotDostupan[]>("/zaliha").then(setZaliha);
  };
  useEffect(() => {
    ucitaj();
    api<Kupac[]>("/kupci").then(setKupci);
    api<Vozilo[]>("/vozila").then(setVozila);
    api<Vozac[]>("/vozaci").then(setVozaci);
    // Predaja koja je čekala na telefonu je stigla — status isporuke se mijenja.
    window.addEventListener(IZLAZ_POSLAT, ucitaj);
    return () => window.removeEventListener(IZLAZ_POSLAT, ucitaj);
  }, []);

  const imeVozaca = (id: string | null) => vozaci.find((v) => v.id === id)?.ime ?? "—";

  // Filteri su na listi koju je server već ograničio po ulozi (vozač: svoje isporuke, prozor od
  // jednog dana unazad + sve unaprijed) — ovdje se samo sužava prikaz.
  const prikazano = lista.filter(
    (i) =>
      (!filterDatum || i.datum_isporuke === filterDatum) &&
      (!filterVozilo || (filterVozilo === "bez" ? !i.vozilo_id : i.vozilo_id === filterVozilo)) &&
      (!filterSkladiste || i.skladiste_id === filterSkladiste),
  );
  const imaFiltera = filterDatum || filterVozilo || filterSkladiste;

  const otvoriPotvrdu = async (i: IsporukaRed) => {
    setPoruka("");
    try {
      const detalj = await api<{ stavke: StavkaIsporuke[] }>(`/isporuke/${i.id}`);
      setStavke(detalj.stavke);
      setModalPotvrda(i);
    } catch (e) {
      setPoruka(
        e instanceof ApiGreska && e.status === 0
          ? `Stavke isporuke ${i.broj} nisu sačuvane na ovom telefonu — otvorite stranu Isporuka jednom dok ima signala, pa predaja radi i bez njega.`
          : e instanceof ApiGreska ? e.message : "Isporuka se nije otvorila.",
      );
    }
  };

  const otvoriIzmjenu = async (i: IsporukaRed) => {
    const detalj = await api<{ stavke: StavkaIsporuke[] }>(`/isporuke/${i.id}`);
    setModalIzmjena({ isporuka: i, stavke: detalj.stavke });
  };

  return (
    <>
      <PageHeader
        title="Isporuka"
        description={<>Isporuka je vezana za konkretan lot — tako sledljivost ostaje do kupca <ZakonskaOznaka clan="27" />.</>}
        action={
          <button className="primary-button" onClick={() => setModalNova(true)}>
            <Plus size={16} /> Nova isporuka
          </button>
        }
      />
      <div className="filter-bar">
        <label>
          Datum
          <input type="date" value={filterDatum} onChange={(e) => setFilterDatum(e.target.value)} />
        </label>
        <button className={`small-action${filterDatum === lokalniDatum() ? " selected" : ""}`} onClick={() => setFilterDatum(lokalniDatum())}>Danas</button>
        <label>
          Vozilo
          <select value={filterVozilo} onChange={(e) => setFilterVozilo(e.target.value)}>
            <option value="">Sva vozila</option>
            {vozila.map((v) => <option key={v.id} value={v.id}>{v.registarski_broj}</option>)}
            <option value="bez">Bez vozila</option>
          </select>
        </label>
        {skladista.vise && (
          <label>
            Magacin
            <select value={filterSkladiste} onChange={(e) => setFilterSkladiste(e.target.value)}>
              <option value="">Svi magacini</option>
              {skladista.sva.map((sk) => <option key={sk.id} value={sk.id}>{sk.naziv}</option>)}
            </select>
          </label>
        )}
        {imaFiltera && (
          <button className="link-button" onClick={() => { setFilterDatum(""); setFilterVozilo(""); setFilterSkladiste(""); }}>
            Poništi filtere
          </button>
        )}
        <span className="filter-broj">{prikazano.length} od {lista.length}</span>
      </div>
      {poruka && <div className="upozorenje-traka" role="alert">{poruka}</div>}
      <div className="panel full-panel">
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Broj</th>
                <th>Kupac</th>
                {skladista.vise && <th>Magacin</th>}
                <th>Vozilo</th>
                <th>Vozač</th>
                <th>Datum</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {prikazano.length === 0 && (
                <tr><td colSpan={8} className="muted-text" style={{ padding: 20 }}>{imaFiltera ? "Nema isporuka za izabrane filtere." : "Nema isporuka."}</td></tr>
              )}
              {prikazano.map((i) => (
                <tr key={i.id}>
                  <td>{i.broj}</td>
                  <td>{i.kupac_naziv}</td>
                  {skladista.vise && <td className="muted-text">{i.skladiste_naziv ?? "—"}</td>}
                  <td className="muted-text">{i.registarski_broj ?? "—"}</td>
                  <td className="muted-text">{imeVozaca(i.vozac_korisnik_id)}</td>
                  <td className="muted-text">{i.datum_isporuke}<NaknadnoOznaka dana={i.naknadno_dana} /></td>
                  <td>
                    <StatusBadge status={i.status} />
                    <VanMrezeOznaka da={i.potvrda_van_mreze} />
                    {i.status === "OTKAZANA" && i.razlog_otkaza && <div className="muted-text" style={{ fontSize: 10 }}>{i.razlog_otkaza}</div>}
                    {i.otvorena_odstupanja > 0 && (
                      <button className="odstupanje-oznaka" onClick={() => navigate("/neusaglasenosti")} title="Otvorena odstupanja na ovoj isporuci">
                        <AlertTriangle size={11} /> {i.otvorena_odstupanja}
                      </button>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      {/* Predaja upisana bez mreže čeka na telefonu — ne potvrđuje se dvaput (#85). */}
                      {i.status === "U_PRIPREMI" && izlaz.ceka(`isporuka:${i.id}`) && <span className="ceka-mrezu">Predaja je na telefonu — čeka mrežu</span>}
                      {i.status === "U_PRIPREMI" && !izlaz.ceka(`isporuka:${i.id}`) && izlaz.upravoPoslato(`isporuka:${i.id}`) && <span className="ceka-mrezu">Predaja poslata</span>}
                      {i.status === "U_PRIPREMI" && !izlaz.ceka(`isporuka:${i.id}`) && !izlaz.upravoPoslato(`isporuka:${i.id}`) && (
                        <>
                          <button className="small-action" onClick={() => otvoriIzmjenu(i)}>Izmijeni</button>
                          <button className="small-action" onClick={() => otvoriPotvrdu(i)}>Potvrdi</button>
                          {mozeOtkazati && <button className="small-action" onClick={() => setModalOtkaz(i)}>Otkaži</button>}
                        </>
                      )}
                      {i.status !== "OTKAZANA" && (
                        <button className="small-action" onClick={() => window.open(`/isporuka/${i.id}/otpremnica`, "_blank")} title="Otpremnica za štampu — ide uz robu">
                          Otpremnica
                        </button>
                      )}
                      <button className="small-action odstupanje-dugme" onClick={() => setModalOdstupanje(i)} title="Prijavi odstupanje na ovoj isporuci">
                        <AlertTriangle size={12} /> Problem
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modalNova && (
        <IsporukaFormaModal
          kupci={kupci}
          vozila={vozila}
          vozaci={vozaci}
          zaliha={zaliha}
          skladista={skladista.vise ? skladista.aktivna : []}
          podrazumijevanoSkladiste={skladista.podrazumijevano}
          onClose={() => setModalNova(false)}
          onSacuvano={ucitaj}
        />
      )}
      {modalIzmjena && (
        <IsporukaFormaModal
          postojeca={modalIzmjena.isporuka}
          postojeceStavke={modalIzmjena.stavke}
          kupci={kupci}
          vozila={vozila}
          vozaci={vozaci}
          zaliha={zaliha}
          skladista={skladista.vise ? skladista.aktivna : []}
          podrazumijevanoSkladiste={skladista.podrazumijevano}
          onClose={() => setModalIzmjena(null)}
          onSacuvano={ucitaj}
        />
      )}
      {modalOdstupanje && <OdstupanjeModal isporuka={modalOdstupanje} onClose={() => setModalOdstupanje(null)} onSacuvano={ucitaj} />}
      {modalOtkaz && <OtkazModal isporuka={modalOtkaz} onClose={() => setModalOtkaz(null)} onSacuvano={ucitaj} />}
      {modalPotvrda && (
        <PotvrdaModal isporuka={modalPotvrda} stavke={stavke} onClose={() => setModalPotvrda(null)} onCreated={ucitaj} />
      )}
    </>
  );
}

type NovaStavkaRed = { lotId: string; kolicina: string };

function IsporukaFormaModal({
  postojeca,
  postojeceStavke,
  kupci,
  vozila,
  vozaci,
  zaliha,
  skladista,
  podrazumijevanoSkladiste,
  onClose,
  onSacuvano,
}: {
  postojeca?: IsporukaRed;
  postojeceStavke?: StavkaIsporuke[];
  kupci: Kupac[];
  vozila: Vozilo[];
  vozaci: Vozac[];
  zaliha: LotDostupan[];
  /** Prazno kad firma ima jedno skladište — tada se polje ne prikazuje. */
  skladista: Skladiste[];
  podrazumijevanoSkladiste: string;
  onClose: () => void;
  onSacuvano: () => void;
}) {
  const { korisnik } = useAuth();
  const izmjena = !!postojeca;
  const [kupacId, setKupacId] = useState(postojeca?.kupac_id ?? kupci[0]?.id ?? "");
  // Podrazumijevano prvo SPREMNO vozilo — nespremno bi server ionako odbio.
  const [vozilId, setVozilId] = useState(
    postojeca ? (vozila.find((v) => v.registarski_broj === postojeca.registarski_broj)?.id ?? "") : (vozila.find((v) => v.status === "SPREMNO")?.id ?? ""),
  );
  const [vozacId, setVozacId] = useState(postojeca ? (postojeca.vozac_korisnik_id ?? "") : korisnik?.uloga === "vozac" ? korisnik.id : "");
  const [datum, setDatum] = useState(postojeca?.datum_isporuke ?? lokalniDatum());
  // Magacin sa slobodnom robom koja nije istekla. Matični magacin naloga bez robe nije dobar početak:
  // magacioneru sa praznim matičnim magacinom forma je nudila samo „nema robe“ i sivo „Sačuvaj“ (02.10.2026).
  const imaRobe = (id: string) =>
    zaliha.some((z) => (!z.skladiste_id || z.skladiste_id === id) && Number(z.slobodno) > 0 && !(z.rok_trajanja && z.rok_trajanja.slice(0, 10) < lokalniDatum()));
  const [skladisteId, setSkladisteId] = useState(
    postojeca?.skladiste_id ??
      (skladista.length === 0 || imaRobe(podrazumijevanoSkladiste) ? podrazumijevanoSkladiste : skladista.find((s) => imaRobe(s.id))?.id ?? podrazumijevanoSkladiste),
  );
  const izabranoNemaRobe = skladista.length > 0 && !!skladisteId && !imaRobe(skladisteId);
  const sRobom = skladista.filter((s) => s.id !== skladisteId && imaRobe(s.id));
  // Roba se isporučuje iz magacina u kom stoji — nude se samo lotovi izabranog skladišta.
  const lotoviSkladista = zaliha.filter((z) => !skladisteId || !z.skladiste_id || z.skladiste_id === skladisteId);
  const [redovi, setRedovi] = useState<NovaStavkaRed[]>(
    postojeceStavke && postojeceStavke.length > 0
      ? postojeceStavke.map((s) => ({ lotId: zaliha.find((z) => z.broj_lota === s.broj_lota)?.lot_id ?? "", kolicina: s.planirana_kolicina }))
      : [{ lotId: lotoviSkladista.find((z) => !z.rok_trajanja || z.rok_trajanja.slice(0, 10) >= lokalniDatum())?.lot_id ?? "", kolicina: "" }],
  );
  const [greska, setGreska] = useState("");
  // Slobodno = na zalihi − rezervisano za isporuke u pripremi (R-14). U izmjeni se ovoj isporuci
  // vraća ono što ona sama drži — inače bi sopstvena količina izgledala zauzeta.
  const svoje = (z: LotDostupan) => (postojeceStavke ?? []).filter((s) => s.broj_lota === z.broj_lota).reduce((n, s) => n + Number(s.planirana_kolicina), 0);
  const slobodno = (z: LotDostupan) => Number(z.slobodno) + svoje(z);

  const promijeniSkladiste = (id: string) => {
    setSkladisteId(id);
    const dostupni = zaliha.filter((z) => !z.skladiste_id || z.skladiste_id === id);
    setRedovi((r) => r.map((red) => (dostupni.some((z) => z.lot_id === red.lotId) ? red : { ...red, lotId: dostupni[0]?.lot_id ?? "" })));
  };

  const dodajRed = () => setRedovi((r) => [...r, { lotId: lotoviSkladista[0]?.lot_id ?? "", kolicina: "" }]);
  const ukloniRed = (i: number) => setRedovi((r) => r.filter((_, idx) => idx !== i));
  const azurirajRed = (i: number, izm: Partial<NovaStavkaRed>) => setRedovi((r) => r.map((red, idx) => (idx === i ? { ...red, ...izm } : red)));

  // Isti ključ dok je forma otvorena — server drugi upis sa njim ne pravi (R-10).
  const [kljuc] = useState(noviKljuc);
  const { radim, salji } = useSlanje();
  const posalji = async () => {
    try {
      const telo = {
        kupacId,
        skladisteId: skladisteId || undefined,
        vozilId: vozilId || undefined,
        vozacKorisnikId: vozacId || undefined,
        datumIsporuke: datum,
        stavke: redovi.map((r) => ({ lotId: r.lotId, planiranaKolicina: Number(r.kolicina) })),
      };
      if (izmjena) {
        await api(`/isporuke/${postojeca!.id}`, { method: "PATCH", telo: { kupacId: telo.kupacId, skladisteId: telo.skladisteId, vozilId: telo.vozilId, vozacKorisnikId: telo.vozacKorisnikId, datumIsporuke: telo.datumIsporuke, stavke: telo.stavke } });
      } else {
        await api("/isporuke", { telo, kljuc });
      }
      onSacuvano();
      onClose();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Isporuka nije sačuvana.");
    }
  };

  // „Sačuvaj“ nije sivo bez objašnjenja (#74): klik kad nešto fali kaže ŠTA fali, uz dugme.
  const fali = (() => {
    const f: string[] = [];
    if (!izmjena && !kupacId) f.push("kupac");
    if (!datum) f.push("datum isporuke");
    if (redovi.length === 0) f.push("bar jedan artikal");
    redovi.forEach((r, i) => {
      const n = redovi.length > 1 ? `stavka ${i + 1}: ` : "";
      const lot = zaliha.find((z) => z.lot_id === r.lotId);
      if (!r.lotId) f.push(`${n}artikal / lot${izabranoNemaRobe ? " (u izabranom magacinu nema robe — promijenite magacin)" : ""}`);
      else if (!(Number(r.kolicina) > 0)) f.push(`${n}količina`);
      else if (lot && Number(r.kolicina) > slobodno(lot)) f.push(`${n}količina je veća od slobodne (${slobodno(lot)})`);
    });
    return f;
  })();
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
      naslov={izmjena ? `Izmjena isporuke ${postojeca!.broj}` : "Nova isporuka"}
      podnaslov="Jedan kupac, više artikala u istoj isporuci"
      onClose={onClose}
      greska={greska}
      footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={sacuvaj} disabled={radim}>Sačuvaj</button></>}
    >
      <div className="form-grid">
        <label>
          Kupac
          <select value={kupacId} onChange={(e) => setKupacId(e.target.value)}>
            {kupci.map((k) => <option key={k.id} value={k.id}>{k.naziv}</option>)}
          </select>
        </label>
        {skladista.length > 0 && (
          <label>
            Iz magacina
            <select value={skladisteId} onChange={(e) => promijeniSkladiste(e.target.value)}>
              {skladista.map((sk) => <option key={sk.id} value={sk.id}>{sk.naziv}{imaRobe(sk.id) ? "" : " — nema slobodne robe"}</option>)}
            </select>
            {izabranoNemaRobe && (
              <small className="danas-fali" style={{ fontWeight: 600 }}>
                U ovom magacinu nema slobodne robe.
                {sRobom.length > 0 && (
                  <>
                    {" "}Roba je u:{" "}
                    {sRobom.map((s, i) => (
                      <span key={s.id}>
                        {i > 0 && ", "}
                        <button type="button" className="link-button" style={{ padding: 0, fontSize: "inherit" }} onClick={() => promijeniSkladiste(s.id)}>{s.naziv}</button>
                      </span>
                    ))}
                  </>
                )}
              </small>
            )}
          </label>
        )}
        <label>
          Vozilo
          <select value={vozilId} onChange={(e) => setVozilId(e.target.value)}>
            <option value="">— bez vozila —</option>
            {vozila.map((v) => (
              <option key={v.id} value={v.id} disabled={v.status !== "SPREMNO"}>
                {v.registarski_broj}{v.temp_kontrolisano ? " · rashladno" : ""}
                {v.status !== "SPREMNO" ? " (nije spremno — pala kontrola)" : v.d1_danas === "PROSAO" ? " · D1 danas u redu" : " · D1 za danas još nije urađena"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Vozač
          <select value={vozacId} onChange={(e) => setVozacId(e.target.value)}>
            <option value="">— nije dodijeljen —</option>
            {vozaci.map((v) => <option key={v.id} value={v.id}>{v.ime}</option>)}
          </select>
        </label>
        <label>Datum isporuke<input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} /></label>
      </div>
      <div style={{ padding: "0 20px" }}>
        {redovi.map((red, i) => (
          <div key={i} className="form-grid stavka-red" style={{ padding: "10px 0", borderTop: "1px solid #edf1f3" }}>
            <label>
              Artikal / lot <ZakonskaOznaka clan="27" />
              <select value={red.lotId} onChange={(e) => azurirajRed(i, { lotId: e.target.value })}>
                {lotoviSkladista.length === 0 && <option value="">— u ovom magacinu nema robe na zalihi —</option>}
                {lotoviSkladista.map((z) => {
                  const istekao = !!z.rok_trajanja && z.rok_trajanja.slice(0, 10) < lokalniDatum();
                  const s = slobodno(z);
                  const rez = Number(z.kolicina) - s;
                  return (
                    <option key={z.lot_id} value={z.lot_id} disabled={istekao || (s <= 0 && z.lot_id !== red.lotId)}>
                      {z.artikal_naziv} · {z.broj_lota} (slobodno {s}{rez > 0 ? `, rezervisano ${rez}` : ""})
                      {istekao ? " — ISTEKAO ROK, ne isporučuje se" : s <= 0 ? " — sve je rezervisano" : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            <label>
              Količina
              <input type="number" value={red.kolicina} onChange={(e) => azurirajRed(i, { kolicina: e.target.value })} style={{ width: 90 }} />
              {(() => {
                const lot = zaliha.find((z) => z.lot_id === red.lotId);
                return lot && Number(red.kolicina) > slobodno(lot) ? <small style={{ color: "#c34e55" }}>Slobodno je samo {slobodno(lot)}.</small> : null;
              })()}
            </label>
            {redovi.length > 1 && (
              <button type="button" className="row-action" style={{ alignSelf: "end", marginBottom: 1 }} onClick={() => ukloniRed(i)}>
                ✕
              </button>
            )}
          </div>
        ))}
        <button className="link-button" onClick={dodajRed} style={{ marginTop: 8 }}>
          <Plus size={14} /> Dodaj artikal
        </button>
      </div>
    </Modal>
  );
}

function PotvrdaModal({ isporuka, stavke, onClose, onCreated }: { isporuka: IsporukaRed; stavke: StavkaIsporuke[]; onClose: () => void; onCreated: () => void }) {
  const [vrijednosti, setVrijednosti] = useState<Record<string, { isporuceno: string; odbijeno: string; razlog: string; temperatura: string }>>(
    Object.fromEntries(stavke.map((s) => [s.id, { isporuceno: s.planirana_kolicina, odbijeno: "0", razlog: "", temperatura: "" }])),
  );
  const [greska, setGreska] = useState("");
  const [brojVanGranice, setBrojVanGranice] = useState<number | null>(null);
  const [uKarantin, setUKarantin] = useState(0);
  const [naTelefonu, setNaTelefonu] = useState(false);
  const [kljuc] = useState(noviKljuc);
  // Kojim termometrom je izmjereno kod kupca (R-23) — kad termometar padne na provjeri, zna se šta pregledati.
  const { termometri, termometarId, setTermometarId } = useIzborTermometra();
  const imaTemperatura = stavke.some((s) => s.temp_kontrolisano);

  const postavi = (id: string, polje: "isporuceno" | "odbijeno" | "razlog" | "temperatura", vrijednost: string) =>
    setVrijednosti((v) => ({ ...v, [id]: { ...v[id], [polje]: vrijednost } }));

  // Jedna temperatura po grupi robe istog režima (R-37): vozač mjeri gajbu jogurta i mlijeka jednom,
  // ne deset puta. Ko hoće — „Različito po stavci". Server i dalje dobija temperaturu po stavci.
  const kljucGrupe = (s: StavkaIsporuke) => `${s.temp_min ?? ""}|${s.temp_max ?? ""}`;
  const grupe = Array.from(new Set(stavke.filter((s) => s.temp_kontrolisano).map(kljucGrupe))).map((k) => ({
    kljuc: k,
    stavke: stavke.filter((s) => s.temp_kontrolisano && kljucGrupe(s) === k),
  }));
  const [poStavci, setPoStavci] = useState(false);
  const [tempGrupe, setTempGrupe] = useState<Record<string, string>>({});
  const temperatura = (s: StavkaIsporuke) => (poStavci ? vrijednosti[s.id].temperatura : tempGrupe[kljucGrupe(s)] ?? "");

  // Isto pravilo kao na serveru: roba pod temperaturnim režimom koja se predaje mora imati temperaturu.
  const faliTemperatura = stavke.some((s) => s.temp_kontrolisano && Number(vrijednosti[s.id].isporuceno) > 0 && temperatura(s).trim() === "");

  const { radim, salji } = useSlanje();
  const posalji = async () => {
    try {
      // Predaja u podrumu kupca, bez signala: čuva se na telefonu sa vremenom predaje (#85). Server je pri
      // slanju ponovo provjerava (lot, rok, zaliha, D1 tog dana) — ako je odbije, javlja se odgovornom licu.
      const u = await upisiIliSacuvaj<{ status: string; vanGranice: number; uKarantin: number }>(
        `/isporuke/${isporuka.id}/potvrda`,
        {
          stavke: stavke.map((s) => ({
            stavkaId: s.id,
            isporucenaKolicina: Number(vrijednosti[s.id].isporuceno),
            odbijenaKolicina: Number(vrijednosti[s.id].odbijeno || 0),
            razlogOdbijanja: vrijednosti[s.id].razlog || undefined,
            temperaturaPredaje: s.temp_kontrolisano && temperatura(s).trim() !== "" ? Number(temperatura(s)) : null,
          })),
          mjerniUredjajId: termometarId || null,
        },
        { kljuc, opis: `Predaja ${isporuka.broj} — ${isporuka.kupac_naziv}`, vezano: `isporuka:${isporuka.id}` },
      );
      if (!u.poslato) {
        setNaTelefonu(true);
        return;
      }
      const rezultat = u.rezultat;
      onCreated();
      if (rezultat.vanGranice > 0 || rezultat.uKarantin > 0) {
        setUKarantin(rezultat.uKarantin);
        setBrojVanGranice(rezultat.vanGranice);
      } else onClose();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Potvrda nije sačuvana.");
    }
  };

  if (naTelefonu) return <SacuvanoNaTelefonu naslov={`Potvrda isporuke ${isporuka.broj}`} opis={`Predaja ${isporuka.broj}`} onClose={onClose} />;

  if (brojVanGranice !== null) {
    return (
      <Modal naslov={`Isporuka ${isporuka.broj} potvrđena`} onClose={onClose} footer={<button className="primary-button" onClick={onClose}>Zatvori</button>}>
        <div style={{ padding: 20 }}>
          {brojVanGranice > 0 && (
            <>
              <StatusBadge status="FAIL" />
              <p style={{ marginTop: 10, fontSize: 12, color: "#c34e55" }}>
                {brojVanGranice === 1 ? "Jedna stavka je predata" : `${brojVanGranice} stavke su predate`} van temperaturne granice. Otvorena je
                neusaglašenost i obaviješteno je odgovorno lice. Lot u magacinu se ne zadržava — problem je nastao u prevozu.
              </p>
            </>
          )}
          {uKarantin > 0 && (
            <p style={{ marginTop: 10, fontSize: 12 }}>
              Nepredata roba ({uKarantin}) vraćena je u <b>karantin</b> — ne ide nazad u prodaju dok je odgovorno lice ne pregleda.
              Vratite je u magacin odvojeno od ostale robe.
            </p>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      naslov={`Potvrda isporuke ${isporuka.broj}`}
      onClose={onClose}
      greska={greska}
      footer={
        <>
          <button className="secondary-button" onClick={onClose}>Otkaži</button>
          <button className="primary-button" onClick={() => salji(posalji)} disabled={radim || faliTemperatura} title={faliTemperatura ? "Upišite temperaturu pri predaji" : undefined}>Potvrdi</button>
        </>
      }
    >
      <div style={{ padding: 20 }}>
        {grupe.length > 0 && !poStavci && (
          <div style={{ borderBottom: "1px solid #edf1f3", paddingBottom: 12, marginBottom: 12 }}>
            {grupe.map((g) => {
              const granica = opisGranice(g.stavke[0]);
              const unos = tempGrupe[g.kljuc] ?? "";
              return (
                <label key={g.kljuc} className="temp-predaje" style={{ display: "block", marginBottom: 8 }}>
                  <span>
                    Temperatura pri predaji (°C) <ZakonskaOznaka clan="36" />{" "}
                    {granica && <span className="temp-granica">granica {granica}</span>}
                    <span className="muted-text" style={{ display: "block", fontSize: 10 }}>{g.stavke.map((s) => s.artikal_naziv).join(", ")}</span>
                  </span>
                  <input type="number" step="0.1" inputMode="decimal" value={unos} onChange={(e) => setTempGrupe((tg) => ({ ...tg, [g.kljuc]: e.target.value }))} placeholder="izmjereno kod kupca" />
                  {g.stavke.some((s) => vanGranice(s, unos)) && <span className="temp-upozorenje">Van granice — kupac smije odbiti robu. Upišite odbijenu količinu i razlog.</span>}
                </label>
              );
            })}
            <button className="link-button" onClick={() => setPoStavci(true)}>Različita temperatura po stavci</button>
          </div>
        )}
        {stavke.map((s) => {
          const v = vrijednosti[s.id];
          const granica = opisGranice(s);
          return (
            <div key={s.id} style={{ borderBottom: "1px solid #edf1f3", paddingBottom: 12, marginBottom: 12 }}>
              <strong style={{ fontSize: 11 }}>{s.artikal_naziv} · {s.broj_lota} (planirano {s.planirana_kolicina})</strong>
              <div className="form-grid" style={{ padding: "10px 0 0" }}>
                <label>Isporučeno<input type="number" value={v.isporuceno} onChange={(e) => postavi(s.id, "isporuceno", e.target.value)} /></label>
                <label>Odbijeno<input type="number" value={v.odbijeno} onChange={(e) => postavi(s.id, "odbijeno", e.target.value)} /></label>
                {s.temp_kontrolisano && poStavci && (
                  <label className="temp-predaje" style={{ gridColumn: "1 / -1" }}>
                    <span>
                      Temperatura pri predaji (°C) <ZakonskaOznaka clan="36" />{" "}
                      {granica && <span className="temp-granica">granica {granica}{s.granica_potvrdio ? "" : " — nije potvrđena, ne ocjenjuje se"}</span>}
                    </span>
                    <input type="number" step="0.1" inputMode="decimal" value={v.temperatura} onChange={(e) => postavi(s.id, "temperatura", e.target.value)} placeholder="izmjereno kod kupca" />
                    {vanGranice(s, v.temperatura) && (
                      <span className="temp-upozorenje">Van granice — kupac smije odbiti robu. Upišite odbijenu količinu i razlog.</span>
                    )}
                  </label>
                )}
                <label style={{ gridColumn: "1 / -1" }}>Razlog odbijanja (ako ima)<input value={v.razlog} onChange={(e) => postavi(s.id, "razlog", e.target.value)} /></label>
              </div>
            </div>
          );
        })}
        {imaTemperatura && termometri.length > 0 && (
          <div className="form-grid" style={{ padding: "0 0 10px" }}>
            <IzborTermometra termometri={termometri} value={termometarId} onChange={setTermometarId} />
          </div>
        )}
        {faliTemperatura && <p style={{ fontSize: 10, color: "#8d9ba5", margin: 0 }}>Za robu pod temperaturnim režimom upišite temperaturu pri predaji — to je dokaz da je hladni lanac održan do kupca.</p>}
      </div>
    </Modal>
  );
}

// Vrste koje se u praksi javljaju na isporuci. Potvrđena isporuka se NE prepravlja (invarijanta #1) —
// odstupanje je nov zapis vezan za nju, pa inspektor vidi i šta je bilo i šta je urađeno.
const VRSTE_ODSTUPANJA = [
  "Kupac odbio robu",
  "Oštećena roba ili ambalaža",
  "Pogrešna količina ili artikal",
  "Temperatura pri predaji",
  "Reklamacija kupca poslije isporuke",
  "Kašnjenje isporuke",
  "Drugo",
];

function OdstupanjeModal({ isporuka, onClose, onSacuvano }: { isporuka: IsporukaRed; onClose: () => void; onSacuvano: () => void }) {
  const [vrsta, setVrsta] = useState(VRSTE_ODSTUPANJA[0]);
  const [opis, setOpis] = useState("");
  const [ozbiljnost, setOzbiljnost] = useState("SREDNJI");
  const [greska, setGreska] = useState("");
  const [poslato, setPoslato] = useState<string | null>(null);
  const [naTelefonu, setNaTelefonu] = useState(false);
  const [kljuc] = useState(noviKljuc);

  const { radim, salji } = useSlanje();
  const posalji = async () => {
    try {
      const u = await upisiIliSacuvaj<{ broj: string }>(
        "/neusaglasenosti",
        { opis: `${vrsta}: ${opis.trim()}`, ozbiljnost, izvorTip: "isporuka", izvorId: isporuka.id },
        { kljuc, opis: `Problem na isporuci ${isporuka.broj}: ${vrsta}` },
      );
      if (!u.poslato) {
        setNaTelefonu(true);
        return;
      }
      setPoslato(u.rezultat.broj);
      onSacuvano();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Odstupanje nije sačuvano.");
    }
  };

  if (naTelefonu) return <SacuvanoNaTelefonu naslov={`Problem na isporuci ${isporuka.broj}`} opis="Prijava problema" onClose={onClose} />;

  if (poslato) {
    return (
      <Modal naslov="Odstupanje prijavljeno" onClose={onClose} footer={<button className="primary-button" onClick={onClose}>Zatvori</button>}>
        <div style={{ padding: 20, fontSize: 12 }}>
          Upisano kao <strong>{poslato}</strong>, vezano za isporuku {isporuka.broj}. Odgovorno lice je dobilo obavještenje i određuje mjeru —
          prati se na strani Neusaglašenosti.
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      naslov={`Problem na isporuci ${isporuka.broj}`}
      podnaslov={isporuka.kupac_naziv}
      onClose={onClose}
      greska={greska}
      footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={() => salji(posalji)} disabled={radim || opis.trim().length < 3}>Prijavi</button></>}
    >
      <div className="form-grid">
        <label style={{ gridColumn: "1 / -1" }}>
          Šta se desilo
          <select value={vrsta} onChange={(e) => setVrsta(e.target.value)}>
            {VRSTE_ODSTUPANJA.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Opis
          <textarea rows={3} value={opis} onChange={(e) => setOpis(e.target.value)} placeholder="npr. 2 kom jogurta oštećena pri istovaru, kupac ih nije primio" />
        </label>
        <label>
          Koliko je ozbiljno
          <select value={ozbiljnost} onChange={(e) => setOzbiljnost(e.target.value)}>
            <option value="NIZAK">Nisko</option>
            <option value="SREDNJI">Srednje</option>
            <option value="VISOK">Visoko — bezbjednost hrane</option>
          </select>
        </label>
        <p className="muted-text" style={{ gridColumn: "1 / -1", fontSize: 10, margin: 0 }}>
          {isporuka.status === "U_PRIPREMI"
            ? "Isporuka još nije potvrđena — pogrešnu količinu ili artikal ispravite dugmetom „Izmijeni“. Ovdje prijavite ono što treba da vidi odgovorno lice."
            : "Potvrđena isporuka se ne prepravlja — ispravka ide kao ovaj zapis, vezan za isporuku, da ostane trag šta je bilo i šta je urađeno."}
        </p>
      </div>
    </Modal>
  );
}

/** Otkaz isporuke prije predaje (R-15): uz razlog; rezervisana roba se oslobađa. */
function OtkazModal({ isporuka, onClose, onSacuvano }: { isporuka: IsporukaRed; onClose: () => void; onSacuvano: () => void }) {
  const [razlog, setRazlog] = useState("");
  const [greska, setGreska] = useState("");
  const { radim, salji } = useSlanje();
  const posalji = async () => {
    try {
      await api(`/isporuke/${isporuka.id}/otkaz`, { telo: { razlog: razlog.trim() } });
      onSacuvano();
      onClose();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Isporuka nije otkazana.");
    }
  };
  return (
    <Modal
      naslov={`Otkaz isporuke ${isporuka.broj}`}
      podnaslov={`${isporuka.kupac_naziv} · ${isporuka.datum_isporuke}`}
      onClose={onClose}
      greska={greska}
      footer={<><button className="secondary-button" onClick={onClose}>Nazad</button><button className="primary-button" onClick={() => salji(posalji)} disabled={radim || razlog.trim().length < 5}>Otkaži isporuku</button></>}
    >
      <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
        <p className="muted-text" style={{ fontSize: 11, margin: 0 }}>
          Isporuka ostaje zapisana kao otkazana, a roba koju je držala ponovo je slobodna. Ako je kupac odbio robu na licu mjesta, to nije
          otkaz — potvrdite isporuku sa 0 i razlogom.
        </p>
        <label>
          Razlog otkaza
          <input value={razlog} onChange={(e) => setRazlog(e.target.value)} placeholder="npr. kupac otkazao narudžbu telefonom" />
        </label>
      </div>
    </Modal>
  );
}
