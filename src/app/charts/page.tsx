import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import ChartsClient from "./ChartsClient";

export default async function ChartsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <ChartsClient />;
}
