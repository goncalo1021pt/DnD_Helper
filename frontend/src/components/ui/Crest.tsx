/**
 * App emblem: the "bounty crest" — a skull shield over crossed bones.
 * Recolors via currentColor; the shield field stays near-black.
 * (Alternate skeleton-crest variants live in the design preview; swapping
 * the emblem means editing only this file.)
 */
export default function Crest({
  size = 46,
  className,
}: {
  size?: number | string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      {/* crossed bones behind the shield */}
      <g fill="currentColor" stroke="currentColor">
        <line x1="30" y1="32" x2="90" y2="92" strokeWidth="5.5" strokeLinecap="round" />
        <line x1="90" y1="32" x2="30" y2="92" strokeWidth="5.5" strokeLinecap="round" />
        <circle cx="26.2" cy="33" r="3.2" stroke="none" />
        <circle cx="31" cy="28.2" r="3.2" stroke="none" />
        <circle cx="89" cy="95.8" r="3.2" stroke="none" />
        <circle cx="93.8" cy="91" r="3.2" stroke="none" />
        <circle cx="89" cy="28.2" r="3.2" stroke="none" />
        <circle cx="93.8" cy="33" r="3.2" stroke="none" />
        <circle cx="26.2" cy="91" r="3.2" stroke="none" />
        <circle cx="31" cy="95.8" r="3.2" stroke="none" />
      </g>
      {/* shield */}
      <path
        d="M60 28 L86 38 V60 C86 80 75 91 60 98 C45 91 34 80 34 60 V38 Z"
        fill="#1c1108"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinejoin="round"
      />
      {/* skull */}
      <path
        d="M60 45 C49.5 45 43 52 43 60.5 C43 66 45.5 70 49.5 72.5 L49.5 79 L70.5 79 L70.5 72.5 C74.5 70 77 66 77 60.5 C77 52 70.5 45 60 45 Z"
        fill="currentColor"
      />
      <circle cx="53.5" cy="60.5" r="4.3" fill="#1c1108" />
      <circle cx="66.5" cy="60.5" r="4.3" fill="#1c1108" />
      <path d="M60 65.5 L57 71 L63 71 Z" fill="#1c1108" />
      <g stroke="#1c1108" strokeWidth="1.6">
        <line x1="56.5" y1="73.5" x2="56.5" y2="78" />
        <line x1="60" y1="74" x2="60" y2="79" />
        <line x1="63.5" y1="73.5" x2="63.5" y2="78" />
      </g>
    </svg>
  );
}
