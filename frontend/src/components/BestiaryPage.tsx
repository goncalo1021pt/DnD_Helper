import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { BestiaryEntry, BestiarySection, RulesContent } from "../api/client";
import {
  useAddBestiaryNote,
  useBestiary,
  useCreateBestiaryEntry,
  useDeleteBestiaryEntry,
  useDeleteBestiaryNote,
  useRules,
  useUpdateBestiaryEntry,
} from "../hooks";
import type { CampaignContext } from "./CampaignView";
import { Blocks } from "./ui/SpellEntry";
import ParchmentModal from "./ui/ParchmentModal";
import {
  IconEye,
  IconEyeOff,
  IconPaw,
  IconPencil,
  IconPlus,
  IconTrash,
} from "./ui/icons";

/**
 * The Bestiary: the party's field journal. Any member logs a sighting and
 * scrawls notes on it; the DM later identifies the creature (linking a Den
 * monster) and unveils its official record one section at a time. Field notes
 * are the players' own — the record never overwrites them.
 */

const SECTIONS: Array<{ key: BestiarySection; label: string }> = [
  { key: "defenses", label: "Defenses & Movement" },
  { key: "traits", label: "Traits" },
  { key: "offense", label: "Actions" },
  { key: "lore", label: "Lore" },
];

export default function BestiaryPage() {
  const { campaign, role } = useOutletContext<CampaignContext>();
  const isDM = role === "dm";
  const { data: entries, isLoading } = useBestiary(campaign.id);
  const create = useCreateBestiaryEntry(campaign.id);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const [title, setTitle] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (entries ?? []).filter((e) => {
      if (!q) return true;
      return (
        e.title.toLowerCase().includes(q) ||
        (e.monsterName ?? "").toLowerCase().includes(q)
      );
    });
  }, [entries, search]);

  const open = entries?.find((e) => e.id === openId) ?? null;

  function submitNew() {
    const t = title.trim();
    if (!t) return;
    create.mutate(t, {
      onSuccess: () => {
        setTitle("");
        setLogging(false);
      },
    });
  }

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
            The Bestiary
          </h2>
          <div className="font-accent mt-1 text-[13px] italic text-cream-muted">
            {isDM
              ? "Your party's field journal — identify what they've met and reveal it, piece by piece."
              : "Every creature you've faced — what you've puzzled out, and what the DM has confirmed."}
          </div>
        </div>
        <button
          onClick={() => setLogging(true)}
          className="btn-base btn-gold clip-octagon h-10 whitespace-nowrap px-5 text-[13px]"
        >
          <IconPlus size={15} strokeWidth={2} />
          Log a sighting
        </button>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search your journal…"
        className="input-hall mb-6 w-full sm:max-w-[320px]"
      />

      {isLoading ? (
        <div className="font-accent px-5 py-[60px] text-center text-base italic text-[#9c855e]">
          Leafing through the journal…
        </div>
      ) : filtered.length === 0 ? (
        <div className="font-accent px-5 py-[60px] text-center text-base italic text-[#9c855e]">
          {entries && entries.length > 0
            ? "No sighting by that name."
            : "The journal is empty. Log the first creature your party meets."}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(240px,100%),1fr))] gap-3">
          {filtered.map((e) => (
            <EntryCard key={e.id} entry={e} onOpen={() => setOpenId(e.id)} />
          ))}
        </div>
      )}

      {logging && (
        <ParchmentModal onClose={() => setLogging(false)} maxWidth="max-w-[440px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            The Bestiary
          </div>
          <h3 className="font-display m-0 mb-5 text-center text-2xl font-bold text-ink">
            Log a sighting
          </h3>
          <label className="label-stamp mb-1.5 block text-[10px] tracking-[1.5px] text-ink-label">
            What did you call it?
          </label>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitNew()}
            placeholder="The slime in the sewers…"
            maxLength={120}
            className="input-parchment mb-5 w-full"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setLogging(false)}
              className="btn-base btn-ghost-ink h-9 px-4 text-[12px]"
            >
              Cancel
            </button>
            <button
              onClick={submitNew}
              disabled={!title.trim() || create.isPending}
              className="btn-base btn-gold clip-octagon h-9 px-5 text-[12px]"
            >
              Add to journal
            </button>
          </div>
        </ParchmentModal>
      )}

      {open && (
        <ParchmentModal onClose={() => setOpenId(null)} maxWidth="max-w-[640px]">
          <EntryDetail entry={open} campaignId={campaign.id} isDM={isDM} />
        </ParchmentModal>
      )}
    </div>
  );
}

/* A single sighting tile. */
function EntryCard({ entry, onOpen }: { entry: BestiaryEntry; onOpen: () => void }) {
  const revealed = entry.revealed.length;
  return (
    <button
      onClick={onOpen}
      className="parchment cursor-pointer px-4 pb-3 pt-3 text-left transition hover:-translate-y-0.5"
    >
      <div className="mb-1 flex items-start gap-2">
        <span className="mt-0.5 text-ink-faded">
          <IconPaw size={16} />
        </span>
        <div className="min-w-0">
          <div className="font-display truncate text-[14.5px] font-bold leading-tight text-ink">
            {entry.title}
          </div>
          {entry.identified && entry.monsterName && (
            <div className="label-stamp mt-0.5 text-[8.5px] tracking-[1px] text-ember">
              {entry.monsterName}
            </div>
          )}
        </div>
      </div>
      <div className="label-stamp mt-1.5 flex flex-wrap gap-x-3 text-[8.5px] tracking-[1px] text-ink-label">
        <span>
          {entry.notes.length} {entry.notes.length === 1 ? "note" : "notes"}
        </span>
        {entry.identified ? (
          <span>{revealed}/4 unveiled</span>
        ) : (
          <span className="italic">unidentified</span>
        )}
      </div>
    </button>
  );
}

/* The expanded record: identity, the official stat block (gated), field notes. */
function EntryDetail({
  entry,
  campaignId,
  isDM,
}: {
  entry: BestiaryEntry;
  campaignId: string;
  isDM: boolean;
}) {
  const update = useUpdateBestiaryEntry(campaignId);
  const del = useDeleteBestiaryEntry(campaignId);
  const addNote = useAddBestiaryNote(campaignId);
  const delNote = useDeleteBestiaryNote(campaignId);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(entry.title);
  const [noteDraft, setNoteDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const revealedSet = new Set(entry.revealed);
  const shownSections = SECTIONS.filter((s) => entry.record[s.key] !== undefined);

  function saveTitle() {
    const t = titleDraft.trim();
    if (!t || t === entry.title) {
      setEditingTitle(false);
      setTitleDraft(entry.title);
      return;
    }
    update.mutate({ entryId: entry.id, title: t }, { onSuccess: () => setEditingTitle(false) });
  }

  function toggleSection(key: BestiarySection) {
    const next = revealedSet.has(key)
      ? entry.revealed.filter((r) => r !== key)
      : [...entry.revealed, key];
    update.mutate({ entryId: entry.id, revealed: next });
  }

  function submitNote() {
    const b = noteDraft.trim();
    if (!b) return;
    addNote.mutate({ entryId: entry.id, body: b }, { onSuccess: () => setNoteDraft("") });
  }

  return (
    <div>
      {/* header */}
      <div className="label-stamp mb-1 text-[10px] tracking-[3px] text-ink-label">
        Field journal
      </div>
      {editingTitle ? (
        <div className="mb-2 flex items-center gap-2">
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveTitle()}
            maxLength={120}
            className="input-parchment flex-1"
          />
          <button onClick={saveTitle} className="btn-base btn-gold clip-octagon h-8 px-3 text-[11px]">
            Save
          </button>
        </div>
      ) : (
        <h3 className="font-display m-0 mb-1 flex items-center gap-2 text-2xl font-bold text-ink">
          {entry.title}
          {entry.canEdit && (
            <button
              onClick={() => {
                setTitleDraft(entry.title);
                setEditingTitle(true);
              }}
              title="Rename"
              className="cursor-pointer border-none bg-transparent p-1 text-ink-faded hover:text-ink"
            >
              <IconPencil size={14} />
            </button>
          )}
        </h3>
      )}
      {entry.identified && entry.monsterName && (
        <div className="label-stamp mb-4 text-[11px] tracking-[1.5px] text-ember">
          Identified · {entry.monsterName}
        </div>
      )}

      {/* DM: identify control */}
      {isDM && <IdentifyControl entry={entry} campaignId={campaignId} />}

      {/* the official record */}
      <div className="mt-4">
        <div className="label-stamp mb-2 text-[10px] tracking-[3px] text-ink-label">
          The record
        </div>
        {!entry.identified ? (
          <p className="font-accent text-[13px] italic text-ink-faded">
            {isDM
              ? "Link this sighting to a creature in the Den to reveal its stat block."
              : "This creature is still a mystery — no official record yet."}
          </p>
        ) : shownSections.length === 0 ? (
          <p className="font-accent text-[13px] italic text-ink-faded">
            The DM has confirmed what it is, but shared none of its secrets yet.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {shownSections.map((s) => {
              const isRevealed = revealedSet.has(s.key);
              return (
                <div
                  key={s.key}
                  className={`rounded-[4px] px-3 py-2 ${
                    isDM && !isRevealed ? "opacity-60" : ""
                  }`}
                  style={{
                    background: "rgba(120,85,40,.06)",
                    boxShadow: "inset 0 0 0 1px rgba(150,110,60,.18)",
                  }}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="label-stamp text-[10px] tracking-[2px] text-ink-label">
                      {s.label}
                    </div>
                    {isDM && (
                      <button
                        onClick={() => toggleSection(s.key)}
                        disabled={update.isPending}
                        title={isRevealed ? "Hide from players" : "Reveal to players"}
                        className={`inline-flex cursor-pointer items-center gap-1 rounded-[3px] border-none px-2 py-1 text-[10px] font-semibold tracking-[.5px] ${
                          isRevealed
                            ? "bg-[rgba(120,150,80,.22)] text-[#5f7a33]"
                            : "bg-[rgba(120,85,40,.14)] text-ink-faded"
                        }`}
                      >
                        {isRevealed ? <IconEye size={12} /> : <IconEyeOff size={12} />}
                        {isRevealed ? "Revealed" : "Hidden"}
                      </button>
                    )}
                  </div>
                  <div className="text-ink">
                    <Blocks text={entry.record[s.key]} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* field notes */}
      <div className="mt-5">
        <div className="label-stamp mb-2 text-[10px] tracking-[3px] text-ink-label">
          Field notes
        </div>
        {entry.notes.length === 0 ? (
          <p className="font-accent mb-2 text-[13px] italic text-ink-faded">
            No observations yet.
          </p>
        ) : (
          <div className="mb-3 flex flex-col gap-2">
            {entry.notes.map((n) => (
              <div
                key={n.id}
                className="flex items-start justify-between gap-2 rounded-[4px] px-3 py-2"
                style={{ background: "rgba(120,85,40,.06)" }}
              >
                <div className="min-w-0">
                  <div className="whitespace-pre-wrap break-words text-[13px] leading-snug text-ink">
                    {n.body}
                  </div>
                  <div className="label-stamp mt-1 text-[8.5px] tracking-[1px] text-ink-label">
                    {n.authorName ?? "Unknown hand"}
                    {n.mine && " · you"}
                  </div>
                </div>
                {(n.mine || isDM) && (
                  <button
                    onClick={() => delNote.mutate({ entryId: entry.id, noteId: n.id })}
                    title="Erase note"
                    className="flex-none cursor-pointer border-none bg-transparent p-1 text-ink-faded hover:text-[#8b2520]"
                  >
                    <IconTrash size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <textarea
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          placeholder="Add an observation…"
          rows={2}
          maxLength={2000}
          className="input-parchment mb-2 w-full resize-none"
        />
        <div className="flex justify-end">
          <button
            onClick={submitNote}
            disabled={!noteDraft.trim() || addNote.isPending}
            className="btn-base btn-gold clip-octagon h-9 px-4 text-[12px]"
          >
            Pen the note
          </button>
        </div>
      </div>

      {/* delete */}
      {entry.canEdit && (
        <div
          className="mt-5 flex items-center justify-between gap-3 pt-3"
          style={{ borderTop: "1px solid rgba(150,110,60,.2)" }}
        >
          {confirmDelete ? (
            <>
              <span className="font-accent text-[12px] italic text-ink-faded">
                Tear this page out for good?
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="btn-base btn-ghost-ink h-8 px-3 text-[11px]"
                >
                  Keep
                </button>
                <button
                  onClick={() => del.mutate(entry.id)}
                  disabled={del.isPending}
                  className="btn-base btn-ghost-red h-8 px-3 text-[11px]"
                >
                  Delete
                </button>
              </div>
            </>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="inline-flex cursor-pointer items-center gap-1.5 border-none bg-transparent text-[11px] font-semibold tracking-[.5px] text-ink-faded hover:text-[#8b2520]"
            >
              <IconTrash size={13} />
              Remove sighting
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* DM-only: search the Den and link (or unlink) the creature behind a sighting. */
function IdentifyControl({
  entry,
  campaignId,
}: {
  entry: BestiaryEntry;
  campaignId: string;
}) {
  const update = useUpdateBestiaryEntry(campaignId);
  const { data: monsters } = useRules("monster", true);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return (monsters ?? [])
      .filter((m: RulesContent) => m.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [monsters, query]);

  function link(id: string) {
    update.mutate(
      { entryId: entry.id, contentId: id },
      {
        onSuccess: () => {
          setPicking(false);
          setQuery("");
        },
      },
    );
  }

  function unlink() {
    update.mutate({ entryId: entry.id, contentId: "00000000-0000-0000-0000-000000000000" });
  }

  return (
    <div
      className="rounded-[4px] px-3 py-2.5"
      style={{ background: "rgba(201,162,39,.07)", boxShadow: "inset 0 0 0 1px rgba(201,162,39,.22)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="label-stamp text-[10px] tracking-[2px] text-ink-label">
          {entry.identified ? "Identified as" : "Identify the creature"}
        </div>
        <div className="flex items-center gap-2">
          {entry.identified && (
            <button
              onClick={unlink}
              disabled={update.isPending}
              className="cursor-pointer border-none bg-transparent text-[11px] font-semibold text-ink-faded hover:text-[#8b2520]"
            >
              Unlink
            </button>
          )}
          <button
            onClick={() => setPicking((p) => !p)}
            className="btn-base btn-ghost-ink h-7 px-3 text-[11px]"
          >
            {entry.identified ? "Re-link" : "Link a monster"}
          </button>
        </div>
      </div>
      {entry.identified && entry.monsterName && !picking && (
        <div className="font-display mt-1 text-[15px] font-bold text-ink">
          {entry.monsterName}
        </div>
      )}
      {picking && (
        <div className="mt-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the Den…"
            className="input-parchment w-full"
          />
          {results.length > 0 && (
            <div className="mt-1.5 flex flex-col gap-1">
              {results.map((m: RulesContent) => (
                <button
                  key={m.id}
                  onClick={() => link(m.id)}
                  className="flex items-center justify-between gap-2 rounded-[3px] px-2 py-1.5 text-left text-[12.5px] text-ink transition hover:bg-[rgba(150,110,60,.14)]"
                >
                  <span className="font-semibold">{m.name}</span>
                  <span className="label-stamp text-[8.5px] tracking-[1px] text-ink-label">
                    {(m.data as { cr?: string }).cr?.split(" ")[0]
                      ? `CR ${(m.data as { cr?: string }).cr?.split(" ")[0]}`
                      : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
