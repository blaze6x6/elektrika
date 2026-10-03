import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import UsersAdmin from "./UsersAdmin";

export default async function UsersPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return <UsersAdmin />;
}
