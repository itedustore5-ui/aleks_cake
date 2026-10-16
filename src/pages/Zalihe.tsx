import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Printer, Download, Search } from "lucide-react";
import { api, ApiGreska } from "../lib/api";
import { useSlanje } from "../lib/slanje";
import { lokalniDatum } from "../lib/vrijeme";
import { preuzmiCsv } from "../lib/csv";
import { PageHeader, Modal, ZakonskaOznaka, StampaZaglavlje } from "../components/Zajednicko";
import { StatusBadge, NAZIVI as OZNAKE_STATUSA } from "../components/StatusBadge";
import { useAuth } from "../lib/auth";
import { useSkladista } from "../lib/skladista";

type Lot = {
  id: string;
  artikal_naziv: string;
  dobavljac_naziv: string;
  broj_lota: string;
  rok_trajanja: string | null;
  status: string;
  dostupno: string;
  /** Drže isporuke u pripremi (R-14). */
  rezervisano?: string;
  karantin: string;
  prijem_id: string;
  primljena_kolicina: string;
  skladiste_id: string | null;
  skladiste_naziv: string | null;
};

const STATUSI = [
  { kod: "", naziv: "Svi" },
  { kod: "PRIHVACEN", naziv: "Prihvaćeni" },
  { kod: "PRIMLJEN", naziv: "Čekaju odluku" },
  { kod: "HOLD", naziv: "Na čekanju (HOLD)" },
  { kod: "ODBIJEN", naziv: "Odbijeni" },
];

const ROKOVI = [
  { kod: "", naziv: "Svi rokovi" },
  { kod: "uskoro", naziv: "Ističe za 7 dana" },
  { kod: "istekao", naziv: "Istekao" },
  { kod: "bez", naziv: "Bez roka" },
];

const PORECI = [
  { kod: "fefo", naziv: "Rok — prvo ističe (FEFO)" },
  { kod: "artikal", naziv: "Artikal A–Ž" },
  { kod: "kolicina", naziv: "Količina — najviše" },
];

const DAN_MS = 86_400_000;
const danaDo = (rok: string | null, danas: string) => (rok ? Math.round((Date.parse(rok) - Date.parse(danas)) / DAN_MS) : null);
/** 1 lot · 2 lota · 5 lotova · 21 lot */
const lotaPadez = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "lot" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "lota" : "lotova");

export function Zalihe() {
  const { korisnik } = useAuth();
  const mozeOtpisati = korisnik?.uloga === "operater" || korisnik?.uloga === "bzr" || korisnik?.uloga === "izvodjac";
  const skladista = useSkladista();
  const [lotovi, setLotovi] = useState<Lot[]>([]);
  const [otpisLot, setOtpisLot] = useState<Lot | null>(null);
  const [holdOdluka, setHoldOdluka] = useState<{ lot: Lot; odluka: "PRIHVATI" | "ODBIJI" } | null>(null);
  const [karantinOdluka, setKarantinOdluka] = useState<{ lot: Lot; odluka: "PUSTI" | "OTPISI" } | null>(null);
  const odlucuje = korisnik?.uloga === "bzr" || korisnik?.uloga === "izvodjac";

  // Sa Kontrolnog centra ("Lotovi na HOLD-u", "Rok robe") stiže sa već izabranim statusom ili rokom.
  const saKartice = useLocation().state as { status?: string; rok?: string } | null;
  const [status, setStatus] = useState(saKartice?.status ?? "PRIHVACEN");
  const [pretraga, setPretraga] = useState("");
  const [rok, setRok] = useState(saKartice?.rok ?? "");
  const [dobavljac, setDobavljac] = useState("");
  const [artikal, setArtikal] = useState("");
  const [magacin, setMagacin] = useState("");
  const [samoNaStanju, setSamoNaStanju] = useState(true);
  const [poredak, setPoredak] = useState("fefo");

  // Svi lotovi jednom — filteri rade na ekranu, pa se na karticama statusa vidi koliko čega ima.
  const ucitaj = () => {
    api<Lot[]>("/lotovi").then(setLotovi);
  };
  useEffect(ucitaj, []);

  const danas = lokalniDatum();
  const dobavljaci = useMemo(() => [...new Set(lotovi.map((l) => l.dobavljac_naziv))].sort(), [lotovi]);
  const artikli = useMemo(() => [...new Set(lotovi.map((l) => l.artikal_naziv))].sort(), [lotovi]);

  const bezStatusa = lotovi.filter((l) => {
    const d = danaDo(l.rok_trajanja, danas);
    const tekst = pretraga.trim().toLowerCase();
    return (
      (!tekst || `${l.artikal_naziv} ${l.broj_lota} ${l.dobavljac_naziv}`.toLowerCase().includes(tekst)) &&
      (!rok || (rok === "uskoro" && d !== null && d >= 0 && d <= 7) || (rok === "istekao" && d !== null && d < 0) || (rok === "bez" && d === null)) &&
      (!dobavljac || l.dobavljac_naziv === dobavljac) &&
      (!artikal || l.artikal_naziv === artikal) &&
      (!magacin || l.skladiste_id === magacin) &&
      (!samoNaStanju || Number(l.dostupno) + Number(l.karantin) > 0 || l.status === "HOLD")
    );
  });
  const brojPoStatusu = (kod: string) => bezStatusa.filter((l) => !kod || l.status === kod).length;
  const prikazano = bezStatusa
    .filter((l) => !status || l.status === status)
    .sort((a, b) =>
      poredak === "artikal"
        ? a.artikal_naziv.localeCompare(b.artikal_naziv, "sr")
        : poredak === "kolicina"
          ? Number(b.dostupno) - Number(a.dostupno)
          : (a.rok_trajanja ?? "9999").localeCompare(b.rok_trajanja ?? "9999"),
    );

  const uskoro = prikazano.filter((l) => { const d = danaDo(l.rok_trajanja, danas); return d !== null && d >= 0 && d <= 7; }).length;
  const istekli = prikazano.filter((l) => { const d = danaDo(l.rok_trajanja, danas); return d !== null && d < 0; }).length;

  const opisFiltera = [
    status ? `status: ${STATUSI.find((s) => s.kod === status)?.naziv}` : "",
    pretraga.trim() ? `pretraga: „${pretraga.trim()}"` : "",
    rok ? ROKOVI.find((r) => r.kod === rok)?.naziv ?? "" : "",
    dobavljac ? `dobavljač: ${dobavljac}` : "",
    artikal ? `artikal: ${artikal}` : "",
    magacin ? `magacin: ${skladista.sva.find((s) => s.id === magacin)?.naziv}` : "",
    samoNaStanju ? "samo na stanju" : "",
  ];
  const imaFiltera = status !== "PRIHVACEN" || pretraga || rok || dobavljac || artikal || magacin || !samoNaStanju;
  const ponisti = () => {
    setStatus("PRIHVACEN");
    setPretraga("");
    setRok("");
    setDobavljac("");
    setArtikal("");
    setMagacin("");
    setSamoNaStanju(true);
  };

  const izvezi = () =>
    preuzmiCsv(
      `zalihe-${danas}`,
      [
        { kljuc: "artikal_naziv", naziv: "Artikal" },
        { kljuc: "broj_lota", naziv: "Lot" },
        { kljuc: "dobavljac_naziv", naziv: "Dobavljač" },
        ...(skladista.vise ? [{ kljuc: "skladiste_naziv", naziv: "Magacin" }] : []),
        { kljuc: "rok_trajanja", naziv: "Rok trajanja" },
        { kljuc: "dostupno", naziv: "Dostupno" },
        { kljuc: "status_naziv", naziv: "Status" },
      ],
      prikazano.map((l) => ({ ...l, status_naziv: OZNAKE_STATUSA[l.status] ?? l.status })),
    );

  return (
    <>
      <PageHeader
        title="Zalihe"
        description={
          <>
            Količina se mijenja samo kroz prijem, isporuku ili otpis — nikad ručnim unosom <ZakonskaOznaka clan="27" />.
          </>
        }
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <button className="secondary-button" onClick={izvezi} disabled={prikazano.length === 0}>
              <Download size={15} /> CSV
            </button>
            <button className="primary-button" onClick={() => window.print()} disabled={prikazano.length === 0}>
              <Printer size={15} /> Štampaj
            </button>
          </div>
        }
      />
      <StampaZaglavlje naslov="Pregled zaliha" filteri={opisFiltera} brojRedova={prikazano.length} />

      <div className="filter-tabs" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        {STATUSI.map((s) => (
          <button key={s.kod} className={status === s.kod ? "selected" : ""} onClick={() => setStatus(s.kod)}>
            {s.naziv} <b>{brojPoStatusu(s.kod)}</b>
          </button>
        ))}
      </div>
      <div className="filter-bar">
        <label className="filter-pretraga">
          Pretraga
          <span>
            <Search size={13} />
            <input value={pretraga} onChange={(e) => setPretraga(e.target.value)} placeholder="artikal, lot, dobavljač" />
          </span>
        </label>
        <label>
          Rok
          <select value={rok} onChange={(e) => setRok(e.target.value)}>
            {ROKOVI.map((r) => <option key={r.kod} value={r.kod}>{r.naziv}</option>)}
          </select>
        </label>
        <label>
          Dobavljač
          <select value={dobavljac} onChange={(e) => setDobavljac(e.target.value)}>
            <option value="">Svi dobavljači</option>
            {dobavljaci.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label>
          Artikal
          <select value={artikal} onChange={(e) => setArtikal(e.target.value)}>
            <option value="">Svi artikli</option>
            {artikli.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        {skladista.vise && (
          <label>
            Magacin
            <select value={magacin} onChange={(e) => setMagacin(e.target.value)}>
              <option value="">Svi magacini</option>
              {skladista.sva.map((sk) => <option key={sk.id} value={sk.id}>{sk.naziv}</option>)}
            </select>
          </label>
        )}
        <label>
          Poredak
          <select value={poredak} onChange={(e) => setPoredak(e.target.value)}>
            {PORECI.map((p) => <option key={p.kod} value={p.kod}>{p.naziv}</option>)}
          </select>
        </label>
        <label className="filter-potvrda">
          <input type="checkbox" checked={samoNaStanju} onChange={(e) => setSamoNaStanju(e.target.checked)} /> Samo na stanju
        </label>
        {imaFiltera && <button className="link-button" onClick={ponisti}>Poništi filtere</button>}
        <span className="filter-broj">
          {prikazano.length} {lotaPadez(prikazano.length)}{uskoro > 0 && <> · <b className="danas-fali">{uskoro} ističe za 7 dana</b></>}
          {istekli > 0 && <> · <b className="danas-fali">{istekli} isteklo</b></>}
        </span>
      </div>

      <div className="panel full-panel">
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Artikal</th>
                <th>Lot <ZakonskaOznaka clan="27" /></th>
                <th>Dobavljač</th>
                {skladista.vise && <th>Magacin</th>}
                <th>Rok trajanja</th>
                <th>Dostupno</th>
                <th>Status</th>
                <th className="no-print"></th>
              </tr>
            </thead>
            <tbody>
              {prikazano.length === 0 && (
                <tr><td colSpan={8} className="muted-text" style={{ padding: 20 }}>Nema lotova za izabrane filtere.</td></tr>
              )}
              {prikazano.map((l) => {
                const d = danaDo(l.rok_trajanja, danas);
                return (
                  <tr key={l.id}>
                    <td>{l.artikal_naziv}</td>
                    <td><code>{l.broj_lota}</code></td>
                    <td className="muted-text">{l.dobavljac_naziv}</td>
                    {skladista.vise && <td className="muted-text">{l.skladiste_naziv ?? "—"}</td>}
                    <td className={d !== null && d <= 7 ? "expiry-near" : "muted-text"}>
                      {l.rok_trajanja ? new Date(l.rok_trajanja).toLocaleDateString("sr-Latn-ME") : "—"}
                      {d !== null && d < 0 && <span className="rok-oznaka istekao">isteklo</span>}
                      {d !== null && d >= 0 && d <= 7 && <span className="rok-oznaka">još {d} {d === 1 ? "dan" : "dana"}</span>}
                    </td>
                    <td>
                      {Number(l.dostupno)}
                      {Number(l.karantin) > 0 && <span className="rok-oznaka istekao">karantin {Number(l.karantin)}</span>}
                      {Number(l.rezervisano ?? 0) > 0 && <span className="rok-oznaka" title="Drže isporuke u pripremi — slobodno je ostatak">rezervisano {Number(l.rezervisano)}</span>}
                    </td>
                    <td><StatusBadge status={l.status} /></td>
                    <td className="no-print">
                      <div style={{ display: "flex", gap: 6 }}>
                        {mozeOtpisati && Number(l.dostupno) > 0 && (
                          <button className="small-action" onClick={() => setOtpisLot(l)}>Otpiši</button>
                        )}
                        {/* Roba vraćena sa isporuke čeka pregled u karantinu prihvaćenog lota (R-03). */}
                        {odlucuje && l.status === "PRIHVACEN" && Number(l.karantin) > 0 && (
                          <>
                            <button className="small-action" onClick={() => setKarantinOdluka({ lot: l, odluka: "PUSTI" })}>Iz karantina: pusti</button>
                            <button className="small-action odstupanje-dugme" onClick={() => setKarantinOdluka({ lot: l, odluka: "OTPISI" })}>Iz karantina: otpiši</button>
                          </>
                        )}
                        {odlucuje && l.status === "HOLD" && (
                          <>
                            <button className="small-action" onClick={() => setHoldOdluka({ lot: l, odluka: "PRIHVATI" })}>Pusti</button>
                            <button className="small-action odstupanje-dugme" onClick={() => setHoldOdluka({ lot: l, odluka: "ODBIJI" })}>Odbij</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {holdOdluka && (
        <HoldOdlukaModal
          lot={holdOdluka.lot}
          odluka={holdOdluka.odluka}
          onClose={() => setHoldOdluka(null)}
          onSacuvano={() => {
            setHoldOdluka(null);
            ucitaj();
          }}
        />
      )}
      {karantinOdluka && (
        <KarantinModal
          lot={karantinOdluka.lot}
          odluka={karantinOdluka.odluka}
          onClose={() => setKarantinOdluka(null)}
          onSacuvano={() => {
            setKarantinOdluka(null);
            ucitaj();
          }}
        />
      )}
      {otpisLot && (
        <OtpisModal
          lot={otpisLot}
          onClose={() => setOtpisLot(null)}
          onSacuvano={() => {
            setOtpisLot(null);
            ucitaj();
          }}
        />
      )}
    </>
  );
}

function OtpisModal({ lot, onClose, onSacuvano }: { lot: Lot; onClose: () => void; onSacuvano: () => void }) {
  const [kolicina, setKolicina] = useState("");
  const [razlog, setRazlog] = useState("");
  const [greska, setGreska] = useState("");

  const { radim, salji } = useSlanje();
  const posalji = async () => {
    try {
      await api(`/lotovi/${lot.id}/otpis`, { method: "POST", telo: { kolicina: Number(kolicina), razlog } });
      onSacuvano();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Otpis nije sačuvan.");
    }
  };

  const validno = Number(kolicina) > 0 && Number(kolicina) <= Number(lot.dostupno) && razlog.trim().length >= 3;

  return (
    <Modal
      naslov={`Otpis — ${lot.broj_lota}`}
      podnaslov={`${lot.artikal_naziv} · dostupno ${lot.dostupno}`}
      onClose={onClose}
      greska={greska}
      footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={() => salji(posalji)} disabled={radim || !validno}>Sačuvaj otpis</button></>}
    >
      <div className="form-grid" style={{ padding: 20 }}>
        <label>
          Količina za otpis
          <input type="number" step="0.001" max={lot.dostupno} value={kolicina} onChange={(e) => setKolicina(e.target.value)} />
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          Razlog <ZakonskaOznaka clan="27" />
          <input value={razlog} onChange={(e) => setRazlog(e.target.value)} placeholder="npr. oštećeno u transportu, isteklo, izgubljeno" />
        </label>
      </div>
    </Modal>
  );
}

/** Lot na HOLD-u se pušta ili odbija (nalaz H1) — uvijek sa razlogom, jer to čita inspektor.
 * Pod povlačenjem u toku server ne dozvoljava puštanje. */
function HoldOdlukaModal({ lot, odluka, onClose, onSacuvano }: { lot: Lot; odluka: "PRIHVATI" | "ODBIJI"; onClose: () => void; onSacuvano: () => void }) {
  const [razlog, setRazlog] = useState("");
  const [greska, setGreska] = useState("");
  const kolicina = Number(lot.karantin) > 0 ? Number(lot.karantin) : Number(lot.primljena_kolicina);
  const pusti = odluka === "PRIHVATI";

  const { radim, salji } = useSlanje();
  const posalji = async () => {
    try {
      await api(`/prijem/${lot.prijem_id}/lot/${lot.id}/odluka`, { method: "PATCH", telo: { odluka, kolicina, napomena: razlog.trim() } });
      onSacuvano();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Odluka nije sačuvana.");
    }
  };

  return (
    <Modal
      naslov={pusti ? `Pusti lot ${lot.broj_lota}` : `Odbij lot ${lot.broj_lota}`}
      podnaslov={`${lot.artikal_naziv} · ${kolicina} u karantinu`}
      onClose={onClose}
      greska={greska}
      footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={() => salji(posalji)} disabled={radim || razlog.trim().length < 3}>{pusti ? "Pusti u prodaju" : "Odbij robu"}</button></>}
    >
      <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
        <p className="muted-text" style={{ fontSize: 11, margin: 0 }}>
          {pusti
            ? "Roba prelazi iz karantina u slobodnu zalihu i može u isporuku. Upišite na osnovu čega — ponovljeno mjerenje, nalaz laboratorije, izjava dobavljača."
            : "Roba izlazi iz magacina (povrat dobavljaču ili uništenje) i upisuje se u dnevnik kretanja zalihe."}
        </p>
        <label>
          Razlog <ZakonskaOznaka clan="36" />
          <textarea rows={3} value={razlog} onChange={(e) => setRazlog(e.target.value)} placeholder={pusti ? "npr. ponovljeno mjerenje 3,8 °C, roba ispravna" : "npr. povrat dobavljaču — prekid hladnog lanca"} />
        </label>
      </div>
    </Modal>
  );
}

/** Roba vraćena sa isporuke (odbijena ili nepredata) stoji u karantinu dok je odgovorno lice ne
 * pregleda (nalaz R-03): vraća se u prodaju ili otpisuje — uvijek sa onim što je pregledano. */
function KarantinModal({ lot, odluka, onClose, onSacuvano }: { lot: Lot; odluka: "PUSTI" | "OTPISI"; onClose: () => void; onSacuvano: () => void }) {
  const [kolicina, setKolicina] = useState(String(Number(lot.karantin)));
  const [razlog, setRazlog] = useState("");
  const [greska, setGreska] = useState("");
  const pusti = odluka === "PUSTI";

  const { radim, salji } = useSlanje();
  const posalji = async () => {
    try {
      await api(`/lotovi/${lot.id}/karantin`, { telo: { odluka, kolicina: Number(kolicina), razlog: razlog.trim() } });
      onSacuvano();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Odluka nije sačuvana.");
    }
  };

  const validno = Number(kolicina) > 0 && Number(kolicina) <= Number(lot.karantin) && razlog.trim().length >= 3;

  return (
    <Modal
      naslov={pusti ? `Iz karantina u prodaju — ${lot.broj_lota}` : `Otpis iz karantina — ${lot.broj_lota}`}
      podnaslov={`${lot.artikal_naziv} · ${Number(lot.karantin)} u karantinu (povrat sa isporuke)`}
      onClose={onClose}
      greska={greska}
      footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={() => salji(posalji)} disabled={radim || !validno}>{pusti ? "Vrati u prodaju" : "Otpiši"}</button></>}
    >
      <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
        <p className="muted-text" style={{ fontSize: 11, margin: 0 }}>
          {pusti
            ? "Roba je bila van magacina. Vratite je u prodaju samo ako je pregledana: temperatura, ambalaža, rok."
            : "Roba izlazi iz magacina (uništenje ili povrat dobavljaču) i upisuje se u dnevnik kretanja zalihe."}
        </p>
        <label>
          Količina
          <input type="number" step="0.001" max={lot.karantin} value={kolicina} onChange={(e) => setKolicina(e.target.value)} />
        </label>
        <label>
          Šta je pregledano <ZakonskaOznaka clan="36" />
          <textarea rows={3} value={razlog} onChange={(e) => setRazlog(e.target.value)} placeholder={pusti ? "npr. 3,6 °C, ambalaža čitava, rok 12.10." : "npr. prekid hladnog lanca, oštećena ambalaža"} />
        </label>
      </div>
    </Modal>
  );
}
