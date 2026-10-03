import { db } from "@/db";
import { auditLog } from "@/db/schema";

export async function logAction(username: string, action: string, details?: string) {
  try {
    await db.insert(auditLog).values({ username, action, details: details || null });
  } catch {
    // never fail the main operation because of audit
  }
}
