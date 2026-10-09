import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/guard";
import ChangePasswordClient from "./ChangePasswordClient";

export default async function ChangePasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <ChangePasswordClient forced={user.mustChangePassword} username={user.username} />;
}
