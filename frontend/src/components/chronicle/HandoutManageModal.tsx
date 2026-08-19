/*
The DM's controls for one prop: its words, who may look at it, and striking it.

On parchment rather than inline on the hall strip, because VisibilityControl is
a parchment component — its wax and ghost-ink buttons belong on a light surface
(#186), and the reveal rules are identical to the ones on the place tree.
*/

import { useState } from "react";
import type { Character, Handout } from "../../api/client";
import {
  handoutImageUrl,
  useClearHandoutOverride,
  useDeleteHandout,
  useSetHandoutVisibility,
  useUpdateHandout,
} from "../../hooks";
import ParchmentModal from "../ui/ParchmentModal";
import VisibilityControl from "../VisibilityControl";
import { IconTrash } from "../ui/icons";

export default function HandoutManageModal({
  campaignId,
  handout,
  characters,
  onClose,
}: {
  campaignId: string;
  handout: Handout;
  characters: Character[];
  onClose: () => void;
}) {
  const update = useUpdateHandout(campaignId);
  const setVisibility = useSetHandoutVisibility(campaignId);
  const clearOverride = useClearHandoutOverride(campaignId);
  const strike = useDeleteHandout(campaignId);

  const [title, setTitle] = useState(handout.title);
  const [caption, setCaption] = useState(handout.caption);
  const pending =
    update.isPending || setVisibility.isPending || clearOverride.isPending || strike.isPending;
  const edited = title !== handout.title || caption !== handout.caption;

  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[480px]">
      <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
        The Handout
      </div>
      <h3 className="font-display m-0 mb-4 text-center text-2xl font-bold text-ink">
        {handout.title}
      </h3>

      <img
        src={handoutImageUrl(handout.id)}
        alt={handout.title}
        className="mb-4 max-h-[220px] w-full rounded-[2px] object-contain"
        style={{ background: "rgba(0,0,0,.18)" }}
      />

      <div className="flex flex-col gap-3">
        <label className="block">
          <span className="field-label">What it is</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            className="input-parchment input-compact mt-1 w-full"
          />
        </label>
        <label className="block">
          <span className="field-label">The line under it</span>
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            maxLength={500}
            className="input-parchment input-compact mt-1 w-full"
          />
        </label>
        {edited && (
          <div>
            <button
              type="button"
              disabled={pending || !title.trim()}
              onClick={() => update.mutate({ handoutId: handout.id, body: { title, caption } })}
              className="btn-base btn-wax clip-octagon px-4 py-[9px] text-xs"
            >
              Save the words
            </button>
          </div>
        )}

        <div className="torn-divider" />

        <VisibilityControl
          visibleToParty={handout.visibleToParty ?? false}
          overrides={handout.visibility ?? []}
          characters={characters}
          campaignId={campaignId}
          isPending={pending}
          onChange={(body) => setVisibility.mutate({ handoutId: handout.id, body })}
          onClearHero={(characterId) =>
            clearOverride.mutate({ handoutId: handout.id, characterId })
          }
        />

        <div className="torn-divider" />

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (
                confirm(
                  `Take "${handout.title}" back off the table? Its chronicle line goes with it.`,
                )
              ) {
                strike.mutate(handout.id, { onSuccess: onClose });
              }
            }}
            className="btn-base btn-ghost-red px-3.5 py-2 text-[11px]"
          >
            <IconTrash size={12} strokeWidth={1.8} />
            Take it back
          </button>
          <button onClick={onClose} className="btn-base btn-ghost-ink px-5 py-[11px] text-xs">
            Done
          </button>
        </div>
      </div>
    </ParchmentModal>
  );
}
