import type { RulesContent } from "../../api/client";
import SectionLabel from "./SectionLabel";

/*
The class table — the numbers the rules keep pointing at but never print (#129).

Reported as "Rogue sneak and other similar features are missing". They were not
missing from the Features list: "Sneak Attack" was there with its whole rules
text. What was missing is the only part a player needs mid-turn — *how many
dice*. The text says "see the Sneak Attack column of the Rogue table", and there
was no table.

#137 put those columns in the content (`data.featuresTable`, one entry per
column with a value for each of the twenty levels). This prints them, with the
hero's own level called out first, because at the table the question is "what is
mine right now" and only then "what do I get next".
*/

interface TableColumn {
  name?: string;
  values?: string[];
}

export function classTableOf(klass: RulesContent | undefined): TableColumn[] {
  const cols = (klass?.data as { featuresTable?: TableColumn[] } | undefined)?.featuresTable;
  return (cols ?? []).filter((c) => c.name && c.values?.length);
}

/** What this hero has right now, per column. Levels are 1-based, the array is not. */
export function valuesAtLevel(cols: TableColumn[], level: number): Array<[string, string]> {
  const i = Math.min(Math.max(level, 1), 20) - 1;
  return cols
    .map((c) => [c.name!, c.values?.[i] ?? ""] as [string, string])
    .filter(([, v]) => v !== "" && v !== "—");
}

export default function ClassTablePanel({
  klass,
  level,
}: {
  klass: RulesContent | undefined;
  level: number;
}) {
  const cols = classTableOf(klass);
  if (cols.length === 0) return null;
  const mine = valuesAtLevel(cols, level);
  const rows = Array.from({ length: 20 }, (_, i) => i + 1);

  return (
    <section>
      <SectionLabel>{klass?.name ? `${klass.name} Table` : "Class Table"}</SectionLabel>
      <div className="parchment px-4 py-3.5">
        {/* What is mine right now — the answer to the actual question. */}
        {mine.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {mine.map(([name, value]) => (
              <span
                key={name}
                title={`Your ${name} at level ${level}`}
                className="flex items-baseline gap-1.5 rounded-[2px] px-2.5 py-1.5"
                style={{ background: "rgba(139,37,32,.10)", boxShadow: "inset 0 0 0 1px rgba(139,37,32,.3)" }}
              >
                <span className="label-stamp text-[9px] tracking-[1px] text-ink-label">{name}</span>
                <span className="font-heading text-[14px] font-bold tabular-nums text-ink">{value}</span>
              </span>
            ))}
          </div>
        )}

        {/* And the rest of the road, so levelling up is not a surprise. */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                <th className="label-stamp px-1.5 py-1 text-left text-[8px] tracking-[1.5px] text-ink-label">
                  Lvl
                </th>
                {cols.map((c) => (
                  <th
                    key={c.name}
                    className="label-stamp px-1.5 py-1 text-left text-[8px] tracking-[1.5px] text-ink-label"
                  >
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((lvl) => {
                const here = lvl === Math.min(Math.max(level, 1), 20);
                return (
                  <tr
                    key={lvl}
                    style={here ? { background: "rgba(139,37,32,.12)" } : undefined}
                    className={here ? "font-semibold text-ink" : "text-ink-body"}
                  >
                    <td className="px-1.5 py-[3px] tabular-nums">{lvl}</td>
                    {cols.map((c) => (
                      <td key={c.name} className="px-1.5 py-[3px] tabular-nums">
                        {c.values?.[lvl - 1] ?? ""}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
