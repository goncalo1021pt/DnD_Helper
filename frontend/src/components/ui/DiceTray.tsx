import { useRef, useState } from "react";
import { IconDie, IconX } from "./icons";

/**
 * The Dice Tower. `DiceTowerPanel` is the tray itself — embedded as a
 * dashboard block. `FloatingDiceTray` (default) wraps it in a corner
 * button + pop-up for the solo pages, so dice stay one click away mid-game.
 * Pure client-side: d4–d100 plus a coin, modifier, d20 crit/fail call-outs,
 * and a short roll history.
 */

const COIN = 2;
const DICE = [4, 6, 8, 10, 12, 20, 100, COIN];

interface Roll {
  die: number;
  base: number;
  total: number;
  crit: boolean;
  fail: boolean;
}

function dieLabel(die: number): string {
  return die === COIN ? "Coin" : `d${die}`;
}

function signed(n: number): string {
  return n < 0 ? `−${Math.abs(n)}` : `+${n}`;
}

function rollColor(r: Roll): string {
  if (r.crit) return "#4d6b39";
  if (r.fail) return "#8b2520";
  return "#2e1d0f";
}

export function DiceTowerPanel({ onClose }: { onClose?: () => void }) {
  const [die, setDie] = useState(20);
  const [mod, setMod] = useState(0);
  const [rolling, setRolling] = useState(false);
  const [result, setResult] = useState<Roll | null>(null);
  const [history, setHistory] = useState<Roll[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function roll() {
    if (rolling) return;
    setRolling(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const base = 1 + Math.floor(Math.random() * die);
      const r: Roll = {
        die,
        base,
        total: die === COIN ? base : base + mod,
        crit: die === 20 && base === 20,
        fail: die === 20 && base === 1,
      };
      setResult(r);
      setHistory((h) => [r, ...h].slice(0, 7));
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
        className="mb-3.5 flex h-[104px] flex-col items-center justify-center rounded-[2px]"
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
              {result.die === COIN ? (result.base === 1 ? "Heads" : "Tails") : result.total}
            </div>
            <div className="font-accent mt-1 text-[12.5px] italic text-ink-body">
              {result.crit
                ? "Critical! Natural 20"
                : result.fail
                  ? "Critical miss — natural 1"
                  : result.die === COIN
                    ? "The coin has spoken"
                    : `d${result.die}: ${result.base} ${signed(result.total - result.base)}`}
            </div>
          </>
        ) : (
          <>
            <div className="font-heading text-[40px] font-bold leading-none text-[#b8a67f]">
              —
            </div>
            <div className="font-accent mt-1 text-[12.5px] italic text-ink-label">
              Choose a die and roll
            </div>
          </>
        )}
      </div>

      {/* die selector */}
      <div className="mb-3 grid grid-cols-4 gap-1.5">
        {DICE.map((d) => (
          <button
            key={d}
            onClick={() => setDie(d)}
            className={`btn-base h-9 text-[11px] ${
              die === d ? "btn-wax" : "btn-ghost-ink"
            }`}
          >
            {dieLabel(d)}
          </button>
        ))}
      </div>

      {/* modifier + roll */}
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={() => setMod((m) => Math.max(m - 1, -20))}
          disabled={die === COIN}
          title="Lower modifier"
          className="btn-base btn-ghost-ink h-9 w-10 text-base"
        >
          −
        </button>
        <span
          className={`font-heading w-12 text-center text-sm font-bold tabular-nums ${
            die === COIN ? "text-ink-label opacity-50" : "text-ink-value"
          }`}
        >
          {signed(mod)}
        </span>
        <button
          onClick={() => setMod((m) => Math.min(m + 1, 20))}
          disabled={die === COIN}
          title="Raise modifier"
          className="btn-base btn-ghost-ink h-9 w-10 text-base"
        >
          +
        </button>
        <button
          onClick={roll}
          disabled={rolling}
          className="btn-base btn-wax clip-octagon h-10 flex-1 text-xs"
        >
          Roll {dieLabel(die)}
        </button>
      </div>

      {/* history */}
      {history.length > 0 && (
        <>
          <div className="torn-divider mb-2.5" />
          <div className="flex flex-wrap gap-1.5">
            {history.map((r, i) => (
              <span
                key={i}
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
                {dieLabel(r.die)} › {r.die === COIN ? (r.base === 1 ? "H" : "T") : r.total}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Corner-button variant for the solo pages (board, party). */
export default function FloatingDiceTray() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Open the dice tower"
        className="btn-base btn-gold clip-octagon fixed bottom-6 right-6 z-40 h-12 w-14"
      >
        <IconDie size={22} strokeWidth={1.8} />
      </button>
    );
  }

  return (
    <div className="anim-rise-fast fixed bottom-6 right-6 z-40 w-[330px] max-w-[calc(100vw-3rem)]">
      <DiceTowerPanel onClose={() => setOpen(false)} />
    </div>
  );
}
