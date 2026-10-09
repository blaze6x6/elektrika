"use client";

import ThemeSwitcher from "@/lib/ThemeSwitcher";
import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, Key } from "lucide-react";

type User = {
  id: number;
  username: string;
  isAdmin: boolean;
  mustChangePassword?: boolean;
  createdAt: string;
};

export default function UsersAdmin() {
  const [userList, setUserList] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [changingPw, setChangingPw] = useState<number | null>(null);

  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [newPw, setNewPw] = useState("");

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    const res = await fetch("/api/users");
    const json = await res.json().catch(() => ({}));
    if (!res.ok) alert(json.error || `Napaka ${res.status}`);
    setUserList(json.users || []);
    setLoading(false);
  };

  const handleAdd = async () => {
    if (!newUsername || !newPassword) return;
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: newUsername,
        password: newPassword,
        isAdmin: newIsAdmin,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.error) {
      alert(json.error || `Napaka ${res.status}`);
    } else {
      setNewUsername("");
      setNewPassword("");
      setNewIsAdmin(false);
      setShowAdd(false);
      await fetchUsers();
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Ali ste prepričani?")) return;
    const res = await fetch(`/api/users?id=${id}`, { method: "DELETE" });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      alert(json.error || `Napaka ${res.status}`);
    }
    await fetchUsers();
  };

  const handleChangePw = async (id: number) => {
    if (!newPw) return;
    const res = await fetch("/api/users", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, password: newPw }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      alert(json.error || `Napaka ${res.status}`);
      return;
    }
    setChangingPw(null);
    setNewPw("");
    alert("Geslo spremenjeno. Uporabnik bo moral ob naslednji prijavi nastaviti svoje geslo.");
    await fetchUsers();
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <header className="bg-gray-800 p-4 flex items-center gap-3 shadow-md">
        <Link href="/admin" className="text-gray-400 hover:text-white">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl font-bold">Upravljanje uporabnikov</h1>
        <ThemeSwitcher className="ml-auto" />
      </header>

      <main className="p-4 max-w-2xl mx-auto">
        {/* Add button */}
        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="mb-4 flex items-center gap-2 bg-green-600 hover:bg-green-700 px-4 py-2 rounded text-white font-semibold text-sm"
          >
            <Plus size={16} /> Dodaj uporabnika
          </button>
        )}

        {/* Add form */}
        {showAdd && (
          <div className="bg-gray-800 rounded-lg p-4 mb-4 space-y-3">
            <h3 className="font-bold text-sm">Nov uporabnik</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Uporabniško ime</label>
                <input
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="w-full bg-gray-700 px-3 py-2 rounded text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Začetno geslo (vsaj 10 znakov)</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-gray-700 px-3 py-2 rounded text-sm"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={newIsAdmin}
                onChange={(e) => setNewIsAdmin(e.target.checked)}
              />
              Administrator
            </label>
            <div className="flex gap-2">
              <button onClick={handleAdd} className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded text-sm font-semibold">Shrani</button>
              <button onClick={() => setShowAdd(false)} className="bg-gray-600 hover:bg-gray-500 px-4 py-2 rounded text-sm">Prekliči</button>
            </div>
          </div>
        )}

        {/* User list */}
        {loading ? (
          <p className="text-gray-500">Nalaganje...</p>
        ) : (
          <div className="space-y-2">
            {userList.map((u) => (
              <div key={u.id} className="bg-gray-800 rounded-lg p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="font-bold text-sm">{u.username}</span>
                    {u.isAdmin && (
                      <span className="ml-2 text-xs bg-yellow-800 text-yellow-300 px-2 py-0.5 rounded">Admin</span>
                    )}
                    {u.mustChangePassword && (
                      <span className="ml-2 text-xs bg-red-900 text-red-300 px-2 py-0.5 rounded">mora zamenjati geslo</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setChangingPw(changingPw === u.id ? null : u.id)}
                      className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded"
                    >
                      <Key size={14} /> Geslo
                    </button>
                    <button
                      onClick={() => handleDelete(u.id)}
                      className="p-1 hover:bg-red-900 text-red-400 rounded"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                {changingPw === u.id && (
                  <div className="mt-3 flex gap-2">
                    <input
                      type="password"
                      placeholder="Novo geslo (vsaj 10 znakov)"
                      autoComplete="new-password"
                      value={newPw}
                      onChange={(e) => setNewPw(e.target.value)}
                      className="flex-1 bg-gray-700 px-3 py-2 rounded text-sm"
                    />
                    <button
                      onClick={() => handleChangePw(u.id)}
                      className="bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded text-sm"
                    >
                      Spremeni
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
