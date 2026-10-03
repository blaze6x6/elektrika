import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import MojElektroAdmin from "./MojElektroAdmin";

export default async function MojElektroPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <MojElektroAdmin />;
}
