import { useState } from "react";
import { Link } from "react-router-dom";
import type { Character, Location, SetVisibilityInput } from "../api/client";
import {
  useClearLocationOverride,
  useCreateLocation,
  useDeleteLocation,
  useMoveLocation,
  useSetLocationVisibility,
  useUpdateLocation,
} from "../hooks";
import VisibilityControl from "./VisibilityControl";
import { IconEye, IconEyeOff, IconMapPin, IconPencil, IconPlus, IconTrash } from "./ui/icons";

/* Places may nest ten deep; the backend rejects anything past that. */
const MAX_DEPTH = 10;

/* Nesting, as pixels. Capped at eight levels: the tree may go the full ten
   deep, and a tenth-level indent would push the row off a laptop rather than
   describe it. */
export function indentOf(depth: number): string {
  return `${Math.min(depth, 8) * 22}px`;
}

/* What hangs in a place, and where to go and see it. The counts are the whole
   reason places stopped being a quest-board modal: a place is the join between
   the board and the encounter library, so it should say so and link there. */
export function PlaceLinks({
  campaignId,
  place,
  battles = 0,
}: {
  campaignId: string;
  place: Location;
  /* Encounters prepared here. Omitted for players, who have no library. */
  battles?: number;
}) {
  const base = `/questboard/campaigns/${campaignId}`;
  const tone =
    "label-stamp text-[9.5px] text-ink-label no-underline transition hover:text-[#8a5e2c]";
  // An empty place says so in plain text: a link to a board with nothing on it
  // is a promise the click cannot keep.
  return (
    <span className="flex flex-wrap items-center gap-2">
      {place.questCount > 0 ? (
        <Link
          to={`${base}/board?place=${place.id}`}
          title={`Open the board filtered to ${place.name}`}
          className={tone}
        >
          {place.questCount} notice{place.questCount === 1 ? "" : "s"}
        </Link>
      ) : (
        <span className="label-stamp text-[9.5px] text-ink-faded">no notices</span>
      )}
      {battles > 0 && (
        <Link
          to={`${base}/encounters?place=${place.id}`}
          title={`Open the encounters prepared for ${place.name}`}
          className={tone}
        >
          · {battles} battle{battles === 1 ? "" : "s"}
        </Link>
      )}
    </span>
  );
}

/* The DM's map room: chart regions and cities, nest them, and decide who is
   allowed to know each one exists. Veiling a place veils everything inside it. */
export default function PlacesManager({
  campaignId,
  locations,
  characters,
  battles,
}: {
  campaignId: string;
  locations: Location[];
  characters: Character[];
  /* Encounters prepared per place, keyed by location id. DM-only data, so the
     page passes it in rather than this component asking for it. */
  battles: Record<string, number>;
}) {
  const create = useCreateLocation(campaignId);
  const update = useUpdateLocation(campaignId);
  const move = useMoveLocation(campaignId);
  const remove = useDeleteLocation(campaignId);
  const setVisibility = useSetLocationVisibility(campaignId);
  const clearOverride = useClearLocationOverride(campaignId);

  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", description: "", parentId: "" });

  const pending =
    create.isPending ||
    update.isPending ||
    move.isPending ||
    remove.isPending ||
    setVisibility.isPending;

  // Parents already at the depth limit cannot take children.
  const parentOptions = locations.filter((l) => l.depth < MAX_DEPTH - 1);

  function addPlace(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    // A new place starts veiled — the DM charts the map before the party sees it.
    create.mutate(
      { name, parentId: newParent || null, visibleToParty: false },
      { onSuccess: () => setNewName("") },
    );
  }

  function openEditor(l: Location) {
    setEditingId(l.id);
    setDraft({ name: l.name, description: l.description, parentId: l.parentId ?? "" });
  }

  /* Two calls, because the server keeps text and tree apart on purpose. The
     move rides on the rename's success rather than in parallel: if the move is
     refused (a cycle, or a subtree too deep for its new home) the panel stays
     open with the reason, and the text edit that *was* legal is already saved. */
  function saveEdit(l: Location) {
    const name = draft.name.trim();
    if (!name) return;
    const nextParent = draft.parentId || null;
    const moved = nextParent !== (l.parentId ?? null);
    update.mutate(
      { locationId: l.id, body: { name, description: draft.description } },
      {
        onSuccess: () => {
          if (!moved) {
            setEditingId(null);
            return;
          }
          move.mutate(
            { locationId: l.id, parentId: nextParent },
            { onSuccess: () => setEditingId(null) },
          );
        },
      },
    );
  }

  function changeVisibility(l: Location, body: SetVisibilityInput) {
    setVisibility.mutate({ locationId: l.id, body });
  }

  const errorText =
    (create.error as { error?: string } | null)?.error ??
    (update.error as { error?: string } | null)?.error ??
    (move.error as { error?: string } | null)?.error;

  return (
    <div className="flex flex-col gap-4 text-ink-strong">
      <div className="label-stamp text-center text-[11px] tracking-[4px] text-ink-label">
        The Cartographer's Table
      </div>
      <p className="font-body m-0 text-center text-[13px] italic text-ink-faded">
        Nest a city inside a realm — or move one that was charted in the wrong
        place. Veil a place and every notice hanging in it goes dark, for the
        whole party or for one hero.
      </p>

      <form onSubmit={addPlace} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="field-label">Chart a new place</span>
          <input
            className="input-parchment input-compact"
            placeholder="e.g. Lisboa"
            value={newName}
            maxLength={200}
            onChange={(e) => setNewName(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Inside</span>
          <select
            className="input-parchment input-compact cursor-pointer"
            value={newParent}
            onChange={(e) => setNewParent(e.target.value)}
          >
            <option value="">— nowhere, a realm of its own —</option>
            {parentOptions.map((l) => (
              <option key={l.id} value={l.id}>
                {"— ".repeat(l.depth)}
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={pending || !newName.trim()}
          className="btn-base btn-wax clip-octagon px-4 py-[9px] text-xs"
        >
          <IconPlus size={13} strokeWidth={2} />
          Chart it
        </button>
      </form>

      {errorText && (
        <p className="font-body m-0 text-sm italic text-[#8b2520]">{errorText}</p>
      )}

      <div className="torn-divider" />

      {locations.length === 0 ? (
        <p className="font-accent m-0 py-6 text-center text-base italic text-ink-faded">
          — no places charted yet —
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {locations.map((l) => {
            const revealed = l.visibleToParty ?? false;
            const dark = l.hiddenByAncestor ?? false;
            const overrides = l.visibility ?? [];
            const editing = editingId === l.id;
            return (
              <div
                key={l.id}
                className="rounded-[2px] border border-[rgba(124,90,46,.3)] px-3 py-2"
                style={{
                  marginLeft: indentOf(l.depth),
                  background: "rgba(124,90,46,.06)",
                  // Same cue as the gazetteer: the indent says how far, the
                  // rule says "this hangs off something above it".
                  borderLeft: l.depth > 0 ? "3px solid rgba(138,94,44,.5)" : undefined,
                }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[#8a5e2c]">
                    <IconMapPin size={14} />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-heading text-[14px] font-semibold text-ink">
                      {l.name}
                    </span>
                    {l.description && (
                      <span className="font-body block truncate text-[12px] italic text-ink-faded">
                        {l.description}
                      </span>
                    )}
                  </span>

                  <PlaceLinks campaignId={campaignId} place={l} battles={battles[l.id] ?? 0} />

                  {dark && (
                    <span
                      className="label-stamp rounded-[2px] px-2 py-[3px] text-[9px] text-[#f6ead0]"
                      style={{ background: "rgba(110,31,28,.75)" }}
                      title="A place above this one is veiled, so this stays dark whatever it is set to"
                    >
                      Dark by parent
                    </span>
                  )}

                  <button
                    type="button"
                    disabled={pending}
                    aria-pressed={revealed}
                    title={revealed ? "Veil from the whole party" : "Reveal to the whole party"}
                    onClick={() => changeVisibility(l, { scope: "party", visible: !revealed })}
                    className={`btn-base p-[7px] ${revealed ? "btn-wax" : "btn-ghost-ink"}`}
                  >
                    {revealed ? <IconEye size={14} /> : <IconEyeOff size={14} />}
                  </button>
                  <button
                    type="button"
                    aria-pressed={editing}
                    title={`Edit ${l.name}`}
                    onClick={() => (editing ? setEditingId(null) : openEditor(l))}
                    className={`btn-base p-[7px] ${
                      editing || overrides.length > 0 ? "btn-wax" : "btn-ghost-ink"
                    }`}
                  >
                    <IconPencil size={14} strokeWidth={1.8} />
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    title="Erase this place and everything inside it"
                    onClick={() => {
                      if (
                        confirm(
                          `Erase "${l.name}"? Places nested inside it go too; notices and folk hanging there are unpinned, not deleted — each keeps exactly the audience it has today.`,
                        )
                      ) {
                        remove.mutate(l.id);
                      }
                    }}
                    className="btn-base btn-ghost-red p-[7px]"
                  >
                    <IconTrash size={14} strokeWidth={1.8} />
                  </button>
                </div>

                {editing && (
                  <div className="mt-2.5 flex flex-col gap-3 border-t border-[rgba(124,90,46,.25)] pt-2.5">
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="flex min-w-[180px] flex-1 flex-col gap-1.5">
                        <span className="field-label">Name</span>
                        <input
                          autoFocus
                          className="input-parchment input-compact"
                          value={draft.name}
                          maxLength={200}
                          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEdit(l);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                        />
                      </label>
                      {/* The reparenting the tree always supported and nothing
                          ever surfaced: it used to hide behind the per-hero
                          veil toggle, which is not where anyone looks to move
                          a city into the country it belongs to. */}
                      <label className="flex min-w-[180px] flex-1 flex-col gap-1.5">
                        <span className="field-label">Move inside</span>
                        <select
                          className="input-parchment input-compact cursor-pointer"
                          value={draft.parentId}
                          onChange={(e) => setDraft({ ...draft, parentId: e.target.value })}
                        >
                          <option value="">— nowhere, a realm of its own —</option>
                          {parentOptions
                            .filter((p) => p.id !== l.id)
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {"— ".repeat(p.depth)}
                                {p.name}
                              </option>
                            ))}
                        </select>
                      </label>
                    </div>
                    <label className="flex flex-col gap-1.5">
                      <span className="field-label">What is known of it</span>
                      <textarea
                        className="input-parchment input-compact min-h-[62px] resize-y"
                        placeholder="A port city of black sand and worse manners…"
                        value={draft.description}
                        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                      />
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={pending || !draft.name.trim()}
                        onClick={() => saveEdit(l)}
                        className="btn-base btn-wax clip-octagon px-4 py-[9px] text-xs"
                      >
                        Save the chart
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="btn-base btn-ghost-ink px-4 py-[9px] text-xs"
                      >
                        Cancel
                      </button>
                    </div>

                    <div className="torn-divider" />

                    <VisibilityControl
                      visibleToParty={revealed}
                      overrides={overrides}
                      characters={characters}
                      isPending={pending}
                      onChange={(body) => changeVisibility(l, body)}
                      onClearHero={(characterId) =>
                        clearOverride.mutate({ locationId: l.id, characterId })
                      }
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
