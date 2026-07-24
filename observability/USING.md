# Using the observability stack

`README.md` is how to *run* it. This is how to *use* it: the mental model, how
to reach it in production, what you can learn and from where, and where
everything actually lives in the Grafana UI.

---

## 1. The mental model

Three roles — keep them separate in your head:

- **The app exposes numbers.** The Go server publishes a plain-text page at
  `:9091/metrics` — counters and gauges like "served 4,213 requests" and
  "3 DB connections in use." That's all it does: no history, no graphs.
- **Prometheus collects and remembers.** Every 15s it fetches each target's
  `/metrics` (this is **scraping** — a *pull* model; Prometheus reaches out,
  nothing pushes to it), timestamps the values, and stores them. "4,213 now"
  becomes "the count every 15s for the last 30 days" (the retention setting).
- **Grafana draws and asks.** It stores no data — it queries Prometheus and
  renders graphs. It is the human interface.

Flow: **app emits → Prometheus scrapes + stores → Grafana queries + draws.**
The exporters (node / cadvisor / postgres) are just "programs that emit
metrics" about the host, containers, and database; Prometheus scrapes them the
same way. The query language tying it together is **PromQL**.

---

## 2. Reaching it in production

The prod box exposes exactly one thing publicly: the app, at `dnd.fontao.net`,
through the Cloudflare tunnel. Grafana (`:3000`), Prometheus (`:9090`) and
`/metrics` (`:9091`) are **deliberately not on the tunnel** — internal data and
an admin login. So "access in prod" means "reach a port on the VM that is not
public." Options, cheapest first:

**A — SSH port-forward (start here).** From your laptop:

```bash
ssh -L 3000:localhost:3000 -L 9090:localhost:9090 you@poweredge
```

Then open `http://localhost:3000` locally — you are viewing Grafana *on the VM*
over your SSH session. Nothing new is exposed; closing SSH ends the access.

**B — a VPN (Tailscale / WireGuard).** Install on the VM and your devices, then
browse `http://<vm-ip>:3000` from anywhere, including your phone. One-time
setup, then seamless. The "grown-up homelab" answer.

**C — Cloudflare Access (a gated URL).** You *can* put `grafana.fontao.net` on
the tunnel **only if** you protect it with Cloudflare Access (Zero Trust) so it
demands a login first. Clean bookmarkable URL, but it re-adds a public attack
surface — only safe with Access actually enforced. Not until you're comfortable.

**Recommendation:** SSH forwarding now; add Tailscale when you want it effortless.

---

## 3. What you can learn, and from where

| Question | Where (job / exporter) | Metrics |
|---|---|---|
| Is the site healthy right now? | app (`questboard-app`) | request rate, error rate, in-flight, p95/p99 latency |
| Why was it slow last night? | app + node + postgres | latency history correlated with CPU/mem and DB pool |
| Is the DB pool a bottleneck? | app | `questboard_db_pool_*` (in-use vs max) |
| Is the VM okay? (guards the **whole** homelab) | `node` | disk, RAM, CPU, load, network |
| Which container eats resources? | `cadvisor` | per-container CPU/mem/net/fs |
| Is Postgres struggling? | `postgres` | connections, cache hit ratio, tx rate, locks, DB size |
| How much is the app used? | app (game counters) | quests created/claimed, campaigns, heroes, encounters |

The history is the superpower: because Prometheus stored everything, you scroll
back to when it broke and *see* the spike, then look at neighbouring panels to
find the cause instead of guessing.

The game counters are essentially free product analytics — you can watch "3
quests claimed during Friday's session" with no tracking service added.

---

## 4. How this is commonly used (day to day)

Roughly the order you grow into:

1. **The glance.** Keep the dashboard bookmarked; look when something feels off.
   All green? Done. This is most casual use.
2. **Ad-hoc investigation (Explore).** When debugging, open Grafana's **Explore**
   tab, pick a metric, and ask — "error rate for the last 6h by route." No
   pre-built panel needed.
3. **Alerting** *(not set up yet — highest value; roadmap #8).* Write rules like
   "error rate > 5% for 5m" or "disk > 85%" and get pinged on Discord. The point:
   find out **before players do**, without watching a screen.
4. **Post-incident forensics.** Broke and recovered before you looked? The 30-day
   history reconstructs exactly what happened.
5. **Capacity planning.** "Memory up 2%/week for two months" → more RAM by autumn,
   known in advance instead of at OOM.

---

## 5. Where everything is in Grafana

Login at `http://<host>:3000` (`admin` / your `GF_ADMIN_PASSWORD`). The left rail
(☰) is the whole app. The four places that matter:

### Dashboards (the ☷ / four-squares icon)
`Dashboards → Quest Board → Quest Board — Overview`. This is the pre-built one.
Reading it top to bottom:

- **Top stat row** — Request rate, Error rate, In-flight, p95 latency. The
  four-numbers-at-a-glance health check.
- **Request rate by route** — traffic per chi route template
  (`/api/campaigns/{id}`, never raw IDs). Stacked, so total height = total load.
- **Latency quantiles** — p50/p95/p99 over time. Watch p99: the worst 1% of
  requests. A rising p99 with flat p50 means occasional slow requests.
- **Requests by status** — 2xx/4xx/5xx over time. A wall of 5xx = server errors;
  lots of 401 is normal (that's the login gate on `/api/me`).
- **DB connection pool** — in-use / idle / total / max. If **in-use rides up to
  max**, requests are queueing for a connection — the pool is your bottleneck.
- **Game events** — quests claimed, encounters run, heroes forged, as bars.

**Controls to know:** top-right **time picker** (default "last 1 hour" — widen to
6h/24h to see trends) and the **refresh** dropdown next to it (set 15s for a live
view). Hover any graph for exact values; drag-select on a graph to zoom to that
window; click a series in the legend to isolate it.

### Explore (the compass icon) — ask your own questions
Pick the **Prometheus** data source (top-left), type a query, hit **Run query**.
This is where you poke without building a panel. Start typing `questboard_` and
Grafana autocompletes every metric the app exposes. Try:

```promql
sum(rate(questboard_http_requests_total[5m]))                    # requests/sec
sum by (route) (rate(questboard_http_requests_total[5m]))        # by route
histogram_quantile(0.95, sum(rate(questboard_http_request_duration_seconds_bucket[5m])) by (le))
increase(questboard_game_events_total{event="quest_claimed"}[24h])   # quests claimed today
questboard_db_pool_acquired_conns                                # live pool usage
node_filesystem_avail_bytes                                      # free disk (host)
```

Toggle **Table** vs **Graph** at the top of the results to see raw label sets vs
a plotted line.

### Connections → Data sources
One entry, **Prometheus**, auto-provisioned and marked default. You rarely touch
this — it's just proof Grafana knows where to read from. Click it → **Test** to
confirm the link is healthy.

### Alerting (the bell) — currently empty
Where roadmap #8 will live: rules + a Discord contact point. Empty today.

---

## 6. Prometheus's own UI (`:9090`) — the plumbing view

Grafana is the pretty front end, but Prometheus has a bare UI worth knowing:

- **Status → Targets** — the single most useful page. Lists every scrape target
  (`questboard-app`, `node`, `cadvisor`, `postgres`, `prometheus`) as **up** or
  **down**, with the last error. If a Grafana panel is empty, check here first:
  a **down** target with a DNS error usually means `APP_NETWORK` is wrong (see
  `README.md`).
- **Graph** tab — run one-off PromQL without Grafana. Good for a quick sanity
  check that a metric exists at all.

Rule of thumb: **panel empty → Prometheus `Status → Targets` → is the source
up?** Then check the query.

---

## 7. A five-minute first tour

1. SSH-forward (or VPN) to the VM; open `http://localhost:3000`.
2. `Dashboards → Quest Board → Quest Board — Overview`. Set the time picker to
   **Last 6 hours**, refresh to **15s**.
3. In another tab hit the app a few times (log in, open a campaign, claim a
   quest). Watch **Request rate** and **Game events** move.
4. Open **Explore**, type `questboard_`, and run a couple of the queries above.
5. Open Prometheus `:9090 → Status → Targets` and confirm all five are **up**.

That's the whole loop: the app emits, Prometheus scrapes, Grafana shows, you ask.
