import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import Notices from "./components/ui/Notices";
import { noticeFor, pushNotice } from "./lib/notices";
import "./index.css";

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
/*
Retries are the transport's job, not this file's (#130).

The obvious home for a retry policy is right here, in `defaultOptions.mutations`
— but TanStack hands its `retry` callback a failure with no request attached, so
a policy written at this level can only say "retry every mutation" or "retry
none". Retrying every mutation means retrying every POST, which invents a second
hero on exactly the flaky connection that made retrying worthwhile.

`lib/http.ts` knows the method and replays only what is safe to replay, so both
of these stay `false` on purpose: one retry loop, one layer, no doubling up.
*/
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
    mutations: { retry: false },
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
