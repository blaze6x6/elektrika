import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import EmailAdmin from "./EmailAdmin";
export default async function EmailPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <EmailAdmin />;
}
