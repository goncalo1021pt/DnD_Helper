/*
Hanging a map.

Lifted out of MapPage (#108) with its own five pieces of state, because none of
them meant anything to the rest of the page: a name, a file, where it hangs, and
whatever went wrong. The image rides to the server as base64 in the body, which
is why this one call is allowed to be slow — see slowUpload() in lib/http.ts.

Striking a map used to live here too, an arm's length from the name of the
thing being deleted; it moved to the atlas (#216), where the strike sits on
the row it strikes.

A new map is the DM's until they hang it in the hall (#276) — a lair map is
uploaded before the session it is found in, and a table that watches a dungeon
appear in the atlas has been told something. The switch is here rather than
only in the atlas because the world map is nobody's secret and saying so in the
same breath saves a trip.
*/

import { useState } from "react";
import type { CampaignMap } from "../../api/client";
import { useCreateMap, useLocations } from "../../hooks";
import ParchmentModal from "../ui/ParchmentModal";

export function HangMapForm({
  campaignId,
  maps,
  onClose,
  onHung,
}: {
  campaignId: string;
  maps: CampaignMap[] | undefined;
  onClose: () => void;
  onHung: (id: string) => void;
}) {
  const createMap = useCreateMap(campaignId);
  const { data: places } = useLocations(campaignId);
  const [mapName, setMapName] = useState("");
  const [mapParent, setMapParent] = useState("");
  const [mapPlace, setMapPlace] = useState("");
  const [mapFile, setMapFile] = useState<File | null>(null);
  const [mapShown, setMapShown] = useState(false);
  const [hangError, setHangError] = useState("");

  function hangMap() {
    if (!mapFile) return;
    setHangError("");
    const reader = new FileReader();
    reader.onload = () => {
      createMap.mutate(
        {
          name: mapName.trim() || mapFile.name.replace(/\.[^.]+$/, ""),
          imageBase64: String(reader.result),
          ...(mapParent ? { parentMapId: mapParent } : {}),
          ...(mapPlace ? { locationId: mapPlace } : {}),
          visibleToParty: mapShown,
        },
        {
          onSuccess: (m) => {
            onClose();
            setMapName("");
            setMapParent("");
            setMapPlace("");
            setMapShown(false);
            setMapFile(null);
            onHung(m.id);
          },
          onError: (err) =>
            setHangError(
              (err as { error?: string } | null)?.error ?? "The map would not hang.",
            ),
        },
      );
    };
    reader.readAsDataURL(mapFile);
  }

  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[440px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            The Map
          </div>
          <h3 className="font-display m-0 mb-4 text-center text-2xl font-bold text-ink">
            Hang a Map
          </h3>
          <div className="flex flex-col gap-3">
            <label className="block">
              <span className="field-label">Name</span>
              <input
                value={mapName}
                onChange={(e) => setMapName(e.target.value)}
                placeholder="The Known World"
                className="input-parchment mt-1 w-full"
              />
            </label>
            <label className="block">
              <span className="field-label">The image (JPEG or PNG, up to 10 MB)</span>
              <input
                type="file"
                accept="image/jpeg,image/png"
                onChange={(e) => setMapFile(e.target.files?.[0] ?? null)}
                className="font-body mt-1 w-full text-[13px] text-ink-body"
              />
            </label>
            {(maps ?? []).length > 0 && (
              <label className="block">
                <span className="field-label">Hangs under</span>
                <select
                  value={mapParent}
                  onChange={(e) => setMapParent(e.target.value)}
                  className="input-parchment mt-1 w-full cursor-pointer"
                >
                  <option value="">Nothing — it's an overworld</option>
                  {(maps ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {(places ?? []).length > 0 && (
              <label className="block">
                <span className="field-label">The place it depicts</span>
                <select
                  value={mapPlace}
                  onChange={(e) => setMapPlace(e.target.value)}
                  className="input-parchment mt-1 w-full cursor-pointer"
                >
                  <option value="">No place — just a map</option>
                  {(places ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={mapShown}
                onChange={(e) => setMapShown(e.target.checked)}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-[#8b2520]"
              />
              <span className="font-body text-sm text-ink-body">
                <span className="text-ink-strong">Hang it in the hall</span> — the
                table may know this map exists.
                <span className="block text-[12.5px] italic text-ink-faded">
                  Left unticked it is yours alone, and you can hang it later from
                  the Atlas.
                </span>
              </span>
            </label>
            {hangError && (
              <div className="font-body text-sm italic text-[#8b2520]">{hangError}</div>
            )}
            <div className="mt-1 flex items-center justify-end gap-3">
              <button
                onClick={onClose}
                className="btn-base btn-ghost-ink px-5 py-[11px] text-xs"
              >
                Cancel
              </button>
              <button
                onClick={hangMap}
                disabled={!mapFile || createMap.isPending}
                className="btn-base btn-gold clip-octagon h-11 px-6 text-[13px] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {createMap.isPending ? "Hanging…" : "Hang it"}
              </button>
            </div>
          </div>
        </ParchmentModal>
  );
}
