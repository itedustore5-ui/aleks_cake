import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api, ApiGreska } from "../lib/api";
import { PageHeader, Modal, ZakonskaOznaka } from "../components/Zajednicko";
import { StatusBadge } from "../components/StatusBadge";
import type { Skladiste } from "../lib/skladista";

type Kupac = { id: string; naziv: string; pib: string | null; adresa: string | null; adresa_isporuke: string | null; telefon: string; email: string | null; aktivan: boolean };
type Dobavljac = { id: string; naziv: string; pib: string | null; adresa: string | null; telefon: string | null; email: string | null; aktivan: boolean };
type Artikal = {
  id: string;
  sifra: string | null;
  naziv: string;
  jedinica_mjere: string;
  zahtijeva_lot: boolean;
  temp_kontrolisano: boolean;
  temp_min: string | null;
  temp_max: string | null;
  rok_trajanja_dana: number | null;
  granica_potvrdio: boolean;
  rok_obavezan: boolean;
};

const TABOVI = [
  { kod: "kupci", naziv: "Kupci" },
  { kod: "dobavljaci", naziv: "Dobavljači" },
  { kod: "artikli", naziv: "Artikli" },
  { kod: "skladista", naziv: "Skladišta" },
] as const;

export function Sifarnici() {
  const [tab, setTab] = useState<(typeof TABOVI)[number]["kod"]>("kupci");
  const [kupci, setKupci] = useState<Kupac[]>([]);
  const [dobavljaci, setDobavljaci] = useState<Dobavljac[]>([]);
  const [artikli, setArtikli] = useState<Artikal[]>([]);
  const [modalNoviKupac, setModalNoviKupac] = useState(false);
  const [modalIzmjenaKupac, setModalIzmjenaKupac] = useState<Kupac | null>(null);
  const [modalNoviDobavljac, setModalNoviDobavljac] = useState(false);
  const [modalIzmjenaDobavljac, setModalIzmjenaDobavljac] = useState<Dobavljac | null>(null);
  const [modalNoviArtikal, setModalNoviArtikal] = useState(false);
  const [modalIzmjenaArtikal, setModalIzmjenaArtikal] = useState<Artikal | null>(null);
  const [skladista, setSkladista] = useState<Skladiste[]>([]);
  const [modalSkladiste, setModalSkladiste] = useState<Skladiste | "novo" | null>(null);

  const ucitaj = () => {
    api<Kupac[]>("/kupci").then(setKupci);
    api<Dobavljac[]>("/dobavljaci").then(setDobavljaci);
    api<Artikal[]>("/artikli").then(setArtikli);
    api<{ skladista: Skladiste[] }>("/skladista").then((r) => setSkladista(r.skladista));
  };
  useEffect(ucitaj, []);

  return (
    <>
      <PageHeader
        title="Šifarnici"
        description="Kupci, dobavljači, artikli i skladišta — osnovni podaci na koje se oslanja sledljivost."
        action={
          tab === "kupci" ? (
            <button className="primary-button" onClick={() => setModalNoviKupac(true)}>
              <Plus size={16} /> Novi kupac
            </button>
          ) : tab === "dobavljaci" ? (
            <button className="primary-button" onClick={() => setModalNoviDobavljac(true)}>
              <Plus size={16} /> Novi dobavljač
            </button>
          ) : tab === "artikli" ? (
            <button className="primary-button" onClick={() => setModalNoviArtikal(true)}>
              <Plus size={16} /> Novi artikal
            </button>
          ) : (
            <button className="primary-button" onClick={() => setModalSkladiste("novo")}>
              <Plus size={16} /> Novo skladište
            </button>
          )
        }
      />
      <div className="filter-tabs" style={{ marginBottom: 16 }}>
        {TABOVI.map((t) => (
          <button key={t.kod} className={tab === t.kod ? "selected" : ""} onClick={() => setTab(t.kod)}>
            {t.naziv}
          </button>
        ))}
      </div>

      {tab === "kupci" && (
        <div className="panel full-panel">
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Naziv</th>
                  <th>Adresa</th>
                  <th>Telefon <ZakonskaOznaka clan="28" /></th>
                  <th>Email</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {kupci.map((k) => (
                  <tr key={k.id}>
                    <td>{k.naziv}{k.pib && <div className="muted-text" style={{ fontSize: 10 }}>PIB {k.pib}</div>}</td>
                    <td className="muted-text">{k.adresa ?? "—"}{k.adresa_isporuke && <div style={{ fontSize: 10 }}>isporuka: {k.adresa_isporuke}</div>}</td>
                    <td>{k.telefon}</td>
                    <td className="muted-text">{k.email ?? "—"}</td>
                    <td><button className="small-action" onClick={() => setModalIzmjenaKupac(k)}>Izmijeni</button></td>
                  </tr>
                ))}
                {kupci.length === 0 && <tr><td colSpan={5} className="muted-text" style={{ padding: 20 }}>Nema unijetih kupaca.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "dobavljaci" && (
        <div className="panel full-panel">
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Naziv</th>
                  <th>PIB</th>
                  <th>Adresa</th>
                  <th>Telefon</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {dobavljaci.map((d) => (
                  <tr key={d.id}>
                    <td>{d.naziv}</td>
                    <td className="muted-text">{d.pib ?? "—"}</td>
                    <td className="muted-text">{d.adresa ?? "—"}</td>
                    <td>{d.telefon ?? "—"}</td>
                    <td><button className="small-action" onClick={() => setModalIzmjenaDobavljac(d)}>Izmijeni</button></td>
                  </tr>
                ))}
                {dobavljaci.length === 0 && <tr><td colSpan={5} className="muted-text" style={{ padding: 20 }}>Nema unijetih dobavljača.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "artikli" && (
        <div className="panel full-panel">
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Naziv</th>
                  <th>Jed. mjere</th>
                  <th>Temp. opseg</th>
                  <th>Rok trajanja</th>
                  <th>Granica potvrđena</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {artikli.map((a) => (
                  <tr key={a.id}>
                    <td>{a.naziv}</td>
                    <td className="muted-text">{a.jedinica_mjere}</td>
                    <td className="muted-text">{a.temp_kontrolisano ? `${a.temp_min ?? "?"}–${a.temp_max ?? "?"}°C` : "—"}</td>
                    <td className="muted-text">{a.rok_trajanja_dana ? `${a.rok_trajanja_dana} dana` : "—"}</td>
                    <td>{a.granica_potvrdio ? "Da" : "Ne — pretpostavka"}</td>
                    <td><button className="small-action" onClick={() => setModalIzmjenaArtikal(a)}>Izmijeni</button></td>
                  </tr>
                ))}
                {artikli.length === 0 && <tr><td colSpan={6} className="muted-text" style={{ padding: 20 }}>Nema unijetih artikala.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "skladista" && (
        <>
          <p className="muted-text" style={{ fontSize: 11, marginBottom: 14, maxWidth: 680 }}>
            Dok firma ima jedno aktivno skladište, izbor skladišta se nigdje ne prikazuje. Čim ih ima više,
            prijem, isporuka i zalihe dobijaju izbor i kolonu „Magacin". Roba ostaje u skladištu u koje je
            primljena i isporučuje se iz njega. Magacioner po potrebi radi i u drugom skladištu — bira ga pri
            unosu; matično skladište naloga se podešava na Ljudi → Nalozi.
          </p>
          <div className="panel full-panel">
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Naziv</th>
                    <th>Adresa</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {skladista.map((sk) => (
                    <tr key={sk.id}>
                      <td>{sk.naziv}</td>
                      <td className="muted-text">{sk.adresa ?? "—"}</td>
                      <td>{sk.aktivan ? <StatusBadge status="VAZI" tekst="Aktivno" /> : <StatusBadge status="ISTEKLA" tekst="Neaktivno" />}</td>
                      <td><button className="small-action" onClick={() => setModalSkladiste(sk)}>Izmijeni</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {modalSkladiste && (
        <SkladisteModal skladiste={modalSkladiste === "novo" ? undefined : modalSkladiste} onClose={() => setModalSkladiste(null)} onSacuvano={ucitaj} />
      )}
      {modalNoviKupac && <KupacModal onClose={() => setModalNoviKupac(false)} onSacuvano={ucitaj} />}
      {modalIzmjenaKupac && <KupacModal kupac={modalIzmjenaKupac} onClose={() => setModalIzmjenaKupac(null)} onSacuvano={ucitaj} />}
      {modalNoviDobavljac && <DobavljacModal onClose={() => setModalNoviDobavljac(false)} onSacuvano={ucitaj} />}
      {modalIzmjenaDobavljac && <DobavljacModal dobavljac={modalIzmjenaDobavljac} onClose={() => setModalIzmjenaDobavljac(null)} onSacuvano={ucitaj} />}
      {modalNoviArtikal && <ArtikalModal onClose={() => setModalNoviArtikal(false)} onSacuvano={ucitaj} />}
      {modalIzmjenaArtikal && <ArtikalModal artikal={modalIzmjenaArtikal} onClose={() => setModalIzmjenaArtikal(null)} onSacuvano={ucitaj} />}
    </>
  );
}

function KupacModal({ kupac, onClose, onSacuvano }: { kupac?: Kupac; onClose: () => void; onSacuvano: () => void }) {
  const izmjena = !!kupac;
  const [naziv, setNaziv] = useState(kupac?.naziv ?? "");
  const [adresa, setAdresa] = useState(kupac?.adresa ?? "");
  const [telefon, setTelefon] = useState(kupac?.telefon ?? "");
  const [email, setEmail] = useState(kupac?.email ?? "");
  const [pib, setPib] = useState(kupac?.pib ?? "");
  const [adresaIsporuke, setAdresaIsporuke] = useState(kupac?.adresa_isporuke ?? "");
  const [greska, setGreska] = useState("");

  const posalji = async () => {
    try {
      const telo = { naziv, adresa: adresa || undefined, telefon, email: email || undefined, pib: pib.trim(), adresaIsporuke: adresaIsporuke || undefined };
      if (izmjena) await api(`/kupci/${kupac!.id}`, { method: "PATCH", telo });
      else await api("/kupci", { telo });
      onSacuvano();
      onClose();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Kupac nije sačuvan.");
    }
  };

  return (
    <Modal
      naslov={izmjena ? `Izmjena — ${kupac!.naziv}` : "Novi kupac"}
      onClose={onClose}
      greska={greska}
      footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={posalji} disabled={!naziv.trim() || telefon.trim().length < 6}>Sačuvaj</button></>}
    >
      <div className="form-grid">
        <label style={{ gridColumn: "1 / -1" }}>Naziv<input value={naziv} onChange={(e) => setNaziv(e.target.value)} /></label>
        <label>Telefon <ZakonskaOznaka clan="28" /><input value={telefon} onChange={(e) => setTelefon(e.target.value)} placeholder="obavezno — povlačenje počinje telefonom" /></label>
        <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>PIB<input value={pib} inputMode="numeric" onChange={(e) => setPib(e.target.value)} placeholder="pravno lice: 8 cifara" /></label>
        <label style={{ gridColumn: "1 / -1" }}>Adresa (sjedište)<input value={adresa} onChange={(e) => setAdresa(e.target.value)} /></label>
        <label style={{ gridColumn: "1 / -1" }}>Adresa isporuke (ako nije sjedište)<input value={adresaIsporuke} onChange={(e) => setAdresaIsporuke(e.target.value)} placeholder="ide na otpremnicu" /></label>
      </div>
    </Modal>
  );
}

function DobavljacModal({ dobavljac, onClose, onSacuvano }: { dobavljac?: Dobavljac; onClose: () => void; onSacuvano: () => void }) {
  const izmjena = !!dobavljac;
  const [naziv, setNaziv] = useState(dobavljac?.naziv ?? "");
  const [pib, setPib] = useState(dobavljac?.pib ?? "");
  const [adresa, setAdresa] = useState(dobavljac?.adresa ?? "");
  const [telefon, setTelefon] = useState(dobavljac?.telefon ?? "");
  const [email, setEmail] = useState(dobavljac?.email ?? "");
  const [greska, setGreska] = useState("");

  const posalji = async () => {
    try {
      const telo = { naziv, pib: pib || undefined, adresa: adresa || undefined, telefon: telefon || undefined, email: email || undefined };
      if (izmjena) await api(`/dobavljaci/${dobavljac!.id}`, { method: "PATCH", telo });
      else await api("/dobavljaci", { telo });
      onSacuvano();
      onClose();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Dobavljač nije sačuvan.");
    }
  };

  return (
    <Modal
      naslov={izmjena ? `Izmjena — ${dobavljac!.naziv}` : "Novi dobavljač"}
      onClose={onClose}
      greska={greska}
      footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={posalji} disabled={!naziv.trim()}>Sačuvaj</button></>}
    >
      <div className="form-grid">
        <label style={{ gridColumn: "1 / -1" }}>Naziv<input value={naziv} onChange={(e) => setNaziv(e.target.value)} /></label>
        <label>PIB<input value={pib} onChange={(e) => setPib(e.target.value)} /></label>
        <label>Telefon<input value={telefon} onChange={(e) => setTelefon(e.target.value)} /></label>
        <label style={{ gridColumn: "1 / -1" }}>Email<input value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label style={{ gridColumn: "1 / -1" }}>Adresa<input value={adresa} onChange={(e) => setAdresa(e.target.value)} /></label>
      </div>
    </Modal>
  );
}

function ArtikalModal({ artikal, onClose, onSacuvano }: { artikal?: Artikal; onClose: () => void; onSacuvano: () => void }) {
  const izmjena = !!artikal;
  const [naziv, setNaziv] = useState(artikal?.naziv ?? "");
  const [jedinicaMjere, setJedinicaMjere] = useState(artikal?.jedinica_mjere ?? "kom");
  const [tempKontrolisano, setTempKontrolisano] = useState(artikal?.temp_kontrolisano ?? false);
  const [tempMin, setTempMin] = useState(artikal?.temp_min ?? "");
  const [tempMax, setTempMax] = useState(artikal?.temp_max ?? "");
  const [rokTrajanjaDana, setRokTrajanjaDana] = useState(artikal?.rok_trajanja_dana?.toString() ?? "");
  const [granicaPotvrdio, setGranicaPotvrdio] = useState(artikal?.granica_potvrdio ?? false);
  const [rokObavezan, setRokObavezan] = useState(artikal?.rok_obavezan ?? true);
  const [greska, setGreska] = useState("");

  const posalji = async () => {
    try {
      const telo = {
        naziv,
        jedinicaMjere,
        tempKontrolisano,
        tempMin: tempKontrolisano && tempMin !== "" ? Number(tempMin) : undefined,
        tempMax: tempKontrolisano && tempMax !== "" ? Number(tempMax) : undefined,
        rokTrajanjaDana: rokTrajanjaDana !== "" ? Number(rokTrajanjaDana) : undefined,
        granicaPotvrdio,
        rokObavezan,
      };
      if (izmjena) await api(`/artikli/${artikal!.id}`, { method: "PATCH", telo });
      else await api("/artikli", { telo });
      onSacuvano();
      onClose();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Artikal nije sačuvan.");
    }
  };

  return (
    <Modal
      naslov={izmjena ? `Izmjena — ${artikal!.naziv}` : "Novi artikal"}
      podnaslov={!izmjena ? "Temperaturna granica ostaje pretpostavka dok je klijent ne potvrdi" : undefined}
      onClose={onClose}
      greska={greska}
      footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={posalji} disabled={!naziv.trim()}>Sačuvaj</button></>}
    >
      <div className="form-grid">
        <label style={{ gridColumn: "1 / -1" }}>Naziv<input value={naziv} onChange={(e) => setNaziv(e.target.value)} /></label>
        <label>Jedinica mjere<input value={jedinicaMjere} onChange={(e) => setJedinicaMjere(e.target.value)} /></label>
        <label>Rok trajanja (dana)<input type="number" value={rokTrajanjaDana} onChange={(e) => setRokTrajanjaDana(e.target.value)} /></label>
        <label>
          Rok trajanja pri prijemu
          <select value={rokObavezan ? "da" : "ne"} onChange={(e) => setRokObavezan(e.target.value === "da")}>
            <option value="da">Obavezan (sa etikete ili otpremnice)</option>
            <option value="ne">Nije obavezan — izuzetak</option>
          </select>
        </label>
        <label>
          Temperaturno kontrolisan
          <select value={tempKontrolisano ? "da" : "ne"} onChange={(e) => setTempKontrolisano(e.target.value === "da")}>
            <option value="ne">Ne</option>
            <option value="da">Da</option>
          </select>
        </label>
        {tempKontrolisano && (
          <>
            <label>Min. temperatura (°C)<input type="number" step="0.1" value={tempMin} onChange={(e) => setTempMin(e.target.value)} /></label>
            <label>Maks. temperatura (°C)<input type="number" step="0.1" value={tempMax} onChange={(e) => setTempMax(e.target.value)} /></label>
            <label style={{ gridColumn: "1 / -1" }}>
              Granicu potvrdio klijent (ne pretpostavka konsultanta)
              <select value={granicaPotvrdio ? "da" : "ne"} onChange={(e) => setGranicaPotvrdio(e.target.value === "da")}>
                <option value="ne">Ne — automatska ocjena odstupanja se ne primjenjuje</option>
                <option value="da">Da</option>
              </select>
            </label>
          </>
        )}
      </div>
    </Modal>
  );
}

function SkladisteModal({ skladiste, onClose, onSacuvano }: { skladiste?: Skladiste; onClose: () => void; onSacuvano: () => void }) {
  const izmjena = !!skladiste;
  const [naziv, setNaziv] = useState(skladiste?.naziv ?? "");
  const [adresa, setAdresa] = useState(skladiste?.adresa ?? "");
  const [aktivan, setAktivan] = useState(skladiste?.aktivan ?? true);
  const [greska, setGreska] = useState("");

  const posalji = async () => {
    try {
      if (izmjena) await api(`/skladista/${skladiste!.id}`, { method: "PATCH", telo: { naziv, adresa: adresa || undefined, aktivan } });
      else await api("/skladista", { telo: { naziv, adresa: adresa || undefined } });
      onSacuvano();
      onClose();
    } catch (e) {
      setGreska(e instanceof ApiGreska ? e.message : "Skladište nije sačuvano.");
    }
  };

  return (
    <Modal
      naslov={izmjena ? `Izmjena — ${skladiste!.naziv}` : "Novo skladište"}
      onClose={onClose}
      greska={greska}
      footer={<><button className="secondary-button" onClick={onClose}>Otkaži</button><button className="primary-button" onClick={posalji} disabled={naziv.trim().length < 2}>Sačuvaj</button></>}
    >
      <div className="form-grid">
        <label style={{ gridColumn: "1 / -1" }}>Naziv<input value={naziv} onChange={(e) => setNaziv(e.target.value)} placeholder="npr. Magacin Bar" /></label>
        <label style={{ gridColumn: "1 / -1" }}>Adresa<input value={adresa} onChange={(e) => setAdresa(e.target.value)} /></label>
        {izmjena && (
          <label className="potvrda-red" style={{ gridColumn: "1 / -1" }}>
            <input type="checkbox" checked={aktivan} onChange={(e) => setAktivan(e.target.checked)} /> Aktivno — neaktivno se više ne nudi u prijemu i isporuci, ali ostaje u istoriji
          </label>
        )}
      </div>
    </Modal>
  );
}
