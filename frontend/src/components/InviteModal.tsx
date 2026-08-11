/*
The invite code, and the two ways it used to go wrong (#207).

It was printed in the campaign header on every DM page, so it rode along in
every screenshot and every screen-share of the board, the tracker or the map —
and the button that replaced it sat one mis-tap away, unguarded, ready to lock
the whole party out mid-session.

So the header holds a door rather than a secret: nothing is rendered until
someone asks for it here, revealing is a deliberate second tap, and copying
works *without* revealing — the common case (paste it to a player) never needs
the code on screen at all. Forging a new one states what it costs and asks
again, because the cost falls on people who are not in the room.
*/

import { useEffect, useRef, useState } from "react";
import type { Campaign } from "../api/client";
import { useRegenerateInvite } from "../hooks";
import ParchmentModal from "./ui/ParchmentModal";
import { IconCopy, IconEye, IconEyeOff, IconRefresh } from "./ui/icons";

export default function InviteModal({
  campaign,
  onClose,
}: {
  campaign: Campaign;
  onClose: () => void;
}) {
  const regenerate = useRegenerateInvite(campaign.id);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  // A DM's own payload always carries the code; this guard is the type being
  // honest that a player's does not, rather than a state anyone can reach.
  const code = campaign.inviteCode ?? "";

  function copy() {
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }

  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[420px]">
      <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
        The Table
      </div>
      <h3 className="font-display m-0 mb-4 text-center text-2xl font-bold text-ink">
        The Invite
      </h3>

      <div className="flex flex-col gap-3">
        <div
          className="flex flex-wrap items-center justify-center gap-3 rounded-[3px] px-4 py-4"
          style={{ background: "rgba(90,60,25,.09)", boxShadow: "inset 0 0 0 1px rgba(124,90,46,.3)" }}
        >
          <span
            className="font-heading text-[26px] font-bold tracking-[6px] text-ink"
            // Announced as "hidden" rather than as six bullet characters.
            aria-label={shown ? code : "The invite code is hidden"}
          >
            {shown ? code : "••••••"}
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2.5">
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            className="btn-base btn-ghost-ink px-4 py-[9px] text-xs"
          >
            {shown ? <IconEyeOff size={13} /> : <IconEye size={13} />}
            {shown ? "Hide it" : "Reveal it"}
          </button>
          <button
            type="button"
            onClick={copy}
            className="btn-base btn-wax clip-octagon px-4 py-[9px] text-xs"
          >
            <IconCopy size={13} />
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <p className="font-body m-0 text-center text-[12.5px] italic text-ink-faded">
          Anyone holding this code walks in. Copy it straight to the player you
          mean to invite — you never have to put it on screen.
        </p>

        <div className="torn-divider" />

        {confirming ? (
          <div className="flex flex-col gap-2.5">
            <p className="font-body m-0 text-[13px] text-ink-body">
              Forge a new code? The old one stops working at once — anyone still
              holding it is locked out, including a player part-way through
              joining. Everyone already at the table stays.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="btn-base btn-ghost-ink px-4 py-[9px] text-xs"
              >
                Keep this one
              </button>
              <button
                type="button"
                disabled={regenerate.isPending}
                onClick={() =>
                  regenerate.mutate(undefined, {
                    onSuccess: () => {
                      setConfirming(false);
                      // Show the new one: the DM asked for it and needs to
                      // hand it out, and it is not the code anyone leaked.
                      setShown(true);
                    },
                  })
                }
                className="btn-base btn-ghost-red px-4 py-[9px] text-xs disabled:opacity-55"
              >
                {regenerate.isPending ? "Forging…" : "Forge a new code"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="btn-base btn-ghost-red px-3.5 py-2 text-[11px]"
            >
              <IconRefresh size={12} strokeWidth={1.8} />
              Forge a new code
            </button>
            <button onClick={onClose} className="btn-base btn-ghost-ink px-5 py-[11px] text-xs">
              Done
            </button>
          </div>
        )}
      </div>
    </ParchmentModal>
  );
}
