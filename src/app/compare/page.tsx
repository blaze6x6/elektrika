import { requirePageUser } from "@/lib/guard";
import CompareClient from "./CompareClient";

export default async function ComparePage() {
  await requirePageUser();
  return <CompareClient />;
}
