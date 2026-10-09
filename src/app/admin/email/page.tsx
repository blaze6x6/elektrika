import { requirePageAdmin } from "@/lib/guard";
import EmailAdmin from "./EmailAdmin";

export default async function EmailPage() {
  await requirePageAdmin();
  return <EmailAdmin />;
}
