/*
The Atlas (#216): every map on one page — open one, hang one, strike one.

Striking used to hide inside the Hang form, where one button deleted whatever
map happened to be on the table — deletion an arm's length from the name of
the thing being deleted. Now every map is a row, and the strike sits on the
row it strikes, so the DM is always pointing at what they are about to lose.
*/

import { useMemo, useState } from "react";
import type { CampaignMap } from "../../api/client";
import { useDeleteMap } from "../../hooks";
import ParchmentModal from "../ui/ParchmentModal";
import { IconEyeOff, IconPlus, IconTrash } from "../ui/icons";

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
  const [striking, setStriking] = useState("");
  const rows = useMemo(() => treeRows(maps), [maps]);

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
    </ParchmentModal>
  );
}
