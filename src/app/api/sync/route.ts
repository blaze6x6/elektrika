import { NextResponse } from "next/server";
import { requireCronOrUser } from "@/lib/guard";
import { logAction } from "@/lib/audit";
import { badRequest, fetchT, readJson, redactUrl } from "@/lib/http";
import { Cooldown } from "@/lib/rate-limit";
import { isValidMonth, monthRange, daysInMonth } from "@/lib/validate";
import { upsertDailyValues, type DailyInput } from "@/lib/sync-store";
import { hourlyWhToBlocks } from "@/lib/blocks";

const cooldown = new Cooldown(30_000); // zaščita kvote zunanjih API-jev (SolarEdge ~300/dan)

type Step = { results: string[]; rows: DailyInput[]; failed: boolean };

const dayOf = (d: unknown) => String(d).split(/[ T]/)[0];
const toKwh = (v: unknown) => parseFloat((Number(v) / 1000).toFixed(3));

// ══════════════════════════════════════════
// SolarEdge
// ══════════════════════════════════════════
async function syncSolarEdge(site: string, apiKey: string, month: string): Promise<Step> {
  const out: Step = { results: [], rows: [], failed: false };
  const { start, end } = monthRange(month);
  const startTime = `${start} 00:00:00`;
  const endTime = `${end} 23:59:59`;
  const base = `https://monitoringapi.solaredge.com/site/${encodeURIComponent(site)}`;
  const key = `api_key=${encodeURIComponent(apiKey)}`;

  try {
    // 1. Proizvodnja
    const prodUrl = `${base}/energy?timeUnit=DAY&startDate=${start}&endDate=${end}&${key}`;
    const prodRes = await fetchT(prodUrl);
    if (!prodRes.ok) throw new Error(`proizvodnja HTTP ${prodRes.status}`);
    const prodJson = await prodRes.json();

    let prodCount = 0;
    if (prodJson.energy?.values) {
      for (const item of prodJson.energy.values) {
        if (item.value !== null && item.date) {
          out.rows.push({ date: dayOf(item.date), columnKey: "solarna", value: toKwh(item.value) });
          prodCount++;
        }
      }
      out.results.push(`✅ SolarEdge proizvodnja: ${prodCount} dni`);
    } else {
      console.warn("[sync] SolarEdge energy brez podatkov:", redactUrl(prodUrl));
      out.results.push("⚠️ SolarEdge proizvodnja: ni podatkov");
    }

    // 2. Poraba (energyDetails, nato /meters kot rezerva)
    const cons: DailyInput[] = [];
    const purchased: DailyInput[] = [];
    const meterTypes: string[] = [];
    let status = 0;
    let apiCode: unknown;

    const collect = (meters: Array<Record<string, unknown>>) => {
      for (const meter of meters) {
        const type = String(meter.type || meter.meterType || "");
        meterTypes.push(type);
        const values = Array.isArray(meter.values) ? (meter.values as Array<Record<string, unknown>>) : [];
        const target = type.toLowerCase() === "consumption" ? cons : type.toLowerCase() === "purchased" ? purchased : null;
        if (!target) continue;
        for (const item of values) {
          if (item.value !== null && item.value !== undefined && item.date) {
            target.push({ date: dayOf(item.date), columnKey: "skupna_poraba", value: toKwh(item.value) });
          }
        }
      }
    };

    const detailUrl = `${base}/energyDetails?timeUnit=DAY&meters=Consumption,Purchased,Production,FeedIn&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}&${key}`;
    const detailRes = await fetchT(detailUrl);
    status = detailRes.status;
    const detailJson = await detailRes.json().catch(() => ({}));
    apiCode = detailJson.code;
    if (detailJson.energyDetails?.meters) collect(detailJson.energyDetails.meters);

    if (cons.length === 0) {
      try {
        const metersUrl = `${base}/meters?timeUnit=DAY&meters=Consumption,Purchased&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}&${key}`;
        const metersRes = await fetchT(metersUrl);
        const metersJson = await metersRes.json().catch(() => ({}));
        if (metersJson.meterEnergyDetails?.meters) collect(metersJson.meterEnergyDetails.meters);
      } catch {
        // rezerva ni uspela – spodaj poročamo
      }
    }

    if (cons.length > 0) {
      out.rows.push(...cons);
      out.results.push(`✅ SolarEdge skupna poraba: ${cons.length} dni`);
    } else if (purchased.length > 0) {
      out.rows.push(...purchased);
      out.results.push(
        `⚠️ SolarEdge: true 'Consumption' ni na voljo, uporabljen je bil 'Purchased' (${purchased.length} dni) – to pomeni uvoz iz omrežja, ne nujno celotna poraba.`
      );
    } else if (apiCode === 403 || status === 403) {
      out.results.push("⚠️ SolarEdge poraba: 403 napaka - endpoint za porabo ni na voljo za ta SolarEdge račun/paket.");
    } else {
      out.results.push(`⚠️ SolarEdge poraba: ni podatkov. Najdeni tipi meril: ${meterTypes.join(", ") || "brez tipov"}`);
    }

    // 3. Samooskrba in uvoz iz omrežja po urah → časovni bloki (potrebuje merilnik porabe/izvoza na lokaciji).
    //    SelfConsumption = kar smo porabili neposredno iz sonca; Purchased = uvoz (služi za kontrolo proti MojElektro).
    try {
      const selfUrl = `${base}/energyDetails?timeUnit=HOUR&meters=SelfConsumption,Purchased&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}&${key}`;
      const selfRes = await fetchT(selfUrl);
      const selfJson = await selfRes.json().catch(() => ({}));
      const meters: Array<Record<string, unknown>> = selfJson?.energyDetails?.meters ?? [];
      const perMeter = (type: string) => {
        const m = meters.find((x) => String(x.type).toLowerCase() === type);
        const values = (Array.isArray(m?.values) ? m.values : []) as Array<{ date: string; value: number | null }>;
        return hourlyWhToBlocks(values.map((v) => ({ date: String(v.date), value: v.value })));
      };
      const selfPerDay = perMeter("selfconsumption");
      const buyPerDay = perMeter("purchased");
      for (const [date, blocks] of selfPerDay) {
        blocks.forEach((kwh, i) => out.rows.push({ date, columnKey: `se_samo_blok${i + 1}`, value: kwh }));
      }
      for (const [date, blocks] of buyPerDay) {
        blocks.forEach((kwh, i) => out.rows.push({ date, columnKey: `se_kup_blok${i + 1}`, value: kwh }));
      }
      if (selfPerDay.size > 0) {
        out.results.push(`✅ SolarEdge samooskrba po blokih: ${selfPerDay.size} dni`);
      } else {
        out.results.push(
          `⚠️ SolarEdge samooskrba po urah: ni podatkov (HTTP ${selfRes.status}). Potreben je merilnik porabe; kalkulator bo uporabil oceno.`
        );
      }
      if (buyPerDay.size > 0) out.results.push(`✅ SolarEdge uvoz po blokih (za kontrolo): ${buyPerDay.size} dni`);
    } catch (e) {
      out.results.push(`⚠️ SolarEdge samooskrba po urah ni uspela: ${e instanceof Error ? e.message : "napaka"}`);
    }
  } catch (err) {
    out.failed = true;
    const msg = err instanceof Error ? err.message : "neznana napaka";
    console.error("[sync] SolarEdge:", msg);
    out.results.push(`❌ SolarEdge: ${msg}`);
  }
  return out;
}

// ══════════════════════════════════════════
// MELCloud
// ══════════════════════════════════════════
type MelCandidate = { deviceId: number; name: string; deviceType: string | number | null };

function findDevices(root: unknown): MelCandidate[] {
  const found = new Map<number, MelCandidate>();
  const visit = (value: unknown, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 12) return;
    const obj = value as Record<string, unknown>;
    const deviceId =
      typeof obj.DeviceID === "number" ? obj.DeviceID : typeof obj.DeviceId === "number" ? obj.DeviceId : null;
    const nested = obj.Device && typeof obj.Device === "object" ? (obj.Device as Record<string, unknown>) : null;
    const deviceType = nested?.DeviceType ?? obj.DeviceType ?? obj.Type ?? null;
    const name = String(obj.DeviceName ?? obj.Name ?? nested?.DeviceName ?? nested?.Name ?? `Device ${deviceId ?? "?"}`);
    if (deviceId) {
      found.set(deviceId, {
        deviceId,
        name,
        deviceType: typeof deviceType === "string" || typeof deviceType === "number" ? deviceType : null,
      });
    }
    for (const child of Object.values(obj)) {
      if (Array.isArray(child)) child.forEach((c) => visit(c, depth + 1));
      else if (child && typeof child === "object") visit(child, depth + 1);
    }
  };
  visit(root);
  return [...found.values()];
}

async function syncMelCloud(
  email: string,
  password: string,
  forcedDeviceId: string | undefined,
  month: string
): Promise<Step> {
  const out: Step = { results: [], rows: [], failed: false };
  const { start, end } = monthRange(month);
  const lastDay = daysInMonth(month);

  try {
    const loginRes = await fetchT("https://app.melcloud.com/Mitsubishi.Wifi.Client/Login/ClientLogin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        Email: email,
        Password: password,
        Language: 0,
        AppVersion: "1.32.1.0",
        Persist: false,
        CaptchaChallenge: "",
        CaptchaResponse: "",
      }),
    });
    const loginJson = await loginRes.json().catch(() => ({}));
    const contextKey = loginJson?.LoginData?.ContextKey;
    if (!contextKey) {
      console.warn("[sync] MELCloud prijava neuspešna, HTTP", loginRes.status);
      out.failed = true;
      out.results.push(`❌ MELCloud: Prijava neuspešna (HTTP ${loginRes.status}). Preveri e-pošto in geslo.`);
      return out;
    }

    const devRes = await fetchT("https://app.melcloud.com/Mitsubishi.Wifi.Client/User/ListDevices", {
      headers: { "X-MitsContextKey": contextKey },
    });
    const devJson = await devRes.json();

    let candidates = findDevices(devJson);
    const atw = candidates.filter((c) => String(c.deviceType) === "1");

    if (forcedDeviceId) {
      const forced = parseInt(forcedDeviceId, 10);
      candidates = candidates.filter((c) => c.deviceId === forced);
      out.results.push(`ℹ️ MELCloud: uporabljen ročno nastavljen MELCLOUD_DEVICE_ID=${forced}`);
    } else if (atw.length > 0) {
      candidates = atw;
      out.results.push(`ℹ️ MELCloud: najdenih ATW kandidatov: ${atw.length}`);
    } else {
      out.results.push(`⚠️ MELCloud: ATW tip ni bil zaznan. Poskušam vse najdene naprave (${candidates.length}).`);
    }

    if (candidates.length === 0) {
      out.results.push("⚠️ MELCloud: v odgovoru ListDevices ni bilo najdenih naprav.");
      return out;
    }

    let anySuccess = false;
    for (const candidate of candidates) {
      out.results.push(`ℹ️ MELCloud: preverjam napravo "${candidate.name}" (ID: ${candidate.deviceId}, tip: ${candidate.deviceType ?? "?"})`);

      const reportRes = await fetchT("https://app.melcloud.com/Mitsubishi.Wifi.Client/EnergyCost/Report", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-MitsContextKey": contextKey },
        body: JSON.stringify({
          DeviceId: candidate.deviceId,
          FromDate: `${start}T00:00:00`,
          ToDate: `${end}T23:59:59`,
          UseCurrency: false,
        }),
      });
      if (!reportRes.ok) {
        out.results.push(`⚠️ MELCloud report za ID ${candidate.deviceId}: HTTP ${reportRes.status}`);
        continue;
      }

      const reportJson = await reportRes.json();
      const heatingArr: number[] = reportJson.Heating || reportJson.HeatingConsumed || [];
      const hotWaterArr: number[] = reportJson.HotWater || reportJson.HotWaterConsumed || [];

      if (Array.isArray(heatingArr) && Array.isArray(hotWaterArr)) {
        let count = 0;
        const maxDays = Math.max(heatingArr.length, hotWaterArr.length);
        for (let i = 0; i < maxDays && i < lastDay; i++) {
          const dateStr = `${month}-${String(i + 1).padStart(2, "0")}`;
          const heating = Number(heatingArr[i] ?? 0);
          const hotWater = Number(hotWaterArr[i] ?? 0);
          if (heating !== 0 || hotWater !== 0) {
            out.rows.push({ date: dateStr, columnKey: "toplotna_ogrevanje", value: heating });
            out.rows.push({ date: dateStr, columnKey: "toplotna_sanitarna", value: hotWater });
            count++;
          }
        }
        if (count > 0) {
          anySuccess = true;
          out.results.push(`✅ MELCloud "${candidate.name}": ${count} dni (ogrevanje + sanitarna)`);
        } else {
          out.results.push(`⚠️ MELCloud "${candidate.name}": report vrnjen, vendar brez dnevnih podatkov. Ključi: ${Object.keys(reportJson || {}).join(", ")}`);
        }
      } else {
        out.results.push(`⚠️ MELCloud "${candidate.name}": neznana struktura reporta. Ključi: ${Object.keys(reportJson || {}).join(", ")}`);
      }
    }

    if (!anySuccess) {
      out.results.push("⚠️ MELCloud: nobena naprava ni vrnila uporabnih dnevnih podatkov. Po potrebi nastavi MELCLOUD_DEVICE_ID.");
    }
  } catch (err) {
    out.failed = true;
    const msg = err instanceof Error ? err.message : "neznana napaka";
    console.error("[sync] MELCloud:", msg);
    out.results.push(`❌ MELCloud: ${msg}`);
  }
  return out;
}

// ══════════════════════════════════════════
export async function POST(request: Request) {
  const auth = await requireCronOrUser(request);
  if (!auth.ok) return auth.res;

  const body = await readJson(request);
  const month = body?.month;
  if (!isValidMonth(month)) return badRequest("month (YYYY-MM) required");
  const force = body?.force === true;

  if (auth.actor !== "cron") {
    const wait = cooldown.hit(`sync:${month}`);
    if (wait > 0) {
      return NextResponse.json(
        { success: false, results: [`⚠️ Sinhronizacija je bila pravkar zagnana. Poskusi znova čez ${wait} s.`] },
        { status: 429 }
      );
    }
  }

  const results: string[] = [];
  const rows: DailyInput[] = [];
  let hardFail = false;

  const seKey = process.env.SOLAREDGE_API_KEY;
  const seSite = process.env.SOLAREDGE_SITE_ID;
  if (seKey && seSite) {
    const r = await syncSolarEdge(seSite, seKey, month);
    results.push(...r.results);
    rows.push(...r.rows);
    hardFail ||= r.failed;
  } else {
    results.push("ℹ️ SolarEdge: API ključi niso nastavljeni");
  }

  const mEmail = process.env.MELCLOUD_EMAIL;
  const mPass = process.env.MELCLOUD_PASSWORD;
  if (mEmail && mPass) {
    const r = await syncMelCloud(mEmail, mPass, process.env.MELCLOUD_DEVICE_ID || undefined, month);
    results.push(...r.results);
    rows.push(...r.rows);
    hardFail ||= r.failed;
  } else {
    results.push("ℹ️ MELCloud: Poverilnice niso nastavljene");
  }

  if (rows.length > 0) {
    const saved = await upsertDailyValues(rows, { manual: false, force });
    if (saved.skipped > 0) {
      results.push(`ℹ️ Preskočenih ${saved.skipped} ročno vnesenih vrednosti (ne prepišem jih; za prepis pošlji force).`);
    }
  }

  await logAction(auth.actor, "sync", `${month}: ${rows.length} vrednosti${hardFail ? " (z napakami)" : ""}`);
  return NextResponse.json({ success: !hardFail, results }, { status: hardFail ? 502 : 200 });
}
