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
	oauth := auth.NewOAuth(sessions, db.New(pool), devEnabled, cfg.LocalAuth, mailer, cfg.BaseURL)

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

	go func() {
		log.Printf("listening on %s (env=%s)", cfg.Addr, cfg.Env)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, stdhttp.ErrServerClosed) {
			log.Printf("server error: %v", err)
			stop()
		}
	}()

	<-ctx.Done()
	log.Println("shutting down...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}
