package main

import (
	"context"
	"errors"
	"log"
	stdhttp "net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/config"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	apphttp "github.com/goncalo1021pt/questboard/backend/internal/http"
	"github.com/goncalo1021pt/questboard/backend/internal/mail"
	"github.com/goncalo1021pt/questboard/backend/internal/metrics"
	"github.com/goncalo1021pt/questboard/backend/internal/rules"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("fatal: %v", err)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Apply database migrations on startup.
	if err := db.RunMigrations(cfg.DatabaseURL); err != nil {
		return err
	}

	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	// Expose connection-pool health on /metrics.
	metrics.RegisterDBPool(pool)

	// Seed/refresh the SRD rules content (idempotent upsert).
	if err := rules.Seed(ctx, db.New(pool)); err != nil {
		return err
	}

	// Auth: register OAuth providers and a Postgres-backed session manager.
	auth.RegisterProviders(cfg)
	sessions := auth.NewSessionManager(pool, cfg.IsProduction())
	devEnabled := !cfg.IsProduction()
	if devEnabled {
		log.Println("auth: DEV LOGIN ENABLED — no password required; never expose this build publicly")
	}
	mailer := mail.New(cfg.ResendAPIKey, cfg.MailFrom)
	oauth := auth.NewOAuth(sessions, db.New(pool), devEnabled, cfg.LocalAuth, mailer, cfg.BaseURL, cfg.SessionKey)

	router := apphttp.NewRouter(apphttp.Deps{
		Pool:           pool,
		SessionManager: sessions,
		OAuth:          oauth,
	})

	srv := &stdhttp.Server{
		Addr:              cfg.Addr,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
	}

	// Private metrics server on a SEPARATE port. The Cloudflare tunnel only
	// routes to the app port, so /metrics can never leak publicly — it is
	// reachable only over the LAN/VPN (or the internal docker network, where
	// Prometheus scrapes it).
	metricsMux := stdhttp.NewServeMux()
	metricsMux.Handle("/metrics", metrics.Handler())
	metricsSrv := &stdhttp.Server{
		Addr:              cfg.MetricsAddr,
		Handler:           metricsMux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("listening on %s (env=%s)", cfg.Addr, cfg.Env)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, stdhttp.ErrServerClosed) {
			log.Printf("server error: %v", err)
			stop()
		}
	}()

	go func() {
		log.Printf("metrics listening on %s/metrics", cfg.MetricsAddr)
		if err := metricsSrv.ListenAndServe(); err != nil && !errors.Is(err, stdhttp.ErrServerClosed) {
			log.Printf("metrics server error: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("shutting down...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = metricsSrv.Shutdown(shutdownCtx)
	return srv.Shutdown(shutdownCtx)
}
