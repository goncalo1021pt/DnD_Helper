import type { Location } from "../../api/client";
import { useRevealBatches } from "../../hooks";
import ParchmentModal from "../ui/ParchmentModal";
import { IconTrash } from "../ui/icons";

/* The DM's reveal ledger: every submitted batch, each removable — tearing
 * one out fogs its ground over again.
 *
 * Each line also carries the place the batch hangs on (#191). A batch with a
 * place is not the party's: its ground lifts for whoever that place's veil
 * admits, so the ledger is where the DM sees which reveals are somebody's
 * private knowledge and which are simply the map. */
export function RevealLedger({
  mapId,
  mapName,
  locations,
  onDelete,
  deleting,
  onRetie,
  retying,
  onClose,
}: {
  mapId: string;
  mapName: string;
  locations: Location[];
  onDelete: (batchId: string) => void;
  deleting: boolean;
  onRetie: (batchId: string, locationId: string | null) => void;
  retying: boolean;
  onClose: () => void;
}) {
  const { data: batches } = useRevealBatches(mapId, true);
  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[460px]">
      <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
        {mapName}
      </div>
      <h3 className="font-display m-0 mb-2 text-center text-2xl font-bold text-ink">
        The Reveal Ledger
      </h3>
      <p className="font-body m-0 mb-4 text-center text-[13px] italic text-ink-body">
        Tear a page out and its ground fogs over again.
      </p>
      {!batches || batches.length === 0 ? (
        <p className="font-accent m-0 py-4 text-center text-[14px] italic text-ink-body">
          Nothing lifted yet — the world is still theirs to earn.
        </p>
      ) : (
        <div className="mb-2 flex max-h-[320px] flex-col gap-2 overflow-y-auto">
          {batches.map((b) => (
            <div
              key={b.id}
              className="flex items-center justify-between gap-3 rounded-[3px] px-3 py-2"
              style={{ background: "rgba(0,0,0,.06)", boxShadow: "inset 0 0 0 1px rgba(120,80,30,.25)" }}
            >
              <div className="min-w-0 flex-1">
                <div className="font-heading truncate text-[13.5px] font-bold text-ink">
                  {b.note || "Unlabeled reveal"}
                </div>
                <div className="label-stamp text-[9px] tracking-[1px] text-ink-label">
                  {b.circles} {b.circles === 1 ? "circle" : "circles"} ·{" "}
                  {b.locationId ? `knowledge of ${b.locationName}` : b.poolName} ·{" "}
                  {new Date(b.createdAt).toLocaleDateString()}
                </div>
                {locations.length > 0 && (
                  <select
                    value={b.locationId ?? ""}
                    disabled={retying}
                    onChange={(e) => onRetie(b.id, e.target.value || null)}
                    title="Which place's veil decides who sees this ground"
                    className="input-parchment mt-1.5 w-full cursor-pointer py-1 text-[12px]"
                  >
                    <option value="">— the whole party, plainly —</option>
                    {locations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {"— ".repeat(l.depth)}
                        {l.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <button
                onClick={() => onDelete(b.id)}
                disabled={deleting}
                title="Tear it out — this area fogs over again"
                className="btn-base btn-ghost-red flex-none p-2"
              >
                <IconTrash size={13} strokeWidth={1.8} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end">
        <button onClick={onClose} className="btn-base btn-ghost-ink px-5 py-[11px] text-xs">
          Close
        </button>
      </div>
    </ParchmentModal>
  );
}
