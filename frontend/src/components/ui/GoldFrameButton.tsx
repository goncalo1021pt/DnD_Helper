import type { ReactNode } from "react";

const clip = (px: number) =>
  `polygon(${px}px 0,calc(100% - ${px}px) 0,100% ${px}px,100% calc(100% - ${px}px),calc(100% - ${px}px) 100%,${px}px 100%,0 calc(100% - ${px}px),0 ${px}px)`;

/* Double-layer iron+gold button: gold gradient frame, dark wood face. */
export default function GoldFrameButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="h-11 cursor-pointer border-none p-[1.6px] transition hover:brightness-110"
      style={{
        background: "linear-gradient(180deg,#e0b15a,#9c6d20)",
        clipPath: clip(9),
        filter: "drop-shadow(0 4px 10px rgba(0,0,0,.4))",
      }}
    >
      <span
        className="font-heading flex h-full items-center justify-center gap-2 px-[22px] text-sm font-semibold tracking-[.05em] text-[#ecc673]"
        style={{
          background: "linear-gradient(180deg,#2a1a0d,#1a0f07)",
          clipPath: clip(8),
        }}
      >
        {children}
      </span>
    </button>
  );
}
