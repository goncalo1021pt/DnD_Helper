import { useState } from "react";
import type { MapLayer, MapLayerInput } from "../../api/client";
import { IconEye, IconEyeOff, IconPencil, IconPlus, IconTrash } from "../ui/icons";

/*
The DM's layers on one map (#355), managed from the Inkwork.

Listed top to bottom, the way a stack of sheets is read and the Legend reads
it; the arrows move one sheet past its neighbour, and the server is handed the
whole order bottom to top (an order that leaves a layer out is refused, so a
reorder can never lose one).

Two switches per layer, and they are different questions: *Starts shown /
Starts hidden* is how a viewer first sees it — a suggestion a player may
overrule in their Legend — while *DM only* is the one real gate, keeping the
layer and everything filed in it out of a player's payload.

Striking a layer loses no ink: what was filed in it drops to the base map. The
confirmation counts what will move, so the DM knows before they press.
*/

type Patch = Omit<MapLayerInput, "name"> & { name?: string };

export function LayerList({
  layers,
  countIn,
  isPending,
  onCreate,
  onUpdate,
  onReorder,
  onDelete,
}: {
  /** Bottom to top, as the payload carries them. */
  layers: MapLayer[];
  /** What is filed in a layer, for the strike's confirmation. */
  countIn: (id: string) => { pins: number; shapes: number };
  isPending: boolean;
  onCreate: (body: MapLayerInput) => void;
  onUpdate: (layerId: string, body: MapLayerInput) => void;
  /** The new order, bottom to top. */
  onReorder: (layerIds: string[]) => void;
  onDelete: (layerId: string) => void;
}) {
  const [adding, setAdding] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [striking, setStriking] = useState("");
  const topDown = [...layers].reverse();

  const patch = (l: MapLayer, p: Patch) =>
    onUpdate(l.id, {
      name: p.name ?? l.name,
      shownByDefault: p.shownByDefault ?? l.shownByDefault,
      dmOnly: p.dmOnly ?? l.dmOnly,
    });

  // Up the list is up the stack: a higher position, painted above.
  const move = (l: MapLayer, up: boolean) => {
    const ids = layers.map((x) => x.id);
    const i = ids.indexOf(l.id);
    const j = up ? i + 1 : i - 1;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    onReorder(ids);
  };

  const create = () => {
    const name = adding.trim();
    if (!name) return;
    onCreate({ name, shownByDefault: true, dmOnly: false });
    setAdding("");
  };

  const tally = (id: string) => {
    const { pins, shapes } = countIn(id);
    const parts = [
      pins ? `${pins} ${pins === 1 ? "pin" : "pins"}` : "",
      shapes ? `${shapes} ${shapes === 1 ? "shape" : "shapes"}` : "",
    ].filter(Boolean);
    if (parts.length === 0) return "Nothing is filed in it.";
    return `${parts.join(" and ")} ${pins + shapes === 1 ? "drops" : "drop"} to the base map.`;
  };

  return (
    <div data-testid="layer-list" className="mb-5">
      <div className="field-label mb-1.5">Layers</div>
      {topDown.length === 0 && (
        <p className="font-body m-0 mb-2 text-[12.5px] italic text-ink-body">
          Everything drawn sits on the base map. A layer gathers ink the table can
          switch off — borders, trade routes, the old empire.
        </p>
      )}
      {topDown.map((l, k) => (
        <div
          key={l.id}
          data-layer-row={l.name}
          className="border-0 border-b border-solid py-2"
          style={{ borderColor: "rgba(74,55,28,.14)" }}
        >
          <div className="flex items-center gap-1.5">
            <span className="flex flex-none flex-col">
              <button
                onClick={() => move(l, true)}
                disabled={k === 0 || isPending}
                aria-label={`Raise ${l.name}`}
                title="Draw it above the one over it"
                className="cursor-pointer border-none bg-transparent px-1 text-[10px] leading-none text-ink-label transition hover:text-ink disabled:cursor-default disabled:opacity-25"
              >
                ▲
              </button>
              <button
                onClick={() => move(l, false)}
                disabled={k === topDown.length - 1 || isPending}
                aria-label={`Lower ${l.name}`}
                title="Draw it beneath the one under it"
                className="cursor-pointer border-none bg-transparent px-1 text-[10px] leading-none text-ink-label transition hover:text-ink disabled:cursor-default disabled:opacity-25"
              >
                ▼
              </button>
            </span>

            {renaming?.id === l.id ? (
              <form
                className="flex min-w-0 flex-1 items-center gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (renaming.name.trim()) patch(l, { name: renaming.name.trim() });
                  setRenaming(null);
                }}
              >
                <input
                  autoFocus
                  value={renaming.name}
                  maxLength={60}
                  onChange={(e) => setRenaming({ id: l.id, name: e.target.value })}
                  onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
                  aria-label="Layer name"
                  className="input-parchment input-compact min-w-0 flex-1"
                />
                <button type="submit" className="btn-base btn-ghost-ink px-2 py-1 text-[10px]">
                  Keep
                </button>
              </form>
            ) : (
              <span className="font-heading min-w-0 flex-1 truncate text-[14px] text-ink">{l.name}</span>
            )}

            {renaming?.id !== l.id && (
              <span className="flex flex-none items-center gap-1">
                <button
                  onClick={() => setRenaming({ id: l.id, name: l.name })}
                  aria-label={`Rename ${l.name}`}
                  title="Rename it"
                  className="btn-base btn-ghost-ink h-7 px-2 py-0 text-[11px]"
                >
                  <IconPencil size={12} strokeWidth={1.8} />
                </button>
                <button
                  onClick={() => setStriking(striking === l.id ? "" : l.id)}
                  aria-label={`Strike ${l.name}`}
                  title="Strike the layer — its ink stays, on the base map"
                  className="btn-base btn-ghost-red h-7 px-2 py-0 text-[11px]"
                >
                  <IconTrash size={12} strokeWidth={1.8} />
                </button>
              </span>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-6">
            <button
              onClick={() => patch(l, { shownByDefault: !l.shownByDefault })}
              disabled={isPending}
              aria-pressed={l.shownByDefault}
              title="How the table first sees it — each of them may switch it in their Legend"
              className="btn-base btn-ghost-ink px-2 py-1 text-[10px]"
            >
              {l.shownByDefault ? (
                <IconEye size={11} strokeWidth={1.8} />
              ) : (
                <IconEyeOff size={11} strokeWidth={1.8} />
              )}
              {l.shownByDefault ? "Starts shown" : "Starts hidden"}
            </button>
            <button
              onClick={() => patch(l, { dmOnly: !l.dmOnly })}
              disabled={isPending}
              aria-pressed={l.dmOnly}
              title={
                l.dmOnly
                  ? "Yours alone — the table never receives it or anything in it"
                  : "The table receives it — whatever in it they may otherwise see"
              }
              className={`btn-base ${l.dmOnly ? "btn-ghost-red" : "btn-ghost-ink"} px-2 py-1 text-[10px]`}
            >
              {l.dmOnly ? "DM only" : "The table's"}
            </button>
          </div>

          {striking === l.id && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-6">
              <span className="font-body text-[12px] italic text-[#8b2520]">{tally(l.id)}</span>
              <button
                onClick={() => {
                  onDelete(l.id);
                  setStriking("");
                }}
                disabled={isPending}
                className="btn-base btn-ghost-red px-2 py-1 text-[10px]"
              >
                Strike it
              </button>
              <button
                onClick={() => setStriking("")}
                className="btn-base btn-ghost-ink px-2 py-1 text-[10px]"
              >
                Keep it
              </button>
            </div>
          )}
        </div>
      ))}

      <form
        className="mt-2 flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <input
          value={adding}
          maxLength={60}
          onChange={(e) => setAdding(e.target.value)}
          placeholder="Name a new layer"
          aria-label="New layer"
          className="input-parchment input-compact min-w-0 flex-1"
        />
        <button
          type="submit"
          disabled={!adding.trim() || isPending}
          className="btn-base btn-ghost-ink px-3 py-1.5 text-[11px] disabled:opacity-50"
        >
          <IconPlus size={12} strokeWidth={2} />
          A layer
        </button>
      </form>
    </div>
  );
}
