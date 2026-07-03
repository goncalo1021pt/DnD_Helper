import { useState } from "react";
import { useAuthConfig } from "../hooks";

// Full-page redirect to the backend OAuth flow.
function providerLogin(provider: string) {
  window.location.href = `/api/auth/${provider}/login`;
}

const PROVIDER_META: Record<string, { label: string; className: string }> = {
  discord: { label: "Sign in with Discord", className: "bg-[#5865F2] text-white" },
  google: {
    label: "Sign in with Google",
    className: "bg-white text-ink border border-ink/20",
  },
};

export default function LoginScreen() {
  const { data: config } = useAuthConfig();
  const [devName, setDevName] = useState("");

  const providers = config?.providers ?? [];
  const devLogin = config?.devLogin ?? false;

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl bg-parchment shadow-2xl border-4 border-wood p-8 text-center">
        <h1 className="font-display text-3xl text-wood-dark mb-1">The Quest Board</h1>
        <p className="text-ink/70 mb-8">Sign in to view the board.</p>

        <div className="space-y-3">
          {providers.map((p) => {
            const meta = PROVIDER_META[p] ?? {
              label: `Sign in with ${p}`,
              className: "bg-wood text-parchment",
            };
            return (
              <button
                key={p}
                onClick={() => providerLogin(p)}
                className={`w-full rounded-lg font-semibold py-3 hover:opacity-90 transition ${meta.className}`}
              >
                {meta.label}
              </button>
            );
          })}
          {config && providers.length === 0 && !devLogin && (
            <p className="text-sm text-ink/60">
              No login methods are configured yet.
            </p>
          )}
        </div>

        {devLogin && (
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
