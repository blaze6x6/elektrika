import ThemeSwitcher from "@/lib/ThemeSwitcher";
import { requirePageAdmin } from "@/lib/guard";
import Link from "next/link";
import { Columns3, Users, ArrowLeft, Database, Mail, History, Zap } from "lucide-react";

export default async function AdminPage() {
  await requirePageAdmin();

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <header className="bg-gray-800 p-4 flex items-center gap-3 shadow-md">
        <Link href="/" className="text-gray-400 hover:text-white"><ArrowLeft size={20} /></Link>
        <h1 className="text-xl font-bold">Administracija</h1>
        <ThemeSwitcher className="ml-auto" />
      </header>
      <main className="p-4 max-w-2xl mx-auto space-y-4">
        <Link href="/admin/columns" className="block bg-gray-800 hover:bg-gray-700 rounded-xl p-6 transition-colors">
          <div className="flex items-center gap-4">
            <div className="bg-blue-600 p-3 rounded-lg"><Columns3 size={24} /></div>
            <div>
              <h2 className="text-lg font-bold">Stolpci</h2>
              <p className="text-gray-400 text-sm">Dodaj, uredi ali odstrani stolpce. Nastavi formule za izračune.</p>
            </div>
          </div>
        </Link>

        <Link href="/admin/users" className="block bg-gray-800 hover:bg-gray-700 rounded-xl p-6 transition-colors">
          <div className="flex items-center gap-4">
            <div className="bg-green-600 p-3 rounded-lg"><Users size={24} /></div>
            <div>
              <h2 className="text-lg font-bold">Uporabniki</h2>
              <p className="text-gray-400 text-sm">Upravljaj uporabnike in gesla.</p>
            </div>
          </div>
        </Link>

        <Link href="/admin/email" className="block bg-gray-800 hover:bg-gray-700 rounded-xl p-6 transition-colors">
          <div className="flex items-center gap-4">
            <div className="bg-purple-600 p-3 rounded-lg"><Mail size={24} /></div>
            <div>
              <h2 className="text-lg font-bold">E-mail in opozorila</h2>
              <p className="text-gray-400 text-sm">Mesečna poročila, opozorila ob visoki porabi, SMTP nastavitve.</p>
            </div>
          </div>
        </Link>

        <Link href="/admin/mojelektro" className="block bg-gray-800 hover:bg-gray-700 rounded-xl p-6 transition-colors">
          <div className="flex items-center gap-4">
            <div className="bg-cyan-600 p-3 rounded-lg"><Zap size={24} /></div>
            <div>
              <h2 className="text-lg font-bold">MojElektro diagnostika</h2>
              <p className="text-gray-400 text-sm">Preveri merilno mesto, merilno točko, registre in kvalitete odčitkov.</p>
            </div>
          </div>
        </Link>

        <Link href="/admin/audit" className="block bg-gray-800 hover:bg-gray-700 rounded-xl p-6 transition-colors">
          <div className="flex items-center gap-4">
            <div className="bg-orange-600 p-3 rounded-lg"><History size={24} /></div>
            <div>
              <h2 className="text-lg font-bold">Dnevnik sprememb</h2>
              <p className="text-gray-400 text-sm">Kdo je kaj spremenil in kdaj.</p>
            </div>
          </div>
        </Link>

        <div className="bg-gray-800 rounded-xl p-6">
          <div className="flex items-center gap-4">
            <div className="bg-yellow-600 p-3 rounded-lg"><Database size={24} /></div>
            <div>
              <h2 className="text-lg font-bold">API integracije</h2>
              <p className="text-gray-400 text-sm">Nastavi v okoljeskih spremenljivkah (.env):</p>
              <ul className="text-gray-500 text-xs mt-2 space-y-1 font-mono">
                <li>SOLAREDGE_API_KEY=...</li>
                <li>SOLAREDGE_SITE_ID=...</li>
                <li>MELCLOUD_EMAIL=...</li>
                <li>MELCLOUD_PASSWORD=...</li>
                <li>MOJELEKTRO_API_KEY=... / MOJELEKTRO_EIMM=...</li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
