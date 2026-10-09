import { requirePageAdmin } from "@/lib/guard";
import ColumnsAdmin from "./ColumnsAdmin";

export default async function ColumnsPage() {
  await requirePageAdmin();
  return <ColumnsAdmin />;
}
