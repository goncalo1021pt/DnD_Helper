import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { ChronicleEvent } from "../api/client";
import { useAddNote, useEvents } from "../hooks";
import { formatWhen } from "../lib/dates";
import type { CampaignContext } from "./CampaignView";

/** Channel → accent + label, for the written entries (dm/rules/player). */
const CATEGORY_META: Record<string, { label: string; tone: string }> = {
  dm: { label: "DM", tone: "#d0a75a" },
  rules: { label: "Ruling", tone: "#c96a5a" },
  player: { label: "Player", tone: "#6fa8c9" },
  log: { label: "", tone: "#a8967a" },
};

/** Kind → tint/label for the system "happenings" lines. */
const KIND_TONE: Record<string, string> = {
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

const FILTERS: Array<[string, string]> = [
  ["all", "All"],
  ["dm", "DM notes"],
  ["rules", "Rulings"],
  ["player", "Player chat"],
  ["log", "Happenings"],
];

export function EventLine({ event }: { event: ChronicleEvent }) {
  const written = event.category !== "log";
  const tone = written
    ? CATEGORY_META[event.category]?.tone ?? "#a8967a"
    : KIND_TONE[event.kind] ?? "#a8967a";

  return (
    <div className="flex items-baseline gap-3">
      <span
        className="mt-1 h-2 w-2 flex-none translate-y-[1px] rounded-full"
        style={{ background: tone, boxShadow: `0 0 6px ${tone}66` }}
      />
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] leading-snug text-cream-soft">{event.message}</div>
        <div className="label-stamp mt-0.5 text-[8.5px] tracking-[1.5px] text-gold-muted">
          {written ? (
            <>
              <span style={{ color: tone }}>{CATEGORY_META[event.category]?.label}</span>
              {event.actorName ? ` · ${event.actorName}` : ""}
            </>
          ) : (
            KIND_LABEL[event.kind] ?? event.kind
          )}
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
  const [filter, setFilter] = useState("all");
  const { data: events, isLoading } = useEvents(campaign.id, filter, 200);
  const addNote = useAddNote(campaign.id);
  const [note, setNote] = useState("");
  // The DM's compose channel: a story note (dm) or a ruling (rules).
  const [channel, setChannel] = useState<"dm" | "rules">("dm");

  function post() {
    const message = note.trim();
    if (!message) return;
    addNote.mutate(
      { message, ...(isDM ? { category: channel } : {}) },
      { onSuccess: () => setNote("") },
    );
  }

  return (
    <div className="panel-hall px-5 pb-11 pt-8 sm:px-[30px]">
      <div
        className="mb-5 flex flex-wrap items-center justify-between gap-4 pb-3.5"
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

      {/* channel filter */}
      <div className="mb-5 flex flex-wrap gap-1.5">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`label-stamp rounded-[3px] px-3 py-1.5 text-[10px] font-semibold tracking-[1.5px] transition ${
              filter === key ? "text-hearth" : "text-gold-muted hover:text-ember-bright"
            }`}
            style={
              filter === key
                ? { background: "#e0a94e", boxShadow: "0 1px 3px rgba(0,0,0,.35)" }
                : { background: "rgba(201,162,39,.1)", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.25)" }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {/* compose — every member may write */}
      <div className="mb-7">
        {isDM && (
          <div className="mb-2 flex gap-1.5">
            {(["dm", "rules"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setChannel(c)}
                className={`label-stamp rounded-[3px] px-2.5 py-1 text-[9.5px] font-semibold tracking-[1px] transition ${
                  channel === c ? "text-ink" : "text-gold-muted hover:text-ember-bright"
                }`}
                style={
                  channel === c
                    ? { background: c === "rules" ? "#c96a5a" : "#d0a75a" }
                    : { background: "rgba(201,162,39,.1)", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.25)" }
                }
              >
                {c === "rules" ? "Ruling" : "Story note"}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") post();
            }}
            maxLength={500}
            placeholder={
              isDM
                ? channel === "rules"
                  ? "Record a ruling — a house rule or a call at the table…"
                  : "Write a story entry — the party will read it here…"
                : "Add to the chronicle — your party and DM will see it…"
            }
            className="input-hall min-w-0 flex-1"
          />
          <button
            onClick={post}
            disabled={!note.trim() || addNote.isPending}
            className="btn-base btn-gold clip-octagon h-10 px-5 text-[12px]"
          >
            {isDM ? "Chronicle it" : "Post"}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="font-accent px-5 py-[60px] text-center text-base italic text-[#9c855e]">
          Unrolling the chronicle…
        </div>
      ) : (events ?? []).length === 0 ? (
        <div className="font-accent px-5 py-[60px] text-center text-base italic text-[#9c855e]">
          {filter === "all"
            ? "The first page is still blank — deeds will write themselves here."
            : "Nothing in this channel yet."}
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
