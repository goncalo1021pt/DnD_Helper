package metrics

import (
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
)

// poolStatter is the slice of *pgxpool.Pool we need: just its live Stat().
// An interface keeps this collector trivially testable.
type poolStatter interface {
	Stat() *pgxpool.Stat
}

// dbPoolCollector turns a pgx connection pool's live Stat() into Prometheus
// gauges/counters. It reads the pool on every scrape (prometheus calls
// Collect), so the numbers are always fresh and nothing needs a background
// goroutine.
type dbPoolCollector struct {
	pool poolStatter

	maxConns      *prometheus.Desc
	totalConns    *prometheus.Desc
	acquiredConns *prometheus.Desc
	idleConns     *prometheus.Desc
	constructing  *prometheus.Desc
	acquireCount  *prometheus.Desc
	acquireWait   *prometheus.Desc
	emptyAcquire  *prometheus.Desc
	newConns      *prometheus.Desc
}

// RegisterDBPool wires a pool's stats onto the app registry. Call once from
// main() after the pool is created.
func RegisterDBPool(pool poolStatter) {
	Registry.MustRegister(newDBPoolCollector(pool))
}

func newDBPoolCollector(pool poolStatter) *dbPoolCollector {
	fq := func(name, help string) *prometheus.Desc {
		return prometheus.NewDesc(prometheus.BuildFQName(namespace, "db_pool", name), help, nil, nil)
	}
	return &dbPoolCollector{
		pool:          pool,
		maxConns:      fq("max_conns", "Maximum size of the connection pool."),
		totalConns:    fq("total_conns", "Total connections currently in the pool (idle + in use)."),
		acquiredConns: fq("acquired_conns", "Connections currently checked out and in use."),
		idleConns:     fq("idle_conns", "Idle connections available for use."),
		constructing:  fq("constructing_conns", "Connections currently being established."),
		acquireCount:  fq("acquire_total", "Cumulative count of successful connection acquisitions."),
		acquireWait:   fq("acquire_wait_seconds_total", "Cumulative time spent blocked waiting for a connection."),
		emptyAcquire:  fq("empty_acquire_total", "Acquisitions that had to wait because the pool was empty."),
		newConns:      fq("new_conns_total", "Cumulative count of new connections opened by the pool."),
	}
}

func (c *dbPoolCollector) Describe(ch chan<- *prometheus.Desc) {
	ch <- c.maxConns
	ch <- c.totalConns
	ch <- c.acquiredConns
	ch <- c.idleConns
	ch <- c.constructing
	ch <- c.acquireCount
	ch <- c.acquireWait
	ch <- c.emptyAcquire
	ch <- c.newConns
}

func (c *dbPoolCollector) Collect(ch chan<- prometheus.Metric) {
	s := c.pool.Stat()
	g := func(d *prometheus.Desc, v float64) {
		ch <- prometheus.MustNewConstMetric(d, prometheus.GaugeValue, v)
	}
	ct := func(d *prometheus.Desc, v float64) {
		ch <- prometheus.MustNewConstMetric(d, prometheus.CounterValue, v)
	}
	g(c.maxConns, float64(s.MaxConns()))
	g(c.totalConns, float64(s.TotalConns()))
	g(c.acquiredConns, float64(s.AcquiredConns()))
	g(c.idleConns, float64(s.IdleConns()))
	g(c.constructing, float64(s.ConstructingConns()))
	ct(c.acquireCount, float64(s.AcquireCount()))
	ct(c.acquireWait, s.AcquireDuration().Seconds())
	ct(c.emptyAcquire, float64(s.EmptyAcquireCount()))
	ct(c.newConns, float64(s.NewConnsCount()))
}
