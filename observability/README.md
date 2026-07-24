# Observability — Prometheus + Grafana

Metrics, dashboards, and host/container/database exporters for the Quest Board
stack. This is a **separate compose project** from the app: you run it once on
the host, it joins the app's docker network, scrapes everything, and gives you
Grafana dashboards.

```
   ┌─────────────── app stack (docker-compose.yml) ───────────────┐
   │  app:8080  ── public, via Cloudflare tunnel                   │
   │  app:9091  ── /metrics (PRIVATE, never tunneled)  ◀──┐        │
   │  postgres:5432 ─────────────────────────────◀──┐    │        │
   └─────────────────────────────────────────────────│────│────────┘
                                                      │    │  scrape (docker DNS,
   ┌────────── observability stack (this dir) ────────│────│──  shared network)
   │  postgres-exporter:9187 ─────────────────────────┘    │        │
   │  node-exporter:9100    (host CPU/mem/disk)             │        │
   │  cadvisor:8080         (per-container usage)           │        │
   │  prometheus:9090  ── scrapes all of the above ─────────┘        │
   │  grafana:3000     ── dashboards, reads from prometheus          │
   └─────────────────────────────────────────────────────────────────┘
```

## Why a separate stack?

The app is a single Go binary that already knows how to emit Prometheus metrics
— but monitoring should not share the app's lifecycle. You redeploy the app
without touching Prometheus history, and you can tear the monitoring down
without touching the app. They talk over the shared docker network only.

## The golden rule: never tunnel these ports

`/metrics`, Prometheus (`:9090`) and Grafana (`:3000`) expose internal data and
an admin login. They must stay on the **LAN/VPN only** — never add them to the
Cloudflare tunnel. The app deliberately serves metrics on a **separate port
(`:9091`)** that the tunnel does not route, so a tunnel misconfiguration cannot
leak them. Keep it that way.

## What gets collected

| Source | Job | What you get |
|---|---|---|
| The Go app (`app:9091`) | `questboard-app` | HTTP rate/latency/errors by route, DB-pool health, Go runtime, **game counters** (quests created/claimed, campaigns, heroes forged, encounters run) |
| postgres-exporter | `postgres` | connections, transactions, locks, cache hit ratio, DB size |
| node-exporter | `node` | host CPU, memory, disk, filesystem, network |
| cAdvisor | `cadvisor` | per-container CPU/memory/network/disk |
| Prometheus | `prometheus` | Prometheus's own health |

## Run it

```bash
cd observability
cp .env.example .env         # set GF_ADMIN_PASSWORD; check APP_NETWORK
docker compose up -d
```

Then open:

- **Grafana** → http://<host>:3000  (login `admin` / your `GF_ADMIN_PASSWORD`)
  The **Quest Board — Overview** dashboard is auto-provisioned under the
  "Quest Board" folder.
- **Prometheus** → http://<host>:9090  (raw queries + `Status → Targets` to see
  what is up/down)

### The one setting that matters: `APP_NETWORK`

Prometheus reaches the app and postgres by their docker **service names**
(`app`, `postgres`), which only resolve if this stack joins the app's network.
Find the network name:

```bash
docker network ls | grep default
# e.g. questboard_default   (or <COMPOSE_PROJECT_NAME>_default)
```

Put that value in `.env` as `APP_NETWORK`. If it is wrong, every app/postgres
target shows **down** with a DNS error in `Status → Targets`.

> **Dev note:** if you run the app on the host (`make run`) instead of as a
> container, there is no `app` container on the network, so the
> `questboard-app` target will be **down** — that is expected. Run the app via
> `docker compose --profile full up -d app` to see that target go green.

## Reading the dashboard

- **Request rate / Error rate / In-flight / p95** — the four numbers that tell
  you at a glance whether the app is healthy.
- **Request rate by route** — routes are the chi templates (`/api/campaigns/{id}`),
  never raw paths, so IDs don't explode the series count.
- **Latency quantiles** — p50/p95/p99 from the histogram. Watch p99.
- **DB connection pool** — if `in use` rides up near `max`, the pool is
  saturating and requests are queueing for a connection.
- **Game events** — the fun one: quests claimed, encounters run, heroes forged,
  as they happen.

## Useful PromQL to try in Prometheus

```promql
# Requests per second, all routes
sum(rate(questboard_http_requests_total[5m]))

# Slowest routes (p95) right now
histogram_quantile(0.95, sum(rate(questboard_http_request_duration_seconds_bucket[5m])) by (le, route))

# Error ratio
sum(rate(questboard_http_requests_total{status=~"5.."}[5m])) / sum(rate(questboard_http_requests_total[5m]))

# Quests claimed in the last hour
increase(questboard_game_events_total{event="quest_claimed"}[1h])
```

## Operating it

```bash
docker compose ps                 # container health
docker compose logs -f prometheus # tail a service
docker compose down               # stop (keeps data volumes)
docker compose down -v            # stop AND delete metrics + Grafana state
```

Data lives in the `prometheus_data` (30-day retention) and `grafana_data`
named volumes, so restarts keep your history and dashboard edits.

## Editing dashboards

The provisioned dashboard is `grafana/dashboards/questboard.json`. You can edit
it live in Grafana (allowed), but to make a change **stick across a `down -v`**,
export it (Dashboard → Settings → JSON Model) and commit it back to that file.

## Later (roadmap)

- **Loki + promtail** for searchable logs alongside metrics.
- **Alerting** — Prometheus alert rules / Grafana alerts (e.g. error rate high,
  DB pool saturated, disk filling).
- An off-host scrape or `remote_write` so metrics survive the VM.
