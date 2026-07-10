import { useState, type FormEvent } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import type { SkillNode, SkillNodeInput } from "../api/client";
import {
  useCreateNode,
  useDeleteNode,
  useDeleteTree,
  useSetEdges,
  useTree,
  useUpdateNode,
} from "../hooks";
import type { CampaignContext } from "./CampaignView";
import ParchmentModal from "./ui/ParchmentModal";
import TreeWeb from "./ui/TreeWeb";
import { IconPencil, IconPlus, IconTrash } from "./ui/icons";

interface NodeFormValues {
  name: string;
  limb: string;
  rarity: "minor" | "keystone";
  isEntry: boolean;
  description: string;
  tradeoff: string;
  connections: string[];
}

const emptyNode: NodeFormValues = {
  name: "",
  limb: "",
  rarity: "minor",
  isEntry: false,
  description: "",
  tradeoff: "",
  connections: [],
};

function NodeForm({
  initial,
  others,
  isPending,
  errorText,
  onSubmit,
  onCancel,
}: {
  initial: NodeFormValues;
  others: SkillNode[];
  isPending: boolean;
  errorText?: string;
  onSubmit: (v: NodeFormValues) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<NodeFormValues>(initial);
  const input = "input-parchment input-compact";

  function set<K extends keyof NodeFormValues>(key: K, val: NodeFormValues[K]) {
    setV((prev) => ({ ...prev, [key]: val }));
  }

  function toggleConnection(id: string) {
    set(
      "connections",
      v.connections.includes(id)
        ? v.connections.filter((c) => c !== id)
        : [...v.connections, id],
    );
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!v.name.trim()) return;
    onSubmit(v);
  }

  // Group connection candidates by limb for scanning.
  const limbs = [...new Set(others.map((n) => n.limb || ""))].sort();

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 text-ink-strong">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Power name</span>
          <input
            className={`${input} font-heading font-semibold`}
            placeholder="e.g. Withering Touch"
            value={v.name}
            maxLength={80}
            onChange={(e) => set("name", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Limb</span>
          <input
            className={input}
            placeholder="e.g. ENTROPY"
            value={v.limb}
            maxLength={40}
            onChange={(e) => set("limb", e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Rarity</span>
          <select
            className={`${input} cursor-pointer`}
            value={v.rarity}
            onChange={(e) => set("rarity", e.target.value as "minor" | "keystone")}
          >
            <option value="minor">minor</option>
            <option value="keystone">keystone</option>
          </select>
        </label>
        <label className="flex items-center gap-2.5 pt-6">
          <input
            type="checkbox"
            checked={v.isEntry}
            onChange={(e) => set("isEntry", e.target.checked)}
            className="h-4 w-4 accent-[#8b2520]"
          />
          <span className="field-label">Entry node (no prereqs)</span>
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="field-label">What it does</span>
        <textarea
          className="input-parchment h-auto resize-y py-2 text-[15px]"
          rows={3}
          placeholder="e.g. Your hits deal +1d6 necrotic damage."
          value={v.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </label>

      {v.rarity === "keystone" && (
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Trade-off (the price)</span>
          <textarea
            className="input-parchment h-auto resize-y py-2 text-[15px]"
            rows={2}
            placeholder="e.g. Healing on you is halved until your next long rest…"
            value={v.tradeoff}
            onChange={(e) => set("tradeoff", e.target.value)}
          />
        </label>
      )}

      {others.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="field-label">Connected to (the web)</span>
          <div
            className="max-h-44 overflow-y-auto px-3 py-2"
            style={{ boxShadow: "inset 0 0 0 1px #b69a68", background: "rgba(255,255,255,.3)" }}
          >
            {limbs.map((limb) => (
              <div key={limb || "(none)"} className="mb-1.5">
                <div className="label-stamp text-[9px] tracking-[1.5px] text-ink-label">
                  {(limb || "unsorted").toUpperCase()}
                </div>
                {others
                  .filter((n) => (n.limb || "") === limb)
                  .map((n) => (
                    <label key={n.id} className="flex items-center gap-2 py-0.5 text-sm">
                      <input
                        type="checkbox"
                        checked={v.connections.includes(n.id)}
                        onChange={() => toggleConnection(n.id)}
                        className="h-3.5 w-3.5 accent-[#8b2520]"
                      />
                      <span className={n.rarity === "keystone" ? "font-semibold" : ""}>
                        {n.name}
                        {n.rarity === "keystone" ? " ◆" : ""}
                      </span>
                    </label>
                  ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="torn-divider" />
      {errorText && (
        <p className="font-body m-0 text-sm italic text-[#8b2520]">{errorText}</p>
      )}
      <div className="flex gap-2.5">
        <button
          type="submit"
          disabled={isPending || !v.name.trim()}
          className="btn-base btn-wax clip-octagon px-6 py-[11px] text-xs"
        >
          Bind the power
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn-base btn-ghost-ink px-5 py-[11px] text-xs"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Tree editor (DM) / web viewer (players): the web up top, powers below. */
export default function TreeEditorPage() {
  const { role } = useOutletContext<CampaignContext>();
  const isDM = role === "dm";
  const { treeId } = useParams();
  const navigate = useNavigate();
  const { data: detail, isLoading } = useTree(treeId ?? "");
  const createNode = useCreateNode(treeId ?? "");
  const updateNode = useUpdateNode(treeId ?? "");
  const deleteNode = useDeleteNode(treeId ?? "");
  const setEdges = useSetEdges(treeId ?? "");
  const deleteTree = useDeleteTree(detail?.tree.campaignId ?? "");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<SkillNode | null>(null);

  if (isLoading || !detail) {
    return (
      <p className="font-accent text-base italic text-[#9c855e]">
        Untangling the web…
      </p>
    );
  }

  const { tree, nodes, edges } = detail;

  function connectionsOf(nodeId: string): string[] {
    return edges
      .filter((e) => e.a === nodeId || e.b === nodeId)
      .map((e) => (e.a === nodeId ? e.b : e.a));
  }

  /** Rebuild the full edge list with `nodeId`'s connections replaced. */
  function edgesWith(nodeId: string, connections: string[]) {
    const kept = edges.filter((e) => e.a !== nodeId && e.b !== nodeId);
    return [...kept, ...connections.map((c) => ({ a: nodeId, b: c }))];
  }

  function toInput(v: NodeFormValues): SkillNodeInput {
    return {
      name: v.name.trim(),
      limb: v.limb.trim(),
      rarity: v.rarity,
      isEntry: v.isEntry,
      description: v.description.trim(),
      tradeoff: v.rarity === "keystone" && v.tradeoff.trim() ? v.tradeoff.trim() : null,
    };
  }

  function submitCreate(v: NodeFormValues) {
    createNode.mutate(toInput(v), {
      onSuccess: (node) => {
        if (v.connections.length > 0 && node) {
          setEdges.mutate(edgesWith(node.id, v.connections));
        }
        setAdding(false);
      },
    });
  }

  function submitEdit(node: SkillNode, v: NodeFormValues) {
    updateNode.mutate(
      { nodeId: node.id, body: toInput(v) },
      {
        onSuccess: () => {
          setEdges.mutate(edgesWith(node.id, v.connections));
          setEditing(null);
        },
      },
    );
  }

  const limbs = [...new Set(nodes.map((n) => n.limb || ""))].sort();

  return (
    <div className="flex flex-col gap-6">
      {/* the web */}
      <div className="panel-hall px-5 sm:px-[30px] pb-8 pt-6">
        <div
          className="mb-4 flex flex-wrap items-center justify-between gap-4 pb-3.5"
          style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
        >
          <div className="flex flex-wrap items-baseline gap-3.5">
            <h2
              className="font-display m-0 text-[clamp(22px,2.6vw,30px)] font-black text-[#e7d3a6]"
              style={{ textShadow: "0 2px 6px rgba(0,0,0,.5)" }}
            >
              {tree.name}
            </h2>
            <span className="label-stamp text-xs text-gold-muted">
              {nodes.length} power{nodes.length === 1 ? "" : "s"} · keystones cost{" "}
              {tree.keystonePickCost}
            </span>
          </div>
          {isDM && (
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => setAdding(true)}
                className="btn-base btn-gold clip-octagon h-10 px-5 text-[13px]"
              >
                <IconPlus size={15} strokeWidth={2} />
                Bind a Power
              </button>
              <button
                onClick={() => {
                  if (confirm(`Unweave "${tree.name}" and every power in it?`)) {
                    deleteTree.mutate(tree.id, { onSuccess: () => navigate("../trees") });
                  }
                }}
                title="Delete this tree"
                className="btn-base btn-ghost-red p-[9px]"
                style={{ boxShadow: "inset 0 0 0 1px rgba(158,59,52,.55)" }}
              >
                <IconTrash strokeWidth={1.8} />
              </button>
            </div>
          )}
        </div>
        {tree.description && (
          <p className="font-accent m-0 mb-4 text-[15px] italic text-cream-muted">
            {tree.description}
          </p>
        )}
        <TreeWeb nodes={nodes} edges={edges} />
      </div>

      {/* the powers, limb by limb */}
      {isDM && nodes.length > 0 && (
        <div className="panel-hall px-5 sm:px-[30px] pb-8 pt-6">
          <div
            className="mb-4 pb-3"
            style={{ borderBottom: "1px solid rgba(201,162,39,.25)" }}
          >
            <h3 className="font-display m-0 text-[19px] font-black text-[#e7d3a6]">
              The Powers
            </h3>
          </div>
          <div className="flex flex-col gap-5">
            {limbs.map((limb) => (
              <div key={limb || "(none)"}>
                <div className="label-stamp mb-2 text-[10px] tracking-[2.5px] text-gold-muted">
                  {(limb || "unsorted").toUpperCase()}
                </div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {nodes
                    .filter((n) => (n.limb || "") === limb)
                    .map((n) => (
                      <div key={n.id} className="parchment px-4 py-3.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-display text-[15px] font-bold text-ink">
                              {n.name}
                              {n.rarity === "keystone" && (
                                <span className="label-stamp ml-2 text-[9px] tracking-[1.5px] text-[#8b2520]">
                                  Keystone
                                </span>
                              )}
                              {n.isEntry && (
                                <span className="label-stamp ml-2 text-[9px] tracking-[1.5px] text-ink-label">
                                  Entry
                                </span>
                              )}
                            </div>
                            {n.description && (
                              <p className="font-body m-0 mt-1 text-[13px] leading-relaxed text-ink-body">
                                {n.description}
                              </p>
                            )}
                            {n.tradeoff && (
                              <p className="font-body m-0 mt-1 text-[12.5px] italic text-[#8b2520]">
                                Price: {n.tradeoff}
                              </p>
                            )}
                          </div>
                          <div className="flex flex-none gap-1.5">
                            <button
                              onClick={() => setEditing(n)}
                              title="Edit"
                              className="btn-base btn-ghost-ink p-2"
                            >
                              <IconPencil size={13} strokeWidth={1.8} />
                            </button>
                            <button
                              onClick={() => {
                                if (confirm(`Sever "${n.name}" from the web?`))
                                  deleteNode.mutate(n.id);
                              }}
                              title="Remove"
                              className="btn-base btn-ghost-red p-2"
                            >
                              <IconTrash size={13} strokeWidth={1.8} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {adding && (
        <ParchmentModal onClose={() => setAdding(false)} maxWidth="max-w-[560px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            The Loom
          </div>
          <h3 className="font-display m-0 mb-5 text-center text-2xl font-bold text-ink">
            Bind a New Power
          </h3>
          <NodeForm
            initial={emptyNode}
            others={nodes}
            isPending={createNode.isPending}
            errorText={
              createNode.isError
                ? ((createNode.error as { error?: string } | null)?.error ??
                  "The loom rejected it — check the fields.")
                : undefined
            }
            onSubmit={submitCreate}
            onCancel={() => setAdding(false)}
          />
        </ParchmentModal>
      )}

      {editing && (
        <ParchmentModal onClose={() => setEditing(null)} maxWidth="max-w-[560px]">
          <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">
            The Loom
          </div>
          <h3 className="font-display m-0 mb-5 text-center text-2xl font-bold text-ink">
            Rework the Power
          </h3>
          <NodeForm
            initial={{
              name: editing.name,
              limb: editing.limb,
              rarity: editing.rarity,
              isEntry: editing.isEntry,
              description: editing.description,
              tradeoff: editing.tradeoff ?? "",
              connections: connectionsOf(editing.id),
            }}
            others={nodes.filter((n) => n.id !== editing.id)}
            isPending={updateNode.isPending}
            errorText={
              updateNode.isError
                ? ((updateNode.error as { error?: string } | null)?.error ??
                  "The loom rejected it — check the fields.")
                : undefined
            }
            onSubmit={(v) => submitEdit(editing, v)}
            onCancel={() => setEditing(null)}
          />
        </ParchmentModal>
      )}
    </div>
  );
}
