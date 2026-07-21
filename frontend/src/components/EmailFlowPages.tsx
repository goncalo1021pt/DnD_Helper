import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { passwordStrength } from "../lib/password";

/** Centered parchment card on the hearth — the shell for the email flows. */
function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-hearth font-body flex min-h-screen items-center justify-center p-6 text-cream">
      <div className="parchment w-full max-w-[440px] px-8 pb-8 pt-9">
        <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
          Quest Board
        </div>
        <h1 className="font-display m-0 mb-4 text-center text-[26px] font-black text-ink">
          {title}
        </h1>
        {children}
      </div>
    </div>
  );
}

const backToTavern = (
  <div className="mt-6 text-center">
    <Link to="/" className="label-stamp text-[11px] text-[#8b2520] no-underline hover:underline">
      ← Back to the tavern
    </Link>
  </div>
);

/** Confirms an email from the link in the verification message. */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<"working" | "ok" | "fail">("working");

  useEffect(() => {
    if (!token) {
      setState("fail");
      return;
    }
    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => setState(r.status === 204 ? "ok" : "fail"))
      .catch(() => setState("fail"));
  }, [token]);

  return (
    <AuthShell title="Confirm your email">
      {state === "working" && (
        <p className="font-accent m-0 text-center text-[14px] italic text-ink-body">
          Checking your link…
        </p>
      )}
      {state === "ok" && (
        <>
          <p className="font-body m-0 text-center text-[14px] text-ink-body">
            Your email is confirmed — your account is secured and password recovery is enabled.
          </p>
          <div className="mt-6 flex justify-center">
            <Link to="/questboard" className="btn-base btn-gold clip-octagon h-11 px-6 text-[13px] no-underline">
              Enter the Tavern
            </Link>
          </div>
        </>
      )}
      {state === "fail" && (
        <>
          <p className="font-body m-0 text-center text-[14px] text-ink-body">
            This confirmation link is invalid or has expired. You can request a fresh one from the
            banner once you're signed in.
          </p>
          {backToTavern}
        </>
      )}
    </AuthShell>
  );
}

/** Requests a password-reset email. Always reports the same thing back. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      /* even on error we show the same neutral message */
    }
    setBusy(false);
    setSent(true);
  }

  return (
    <AuthShell title="Reset your password">
      {sent ? (
        <>
          <p className="font-body m-0 text-center text-[14px] text-ink-body">
            If an account exists for <span className="font-semibold">{email}</span>, a reset link is
            on its way. Check your inbox — the link expires in an hour.
          </p>
          {backToTavern}
        </>
      ) : (
        <form onSubmit={submit}>
          <p className="font-body m-0 mb-4 text-center text-[13.5px] italic text-ink-body">
            Enter your account's email and we'll send a link to set a new password.
          </p>
          <label className="block">
            <span className="field-label">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoCapitalize="none"
              className="input-parchment mt-1 w-full"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !email.trim()}
            className="btn-base btn-gold clip-octagon mt-5 h-11 w-full text-[13px] disabled:opacity-60"
          >
            {busy ? "Sending…" : "Send reset link"}
          </button>
          {backToTavern}
        </form>
      )}
    </AuthShell>
  );
}

/** Sets a new password from the reset link's token. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const strength = passwordStrength(password);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (res.status === 204) {
        setDone(true);
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Couldn't reset your password — try again.");
      }
    } catch {
      setError("Couldn't reach the tavern. Check your connection.");
    }
    setBusy(false);
  }

  if (!token) {
    return (
      <AuthShell title="Reset your password">
        <p className="font-body m-0 text-center text-[14px] text-ink-body">This reset link is missing its token.</p>
        {backToTavern}
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Set a new password">
      {done ? (
        <>
          <p className="font-body m-0 text-center text-[14px] text-ink-body">
            Your password is set. Sign in with it now.
          </p>
          <div className="mt-6 flex justify-center">
            <Link to="/" className="btn-base btn-gold clip-octagon h-11 px-6 text-[13px] no-underline">
              Go to sign in
            </Link>
          </div>
        </>
      ) : (
        <form onSubmit={submit}>
          <label className="block">
            <span className="field-label">New password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className="input-parchment mt-1 w-full"
            />
            {password && (
              <div className="mt-1.5 text-[11px] italic" style={{ color: strength.score >= 3 ? "#7ea63f" : strength.score === 2 ? "#c99a3f" : "#b5654e" }}>
                {strength.label}
              </div>
            )}
          </label>
          {error && <div className="mt-2 text-[12.5px] italic text-[#8b2520]">{error}</div>}
          <button
            type="submit"
            disabled={busy || !password}
            className="btn-base btn-gold clip-octagon mt-5 h-11 w-full text-[13px] disabled:opacity-60"
          >
            {busy ? "Setting…" : "Set new password"}
          </button>
          {backToTavern}
        </form>
      )}
    </AuthShell>
  );
}
