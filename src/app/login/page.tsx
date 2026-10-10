"use client";

import ThemeSwitcher from "@/lib/ThemeSwitcher";
import InstallButton from "@/lib/pwa";
import { useState } from "react";
import { useActionState } from "react";
import { login } from "./actions";
import Image from "next/image";
import { Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [state, formAction, isPending] = useActionState<{ error?: string } | null, FormData>(
    async (_prev, formData) => (await login(formData)) ?? null,
    null
  );


  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 px-4">
      <div className="fixed right-3 top-3 z-50 flex gap-1"><InstallButton /><ThemeSwitcher /></div>
      <div className="max-w-md w-full bg-gray-800 rounded-xl shadow-lg p-8">
        <div className="mb-6 flex flex-col items-center gap-3">
          <Image
            src="/icons/icon.svg"
            alt="Štrom poraba"
            width={72}
            height={72}
            className="rounded-2xl shadow-lg"
            priority
          />
          <h2 className="text-3xl font-bold text-center text-white">Prijava</h2>
          <p className="text-sm text-gray-400 text-center">Štrom poraba</p>
        </div>
        
        <form action={formAction} className="space-y-4">
          <div>
            <label className="block text-gray-300 mb-1">Uporabniško ime</label>
            <input
              type="text"
              name="username"
              required
              autoComplete="username"
              className="w-full px-4 py-2 rounded-lg bg-gray-700 text-white border border-gray-600 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-gray-300 mb-1">Geslo</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                required
                autoComplete="current-password"
                className="w-full px-4 py-2 pr-12 rounded-lg bg-gray-700 text-white border border-gray-600 focus:outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>
          
          {state?.error && (
            <div className="text-red-400 text-sm text-center">{state.error}</div>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {isPending ? "Prijavljanje..." : "Prijavi se"}
          </button>
        </form>
      </div>
    </div>
  );
}
