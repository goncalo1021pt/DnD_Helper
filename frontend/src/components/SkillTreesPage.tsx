import { useState, type FormEvent } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { useCreateTree, useTrees } from "../hooks";
import type { CampaignContext } from "./CampaignView";
import ParchmentModal from "./ui/ParchmentModal";
import { IconPlus } from "./ui/icons";

/** The campaign's skill trees: list + create. Editing happens per tree. */
export default function SkillTreesPage() {
  const { campaign, role } = useOutletContext<CampaignContext>();
  const isDM = role === "dm";
  const { data: trees, isLoading } = useTrees(campaign.id);
  const create = useCreateTree(campaign.id);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [keystoneCost, setKeystoneCost] = useState(1);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      { name: name.trim(), description: description.trim(), keystonePickCost: keystoneCost },
      {
        onSuccess: () => {
          setAdding(false);
          setName("");
          setDescription("");
          setKeystoneCost(1);
        },
      },
    );
  }

  return (
    <div className="panel-hall px-[30px] pb-11 pt-8">
      <div
        className="mb-[26px] flex flex-wrap items-center justify-between gap-4 pb-3.5"
        style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
      >
        <div className="flex flex-wrap items-baseline gap-3.5">
          <h2
            className="font-display m-0 text-[clamp(24px,3vw,32px)] font-black text-[#e7d3a6]"
            style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
          >
            The Skill Trees
          </h2>
          {trees && trees.length > 0 && (
            <span className="label-stamp text-xs text-gold-muted">
              {trees.length} woven
            </span>
          )}
        </div>
        {isDM && (
          <button
            onClick={() => setAdding(true)}
            className="btn-base btn-gold clip-octagon h-10 px-5 text-[13px]"
          >
            <IconPlus size={15} strokeWidth={2} />
            Weave a Tree
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="font-accent px-5 py-[70px] text-center text-base italic text-[#9c855e]">
          Reading the strands…
        </div>
      ) : trees && trees.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6">
          {trees.map((t) => (
            <Link
              key={t.id}
              to={`../trees/${t.id}`}
              className="parchment block px-[22px] py-5 no-underline transition hover:-translate-y-0.5"
            >
              <div className="font-display mb-1.5 text-xl font-bold leading-tight text-ink">
                {t.name}
              </div>
              {t.description && (
                <p className="font-body m-0 mb-2 text-sm italic leading-relaxed text-ink-body">
                  {t.description}
                </p>
              )}
              <span className="label-stamp text-[9.5px] tracking-[1.5px] text-ink-label">
                Keystones cost {t.keystonePickCost} pick
                {t.keystonePickCost === 1 ? "" : "s"}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="px-5 py-[70px] text-center">
          <div className="font-display text-2xl text-[#cdb582]">
            No trees woven yet
          </div>
          <div className="font-accent mt-2 text-base italic text-[#9c855e]">
            {isDM
              ? "— weave the first web of powers. —"
              : "— the powers of this world are still hidden. —"}
          </div>
        </div>
      )}

      {adding && (
        <ParchmentModal onClose={() => setAdding(false)} maxWidth="max-w-[480px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            The Loom
          </div>
          <h3 className="font-display m-0 mb-5 text-center text-2xl font-bold text-ink">
            Weave a New Tree
          </h3>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="field-label">Name</span>
              <input
                className="input-parchment input-compact font-heading font-semibold"
                placeholder="e.g. The Mark of Vecna"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="field-label">Description</span>
              <textarea
                className="input-parchment h-auto resize-y py-2 text-[15px]"
                rows={2}
                placeholder="What power is this, and what does it want…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="field-label">Keystone cost (picks)</span>
              <select
                className="input-parchment input-compact w-32 cursor-pointer"
                value={keystoneCost}
                onChange={(e) => setKeystoneCost(Number(e.target.value))}
              >
                <option value={1}>1 — web-gated</option>
                <option value={2}>2 — costs two</option>
              </select>
            </label>
            {create.isError && (
              <p className="font-body m-0 text-sm italic text-[#8b2520]">
                {(create.error as { error?: string } | null)?.error ??
                  "The loom rejected it — try again."}
              </p>
            )}
            <div className="flex gap-2.5">
              <button
                type="submit"
                disabled={create.isPending || !name.trim()}
                className="btn-base btn-wax clip-octagon px-6 py-[11px] text-xs"
              >
                Weave it
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="btn-base btn-ghost-ink px-5 py-[11px] text-xs"
              >
                Cancel
              </button>
            </div>
          </form>
        </ParchmentModal>
      )}
    </div>
  );
}
