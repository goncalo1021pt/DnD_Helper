import { Link, Outlet } from "react-router-dom";
import type { CurrentUser } from "../api/client";
import { useLogout } from "../hooks";

export default function AppShell({ user }: { user: CurrentUser["user"] }) {
  const logout = useLogout();

  return (
    <div className="min-h-screen bg-wood-dark">
      <header className="bg-wood border-b-4 border-gold/40 shadow-lg">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="font-display text-2xl text-parchment tracking-wide">
            ⚔ Quest Board
          </Link>
          <div className="flex items-center gap-4 text-parchment">
            <span className="text-sm opacity-80">{user.name}</span>
            <button
              onClick={() => logout.mutate()}
              className="text-sm rounded-md px-3 py-1 bg-wood-dark/60 hover:bg-wood-dark transition"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
