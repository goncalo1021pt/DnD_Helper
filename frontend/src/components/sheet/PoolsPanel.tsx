import type { ResourcePool } from "../../api/client";
import { useSetPools } from "../../hooks";
import SectionLabel from "./SectionLabel";

/* ═══ Resource pools (#175) ═════════════════════════════════════════════════
   Rages, Channel Divinity, Focus Points — the expendable uses a hero tracked
   on paper while the app tracked their spell slots. The server owns the
   numbers: max comes resolved off the sheet (content × level), and only what
   is SPENT is ever written back, the whole map at once, like slots.

   Two counters for two shapes of pool. A handful of uses reads as pips, the
   same gold rounds the spell slots wear; a big points pool — Focus at 20,
   Lay On Hands at 5×level — reads as a stepper, the same − n/max + the
   companions' hit points wear. Nobody wants to click 35 pips. */

const PIP_LIMIT = 8;

function restNote(pool: ResourcePool): string {
  switch (pool.shortRest) {
    case "all":
      return "Refills on any rest";
    case "one":
      return "One use back on a short rest, all on a long rest";
    default:
      return "Refills on a long rest";
  }
}

export default function PoolsPanel({
  characterId,
  pools,
  canEdit,
}: {
  characterId: string;
  pools: ResourcePool[];
  canEdit: boolean;
}) {
  const setPools = useSetPools(characterId);

  if (pools.length === 0) return null;

  // The whole map goes up every time — the payload is the state, so a pool
  // absent from it is unspent and a race cannot half-apply.
  function setUsed(name: string, next: number) {
    const pool = pools.find((p) => p.name === name);
    if (!pool) return;
    const clamped = Math.min(Math.max(next, 0), pool.max);
    if (clamped === pool.used) return;
    const used: Record<string, number> = {};
    for (const p of pools) {
      if (p.used > 0) used[p.name] = p.used;
    }
    if (clamped > 0) used[name] = clamped;
    else delete used[name];
    setPools.mutate(used);
  }

  return (
    <section>
      <SectionLabel>Resources</SectionLabel>
      <div className="parchment flex flex-col gap-2.5 px-4 py-3.5">
        {pools.map((pool) => (
          <div
            key={pool.name}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5"
            title={restNote(pool)}
          >
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="font-heading text-[13px] font-bold text-ink">{pool.name}</span>
              <span className="label-stamp text-[8px] tracking-[1px] text-ink-label">
                {pool.grantedBy}
              </span>
            </div>

            {pool.max <= PIP_LIMIT ? (
              <div className="flex gap-1.5" role="group" aria-label={pool.name}>
                {Array.from({ length: pool.max }, (_, i) => (
                  <button
                    key={i}
                    disabled={!canEdit}
                    onClick={() => setUsed(pool.name, pool.used + (i < pool.used ? -1 : 1))}
                    title={i < pool.used ? "spent — click to restore" : "click to spend"}
                    className="h-4 w-4 cursor-pointer rounded-full border-none p-0"
                    style={{
                      background:
                        i < pool.used ? "#3d2317" : "linear-gradient(180deg,#e0a94e,#9a703a)",
                      boxShadow: "inset 0 0 0 1.5px rgba(61,35,23,.7)",
                      opacity: canEdit ? 1 : 0.7,
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                {canEdit && (
                  <button
                    onClick={() => setUsed(pool.name, pool.used + 1)}
                    disabled={pool.used >= pool.max || setPools.isPending}
                    className="btn-base btn-ghost-ink h-6 w-6 p-0 text-[13px] leading-none disabled:opacity-30"
                    aria-label={`Spend ${pool.name}`}
                  >
                    −
                  </button>
                )}
                <span className="font-heading min-w-[3.5rem] text-center text-[13px] font-bold text-ink tabular-nums">
                  {pool.max - pool.used}/{pool.max}
                </span>
                {canEdit && (
                  <button
                    onClick={() => setUsed(pool.name, pool.used - 1)}
                    disabled={pool.used <= 0 || setPools.isPending}
                    className="btn-base btn-ghost-ink h-6 w-6 p-0 text-[13px] leading-none disabled:opacity-30"
                    aria-label={`Restore ${pool.name}`}
                  >
                    +
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
