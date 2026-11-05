import { useState } from "react";
import { Link } from "react-router-dom";
import {
  deletionError,
  useAccountDeletion,
  useDownloadMyData,
  useForgetSession,
  useRequestAccountDeletion,
  useSendDeletionLink,
} from "../hooks";
import { deletionDay } from "../lib/deletionNotice";
import ParchmentModal from "./ui/ParchmentModal";

/**
 * Delete account (#322). Says what goes, what stays and how long there is to
 * change your mind, then confirms the way this account can: its password, a
 * link sent to its confirmed address, or its name typed when it has neither.
 * A table you still own blocks it — it is handed over or disbanded first.
 */
export default function DeleteAccountModal({ onClose }: { onClose: () => void }) {
  const { data: info, isLoading } = useAccountDeletion();
  const request = useRequestAccountDeletion();
  const sendLink = useSendDeletionLink();
  const download = useDownloadMyData();
  const forgetSession = useForgetSession();
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [scheduled, setScheduled] = useState<string | null>(null);

  const blocked = (info?.blockers.length ?? 0) > 0;
  const days = info?.graceDays ?? 7;
  const method = info?.method;
  const ready = method === "password" ? password.length > 0 : method === "name" ? name.trim().length > 0 : true;

  function confirm() {
    request.mutate(method === "password" ? { password } : { name }, {
      onSuccess: (d) => setScheduled(d.scheduledFor),
    });
  }

  // Closing after a scheduled deletion is leaving: the server has already
  // ended every session, so the app is told rather than left to find out.
  function leave() {
    forgetSession();
    onClose();
  }

  return (
    <ParchmentModal onClose={scheduled ? leave : onClose} maxWidth="max-w-[560px]">
      <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">Profile</div>
      <h3 className="font-display m-0 mb-4 text-center text-2xl font-bold text-ink">Delete account</h3>

      {scheduled ? (
        <>
          <p className="font-body m-0 mb-3 text-center text-[13.5px] text-ink-body">
            Your account will be deleted on <b>{deletionDay(scheduled)}</b>.
          </p>
          <p className="font-body m-0 mb-5 text-center text-[13px] italic text-ink-body">
            You have been signed out everywhere and your API tokens have stopped working. To keep the account, sign in
            again before then — that cancels it.
          </p>
          <div className="flex justify-end">
            <button onClick={leave} className="btn-base btn-gold clip-octagon h-10 px-6 text-[12px]">
              Done
            </button>
          </div>
        </>
      ) : isLoading || !info ? (
        <p className="font-body m-0 mb-5 text-center text-[13.5px] italic text-ink-body">Reading your account…</p>
      ) : (
        <>
          <div
            className="mb-3 rounded-[4px] px-3.5 py-3"
            style={{ background: "rgba(139,37,32,.08)", border: "1px solid rgba(139,37,32,.25)" }}
          >
            <p className="font-body m-0 text-[13px] text-ink-body">
              This deletes your account. You have <b>{days} days</b> to change your mind: signing in again before then
              cancels it.
            </p>
            <div className="font-body mt-2 grid gap-3 text-[12.5px] text-ink-body sm:grid-cols-2">
              <div>
                <div className="label-stamp mb-1 text-[10.5px] tracking-[2px] text-ink-label">What goes</div>
                <ul className="m-0 list-disc pl-5">
                  <li>Your heroes and their sheets</li>
                  <li>Your seats at tables</li>
                  <li>Your friends, blocks and sign-in methods</li>
                  <li>Your email address, API tokens and webhooks</li>
                </ul>
              </div>
              <div>
                <div className="label-stamp mb-1 text-[10.5px] tracking-[2px] text-ink-label">What stays</div>
                <ul className="m-0 list-disc pl-5">
                  <li>
                    What you wrote at a table and in messages, as from <i>a departed player</i>
                  </li>
                  <li>Homebrew a table has admitted</li>
                  <li>Notices and people you made as a co-DM</li>
                </ul>
              </div>
            </div>
          </div>

          {blocked && (
            <div className="font-body mb-3 text-[13px] text-ink-body">
              <p className="m-0 mb-1.5">
                You still own {info.blockers.length === 1 ? "this table" : "these tables"}. Hand{" "}
                {info.blockers.length === 1 ? "it" : "each"} over to another player or disband it, then come back:
              </p>
              <ul className="m-0 list-disc pl-5">
                {info.blockers.map((b) => (
                  <li key={b.campaignId}>
                    <Link to={`/questboard/campaigns/${b.campaignId}`} onClick={onClose} className="text-[#8b2520] underline">
                      {b.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="font-body mb-3 text-[12.5px] italic text-ink-body">
            Want a copy first?{" "}
            <button
              onClick={() => download.mutate()}
              disabled={download.isPending}
              className="cursor-pointer border-none bg-transparent p-0 text-[12.5px] italic underline"
              style={{ color: "#7a5c2e" }}
            >
              {download.isPending ? "Preparing…" : "Download my data"}
            </button>
            .
          </p>

          {!blocked && method === "password" && (
            <label className="mb-4 block">
              <span className="field-label">Your password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-parchment mt-1 w-full"
              />
            </label>
          )}
          {!blocked && method === "name" && (
            <label className="mb-4 block">
              <span className="field-label">Type your account name to confirm</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className="input-parchment mt-1 w-full" />
            </label>
          )}
          {!blocked && method === "email" && (
            <p className="font-body mb-4 text-[13px] text-ink-body">
              {sendLink.isSuccess
                ? "We sent a link to the email address on your account. Open it within the hour to finish — nothing is deleted until you do."
                : "We will email a one-time link to the address on your account. Opening it, and confirming on the page it leads to, schedules the deletion."}
            </p>
          )}

          {request.isError && (
            <div className="font-body mb-3 text-sm italic text-[#8b2520]">
              {deletionError(request.error, "That did not go through — nothing was scheduled.")}
            </div>
          )}
          {sendLink.isError && (
            <div className="font-body mb-3 text-sm italic text-[#8b2520]">
              {deletionError(sendLink.error, "The link could not be sent.")}
            </div>
          )}

          <div className="flex items-center justify-end gap-4">
            <button
              onClick={onClose}
              className="label-stamp cursor-pointer border-none bg-transparent px-2 text-[12px] text-ink-label transition hover:text-ink"
            >
              Cancel
            </button>
            {method === "email" ? (
              <button
                onClick={() => sendLink.mutate()}
                disabled={blocked || sendLink.isPending || sendLink.isSuccess}
                className="btn-base clip-octagon h-10 px-6 text-[12px] disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: "#8b2520", color: "#f3e6c8" }}
              >
                {sendLink.isPending ? "Sending…" : sendLink.isSuccess ? "Link sent" : "Email me a link"}
              </button>
            ) : (
              <button
                onClick={confirm}
                disabled={blocked || !ready || request.isPending}
                className="btn-base clip-octagon h-10 px-6 text-[12px] disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: "#8b2520", color: "#f3e6c8" }}
              >
                {request.isPending ? "Scheduling…" : "Delete my account"}
              </button>
            )}
          </div>
        </>
      )}
    </ParchmentModal>
  );
}
