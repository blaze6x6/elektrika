import { requirePageAdmin } from "@/lib/guard";
import SolarEdgeAdmin from "./SolarEdgeAdmin";

export default async function SolarEdgePage() {
  await requirePageAdmin();
  return <SolarEdgeAdmin />;
}
