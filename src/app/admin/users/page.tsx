import { requirePageAdmin } from "@/lib/guard";
import UsersAdmin from "./UsersAdmin";

export default async function UsersPage() {
  await requirePageAdmin();
  return <UsersAdmin />;
}
