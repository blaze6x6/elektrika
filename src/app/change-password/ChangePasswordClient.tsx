"use client";

import ThemeSwitcher from "@/lib/ThemeSwitcher";
import { useActionState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { changePassword } from "./actions";

type State = { error?: string } | null;

export default function ChangePasswordClient({ forced, username }: { forced: boolean; username: string }) {
  const [state, formAction, isPending] = useActionState<State, FormData>(changePassword, null);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 px-4">
      <div className="fixed right-3 top-3 z-50"><ThemeSwitcher /></div>
      <div className="max-w-md w-full bg-gray-800 rounded-xl shadow-lg p-8">
        {!forced && (
          <Link href="/" className="text-gray-400 hover:text-white inline-flex items-center gap-1 text-sm mb-4">
            <ArrowLeft size={16} /> Nazaj
          </Link>
        )}
        <h2 className="text-2xl font-bold text-white mb-1">Zamenjava gesla</h2>
        <p className="text-sm text-gray-400 mb-4">
          {forced
            ? `Uporabnik ${username}: pred nadaljevanjem je treba nastaviti novo geslo.`
            : `Uporabnik ${username}`}
        </p>

        <form action={formAction} className="space-y-4">
          <div>
            <label className="block text-gray-300 mb-1 text-sm">Trenutno geslo</label>
            <input type="password" name="current" required autoComplete="current-password"
              className="w-full px-4 py-2 rounded-lg bg-gray-700 text-white border border-gray-600 focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-gray-300 mb-1 text-sm">Novo geslo (vsaj 10 znakov)</label>
            <input type="password" name="next" required minLength={10} autoComplete="new-password"
              className="w-full px-4 py-2 rounded-lg bg-gray-700 text-white border border-gray-600 focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-gray-300 mb-1 text-sm">Ponovi novo geslo</label>
            <input type="password" name="confirm" required minLength={10} autoComplete="new-password"
              className="w-full px-4 py-2 rounded-lg bg-gray-700 text-white border border-gray-600 focus:outline-none focus:border-blue-500" />
          </div>

          {state?.error && <div className="text-red-400 text-sm text-center">{state.error}</div>}

          <button type="submit" disabled={isPending}
            className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50">
            {isPending ? "Shranjujem..." : "Spremeni geslo"}
          </button>
        </form>
        <p className="text-xs text-gray-500 mt-4">Ob zamenjavi se odjavite z vseh drugih naprav.</p>
      </div>
    </div>
  );
}
