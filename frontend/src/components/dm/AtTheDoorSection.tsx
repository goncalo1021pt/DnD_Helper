import { useState } from "react";
import { Link } from "react-router-dom";
import type { Campaign } from "../../api/client";
import { useApproveSeat, useDenySeat, useSeatRequests } from "../../hooks";
import { formatWhen } from "../../lib/dates";

/*
 * At the Door: heroes whose owners asked to seat them while the door is
 * barred. The DM previews the full sheet, then waves them in or turns
 * them away. Hidden while nobody waits.
 */
export default function AtTheDoorSection({ campaign }: { campaign: Campaign }) {
  const { data: requests } = useSeatRequests(campaign.id, true);
  const approve = useApproveSeat(campaign.id);
  const deny = useDenySeat(campaign.id);
  const [failure, setFailure] = useState<string | null>(null);

  if ((requests ?? []).length === 0) return null;

  return (
    <section className="panel-hall px-6 pb-6 pt-5">
      <div
        className="mb-4 flex flex-wrap items-baseline justify-between gap-3 pb-3"
        style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
      >
        <h2
          className="font-display m-0 text-[21px] font-black text-[#e7d3a6]"
          style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
        >
          At the Door
        </h2>
        <span className="label-stamp text-[11px] text-gold-muted">
          {(requests ?? []).length} waiting for your nod
        </span>
      </div>

      {failure && (
        <p className="font-accent mb-3 text-[13px] italic text-[#e8a493]">
          {failure}
        </p>
      )}

      <ul className="m-0 grid list-none gap-2.5 p-0">
        {(requests ?? []).map((r) => (
          <li
            key={r.characterId}
            className="flex flex-wrap items-center gap-3.5 rounded-[3px] px-3 py-2.5"
            style={{ background: "rgba(0,0,0,.22)", border: "1px solid rgba(201,162,39,.16)" }}
          >
            <div className="min-w-0 flex-1">
              <div className="font-heading truncate text-[15px] font-bold text-cream">
                {r.name}
                <span className="font-accent ml-2 text-[12.5px] font-normal italic text-cream-muted">
                  {r.class || "Adventurer"} · Lv {r.level}
                </span>
              </div>
              <div className="label-stamp text-[10px] tracking-[1px] text-gold-muted">
                played by {r.ownerName} · knocked {formatWhen(new Date(r.requestedAt))}
              </div>
            </div>
            <div className="flex flex-none items-center gap-2">
              <Link
                to={`/questboard/heroes/${r.characterId}`}
                className="label-stamp rounded-[2px] px-2.5 py-1.5 text-[10px] tracking-[1px] text-cream-soft no-underline transition hover:brightness-125"
                style={{ background: "rgba(201,162,39,.14)", border: "1px solid rgba(201,162,39,.35)" }}
              >
                Preview sheet
              </Link>
              <button
                onClick={() => deny.mutate(r.characterId)}
                disabled={deny.isPending}
                title="Turn them away — their hero returns to resting"
                className="label-stamp cursor-pointer rounded-[2px] px-2.5 py-1.5 text-[10px] tracking-[1px] text-[#e8c4b8] transition hover:brightness-125 disabled:opacity-55"
                style={{ background: "rgba(139,37,32,.28)", border: "1px solid rgba(139,37,32,.6)" }}
              >
                Turn away
              </button>
              <button
                onClick={() =>
                  approve.mutate(r.characterId, {
                    onSuccess: () => setFailure(null),
                    onError: (err) =>
                      setFailure(
                        (err as { error?: string })?.error ??
                          "The approval failed — they still wait at the door.",
                      ),
                  })
                }
                disabled={approve.isPending}
                className="btn-base btn-gold clip-octagon h-8 px-3.5 text-[10px]"
              >
                Let them in
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

