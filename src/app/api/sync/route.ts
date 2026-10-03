import { NextResponse } from "next/server";
import { db } from "@/db";
import { dailyValues } from "@/db/schema";
import { and, eq } from "drizzle-orm";

async function saveValue(dateStr: string, columnKey: string, value: number) {
  if (!dateStr || typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    console.warn(`Preskakujem neveljaven datum: "${dateStr}" za stolpec ${columnKey}`);
    return;
  }
  const [existing] = await db
    .select()
    .from(dailyValues)
    .where(and(eq(dailyValues.date, dateStr), eq(dailyValues.columnKey, columnKey)));
  if (existing) {
    await db
      .update(dailyValues)
      .set({ value, isManual: false, updatedAt: new Date() })
      .where(and(eq(dailyValues.date, dateStr), eq(dailyValues.columnKey, columnKey)));
  } else {
    await db.insert(dailyValues).values({ date: dateStr, columnKey, value, isManual: false });
  }
}

export async function POST(request: Request) {
  const body = await request.json();
  const { month } = body; // YYYY-MM
  if (!month) return NextResponse.json({ error: "month required" }, { status: 400 });

  const [y, m] = month.split("-");
  const year = parseInt(y);
  const monthNum = parseInt(m);
  const lastDay = new Date(year, monthNum, 0).getDate();
  const startDate = `${month}-01`;
  const endDate = `${month}-${String(lastDay).padStart(2, "0")}`;
  // SolarEdge needs time format
  const startTime = `${startDate} 00:00:00`;
  const endTime = `${endDate} 23:59:59`;

  const solaredgeKey = process.env.SOLAREDGE_API_KEY;
  const solaredgeSite = process.env.SOLAREDGE_SITE_ID;
  const melcloudEmail = process.env.MELCLOUD_EMAIL;
  const melcloudPassword = process.env.MELCLOUD_PASSWORD;
  const melcloudDeviceId = process.env.MELCLOUD_DEVICE_ID;

  const results: string[] = [];

  // ══════════════════════════════════════════
  // SolarEdge
  // ══════════════════════════════════════════
  if (solaredgeKey && solaredgeSite) {
    try {
      // 1. Production (from /energy endpoint - simple production)
      const prodUrl = `https://monitoringapi.solaredge.com/site/${solaredgeSite}/energy?timeUnit=DAY&startDate=${startDate}&endDate=${endDate}&api_key=${solaredgeKey}`;
      const prodRes = await fetch(prodUrl);
      const prodJson = await prodRes.json();

      let prodCount = 0;
      if (prodJson.energy?.values) {
        for (const item of prodJson.energy.values) {
          if (item.value !== null && item.date) {
            const dateStr = String(item.date).split(/[ T]/)[0];
            const kWh = parseFloat((item.value / 1000).toFixed(3));
            await saveValue(dateStr, "solarna", kWh);
            prodCount++;
          }
        }
        results.push(`✅ SolarEdge proizvodnja: ${prodCount} dni`);
      } else {
        results.push(`⚠️ SolarEdge proizvodnja: ni podatkov (${JSON.stringify(prodJson).substring(0, 100)})`);
      }

      // 2. Try energyDetails first
      const detailUrl = `https://monitoringapi.solaredge.com/site/${solaredgeSite}/energyDetails?timeUnit=DAY&meters=Consumption,Purchased,Production,FeedIn&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}&api_key=${solaredgeKey}`;
      const detailRes = await fetch(detailUrl);
      const detailJson = await detailRes.json();

      let consCount = 0;
      let purchasedCount = 0;
      let meterTypes: string[] = [];

      const saveFromMeters = async (meters: Array<Record<string, unknown>>) => {
        for (const meter of meters) {
          const type = String(meter.type || meter.meterType || "");
          meterTypes.push(type);
          const values = Array.isArray(meter.values) ? meter.values : [];

          if (type.toLowerCase() === "consumption") {
            for (const item of values as Array<Record<string, unknown>>) {
              if (item.value !== null && item.value !== undefined && item.date) {
                const dateStr = String(item.date).split(/[ T]/)[0];
                const kWh = parseFloat((Number(item.value) / 1000).toFixed(3));
                await saveValue(dateStr, "skupna_poraba", kWh);
                consCount++;
              }
            }
          }

          if (type.toLowerCase() === "purchased") {
            for (const item of values as Array<Record<string, unknown>>) {
              if (item.value !== null && item.value !== undefined && item.date) {
                const dateStr = String(item.date).split(/[ T]/)[0];
                const kWh = parseFloat((Number(item.value) / 1000).toFixed(3));
                purchasedCount++;
                // Fallback only if true consumption is missing
                if (consCount === 0) {
                  await saveValue(dateStr, "skupna_poraba", kWh);
                }
              }
            }
          }
        }
      };

      if (detailJson.energyDetails?.meters) {
        await saveFromMeters(detailJson.energyDetails.meters);
      }

      // 3. Fallback to /meters endpoint if needed
      if (consCount === 0) {
        try {
          const metersUrl = `https://monitoringapi.solaredge.com/site/${solaredgeSite}/meters?timeUnit=DAY&meters=Consumption,Purchased&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}&api_key=${solaredgeKey}`;
          const metersRes = await fetch(metersUrl);
          const metersJson = await metersRes.json();
          if (metersJson.meterEnergyDetails?.meters) {
            await saveFromMeters(metersJson.meterEnergyDetails.meters);
          }
        } catch {
          // ignore fallback failure, we report below
        }
      }

      if (consCount > 0) {
        results.push(`✅ SolarEdge skupna poraba: ${consCount} dni`);
      } else if (purchasedCount > 0) {
        results.push(`⚠️ SolarEdge: true 'Consumption' ni na voljo, uporabljen je bil 'Purchased' (${purchasedCount} dni) – to pomeni uvoz iz omrežja, ne nujno celotna poraba.`);
      } else if (detailJson.code === 403 || detailRes.status === 403) {
        results.push("⚠️ SolarEdge poraba: 403 napaka - endpoint za porabo ni na voljo za ta SolarEdge račun/paket.");
      } else {
        results.push(`⚠️ SolarEdge poraba: ni podatkov. Najdeni tipi meril: ${meterTypes.join(", ") || "brez tipov"}`);
      }
    } catch (err) {
      results.push(`❌ SolarEdge: ${err instanceof Error ? err.message : "neznana napaka"}`);
    }
  } else {
    results.push("ℹ️ SolarEdge: API ključi niso nastavljeni");
  }

  // ══════════════════════════════════════════
  // MELCloud
  // ══════════════════════════════════════════
  if (melcloudEmail && melcloudPassword) {
    try {
      const loginRes = await fetch(
        "https://app.melcloud.com/Mitsubishi.Wifi.Client/Login/ClientLogin",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            Email: melcloudEmail,
            Password: melcloudPassword,
            Language: 0,
            AppVersion: "1.32.1.0",
            Persist: false,
            CaptchaChallenge: "",
            CaptchaResponse: "",
          }),
        }
      );
      const loginJson = await loginRes.json();
      const contextKey = loginJson?.LoginData?.ContextKey;

      if (!contextKey) {
        results.push(`❌ MELCloud: Prijava neuspešna. Odgovor: ${JSON.stringify(loginJson).substring(0, 150)}`);
      } else {
        const devRes = await fetch(
          "https://app.melcloud.com/Mitsubishi.Wifi.Client/User/ListDevices",
          { headers: { "X-MitsContextKey": contextKey } }
        );
        const devJson = await devRes.json();

        type MelCandidate = {
          deviceId: number;
          name: string;
          deviceType: string | number | null;
        };

        const candidatesMap = new Map<number, MelCandidate>();

        const visit = (value: unknown) => {
          if (!value || typeof value !== "object") return;
          const obj = value as Record<string, unknown>;

          const deviceId =
            typeof obj.DeviceID === "number"
              ? obj.DeviceID
              : typeof obj.DeviceId === "number"
                ? obj.DeviceId
                : null;

          const nestedDevice =
            obj.Device && typeof obj.Device === "object"
              ? (obj.Device as Record<string, unknown>)
              : null;

          const deviceType = nestedDevice?.DeviceType ?? obj.DeviceType ?? obj.Type ?? null;
          const name = String(
            obj.DeviceName ??
              obj.Name ??
              nestedDevice?.DeviceName ??
              nestedDevice?.Name ??
              `Device ${deviceId ?? "?"}`
          );

          if (deviceId) {
            candidatesMap.set(deviceId, {
              deviceId,
              name,
              deviceType:
                typeof deviceType === "string" || typeof deviceType === "number"
                  ? deviceType
                  : null,
            });
          }

          for (const child of Object.values(obj)) {
            if (Array.isArray(child)) {
              for (const item of child) visit(item);
            } else if (child && typeof child === "object") {
              visit(child);
            }
          }
        };

        visit(devJson);

        let candidates = Array.from(candidatesMap.values());
        const atwCandidates = candidates.filter((c) => String(c.deviceType) === "1");

        if (melcloudDeviceId) {
          const forcedId = parseInt(melcloudDeviceId, 10);
          candidates = candidates.filter((c) => c.deviceId === forcedId);
          results.push(`ℹ️ MELCloud: uporabljen ročno nastavljen MELCLOUD_DEVICE_ID=${forcedId}`);
        } else if (atwCandidates.length > 0) {
          candidates = atwCandidates;
          results.push(`ℹ️ MELCloud: najdenih ATW kandidatov: ${atwCandidates.length}`);
        } else {
          results.push(`⚠️ MELCloud: ATW tip ni bil zaznan. Poskušam vse najdene naprave (${candidates.length}).`);
        }

        if (candidates.length === 0) {
          results.push("⚠️ MELCloud: v odgovoru ListDevices ni bilo najdenih naprav.");
        } else {
          let anySuccess = false;

          for (const candidate of candidates) {
            results.push(`ℹ️ MELCloud: preverjam napravo \"${candidate.name}\" (ID: ${candidate.deviceId}, tip: ${candidate.deviceType ?? "?"})`);

            const reportRes = await fetch(
              "https://app.melcloud.com/Mitsubishi.Wifi.Client/EnergyCost/Report",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-MitsContextKey": contextKey,
                },
                body: JSON.stringify({
                  DeviceId: candidate.deviceId,
                  FromDate: `${startDate}T00:00:00`,
                  ToDate: `${endDate}T23:59:59`,
                  UseCurrency: false,
                }),
              }
            );

            if (!reportRes.ok) {
              results.push(`⚠️ MELCloud report za ID ${candidate.deviceId}: HTTP ${reportRes.status}`);
              continue;
            }

            const reportJson = await reportRes.json();
            const heatingArr: number[] = reportJson.Heating || reportJson.HeatingConsumed || [];
            const hotWaterArr: number[] = reportJson.HotWater || reportJson.HotWaterConsumed || [];

            if (Array.isArray(heatingArr) || Array.isArray(hotWaterArr)) {
              let count = 0;
              const maxDays = Math.max(heatingArr.length || 0, hotWaterArr.length || 0);

              for (let i = 0; i < maxDays; i++) {
                const day = i + 1;
                if (day > lastDay) break;
                const dateStr = `${month}-${String(day).padStart(2, "0")}`;
                const heating = Number(heatingArr[i] ?? 0);
                const hotWater = Number(hotWaterArr[i] ?? 0);
                if (heating !== 0 || hotWater !== 0) {
                  await saveValue(dateStr, "toplotna_ogrevanje", heating);
                  await saveValue(dateStr, "toplotna_sanitarna", hotWater);
                  count++;
                }
              }

              if (count > 0) {
                anySuccess = true;
                results.push(`✅ MELCloud \"${candidate.name}\": ${count} dni (ogrevanje + sanitarna)`);
              } else {
                results.push(`⚠️ MELCloud \"${candidate.name}\": report vrnjen, vendar brez dnevnih podatkov. Ključi: ${Object.keys(reportJson || {}).join(", ")}`);
              }
            } else {
              results.push(`⚠️ MELCloud \"${candidate.name}\": neznana struktura reporta. Ključi: ${Object.keys(reportJson || {}).join(", ")}`);
            }
          }

          if (!anySuccess) {
            results.push("⚠️ MELCloud: nobena naprava ni vrnila uporabnih dnevnih podatkov. Če želiš, lahko nato ročno nastavimo MELCLOUD_DEVICE_ID.");
          }
        }
      }
    } catch (err) {
      results.push(`❌ MELCloud: ${err instanceof Error ? err.message : "neznana napaka"}`);
    }
  } else {
    results.push("ℹ️ MELCloud: Poverilnice niso nastavljene");
  }

  return NextResponse.json({ success: true, results });
}
