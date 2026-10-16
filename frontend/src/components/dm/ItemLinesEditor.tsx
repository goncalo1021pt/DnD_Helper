/*
Items for a gift or a pack (#394, #390): search the armory or write one in, set
how many. Shared by the Give dialog and the pack editor, so a line reads the same
in both. Controlled — the caller holds the lines.
*/

import { useMemo, useState } from "react";
import { useRules } from "../../hooks";

export interface Line {
  key: string;
  contentId?: string;
  name: string;
  qty: number;
}

const field = "input-parchment input-compact";

export default function ItemLinesEditor({
  lines,
  onChange,
}: {
  lines: Line[];
  onChange: (lines: Line[]) => void;
}) {
  const { data: armory } = useRules("item");
  const [search, setSearch] = useState("");
  const [written, setWritten] = useState("");

  const found = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    return (armory ?? []).filter((i) => i.name.toLowerCase().includes(q)).slice(0, 8);
  }, [armory, search]);

  const add = (line: { contentId?: string; name: string }) => {
    const same = lines.find((l) => (line.contentId ? l.contentId === line.contentId : !l.contentId && l.name === line.name));
    if (same) {
      onChange(lines.map((l) => (l === same ? { ...l, qty: Math.min(l.qty + 1, 999) } : l)));
    } else {
      onChange([...lines, { ...line, key: `${line.contentId ?? line.name}-${lines.length}`, qty: 1 }]);
    }
  };
  const setQty = (key: string, qty: number) =>
    onChange(lines.flatMap((l) => (l.key !== key ? [l] : qty < 1 ? [] : [{ ...l, qty: Math.min(qty, 999) }])));

  return (
    <>
      <input
        className={`${field} w-full`}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search the armory…"
      />
      {found.length > 0 && (
        <div className="mt-1 flex flex-col gap-1">
          {found.map((i) => (
            <button
              key={i.id}
              type="button"
              onClick={() => {
                add({ contentId: i.id, name: i.name });
                setSearch("");
              }}
              className="cursor-pointer rounded-[2px] border-none px-2.5 py-1.5 text-left text-[12.5px] text-ink-body"
              style={{ background: "rgba(120,86,42,.08)", boxShadow: "inset 0 0 0 1px rgba(120,80,30,.2)" }}
            >
              <strong className="font-heading text-ink">{i.name}</strong>
              {i.summary && <span className="ml-2 text-[11.5px] italic">{i.summary}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="mt-1.5 flex gap-2">
        <input
          className={`${field} min-w-0 flex-1`}
          value={written}
          onChange={(e) => setWritten(e.target.value)}
          maxLength={80}
          placeholder="…or write one in"
          onKeyDown={(e) => {
            if (e.key === "Enter" && written.trim()) {
              add({ name: written.trim() });
              setWritten("");
            }
          }}
        />
        <button
          type="button"
          disabled={!written.trim()}
          onClick={() => {
            add({ name: written.trim() });
            setWritten("");
          }}
          className="btn-base btn-ghost-ink px-3 text-[11px]"
        >
          Add
        </button>
      </div>
      {lines.length > 0 && (
        <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
          {lines.map((l) => (
            <li key={l.key} className="flex items-center gap-2 text-[12.5px] text-ink">
              <span className="min-w-0 flex-1 truncate font-heading font-bold">{l.name}</span>
              <button type="button" aria-label={`One fewer ${l.name}`} onClick={() => setQty(l.key, l.qty - 1)} className="btn-base btn-ghost-ink h-7 w-7 text-sm">−</button>
              <span className="w-7 text-center tabular-nums">{l.qty}</span>
              <button type="button" aria-label={`One more ${l.name}`} onClick={() => setQty(l.key, l.qty + 1)} className="btn-base btn-ghost-ink h-7 w-7 text-sm">+</button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
