import { useEffect, useState, type FormEvent } from "react";
import type { Campaign } from "../../api/client";
import { useSetNextSession } from "../../hooks";
import ParchmentModal from "./ParchmentModal";
import { IconFlag } from "./icons";

/* "yyyy-MM-ddTHH:mm" in local time, for <input type="datetime-local">. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function countdown(target: Date, now: number): string {
  const diff = target.getTime() - now;
  if (diff <= 0) return "the table is gathered!";
  const mins = Math.floor(diff / 60_000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${mins % 60}m`;
  return `in ${Math.max(mins, 1)}m`;
}

function formatWhen(date: Date): string {
  return `${date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })} · ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

/**
 * Next-gathering countdown. Everyone sees it; the DM can click it to
 * schedule, move, or clear the session.
 */
export default function NextSessionChip({
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

  // Players see nothing until the DM schedules a session.
  if (!scheduled && !isDM) return null;

  function open() {
    if (!isDM) return;
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

  const Chip = isDM ? "button" : "div";

  return (
    <>
      <Chip
        onClick={isDM ? open : undefined}
        title={isDM ? "Schedule the next gathering" : undefined}
        className={`chip-hall border-none px-3.5 py-[9px] ${
          isDM ? "cursor-pointer transition hover:brightness-125" : ""
        }`}
      >
        <span className="label-stamp text-[9px] tracking-[1.5px] text-gold-muted">
          Next Gathering
        </span>
        {scheduled ? (
          <>
            <span className="font-heading text-[12.5px] font-semibold text-[#e6d5af]">
              {formatWhen(scheduled)}
            </span>
            <span className="font-accent text-[12.5px] italic text-ember-bright">
              {countdown(scheduled, now)}
            </span>
          </>
        ) : (
          <span className="font-accent text-[12.5px] italic text-cream-muted">
            unscheduled — set one
          </span>
        )}
      </Chip>

      {editing && (
        <ParchmentModal onClose={() => setEditing(false)} maxWidth="max-w-[400px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            The Next Gathering
          </div>
          <h3 className="font-display m-0 mb-1.5 text-center text-2xl font-bold text-ink">
            When Does the Table Meet?
          </h3>
          <p className="font-body m-0 mb-5 text-center text-[13.5px] italic leading-relaxed text-ink-body">
            The whole party sees the countdown by the campaign name.
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
    </>
  );
}
