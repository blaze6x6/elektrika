"use client";

import ThemeSwitcher from "@/lib/ThemeSwitcher";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, RotateCcw, Scale } from "lucide-react";
import { DEFAULT_TARIFF } from "@/lib/tariff";
import { nettingCost, type NettingTariff } from "@/lib/netting";

type DailyRow = { date: string; columnKey: string; value: number };

const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "avg", "sep", "okt", "nov", "dec"];
const fmt = (n: number, d = 2) => n.toFixed(d).replace(".", ",");
const num = (s: string): number => {
  const n = Number(s.replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
};

function NumField({ label, value, onChange, unit, hint }: { label: string; value: string; onChange: (v: string) => void; unit: string; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-[10px] text-gray-400 mb-0.5">{label}</span>
      <span className="flex items-center gap-1">
        <input type="text" inputMode="decimal" value={value} onChange={e => onChange(e.target.value)}
          className="w-full bg-gray-700 px-2 py-1.5 rounded text-sm text-white" />
        <span className="text-[10px] text-gray-500 shrink-0">{unit}</span>
      </span>
      {hint && <span className="block text-[9px] text-gray-500 mt-0.5">{hint}</span>}
    </label>
  );
}

export default function YearlyClient() {
  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DailyRow[]>([]);
  const [tariff, setTariff] = useState<Record<string, number>>({});
  const [source, setSource] = useState<{ kind: string; fromYear?: number } | null>(null);

  // vnosna polja (predizpolnjena iz baze, ročno spremenljiva)
  const [uvoz, setUvoz] = useState("0");
  const [oddaja, setOddaja] = useState("0");
  const [dUvoz, setDUvoz] = useState("0");
  const [dOddaja, setDOddaja] = useState("0");
  const [cEnergija, setCEnergija] = useState("");
  const [cOmr, setCOmr] = useState("");
  const [odkup, setOdkup] = useState("0");

  const load = useCallback(async () => {
    setLoading(true);
    const [dRes, tRes] = await Promise.all([fetch(`/api/data?year=${year}`), fetch(`/api/tariff?year=${year}`)]);
    const d = ((await dRes.json()).data || []) as DailyRow[];
    const tj = await tRes.json();
    setRows(d);
    setTariff(tj.tariff || {});
    setSource(tj.source ?? null);
    setLoading(false);
  }, [year]);

  useEffect(() => { load(); }, [load]);

  // letne vsote in po mesecih iz baze
  const db = useMemo(() => {
    const sum = (k: string) => rows.filter(r => r.columnKey === k).reduce((a, r) => a + (r.value ?? 0), 0);
    const monthly = Array.from({ length: 12 }, (_, m) => {
      const pre = `${year}-${String(m + 1).padStart(2, "0")}`;
      const s = (k: string) => rows.filter(r => r.columnKey === k && r.date.startsWith(pre)).reduce((a, r) => a + (r.value ?? 0), 0);
      return { uvoz: s("me_uvoz"), oddaja: s("me_oddaja") };
    });
    const uvozDays = new Set(rows.filter(r => r.columnKey === "me_uvoz" && r.value > 0).map(r => r.date)).size;
    return {
      uvoz: sum("me_uvoz"), oddaja: sum("me_oddaja"), uvozDays, monthly,
      bloki: [1, 2, 3, 4, 5].map(b => sum(`me_blok${b}`)),
    };
  }, [rows, year]);

  // ob novih podatkih / spremembi leta ponastavi vnosna polja
  const reset = useCallback(() => {
    setUvoz(fmt(db.uvoz, 1)); setOddaja(fmt(db.oddaja, 1));
    setDUvoz("0"); setDOddaja("0");
    setCEnergija(""); setCOmr(""); setOdkup("0");
  }, [db]);
  useEffect(() => { if (!loading) reset(); }, [loading, reset]);

  const t = { ...DEFAULT_TARIFF, ...tariff } as unknown as NettingTariff;
  const tUsed: NettingTariff = {
    ...t,
    cena_energija_et: cEnergija.trim() !== "" ? num(cEnergija) : t.cena_energija_et,
    cena_omreznina_et: cOmr.trim() !== "" ? num(cOmr) : t.cena_omreznina_et,
  };

  const hasBlocks = db.bloki.reduce((a, b) => a + b, 0) > 0;
  const baseUvoz = num(uvoz);
  const baseOddaja = num(oddaja);
  const odkupCena = num(odkup);
  const scaleBlocks = (target: number) => {
    const s = db.bloki.reduce((a, b) => a + b, 0);
    return hasBlocks && s > 0 ? db.bloki.map(v => (v / s) * target) : undefined;
  };

  const base = nettingCost({ uvozKwh: baseUvoz, oddajaKwh: baseOddaja, blokiKwh: scaleBlocks(baseUvoz), odkupCena }, tUsed);
  const simUvoz = Math.max(0, baseUvoz + num(dUvoz));
  const simOddaja = Math.max(0, baseOddaja + num(dOddaja));
  const sim = nettingCost({ uvozKwh: simUvoz, oddajaKwh: simOddaja, blokiKwh: scaleBlocks(simUvoz), odkupCena }, tUsed);
  const isSim = num(dUvoz) !== 0 || num(dOddaja) !== 0;

  const noData = db.uvoz === 0 && db.oddaja === 0;
  let cum = 0;
  const monthRows = db.monthly.map((m, i) => { const neto = m.uvoz - m.oddaja; cum += neto; return { m: MONTHS[i], ...m, neto, cum }; });
  const daysInYear = (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 366 : 365;

  const Result = ({ title, r, accent }: { title: string; r: ReturnType<typeof nettingCost>; accent: string }) => (
    <div className="bg-gray-800 rounded-xl p-4 space-y-1">
      <h3 className={`text-sm font-bold mb-2 ${accent}`}>{title}</h3>
      <div className="flex justify-between text-xs"><span className="text-gray-400">Neto (uvoz − oddaja)</span><span>{fmt(r.neto, 1)} kWh</span></div>
      {r.neto > 0 ? (
        <>
          <div className="flex justify-between text-sm font-bold text-red-400"><span>Preveč porabljeno</span><span>{fmt(r.primanjkljajKwh, 1)} kWh</span></div>
          <div className="flex justify-between text-xs"><span className="text-gray-400">Energija ({fmt(r.cenaEnergija, 5)} €/kWh)</span><span>{fmt(r.energija)} €</span></div>
          <div className="flex justify-between text-xs"><span className="text-gray-400">Omrežnina ({fmt(r.cenaOmreznina, 5)} €/kWh{hasBlocks ? ", utež. po blokih" : ""})</span><span>{fmt(r.omreznina)} €</span></div>
          <div className="flex justify-between text-xs"><span className="text-gray-400">Prispevki + trošarina ({fmt(r.cenaOstalo, 5)} €/kWh)</span><span>{fmt(r.ostalo)} €</span></div>
          <div className="flex justify-between text-xs"><span className="text-gray-400">DDV ({fmt(tUsed.ddv_stopnja * 100, 0)} %)</span><span>{fmt(r.ddv)} €</span></div>
          <div className="flex justify-between text-sm font-bold border-t-2 border-gray-600 pt-2 mt-1"><span>Strošek poračuna</span><span>{fmt(r.skupaj)} €</span></div>
        </>
      ) : (
        <>
          <div className="flex justify-between text-sm font-bold text-green-400"><span>Presežek oddane energije</span><span>{fmt(r.visekKwh, 1)} kWh</span></div>
          <div className="flex justify-between text-sm font-bold border-t-2 border-gray-600 pt-2 mt-1"><span>Strošek poračuna</span><span>0,00 €</span></div>
          {odkupCena > 0 && <div className="flex justify-between text-xs"><span className="text-gray-400">Izkupiček presežka ({fmt(odkupCena, 4)} €/kWh)</span><span>{fmt(r.odkup)} €</span></div>}
        </>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <header className="bg-gray-800 p-4 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <Link href="/calculator" className="text-gray-400 hover:text-white"><ArrowLeft size={20} /></Link>
          <h1 className="text-lg font-bold flex items-center gap-2"><Scale size={20} /> Letni poračun</h1>
        </div>
        <ThemeSwitcher />
      </header>

      <main className="p-3 max-w-2xl mx-auto space-y-4">
        <div className="flex items-center justify-center gap-2">
          <button onClick={() => setYear(y => y - 1)} className="p-2 bg-gray-800 rounded-full hover:bg-gray-700" aria-label="Prejšnje leto"><ChevronLeft size={18} /></button>
          <span className="text-lg font-bold">{year}</span>
          <button onClick={() => setYear(y => y + 1)} className="p-2 bg-gray-800 rounded-full hover:bg-gray-700" aria-label="Naslednje leto"><ChevronRight size={18} /></button>
        </div>

        {loading ? <div className="text-center text-gray-500 py-8">Nalaganje...</div> : (
          <>
            <div className="bg-gray-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold">Vhodni podatki</h3>
                <button onClick={reset} className="flex items-center gap-1 text-[11px] bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded"><RotateCcw size={12} /> Ponastavi na podatke iz baze</button>
              </div>
              {noData
                ? <p className="text-[11px] text-yellow-400">Za leto {year} v bazi ni MojElektro podatkov (uvoz/oddaja) – vnesi vrednosti ročno (npr. z letnega računa).</p>
                : <p className="text-[10px] text-gray-500">Iz baze: {db.uvozDays} dni z uvozom od {daysInYear}.{db.uvozDays < daysInYear - 3 && " Manjkajo dnevi, zato je uvoz lahko prenizek – preveri ali vnesi ročno."}</p>}
              <div className="grid grid-cols-2 gap-3">
                <NumField label="Prevzeto iz omrežja (A+)" value={uvoz} onChange={setUvoz} unit="kWh" />
                <NumField label="Oddano v omrežje (A−)" value={oddaja} onChange={setOddaja} unit="kWh" />
              </div>
            </div>

            <div className="bg-gray-800 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-bold">Simulacija (neobvezno)</h3>
              <div className="grid grid-cols-2 gap-3">
                <NumField label="Dodatni prevzem (+ / −)" value={dUvoz} onChange={setDUvoz} unit="kWh" hint="npr. +500: več porabe iz omrežja" />
                <NumField label="Dodatna oddaja (+ / −)" value={dOddaja} onChange={setDOddaja} unit="kWh" hint="npr. +800: večja elektrarna" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <NumField label="Cena energije" value={cEnergija} onChange={setCEnergija} unit="€/kWh" hint={`tarifa ${year}: ${fmt(t.cena_energija_et, 5)}`} />
                <NumField label="Omrežnina (pavšal)" value={cOmr} onChange={setCOmr} unit="€/kWh" hint={hasBlocks ? "bloki imajo prednost" : `tarifa: ${fmt(t.cena_omreznina_et, 5)}`} />
                <NumField label="Odkup presežka" value={odkup} onChange={setOdkup} unit="€/kWh" hint="privzeto 0" />
              </div>
              <p className="text-[10px] text-gray-500">
                Cene so iz tarife za leto {year}
                {source?.kind === "inherited" ? ` (prenesene iz ${source.fromYear})` : source?.kind === "year" ? "" : " (splošne/privzete)"}; prazno polje = vrednost iz tarife.
                Spremembe tu se ne shranjujejo.
              </p>
            </div>

            <Result title={`Leto ${year} – dejansko / vneseno`} r={base} accent="text-blue-400" />
            {isSim && (
              <>
                <Result title="Simulacija" r={sim} accent="text-purple-400" />
                <div className="bg-gray-800 rounded-xl p-4 flex justify-between text-sm font-bold">
                  <span>Razlika (simulacija − vneseno)</span>
                  <span className={sim.skupaj - base.skupaj > 0 ? "text-red-400" : "text-green-400"}>{sim.skupaj - base.skupaj > 0 ? "+" : ""}{fmt(sim.skupaj - base.skupaj)} €</span>
                </div>
              </>
            )}

            {!noData && (
              <div className="bg-gray-800 rounded-xl p-4">
                <h3 className="text-sm font-bold mb-2">Po mesecih (iz baze)</h3>
                <table className="w-full text-[11px]">
                  <thead><tr className="text-gray-500 text-right"><th className="text-left font-normal">Mesec</th><th className="font-normal">Uvoz</th><th className="font-normal">Oddaja</th><th className="font-normal">Neto</th><th className="font-normal">Kumul.</th></tr></thead>
                  <tbody>
                    {monthRows.map(r => (
                      <tr key={r.m} className="text-right border-t border-gray-700">
                        <td className="text-left py-1">{r.m}</td>
                        <td>{fmt(r.uvoz, 0)}</td><td>{fmt(r.oddaja, 0)}</td>
                        <td className={r.neto > 0 ? "text-red-400" : "text-green-400"}>{fmt(r.neto, 0)}</td>
                        <td className={r.cum > 0 ? "text-red-400" : "text-green-400"}>{fmt(r.cum, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[10px] text-gray-500 mt-2">kWh. Rdeče = več prevzeto kot oddano.</p>
              </div>
            )}

            <p className="text-[10px] text-gray-500 px-1">
              ⚠️ Ocena: primanjkljaj (uvoz − oddaja) obračunamo po ceni energije, omrežnini (uteženi po blokih uvoza, če so podatki), prispevkih in trošarini ter DDV.
              Dejanski poračun dobavitelja je lahko drugačen (pogoji pogodbe, obračun po obdobjih, odkup presežka).
            </p>
          </>
        )}
      </main>
    </div>
  );
}
