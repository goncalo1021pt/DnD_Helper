import { useState } from "react";
import type { RulesKind } from "../api/client";
import { useHomebrewImpact, useResetHomebrew } from "../hooks";
import { exportHomebrewPack } from "../lib/pack";
import ParchmentModal from "./ui/ParchmentModal";

const KIND_LABEL: Record<string, string> = {
  class: "Classes",
  subclass: "Subclasses",
  species: "Species",
  background: "Backgrounds",
  feat: "Feats",
  spell: "Spells",
  item: "Items",
  monster: "Monsters",
};

/**
 * The guarded homebrew wipe: scope picker (everything or one kind), an impact
 * preview of what the cascade will touch, and a typed confirmation. Lives on
 * the profile; mount it only while open.
 */
export default function ResetHomebrewModal({ onClose }: { onClose: () => void }) {
  const reset = useResetHomebrew();
  const { data: impact } = useHomebrewImpact();
  const [scope, setScope] = useState<RulesKind | "">(""); // "" = everything
  const [confirmText, setConfirmText] = useState("");
  const [done, setDone] = useState<number | null>(null);

  const kinds = (impact?.byKind ?? []).filter((r) => r.total > 0);
  const rows = scope ? kinds.filter((r) => r.kind === scope) : kinds;
  const totals = rows.reduce(
    (a, r) => ({
      total: a.total + r.total,
      mine: a.mine + r.onMyCharacters,
      others: a.others + r.onOthersCharacters,
      codex: a.codex + r.inCampaigns,
    }),
    { total: 0, mine: 0, others: 0, codex: 0 },
  );
  const ready = confirmText.trim().toLowerCase() === "reset" && totals.total > 0;

  function doReset() {
    reset.mutate(scope ? { kind: scope } : undefined, {
      onSuccess: (r) => {
        setDone(r?.deleted ?? 0);
        setConfirmText("");
      },
    });
  }

  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[560px]">
      <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
        Profile
      </div>
      <h3 className="font-display m-0 mb-4 text-center text-2xl font-bold text-ink">
        Reset My Homebrew
      </h3>

      {done !== null ? (
        <>
          <p className="font-body m-0 mb-5 text-center text-[13.5px] italic text-ink-body">
            {done} {done === 1 ? "entry" : "entries"} struck from your
            collection. SRD content is untouched.
          </p>
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="btn-base btn-gold clip-octagon h-10 px-6 text-[12px]"
            >
              Done
            </button>
          </div>
        </>
      ) : kinds.length === 0 ? (
        <>
          <p className="font-body m-0 mb-5 text-center text-[13.5px] italic text-ink-body">
            You have no homebrew to reset — your shelves hold only SRD.
          </p>
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="label-stamp cursor-pointer border-none bg-transparent px-2 text-[12px] text-ink-label transition hover:text-ink"
            >
              Close
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="mb-3 block">
            <span className="field-label">What to wipe</span>
            <select
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as RulesKind | "");
                setConfirmText("");
              }}
              className="input-parchment mt-1 w-full cursor-pointer"
            >
              <option value="">
                Everything I authored ({kinds.reduce((n, r) => n + r.total, 0)})
              </option>
              {kinds.map((r) => (
                <option key={r.kind} value={r.kind}>
                  {KIND_LABEL[r.kind] ?? r.kind} ({r.total})
                </option>
              ))}
            </select>
          </label>

          <div
            className="mb-3 rounded-[4px] px-3.5 py-3"
            style={{
              background: "rgba(139,37,32,.08)",
              border: "1px solid rgba(139,37,32,.25)",
            }}
          >
            <p className="font-body m-0 text-[13px] text-ink-body">
              This permanently deletes <b>{totals.total}</b> homebrew{" "}
              {totals.total === 1 ? "entry" : "entries"}. It can't be undone.
            </p>
            {(totals.mine > 0 || totals.others > 0 || totals.codex > 0) && (
              <ul className="m-0 mt-2 list-disc pl-5 text-[12.5px] text-ink-body">
                {totals.mine > 0 && (
                  <li>
                    {totals.mine} in use by your characters — spells vanish,
                    items become plain text, and class/species links clear
                    (your heroes keep their name and level).
                  </li>
                )}
                {totals.others > 0 && (
                  <li>
                    <b>{totals.others} in use by other players' characters</b>{" "}
                    in your campaigns — theirs degrade the same way.
                  </li>
                )}
                {totals.codex > 0 && (
                  <li>
                    {totals.codex} admitted in a campaign codex — those rulings
                    are removed.
                  </li>
                )}
              </ul>
            )}
          </div>

          <p className="font-body mb-3 text-[12.5px] italic text-ink-body">
            Want a backup?{" "}
            <button
              onClick={exportHomebrewPack}
              className="cursor-pointer border-none bg-transparent p-0 text-[12.5px] italic underline"
              style={{ color: "#7a5c2e" }}
            >
              Export my homebrew first
            </button>
            .
          </p>

          <label className="mb-4 block">
            <span className="field-label">
              Type <b>reset</b> to confirm
            </span>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="reset"
              className="input-parchment mt-1 w-full"
            />
          </label>

          {reset.isError && (
            <div className="font-body mb-3 text-sm italic text-[#8b2520]">
              The wipe failed — nothing was removed.
            </div>
          )}

          <div className="flex items-center justify-end gap-4">
            <button
              onClick={onClose}
              className="label-stamp cursor-pointer border-none bg-transparent px-2 text-[12px] text-ink-label transition hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={doReset}
              disabled={!ready || reset.isPending}
              className="btn-base clip-octagon h-10 px-6 text-[12px] disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: "#8b2520", color: "#f3e6c8" }}
            >
              {reset.isPending
                ? "Wiping…"
                : `Wipe ${totals.total} ${totals.total === 1 ? "entry" : "entries"}`}
            </button>
          </div>
        </>
      )}
    </ParchmentModal>
  );
}
