import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import AuditClient from "./AuditClient";
export default async function AuditPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <AuditClient />;
}
