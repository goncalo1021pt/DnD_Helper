import type { ReactNode } from "react";
import type { RulesContent } from "../../api/client";
import { IconConcentration, IconRitual } from "./icons";

/**
 * A spell's full entry, rendered from rules content: the facts line and the
 * exact SRD (or homebrew) description text. The description is stored as
 * light markdown — paragraphs, **bold**, _italic_, and the odd stat-block
 * table — rendered here without a markdown dependency.
 */

interface SpellData {
  level?: number;
  school?: string;
  classes?: string[];
  castingTime?: string;
  range?: string;
  components?: string;
  duration?: string;
  description?: string;
  concentration?: boolean;
  ritual?: boolean;
  book?: string;
}

function inline(text: string): ReactNode[] {
  // **bold** and _italic_, non-nested — enough for SRD prose.
  return text.split(/(\*\*[^*]+\*\*|_[^_]+_)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("_") && part.endsWith("_"))
      return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

export function Blocks({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n\n+/).map((block, i) => {
        if (block.trimStart().startsWith("|")) {
          const rows = block
            .trim()
            .split("\n")
            .filter((r) => r.trim().startsWith("|"))
            .map((r) =>
              r.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()),
            )
            .filter((cells) => !cells.every((c) => /^:?-{2,}:?$/.test(c)));
          if (rows.length === 0) return null;
          const [head, ...body] = rows;
          return (
            <div key={i} className="my-2 overflow-x-auto" data-ok-overflow>
              <table className="w-full border-collapse text-[12px] leading-snug">
                <thead>
                  <tr>
                    {head.map((c, j) => (
                      <th
                        key={j}
                        className="font-heading px-2 py-1 text-left align-bottom font-bold"
                        style={{ borderBottom: "1px solid rgba(90,60,20,.4)" }}
                      >
                        {inline(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.map((r, k) => (
                    <tr key={k}>
                      {r.map((c, j) => (
                        <td
                          key={j}
                          className="px-2 py-1 align-top"
                          style={{ borderBottom: "1px solid rgba(90,60,20,.15)" }}
                        >
                          {inline(c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (block.startsWith("####") || block.startsWith("##")) {
          return (
            <div key={i} className="font-heading mt-2 text-[13px] font-bold">
              {block.replace(/^#+ /, "")}
            </div>
          );
        }
        return (
          <p key={i} className="m-0 mt-2 first:mt-0">
            {inline(block)}
          </p>
        );
      })}
    </>
  );
}

/** Inline concentration/ritual badges with native tooltips. */
export function SpellFlags({ spell }: { spell: RulesContent }) {
  const d = spell.data as SpellData;
  if (!d.concentration && !d.ritual) return null;
  return (
    <span className="ml-1.5 inline-flex translate-y-[1.5px] gap-1 text-ink-label">
      {d.concentration && (
        <span title="Concentration" className="inline-flex">
          <IconConcentration size={12} strokeWidth={2} />
        </span>
      )}
      {d.ritual && (
        <span title="Ritual" className="inline-flex">
          <IconRitual size={12} strokeWidth={2} />
        </span>
      )}
    </span>
  );
}

export function spellLevelText(d: SpellData): string {
  return d.level === 0 ? `${d.school} Cantrip` : `Level ${d.level} ${d.school}`;
}

export default function SpellEntry({
  spell,
  compact = false,
}: {
  spell: RulesContent;
  compact?: boolean;
}) {
  const d = spell.data as SpellData;
  return (
    <div className={compact ? "text-[12px]" : "text-[13px]"}>
      <div className="font-display text-[15px] font-bold leading-tight text-ink">
        {spell.name}
        {spell.source === "homebrew" && (
          <span className="label-stamp ml-2 text-[8px] tracking-[1px] text-ink-label">
            Homebrew{spell.creatorName ? ` · ${spell.creatorName}` : ""}
          </span>
        )}
      </div>
      <div className="font-accent mt-0.5 text-[11.5px] italic text-ink-body">
        {spellLevelText(d)}
        {(d.classes ?? []).length > 0 && ` · ${(d.classes ?? []).join(", ")}`}
      </div>
      <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11.5px] text-ink-body">
        {(
          [
            ["Casting", d.castingTime],
            ["Range", d.range],
            ["Components", d.components],
            ["Duration", d.duration],
            ["Source", d.book],
          ] as Array<[string, string | undefined]>
        ).map(([label, value]) =>
          value ? (
            <div key={label} className="contents">
              <span className="label-stamp text-[8.5px] tracking-[1px] text-ink-label">
                {label}
              </span>
              <span>{value}</span>
            </div>
          ) : null,
        )}
      </div>
      {d.description && (
        <div
          className={`mt-2.5 leading-relaxed text-ink-body ${compact ? "max-h-[45vh] overflow-y-auto pr-1" : ""}`}
        >
          <Blocks text={d.description} />
        </div>
      )}
    </div>
  );
}
