import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useFocusTarget, useOneShotParam } from "../lib/focusTarget";
import type { ChronicleEvent, Handout } from "../api/client";
import {
  handoutImageUrl,
  useAddNote,
  useCharacters,
  useDeleteChronicleEntry,
  useEditChronicleEntry,
  useEvents,
  useHandouts,
} from "../hooks";
import { formatWhen } from "../lib/dates";
import type { CampaignContext } from "./CampaignView";
import HandoutForm from "./chronicle/HandoutForm";
import HandoutLightbox from "./chronicle/HandoutLightbox";
import HandoutManageModal from "./chronicle/HandoutManageModal";
import HandoutStrip from "./chronicle/HandoutStrip";
import GrowingTextarea from "./ui/GrowingTextarea";
import ParchmentModal from "./ui/ParchmentModal";

/** Channel → accent + label, for the written entries (dm/rules/player/rolls). */
const CATEGORY_META: Record<string, { label: string; tone: string }> = {
  dm: { label: "DM", tone: "#d0a75a" },
  rules: { label: "Ruling", tone: "#c96a5a" },
  player: { label: "Player", tone: "#6fa8c9" },
  rolls: { label: "Roll", tone: "#9d86c4" },
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
  codex_proposed: "house rules",
  codex_enabled: "house rules",
  codex_banned: "house rules",
  session_set: "the gathering",
  progression: "the table",
};

const FILTERS: Array<[string, string]> = [
  ["all", "All"],
  ["dm", "DM notes"],
  ["rules", "Rulings"],
  ["player", "Player chat"],
  ["rolls", "Rolls"],
  ["log", "Happenings"],
];

/**
 * One line of the ledger.
 *
 * A handout line carries its prop inline: the feed is where the party is
 * looking when the DM hands something over, and a line saying a letter arrived
 * without showing it is the wrong half of the moment. `onOpenHandout` is
 * optional because the dashboard's recent-events list has nowhere to put a
 * lightbox — there the thumbnail simply sits and looks like what it is.
 */
export function EventLine({
  event,
  onOpenHandout,
  campaignId,
}: {
  event: ChronicleEvent;
  onOpenHandout?: (handoutId: string) => void;
  /** Given, the line offers whatever the reader may do with it (#411). */
  campaignId?: string;
}) {
  const [editing, setEditing] = useState(false);
  const written = event.category !== "log";
  const tone = written
    ? CATEGORY_META[event.category]?.tone ?? "#a8967a"
    : KIND_TONE[event.kind] ?? "#a8967a";

  const thumb = event.handoutId ? (
    <img
      src={handoutImageUrl(event.handoutId)}
      alt=""
      loading="lazy"
      className="h-[74px] w-[110px] rounded-[3px] object-cover"
      style={{ boxShadow: "inset 0 0 0 1px rgba(201,162,39,.3)" }}
    />
  ) : null;

  return (
    <div className="flex items-baseline gap-3" data-focus-id={event.id}>
      <span
        className="mt-1 h-2 w-2 flex-none translate-y-[1px] rounded-full"
        style={{ background: tone, boxShadow: `0 0 6px ${tone}66` }}
      />
      <div className="min-w-0 flex-1">
        {editing && campaignId ? (
          <LineEditor campaignId={campaignId} event={event} onDone={() => setEditing(false)} />
        ) : (
          <div className="whitespace-pre-wrap break-words text-[13.5px] leading-snug text-cream-soft">
            {event.message}
          </div>
        )}
        {thumb &&
          (onOpenHandout ? (
            <button
              onClick={() => onOpenHandout(event.handoutId as string)}
              title="Look at it"
              className="mt-1.5 block cursor-pointer overflow-hidden rounded-[3px] border-none bg-transparent p-0 transition hover:brightness-110"
            >
              {thumb}
            </button>
          ) : (
            <div className="mt-1.5">{thumb}</div>
          ))}
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
          {event.editedAt && <span title={new Date(event.editedAt).toLocaleString()}> · edited</span>}
        </div>
      </div>
      {campaignId && !editing && (event.canEdit || event.canDelete) && (
        <LineActions campaignId={campaignId} event={event} onEdit={() => setEditing(true)} />
      )}
    </div>
  );
}

/** Rewording a line in place (#411). */
function LineEditor({
  campaignId,
  event,
  onDone,
}: {
  campaignId: string;
  event: ChronicleEvent;
  onDone: () => void;
}) {
  const edit = useEditChronicleEntry(campaignId);
  const [text, setText] = useState(event.message);
  const save = () => {
    const message = text.trim();
    if (!message || message === event.message) return onDone();
    edit.mutate({ eventId: event.id, message }, { onSuccess: onDone });
  };
  return (
    <div className="flex flex-col gap-1.5">
      <GrowingTextarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onSubmit={save}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onDone();
          }
        }}
        maxLength={2000}
        aria-label="Reword this line"
        className="input-hall w-full text-[13.5px]"
      />
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={!text.trim() || edit.isPending}
          className="btn-base btn-gold h-7 px-3 py-0 text-[10px] disabled:opacity-40"
        >
          {edit.isPending ? "Saving…" : "Save"}
        </button>
        <button onClick={onDone} className="btn-base btn-ghost-gold h-7 px-3 py-0 text-[10px]">
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * What the reader may do with a line (#411): a small ⋯ that opens Edit and
 * Delete where they are allowed — the server says which, per line.
 */
function LineActions({
  campaignId,
  event,
  onEdit,
}: {
  campaignId: string;
  event: ChronicleEvent;
  onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const strike = useDeleteChronicleEntry(campaignId);
  const handWritten = event.kind === "note" || event.kind === "ruling" || event.kind === "player_note";
  const linkClass =
    "label-stamp cursor-pointer border-none bg-transparent px-1 text-[9.5px] font-semibold tracking-[1px] text-gold-muted transition hover:text-ember-bright";
  return (
    <div className="flex flex-none items-center gap-1 self-start">
      {open && (
        <>
          {event.canEdit && (
            <button
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
              className={linkClass}
            >
              Edit
            </button>
          )}
          {event.canDelete && (
            <button onClick={() => setConfirming(true)} className={linkClass}>
              Delete
            </button>
          )}
        </>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Line actions"
        aria-expanded={open}
        className="cursor-pointer rounded-[3px] border-none bg-transparent px-1.5 text-[15px] leading-none text-gold-muted transition hover:text-ember-bright"
      >
        ⋯
      </button>
      {confirming && (
        <ParchmentModal onClose={() => setConfirming(false)}>
          <h3 className="font-display m-0 mb-2 text-center text-xl font-bold text-ink">Delete this line?</h3>
          <p className="font-body m-0 mb-1 text-center text-[14px] text-ink-body">
            It goes from the chronicle for everyone at the table.
          </p>
          {!handWritten && (
            <p className="font-accent m-0 mb-1 text-center text-[13.5px] italic text-ink-label">
              It undoes nothing it recorded — XP, rewards and handouts stay as they are.
            </p>
          )}
          <div className="mt-5 flex justify-center gap-2.5">
            <button
              onClick={() => strike.mutate(event.id, { onSuccess: () => setConfirming(false) })}
              disabled={strike.isPending}
              className="btn-base btn-ghost-red px-4 py-2 text-[11px]"
            >
              {strike.isPending ? "Deleting…" : "Delete"}
            </button>
            <button onClick={() => setConfirming(false)} className="btn-base btn-ghost-ink px-4 py-2 text-[11px]">
              Cancel
            </button>
          </div>
        </ParchmentModal>
      )}
    </div>
  );
}

export default function ChroniclePage() {
  const { campaign, role } = useOutletContext<CampaignContext>();
  const isDM = role === "dm";
  const [filter, setFilter] = useState("all");
  const { data: events, isLoading } = useEvents(campaign.id, filter, 200);
  const { data: handouts } = useHandouts(campaign.id);
  // The roster, for the DM's hero-by-hero reveal controls.
  const { data: characters } = useCharacters(campaign.id);
  const addNote = useAddNote(campaign.id);
  const [note, setNote] = useState("");
  // The DM's compose channel: a story note (dm) or a ruling (rules).
  const [channel, setChannel] = useState<"dm" | "rules">("dm");
  const [handing, setHanding] = useState(false);
  const [looking, setLooking] = useState<Handout | null>(null);
  const [managing, setManaging] = useState<Handout | null>(null);

  // The satchel is the source of truth for both surfaces, so a lightbox opened
  // from a feed thumbnail shows the same title and caption the strip does.
  const handoutById = (id: string) => (handouts ?? []).find((h) => h.id === id) ?? null;

  // A search result (#321) arrives as ?focus=<line> or ?handout=<id>.
  useFocusTarget(!!events);
  const [wantHandout, doneHandout] = useOneShotParam("handout");
  useEffect(() => {
    if (!wantHandout || !handouts) return;
    setLooking(handouts.find((h) => h.id === wantHandout) ?? null);
    doneHandout();
  }, [wantHandout, handouts, doneHandout]);

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
            Chronicle
          </h2>
          <div className="font-accent mt-1 text-[13px] italic text-cream-muted">
            Everything that happened at this table, newest first.
          </div>
        </div>
      </div>

      {/* the satchel — what the table has been handed, still findable */}
      <HandoutStrip
        handouts={handouts ?? []}
        isDM={isDM}
        characters={characters ?? []}
        onOpen={setLooking}
        onManage={setManaging}
        onAdd={() => setHanding(true)}
      />

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
        <div className="flex flex-wrap items-end gap-2">
          {/* A line break is Shift+Enter at a keyboard and Enter on a phone (#411). */}
          <GrowingTextarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onSubmit={post}
            maxLength={2000}
            aria-label="Write in the chronicle"
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
            <EventLine
              key={e.id}
              event={e}
              campaignId={campaign.id}
              onOpenHandout={(id) => setLooking(handoutById(id))}
            />
          ))}
        </div>
      )}

      {handing && <HandoutForm campaignId={campaign.id} onClose={() => setHanding(false)} />}
      {looking && <HandoutLightbox handout={looking} onClose={() => setLooking(null)} />}
      {managing && (
        <HandoutManageModal
          campaignId={campaign.id}
          // Re-read from the satchel so the modal shows the veil as it is now,
          // not as it was when the card was tapped.
          handout={handoutById(managing.id) ?? managing}
          characters={characters ?? []}
          onClose={() => setManaging(null)}
        />
      )}
    </div>
  );
}
