import { useEffect, useState } from "react";
import { dismissNotice, subscribeNotices, type Notice } from "../../lib/notices";

/*
Where a failed mutation gets said out loud.

Bottom-left on purpose: the Dice Tower already owns the bottom-right corner on
solo pages, and a notice that covers the dice is a notice that gets dismissed
unread.
*/
export default function Notices() {
  const [notices, setNotices] = useState<Notice[]>([]);
  useEffect(() => subscribeNotices(setNotices), []);

  if (notices.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-5 left-5 z-[9999] flex max-w-[min(380px,calc(100vw-2.5rem))] flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {notices.map((n) => (
        <div
          key={n.id}
          className="pointer-events-auto flex items-start gap-2.5 rounded-[3px] px-3.5 py-3 text-[13px] leading-snug"
          style={{
            background: "linear-gradient(180deg,#2a1a12,#1a0f09)",
            boxShadow: "inset 0 0 0 1px rgba(139,37,32,.65), 0 10px 26px rgba(0,0,0,.5)",
            color: "#eccbb9",
          }}
        >
          <span
            aria-hidden
            className="font-display mt-[-1px] flex-none text-[16px] font-black leading-none"
            style={{ color: "#e0725f" }}
          >
            !
          </span>
          <span className="font-body min-w-0 flex-1">{n.text}</span>
          <button
            onClick={() => dismissNotice(n.id)}
            aria-label="Dismiss"
            className="label-stamp flex-none cursor-pointer border-none bg-transparent p-0 text-[10px] tracking-[1px]"
            style={{ color: "#c9a227" }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
