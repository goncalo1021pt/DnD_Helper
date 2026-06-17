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

	// Auth: register OAuth providers and a Postgres-backed session manager.
	auth.RegisterProviders(cfg)
	sessions := auth.NewSessionManager(pool, cfg.IsProduction())
	oauth := auth.NewOAuth(sessions, db.New(pool), !cfg.IsProduction())

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
