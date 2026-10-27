import { useLayoutEffect, useRef, type KeyboardEvent, type TextareaHTMLAttributes } from "react";

/*
A text box that grows with what is typed, up to a cap, and sends on Enter the
way a chat box does (#411) — but only where there is a Shift key to make a new
line with. On a touch screen Enter is the only way to start a new line, so
there it does just that, and the button beside the box sends.
*/

const touch = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

export default function GrowingTextarea({
  onSubmit,
  maxRows = 10,
  className = "",
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onSubmit"> & {
  value: string;
  /** Enter without Shift, where there is a keyboard to have Shift on. */
  onSubmit?: () => void;
  maxRows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const pad = el.offsetHeight - el.clientHeight + parseFloat(getComputedStyle(el).paddingTop) * 2;
    el.style.height = `${Math.min(el.scrollHeight, line * maxRows + pad)}px`;
  }, [rest.value, maxRows]);

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    rest.onKeyDown?.(e);
    if (e.defaultPrevented || !onSubmit) return;
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !touch()) {
      e.preventDefault();
      onSubmit();
    }
  }

  return <textarea ref={ref} rows={1} {...rest} onKeyDown={onKeyDown} className={`resize-none py-2.5 ${className}`} />;
}
