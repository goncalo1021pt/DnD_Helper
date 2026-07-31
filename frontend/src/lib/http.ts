/*
Every request has a deadline.

#130 reported the Forge "eternally thinking" on a slow connection. The Forge was
innocent: its error surface (`ForgeAlert`) is correct and simply never fired,
because a `fetch` stalled on a bad link never settles at all. `mutation.isPending`
stays true, so the button stays disabled and captioned "Forging…" — forever.

The Forge is only where it hurt most, because it is the screen with the most
state to lose. The hole was in the transport, so the deadline is too.

It lives here rather than in `api/client.ts` because the typed client is not the
only way out of this app: `/api/auth/*` is hand-rolled and outside the OpenAPI
surface, so login, register, 2FA and the password flows all reach the network
through a bare `fetch`. `LandingPage.submit` even has the right catch already
("Could not reach the tavern") — it simply never runs, and the sign-in button
sits at "…" for as long as the tab is open. That is the reported bug on the
first screen a player ever sees.
*/

/** Long enough for a slow but working link; short enough to still be an answer. */
const DEADLINE_MS = 20_000;

/** For a body that is genuinely large rather than genuinely stuck. */
const UPLOAD_DEADLINE_MS = 120_000;

/**
 * A failed request that never became an HTTP response.
 *
 * Shaped like the server's error body on purpose: the app's convention for a
 * rejected mutation is the parsed `{ error }` payload, and dozens of call sites
 * — plus `noticeFor` in `lib/notices.ts` — read `.error` off it. Wearing the
 * same shape means a dead connection says something true everywhere, without
 * touching any of them.
 */
export class RequestFailed extends Error {
  /** `timeout`: no answer in time. `offline`: never reached the server at all. */
  readonly kind: "timeout" | "offline";
  /** The sayable sentence, under the key every error site already reads. */
  readonly error: string;

  constructor(kind: "timeout" | "offline", error: string) {
    super(error);
    this.name = "RequestFailed";
    this.kind = kind;
    this.error = error;
  }
}

/** Deadlines a call chose for itself; the default one leaves these alone. */
const explicitDeadlines = new WeakSet<AbortSignal>();

/**
 * A longer leash, for the one call that legitimately needs it.
 *
 * Hanging a map ships the image as base64 in the request body, so a large
 * battle map on a domestic uplink is a slow request rather than a stalled one,
 * and the ordinary deadline would cut it off mid-climb. Spread into the call:
 * `api.POST(path, { params, body, ...slowUpload() })`.
 */
export function slowUpload(): { signal: AbortSignal } {
  const signal = AbortSignal.timeout(UPLOAD_DEADLINE_MS);
  explicitDeadlines.add(signal);
  return { signal };
}

function deadlineFor(caller: AbortSignal | null | undefined): AbortSignal {
  if (caller && explicitDeadlines.has(caller)) return caller;
  const own = AbortSignal.timeout(DEADLINE_MS);
  return caller ? AbortSignal.any([caller, own]) : own;
}

function asFailure(cause: unknown): never {
  const name = (cause as { name?: string } | null)?.name;
  if (name === "TimeoutError") {
    throw new RequestFailed(
      "timeout",
      "The server took too long to answer — your connection may be slow. Give it another go.",
    );
  }
  // A caller cancelling on purpose is not a failure; let it stay a cancel.
  if (name === "AbortError") throw cause;
  throw new RequestFailed(
    "offline",
    "Could not reach the server. Check your connection and try again.",
  );
}

/**
 * `fetch` with a deadline, for the routes outside the typed client.
 *
 * Drop-in: same arguments, same Response. The difference is that it can now
 * reject, so a call site's existing catch finally gets to run.
 */
export function http(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, signal: deadlineFor(init?.signal) }).catch(asFailure);
}

/** The same deadline, in the shape `openapi-fetch` wants for its transport. */
export function fetchWithDeadline(request: Request): Promise<Response> {
  return fetch(request, { signal: deadlineFor(request.signal) }).catch(asFailure);
}
