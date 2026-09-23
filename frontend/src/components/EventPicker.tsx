import type { EventName } from "../api/client";
import { EVENT_GROUPS, type EventEntry } from "../lib/events";

/*
 * The event picker (#347): the one component behind the three places a
 * person chooses from the catalogue — the email preferences, a webhook, the
 * table's Herald. It speaks to a person: the sentence is the label, the rows
 * stand in four groups by what they are about rather than in catalogue
 * order, and the machine name is small secondary text only where a script
 * will filter on it. "Everything" is an explicit first choice where the
 * surface offers it, meaning the empty list the wire already reads as all.
 * The wire is untouched — the same names go to the server, and the input
 * names (`<prefix>-<event>`) are what the specs drive.
 */

type Props = {
  /** What this surface offers, already filtered (EMAIL_EVENTS, TABLE_EVENTS, …). */
  events: EventEntry[];
  picked: Set<EventName>;
  onToggle: (name: EventName) => void;
  namePrefix: string;
  /** Parchment surfaces take ink; the hall (the profile) takes cream. */
  surface: "hall" | "parchment";
  /** Show the catalogue name beside the sentence — a signed webhook, where a script filters on it. */
  showNames?: boolean;
  /** Offer "everything" as a choice of its own: on when nothing is picked, and clearing the picks when chosen. */
  everything?: { label: string; onSet: () => void };
};

export default function EventPicker({ events, picked, onToggle, namePrefix, surface, showNames = false, everything }: Props) {
  const hall = surface === "hall";
  const text = hall ? "text-[#e6d5af]" : "text-ink";
  const dim = hall ? "text-[#9c855e]" : "text-ink-body";
  const head = hall ? "text-[#9c855e]" : "text-ink-label";
  const groups = EVENT_GROUPS.map((group) => ({ group, rows: events.filter((e) => e.group === group) })).filter(
    (g) => g.rows.length > 0,
  );
  const all = !!everything && picked.size === 0;

  return (
    <div data-testid={`${namePrefix}-picker`}>
      {everything && (
        <label
          className={`mb-3 flex cursor-pointer items-baseline gap-2 pb-2 font-body text-[12.5px] ${text}`}
          style={{ borderBottom: hall ? "1px solid rgba(201,162,39,.14)" : "1px solid rgba(120,80,30,.18)" }}
        >
          <input
            type="checkbox"
            checked={all}
            onChange={() => {
              if (!all) everything.onSet();
            }}
            name={`${namePrefix}-everything`}
          />
          <span className={all ? "font-semibold" : ""}>{everything.label}</span>
          <span className={`text-[11px] italic ${dim}`}>{all ? "or pick from below" : "tick to hear every one"}</span>
        </label>
      )}
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {groups.map(({ group, rows }) => (
          <div key={group}>
            <div className={`label-stamp mb-1 text-[9.5px] tracking-[1.5px] ${head}`}>{group}</div>
            <div className="grid gap-y-1">
              {rows.map((ev) => (
                <label key={ev.name} className={`flex cursor-pointer items-baseline gap-2 font-body text-[12.5px] ${text}`}>
                  <input type="checkbox" checked={picked.has(ev.name)} onChange={() => onToggle(ev.name)} name={`${namePrefix}-${ev.name}`} />
                  <span className="flex flex-col">
                    <span>{ev.label}</span>
                    {showNames && <span className={`font-mono text-[10px] leading-tight ${dim}`}>{ev.name}</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
