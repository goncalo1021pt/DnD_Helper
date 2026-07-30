/*
The app's one place for "that didn't work".

A mutation that fails silently is the bug that cost the first real session
(#128): the server explained itself perfectly and the UI dropped the message on
the floor. There are 139 `.mutate()` call sites in `components/`, and hand-
writing an error branch at each of them is both a lot of work and a standing
invitation to forget one — the next silent failure would just be the call site
nobody remembered.

So the default moved. Every mutation failure raises a notice here, from a
single handler on the QueryClient's MutationCache, and a call site has to opt
*out* (`meta: { quiet: true }`) when it has a better surface of its own. Silence
is now a deliberate act rather than an oversight.

Deliberately not a library: a Set of listeners and an array is the whole
requirement, and a toast dependency would outweigh the feature.
*/

export interface Notice {
  id: number;
  text: string;
}

/** How long a notice sits there before fading. Long enough to read twice. */
const LIFETIME_MS = 8_000;

let notices: Notice[] = [];
let seq = 0;
const listeners = new Set<(n: Notice[]) => void>();

function emit() {
  const snapshot = notices;
  for (const fn of listeners) fn(snapshot);
}

export function pushNotice(text: string): void {
  const id = ++seq;
  // The same failure retried three times should read as one problem, not three.
  if (notices.some((n) => n.text === text)) return;
  notices = [...notices, { id, text }];
  emit();
  setTimeout(() => dismissNotice(id), LIFETIME_MS);
}

export function dismissNotice(id: number): void {
  const next = notices.filter((n) => n.id !== id);
  if (next.length === notices.length) return;
  notices = next;
  emit();
}

export function subscribeNotices(fn: (n: Notice[]) => void): () => void {
  listeners.add(fn);
  fn(notices);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Read something sayable out of whatever a failed mutation threw.
 *
 * `openapi-fetch` rejects with the parsed error body, so the server's own
 * wording — which is usually the most useful sentence available — comes through
 * as `.error`. Everything else falls back to a plain admission that something
 * broke, which is still infinitely better than a button that does nothing.
 */
export function noticeFor(err: unknown): string {
  const body = err as { error?: string; message?: string } | null;
  if (body?.error) return body.error;
  if (body?.message) return body.message;
  return "Something went wrong, and the server did not say what. Try again in a moment.";
}
