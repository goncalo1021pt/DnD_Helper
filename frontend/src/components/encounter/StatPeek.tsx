/* The DM's peek at what stands behind a combatant (#284). */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Combatant, RulesContent } from "../../api/client";
import { useNpcs, useRulesEntry } from "../../hooks";
import ContentEntry from "../ui/ContentEntry";
import ParchmentModal from "../ui/ParchmentModal";

/*
Reading a monster mid-fight used to mean the Den open in a second tab: the
tracker named a goblin and said nothing else about it. The name is the door
now. Rest the pointer on it and the Den's own stat card opens beside it, the
way a spell chip opens on the sheet — it stays while the pointer is on it and
scrolls for a long entry. Press it and the same card opens as a dialog, which
is the whole gesture on a phone and the way to keep it open while typing
damage.

What stands behind a row decides whether there is anything to read: a monster
carries its Den entry's id, and an ally carries a person who may carry a
block (#228). A hero's sheet is a page and not a card, and a custom foe has
nothing behind it, so neither name answers — it stays plain text, and a name
that does answer says so only under the pointer. Nothing is fetched before
the first hover: a tracker of twenty rows should not pull twenty entries on
the chance one is read, and an entry once read is kept for the session.
*/

const CARD_WIDTH = 360;

// One card at a time. Each card keeps a short grace period after the pointer
// leaves, so a pointer flicking down the order would otherwise stack cards
// for as long as that period lasts; the card opening closes the one before.
let closeOpenCard: (() => void) | null = null;

/** Whether a row has a stat block to read at all. */
export function peekable(c: Combatant): boolean {
  if (c.contentId) return true;
  // A person with a forged body has a sheet, not a block.
  return c.kind === "ally" && !!c.npcId && !c.characterId;
}

/**
 * The block behind a combatant, read on demand: `undefined` while it is on
 * its way, `null` when there is nothing to read after all.
 */
function useBlock(c: Combatant, campaignId: string, wanted: boolean): RulesContent | null | undefined {
  const entry = useRulesEntry(wanted && c.contentId ? c.contentId : undefined);
  const folk = useNpcs(campaignId, wanted && !c.contentId && c.kind === "ally");
  if (!wanted) return undefined;
  if (c.contentId) return entry.isError ? null : entry.data;
  if (folk.isError) return null;
  if (!folk.data) return undefined;
  return folk.data.find((n) => n.id === c.npcId)?.statBlock ?? null;
}

export function StatPeek({
  c,
  campaignId,
  enabled = true,
  tap = true,
  children,
}: {
  c: Combatant;
  campaignId: string;
  /** The players' tracker shows names and nothing behind them. */
  enabled?: boolean;
  /** A press opens the dialog — off where the press already means something
      else, as on a mob's header, which folds and unfolds the mob. */
  tap?: boolean;
  children: ReactNode;
}) {
  const [wanted, setWanted] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean; maxHeight: number } | null>(null);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const block = useBlock(c, campaignId, wanted);
  // Stable across renders, so the one-card registry can tell its own entry
  // from another row's.
  const close = useRef(() => setPos(null)).current;

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
      if (closeOpenCard === close) closeOpenCard = null;
    },
    [close],
  );

  if (!enabled || !peekable(c)) return <>{children}</>;

  function cancelClose() {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }
  function scheduleClose() {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      close();
      if (closeOpenCard === close) closeOpenCard = null;
    }, 140);
  }
  function place(e: React.MouseEvent) {
    // A tap synthesises mouseenter on a touch browser, and a card that opens
    // under a finger only gets in the way of the press. Genuine hover only.
    if (window.matchMedia("(hover: none)").matches) return;
    cancelClose();
    if (closeOpenCard && closeOpenCard !== close) closeOpenCard();
    closeOpenCard = close;
    setWanted(true);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.min(Math.max(r.left, 8), window.innerWidth - CARD_WIDTH - 8);
    // A stat block is a page, not a spell's paragraph, so the card takes the
    // side with more room and is sized to it, scrolling inside itself rather
    // than running off the screen. Below is preferred while it can hold a
    // readable card, since that is where the eye goes from a name.
    const spaceBelow = window.innerHeight - r.bottom - 16;
    const spaceAbove = r.top - 16;
    const up = spaceBelow < 420 && spaceAbove > spaceBelow;
    setPos({
      x,
      y: up ? window.innerHeight - r.top + 8 : r.bottom + 8,
      up,
      maxHeight: Math.max(200, up ? spaceAbove : spaceBelow),
    });
  }
  function press(e: React.MouseEvent) {
    e.stopPropagation();
    cancelClose();
    setPos(null);
    setWanted(true);
    setOpen(true);
  }

  const body =
    block === undefined ? (
      <div className="font-accent text-[12.5px] italic text-ink-faded">Reading the Den…</div>
    ) : block === null ? (
      <div className="font-accent text-[12.5px] italic text-ink-faded">Nothing in the Den answers to that name.</div>
    ) : (
      // The card and the dialog both scroll themselves — one bar, not two.
      <ContentEntry entry={block} scroll={false} />
    );

  return (
    <>
      {tap ? (
        <button
          type="button"
          onMouseEnter={place}
          onMouseLeave={scheduleClose}
          onClick={press}
          aria-haspopup="dialog"
          className="m-0 inline-flex min-w-0 cursor-pointer border-none bg-transparent p-0 text-left decoration-dotted underline-offset-[3px] hover:underline"
          style={{ color: "inherit", font: "inherit" }}
        >
          {children}
        </button>
      ) : (
        // A real box, not display:contents — the card is placed off this
        // element's rect, and an element with no box has none.
        <span onMouseEnter={place} onMouseLeave={scheduleClose} className="inline-flex min-w-0">
          {children}
        </span>
      )}
      {pos &&
        createPortal(
          <div
            role="tooltip"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            className="parchment fixed z-[70] overflow-y-auto overscroll-contain px-4 py-3.5"
            style={{
              left: pos.x,
              width: CARD_WIDTH,
              maxHeight: pos.maxHeight,
              ...(pos.up ? { bottom: pos.y } : { top: pos.y }),
              boxShadow: "0 18px 40px rgba(0,0,0,.6), inset 0 0 30px rgba(150,110,60,.1)",
            }}
          >
            {body}
          </div>,
          document.body,
        )}
      {open && (
        <ParchmentModal onClose={() => setOpen(false)} maxWidth="max-w-[520px]">
          {body}
        </ParchmentModal>
      )}
    </>
  );
}
