import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import CalculatorClient from "./CalculatorClient";
export default async function CalculatorPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <CalculatorClient />;
}
