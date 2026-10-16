import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { api, ApiGreska } from "../lib/api";

type Podaci = {
  firma: { naziv: string; pib: string | null; adresa: string | null; grad: string | null; telefon: string | null } | null;
  isporuka: {
    broj: string;
    datum_isporuke: string;
    status: string;
    napomena: string | null;
    updated_at: string;
    potvrdjeno_at: string | null;
    otkazano_at: string | null;
    razlog_otkaza: string | null;
    kupac_naziv: string;
    kupac_pib: string | null;
    kupac_adresa: string | null;
    kupac_adresa_isporuke: string | null;
    kupac_telefon: string;
    registarski_broj: string | null;
    skladiste_naziv: string | null;
    skladiste_adresa: string | null;
    vozac: string | null;
    pripremio: string | null;
    predao: string | null;
  };
  stavke: {
    sifra: string | null;
    artikal: string;
    jedinica_mjere: string;
    temp_kontrolisano: boolean;
    broj_lota: string;
    rok_trajanja: string | null;
    planirana_kolicina: string;
    isporucena_kolicina: string;
    odbijena_kolicina: string;
    razlog_odbijanja: string | null;
    temperatura_predaje: string | null;
  }[];
};

const datum = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join(".") + "." : "—");
const vrijeme = (iso: string | null) => (iso ? new Date(iso).toLocaleString("sr-Latn-ME", { dateStyle: "short", timeStyle: "short" }) : "—");
const broj = (n: string | null) => (n === null ? "" : Number(n).toLocaleString("sr-Latn-ME"));

/** Otpremnica za štampu (nalaz R-21): ide uz robu do kupca — lot, rok i temperatura za svaku stavku,
 * mjesta za potpis. Prateći list sledljivosti, NE fiskalni dokument. Na papiru stoji kad je isporuka
 * posljednji put izmijenjena, da se vidi je li odštampana verzija zastarjela. */
export function OtpremnicaStampa() {
  const { id } = useParams();
  const [p, setP] = useState<Podaci | null>(null);
  const [greska, setGreska] = useState("");

  useEffect(() => {
    api<Podaci>(`/isporuke/${id}/otpremnica`)
      .then(setP)
      .catch((e) => setGreska(e instanceof ApiGreska ? e.message : "Otpremnica nije učitana."));
  }, [id]);

  if (greska) return <p className="muted-text" style={{ padding: 20 }}>{greska}</p>;
  if (!p) return null;
  const i = p.isporuka;
  const predata = i.status === "POTVRDJENA" || i.status === "DJELIMICNA" || i.status === "ODBIJENA";
  const imaTemperaturu = p.stavke.some((s) => s.temp_kontrolisano);

  return (
    <div className="otpremnica">
      <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button className="primary-button" onClick={() => window.print()}><Printer size={15} /> Štampaj</button>
        <button className="secondary-button" onClick={() => window.close()}>Zatvori</button>
      </div>

      <div className="otp-zaglavlje">
        <div>
          <strong style={{ fontSize: 14 }}>{p.firma?.naziv ?? "— podaci firme nisu upisani —"}</strong>
          <div>{[p.firma?.adresa, p.firma?.grad].filter(Boolean).join(", ")}</div>
          <div>{p.firma?.pib ? `PIB ${p.firma.pib}` : ""}{p.firma?.telefon ? ` · tel. ${p.firma.telefon}` : ""}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="otp-naslov">OTPREMNICA</div>
          <div>br. <strong>{i.broj}</strong></div>
          <div>datum isporuke {datum(i.datum_isporuke)}</div>
        </div>
      </div>

      {i.status === "OTKAZANA" && (
        <div className="otp-otkazana">OTKAZANA {vrijeme(i.otkazano_at)} — {i.razlog_otkaza}. Roba ne ide po ovoj otpremnici.</div>
      )}

      <div className="otp-strane">
        <div>
          <div className="otp-oznaka">Kupac</div>
          <strong>{i.kupac_naziv}</strong>
          {i.kupac_pib && <div>PIB {i.kupac_pib}</div>}
          {i.kupac_adresa && <div>{i.kupac_adresa}</div>}
          <div>tel. {i.kupac_telefon}</div>
        </div>
        <div>
          <div className="otp-oznaka">Mjesto isporuke</div>
          <div>{i.kupac_adresa_isporuke ?? i.kupac_adresa ?? "—"}</div>
          <div className="otp-oznaka" style={{ marginTop: 8 }}>Iz magacina</div>
          <div>{i.skladiste_naziv ?? "—"}{i.skladiste_adresa ? `, ${i.skladiste_adresa}` : ""}</div>
        </div>
        <div>
          <div className="otp-oznaka">Prevoz</div>
          <div>Vozilo: {i.registarski_broj ?? "—"}</div>
          <div>Vozač: {i.vozac ?? "—"}</div>
          <div>Pripremio: {i.pripremio ?? "—"}</div>
        </div>
      </div>

      <table className="otp-tabela">
        <thead>
          <tr>
            <th>R.br.</th>
            <th>Šifra</th>
            <th>Artikal</th>
            <th>Lot / serija</th>
            <th>Rok trajanja</th>
            <th>JM</th>
            <th>Planirano</th>
            <th>Predato</th>
            <th>Odbijeno</th>
            {imaTemperaturu && <th>Temp. pri predaji</th>}
          </tr>
        </thead>
        <tbody>
          {p.stavke.map((s, n) => (
            <tr key={n}>
              <td>{n + 1}</td>
              <td>{s.sifra ?? ""}</td>
              <td>{s.artikal}{s.razlog_odbijanja ? <div className="otp-sitno">odbijeno: {s.razlog_odbijanja}</div> : null}</td>
              <td>{s.broj_lota}</td>
              <td>{datum(s.rok_trajanja)}</td>
              <td>{s.jedinica_mjere}</td>
              <td className="otp-broj">{broj(s.planirana_kolicina)}</td>
              {/* Prije predaje polja ostaju prazna — upisuju se rukom kod kupca, pa u aplikaciju pri potvrdi. */}
              <td className="otp-broj">{predata ? broj(s.isporucena_kolicina) : ""}</td>
              <td className="otp-broj">{predata ? broj(s.odbijena_kolicina) : ""}</td>
              {imaTemperaturu && <td className="otp-broj">{s.temp_kontrolisano ? (s.temperatura_predaje !== null ? `${broj(s.temperatura_predaje)} °C` : "____ °C") : "—"}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {i.napomena && <p><span className="otp-oznaka">Napomena: </span>{i.napomena}</p>}
      {predata && <p className="otp-sitno">Predaja potvrđena {vrijeme(i.potvrdjeno_at)}{i.predao ? ` — ${i.predao}` : ""}.</p>}

      <div className="otp-potpisi">
        <div>Robu izdao (magacin)<span /></div>
        <div>Robu preuzeo (vozač)<span /></div>
        <div>Robu primio (kupac) — ime, potpis, pečat<span /></div>
      </div>

      <p className="otp-sitno" style={{ marginTop: 18 }}>
        Prateći list isporuke radi sledljivosti (čl. 27 Zakona o bezbjednosti hrane, „Sl. list CG“ 59/2026) — nije fiskalni ni
        računovodstveni dokument. Verzija: isporuka izmijenjena {vrijeme(i.updated_at)} · odštampano {vrijeme(new Date().toISOString())}.
      </p>
    </div>
  );
}
