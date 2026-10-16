import { lokalniDatum } from "../lib/vrijeme";

/** Period za izvještaje i audit — prazno znači „bez granice“. Dani su po Podgorici (#11). */
export type Period = { od: string; do: string };

const dan = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const uDan = (s: string) => new Date(`${s}T12:00:00`);

/** Brzi izbori: danas, 7 dana, ovaj i prošli mjesec, ova godina, sve. */
function brzi(): { kod: string; naziv: string; period: Period }[] {
  const danas = lokalniDatum();
  const d = uDan(danas);
  const prije7 = new Date(d);
  prije7.setDate(d.getDate() - 6);
  const prvi = new Date(d.getFullYear(), d.getMonth(), 1, 12);
  const prosliPrvi = new Date(d.getFullYear(), d.getMonth() - 1, 1, 12);
  const prosliZadnji = new Date(d.getFullYear(), d.getMonth(), 0, 12);
  return [
    { kod: "danas", naziv: "Danas", period: { od: danas, do: danas } },
    { kod: "7", naziv: "7 dana", period: { od: dan(prije7), do: danas } },
    { kod: "mjesec", naziv: "Ovaj mjesec", period: { od: dan(prvi), do: danas } },
    { kod: "prosli", naziv: "Prošli mjesec", period: { od: dan(prosliPrvi), do: dan(prosliZadnji) } },
    { kod: "godina", naziv: "Ova godina", period: { od: `${d.getFullYear()}-01-01`, do: danas } },
    { kod: "sve", naziv: "Sve", period: { od: "", do: "" } },
  ];
}

const citljivo = (s: string) => uDan(s).toLocaleDateString("sr-Latn-ME");

/** Za zaglavlje štampe: „period: 01.09.2026. – 30.09.2026.“ */
export function opisPerioda(p: Period) {
  if (!p.od && !p.do) return "period: sve";
  if (p.od && p.do && p.od === p.do) return `dan: ${citljivo(p.od)}`;
  return `period: ${p.od ? citljivo(p.od) : "…"} – ${p.do ? citljivo(p.do) : "…"}`;
}

export function FilterVremena({ period, onChange, oznaka = "Period" }: { period: Period; onChange: (p: Period) => void; oznaka?: string }) {
  const izbori = brzi();
  const izabran = izbori.find((b) => b.period.od === period.od && b.period.do === period.do)?.kod;
  return (
    <div className="filter-bar filter-vremena no-print">
      <span className="filter-oznaka">{oznaka}</span>
      <div className="filter-tabs" style={{ margin: 0, flexWrap: "wrap" }}>
        {izbori.map((b) => (
          <button key={b.kod} className={izabran === b.kod ? "selected" : ""} onClick={() => onChange(b.period)}>
            {b.naziv}
          </button>
        ))}
      </div>
      <label>
        Od
        <input type="date" value={period.od} max={period.do || undefined} onChange={(e) => onChange({ ...period, od: e.target.value })} />
      </label>
      <label>
        Do
        <input type="date" value={period.do} min={period.od || undefined} onChange={(e) => onChange({ ...period, do: e.target.value })} />
      </label>
    </div>
  );
}
