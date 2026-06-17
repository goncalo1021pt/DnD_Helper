import { useState } from "react";

// Full-page redirect to the backend OAuth flow.
function providerLogin(provider: string) {
  window.location.href = `/api/auth/${provider}/login`;
}

export default function LoginScreen() {
  const [devName, setDevName] = useState("");
  const isDev = import.meta.env.DEV;

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl bg-parchment shadow-2xl border-4 border-wood p-8 text-center">
        <h1 className="font-display text-3xl text-wood-dark mb-1">The Quest Board</h1>
        <p className="text-ink/70 mb-8">Sign in to view the board.</p>

        <div className="space-y-3">
          <button
            onClick={() => providerLogin("discord")}
            className="w-full rounded-lg bg-[#5865F2] text-white font-semibold py-3 hover:opacity-90 transition"
          >
            Sign in with Discord
          </button>
          <button
            onClick={() => providerLogin("google")}
            className="w-full rounded-lg bg-white text-ink font-semibold py-3 border border-ink/20 hover:bg-ink/5 transition"
          >
            Sign in with Google
          </button>
        </div>

        {isDev && (
          <div className="mt-8 pt-6 border-t border-ink/15 text-left">
            <p className="text-xs uppercase tracking-wide text-ink/50 mb-2">
              Dev login
            </p>
            <div className="flex gap-2">
              <input
                value={devName}
                onChange={(e) => setDevName(e.target.value)}
                placeholder="Character name"
                className="flex-1 rounded-lg border border-ink/20 px-3 py-2 bg-white/60"
              />
              <a
                href={`/api/auth/dev/login?name=${encodeURIComponent(devName || "Dev User")}`}
                className="rounded-lg bg-ember text-white px-4 py-2 font-semibold hover:opacity-90 transition"
              >
                Enter
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
