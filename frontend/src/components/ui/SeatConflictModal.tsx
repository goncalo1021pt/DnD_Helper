import { useState } from "react";
import type { SeatConflict } from "../../api/client";
import { useProposeCodex } from "../../hooks";
import ParchmentModal from "./ParchmentModal";

/*
Why a hero was held at the door.

Strict seating refuses a hero whose class, species, background, subclass, spells
or content-backed gear the target campaign's codex has not admitted — and the
server says exactly which, in the 409's `missing` payload. This is the screen
that reads it out.

It lives here, shared, because there are two doors into a table: seating a hero
from My Heroes, and summoning one onto a roster. Only the first ever explained
itself (#128); a player who used the other just watched a button do nothing.
*/
export default function SeatConflictModal({
  heroName,
  conflict,
  onClose,
}: {
  heroName: string;
  conflict: { campaignId: string; campaignName: string; missing: SeatConflict["missing"] };
  onClose: () => void;
}) {
  const propose = useProposeCodex(conflict.campaignId);
  const proposable = conflict.missing.filter((m) => m.state === "absent");
  const [sent, setSent] = useState(false);

  const stateText = { absent: "not offered yet", proposed: "awaiting the DM", banned: "banned by the DM" };
  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[460px]">
      <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
        Held at the door
      </div>
      <h3 className="font-display m-0 mb-2 text-center text-2xl font-bold text-ink">
        The Codex Objects
      </h3>
      <p className="font-body m-0 mb-4 text-center text-[13.5px] italic text-ink-body">
        {conflict.campaignName} has not admitted everything {heroName} is made of:
      </p>
      <div className="mb-5 flex flex-col gap-2">
        {conflict.missing.map((m) => (
          <div key={m.id} className="flex items-center justify-between gap-3 text-[13.5px]">
            <span>
              <span className="font-heading font-bold">{m.name}</span>
              <span className="label-stamp ml-2 text-[8.5px] tracking-[1px] text-ink-label">{m.kind}</span>
            </span>
            <span className={`label-stamp text-[9px] tracking-[1px] ${m.state === "banned" ? "text-[#8b2520]" : "text-ink-label"}`}>
              {stateText[m.state]}
            </span>
          </div>
        ))}
      </div>
      {sent ? (
        <p className="font-accent m-0 text-center text-[13.5px] italic text-ink-body">
          Sent — once the DM admits it, seat {heroName} again.
        </p>
      ) : (
        <div className="flex items-center justify-end gap-3">
          <button onClick={onClose} className="btn-base btn-ghost-ink px-5 py-[11px] text-xs">
            Close
          </button>
          {proposable.length > 0 && (
            <button
              onClick={() =>
                propose.mutate(
                  proposable.map((m) => m.id),
                  { onSuccess: () => setSent(true) },
                )
              }
              disabled={propose.isPending}
              className="btn-base btn-gold clip-octagon h-11 px-5 text-[13px]"
            >
              {propose.isPending ? "Sending…" : "Send to the DM"}
            </button>
          )}
        </div>
      )}
    </ParchmentModal>
  );
}
