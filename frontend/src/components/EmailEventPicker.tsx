import type { EventName } from "../api/client";
import { DIGEST_SUITED, EVENT_GROUPS, type EventEntry } from "../lib/events";

/*
 * The email preferences (#339): every event is off, sent as it happens, or
 * held for the daily digest. Three answers to one question, so each row is a
 * radio group — `email-<event>` with the values off / now / daily — rather
 * than the checkbox the other pickers use. The chronicle has no "now": a line
 * per email is a flood, so it is daily or nothing. The events a digest suits
 * say so; that is a suggestion, never a default.
 */

export type EmailMode = "off" | "now" | "daily";

type Props = {
  events: EventEntry[];
  modes: Map<EventName, EmailMode>;
  onSet: (name: EventName, mode: EmailMode) => void;
};

export default function EmailEventPicker({ events, modes, onSet }: Props) {
  const groups = EVENT_GROUPS.map((group) => ({ group, rows: events.filter((e) => e.group === group) })).filter((g) => g.rows.length > 0);
  return (
    <div data-testid="email-picker" className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      {groups.map(({ group, rows }) => (
        <div key={group}>
          <div className="label-stamp mb-1 text-[9.5px] tracking-[1.5px] text-[#9c855e]">{group}</div>
          <div className="grid gap-y-2">
            {rows.map((ev) => {
              const mode = modes.get(ev.name) ?? "off";
              const nowAllowed = ev.name !== "chronicle.written";
              return (
                <div key={ev.name} role="radiogroup" aria-label={ev.label} className="font-body text-[12.5px] text-[#e6d5af]">
                  <div>
                    {ev.label}
                    {DIGEST_SUITED.includes(ev.name) && <span className="ml-1.5 text-[10.5px] italic text-[#9c855e]">daily suits this</span>}
                  </div>
                  <div className="mt-0.5 flex gap-3 text-[12px] text-[#c9b183]">
                    {(["off", "now", "daily"] as EmailMode[]).map((m) => {
                      if (m === "now" && !nowAllowed) return null;
                      return (
                        <label key={m} className={`flex cursor-pointer items-center gap-1 ${mode === m ? "font-semibold text-[#e6d5af]" : ""}`}>
                          <input type="radio" name={`email-${ev.name}`} value={m} checked={mode === m} onChange={() => onSet(ev.name, m)} />
                          {m === "off" ? "Off" : m === "now" ? "Now" : "Daily"}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
