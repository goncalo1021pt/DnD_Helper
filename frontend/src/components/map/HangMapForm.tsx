/*
Hanging a map, and striking one.

Lifted out of MapPage (#108) with its own five pieces of state, because none of
them meant anything to the rest of the page: a name, a file, where it hangs, and
whatever went wrong. The image rides to the server as base64 in the body, which
is why this one call is allowed to be slow — see slowUpload() in lib/http.ts.
*/

import { useState } from "react";
import type { CampaignMap } from "../../api/client";
import { useCreateMap, useDeleteMap } from "../../hooks";
import ParchmentModal from "../ui/ParchmentModal";
import { IconTrash } from "../ui/icons";

export function HangMapForm({
  campaignId,
  maps,
  current,
  isDM,
  onClose,
  onHung,
  onStruck,
}: {
  campaignId: string;
  maps: CampaignMap[] | undefined;
  /** The map on the table, if there is one — it is the one Strike removes. */
  current: CampaignMap | undefined;
  isDM: boolean;
  onClose: () => void;
  onHung: (id: string) => void;
  onStruck: () => void;
}) {
  const createMap = useCreateMap(campaignId);
  const deleteMap = useDeleteMap(campaignId);
  const [mapName, setMapName] = useState("");
  const [mapParent, setMapParent] = useState("");
  const [mapFile, setMapFile] = useState<File | null>(null);
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
        },
        {
          onSuccess: (m) => {
            onClose();
            setMapName("");
            setMapParent("");
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
            {hangError && (
              <div className="font-body text-sm italic text-[#8b2520]">{hangError}</div>
            )}
            <div className="mt-1 flex items-center justify-between gap-3">
              {current && isDM ? (
                <button
                  onClick={() => {
                    if (
                      confirm(
                        `Strike "${current.name}" and all its pins from the atlas?`,
                      )
                    ) {
                      onClose();
                      deleteMap.mutate(current.id, {
                        onSuccess: () => {
                          onStruck();
                        },
                      });
                    }
                  }}
                  className="btn-base btn-ghost-red px-3.5 py-2 text-[11px]"
                >
                  <IconTrash size={12} strokeWidth={1.8} />
                  Strike this map
                </button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-3">
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
          </div>
        </ParchmentModal>
  );
}
