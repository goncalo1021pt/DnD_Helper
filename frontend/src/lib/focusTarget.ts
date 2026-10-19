/*
 * Arriving at one thing on a page (#321). A search result leads to a page with
 * `?focus=<id>`; the page marks each item it lists with `data-focus-id`, and
 * this scrolls the one named into view and flashes it once, then drops the
 * parameter so a reload or the back button does not flash it again.
 */

import { useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";

export function useFocusTarget(ready: boolean) {
  const [params, setParams] = useSearchParams();
  const focus = params.get("focus");
  useEffect(() => {
    if (!focus || !ready) return;
    const el = document.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(focus)}"]`);
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("focus");
        return next;
      },
      { replace: true },
    );
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.add("focus-flash");
    window.setTimeout(() => el.classList.remove("focus-flash"), 2400);
  }, [focus, ready, setParams]);
}

/** Reads a one-shot parameter (`?handout=…`, `?open=…`) and drops it once used. */
export function useOneShotParam(name: string): [string | null, () => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(name);
  const done = useCallback(
    () =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete(name);
          return next;
        },
        { replace: true },
      ),
    [name, setParams],
  );
  return [value, done];
}
