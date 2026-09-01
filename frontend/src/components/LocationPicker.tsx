import { useEffect, useMemo, useRef, useState } from "react";
import type { Location } from "../api/client";
import { IconMapPin } from "./ui/icons";

/*
The place tree as a compact, searchable dropdown (#290).

The board and the quest form both used to spell the whole place tree out at
once — a wrapping wall of buttons on the board, a dash-indented <select> on the
form — and both stopped scaling the moment a world grew past a screen. This is
the one control that replaces them: a trigger showing the current place, and a
panel that opens onto a search box and a collapsible, indented tree. Type to
find a place anywhere in the world; the matching branch opens to its root so the
path is never lost.

It carries no notion of what "no place" means — the caller supplies the special
rows (the board wants "Everywhere" and "Unpinned"; the form wants "nowhere in
particular"), because only the caller knows whether an empty value filters to
all or files a notice under nothing.
*/

export type PlaceSpecial = { key: string; label: string };

const PALETTE = {
  hall: {
    panel: "#160d06",
    hair: "rgba(201,162,39,.35)",
    text: "#e6d5af",
    muted: "#9c855e",
    selBg: "rgba(201,162,39,.18)",
    selText: "#f4e6bf",
    hover: "rgba(201,162,39,.09)",
  },
  parchment: {
    panel: "#efe3c6",
    hair: "rgba(90,62,28,.45)",
    text: "#3a2a17",
    muted: "#7a5e34",
    selBg: "rgba(150,110,40,.24)",
    selText: "#2a1d0e",
    hover: "rgba(120,90,40,.12)",
  },
} as const;

function Caret({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .12s" }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function LocationPicker({
  locations,
  value,
  onChange,
  specials = [],
  showCounts = false,
  surface = "hall",
  block = false,
  className,
}: {
  locations: Location[];
  value: string;
  onChange: (key: string) => void;
  specials?: PlaceSpecial[];
  showCounts?: boolean;
  surface?: "hall" | "parchment";
  /** Fill the width of the container (a form field) rather than hug its label. */
  block?: boolean;
  className?: string;
}) {
  const c = PALETTE[surface];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on an outside press or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const byId = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  // Locations arrive parents-first; group each under its parent ("" = a root).
  const childrenOf = useMemo(() => {
    const m = new Map<string, Location[]>();
    for (const l of locations) {
      const p = l.parentId ?? "";
      (m.get(p) ?? m.set(p, []).get(p)!).push(l);
    }
    return m;
  }, [locations]);

  // A search keeps the matches AND their ancestors, so a hit deep in the tree
  // still shows the branch it lives on.
  const q = query.trim().toLowerCase();
  const matched = useMemo(() => {
    if (!q) return null;
    const keep = new Set<string>();
    for (const l of locations) {
      if (!l.name.toLowerCase().includes(q)) continue;
      keep.add(l.id);
      let cur: Location | undefined = l;
      while (cur?.parentId) {
        keep.add(cur.parentId);
        cur = byId.get(cur.parentId);
      }
    }
    return keep;
  }, [q, locations, byId]);

  const selectedLabel =
    specials.find((s) => s.key === value)?.label ?? byId.get(value)?.name ?? "Where";

  function choose(key: string) {
    onChange(key);
    setOpen(false);
    setQuery("");
  }
  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function Row({
    label,
    count,
    selected,
    indent,
    hasKids,
    isOpen,
    onCaret,
    onClick,
  }: {
    label: string;
    count?: number;
    selected: boolean;
    indent: number;
    hasKids?: boolean;
    isOpen?: boolean;
    onCaret?: () => void;
    onClick: () => void;
  }) {
    return (
      <div className="flex items-center" style={{ paddingLeft: 6 + indent * 15 }}>
        {hasKids ? (
          <button
            type="button"
            onClick={onCaret}
            className="flex h-6 w-5 flex-none items-center justify-center rounded-[2px]"
            style={{ color: c.muted }}
            aria-label={isOpen ? "Collapse" : "Expand"}
          >
            <Caret open={!!isOpen} />
          </button>
        ) : (
          <span className="w-5 flex-none" />
        )}
        <button
          type="button"
          onClick={onClick}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[2px] px-1.5 py-1.5 text-left text-[12px]"
          style={{
            color: selected ? c.selText : c.text,
            background: selected ? c.selBg : "transparent",
          }}
          onMouseEnter={(e) => {
            if (!selected) e.currentTarget.style.background = c.hover;
          }}
          onMouseLeave={(e) => {
            if (!selected) e.currentTarget.style.background = "transparent";
          }}
        >
          <IconMapPin size={12} strokeWidth={2} />
          <span className="truncate">{label}</span>
          {showCounts && count !== undefined && (
            <span className="ml-auto pl-2 text-[10px]" style={{ color: c.muted }}>
              {count}
            </span>
          )}
        </button>
      </div>
    );
  }

  function renderTree(l: Location): React.ReactNode {
    if (matched && !matched.has(l.id)) return null;
    const kids = childrenOf.get(l.id) ?? [];
    const hasKids = kids.length > 0;
    // A search forces every surviving branch open, so a match is never buried.
    const isOpen = q ? true : !collapsed.has(l.id);
    return (
      <div key={l.id}>
        <Row
          label={l.name}
          count={l.questCount}
          selected={value === l.id}
          indent={l.depth}
          hasKids={hasKids}
          isOpen={isOpen}
          onCaret={() => toggle(l.id)}
          onClick={() => choose(l.id)}
        />
        {hasKids && isOpen && kids.map(renderTree)}
      </div>
    );
  }

  const roots = childrenOf.get("") ?? [];

  return (
    <div
      ref={rootRef}
      className={`relative ${block ? "block w-full" : "inline-block"} ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-10 items-center gap-2 rounded-[2px] px-3.5 text-[12px] ${block ? "w-full" : ""}`}
        style={{
          color: c.text,
          background: surface === "hall" ? "rgba(16,9,5,.55)" : "rgba(255,255,255,.35)",
          boxShadow: `inset 0 0 0 1px ${c.hair}`,
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="flex-none">
          <IconMapPin size={14} strokeWidth={2} />
        </span>
        <span className={`min-w-0 truncate ${block ? "" : "max-w-[46vw] sm:max-w-[220px]"}`}>
          {selectedLabel}
        </span>
        <span className={`flex-none ${block ? "ml-auto pl-2" : ""}`} style={{ color: c.muted }}>
          <Caret open={open} />
        </span>
      </button>

      {open && (
        <div
          className={`absolute left-0 z-30 mt-1.5 ${block ? "w-full min-w-[240px]" : "w-[300px]"} max-w-[86vw] overflow-hidden rounded-[3px] py-1.5`}
          style={{
            background: c.panel,
            boxShadow: `inset 0 0 0 1px ${c.hair}, 0 12px 34px rgba(0,0,0,.55)`,
          }}
          role="listbox"
        >
          <div className="px-2 pb-1.5">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search places…"
              className="h-8 w-full rounded-[2px] px-2.5 text-[12px]"
              style={{
                color: c.text,
                background: surface === "hall" ? "rgba(0,0,0,.35)" : "rgba(255,255,255,.5)",
                boxShadow: `inset 0 0 0 1px ${c.hair}`,
                outline: "none",
              }}
            />
          </div>

          <div className="max-h-[46vh] overflow-y-auto px-1">
            {specials.map((s) => (
              <Row
                key={s.key || "empty"}
                label={s.label}
                selected={value === s.key}
                indent={0}
                onClick={() => choose(s.key)}
              />
            ))}
            {specials.length > 0 && roots.length > 0 && (
              <div className="my-1 h-px" style={{ background: c.hair }} />
            )}
            {roots.map(renderTree)}
            {q && matched && matched.size === 0 && (
              <div className="px-3 py-4 text-center text-[11px] italic" style={{ color: c.muted }}>
                — no place by that name —
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
