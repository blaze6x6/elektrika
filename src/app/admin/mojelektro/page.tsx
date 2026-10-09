import { requirePageAdmin } from "@/lib/guard";
import MojElektroAdmin from "./MojElektroAdmin";

export default async function MojElektroPage() {
  await requirePageAdmin();
  return <MojElektroAdmin />;
}
