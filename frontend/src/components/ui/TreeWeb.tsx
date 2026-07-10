import type { CSSProperties } from "react";
import type { SkillEdge, SkillNode } from "../../api/client";

/**
 * The web: an SVG rendering of a skill tree. Limbs become columns; within a
 * limb, nodes sit at their BFS depth from the tree's entry nodes, so
 * keystones naturally hang deep. (A dedicated visual design pass replaces
 * this layout later — the geometry is serviceable, not sacred.)
 */

interface Placed {
  node: SkillNode;
  x: number;
  y: number;
  labelDy: number; // staggered so sibling labels don't collide
}

const COL_W = 170;
const ROW_H = 112;
const PAD_X = 100;
const PAD_Y = 84;

function layout(nodes: SkillNode[], edges: SkillEdge[]): { placed: Placed[]; w: number; h: number } {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    adj.set(e.a, [...(adj.get(e.a) ?? []), e.b]);
    adj.set(e.b, [...(adj.get(e.b) ?? []), e.a]);
  }

  // BFS depth from all entry nodes.
  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const n of nodes) {
    if (n.isEntry) {
      depth.set(n.id, 0);
      queue.push(n.id);
    }
  }
  while (queue.length) {
    const id = queue.shift()!;
    const d = depth.get(id)!;
    for (const next of adj.get(id) ?? []) {
      if (!depth.has(next)) {
        depth.set(next, d + 1);
        queue.push(next);
      }
    }
  }

  const limbs = [...new Set(nodes.map((n) => n.limb || ""))].sort();
  const limbIndex = new Map(limbs.map((l, i) => [l, i]));

  // Group nodes into (limb, row) cells, then spread cell members sideways.
  const cells = new Map<string, SkillNode[]>();
  for (const n of nodes) {
    const row = depth.get(n.id) ?? 0;
    const key = `${n.limb || ""}::${row}`;
    cells.set(key, [...(cells.get(key) ?? []), n]);
  }

  const placed: Placed[] = [];
  let maxRow = 0;
  for (const [key, members] of cells) {
    const [limb, rowStr] = key.split("::");
    const row = Number(rowStr);
    maxRow = Math.max(maxRow, row);
    const col = limbIndex.get(limb) ?? 0;
    members.forEach((n, i) => {
      placed.push({
        node: n,
        x: PAD_X + col * COL_W + (i - (members.length - 1) / 2) * 80,
        y: PAD_Y + row * ROW_H,
        labelDy: members.length > 1 ? (i % 2) * 13 : 0,
      });
    });
  }

  return {
    placed,
    w: PAD_X * 2 + Math.max(limbs.length - 1, 0) * COL_W,
    h: PAD_Y * 2 + maxRow * ROW_H,
  };
}

export type NodeState = "taken" | "reachable" | "locked";

export default function TreeWeb({
  nodes,
  edges,
  stateFor,
  onNodeClick,
}: {
  nodes: SkillNode[];
  edges: SkillEdge[];
  /** Visual state per node; omit for a neutral (editor) rendering. */
  stateFor?: (n: SkillNode) => NodeState;
  onNodeClick?: (n: SkillNode) => void;
}) {
  if (nodes.length === 0) {
    return (
      <div className="font-accent px-5 py-12 text-center text-[15px] italic text-cream-muted">
        The web is unwoven — no powers yet.
      </div>
    );
  }

  const { placed, w, h } = layout(nodes, edges);
  const pos = new Map(placed.map((p) => [p.node.id, p]));
  const limbs = [...new Set(nodes.map((n) => n.limb || ""))].sort();

  function fill(state: NodeState): string {
    if (state === "taken") return "#e0a94e";
    if (state === "reachable") return "#2a1a0d";
    return "#221507";
  }
  function stroke(n: SkillNode, state: NodeState): string {
    if (state === "taken") return "#f3e6c8";
    if (state === "reachable") return "#ecc673";
    return n.rarity === "keystone" ? "#9e3b34" : "#5a4a30";
  }

  return (
    // Phones: the web scales into a 55svh budget (see .tree-web-svg), so the
    // whole card fits the screen — vertical swipes scroll the page, horizontal
    // swipes pan the web. Desktop renders at native size.
    <div className="overflow-x-auto overflow-y-hidden">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="tree-web-svg mx-auto block"
        style={{ "--web-h": `${h}px` } as CSSProperties}
      >
        {/* limb labels */}
        {limbs.map((l, i) => (
          <text
            key={l || "(web)"}
            x={PAD_X + i * COL_W}
            y={34}
            textAnchor="middle"
            style={{
              fill: "#a87f3a",
              font: "700 11px Cinzel, serif",
              letterSpacing: "2.5px",
              textTransform: "uppercase",
            }}
          >
            {(l || "the web").toUpperCase()}
          </text>
        ))}

        {/* edges */}
        {edges.map((e, i) => {
          const a = pos.get(e.a);
          const b = pos.get(e.b);
          if (!a || !b) return null;
          const lit =
            stateFor &&
            stateFor(a.node) === "taken" &&
            stateFor(b.node) === "taken";
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={lit ? "rgba(236,198,115,.8)" : "rgba(201,169,107,.28)"}
              strokeWidth={lit ? 2.5 : 1.5}
            />
          );
        })}

        {/* nodes */}
        {placed.map(({ node, x, y, labelDy }) => {
          const state: NodeState = stateFor ? stateFor(node) : "locked";
          const r = node.rarity === "keystone" ? 24 : 15;
          const clickable = !!onNodeClick;
          return (
            <g
              key={node.id}
              transform={`translate(${x} ${y})`}
              onClick={clickable ? () => onNodeClick!(node) : undefined}
              style={{ cursor: clickable ? "pointer" : "default" }}
            >
              <title>
                {node.name}
                {node.rarity === "keystone" ? " (Keystone)" : ""}
              </title>
              {node.rarity === "keystone" && (
                <circle
                  r={r + 6}
                  fill="none"
                  stroke={stroke(node, state)}
                  strokeWidth={1.2}
                  opacity={0.7}
                />
              )}
              <circle
                r={r}
                fill={fill(state)}
                stroke={stroke(node, state)}
                strokeWidth={state === "reachable" ? 2.5 : 1.8}
                opacity={state === "locked" ? 0.75 : 1}
              />
              {node.isEntry && state !== "taken" && (
                <circle r={3} fill={stroke(node, state)} />
              )}
              {state === "taken" && (
                <path
                  d="M -5 0 L -1.5 4 L 6 -5"
                  fill="none"
                  stroke="#2a1705"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              <text
                y={r + 16 + labelDy}
                textAnchor="middle"
                style={{
                  fill: state === "locked" ? "#8f7a55" : "#e6d5af",
                  font: "600 10.5px Cinzel, serif",
                  letterSpacing: ".5px",
                }}
              >
                {node.name.length > 18 ? `${node.name.slice(0, 17)}…` : node.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
