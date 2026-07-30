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
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
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
