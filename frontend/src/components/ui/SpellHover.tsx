import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { RulesContent } from "../../api/client";
import SpellEntry from "./SpellEntry";

/**
 * Wraps a trigger (a spell chip) and shows the full spell entry in a floating
 * parchment card on hover. The card itself is hoverable, so long entries can
 * be scrolled; a short grace period lets the pointer travel from chip to
 * card. Pointer devices only — touch users read spells in the Spellbook or
 * by tapping entries on the sheet.
 */
export default function SpellHover({
  spell,
  children,
}: {
  spell: RulesContent;
  children: ReactNode;
}) {
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean } | null>(null);
  const closeTimer = useRef<number | null>(null);

  function cancelClose() {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }
  function scheduleClose() {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setPos(null), 140);
  }

  function place(e: React.MouseEvent) {
    // Touch browsers synthesize mouseenter on tap — a hover card on a phone
    // just gets in the way of picking. Genuine hover devices only.
    if (window.matchMedia("(hover: none)").matches) return;
    cancelClose();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const width = 340;
    const x = Math.min(Math.max(r.left, 8), window.innerWidth - width - 8);
    // Prefer below the chip; flip above when there's more room up top.
    const spaceBelow = window.innerHeight - r.bottom;
    const up = spaceBelow < 340 && r.top > spaceBelow;
    setPos({ x, y: up ? window.innerHeight - r.top + 8 : r.bottom + 8, up });
  }

  return (
    <span className="contents" onMouseEnter={place} onMouseLeave={scheduleClose}>
      {children}
      {pos &&
        createPortal(
          <div
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            className="parchment fixed z-[70] w-[340px] px-4 py-3.5"
            style={{
              left: pos.x,
              ...(pos.up ? { bottom: pos.y } : { top: pos.y }),
              boxShadow: "0 18px 40px rgba(0,0,0,.6), inset 0 0 30px rgba(150,110,60,.1)",
            }}
          >
            <SpellEntry spell={spell} compact />
          </div>,
          document.body,
        )}
    </span>
  );
}
