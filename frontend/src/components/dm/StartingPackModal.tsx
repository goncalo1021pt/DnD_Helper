/*
A hero's starting gear, handed out by the DM (#390).

The Forge gives nothing; a hero sits down with an empty pack and the DM hands
them their start through the gift door (#394) — the class's A or B, the
background's kit or its 50 gp, or a pack the table wrote. The DM asks the player
across the table and clicks; a choose-one line ("a musical instrument of your
choice") is settled here too. An equipment pack in a kit arrives as what is in
it — the server unpacks it, so this dialog only names it.

Books first, custom second. The dialog fills nothing in until the DM chooses,
and says so when this hero has been given a start before.
*/

import { useMemo, useState } from "react";
import type { Character, CustomPack, StartingPackOption } from "../../api/client";
import { useGiveGift, useStartingPacks } from "../../hooks";
import ParchmentModal from "../ui/ParchmentModal";

type Kind = "book" | "custom";

/** One radio row: a label, what is in it, and what it pays. */
function Row({
  on,
  onPick,
  title,
  children,
}: {
  on: boolean;
  onPick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className="w-full cursor-pointer rounded-[2px] border-none px-3 py-2 text-left text-[12.5px] text-ink-body"
      style={{
        background: on ? "rgba(139,37,32,.12)" : "rgba(120,86,42,.08)",
        boxShadow: `inset 0 0 0 1px ${on ? "rgba(139,37,32,.45)" : "rgba(120,80,30,.2)"}`,
      }}
    >
      <strong className="font-heading text-ink">{title}</strong>
      <div className="text-[11.5px] leading-snug">{children}</div>
    </button>
  );
}

/** "Chain Mail, 8× Javelin, Musical Instrument, 4 gp" — what an option holds. */
function summary(opt: StartingPackOption): string {
  const parts = opt.lines.map((l) => (l.qty > 1 ? `${l.qty}× ${l.name}` : l.name));
  if (opt.coin) parts.push(opt.coin);
  return parts.join(", ") || "Nothing";
}

export default function StartingPackModal({
  campaignId,
  hero,
  onClose,
}: {
  campaignId: string;
  hero: Character;
  onClose: () => void;
}) {
  const { data: packs, isLoading } = useStartingPacks(hero.id);
  const give = useGiveGift(campaignId);
  const [kind, setKind] = useState<Kind>("book");
  const [classLabel, setClassLabel] = useState<string | null>(null);
  const [bgLabel, setBgLabel] = useState<string | null>(null);
  const [customId, setCustomId] = useState<string | null>(null);
  // Each choose-one line's pick, by "<option>:<line index>".
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [announce, setAnnounce] = useState(true);

  const classOpt = packs?.classOptions.find((o) => o.label === classLabel);
  const bgOpt = packs?.backgroundOptions.find((o) => o.label === bgLabel);
  const custom: CustomPack | undefined = packs?.custom.find((c) => c.id === customId);

  // The chosen options, with each choose-one line's pick resolved.
  const chosen = useMemo(() => {
    const out: Array<{ opt: StartingPackOption; key: string }> = [];
    if (kind === "book") {
      if (classOpt) out.push({ opt: classOpt, key: `class:${classOpt.label}` });
      if (bgOpt) out.push({ opt: bgOpt, key: `bg:${bgOpt.label}` });
    }
    return out;
  }, [kind, classOpt, bgOpt]);

  const unsettled = chosen.some(({ opt, key }) =>
    opt.lines.some((l, i) => l.choose && !picks[`${key}:${i}`]),
  );

  const label =
    kind === "custom"
      ? custom?.name ?? ""
      : [
          classOpt ? `${packs?.className} ${classOpt.label}` : "",
          bgOpt ? `${packs?.backgroundName ?? "Background"} ${bgOpt.label === "A" ? "kit" : bgOpt.coin ?? bgOpt.label}` : "",
        ]
          .filter(Boolean)
          .join(" + ");

  const ready = kind === "custom" ? !!custom : chosen.length > 0 && !unsettled;

  function submit() {
    const items: Array<{ contentId?: string; name?: string; qty: number }> = [];
    const coins: string[] = [];
    if (kind === "custom" && custom) {
      for (const it of custom.items) {
        items.push(it.contentId ? { contentId: it.contentId, qty: it.qty ?? 1 } : { name: it.name, qty: it.qty ?? 1 });
      }
      if (custom.coin) coins.push(custom.coin);
    } else {
      for (const { opt, key } of chosen) {
        opt.lines.forEach((l, i) => {
          if (l.choose) {
            const pick = l.choose.find((c) => c.name === picks[`${key}:${i}`]);
            items.push(pick?.contentId ? { contentId: pick.contentId, qty: l.qty } : { name: pick?.name ?? picks[`${key}:${i}`], qty: l.qty });
          } else {
            items.push(l.contentId ? { contentId: l.contentId, qty: l.qty } : { name: l.name, qty: l.qty });
          }
        });
        if (opt.coin) coins.push(opt.coin);
      }
    }
    give.mutate(
      {
        heroIds: [hero.id],
        items: items.length ? items : undefined,
        coin: coins.length ? coins.join(", ") : undefined,
        startingPack: label,
        announce,
      },
      { onSuccess: onClose },
    );
  }

  const options = (
    title: string,
    who: string,
    list: StartingPackOption[],
    pick: string | null,
    set: (l: string | null) => void,
    scope: string,
  ) => (
    <div className="mb-3" role="radiogroup" aria-label={title}>
      <div className="field-label mb-1.5">{title}</div>
      <div className="flex flex-col gap-1.5">
        {list.map((o) => (
          <div key={o.label}>
            <Row on={pick === o.label} onPick={() => set(o.label)} title={`${who} ${o.label}`.trim()}>
              {summary(o)}
            </Row>
            {pick === o.label &&
              o.lines.map(
                (l, i) =>
                  l.choose && (
                    <label key={i} className="mt-1 flex items-center gap-2 pl-3 text-[12px] text-ink-body">
                      <span className="text-[11px] italic">{l.name}:</span>
                      <select
                        className="input-parchment input-compact min-w-0 flex-1 cursor-pointer text-[12px]"
                        value={picks[`${scope}:${o.label}:${i}`] ?? ""}
                        aria-label={l.name}
                        onChange={(e) => setPicks((prev) => ({ ...prev, [`${scope}:${o.label}:${i}`]: e.target.value }))}
                      >
                        <option value="">Choose…</option>
                        {l.choose.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ),
              )}
          </div>
        ))}
        <Row on={pick === null} onPick={() => set(null)} title="None">
          Nothing from this.
        </Row>
      </div>
    </div>
  );

  return (
    <ParchmentModal onClose={onClose} maxWidth="max-w-[580px]">
      <div className="label-stamp mb-1.5 text-center text-[11px] tracking-[4px] text-ink-label">{hero.name}</div>
      <h3 className="font-display m-0 mb-3 text-center text-2xl font-bold text-ink">Starting pack</h3>

      {packs?.givenAt && (
        <p className="font-accent m-0 mb-3 rounded-[2px] px-3 py-2 text-center text-[12.5px] italic text-ink-body" style={{ background: "rgba(139,37,32,.08)", boxShadow: "inset 0 0 0 1px rgba(139,37,32,.3)" }}>
          {hero.name} was given a starting pack on {new Date(packs.givenAt).toLocaleDateString()}. You can give another.
        </p>
      )}

      {isLoading && <div className="font-accent py-6 text-center text-[13px] italic text-ink-body">Reading the books…</div>}

      {packs && (
        <>
          <div className="mb-3 flex gap-2">
            {(["book", "custom"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`btn-base ${kind === k ? "btn-gold" : "btn-ghost-ink"} px-4 py-2 text-[11px]`}
              >
                {k === "book" ? "From the books" : "Custom pack"}
              </button>
            ))}
          </div>

          {kind === "book" && (
            <>
              {packs.classOptions.length > 0
                ? options("Class kit", packs.className, packs.classOptions, classLabel, setClassLabel, "class")
                : <p className="font-accent text-[12.5px] italic text-ink-body">This class has no starting options on file.</p>}
              {packs.backgroundOptions.length > 0 &&
                options("Background kit", packs.backgroundName ?? "Background", packs.backgroundOptions, bgLabel, setBgLabel, "bg")}
            </>
          )}

          {kind === "custom" && (
            <div className="mb-3" role="radiogroup" aria-label="Custom pack">
              {packs.custom.length === 0 ? (
                <p className="font-accent text-[12.5px] italic text-ink-body">
                  This table has no packs of its own yet. Write one under Starting packs in the DM menu.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {packs.custom.map((c) => (
                    <Row key={c.id} on={customId === c.id} onPick={() => setCustomId(c.id)} title={c.name}>
                      {[...c.items.map((i) => ((i.qty ?? 1) > 1 ? `${i.qty}× ${i.name}` : i.name)), ...(c.coin ? [c.coin] : [])].join(", ")}
                    </Row>
                  ))}
                </div>
              )}
            </div>
          )}

          <label className="mb-4 flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-body">
            <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} />
            Tell the table in the Chronicle
          </label>
        </>
      )}

      <div className="flex items-center justify-end gap-3">
        <button onClick={onClose} className="btn-base btn-ghost-ink px-5 py-[11px] text-xs">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!ready || give.isPending}
          className="btn-base btn-gold clip-octagon h-10 px-6 text-xs"
        >
          {give.isPending ? "Giving…" : "Give"}
        </button>
      </div>
    </ParchmentModal>
  );
}
