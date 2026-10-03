import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import CompareClient from "./CompareClient";

export default async function ComparePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <CompareClient />;
}
