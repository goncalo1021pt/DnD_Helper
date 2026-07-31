import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import Notices from "./components/ui/Notices";
import { RequestFailed } from "./lib/http";
import { noticeFor, pushNotice } from "./lib/notices";
import "./index.css";

/*
What is worth trying again, and what is only worth reporting.

`RequestFailed` (see `lib/http.ts`) is a request that never became an HTTP
response. Its two kinds carry very different promises:

- `offline` — the connection was never made, so the server cannot have acted on
  it. Repeating it cannot do anything twice, and it failed fast, so trying again
  costs nobody anything.
- `timeout` — the request may well have landed and simply not answered in time.
  Repeating it could invent a second hero, and it already spent the full
  twenty-second deadline doing nothing.

So only `offline` is retried, and a timeout is reported instead. That is not
merely the cautious reading: re-running a 20s deadline twice means a minute of
watching a spinner before hearing the same news, which is #130 again wearing a
different hat. Better to say it once, quickly, with the button working again.
(For the Forge, the *player's* own retry is made safe by the idempotency key on
the POST, so a timeout that did land cannot double-forge either.)

The same rule serves queries and mutations, and neither retries anything that
reached the server: a 401 from `/me` is the login gate, an expected state rather
than a fault, and must stay immediate.
*/
const retry = (failureCount: number, error: unknown) =>
  failureCount < 2 && error instanceof RequestFailed && error.kind === "offline";
const retryDelay = (failureCount: number) => 400 * 2 ** failureCount;

/*
Every mutation failure is heard.

There are 139 `.mutate()` call sites in `components/` and, before this, 27
mentions of `isError` between them — so most failures were never shown at all.
That is what #128 actually was: not a rule that refused a hero, but a refusal
nobody could see.

A single handler on the MutationCache inverts the default. A call site with a
better surface of its own opts out via `meta: { quiet: true }` on its hook;
everything else gets said out loud without anyone having to remember.
*/
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry, retryDelay, refetchOnWindowFocus: false },
    mutations: { retry, retryDelay },
  },
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.meta?.quiet) return;
      pushNotice(noticeFor(error));
    },
  }),
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Notices />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
