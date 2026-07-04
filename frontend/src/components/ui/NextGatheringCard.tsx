import { useEffect, useState, type FormEvent } from "react";
import type { Campaign } from "../../api/client";
import { useSetNextSession } from "../../hooks";
import { countdownParts, formatWhen, toLocalInput } from "../../lib/dates";
import ParchmentModal from "./ParchmentModal";
import { IconFlag, IconPencil } from "./icons";

const pad2 = (n: number) => String(n).padStart(2, "0");

function Tile({ value, label }: { value: number; label: string }) {
  return (
    <div className="chip-hall flex-col justify-center gap-0.5 px-2 py-3">
      <span className="font-heading text-[26px] font-bold leading-none tabular-nums text-ember-bright">
        {pad2(value)}
      </span>
      <span className="label-stamp text-[9px] tracking-[1.5px] text-gold-muted">
        {label}
      </span>
    </div>
  );
}

/**
 * Next-gathering dashboard card (the Emberhall countdown, in hall skin):
 * date line + Days/Hrs/Min tiles ticking live. The DM schedules, moves,
 * or clears the session from here.
 */
export default function NextGatheringCard({
  campaign,
  isDM,
}: {
  campaign: Campaign;
  isDM: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const setSession = useSetNextSession(campaign.id);

  // Re-render every 30s so the countdown stays honest.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const scheduled = campaign.nextSessionAt ? new Date(campaign.nextSessionAt) : null;
  const parts = scheduled ? countdownParts(scheduled, now) : null;

  function open() {
    setValue(scheduled ? toLocalInput(scheduled) : "");
    setEditing(true);
  }

  function save(e: FormEvent) {
    e.preventDefault();
    if (!value) return;
    setSession.mutate(new Date(value).toISOString(), {
      onSuccess: () => setEditing(false),
    });
  }

  function clear() {
    setSession.mutate(null, { onSuccess: () => setEditing(false) });
  }

  return (
    <div className="panel-hall relative overflow-hidden px-6 pb-6 pt-5">
      {/* ember glow, top-right */}
      <div
        className="anim-flicker pointer-events-none absolute -right-10 -top-10 h-36 w-36"
        style={{
          background:
            "radial-gradient(circle, rgba(217,124,49,.28), transparent 68%)",
        }}
      />

      <div className="mb-1 flex items-center justify-between">
        <span className="label-stamp text-[10px] tracking-[2.5px] text-gold-muted">
          Next Gathering
        </span>
        {isDM && (
          <button
            onClick={open}
            title={scheduled ? "Move or clear the date" : "Mark the date"}
            className="relative inline-flex cursor-pointer border-none bg-transparent p-1 text-gold-muted transition hover:text-ember-bright"
          >
            <IconPencil size={14} strokeWidth={1.8} />
          </button>
        )}
      </div>

      {scheduled && parts ? (
        <>
          <div className="font-heading mb-4 text-xl font-semibold text-cream">
            {formatWhen(scheduled)}
          </div>
          {parts.past ? (
            <div className="font-accent py-3 text-center text-lg italic text-ember-bright">
              — the table is gathered! —
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2.5 text-center">
              <Tile value={parts.days} label="Days" />
              <Tile value={parts.hours} label="Hrs" />
              <Tile value={parts.mins} label="Min" />
            </div>
          )}
        </>
      ) : (
        <div className="font-accent py-4 text-[15px] italic text-cream-muted">
          No session marked —{" "}
          {isDM ? "the quill awaits your date." : "ask your Dungeon Master."}
        </div>
      )}

      {editing && (
        <ParchmentModal onClose={() => setEditing(false)} maxWidth="max-w-[400px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            The Next Gathering
          </div>
          <h3 className="font-display m-0 mb-1.5 text-center text-2xl font-bold text-ink">
            When Does the Table Meet?
          </h3>
          <p className="font-body m-0 mb-5 text-center text-[13.5px] italic leading-relaxed text-ink-body">
            The whole party sees the countdown in the campaign hall.
          </p>
          <form onSubmit={save} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="field-label">Date &amp; time</span>
              <input
                type="datetime-local"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="input-parchment input-compact"
              />
            </label>

            {setSession.isError && (
              <p className="font-body m-0 text-sm italic text-[#8b2520]">
                The date would not take — try again.
              </p>
            )}

            <div className="flex gap-2.5">
              <button
                type="submit"
                disabled={setSession.isPending || !value}
                className="btn-base btn-wax clip-octagon px-6 py-[11px] text-xs"
              >
                <IconFlag size={13} strokeWidth={2} />
                Mark the date
              </button>
              {scheduled && (
                <button
                  type="button"
                  onClick={clear}
                  disabled={setSession.isPending}
                  className="btn-base btn-ghost-red px-5 py-[11px] text-xs"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="btn-base btn-ghost-ink px-5 py-[11px] text-xs"
              >
                Cancel
              </button>
            </div>
          </form>
        </ParchmentModal>
      )}
    </div>
  );
}
