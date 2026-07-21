import { useEffect, useState } from "react";
import type { CurrentUser } from "../api/client";
import { useTwofaDisable, useTwofaEnable, useTwofaSetup, type TwofaSetup } from "../hooks";
import ParchmentModal from "./ui/ParchmentModal";

const PROVIDER_LABEL: Record<string, string> = { discord: "Discord", google: "Google", dev: "the Dev Forge" };

type TwofaError = { data?: { error?: string } };
const errText = (e: unknown, fallback: string) => (e as TwofaError)?.data?.error ?? fallback;

/** The two-factor section of the profile's Settings. TOTP applies to password
 *  accounts; OAuth users are told their provider already covers sign-in. */
export default function TwoFactorSettings({ user }: { user: CurrentUser["user"] }) {
  const [enrolling, setEnrolling] = useState(false);
  const [disabling, setDisabling] = useState(false);

  if (user.provider !== "local") {
    return (
      <p className="font-body m-0 text-[13px] italic text-[#9c855e]">
        Your {PROVIDER_LABEL[user.provider] ?? "provider"} account already secures sign-in — there's nothing to set up here.
      </p>
    );
  }

  return (
    <div>
      {user.twofaEnabled ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="label-stamp rounded-[2px] px-2 py-0.5 text-[10px] font-bold tracking-[1.5px]" style={{ color: "#7ea63f", background: "rgba(126,166,63,.14)", boxShadow: "inset 0 0 0 1px rgba(126,166,63,.5)" }}>
            ON
          </span>
          <span className="font-body text-[13px] text-[#c9b183]">You'll enter a code from your authenticator when you sign in.</span>
          <button
            onClick={() => setDisabling(true)}
            className="btn-base ml-auto h-9 px-4 text-[12px]"
            style={{ color: "#d68a72", background: "rgba(139,37,32,.14)", boxShadow: "inset 0 0 0 1px rgba(139,37,32,.5)" }}
          >
            Turn off
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-body text-[13px] text-[#c9b183]">
            Add a one-time code at sign-in, from an app like Google Authenticator or Authy.
          </span>
          <button onClick={() => setEnrolling(true)} className="btn-base btn-gold clip-octagon ml-auto h-9 px-4 text-[12px]">
            Enable 2FA
          </button>
        </div>
      )}

      {enrolling && <EnrollModal onClose={() => setEnrolling(false)} />}
      {disabling && <DisableModal onClose={() => setDisabling(false)} />}
    </div>
  );
}

function EnrollModal({ onClose }: { onClose: () => void }) {
  const setup = useTwofaSetup();
  const enable = useTwofaEnable();
  const [data, setData] = useState<TwofaSetup | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);

  // Kick off setup once when the modal opens.
  const run = setup.mutate;
  useEffect(() => {
    run(undefined, { onSuccess: setData });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function confirm() {
    enable.mutate(code.trim(), { onSuccess: (r) => setCodes(r.recoveryCodes) });
  }

  function copy() {
    if (codes) {
      navigator.clipboard?.writeText(codes.join("\n")).then(() => setCopied(true)).catch(() => {});
    }
  }

  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[440px]">
      <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">Two-factor auth</div>

      {codes ? (
        <>
          <h3 className="font-display m-0 mb-2 text-center text-2xl font-bold text-ink">Save your recovery codes</h3>
          <p className="font-body m-0 mb-4 text-center text-[13px] italic text-ink-body">
            Keep these somewhere safe. Each one works <strong>once</strong> if you ever lose your authenticator.
          </p>
          <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-[4px] px-5 py-4" style={{ background: "rgba(60,40,15,.06)", boxShadow: "inset 0 0 0 1px rgba(120,80,30,.2)" }}>
            {codes.map((c) => (
              <span key={c} className="text-center font-mono text-[15px] tracking-[1px] text-ink">{c}</span>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3">
            <button onClick={copy} className="btn-base h-10 px-4 text-[12px]" style={{ color: "#4a3a24", boxShadow: "inset 0 0 0 1px rgba(120,80,30,.4)" }}>
              {copied ? "Copied ✓" : "Copy codes"}
            </button>
            <button onClick={onClose} className="btn-base btn-gold clip-octagon h-10 px-6 text-[12px]">I've saved them</button>
          </div>
        </>
      ) : (
        <>
          <h3 className="font-display m-0 mb-3 text-center text-2xl font-bold text-ink">Scan the code</h3>
          {setup.isPending || !data ? (
            <p className="font-accent py-10 text-center text-[14px] italic text-ink-body">Preparing your secret…</p>
          ) : (
            <>
              <div className="mb-3 flex justify-center">
                <img src={data.qrPng} alt="2FA QR code" width={200} height={200} className="rounded-[4px]" style={{ boxShadow: "0 0 0 6px #fff, inset 0 0 0 1px rgba(0,0,0,.1)" }} />
              </div>
              <p className="font-body m-0 mb-1 text-center text-[12.5px] text-ink-body">
                Scan with your authenticator app, or enter this key by hand:
              </p>
              <div className="mb-4 text-center font-mono text-[13px] tracking-[1px] text-ink-label">{data.secret}</div>
              <label className="mb-1 block">
                <span className="field-label">Enter the 6-digit code it shows</span>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  className="input-parchment mt-1 w-full text-center font-mono text-[18px] tracking-[6px]"
                  onKeyDown={(e) => e.key === "Enter" && code.length === 6 && confirm()}
                />
              </label>
              {enable.isError && <div className="mb-1 text-[11.5px] italic text-[#8b2520]">{errText(enable.error, "That code didn't match.")}</div>}
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={onClose} className="btn-base h-10 px-4 text-[12px]" style={{ color: "#6b5836" }}>Cancel</button>
                <button onClick={confirm} disabled={code.length !== 6 || enable.isPending} className="btn-base btn-gold clip-octagon h-10 px-6 text-[12px] disabled:opacity-50">
                  Confirm
                </button>
              </div>
            </>
          )}
        </>
      )}
    </ParchmentModal>
  );
}

function DisableModal({ onClose }: { onClose: () => void }) {
  const disable = useTwofaDisable();
  const [password, setPassword] = useState("");

  function submit() {
    disable.mutate(password, { onSuccess: onClose });
  }

  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[400px]">
      <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">Two-factor auth</div>
      <h3 className="font-display m-0 mb-2 text-center text-2xl font-bold text-ink">Turn off 2FA</h3>
      <p className="font-body m-0 mb-4 text-center text-[13px] italic text-ink-body">
        Confirm your password to remove the second factor from your account.
      </p>
      <label className="block">
        <span className="field-label">Password</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="input-parchment mt-1 w-full"
          onKeyDown={(e) => e.key === "Enter" && password && submit()}
        />
      </label>
      {disable.isError && <div className="mt-1 text-[11.5px] italic text-[#8b2520]">{errText(disable.error, "That password is incorrect.")}</div>}
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="btn-base h-10 px-4 text-[12px]" style={{ color: "#6b5836" }}>Cancel</button>
        <button
          onClick={submit}
          disabled={!password || disable.isPending}
          className="btn-base clip-octagon h-10 px-6 text-[12px] disabled:opacity-50"
          style={{ color: "#fff", background: "linear-gradient(180deg,#a33328,#7f2119)", boxShadow: "inset 0 0 0 1px rgba(139,37,32,.6)" }}
        >
          Turn off 2FA
        </button>
      </div>
    </ParchmentModal>
  );
}
