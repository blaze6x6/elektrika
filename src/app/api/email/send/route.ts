import { NextResponse } from "next/server";
import { db } from "@/db";
import { appSettings, dailyValues, columnConfigs } from "@/db/schema";
import { between, asc } from "drizzle-orm";
import nodemailer from "nodemailer";
import { evaluateFormula } from "@/lib/formula";

async function getSettings() {
  const rows = await db.select().from(appSettings);
  const s: Record<string, string> = {};
  rows.forEach(r => { s[r.key] = r.value || ""; });
  return s;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { month, type } = body; // type: "report" | "alert"

  // Verify cron secret
  const cronSecret = process.env.CRON_SECRET || "energy_cron_secret_123";
  const headerSecret = request.headers.get("x-cron-secret") || body.secret || "";
  if (headerSecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await getSettings();
  const emailEnabled = settings["email_enabled"] === "true";
  const alertsEnabled = settings["alerts_enabled"] === "true";
  const emailTo = settings["email_to"] || "";
  const smtpHost = settings["smtp_host"] || process.env.SMTP_HOST || "";
  const smtpPort = parseInt(settings["smtp_port"] || process.env.SMTP_PORT || "587");
  const smtpSecurity = settings["smtp_security"] || "starttls";
  const smtpUser = settings["smtp_user"] || process.env.SMTP_USER || "";
  const smtpPass = settings["smtp_pass"] || process.env.SMTP_PASS || "";
  const smtpFromEmail = settings["smtp_from"] || process.env.SMTP_FROM || smtpUser;
  const smtpFromName = settings["smtp_from_name"] || "";
  const smtpFrom = smtpFromName ? `"${smtpFromName}" <${smtpFromEmail}>` : smtpFromEmail;
  const alertThreshold = parseFloat(settings["alert_threshold"] || "50");

  if (type === "report" && !emailEnabled) {
    return NextResponse.json({ skipped: true, reason: "Email poročila so izklopljena" });
  }
  if (type === "alert" && !alertsEnabled) {
    return NextResponse.json({ skipped: true, reason: "Opozorila so izklopljena" });
  }
  if (!emailTo || !smtpHost) {
    return NextResponse.json({ error: "Email nastavitve niso konfigurirane" }, { status: 400 });
  }

  // Fetch data for month
  const targetMonth = month || new Date().toISOString().slice(0, 7);
  const [y, m] = targetMonth.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const startStr = `${targetMonth}-01`;
  const endStr = `${targetMonth}-${String(lastDay).padStart(2, "0")}`;

  const data = await db.select().from(dailyValues).where(between(dailyValues.date, startStr, endStr));
  const cols = await db.select().from(columnConfigs).orderBy(asc(columnConfigs.displayOrder));
  const visibleCols = cols.filter(c => c.visible);

  // Build lookup
  const lookup: Record<string, Record<string, number>> = {};
  data.forEach(r => { if (!lookup[r.date]) lookup[r.date] = {}; lookup[r.date][r.columnKey] = r.value ?? 0; });

  // Calculate totals
  const totals: Record<string, number> = {};
  for (const col of visibleCols) {
    let total = 0;
    for (const dayVals of Object.values(lookup)) {
      if (col.sourceType === "formula" && col.formula) {
        total += evaluateFormula(col.formula, dayVals);
      } else {
        total += dayVals[col.key] ?? 0;
      }
    }
    totals[col.key] = total;
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecurity === "ssl",
    requireTLS: smtpSecurity === "starttls",
    auth: smtpUser ? { user: smtpUser, pass: smtpPass } : undefined,
    tls: { rejectUnauthorized: false },
  });

  if (type === "report") {
    const tableRows = visibleCols.map(col =>
      `<tr><td style="padding:8px;border:1px solid #333">${col.label}</td><td style="padding:8px;border:1px solid #333;text-align:right"><strong>${totals[col.key]?.toFixed(1) ?? "0"}</strong> ${col.unit}</td></tr>`
    ).join("");

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#1f2937;color:#e5e7eb;padding:20px;border-radius:12px">
        <h2 style="color:#22c55e">⚡ Mesečno poročilo – ${targetMonth}</h2>
        <table style="width:100%;border-collapse:collapse;margin-top:16px">
          <tr style="background:#111827"><th style="padding:8px;border:1px solid #333;text-align:left">Stolpec</th><th style="padding:8px;border:1px solid #333;text-align:right">Skupaj</th></tr>
          ${tableRows}
        </table>
        <p style="color:#6b7280;font-size:12px;margin-top:16px">Avtomatsko generirano – Štrom poraba</p>
      </div>`;

    await transporter.sendMail({
      from: smtpFrom,
      to: emailTo,
      subject: `⚡ Mesečno poročilo – ${targetMonth}`,
      html,
    });

    return NextResponse.json({ success: true, type: "report", month: targetMonth });
  }

  if (type === "alert") {
    // Check if skupna_poraba yesterday exceeds threshold
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().slice(0, 10);
    const dayVals = lookup[dateStr] || {};
    const skupna = dayVals["skupna_poraba"] ?? 0;

    if (skupna <= alertThreshold) {
      return NextResponse.json({ skipped: true, reason: `Poraba ${skupna.toFixed(1)} kWh je pod pragom ${alertThreshold} kWh` });
    }

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;background:#1f2937;color:#e5e7eb;padding:20px;border-radius:12px">
        <h2 style="color:#ef4444">🔔 Opozorilo – visoka poraba</h2>
        <p>Dne <strong>${dateStr}</strong> je bila skupna poraba <strong style="color:#ef4444">${skupna.toFixed(1)} kWh</strong>, kar presega nastavljeni prag <strong>${alertThreshold} kWh</strong>.</p>
        <p style="color:#6b7280;font-size:12px;margin-top:16px">Avtomatsko generirano – Štrom poraba</p>
      </div>`;

    await transporter.sendMail({
      from: smtpFrom,
      to: emailTo,
      subject: `🔔 Visoka poraba – ${skupna.toFixed(1)} kWh dne ${dateStr}`,
      html,
    });

    return NextResponse.json({ success: true, type: "alert", date: dateStr, consumption: skupna });
  }

  return NextResponse.json({ error: "type must be 'report' or 'alert'" }, { status: 400 });
}
