import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { ChronicleEvent } from "../api/client";
import { useAddNote, useEvents } from "../hooks";
import { formatWhen } from "../lib/dates";
import type { CampaignContext } from "./CampaignView";

/** Kind → tint for the event's stamp. */
const KIND_TONE: Record<string, string> = {
  note: "#d0a75a",
  milestone: "#ecc673",
  xp: "#8fb15f",
  level_up: "#ecc673",
  quest_posted: "#c9a96b",
  quest_claimed: "#c9a96b",
  quest_completed: "#8fb15f",
  hero_seated: "#a8967a",
  hero_unseated: "#a8967a",
  codex_proposed: "#d0a75a",
  codex_enabled: "#8fb15f",
  codex_banned: "#c96a5a",
  session_set: "#c9a96b",
  progression: "#a8967a",
};

const KIND_LABEL: Record<string, string> = {
  note: "the DM writes",
  milestone: "milestone",
  xp: "experience",
  level_up: "level up",
  quest_posted: "the board",
  quest_claimed: "the board",
  quest_completed: "the board",
  hero_seated: "the party",
  hero_unseated: "the party",
  codex_proposed: "the codex",
  codex_enabled: "the codex",
  codex_banned: "the codex",
  session_set: "the gathering",
  progression: "the table",
};

export function EventLine({ event }: { event: ChronicleEvent }) {
  const tone = KIND_TONE[event.kind] ?? "#a8967a";
  return (
    <div className="flex items-baseline gap-3">
      <span
        className="mt-1 h-2 w-2 flex-none translate-y-[1px] rounded-full"
        style={{ background: tone, boxShadow: `0 0 6px ${tone}66` }}
      />
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] leading-snug text-cream-soft">{event.message}</div>
        <div className="label-stamp mt-0.5 text-[8.5px] tracking-[1.5px] text-gold-muted">
          {KIND_LABEL[event.kind] ?? event.kind}
          {" · "}
          {formatWhen(new Date(event.createdAt))}
        </div>
      </div>
    </div>
  );
}

export default function ChroniclePage() {
  const { campaign, role } = useOutletContext<CampaignContext>();
  const isDM = role === "dm";
  const { data: events, isLoading } = useEvents(campaign.id, 200);
  const addNote = useAddNote(campaign.id);
  const [note, setNote] = useState("");

  return (
    <div className="panel-hall px-5 pb-11 pt-8 sm:px-[30px]">
      <div
        className="mb-6 flex flex-wrap items-center justify-between gap-4 pb-3.5"
        style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
      >
        <div>
          <h2
            className="font-display m-0 text-[clamp(24px,3vw,32px)] font-black text-[#e7d3a6]"
            style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
          >
            The Chronicle
          </h2>
          <div className="font-accent mt-1 text-[13px] italic text-cream-muted">
            Everything that happened at this table, newest first.
          </div>
        </div>
      </div>

      {isDM && (
        <div className="mb-7 flex flex-wrap items-center gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && note.trim()) {
                addNote.mutate(note.trim(), { onSuccess: () => setNote("") });
              }
            }}
            maxLength={500}
            placeholder="Write a story entry — the party will read it here…"
            className="input-hall min-w-0 flex-1"
          />
          <button
            onClick={() => addNote.mutate(note.trim(), { onSuccess: () => setNote("") })}
            disabled={!note.trim() || addNote.isPending}
            className="btn-base btn-gold clip-octagon h-10 px-5 text-[12px]"
          >
            Chronicle it
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="font-accent px-5 py-[60px] text-center text-base italic text-[#9c855e]">
          Unrolling the chronicle…
        </div>
      ) : (events ?? []).length === 0 ? (
        <div className="font-accent px-5 py-[60px] text-center text-base italic text-[#9c855e]">
          The first page is still blank — deeds will write themselves here.
        </div>
      ) : (
        <div className="flex max-w-[720px] flex-col gap-4">
          {(events ?? []).map((e) => (
            <EventLine key={e.id} event={e} />
          ))}
        </div>
      )}
    </div>
  );
}
