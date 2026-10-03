import { NextResponse } from "next/server";
import { db } from "@/db";
import { appSettings, dailyValues, columnConfigs } from "@/db/schema";
import { between, asc } from "drizzle-orm";
import nodemailer from "nodemailer";
import { evaluateFormula } from "@/lib/formula";
import { getSession } from "@/lib/auth";

async function getSettings() {
  const rows = await db.select().from(appSettings);
  const s: Record<string, string> = {};
  rows.forEach(r => { s[r.key] = r.value || ""; });
  return s;
}

function buildTransporter(settings: Record<string, string>) {
  const host = settings["smtp_host"] || "";
  const port = parseInt(settings["smtp_port"] || "587");
  const security = settings["smtp_security"] || "starttls";
  const user = settings["smtp_user"] || "";
  const pass = settings["smtp_pass"] || "";

  return nodemailer.createTransport({
    host,
    port,
    secure: security === "ssl",       // true = SSL/TLS on port 465
    requireTLS: security === "starttls", // force STARTTLS upgrade
    auth: user ? { user, pass } : undefined,
    tls: { rejectUnauthorized: false }, // allow self-signed certs
  });
}

function buildFromAddress(settings: Record<string, string>) {
  const email = settings["smtp_from"] || settings["smtp_user"] || "";
  const name = settings["smtp_from_name"] || "";
  return name ? `"${name}" <${email}>` : email;
}

export async function POST(request: Request) {
  // Must be logged in to use test endpoint
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const settings = await getSettings();

  const emailTo = settings["email_to"] || "";
  const smtpHost = settings["smtp_host"] || "";

  if (!emailTo || !smtpHost) {
    return NextResponse.json({
      error: "Manjkajo SMTP nastavitve. Najprej shranite strežnik in prejemnika."
    }, { status: 400 });
  }

  // Build month data for report
  const month = body.month || new Date().toISOString().slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const startStr = `${month}-01`;
  const endStr = `${month}-${String(lastDay).padStart(2, "0")}`;

  const data = await db.select().from(dailyValues).where(between(dailyValues.date, startStr, endStr));
  const cols = await db.select().from(columnConfigs).orderBy(asc(columnConfigs.displayOrder));
  const visibleCols = cols.filter(c => c.visible);

  const lookup: Record<string, Record<string, number>> = {};
  data.forEach(r => {
    if (!lookup[r.date]) lookup[r.date] = {};
    lookup[r.date][r.columnKey] = r.value ?? 0;
  });

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

  const tableRows = visibleCols.map(col => {
    const val = totals[col.key] ?? 0;
    const isNeg = val < 0;
    return `<tr>
      <td style="padding:8px 12px;border:1px solid #374151">${col.label}</td>
      <td style="padding:8px 12px;border:1px solid #374151;text-align:right;font-weight:bold;color:${isNeg ? "#ef4444" : "#22c55e"}">
        ${val.toFixed(2).replace(".", ",")} ${col.unit || "kWh"}
      </td>
    </tr>`;
  }).join("");

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;background:#111827;color:#e5e7eb;padding:24px;border-radius:12px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <span style="font-size:32px">⚡</span>
        <div>
          <h2 style="margin:0;color:#22c55e">Mesečno poročilo</h2>
          <p style="margin:0;color:#6b7280;font-size:14px">${month}</p>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr style="background:#1f2937">
          <th style="padding:8px 12px;border:1px solid #374151;text-align:left;color:#9ca3af">Stolpec</th>
          <th style="padding:8px 12px;border:1px solid #374151;text-align:right;color:#9ca3af">Skupaj</th>
        </tr>
        ${tableRows}
      </table>
      <p style="color:#4b5563;font-size:11px;margin-top:20px;text-align:center">
        Avtomatsko generirano · Štrom poraba
      </p>
    </div>`;

  try {
    const transporter = buildTransporter(settings);
    await transporter.sendMail({
      from: buildFromAddress(settings),
      to: emailTo,
      subject: `⚡ Testno poročilo – ${month}`,
      html,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Neznana napaka";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
