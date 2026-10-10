"use client";

import { useEffect, useState } from "react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";
import { sl } from "date-fns/locale";
import { blockForHour, dayOfWeek, isHighSeasonMonth, isPublicHoliday, type Block } from "@/lib/blocks";

/** Barve blokov (enake povsod; številka bloka je vedno izpisana, barva ni edini nosilec informacije). */
const BG: Record<number, string> = { 1: "bg-red-500", 2: "bg-orange-400", 3: "bg-yellow-400", 4: "bg-sky-400", 5: "bg-emerald-400" };
const DOT: Record<number, string> = { 1: "bg-red-500", 2: "bg-orange-400", 3: "bg-yellow-400", 4: "bg-sky-400", 5: "bg-emerald-400" };

type Segment = { block: Block; from: number; to: number };

const hh = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
/** Konec odseka: 24 se izpiše kot 00:00 (polnoč). */
const hhEnd = (h: number) => (h === 24 ? "24:00" : hh(h));

/** 24 ur → strnjeni odseki (od–do), brez združevanja čez polnoč. */
function segmentsFor(date: string): Segment[] {
  const out: Segment[] = [];
  for (let h = 0; h < 24; h++) {
    const b = blockForHour(date, h);
    const last = out[out.length - 1];
    if (last && last.block === b) last.to = h + 1;
    else out.push({ block: b, from: h, to: h + 1 });
  }
  return out;
}

/** Imena dela prostih dni (za oznako). */
function dayKind(date: string): { nonWorking: boolean; label: string } {
  const dow = dayOfWeek(date);
  const holiday = isPublicHoliday(date);
  if (holiday && dow !== 0 && dow !== 6) return { nonWorking: true, label: "praznik" };
  if (holiday) return { nonWorking: true, label: dow === 0 ? "nedelja + praznik" : "sobota + praznik" };
  if (dow === 0) return { nonWorking: true, label: "nedelja" };
  if (dow === 6) return { nonWorking: true, label: "sobota" };
  return { nonWorking: false, label: "delovni dan" };
}

export default function BlockTimeline({
  month,
  prices,
  dayBlocks,
}: {
  month: Date;
  /** Cene omrežnine za energijo po blokih [€/kWh] – za oznako najcenejšega/najdražjega bloka. */
  prices: number[];
  /** Uvoz po blokih za dan (kWh), če so podatki (MojElektro). */
  dayBlocks?: (date: string) => number[];
}) {
  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) }).map(d => format(d, "yyyy-MM-dd"));
  const [now, setNow] = useState<Date | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const today = now ? format(now, "yyyy-MM-dd") : null;
  // Izbran dan: ročna izbira, sicer danes (če je v tem mesecu), sicer prvi dan meseca.
  const sel = selected && days.includes(selected) ? selected : today && days.includes(today) ? today : days[0];
  const idx = days.indexOf(sel);
  const selDate = new Date(sel + "T12:00:00");
  const kind = dayKind(sel);
  const high = isHighSeasonMonth(selDate.getMonth() + 1);
  const segs = segmentsFor(sel);

  // Izpis po blokih: vsi razponi (zvečer + zjutraj sta ločena odseka istega bloka).
  const occurring = Array.from(new Set(segs.map(s => s.block))).sort() as Block[];
  const rangesOf = (b: Block) => {
    const r = segs.filter(s => s.block === b);
    // večer + jutro istega bloka se prikažeta kot en razpon čez polnoč (npr. 22:00–06:00)
    if (r.length > 1 && r[0].from === 0 && r[r.length - 1].to === 24) {
      const first = r[0], last = r[r.length - 1];
      return [{ block: b, from: last.from, to: first.to }, ...r.slice(1, -1)].sort((a, c) => a.from - c.from);
    }
    return r;
  };
  const hoursOf = (b: Block) => segs.filter(s => s.block === b).reduce((a, s) => a + (s.to - s.from), 0);
  const priceOf = (b: Block) => prices[b - 1] ?? 0;
  const priced = occurring.filter(b => priceOf(b) > 0);
  const cheapest = priced.length > 1 ? priced.reduce((a, b) => (priceOf(b) < priceOf(a) ? b : a)) : null;
  const priciest = priced.length > 1 ? priced.reduce((a, b) => (priceOf(b) > priceOf(a) ? b : a)) : null;
  const kwh = dayBlocks ? dayBlocks(sel) : null;
  const hasKwh = !!kwh && kwh.some(v => v > 0);

  // Trenutni blok in naslednja menjava (samo za današnji dan).
  const nowH = now && sel === today ? now.getHours() : null;
  const nowFrac = now && sel === today ? (now.getHours() * 60 + now.getMinutes()) / 1440 : null;
  let nowInfo: string | null = null;
  if (nowH !== null) {
    const cur = blockForHour(sel, nowH);
    const seg = segs.find(s => nowH >= s.from && nowH < s.to)!;
    let untilH = seg.to;
    let next: Block | null = untilH < 24 ? blockForHour(sel, untilH) : null;
    if (untilH === 24) {
      // do polnoči – naslednji dan lahko drugačen (vikend/praznik)
      const nd = new Date(selDate); nd.setDate(nd.getDate() + 1);
      next = blockForHour(format(nd, "yyyy-MM-dd"), 0);
      untilH = 24;
    }
    nowInfo = `Zdaj: blok ${cur}${next && next !== cur ? ` · do ${hh(untilH)} nato blok ${next}` : ` · do ${hh(untilH)}`}`;
  }

  const go = (delta: number) => {
    const n = idx + delta;
    if (n >= 0 && n < days.length) setSelected(days[n]);
  };

  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <h3 className="text-sm font-bold mb-1 flex items-center gap-2">
        🕒 Časovnica blokov <span className="text-[10px] font-normal text-gray-400">(informativno)</span>
      </h3>
      <p className="text-[11px] text-gray-500 mb-3">
        Bloki se spreminjajo glede na sezono in vrsto dneva. Ob koncih tedna in praznikih velja blok z eno številko višje (cenejši).
      </p>

      {/* Izbira dneva */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <button onClick={() => go(-1)} disabled={idx <= 0} className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-30 text-sm" aria-label="Prejšnji dan">‹</button>
        <div className="text-center">
          <div className="text-sm font-bold capitalize">{format(selDate, "EEEE, d. MMMM", { locale: sl })}</div>
          <div className="text-[10px] mt-0.5 flex flex-wrap justify-center gap-1">
            <span className={`px-1.5 py-0.5 rounded ${kind.nonWorking ? "bg-purple-900/40 text-purple-300" : "bg-gray-700 text-gray-300"}`}>{kind.label}</span>
            <span className={`px-1.5 py-0.5 rounded ${high ? "bg-red-900/40 text-red-300" : "bg-yellow-900/30 text-yellow-300"}`}>{high ? "višja sezona" : "nižja sezona"}</span>
            {sel === today && <span className="px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-300">danes</span>}
          </div>
        </div>
        <button onClick={() => go(1)} disabled={idx >= days.length - 1} className="px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-30 text-sm" aria-label="Naslednji dan">›</button>
      </div>

      {/* 24-urni trak */}
      <div className="relative mt-3 mb-1">
        <div className="flex h-9 rounded-lg overflow-hidden border border-gray-700">
          {Array.from({ length: 24 }, (_, h) => {
            const b = blockForHour(sel, h);
            return (
              <div key={h} title={`${hh(h)}–${hh(h + 1)}: blok ${b}`} className={`flex-1 ${BG[b]} text-gray-900 text-[9px] font-bold flex items-center justify-center border-r border-black/10 last:border-r-0`}>
                {b}
              </div>
            );
          })}
        </div>
        {nowFrac !== null && (
          <div className="absolute top-[-4px] bottom-[-4px] w-0.5 bg-white shadow" style={{ left: `${nowFrac * 100}%` }} aria-hidden />
        )}
        <div className="flex justify-between text-[9px] text-gray-500 mt-1 px-0.5">
          {[0, 3, 6, 9, 12, 15, 18, 21, 24].map(h => <span key={h}>{h}</span>)}
        </div>
      </div>

      {nowInfo && <div className="text-xs text-center text-blue-300 mb-2">{nowInfo}</div>}

      {/* Legenda z urami */}
      <div className="space-y-1.5 mt-2">
        {occurring.map(b => (
          <div key={b} className="flex items-center gap-2 rounded-lg border border-gray-700 px-2 py-1.5">
            <span className={`w-5 h-5 shrink-0 rounded text-[11px] font-bold text-gray-900 flex items-center justify-center ${DOT[b]}`}>{b}</span>
            <div className="flex-1 min-w-0">
              <div className="text-xs">
                {rangesOf(b).map((s, i) => (
                  <span key={i}>{i > 0 && <span className="text-gray-600"> · </span>}{hh(s.from)}–{hhEnd(s.to)}</span>
                ))}
              </div>
              <div className="text-[10px] text-gray-500">
                {hoursOf(b)} h
                {priceOf(b) > 0 && <> · omrežnina {priceOf(b).toFixed(4).replace(".", ",")} €/kWh</>}
              </div>
            </div>
            <div className="text-right shrink-0">
              {b === cheapest && <div className="text-[10px] text-green-400">najcenejši</div>}
              {b === priciest && <div className="text-[10px] text-red-400">najdražji</div>}
              {hasKwh && <div className="text-[10px] text-gray-400">{(kwh![b - 1] ?? 0).toFixed(1).replace(".", ",")} kWh</div>}
            </div>
          </div>
        ))}
      </div>

      {cheapest && (
        <div className="mt-3 text-[11px] rounded-lg bg-green-900/20 border border-green-800 px-3 py-2 text-green-300">
          💡 Najcenejši čas za polnjenje avta, pralni stroj ipd.:{" "}
          <strong>{rangesOf(cheapest).map(s => `${hh(s.from)}–${hhEnd(s.to)}`).join(", ")}</strong> (blok {cheapest}).
        </div>
      )}

      {/* Pregled meseca */}
      <details className="mt-3">
        <summary className="text-xs text-gray-400 cursor-pointer select-none">Pregled celega meseca (po dnevih in urah)</summary>
        <div className="mt-2 overflow-x-auto">
          <div className="min-w-[320px]">
            <div className="flex items-center text-[8px] text-gray-500 mb-0.5">
              <span className="w-14 shrink-0" />
              <div className="flex flex-1 justify-between px-0.5">{[0, 6, 12, 18, 24].map(h => <span key={h}>{h}</span>)}</div>
            </div>
            {days.map(d => {
              const k = dayKind(d);
              const dt = new Date(d + "T12:00:00");
              const isSel = d === sel;
              return (
                <button
                  key={d}
                  onClick={() => setSelected(d)}
                  className={`w-full flex items-center gap-1 py-px rounded ${isSel ? "ring-1 ring-blue-400" : "hover:bg-gray-700/50"}`}
                  aria-label={`${d} ${k.label}`}
                >
                  <span className={`w-14 shrink-0 text-left text-[9px] pl-1 ${k.nonWorking ? "text-purple-300" : "text-gray-400"}`}>
                    {format(dt, "EEE d.", { locale: sl })}
                  </span>
                  <span className="flex flex-1 h-3 rounded-sm overflow-hidden">
                    {Array.from({ length: 24 }, (_, h) => <span key={h} className={`flex-1 ${BG[blockForHour(d, h)]}`} />)}
                  </span>
                </button>
              );
            })}
            <div className="flex flex-wrap gap-2 mt-2 text-[9px] text-gray-400">
              {[1, 2, 3, 4, 5].map(b => (
                <span key={b} className="flex items-center gap-1"><span className={`w-2.5 h-2.5 rounded-sm ${DOT[b]}`} />Blok {b}</span>
              ))}
              <span className="text-purple-300">vijolično = dela prost dan</span>
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}
