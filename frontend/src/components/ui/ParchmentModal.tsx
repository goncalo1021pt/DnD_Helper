import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconX } from "./icons";

/**
 * Full-screen overlay with a still parchment panel.
 * Click-outside or the ✕ closes it.
 *
 * Rendered through a portal: callers may live inside transformed elements
 * (e.g. the tilted quest notices), and a transform would otherwise trap
 * position:fixed in that element's containing block and stacking context —
 * sibling cards would paint over the modal.
 */
export default function ParchmentModal({
  onClose,
  children,
  maxWidth = "max-w-[420px]",
}: {
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
}) {
  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center p-6"
      style={{ background: "rgba(12,7,3,.72)", backdropFilter: "blur(2px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`parchment anim-rise-fast w-full px-8 pb-8 pt-[34px] ${maxWidth}`}
        style={{
          boxShadow:
            "0 30px 70px rgba(0,0,0,.7), inset 0 0 40px rgba(150,110,60,.12)",
        }}
      >
        <button
          onClick={onClose}
          title="Close"
          className="absolute right-3 top-3 inline-flex cursor-pointer border-none bg-transparent p-1.5 text-ink-faded hover:text-ink"
        >
          <IconX size={20} strokeWidth={2} />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}
