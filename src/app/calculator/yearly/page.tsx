import { requirePageUser } from "@/lib/guard";
import YearlyClient from "./YearlyClient";

export default async function YearlyPage() {
  await requirePageUser();
  return <YearlyClient />;
}
