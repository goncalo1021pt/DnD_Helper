/*
The reveal draft: stamps the DM has made but not yet committed.

Lifted out of MapPage (#108). Kept apart from useMapViewer because the two
answer different questions — the viewer knows where a tap landed, this knows
what a tap is currently *for*, and only this one can be thrown away without the
map moving.

Nothing here reaches the server. A draft is stamped, undone, discarded or
sealed; sealing is the caller's business, and clearing what was sealed is the
caller's too, because only the caller knows the request came back.
*/

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { RevealCircle } from "../../api/client";

export interface RevealDraft {
  stampMode: boolean;
  setStampMode: Dispatch<SetStateAction<boolean>>;
  draft: RevealCircle[];
  setDraft: Dispatch<SetStateAction<RevealCircle[]>>;
  brush: number;
  setBrush: Dispatch<SetStateAction<number>>;
  submitOpen: boolean;
  setSubmitOpen: Dispatch<SetStateAction<boolean>>;
  submitNote: string;
  setSubmitNote: Dispatch<SetStateAction<string>>;
  /** Put down a stamp at the tapped point, at the current brush radius. */
  stamp: (at: { x: number; y: number }) => void;
  /** Back to nothing stamped and nothing being stamped. */
  reset: () => void;
}

export function useRevealDraft(): RevealDraft {
  const [stampMode, setStampMode] = useState(false);
  const [draft, setDraft] = useState<RevealCircle[]>([]);
  const [brush, setBrush] = useState(0.05); // radius, fraction of map width
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitNote, setSubmitNote] = useState("");

  // Ctrl/Cmd+Z pulls the last draft stamp back while stamping — unless a
  // field has focus (the submit note keeps its own undo).
  useEffect(() => {
    if (!stampMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey) return;
      if (e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      e.preventDefault();
      setDraft((d) => d.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stampMode]);

  return {
    stampMode,
    setStampMode,
    draft,
    setDraft,
    brush,
    setBrush,
    submitOpen,
    setSubmitOpen,
    submitNote,
    setSubmitNote,
    stamp: (at) => setDraft((d) => [...d, { x: at.x, y: at.y, r: brush }]),
    reset: () => {
      setStampMode(false);
      setDraft([]);
    },
  };
}
