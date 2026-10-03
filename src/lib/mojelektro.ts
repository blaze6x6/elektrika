/**
 * Mojelektro.si API integracija
 * Dokumentacija: https://docs.informatika.si/mojelektro/api/
 */

const BASE_URL = "https://api.informatika.si/mojelektro/v1";

// ReadingType kode za 15-minutne intervale (A+ = uvoz)
const READING_TYPE_15MIN_INPUT = "32.0.2.4.1.2.12.0.0.0.0.0.0.0.0.3.72.0";
// ReadingType kode za dnevne bloke (A+ per block)
const READING_TYPE_BLOK_1 = "32.0.2.4.1.2.12.0.0.0.0.11.0.0.0.3.72.0";
const READING_TYPE_BLOK_2 = "32.0.2.4.1.2.12.0.0.0.0.12.0.0.0.3.72.0";
const READING_TYPE_BLOK_3 = "32.0.2.4.1.2.12.0.0.0.0.13.0.0.0.3.72.0";
const READING_TYPE_BLOK_4 = "32.0.2.4.1.2.12.0.0.0.0.14.0.0.0.3.72.0";
const READING_TYPE_BLOK_5 = "32.0.2.4.1.2.12.0.0.0.0.15.0.0.0.3.72.0";
// A- (Oddaja v omrežje - skupno)
const READING_TYPE_EXPORT_TOTAL = "32.0.4.1.19.2.12.0.0.0.0.0.0.0.0.3.72.0";

// Definicija blokov
export const BLOCKS = [
  { blok: 1, readingType: READING_TYPE_BLOK_1 },
  { blok: 2, readingType: READING_TYPE_BLOK_2 },
  { blok: 3, readingType: READING_TYPE_BLOK_3 },
  { blok: 4, readingType: READING_TYPE_BLOK_4 },
  { blok: 5, readingType: READING_TYPE_BLOK_5 },
  { blok: 0, readingType: READING_TYPE_EXPORT_TOTAL, key: "me_oddaja" },
];

type IntervalReading = { d: string; v: string | number };
type IntervalBlock = {
  readingType: string;
  intervalReadings: IntervalReading[];
};

export type DayBlockData = {
  date: string;
  blok1: number;
  blok2: number;
  blok3: number;
  blok4: number;
  blok5: number;
  uvoz: number;    // skupni uvoz (A+)
};

/**
 * Pridobi 15-minutne meritve za določeno obdobje
 */
export async function fetchMeterReadings(
  token: string,
  usagePoint: string,
  startTime: string,
  endTime: string,
  options: string[] = []
): Promise<IntervalBlock[] | null> {
  const params = new URLSearchParams({
    usagePoint,
    startTime,
    endTime,
  });

  for (const opt of options) {
    params.append("option", opt);
  }

  const url = `${BASE_URL}/meter-readings?${params.toString()}`;

  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "X-API-TOKEN": token,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body.substring(0, 200)}`);
  }

  const data = await res.json();
  return data.intervalBlocks ?? null;
}

/**
 * Pridobi dnevno porabo po blokih za mesec
 * Vrne mapo datum -> { blok1..5, uvoz }
 */
export type DayBlockDataExtended = DayBlockData & { oddaja: number };

export async function fetchMonthBlockData(
  token: string,
  usagePoint: string,
  month: string // YYYY-MM
): Promise<Map<string, DayBlockDataExtended>> {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const startTime = `${month}-01`;
  const endTime = `${month}-${String(lastDay).padStart(2, "0")}`;

  const blockOptions = BLOCKS.map(b => `ReadingType=${b.readingType}`);

  const blocks = await fetchMeterReadings(token, usagePoint, startTime, endTime, blockOptions);
  const result = new Map<string, DayBlockDataExtended>();
  if (!blocks) return result;

  for (const block of blocks) {
    const blokDef = BLOCKS.find(b => b.readingType === block.readingType);
    if (!blokDef) continue;

    for (const reading of block.intervalReadings ?? []) {
      const dateStr = String(reading.d).split(/[T ]/)[0];
      const val = parseFloat(String(reading.v)) || 0;

      if (!result.has(dateStr)) {
        result.set(dateStr, { date: dateStr, blok1: 0, blok2: 0, blok3: 0, blok4: 0, blok5: 0, uvoz: 0, oddaja: 0 });
      }
      const day = result.get(dateStr)!;
      
      if (blokDef.blok > 0) {
        const blokKey = `blok${blokDef.blok}` as keyof DayBlockData;
        (day[blokKey] as number) = val;
      } else if (blokDef.key === "me_oddaja") {
        day.oddaja = val;
      }
    }
  }

  // Izračunaj skupni uvoz po dnevih (vsota blokov)
  for (const day of result.values()) {
    day.uvoz = day.blok1 + day.blok2 + day.blok3 + day.blok4 + day.blok5;
  }

  return result;
}

/**
 * Parsira odgovor merilne točke in vrne aktualne dogovorjene moči
 */
export function extractContractedPower(data: any): Record<string, number> | null {
  const list = data?.dogovorjeneMoci;
  if (!Array.isArray(list)) return null;
  
  // Poiščemo zadnji veljaven vnos (veljavnost: true)
  const active = list.filter(i => i.veljavnost === true).sort((a, b) => 
    new Date(b.datumOd).getTime() - new Date(a.datumOd).getTime()
  )[0];

  if (!active) return null;

  return {
    moc_blok1: parseFloat(active.casovniBlok1) || 0,
    moc_blok2: parseFloat(active.casovniBlok2) || 0,
    moc_blok3: parseFloat(active.casovniBlok3) || 0,
    moc_blok4: parseFloat(active.casovniBlok4) || 0,
    moc_blok5: parseFloat(active.casovniBlok5) || 0,
  };
}

/**
 * Pridobi podatke o merilnem mestu
 */
export async function fetchMerilnoMesto(
  token: string,
  identifikator: string
): Promise<Record<string, unknown> | null> {
  const url = `${BASE_URL}/merilno-mesto/${identifikator}`;
  const res = await fetch(url, {
    headers: { accept: "application/json", "X-API-TOKEN": token },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function fetchMerilnaTocka(
  token: string,
  gsrn: string
): Promise<Record<string, unknown> | null> {
  const url = `${BASE_URL}/merilna-tocka/${gsrn}`;
  const res = await fetch(url, {
    headers: { accept: "application/json", "X-API-TOKEN": token },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function fetchReadingTypes(token: string): Promise<unknown[] | null> {
  const url = `${BASE_URL}/reading-type`;
  const res = await fetch(url, {
    headers: { accept: "application/json", "X-API-TOKEN": token },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function fetchReadingQualities(token: string): Promise<unknown[] | null> {
  const url = `${BASE_URL}/reading-qualities`;
  const res = await fetch(url, {
    headers: { accept: "application/json", "X-API-TOKEN": token },
  });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Sezona za mesec:
 * Višja (bloki 1-4): Nov (11), Dec (12), Jan (1), Feb (2)
 * Nižja (bloki 2-5): Mar (3) - Okt (10)
 */
export function isSezoneVisja(month: number): boolean {
  return month === 11 || month === 12 || month === 1 || month === 2;
}

/**
 * Aktivni bloki za mesec (višja: 1-4, nižja: 2-5)
 */
export function aktivniBloki(month: number): number[] {
  return isSezoneVisja(month) ? [1, 2, 3, 4] : [2, 3, 4, 5];
}

/**
 * Izračun stroškov dogovorjene moči za en dan
 * tariff: objekt s cenami in dogovorjenimi močmi
 */
export function izracunDogMoc(
  month: number,
  tariff: Record<string, number>
): number {
  const bloki = aktivniBloki(month);
  let sum = 0;
  for (const b of bloki) {
    const moc = tariff[`moc_blok${b}`] ?? 7.2;
    const cena = tariff[`cena_moc_blok${b}`] ?? 0;
    sum += moc * cena;
  }
  return sum;
}
