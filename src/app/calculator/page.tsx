import { requirePageUser } from "@/lib/guard";
import CalculatorClient from "./CalculatorClient";

export default async function CalculatorPage() {
  await requirePageUser();
  return <CalculatorClient />;
}
