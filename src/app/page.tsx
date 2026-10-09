import DashboardClient from "./DashboardClient";
import { clearSession } from "@/lib/auth";
import { requirePageUser } from "@/lib/guard";
import { logAction } from "@/lib/audit";
import { redirect } from "next/navigation";
import { LogOut, KeyRound } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export default async function Home() {
  const user = await requirePageUser();

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header className="bg-gray-800 p-4 flex justify-between items-center shadow-md shrink-0">
        <div className="flex items-center gap-3">
          <Image
            src="/icons/icon.svg"
            alt="Štrom poraba"
            width={32}
            height={32}
            className="rounded-lg"
            priority
          />
          <h1 className="text-xl font-bold text-white">Štrom poraba</h1>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/change-password" className="text-gray-300 hover:text-white flex items-center gap-2" title="Zamenjaj geslo">
            <KeyRound size={20} />
            <span className="hidden sm:inline">{user.username}</span>
          </Link>
          <form action={async () => {
            "use server";
            await clearSession();
            await logAction(user.username, "logout");
            redirect("/login");
          }}>
            <button type="submit" className="text-gray-300 hover:text-white flex items-center gap-2">
              <LogOut size={20} />
              <span className="hidden sm:inline">Odjava</span>
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 min-h-0 p-2 sm:p-4 overflow-hidden">
        <DashboardClient isAdmin={user.isAdmin} />
      </main>
    </div>
  );
}
