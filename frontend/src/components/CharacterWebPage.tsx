import { useState } from "react";
import { useOutletContext, useParams } from "react-router-dom";
import type { SkillNode } from "../api/client";
import {
  useCharacters,
  useCharacterTree,
  useGrantPicks,
  useSpendPick,
} from "../hooks";
import type { CampaignContext } from "./CampaignView";
import ParchmentModal from "./ui/ParchmentModal";
import TreeWeb, { type NodeState } from "./ui/TreeWeb";
import { IconClaim, IconPlus } from "./ui/icons";

/**
 * A character's walk through their tree: the web with taken/reachable/locked
 * states, picks to spend, and the DM's grant button for story beats.
 */
export default function CharacterWebPage() {
  const { campaign, role } = useOutletContext<CampaignContext>();
  const isDM = role === "dm";
  const { charId } = useParams();
  const { data: characters } = useCharacters(campaign.id);
  const { data: state, isLoading } = useCharacterTree(charId ?? "");
  const grant = useGrantPicks(charId ?? "");
  const spend = useSpendPick(charId ?? "");
  const [confirming, setConfirming] = useState<SkillNode | null>(null);

  const character = characters?.find((c) => c.id === charId);
  const canSpend = !!character && (character.mine || isDM);

  if (isLoading || !state) {
    return (
      <p className="font-accent text-base italic text-[#9c855e]">
        Following the strands…
      </p>
    );
  }

  if (!state.assigned || !state.tree) {
    return (
      <div className="panel-hall px-5 sm:px-[30px] py-[60px] text-center">
        <div className="font-display text-2xl text-[#cdb582]">No pact yet</div>
        <div className="font-accent mt-2 text-base italic text-[#9c855e]">
          — {isDM ? "bind this character to a tree from the party ledger." : "no power has marked this one… yet."} —
        </div>
      </div>
    );
  }

  const { tree, nodes, edges } = state.tree;
  const taken = new Set(state.takenNodeIds ?? []);
  const remaining = state.picksRemaining ?? 0;

  const adjacentToTaken = new Set<string>();
  for (const e of edges) {
    if (taken.has(e.a)) adjacentToTaken.add(e.b);
    if (taken.has(e.b)) adjacentToTaken.add(e.a);
  }

  function costOf(n: SkillNode): number {
    return n.rarity === "keystone" ? tree.keystonePickCost : 1;
  }

  function stateFor(n: SkillNode): NodeState {
    if (taken.has(n.id)) return "taken";
    if (
      canSpend &&
      remaining >= costOf(n) &&
      (n.isEntry || adjacentToTaken.has(n.id))
    )
      return "reachable";
    return "locked";
  }

  return (
    <div className="panel-hall px-5 sm:px-[30px] pb-10 pt-6">
      <div
        className="mb-4 flex flex-wrap items-center justify-between gap-4 pb-3.5"
        style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
      >
        <div className="flex flex-wrap items-baseline gap-3.5">
          <h2
            className="font-display m-0 text-[clamp(22px,2.6vw,30px)] font-black text-[#e7d3a6]"
            style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
          >
            {character?.name ?? "The Marked"}
          </h2>
          <span className="label-stamp text-xs text-gold-muted">{tree.name}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="chip-hall px-[15px] py-[9px]">
            <span className="label-stamp text-[10px] tracking-[1.5px] text-gold-muted">
              Picks
            </span>
            <span className="font-heading text-sm font-bold tabular-nums text-ember-bright">
              {remaining}
            </span>
            <span className="label-stamp text-[9px] tracking-[1px] text-gold-muted">
              of {state.picksGranted ?? 0} unspent
            </span>
          </div>
          {isDM && (
            <button
              onClick={() => grant.mutate(1)}
              disabled={grant.isPending}
              title="Grant a pick — a story beat has deepened the mark"
              className="btn-base btn-gold clip-octagon h-10 px-4 text-xs"
            >
              <IconPlus size={14} strokeWidth={2} />
              Grant a Pick
            </button>
          )}
        </div>
      </div>

      {remaining > 0 && canSpend && (
        <p className="font-accent m-0 mb-3 text-[15px] italic text-ember-bright">
          The mark stirs — a power waits to be claimed. Choose from the lit nodes.
        </p>
      )}

      <TreeWeb
        nodes={nodes}
        edges={edges}
        stateFor={stateFor}
        onNodeClick={(n) => {
          if (stateFor(n) === "reachable") setConfirming(n);
          else setConfirming(n); // locked/taken: open as read-only detail
        }}
      />

      {/* legend */}
      <div className="mt-4 flex flex-wrap items-center gap-5">
        {(
          [
            ["taken", "claimed"],
            ["reachable", "within reach"],
            ["locked", "beyond the web"],
          ] as const
        ).map(([s, label]) => (
          <span key={s} className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{
                background: s === "taken" ? "#e0a94e" : s === "reachable" ? "#2a1a0d" : "#221507",
                boxShadow: `inset 0 0 0 1.5px ${
                  s === "taken" ? "#f3e6c8" : s === "reachable" ? "#ecc673" : "#5a4a30"
                }`,
              }}
            />
            <span className="label-stamp text-[9.5px] tracking-[1.5px] text-gold-muted">
              {label}
            </span>
          </span>
        ))}
      </div>

      {confirming && (
        <ParchmentModal onClose={() => setConfirming(null)} maxWidth="max-w-[440px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            {confirming.limb ? confirming.limb.toUpperCase() : "The Web"}
          </div>
          <h3 className="font-display m-0 mb-1 text-center text-2xl font-bold text-ink">
            {confirming.name}
          </h3>
          <div className="label-stamp mb-4 text-center text-[10px] tracking-[2px] text-ink-label">
            {confirming.rarity === "keystone"
              ? `Keystone · costs ${tree.keystonePickCost} pick${tree.keystonePickCost === 1 ? "" : "s"}`
              : "Minor power · costs 1 pick"}
          </div>
          {confirming.description && (
            <p className="font-body m-0 mb-3 text-center text-[14.5px] leading-relaxed text-ink-body">
              {confirming.description}
            </p>
          )}
          {confirming.tradeoff && (
            <p className="font-body m-0 mb-3 text-center text-[13.5px] italic text-[#8b2520]">
              The price: {confirming.tradeoff}
            </p>
          )}
          {spend.isError && (
            <p className="font-body m-0 mb-3 text-center text-sm italic text-[#8b2520]">
              {(spend.error as { error?: string } | null)?.error ??
                "The power slipped away — try again."}
            </p>
          )}
          <div className="flex justify-center gap-2.5">
            {stateFor(confirming) === "reachable" && (
              <button
                onClick={() =>
                  spend.mutate(confirming.id, { onSuccess: () => setConfirming(null) })
                }
                disabled={spend.isPending}
                className="btn-base btn-wax clip-octagon px-6 py-[11px] text-xs"
              >
                <IconClaim strokeWidth={2} />
                Claim this power
              </button>
            )}
            <button
              onClick={() => setConfirming(null)}
              className="btn-base btn-ghost-ink px-5 py-[11px] text-xs"
            >
              {stateFor(confirming) === "reachable" ? "Not yet" : "Close"}
            </button>
          </div>
        </ParchmentModal>
      )}
    </div>
  );
}
