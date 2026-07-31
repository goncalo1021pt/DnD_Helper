/*
Every request gets a deadline, and a request that never arrived gets another go.

#130 was reported as a Forge bug — the button "thinks eternally", never errors,
and a reload costs twenty minutes of character building. It is not a Forge bug.
`AbortController`, `AbortSignal` and `timeout` appeared **zero** times in this
frontend, so a `fetch` stalled on a bad connection simply stayed pending: the
mutation never settled, `isPending` stayed `true`, and the button stayed
disabled and captioned "Forging…" for as long as the tab was open. Every one of
the app's mutations had that hole; the Forge is only where it hurt most,
because the Forge is the screen with the most state to lose.

So the deadline lives here, in the one transport the typed client and the
hand-rolled auth routes both go through, rather than at a hundred call sites.

Retrying lives here too, and deliberately **not** on the QueryClient. TanStack's
`retry` callback is handed a failure with no request attached, so a policy
written there can only say "retry everything" or "retry nothing" — and retrying
every POST invents duplicate heroes, quests and encounters on exactly the flaky
connection that made retrying worth doing. This layer knows the method, so it
can retry what is safe to replay and leave alone what is not.
*/

/**
 * The whole call's budget — every attempt and every wait between them, not one
 * attempt each. Generous on purpose: this is the point of despair, not a
 * latency target. A table on a phone in a basement should still get its answer.
 *
 * A budget rather than a per-attempt deadline because retries must not multiply
 * the wait. Three twenty-second attempts is a full minute of a button reading
 * "Forging…", which is the bug this file exists to fix wearing a different hat.
 * Retrying inside the budget means a connection that failed *fast* gets another
 * go, while one that stalled has already spent the patience anyone has.
 */
const BUDGET_MS = 20_000;

/**
 * Map images ride as base64 up to 10 MB and packs export whole libraries; a
 * twenty-second budget would fail them on a perfectly good connection.
 */
const HEAVY_BUDGET_MS = 120_000;
const HEAVY_PATHS = [/\/maps(\/|$|\?)/, /\/rules\/(import|export)\b/];

/** Attempts in total, not retries after the first. Fewer than the budget allows. */
const ATTEMPTS = 3;
/** Waits *between* attempts, so ATTEMPTS - 1 of them, and they come out of the budget. */
const BACKOFF_MS = [400, 1_200];
/** Below this much budget left, a further attempt is a formality. Fail and say so. */
const MIN_ATTEMPT_MS = 1_000;

/**
 * A POST is replayed only when it carries one of these. The server treats the
 * key as "this is the same intent as before, not a second one", so a retry that
 * follows a timeout returns the hero the first attempt actually created rather
 * than forging a twin.
 */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";

/** A fresh idempotency key. Kept in one place so call sites do not invent their own shape. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Older Safari on a phone at the table. Uniqueness per user is all the server needs.
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function budgetFor(url: string): number {
  return HEAVY_PATHS.some((re) => re.test(url)) ? HEAVY_BUDGET_MS : BUDGET_MS;
}

/**
 * Is replaying this request harmless?
 *
 * GET and HEAD read. PUT and DELETE are idempotent by HTTP's own definition.
 * PATCH is not, in general — but every PATCH in this app assigns absolute field
 * values (`hpCurrent: next`, never `hpCurrent += delta`), so a duplicate lands
 * on the same state as the first. POST creates, so it is replayed only when the
 * call site has asked for it by carrying a key.
 */
function replaySafe(request: Request): boolean {
  switch (request.method.toUpperCase()) {
    case "GET":
    case "HEAD":
    case "PUT":
    case "DELETE":
    case "PATCH":
      return true;
    default:
      return request.headers.has(IDEMPOTENCY_HEADER);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One attempt, given whatever is left of the call's budget — or cut short if the caller aborts. */
async function attempt(request: Request, budgetLeftMs: number, caller: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("deadline", "TimeoutError")), budgetLeftMs);
  const relay = () => controller.abort(caller.reason);
  if (caller.aborted) relay();
  else caller.addEventListener("abort", relay);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
    caller.removeEventListener("abort", relay);
  }
}

/**
 * Say what happened in a sentence someone at the table can act on.
 *
 * The notice bar (`lib/notices.ts`) reads `.message` off anything that is not a
 * server error body, so this wording is what a player actually sees when the
 * wifi gives out mid-session.
 */
function transportError(cause: unknown): Error {
  const timedOut = cause instanceof DOMException && cause.name === "TimeoutError";
  const err = new Error(
    timedOut
      ? "The server took too long to answer. Nothing was lost — try again."
      : "Could not reach the server. Check your connection and try again.",
  );
  err.cause = cause;
  return err;
}

/**
 * `fetch` with a deadline and a bounded retry. Drop-in: same signature, same
 * return, and it throws an ordinary `Error` with a sayable message when the
 * request never landed.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const attempts = replaySafe(request) ? ATTEMPTS : 1;
  const caller = request.signal;
  const spent = (() => {
    const start = Date.now();
    return () => Date.now() - start;
  })();
  const budget = budgetFor(request.url);
  const left = () => budget - spent();

  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) {
      await sleep(Math.min(BACKOFF_MS[i - 1] ?? 0, Math.max(left(), 0)));
      if (left() < MIN_ATTEMPT_MS) break;
    }
    try {
      // Clone per attempt: a body is a stream and is readable exactly once.
      return await attempt(request.clone(), left(), caller);
    } catch (err) {
      // The caller changed its mind — that is not a failure to report or retry.
      if (caller.aborted) throw err;
      last = err;
      if (left() < MIN_ATTEMPT_MS) break;
    }
  }
  throw transportError(last);
}
