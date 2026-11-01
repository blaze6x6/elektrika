import { previousMonth } from "./validate";

export type ReportSchedule = { day: number; hour: number; minute: number };

export const DEFAULT_SCHEDULE: ReportSchedule = { day: 1, hour: 4, minute: 0 };

function int(v: string | undefined, min: number, max: number, def: number): number {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isInteger(n) && n >= min && n <= max ? n : def;
}

/** Termin iz nastavitev (dan 1–28, ura 0–23, minuta 0–59; neveljavno → privzeto 1. ob 4:00). */
export function readSchedule(s: Record<string, string>): ReportSchedule {
  return {
    day: int(s.report_day, 1, 28, DEFAULT_SCHEDULE.day),
    hour: int(s.report_hour, 0, 23, DEFAULT_SCHEDULE.hour),
    minute: int(s.report_minute, 0, 59, DEFAULT_SCHEDULE.minute),
  };
}

/**
 * Ali je mesečno poročilo (za PREJŠNJI mesec) zapadlo?
 * Zapadlo je, ko je lokalni čas dosegel nastavljeni termin v tekočem mesecu in poročilo za ta mesec še ni bilo poslano.
 * Če strežnik v terminu ni deloval, se poročilo pošlje ob prvem naslednjem preverjanju (do konca meseca).
 * `now` = lokalni čas (getDate/getHours …).
 */
export function reportDue(now: Date, sch: ReportSchedule, alreadySentFor: (month: string) => boolean): { due: boolean; month: string } {
  const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const month = previousMonth(cur);
  const at = new Date(now.getFullYear(), now.getMonth(), sch.day, sch.hour, sch.minute, 0, 0);
  return { due: now.getTime() >= at.getTime() && !alreadySentFor(month), month };
}

/**
 * Ali je treba pred poročilom (od 1 h pred terminom naprej) še enkrat sinhronizirati prejšnji mesec?
 * Velja le, če poročilo še ni poslano in predsinhronizacija za ta mesec še ni bila zagnana.
 */
export function presyncDue(
  now: Date,
  sch: ReportSchedule,
  alreadySentFor: (month: string) => boolean,
  alreadyPresynced: (month: string) => boolean,
): { due: boolean; month: string } {
  const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const month = previousMonth(cur);
  const at = new Date(now.getFullYear(), now.getMonth(), sch.day, sch.hour, sch.minute, 0, 0);
  const from = at.getTime() - 3_600_000;
  return { due: now.getTime() >= from && !alreadySentFor(month) && !alreadyPresynced(month), month };
}
