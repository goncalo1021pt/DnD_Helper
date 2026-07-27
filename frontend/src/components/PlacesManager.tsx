import { useState } from "react";
import type { Character, Location, SetVisibilityInput } from "../api/client";
import {
  useClearLocationOverride,
  useCreateLocation,
  useDeleteLocation,
  useSetLocationVisibility,
  useUpdateLocation,
} from "../hooks";
import VisibilityControl from "./VisibilityControl";
import { IconEye, IconEyeOff, IconMapPin, IconPencil, IconPlus, IconTrash, IconX } from "./ui/icons";

/* Places may nest ten deep; the backend rejects anything past that. */
const MAX_DEPTH = 10;

/* The DM's map room: chart regions and cities, nest them, and decide who is
   allowed to know each one exists. Veiling a place veils everything inside it. */
export default function PlacesManager({
  campaignId,
  locations,
  characters,
  onClose,
}: {
  campaignId: string;
  locations: Location[];
  characters: Character[];
  onClose: () => void;
}) {
  const create = useCreateLocation(campaignId);
  const update = useUpdateLocation(campaignId);
  const remove = useDeleteLocation(campaignId);
  const setVisibility = useSetLocationVisibility(campaignId);
  const clearOverride = useClearLocationOverride(campaignId);

  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const pending =
    create.isPending || update.isPending || remove.isPending || setVisibility.isPending;

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

  function rename(l: Location) {
    const name = editName.trim();
    if (!name) return;
    update.mutate(
      { locationId: l.id, body: { name, description: l.description, parentId: l.parentId ?? null } },
      { onSuccess: () => setEditingId(null) },
    );
  }

  function move(l: Location, parentId: string) {
    update.mutate({
      locationId: l.id,
      body: { name: l.name, description: l.description, parentId: parentId || null },
    });
  }

  function changeVisibility(l: Location, body: SetVisibilityInput) {
    setVisibility.mutate({ locationId: l.id, body });
  }

  const errorText =
    (create.error as { error?: string } | null)?.error ??
    (update.error as { error?: string } | null)?.error;

  return (
    <div className="flex flex-col gap-4 text-ink-strong">
      <div className="label-stamp text-center text-[11px] tracking-[4px] text-ink-label">
        The Cartographer's Table
      </div>
      <h3 className="font-display m-0 text-center text-2xl font-bold text-ink">
        Places &amp; Their Veils
      </h3>
      <p className="font-body m-0 text-center text-[13px] italic text-ink-faded">
        Nest a city inside a realm. Veil a place and every notice hanging in it
        goes dark — for the whole party, or for one hero.
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
            return (
              <div
                key={l.id}
                className="rounded-[2px] border border-[rgba(124,90,46,.3)] px-3 py-2"
                style={{ marginLeft: `${l.depth * 18}px`, background: "rgba(124,90,46,.06)" }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[#8a5e2c]">
                    <IconMapPin size={14} />
                  </span>

                  {editingId === l.id ? (
                    <input
                      autoFocus
                      className="input-parchment input-compact flex-1"
                      value={editName}
                      maxLength={200}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") rename(l);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      onBlur={() => rename(l)}
                    />
                  ) : (
                    <span className="flex-1 font-heading text-[14px] font-semibold text-ink">
                      {l.name}
                    </span>
                  )}

                  <span className="label-stamp text-[9.5px] text-ink-label">
                    {l.questCount} notice{l.questCount === 1 ? "" : "s"}
                  </span>

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
                    title={revealed ? "Veil from the whole party" : "Reveal to the whole party"}
                    onClick={() => changeVisibility(l, { scope: "party", visible: !revealed })}
                    className={`btn-base p-[7px] ${revealed ? "btn-wax" : "btn-ghost-ink"}`}
                  >
                    {revealed ? <IconEye size={14} /> : <IconEyeOff size={14} />}
                  </button>
                  <button
                    type="button"
                    title="Rename"
                    onClick={() => {
                      setEditingId(l.id);
                      setEditName(l.name);
                    }}
                    className="btn-base btn-ghost-ink p-[7px]"
                  >
                    <IconPencil size={14} strokeWidth={1.8} />
                  </button>
                  <button
                    type="button"
                    title="Reveal hero by hero"
                    onClick={() => setExpandedId(expandedId === l.id ? null : l.id)}
                    className={`btn-base p-[7px] ${
                      expandedId === l.id || overrides.length > 0 ? "btn-wax" : "btn-ghost-ink"
                    }`}
                  >
                    <IconEye size={14} strokeWidth={1.8} />
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    title="Erase this place and everything inside it"
                    onClick={() => {
                      if (
                        confirm(
                          `Erase "${l.name}"? Places nested inside it go too; notices hanging there are unpinned, not deleted.`,
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

                {expandedId === l.id && (
                  <div className="mt-2.5 flex flex-col gap-3 border-t border-[rgba(124,90,46,.25)] pt-2.5">
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
                    <label className="flex flex-col gap-1.5">
                      <span className="field-label">Move inside</span>
                      <select
                        className="input-parchment input-compact cursor-pointer"
                        value={l.parentId ?? ""}
                        onChange={(e) => move(l, e.target.value)}
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
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="torn-divider" />

      <button
        type="button"
        onClick={onClose}
        className="btn-base btn-ghost-ink self-start px-5 py-[11px] text-xs"
      >
        <IconX size={14} strokeWidth={2} />
        Close the map
      </button>
    </div>
  );
}
