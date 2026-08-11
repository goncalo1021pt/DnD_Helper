/*
A prop, filling the screen.

Not a ParchmentModal: a handout is artwork, and framing someone's torn map
corner in a parchment card puts a second piece of paper around the first. The
overlay gets out of the way and lets the image be the thing.
*/

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { Handout } from "../../api/client";
import { handoutImageUrl } from "../../hooks";
import { IconX } from "../ui/icons";

export default function HandoutLightbox({
  handout,
  onClose,
}: {
  handout: Handout;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={handout.title}
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-4 p-6"
      style={{ background: "rgba(8,5,2,.9)", backdropFilter: "blur(3px)" }}
    >
      <button
        onClick={onClose}
        title="Close"
        className="absolute right-4 top-4 inline-flex cursor-pointer border-none bg-transparent p-1.5 text-gold-muted transition hover:text-cream"
      >
        <IconX size={22} strokeWidth={2} />
      </button>
      <img
        src={handoutImageUrl(handout.id)}
        alt={handout.title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[78svh] max-w-full rounded-[2px] object-contain"
        style={{ boxShadow: "0 30px 80px rgba(0,0,0,.75)" }}
      />
      <div className="max-w-[600px] text-center">
        <div className="font-display text-lg font-bold text-[#e7d3a6]">{handout.title}</div>
        {handout.caption && (
          <div className="font-accent mt-1 text-[14px] italic text-cream-muted">
            {handout.caption}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
