import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Plus, Thermometer, ClipboardList, AlertTriangle } from "lucide-react";
import { api, ApiGreska } from "../lib/api";
import { useSlanje, noviKljuc } from "../lib/slanje";
import { upisiIliSacuvaj, IZLAZ_POSLAT } from "../lib/izlaz";
import { SacuvanoNaTelefonu } from "../components/VanMreze";
import { lokalniDatum } from "../lib/vrijeme";
import { PageHeader, Modal, ZakonskaOznaka, NaknadnoOznaka, VanMrezeOznaka } from "../components/Zajednicko";
import { StatusBadge } from "../components/StatusBadge";
import { IzborTermometra, useIzborTermometra } from "../components/Termometar";
import { useAuth } from "../lib/auth";
import { useSkladista } from "../lib/skladista";

type KontrolnaTacka = { id: string; sifra: string; naziv: string };
type Mjerenje = {
  id: string;
  kontrolna_tacka_naziv: string;
  broj_lota: string | null;
  vrijednost: string;
  izmjereno_at: string;
  rezultat: string;
  izmjerio: string | null;
  termometar: string | null;
  termometar_oznaka: string | null;
  upitno: boolean;
  van_mreze?: boolean;
};
type Lot = { id: string; artikal_naziv: string; broj_lota: string; status: string; dostupno: string; karantin: string };
type ObrazacPolje = { kljuc: string; oznaka: string; tip: "text" | "number" | "checkbox"; odstupanjeAko?: boolean; obavezno?: boolean };
type Obrazac = { kod: string; naziv: string; uloge: string[]; polja: ObrazacPolje[] };
type Zapis = {
  id: string;
  obrazac_kod: string;
  datum: string;
  izvrsilac: string;
  odstupanje: boolean;
  korektivna_mjera: string | null;
  podaci: Record<string, unknown>;
  naknadno_dana: number;
  ispravlja_id: string | null;
  vazeci: boolean;
  uneo_korisnik_id: string | null;
  van_mreze?: boolean;
};

/** Odgovori iz kojih slijedi odstupanje (R-08) — isto pravilo kao na serveru (obrasciService). */
function odstupanjaIzPolja(obrazac: Obrazac, podaci: Record<string, unknown>) {
  return obrazac.polja.filter((p) => p.tip === "checkbox" && p.odstupanjeAko !== undefined && podaci[p.kljuc] === p.odstupanjeAko).map((p) => `${p.oznaka} — ${podaci[p.kljuc] ? "da" : "ne"}`);
}

export function Haccp() {
  const { korisnik } = useAuth();
  const [tacke, setTacke] = useState<KontrolnaTacka[]>([]);
  const [mjerenja, setMjerenja] = useState<Mjerenje[]>([]);
  const [lotovi, setLotovi] = useState<Lot[]>([]);
  const [obrasci, setObrasci] = useState<Obrazac[]>([]);
  const [zapisi, setZapisi] = useState<Zapis[]>([]);
  // Sa Moje strane ("Danas po planu → Upiši") stiže koji obrazac ili koja tačka se upisuje.
  const saPlana = useLocation().state as { obrazac?: string; mjerenje?: string; skladiste?: string | null } | null;
  const [modalMjerenje, setModalMjerenje] = useState<boolean>(!!saPlana?.mjerenje);
  const [neispravni, setNeispravni] = useState<string[]>([]);
  const [modalZapis, setModalZapis] = useState<{ obrazac: Obrazac; ispravlja?: Zapis } | null>(null);
  const [filterObrazac, setFilterObrazac] = useState("");
  const vodiSistem = korisnik?.uloga === "bzr" || korisnik?.uloga === "izvodjac";
  // Firma sa više magacina: mjerenje i obrazac pamte magacin (#77) — plan se vodi po magacinu, pa
  // ono što je izmjerio jedan magacioner ne stoji drugome kao obaveza, a ne „pokriva“ drugi magacin.
  const skladista = useSkladista();
  const [magacin, setMagacin] = useState(saPlana?.skladiste ?? "");
  const izabraniMagacin = magacin || skladista.podrazumijevano;

  const ucitaj = () => {
    api<Mjerenje[]>("/mjerenja").then(setMjerenja);
    api<Zapis[]>("/zapisi").then(setZapisi);
  };

  useEffect(() => {
    api<KontrolnaTacka[]>("/kontrolne-tacke").then(setTacke);
    // Mjeri se i zadržan lot (HOLD, karantin) — ponovno mjerenje je dokaz za zatvaranje neusaglašenosti (R-22).
    api<Lot[]>("/lotovi").then((svi) => setLotovi(svi.filter((l) => (l.status === "PRIHVACEN" || l.status === "HOLD") && Number(l.dostupno) + Number(l.karantin) > 0)));
    // Invarijanta #25: obrazac nosi `uloge` — svako vidi samo obrasce svoje uloge.
    fetch("/obrasci-cg.json")
      .then((r) => r.json())
      .then((svi: Obrazac[]) => {
        const moji = svi.filter((o) => !korisnik || o.uloge.includes(korisnik.uloga));
        setObrasci(moji);
        const trazeni = saPlana?.obrazac ? moji.find((o) => o.kod === saPlana.obrazac) : undefined;
        if (trazeni) setModalZapis({ obrazac: trazeni });
      });
    // Termometar koji nije prošao provjeru — mjerenje njime ne vrijedi (faza 3).
    api<{ naziv: string; oznaka: string | null; stanje: string }[]>("/termometri")
      .then((u) => setNeispravni(u.filter((x) => x.stanje === "NEISPRAVAN").map((x) => `${x.naziv}${x.oznaka ? ` (${x.oznaka})` : ""}`)))
      .catch(() => undefined);
    ucitaj();
    // Mjerenje ili zapis koji je čekao na telefonu je stigao (#85).
    window.addEventListener(IZLAZ_POSLAT, ucitaj);
    return () => window.removeEventListener(IZLAZ_POSLAT, ucitaj);
  }, []);

  const upitnih = mjerenja.filter((m) => m.upitno).length;

  return (
    <>
      <PageHeader
        title="HACCP / DHP"
        description={
          <>
            Limiti dolaze iz podešavanja artikla — ne kucaju se ovdje. Odstupanje bez zapisane mjere se ne
            snima <ZakonskaOznaka clan="36" />.
          </>
        }
        action={
          <button className="primary-button" onClick={() => setModalMjerenje(true)}>
            <Plus size={16} /> Novo mjerenje
          </button>
        }
      />

      {skladista.vise && (
        <div className="panel" style={{ minHeight: "auto", marginBottom: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", fontSize: 12, flexWrap: "wrap" }}>
            <span className="meta-label" style={{ margin: 0 }}>Radim u magacinu</span>
            <select value={izabraniMagacin} onChange={(e) => setMagacin(e.target.value)} style={{ height: 34, border: "1px solid #dfe7ed", borderRadius: 6, padding: "0 8px" }}>
              {skladista.aktivna.map((s) => <option key={s.id} value={s.id}>{s.naziv}</option>)}
            </select>
            <small className="muted-text">Mjerenja i obrasci se upisuju za ovaj magacin — plan monitoringa se vodi po magacinu.</small>
          </label>
        </div>
      )}
      {neispravni.length > 0 && (
        <div className="upozorenje-traka">
          <AlertTriangle size={16} />
          <span>Termometar nije prošao provjeru: {neispravni.join(", ")} — ne mjerite njime dok se ne zamijeni ili kalibriše.</span>
        </div>
      )}
      {upitnih > 0 && (
        <div className="upozorenje-traka">
          <AlertTriangle size={16} />
          <span>
            {upitnih === 1 ? "Jedno mjerenje je upitno" : `${upitnih} mjerenja su upitna`} — urađena termometrom koji je na sljedećoj provjeri pao.
            Pregledajte ih (označena ispod) i po potrebi izmjerite ponovo.
          </span>
        </div>
      )}

      <div className="section-heading">
        <div>
          <h2><Thermometer size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />Temperaturna mjerenja</h2>
        </div>
      </div>
      <div className="panel full-panel" style={{ marginBottom: 26 }}>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Kontrolna tačka</th>
                <th>Lot</th>
                <th>Vrijednost</th>
                <th>Vrijeme</th>
                <th>Izmjerio</th>
                <th>Termometar</th>
                <th>Rezultat</th>
              </tr>
            </thead>
            <tbody>
              {mjerenja.map((m) => (
                <tr key={m.id}>
                  <td>{m.kontrolna_tacka_naziv}</td>
                  <td className="muted-text">{m.broj_lota ?? "—"}</td>
                  <td>{m.vrijednost}°C</td>
                  <td className="muted-text">{new Date(m.izmjereno_at).toLocaleString("sr-Latn-ME")}<VanMrezeOznaka da={m.van_mreze} /></td>
                  <td className="muted-text">{m.izmjerio ?? "—"}</td>
                  <td className="muted-text">
                    {m.termometar ? `${m.termometar}${m.termometar_oznaka ? ` (${m.termometar_oznaka})` : ""}` : "—"}
                    {m.upitno && <> <StatusBadge status="FAIL" tekst="upitno" /></>}
                  </td>
                  <td><StatusBadge status={m.rezultat} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section-heading">
        <div>
          <h2><ClipboardList size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />Dnevni obrasci <ZakonskaOznaka clan="35" /> <ZakonskaOznaka clan="47" /></h2>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {obrasci.map((o) => (
            <button key={o.kod} className="small-action" onClick={() => setModalZapis({ obrazac: o })}>
              {o.kod} — {o.naziv}
            </button>
          ))}
        </div>
      </div>
      <div className="filter-tabs" style={{ marginBottom: 16 }}>
        <button className={filterObrazac === "" ? "selected" : ""} onClick={() => setFilterObrazac("")}>Svi</button>
        {obrasci.map((o) => (
          <button key={o.kod} className={filterObrazac === o.kod ? "selected" : ""} onClick={() => setFilterObrazac(o.kod)}>{o.kod}</button>
        ))}
      </div>
      <div className="panel full-panel">
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Obrazac</th>
                <th>Datum</th>
                <th>Izvršilac</th>
                <th>Odstupanje</th>
                <th>Korektivna mjera</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {zapisi.filter((z) => !filterObrazac || z.obrazac_kod === filterObrazac).map((z) => {
                const obrazac = obrasci.find((o) => o.kod === z.obrazac_kod);
                // Ispravlja se posljednja verzija; terenska uloga samo svoj zapis (R-07).
                const mozeIspraviti = z.vazeci && !!obrazac && (vodiSistem || z.uneo_korisnik_id === korisnik?.id);
                return (
                  <tr key={z.id} style={z.vazeci ? undefined : { opacity: 0.55 }}>
                    <td>
                      {z.obrazac_kod}
                      {z.ispravlja_id && <span className="muted-text"> · ispravka</span>}
                      {!z.vazeci && <span className="muted-text"> · ispravljen</span>}
                    </td>
                    <td className="muted-text">{z.datum}<NaknadnoOznaka dana={z.naknadno_dana} /><VanMrezeOznaka da={z.van_mreze} /></td>
                    <td>{z.izvrsilac}</td>
                    <td>{z.odstupanje ? <StatusBadge status="OTVORENA" tekst="Da" /> : <span className="muted-text">Ne</span>}</td>
                    <td className="muted-text">{z.korektivna_mjera ?? "—"}</td>
                    <td>{mozeIspraviti && <button className="small-action" onClick={() => setModalZapis({ obrazac: obrazac!, ispravlja: z })}>Ispravi</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {modalMjerenje && (
        <NovoMjerenjeModal key={tacke.length} tacke={tacke} pocetnaTacka={saPlana?.mjerenje} lotovi={lotovi} skladisteId={skladista.vise ? izabraniMagacin : undefined} onClose={() => setModalMjerenje(false)} onCreated={ucitaj} />
      )}
      {modalZapis && <NoviZapisModal obrazac={modalZapis.obrazac} ispravlja={modalZapis.ispravlja} skladisteId={skladista.vise && !modalZapis.ispravlja ? izabraniMagacin : undefined} onClose={() => setModalZapis(null)} onCreated={ucitaj} />}
    </>
  );
}

function NovoMjerenjeModal({ tacke, pocetnaTacka, lotovi, skladisteId, onClose, onCreated }: { tacke: KontrolnaTacka[]; pocetnaTacka?: string; lotovi: Lot[]; skladisteId?: string; onClose: () => void; onCreated: () => void }) {
  const [kontrolnaTackaId, setKontrolnaTackaId] = useState(pocetnaTacka && tacke.some((t) => t.id === pocetnaTacka) ? pocetnaTacka : tacke[0]?.id ?? "");
  const [lotId, setLotId] = useState("");
  const [vrijednost, setVrijednost] = useState("");
  const [napomena, setNapomena] = useState("");
  const [rezultat, setRezultat] = useState<string | null>(null);
  const [naTelefonu, setNaTelefonu] = useState(false);
  const [kljuc] = useState(noviKljuc);
  const [greska, setGreska] = useState("");
  const { termometri, termometarId, setTermometarId } = useIzborTermometra();

  const { radim, salji } = useSlanje();
  const posalji = async () => {
    try {
      const tacka = tacke.find((t) => t.id === kontrolnaTackaId);
      // Bez mreže (hladnjača, podrum) se čuva na telefonu sa vremenom mjerenja (#85).
      const u = await upisiIliSacuvaj<{ rezultat: string }>(
        "/mjerenja",
        // Mjerenje lota je u magacinu lota (server to zna sam); inače u izabranom magacinu.
        { kontrolnaTackaId, lotId: lotId || undefined, vrijednost: Number(vrijednost), napomena: napomena || undefined, mjerniUredjajId: termometarId || undefined, skladisteId: lotId ? undefined : skladisteId || undefined },
        { kljuc, opis: `Mjerenje ${vrijednost} °C — ${tacka?.naziv ?? "kontrolna tačka"}` },
      );
      if (!u.poslato) {
        setNaTelefonu(true);
        return;
      }
      setRezultat(u.rezultat.rezultat);
      onCreated();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Mjerenje nije sačuvano.");
    }
  };

  if (naTelefonu) return <SacuvanoNaTelefonu naslov="Temperaturno mjerenje" opis={`Mjerenje ${vrijednost} °C`} onClose={onClose} />;

  if (rezultat) {
    return (
      <Modal naslov="Mjerenje zabilježeno" onClose={onClose} footer={<button className="primary-button" onClick={onClose}>Zatvori</button>}>
        <div style={{ padding: 20 }}>
          <StatusBadge status={rezultat} />
          {rezultat === "FAIL" && <p style={{ marginTop: 10, fontSize: 12, color: "#c34e55" }}>Otvorena je neusaglašenost i zadatak za odgovorno lice. Ako je povezano sa lotom, lot je stavljen na HOLD.</p>}
        </div>
      </Modal>
    );
  }

  const trebaTermometar = termometri.length > 0 && !termometarId;
  return (
    <Modal naslov="Novo temperaturno mjerenje" onClose={onClose} greska={greska} footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={() => salji(posalji)} disabled={radim || !kontrolnaTackaId || !vrijednost || trebaTermometar}>Sačuvaj</button></>}>
      <div className="form-grid">
        <label>
          Kontrolna tačka
          <select value={kontrolnaTackaId} onChange={(e) => setKontrolnaTackaId(e.target.value)}>
            {tacke.map((t) => <option key={t.id} value={t.id}>{t.naziv}</option>)}
          </select>
        </label>
        <label>
          Lot (opciono)
          <select value={lotId} onChange={(e) => setLotId(e.target.value)}>
            <option value="">— nije vezano za lot —</option>
            {lotovi.map((l) => <option key={l.id} value={l.id}>{l.artikal_naziv} · {l.broj_lota}{l.status === "HOLD" ? " (zadržan)" : ""}</option>)}
          </select>
        </label>
        <label>Vrijednost (°C) <ZakonskaOznaka clan="36" /><input type="number" step="0.1" value={vrijednost} onChange={(e) => setVrijednost(e.target.value)} /></label>
        <IzborTermometra termometri={termometri} value={termometarId} onChange={setTermometarId} obavezan />
        <label style={{ gridColumn: "1 / -1" }}>Napomena<input value={napomena} onChange={(e) => setNapomena(e.target.value)} /></label>
      </div>
      {lotId && <p className="muted-text" style={{ fontSize: 11, margin: "0 20px 12px" }}>Lot se ocjenjuje po granici svog artikla.</p>}
    </Modal>
  );
}

function NoviZapisModal({ obrazac, ispravlja, skladisteId, onClose, onCreated }: { obrazac: Obrazac; ispravlja?: Zapis; skladisteId?: string; onClose: () => void; onCreated: () => void }) {
  const [datum, setDatum] = useState(ispravlja?.datum ?? lokalniDatum());
  // Da/ne se ne podrazumijeva — ni „da", ni „ne" (R-08: nije odgovoreno ≠ u redu).
  const [podaci, setPodaci] = useState<Record<string, unknown>>(ispravlja?.podaci ?? {});
  const [rucnoOdstupanje, setRucnoOdstupanje] = useState(ispravlja?.odstupanje ?? false);
  const [korektivnaMjera, setKorektivnaMjera] = useState(ispravlja?.korektivna_mjera ?? "");
  const [greska, setGreska] = useState("");
  const [naTelefonu, setNaTelefonu] = useState(false);
  const [kljuc] = useState(noviKljuc);

  const izPolja = odstupanjaIzPolja(obrazac, podaci);
  const odstupanje = rucnoOdstupanje || izPolja.length > 0;
  const neodgovoreno = obrazac.polja.filter((p) => (p.tip === "checkbox" && typeof podaci[p.kljuc] !== "boolean") || (p.obavezno && p.tip !== "checkbox" && !String(podaci[p.kljuc] ?? "").trim()));

  const { radim, salji } = useSlanje();
  const posalji = async () => {
    try {
      const u = await upisiIliSacuvaj(
        "/zapisi",
        { obrazacKod: obrazac.kod, datum, podaci, odstupanje, korektivnaMjera: korektivnaMjera.trim() || undefined, ispravljaId: ispravlja?.id, skladisteId: skladisteId || undefined },
        { kljuc, opis: `${ispravlja ? "Ispravka — " : ""}${obrazac.kod} ${obrazac.naziv} (${datum})`, vezano: `obrazac:${obrazac.kod}` },
      );
      if (!u.poslato) {
        setNaTelefonu(true);
        return;
      }
      onCreated();
      onClose();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Zapis nije sačuvan.");
    }
  };

  if (naTelefonu) return <SacuvanoNaTelefonu naslov={`${obrazac.kod} — ${obrazac.naziv}`} opis={`Dnevni zapis ${obrazac.kod}`} onClose={onClose} />;

  return (
    <Modal
      naslov={`${ispravlja ? "Ispravka — " : ""}${obrazac.kod} — ${obrazac.naziv}`}
      podnaslov={ispravlja ? "Stari zapis ostaje sačuvan i vidljiv; važi ovaj novi." : undefined}
      onClose={onClose}
      greska={greska}
      footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={() => salji(posalji)} disabled={radim || neodgovoreno.length > 0 || (odstupanje && !korektivnaMjera.trim())}>Sačuvaj</button></>}
    >
      <div className="form-grid">
        <label>Datum<input type="date" value={datum} disabled={!!ispravlja} onChange={(e) => setDatum(e.target.value)} /></label>
        {obrazac.polja.map((polje) => (
          <label key={polje.kljuc}>
            {polje.oznaka}
            {polje.tip === "checkbox" ? (
              <select
                value={typeof podaci[polje.kljuc] === "boolean" ? (podaci[polje.kljuc] ? "da" : "ne") : ""}
                onChange={(e) => setPodaci((p) => ({ ...p, [polje.kljuc]: e.target.value === "" ? undefined : e.target.value === "da" }))}
                style={polje.odstupanjeAko !== undefined && podaci[polje.kljuc] === polje.odstupanjeAko ? { borderColor: "#df686c" } : undefined}
              >
                <option value="">— izaberite —</option>
                <option value="da">Da</option>
                <option value="ne">Ne</option>
              </select>
            ) : (
              <input
                type={polje.tip === "number" ? "number" : "text"}
                value={(podaci[polje.kljuc] as string) ?? ""}
                onChange={(e) => setPodaci((p) => ({ ...p, [polje.kljuc]: e.target.value }))}
              />
            )}
          </label>
        ))}
      </div>
      <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
        {izPolja.length > 0 ? (
          <p style={{ fontSize: 12, color: "#c34e55", margin: 0 }}>Odstupanje: {izPolja.join("; ")}. Upišite šta je preduzeto.</p>
        ) : (
          <label>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={rucnoOdstupanje} onChange={(e) => setRucnoOdstupanje(e.target.checked)} style={{ width: "auto", height: "auto" }} /> Ima drugih odstupanja
            </span>
          </label>
        )}
        {odstupanje && (
          <label>
            Korektivna mjera <ZakonskaOznaka clan="36" />
            <input value={korektivnaMjera} onChange={(e) => setKorektivnaMjera(e.target.value)} placeholder="Odstupanje bez zapisane mjere je nalaz protiv firme." />
          </label>
        )}
        {neodgovoreno.length > 0 && <p className="muted-text" style={{ fontSize: 11, margin: 0 }}>Odgovorite na: {neodgovoreno.map((p) => p.oznaka).join(", ")}.</p>}
      </div>
    </Modal>
  );
}
