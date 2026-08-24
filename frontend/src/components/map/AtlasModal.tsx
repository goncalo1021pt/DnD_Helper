/*
The Atlas (#216): every map on one page — open one, hang one, strike one, and
say who may know it is there at all (#276).

Striking used to hide inside the Hang form, where one button deleted whatever
map happened to be on the table — deletion an arm's length from the name of
the thing being deleted. Now every map is a row, and the strike sits on the
row it strikes, so the DM is always pointing at what they are about to lose.

The veil sits on the row for the same reason. A player's atlas holds only the
maps they may know of, so this list IS the difference between the two — which
makes it the one place a DM can see, in one glance, what the table has and what
it does not. The eye states it; pressing it opens the same three-grain control
the places, the notices, the Folk and the handouts use.
*/

import { useMemo, useState } from "react";
import type { CampaignMap } from "../../api/client";
import {
  useCharacters,
  useClearMapOverride,
  useDeleteMap,
  useSetMapVisibility,
} from "../../hooks";
import ParchmentModal from "../ui/ParchmentModal";
import VisibilityControl from "../VisibilityControl";
import { IconEye, IconEyeOff, IconPlus, IconTrash } from "../ui/icons";

/** Depth-first walk of the atlas, overworlds first, siblings alphabetical. */
function treeRows(maps: CampaignMap[]): Array<{ map: CampaignMap; depth: number }> {
  const kids = new Map<string, CampaignMap[]>();
  const roots: CampaignMap[] = [];
  for (const m of maps) {
    if (m.parentMapId && maps.some((p) => p.id === m.parentMapId)) {
      kids.set(m.parentMapId, [...(kids.get(m.parentMapId) ?? []), m]);
    } else {
      roots.push(m);
    }
  }
  const byName = (a: CampaignMap, b: CampaignMap) => a.name.localeCompare(b.name);
  const out: Array<{ map: CampaignMap; depth: number }> = [];
  const seen = new Set<string>();
  const walk = (m: CampaignMap, depth: number) => {
    if (seen.has(m.id) || depth > 10) return;
    seen.add(m.id);
    out.push({ map: m, depth });
    for (const c of [...(kids.get(m.id) ?? [])].sort(byName)) walk(c, depth + 1);
  };
  for (const r of roots.sort(byName)) walk(r, 0);
  return out;
}

/** What one map's veil says, in the fewest words that are still true. */
function veilWords(m: CampaignMap): string {
  const singled = (m.visibilityOverrides ?? []).length;
  const base = m.visibleToParty ? "The whole table" : "Yours alone";
  if (singled === 0) return base;
  return `${base} · ${singled} singled out`;
}

export function AtlasModal({
  campaignId,
  maps,
  currentId,
  isDM,
  onOpen,
  onHang,
  onStruck,
  onClose,
}: {
  campaignId: string;
  maps: CampaignMap[];
  /** The map on the table, so its row can say so. */
  currentId: string | undefined;
  isDM: boolean;
  onOpen: (id: string) => void;
  onHang: () => void;
  /** Called after a strike, with the struck map's id. */
  onStruck: (id: string) => void;
  onClose: () => void;
}) {
  const deleteMap = useDeleteMap(campaignId);
  // The heroes the veil can single out. Read here rather than by the page, so
  // it costs nothing until somebody opens the atlas — and nothing at all for a
  // player, who never sees the control it feeds.
  const { data: characters } = useCharacters(isDM ? campaignId : "");
  const setVisibility = useSetMapVisibility(campaignId);
  const clearOverride = useClearMapOverride(campaignId);
  const [striking, setStriking] = useState("");
  const [veiling, setVeiling] = useState("");
  const rows = useMemo(() => treeRows(maps), [maps]);
  const veilingMap = maps.find((m) => m.id === veiling);

  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[440px]">
      <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
        The Map
      </div>
      <h3 className="font-display m-0 mb-4 text-center text-2xl font-bold text-ink">
        The Atlas
      </h3>

      {rows.length === 0 ? (
        <div className="font-accent py-6 text-center text-sm italic text-ink-faded">
          Nothing hangs here yet.
        </div>
      ) : (
        <div className="flex flex-col">
          {rows.map(({ map: m, depth }) => (
            <div
              key={m.id}
              className="flex items-center gap-2 border-0 border-b border-solid py-2"
              style={{
                paddingLeft: depth * 18,
                borderColor: "rgba(74,55,28,.14)",
              }}
            >
              <button
                onClick={() => onOpen(m.id)}
                title={`Unroll ${m.name}`}
                className="font-heading min-w-0 flex-1 cursor-pointer truncate border-none bg-transparent p-0 text-left text-[14px] text-ink transition hover:text-[#8b2520]"
              >
                {depth > 0 && <span className="mr-1 text-ink-faded">↳</span>}
                {m.name}
              </button>

              {/* The place this map depicts (#229) — the atlas finally says. */}
              {m.locationName && (
                <span className="font-accent flex-none text-[11px] italic text-ink-label">
                  {m.locationName}
                </span>
              )}
              {m.fogEnabled && (
                <span
                  className="flex items-center gap-1 text-ink-faded"
                  title="Fog is on — players see only what has been revealed"
                >
                  <IconEyeOff size={12} strokeWidth={1.8} />
                </span>
              )}
              {m.id === currentId && (
                <span className="label-stamp text-[8px] tracking-[1px] text-[#8b2520]">
                  on the table
                </span>
              )}

              {/* Who may know this map is here at all (#276). Only the DM's
                  atlas carries the flag, so only the DM's atlas shows it. */}
              {isDM && m.visibleToParty !== undefined && striking !== m.id && (
                <button
                  onClick={() => setVeiling(m.id)}
                  title={`${veilWords(m)} — press to change who may know of ${m.name}`}
                  className={`btn-base h-7 flex-none px-2 py-0 text-[10px] ${
                    m.visibleToParty ? "btn-ghost-ink" : "btn-wax"
                  }`}
                >
                  {m.visibleToParty ? (
                    <IconEye size={12} strokeWidth={1.8} />
                  ) : (
                    <IconEyeOff size={12} strokeWidth={1.8} />
                  )}
                  {/* The word, not only the ink: the strike beside it is red
                      too, and a DM should never have to tell two reds apart
                      to know what the table can see. */}
                  {m.visibleToParty ? "Shown" : "Yours"}
                  {(m.visibilityOverrides ?? []).length > 0
                    ? ` ·${(m.visibilityOverrides ?? []).length}`
                    : ""}
                </button>
              )}

              {isDM &&
                (striking === m.id ? (
                  <span className="flex items-center gap-1.5">
                    <span className="font-body text-[11px] italic text-[#8b2520]">
                      Its pins and its fog go with it.
                    </span>
                    <button
                      onClick={() =>
                        deleteMap.mutate(m.id, {
                          onSuccess: () => {
                            setStriking("");
                            onStruck(m.id);
                          },
                        })
                      }
                      disabled={deleteMap.isPending}
                      className="btn-base btn-ghost-red px-2 py-1 text-[10px]"
                    >
                      {deleteMap.isPending ? "Striking…" : "Strike it"}
                    </button>
                    <button
                      onClick={() => setStriking("")}
                      className="btn-base btn-ghost-ink px-2 py-1 text-[10px]"
                    >
                      Keep it
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setStriking(m.id)}
                    aria-label={`Strike ${m.name}`}
                    title={`Strike ${m.name} from the atlas`}
                    className="btn-base btn-ghost-red h-7 px-2 py-0 text-[11px]"
                  >
                    <IconTrash size={12} strokeWidth={1.8} />
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        {isDM ? (
          <button
            onClick={onHang}
            className="btn-base btn-gold clip-octagon h-10 px-4 text-[12px]"
          >
            <IconPlus size={14} strokeWidth={2} />
            Hang a map
          </button>
        ) : (
          <span />
        )}
        <button onClick={onClose} className="btn-base btn-ghost-ink px-5 py-[11px] text-xs">
          Close
        </button>
      </div>

      {veilingMap && (
        <ParchmentModal onClose={() => setVeiling("")} maxWidth="max-w-[460px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            {veilingMap.name}
          </div>
          <h3 className="font-display m-0 mb-2 text-center text-2xl font-bold text-ink">
            Who Knows Of It
          </h3>
          <p className="font-body m-0 mb-4 text-center text-[13px] italic text-ink-body">
            A veiled map is not on their shelf at all — not its name, not its
            picture, and not the marker that leads to it.
            {veilingMap.locationName && (
              <>
                {" "}
                It depicts <strong>{veilingMap.locationName}</strong>, so veiling
                that place veils this too, whatever is set here.
              </>
            )}
          </p>
          <VisibilityControl
            visibleToParty={veilingMap.visibleToParty ?? false}
            overrides={veilingMap.visibilityOverrides ?? []}
            characters={characters ?? []}
            campaignId={campaignId}
            isPending={setVisibility.isPending || clearOverride.isPending}
            onChange={(body) => setVisibility.mutate({ mapId: veilingMap.id, body })}
            onClearHero={(characterId) =>
              clearOverride.mutate({ mapId: veilingMap.id, characterId })
            }
          />
          <div className="mt-5 flex justify-end">
            <button
              onClick={() => setVeiling("")}
              className="btn-base btn-ghost-ink px-5 py-[11px] text-xs"
            >
              Done
            </button>
          </div>
        </ParchmentModal>
      )}
    </ParchmentModal>
  );
}
