import { NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/secrets";
import { readJson } from "@/lib/http";
import { loadSettingsDecrypted } from "@/lib/settings";
import { alertHtml, buildTransport, readSmtpConfig, reportHtml } from "@/lib/mail";
import { loadMonth, monthTotals } from "@/lib/report-data";
import { isValidMonth, localMonthStr, yesterdayLocalStr } from "@/lib/validate";
import { logAction } from "@/lib/audit";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { saveSetting } from "@/lib/settings";
import { presyncDue, readSchedule, reportDue } from "@/lib/report-schedule";

/**
 * Samo za cron (glava x-cron-secret) – skrivnost v telesu ni več sprejeta.
 * Telo: { type: "report" | "alert", month?: "YYYY-MM", scheduled?: true }
 * scheduled=true (cron na vsakih 10 min): pošlje poročilo za prejšnji mesec samo, če je nastavljeni termin
 * (Administracija → E-mail: dan/ura/minuta) dosežen in poročilo za ta mesec še ni bilo poslano.
 */
export async function POST(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await readJson(request)) ?? {};
  const type = body.type;
  if (type !== "report" && type !== "alert") {
    return NextResponse.json({ error: "type must be 'report' or 'alert'" }, { status: 400 });
  }
  if (body.month !== undefined && !isValidMonth(body.month)) {
    return NextResponse.json({ error: "month: pričakovano YYYY-MM" }, { status: 400 });
  }

  const settings = await loadSettingsDecrypted();
  if (type === "report" && settings["email_enabled"] !== "true") {
    return NextResponse.json({ skipped: true, reason: "Email poročila so izklopljena" });
  }
  if (type === "alert" && settings["alerts_enabled"] !== "true") {
    return NextResponse.json({ skipped: true, reason: "Opozorila so izklopljena" });
  }

  const cfg = readSmtpConfig(settings);
  if (!cfg.to || !cfg.host) {
    return NextResponse.json({ error: "Email nastavitve niso konfigurirane" }, { status: 400 });
  }

  try {
    if (type === "report") {
      let month = (body.month as string | undefined) ?? localMonthStr();
      if (body.scheduled === true) {
        const sentRows = await db
          .select({ d: auditLog.details })
          .from(auditLog)
          .where(and(eq(auditLog.action, "email_report"), eq(auditLog.username, "cron")));
        const sent = new Set(sentRows.map((r) => r.d));
        if (settings["report_last_month"]) sent.add(settings["report_last_month"]);
        const now = new Date();
        const sch = readSchedule(settings);
        // 1 h pred terminom: cron najprej še enkrat sinhronizira prejšnji mesec (odgovor { presync: "YYYY-MM" })
        const pre = presyncDue(now, sch, (m) => sent.has(m), (m) => settings["report_presync_month"] === m);
        if (pre.due) {
          await saveSetting("report_presync_month", pre.month);
          await logAction("cron", "report_presync", pre.month);
          return NextResponse.json({ presync: pre.month });
        }
        const chk = reportDue(now, sch, (m) => sent.has(m));
        if (!chk.due) return NextResponse.json({ skipped: true, reason: "Termin poročila še ni dosežen ali je za ta mesec že poslano" });
        month = chk.month;
      }
      const p = await loadMonth(month);
      const totals = monthTotals(p, month);
      const transporter = await buildTransport(cfg);
      await transporter.sendMail({
        from: cfg.from,
        to: cfg.to,
        subject: `⚡ Mesečno poročilo – ${month}`,
        html: reportHtml(month, p.visibleCols, totals),
      });
      await logAction("cron", "email_report", month);
      await saveSetting("report_last_month", month);
      return NextResponse.json({ success: true, type: "report", month });
    }

    // alert: preveri včerajšnji dan po LOKALNEM času (TZ), ne po UTC
    const dateStr = yesterdayLocalStr();
    const p = await loadMonth(dateStr.slice(0, 7));
    const col = p.cols.find((c) => c.key === "skupna_poraba");
    const consumption = col ? p.cell(dateStr, col) : 0;
    const parsed = parseFloat((settings["alert_threshold"] || "50").replace(",", "."));
    const threshold = Number.isFinite(parsed) ? parsed : 50;

    if (consumption <= threshold) {
      return NextResponse.json({
        skipped: true,
        reason: `Poraba ${consumption.toFixed(1)} kWh je pod pragom ${threshold} kWh`,
      });
    }
    const transporter = await buildTransport(cfg);
    await transporter.sendMail({
      from: cfg.from,
      to: cfg.to,
      subject: `🔔 Visoka poraba – ${consumption.toFixed(1)} kWh dne ${dateStr}`,
      html: alertHtml(dateStr, consumption, threshold),
    });
    await logAction("cron", "email_alert", `${dateStr} ${consumption.toFixed(1)} kWh`);
    return NextResponse.json({ success: true, type: "alert", date: dateStr, consumption });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Neznana napaka";
    console.error("[email/send]", msg);
    return NextResponse.json({ error: `Pošiljanje ni uspelo: ${msg}` }, { status: 502 });
  }
}
