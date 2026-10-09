import { requirePageAdmin } from "@/lib/guard";
import AuditClient from "./AuditClient";

export default async function AuditPage() {
  await requirePageAdmin();
  return <AuditClient />;
}
