import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRollInTheOpen } from "../../hooks";
import {
  DIE_SIDES,
  MAX_DICE,
  diceExpression,
  facesOf,
  poolIsRollable,
  rollPool,
  type DicePool,
  type PoolResult,
} from "../../lib/dice";
import { IconDie, IconX } from "./icons";

/**
 * The Dice Tower. `DiceTowerPanel` is the tray itself — embedded as a
 * dashboard block. `FloatingDiceTray` (default) wraps it in a corner
 * button + pop-up for the solo pages, so dice stay one click away mid-game.
 *
 * A roll is a *pool* (#176): tap d6 six times for a fireball, add a d4 and a
 * d8 for whatever the DM just invented, roll the lot at once. A pool is built
 * in the moment and never saved — a combo is what this spell needs right now,
 * not a thing to name and keep.
 *
 * Given a campaign, the tower can also roll **in the open**: the server rolls
 * that one and writes it into the chronicle for the whole table to read. The
 * private roll stays here in the browser, which is the point of the toggle.
 */

const COIN = 2;

function dieLabel(sides: number): string {
  return sides === COIN ? "Coin" : `d${sides}`;
}

function signed(n: number): string {
  return n < 0 ? `−${Math.abs(n)}` : `+${n}`;
}

function rollColor(r: { crit: boolean; fail: boolean }): string {
  if (r.crit) return "#4d6b39";
  if (r.fail) return "#8b2520";
  return "#2e1d0f";
}

/** A coin is a d2; the tower calls its faces by name. */
function isCoinFlip(r: PoolResult): boolean {
  return r.groups.length === 1 && r.groups[0].sides === COIN && r.groups[0].results.length === 1;
}

interface HistoryLine {
  expression: string;
  total: number;
  crit: boolean;
  fail: boolean;
  open: boolean;
  coin: PoolResult | null;
}

export function DiceTowerPanel({
  onClose,
  campaignId,
}: {
  onClose?: () => void;
  campaignId?: string;
}) {
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [mod, setMod] = useState(0);
  const [inTheOpen, setInTheOpen] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [result, setResult] = useState<PoolResult | null>(null);
  const [wasOpen, setWasOpen] = useState(false);
  const [refusal, setRefusal] = useState("");
  const [history, setHistory] = useState<HistoryLine[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const openRoll = useRollInTheOpen(campaignId ?? "");

  const groups = DIE_SIDES.filter((s) => (counts[s] ?? 0) > 0).map((sides) => ({
    sides,
    count: counts[sides],
  }));
  const pool: DicePool = { groups, modifier: mod };
  const expression = diceExpression(pool);
  const diceCount = groups.reduce((n, g) => n + g.count, 0);
  const rollable = poolIsRollable(pool);

  function add(sides: number) {
    setCounts((c) => {
      const total = Object.values(c).reduce((n, v) => n + v, 0);
      if (total >= MAX_DICE) return c;
      return { ...c, [sides]: (c[sides] ?? 0) + 1 };
    });
  }

  function drop(sides: number) {
    setCounts((c) => {
      const next = { ...c, [sides]: (c[sides] ?? 0) - 1 };
      if (next[sides] <= 0) delete next[sides];
      return next;
    });
  }

  function clearPool() {
    setCounts({});
    setMod(0);
  }

  function remember(line: HistoryLine) {
    setHistory((h) => [line, ...h].slice(0, 7));
  }

  function roll() {
    if (rolling || !rollable) return;
    setRefusal("");
    setRolling(true);
    clearTimeout(timer.current);

    // In the open, the server is the one that rolls — a shared log that takes
    // the roller's word for the number is not a record of anything. The tumble
    // still plays, so both kinds of roll feel the same in the hand.
    if (inTheOpen && campaignId) {
      openRoll.mutate(
        { groups, modifier: mod },
        {
          onSuccess: (data) => {
            timer.current = setTimeout(() => {
              const r = data as PoolResult;
              setResult(r);
              setWasOpen(true);
              remember({ ...r, open: true, coin: isCoinFlip(r) ? r : null });
              setRolling(false);
            }, 220);
          },
          onError: () => {
            setRolling(false);
            setRefusal("the table did not hear that roll — try again");
          },
        },
      );
      return;
    }

    timer.current = setTimeout(() => {
      const r = rollPool(pool);
      if (r) {
        setResult(r);
        setWasOpen(false);
        remember({ ...r, open: false, coin: isCoinFlip(r) ? r : null });
      }
      setRolling(false);
    }, 480);
  }

  return (
    <div className="parchment px-5 pb-5 pt-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="label-stamp text-[11px] font-bold tracking-[3px] text-ink-label">
          The Dice Tower
        </span>
        {onClose && (
          <button
            onClick={onClose}
            title="Close"
            className="inline-flex cursor-pointer border-none bg-transparent p-1 text-ink-faded hover:text-ink"
          >
            <IconX size={18} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* result face */}
      <div
        className="mb-3 flex h-[104px] flex-col items-center justify-center rounded-[2px] px-3"
        style={{
          background: "rgba(120,86,42,.1)",
          boxShadow: "inset 0 0 0 1px rgba(120,80,30,.3)",
        }}
      >
        {rolling ? (
          <>
            <div className="anim-shake font-heading text-[40px] font-bold leading-none text-ink-label">
              ?
            </div>
            <div className="font-accent mt-1 text-[12.5px] italic text-ink-label">
              The dice tumble…
            </div>
          </>
        ) : result ? (
          <>
            <div
              key={`${result.total}-${history.length}`}
              className="anim-pop font-heading text-[44px] font-bold leading-none tabular-nums"
              style={{ color: rollColor(result) }}
            >
              {isCoinFlip(result)
                ? result.groups[0].results[0] === 1
                  ? "Heads"
                  : "Tails"
                : result.total}
            </div>
            <div className="font-accent mt-1 text-center text-[12.5px] italic text-ink-body">
              {result.crit
                ? "Critical! Natural 20"
                : result.fail
                  ? "Critical miss — natural 1"
                  : isCoinFlip(result)
                    ? "The coin has spoken"
                    : `${result.expression}: ${facesOf(result)}`}
              {wasOpen && (
                <span className="label-stamp ml-1.5 text-[8px] tracking-[1px] text-[#8b2520]">
                  in the open
                </span>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="font-heading text-[40px] font-bold leading-none text-[#b8a67f]">
              —
            </div>
            <div className="font-accent mt-1 text-[12.5px] italic text-ink-label">
              Tap dice to build a roll
            </div>
          </>
        )}
      </div>

      {/* the pool being built */}
      <div className="mb-2.5 flex min-h-[26px] flex-wrap items-center gap-1.5">
        {groups.length === 0 ? (
          <span className="font-accent text-[11.5px] italic text-ink-label">
            No dice in the pool yet
          </span>
        ) : (
          <>
            {groups.map((g) => (
              <button
                key={g.sides}
                onClick={() => drop(g.sides)}
                title={`Take one ${dieLabel(g.sides)} out`}
                aria-label={`Remove a ${dieLabel(g.sides)}`}
                className="rounded-[2px] border-none px-2 py-1 text-[11px] font-semibold tabular-nums"
                style={{
                  cursor: "pointer",
                  color: "#4a3320",
                  background: "rgba(124,90,46,.14)",
                  boxShadow: "inset 0 0 0 1px rgba(120,80,30,.4)",
                }}
              >
                {g.count}
                {dieLabel(g.sides) === "Coin" ? " × Coin" : `d${g.sides}`} ×
              </button>
            ))}
            <button
              onClick={clearPool}
              className="font-accent border-none bg-transparent p-0 text-[11px] italic text-ink-faded underline hover:text-ink"
              style={{ cursor: "pointer" }}
            >
              clear
            </button>
          </>
        )}
      </div>

      {/* die selector — tapping adds one to the pool */}
      <div className="mb-3 grid grid-cols-4 gap-1.5">
        {DIE_SIDES.map((d) => (
          <button
            key={d}
            onClick={() => add(d)}
            aria-label={`Add a ${dieLabel(d)}`}
            className={`btn-base h-9 text-[11px] ${
              (counts[d] ?? 0) > 0 ? "btn-wax" : "btn-ghost-ink"
            }`}
          >
            {dieLabel(d)}
          </button>
        ))}
      </div>

      {/* modifier + roll */}
      <div className="mb-2 flex items-center gap-2">
        <button
          onClick={() => setMod((m) => Math.max(m - 1, -20))}
          title="Lower modifier"
          className="btn-base btn-ghost-ink h-9 w-10 text-base"
        >
          −
        </button>
        <span className="font-heading w-12 text-center text-sm font-bold tabular-nums text-ink-value">
          {signed(mod)}
        </span>
        <button
          onClick={() => setMod((m) => Math.min(m + 1, 20))}
          title="Raise modifier"
          className="btn-base btn-ghost-ink h-9 w-10 text-base"
        >
          +
        </button>
        <button
          onClick={roll}
          disabled={rolling || !rollable}
          className="btn-base btn-wax clip-octagon h-10 flex-1 text-xs"
        >
          {expression ? `Roll ${expression}` : "Roll"}
        </button>
      </div>

      {diceCount >= MAX_DICE && (
        <p className="font-body m-0 mb-2 text-[11.5px] italic text-[#8b2520]">
          A hundred dice is all the tower holds.
        </p>
      )}
      {refusal && (
        <p role="status" className="font-body m-0 mb-2 text-[11.5px] italic text-[#8b2520]">
          {refusal}
        </p>
      )}

      {/* in the open — only where there is a table to see it */}
      {campaignId && (
        <label className="mb-1 flex cursor-pointer items-center gap-2 text-[11.5px] text-ink-body">
          <input
            type="checkbox"
            checked={inTheOpen}
            onChange={(e) => setInTheOpen(e.target.checked)}
            className="cursor-pointer"
          />
          <span>
            Roll in the open
            <span className="font-accent ml-1 italic text-ink-faded">
              — the table sees it in the chronicle
            </span>
          </span>
        </label>
      )}

      {/* history */}
      {history.length > 0 && (
        <>
          <div className="torn-divider mb-2.5 mt-2" />
          <div className="flex flex-wrap gap-1.5">
            {history.map((r, i) => (
              <span
                key={i}
                title={`${r.expression}${r.open ? " · rolled in the open" : ""}`}
                className="rounded-[2px] px-2 py-1 text-[11px] font-semibold tabular-nums"
                style={{
                  color: r.crit ? "#2e4221" : r.fail ? "#5e1611" : "#4a3320",
                  background: r.crit
                    ? "rgba(77,107,57,.16)"
                    : r.fail
                      ? "rgba(139,37,32,.12)"
                      : "rgba(124,90,46,.1)",
                  boxShadow: `inset 0 0 0 1px ${
                    r.crit
                      ? "rgba(77,107,57,.45)"
                      : r.fail
                        ? "rgba(139,37,32,.4)"
                        : "rgba(120,80,30,.35)"
                  }`,
                }}
              >
                {r.open && "◈ "}
                {r.coin
                  ? `Coin › ${r.coin.groups[0].results[0] === 1 ? "H" : "T"}`
                  : `${r.expression} › ${r.total}`}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Corner-button variant for the solo pages (board, party) and the forge.
 * Rendered through a portal to <body> so it shares the root stacking context
 * with the modals (which also portal there); otherwise it stays trapped inside
 * the page's transformed/z-indexed <main> and a modal paints over it — leaving
 * the dice unreachable exactly when you need them, e.g. rolling HP on level-up.
 *
 * `campaignId` is what turns on rolling in the open, so the forge and the
 * hero list — which belong to no table — simply never offer it.
 */
export default function FloatingDiceTray({ campaignId }: { campaignId?: string }) {
  const [open, setOpen] = useState(false);

  const node = !open ? (
    <button
      onClick={() => setOpen(true)}
      title="Open the dice tower"
      className="btn-base btn-gold clip-octagon fixed bottom-6 right-6 z-[70] h-12 w-14"
    >
      <IconDie size={22} strokeWidth={1.8} />
    </button>
  ) : (
    <div className="anim-rise-fast fixed bottom-6 right-6 z-[70] w-[330px] max-w-[calc(100vw-3rem)]">
      <DiceTowerPanel onClose={() => setOpen(false)} campaignId={campaignId} />
    </div>
  );

  return createPortal(node, document.body);
}
