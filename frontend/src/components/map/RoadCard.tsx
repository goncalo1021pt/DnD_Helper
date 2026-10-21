import type { CampaignMap, MapShape } from "../../api/client";
import { PACES, formatDistance, runDistance, travelTime } from "../../lib/mapScale";
import ParchmentModal from "../ui/ParchmentModal";

/*
What a road says when you press it (#357): its name, how long it is, and how
long it takes to walk. It is a reading, open to anybody who can see the road —
before this a player pressing the DM's road got nothing, because the only thing
behind a road was the DM's form. That form is one step further now, behind
Edit, for whoever may change the road.
*/

export function RoadCard({
  shape,
  map,
  heading,
  fogged,
  canEdit,
  onEdit,
  onClose,
}: {
  shape: MapShape;
  map: CampaignMap;
  heading: string;
  /** Under fog a player holds only the stretches they have seen. */
  fogged: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const d = runDistance(shape.points, map);
  const unit = map.scale?.unit;
  const name = shape.label || shape.locationName || "A road with no name";
  return (
    <ParchmentModal onClose={onClose}>
      <div data-testid="road-card">
        <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">{heading}</div>
        <h3 className="font-display m-0 mb-3 text-center text-2xl font-bold text-ink">{name}</h3>
        {d !== null && unit ? (
          <>
            <div className="font-heading text-center text-[20px] font-bold text-ink" data-testid="road-length">
              {formatDistance(d, unit)}
            </div>
            {travelTime(d, unit, PACES[1]) && (
              <ul className="m-0 mt-3 grid list-none grid-cols-3 gap-2 p-0 text-center">
                {PACES.map((p) => (
                  <li key={p.pace} className="rounded-[3px] px-2 py-1.5" style={{ background: "rgba(60,35,15,.07)" }}>
                    <div className="label-stamp text-[9px] tracking-[1.5px] text-ink-label">{p.pace} pace</div>
                    <div className="font-body text-[14px] text-ink">{travelTime(d, unit, p)}</div>
                  </li>
                ))}
              </ul>
            )}
            {fogged && (
              <p className="font-accent m-0 mt-3 text-center text-[13px] italic text-ink-label">
                Measured along the stretch you have seen.
              </p>
            )}
          </>
        ) : (
          <p className="font-accent m-0 text-center text-[14px] italic text-ink-label">
            This map has no scale yet{canEdit ? " — measure between two places you know and use it as the scale." : "."}
          </p>
        )}
        {canEdit && (
          <div className="mt-5 flex justify-center">
            <button onClick={onEdit} className="btn-base btn-ghost-ink px-4 py-2 text-[11px]">
              Edit
            </button>
          </div>
        )}
      </div>
    </ParchmentModal>
  );
}
