import { useState } from "react";
import DeleteAccountModal from "./DeleteAccountModal";

/*
 * Delete account (#322), beside "Your data" — take your things, then go. The
 * button only opens the modal that says what happens; nothing is asked of the
 * server until it is.
 */
export default function AccountDeletionSettings() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-body text-[13px] text-[#c9b183]">
          Delete your account and everything personal on it. You have a week to change your mind; what you wrote at a
          table stays, as from a departed player.
        </span>
        <button
          onClick={() => setOpen(true)}
          className="btn-base btn-ghost-ember clip-octagon ml-auto h-9 px-4 text-[12px]"
        >
          Delete account
        </button>
      </div>
      {open && <DeleteAccountModal onClose={() => setOpen(false)} />}
    </>
  );
}
