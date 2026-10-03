import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import ColumnsAdmin from "./ColumnsAdmin";

export default async function ColumnsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return <ColumnsAdmin />;
}
