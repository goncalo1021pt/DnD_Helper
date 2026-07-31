
import { useEffect, useState } from "react";
import type { Encounter } from "../../api/client";
import { useFileEncounter, useLocations } from "../../hooks";
import { PlaceSelect } from "./PlaceSelect";

/** Where an open fight belongs, editable in place. It saves as you go — a
 * filing is a note to self, not a form to submit. */
export function FilingBar({ campaignId, enc }: { campaignId: string; enc: Encounter }) {
  const { data: locations } = useLocations(campaignId);
  const file = useFileEncounter(campaignId);
  const [tag, setTag] = useState(enc.tag);
  useEffect(() => setTag(enc.tag), [enc.id, enc.tag]);

  const save = (nextTag: string, locationId: string | null) =>
    file.mutate({ encounterId: enc.id, tag: nextTag.trim(), locationId });

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="label-stamp text-[10px] tracking-[1.5px] text-gold-muted">Filed under</span>
      <input
        value={tag}
        maxLength={60}
        onChange={(e) => setTag(e.target.value)}
        onBlur={() => { if (tag.trim() !== enc.tag) save(tag, enc.locationId ?? null); }}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        placeholder="Session or act…"
        className="input-hall w-[190px]"
      />
      {(locations ?? []).length > 0 && (
        <PlaceSelect
          locations={locations ?? []}
          value={enc.locationId ?? ""}
          onChange={(v) => save(tag, v || null)}
          className="w-[210px]"
        />
      )}
    </div>
  );
}
