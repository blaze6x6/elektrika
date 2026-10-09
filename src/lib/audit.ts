import { lt } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";

const RETENTION_DAYS = 400;

export async function logAction(username: string, action: string, details?: string) {
  try {
    const clean = details ? details.replace(/[\r\n]+/g, " ").slice(0, 2000) : null;
    await db.insert(auditLog).values({ username: username.slice(0, 255), action: action.slice(0, 50), details: clean });
    // občasno počisti stare zapise, da tabela ne raste v neskončnost
    if (Math.random() < 0.01) {
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000);
      await db.delete(auditLog).where(lt(auditLog.createdAt, cutoff));
    }
  } catch {
    // napaka pri beleženju ne sme podreti glavne operacije
  }
}
