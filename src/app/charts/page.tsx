import { requirePageUser } from "@/lib/guard";
import ChartsClient from "./ChartsClient";

export default async function ChartsPage() {
  await requirePageUser();
  return <ChartsClient />;
}
