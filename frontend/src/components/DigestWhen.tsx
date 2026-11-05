import type { WebhookCadence } from "../api/client";
import { hourOptions } from "../lib/digest";

/*
 * When a Discord message is sent (#339): as it happens, or once a day at an
 * hour. Used by a person's own Discord hook and by the table's Herald — the
 * two places a Discord-format hook is made. Hours are shown in the reader's
 * own time; the server keeps them in UTC.
 */

type Props = {
  cadence: WebhookCadence;
  hour: number;
  onChange: (cadence: WebhookCadence, hour: number) => void;
  surface: "hall" | "parchment";
  namePrefix: string;
};

export function HourSelect({ hour, onChange, surface, name, label }: { hour: number; onChange: (utc: number) => void; surface: "hall" | "parchment"; name: string; label: string }) {
  return (
    <select
      value={hour}
      onChange={(e) => onChange(Number(e.target.value))}
      name={name}
      aria-label={label}
      className={surface === "hall" ? "rounded-[3px] bg-transparent px-1.5 py-0.5 font-body text-[12.5px] text-[#e6d5af]" : "input-parchment px-1.5 py-0.5 text-[12.5px]"}
      style={surface === "hall" ? { boxShadow: "inset 0 0 0 1px rgba(201,162,39,.35)" } : { width: "auto" }}
    >
      {hourOptions().map((o) => (
        <option key={o.utc} value={o.utc} style={surface === "hall" ? { color: "#1a0f08" } : undefined}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export default function DigestWhen({ cadence, hour, onChange, surface, namePrefix }: Props) {
  const text = surface === "hall" ? "text-[#e6d5af]" : "text-ink";
  const dim = surface === "hall" ? "text-[#9c855e]" : "text-ink-body";
  return (
    <div role="radiogroup" aria-label="When" className="grid gap-1.5">
      <label className={`flex cursor-pointer items-baseline gap-2 font-body text-[12.5px] ${text}`}>
        <input type="radio" name={`${namePrefix}-cadence`} value="immediate" checked={cadence === "immediate"} onChange={() => onChange("immediate", hour)} />
        <span>As it happens</span>
        <span className={`text-[11px] italic ${dim}`}>one message per event</span>
      </label>
      <label className={`flex cursor-pointer flex-wrap items-baseline gap-2 font-body text-[12.5px] ${text}`}>
        <input type="radio" name={`${namePrefix}-cadence`} value="daily" checked={cadence === "daily"} onChange={() => onChange("daily", hour)} />
        <span>Once a day, at</span>
        <HourSelect hour={hour} onChange={(h) => onChange("daily", h)} surface={surface} name={`${namePrefix}-hour`} label="Hour of the daily digest" />
        <span className={`text-[11px] italic ${dim}`}>your time — nothing is sent on a quiet day</span>
      </label>
    </div>
  );
}
