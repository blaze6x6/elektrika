import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/guard";
import { readJson } from "@/lib/http";
import { loadSettingsDecrypted } from "@/lib/settings";
import { buildTransport, readSmtpConfig, reportHtml } from "@/lib/mail";
import { loadMonth, monthTotals } from "@/lib/report-data";
import { isValidMonth, localMonthStr } from "@/lib/validate";
import { logAction } from "@/lib/audit";

export async function POST(request: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;

  const body = (await readJson(request)) ?? {};
  if (body.month !== undefined && !isValidMonth(body.month)) {
    return NextResponse.json({ error: "month: pričakovano YYYY-MM" }, { status: 400 });
  }
  const month = (body.month as string | undefined) ?? localMonthStr();

  const settings = await loadSettingsDecrypted();
  const cfg = readSmtpConfig(settings);
  if (!cfg.to || !cfg.host) {
    return NextResponse.json({ error: "Manjkajo SMTP nastavitve. Najprej shranite strežnik in prejemnika." }, { status: 400 });
  }

  try {
    const p = await loadMonth(month);
    const totals = monthTotals(p, month);
    const transporter = await buildTransport(cfg);
    await transporter.sendMail({
      from: cfg.from,
      to: cfg.to,
      subject: `⚡ Testno poročilo – ${month}`,
      html: reportHtml(month, p.visibleCols, totals),
    });
    await logAction(g.user.username, "email_test", month);
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Neznana napaka";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
