
import { useEffect, useMemo, useRef, useState } from "react";
import { useAddCombatant, useRules } from "../../hooks";
import { QtyStepper } from "./QtyStepper";

/* Type-to-search monster picker — the Den holds hundreds, a dropdown won't do. */
export function MonsterSearch({ campaignId, encounterId }: { campaignId: string; encounterId: string }) {
  const add = useAddCombatant(campaignId, encounterId);
  const { data: monsters } = useRules("monster");
  const [q, setQ] = useState("");
  const [count, setCount] = useState(1);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return (monsters ?? []).filter((m) => m.name.toLowerCase().includes(term)).slice(0, 8);
  }, [q, monsters]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // One call with a count: the server makes them a single mob (one initiative,
  // one turn, numbered names). Firing N separate adds is what used to leave
  // five unrelated skeletons scattered through the order.
  function addMonster(id: string, name: string) {
    add.mutate({ kind: "monster", contentId: id, hidden: true, count });
    setQ(name);
    setOpen(false);
  }

  return (
    <>
      <div ref={boxRef} className="relative min-w-[180px] flex-1">
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search monsters by name…"
          className="input-hall h-9 w-full text-[12px]"
        />
        {open && matches.length > 0 && (
          <div
            className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-[240px] overflow-y-auto rounded-[4px] py-1"
            style={{ background: "#1c1108", boxShadow: "0 12px 30px rgba(0,0,0,.6), inset 0 0 0 1px rgba(201,162,39,.35)" }}
          >
            {matches.map((m) => (
              <button
                key={m.id}
                onClick={() => addMonster(m.id, m.name)}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[12.5px] text-cream-soft transition hover:bg-[rgba(201,162,39,.14)]"
              >
                <span className="font-heading">{m.name}</span>
                {m.source !== "srd" && <span className="label-stamp text-[8px] tracking-[1px] text-gold-muted">{(m.data as { book?: string })?.book ?? "homebrew"}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <QtyStepper value={count} onChange={setCount} />
      <span className="label-stamp text-[9px] tracking-[1px] text-gold-muted">added hidden</span>
    </>
  );
}
