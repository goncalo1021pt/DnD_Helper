/*
The purse in the item dialog (#394).

It used to be a row like any other: a stepper that moved the count by one base
unit, so adding 50 gp was 5,000 presses and a player could set their own gold to
anything. Now it says what is in it in the table's own coin and takes an amount
in a coin: **Spend** always, **Add** only where raising a purse is the owner's
to do — an unseated hero. At a table coin comes from the DM's gift, the shop or
a quest's reward, and the server holds the same line.
*/

import { useState } from "react";
import { coinageOf, formatCoins, goldRung, priceBase, type Coin } from "../../lib/money";

// The server's ceiling on one row's quantity.
const MAX_QTY = 1_000_000;

export default function PurseControls({
  qty,
  coinage,
  canRaise,
  pending,
  onSet,
  onEmpty,
}: {
  qty: number;
  coinage: Coin[] | null | undefined;
  /** Whether the viewer may put coin in — false at a table, for a player. */
  canRaise: boolean;
  pending: boolean;
  onSet: (qty: number) => void;
  /** A purse spent to the last coin is gone: the schema holds no empty row. */
  onEmpty: () => void;
}) {
  const ladder = coinageOf(coinage);
  const [amount, setAmount] = useState("");
  const [coinIdx, setCoinIdx] = useState(goldRung(ladder));
  const base = amount.trim() ? priceBase(`${amount.trim()} ${ladder[coinIdx].abbrev}`, ladder) : null;
  const bad = amount.trim() !== "" && base === null;

  const spend = () => {
    if (base === null || base < 1) return;
    if (base >= qty) return onEmpty();
    onSet(qty - base);
    setAmount("");
  };
  const add = () => {
    if (base === null || base < 1 || qty + base > MAX_QTY) return;
    onSet(qty + base);
    setAmount("");
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="font-heading text-[15px] font-bold text-ink" data-testid="purse-total">
        {formatCoins(qty, ladder)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
          placeholder="Amount"
          aria-label="Coin amount"
          className="input-parchment input-compact w-24 text-[12px]"
        />
        <select
          value={coinIdx}
          onChange={(e) => setCoinIdx(Number(e.target.value))}
          aria-label="Coin"
          className="input-parchment input-compact w-44 cursor-pointer text-[12px]"
        >
          {ladder.map((c, i) => (
            <option key={c.abbrev} value={i}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          disabled={base === null || base < 1 || pending}
          onClick={spend}
          className="btn-base btn-ghost-ink px-3 py-2 text-[10.5px]"
        >
          Spend
        </button>
        {canRaise && (
          <button
            disabled={base === null || base < 1 || qty + (base ?? 0) > MAX_QTY || pending}
            onClick={add}
            className="btn-base btn-ghost-ink px-3 py-2 text-[10.5px]"
          >
            Add
          </button>
        )}
      </div>
      {bad && <div className="text-[11.5px] italic text-[#8b2520]">That is not an amount in this table&apos;s coin.</div>}
      {!canRaise && (
        <div className="font-accent text-[11.5px] italic text-ink-label">
          At the table, coin comes from the DM, the shop or a quest.
        </div>
      )}
    </div>
  );
}
