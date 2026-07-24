package config

import (
	"fmt"
	"os"
	"strings"

	"github.com/joho/godotenv"
)

// Config holds all runtime configuration, sourced from environment variables.
type Config struct {
	Addr        string // host:port the HTTP server binds to
	MetricsAddr string // host:port for the private Prometheus /metrics listener
	DatabaseURL string // postgres connection string
	SessionKey  string // secret used to sign session cookies
	BaseURL     string // public base URL, used to build OAuth callback URLs
	Env         string // "development" | "production"

	LocalAuth bool // whether username/password accounts are offered

	ResendAPIKey string // Resend API key; empty ⇒ emails are logged, not sent
	MailFrom     string // "From" header for transactional email

	Discord OAuthProvider
	Google  OAuthProvider
}

// OAuthProvider holds credentials for a single OAuth provider.
type OAuthProvider struct {
	ClientID     string
	ClientSecret string
}

func (p OAuthProvider) Enabled() bool {
	return p.ClientID != "" && p.ClientSecret != ""
}

// Load reads configuration from the environment. In development it first
// attempts to load a .env file from the working directory (best-effort).
func Load() (*Config, error) {
	// Best-effort: load .env from the working dir or a parent (the server is
	// typically run from backend/ while .env lives at the repo root). The first
	// file found wins; real environment variables always take precedence over
	// anything godotenv would set, so this is safe in containers too.
	for _, p := range []string{".env", "../.env", "../../.env"} {
		if _, err := os.Stat(p); err == nil {
			_ = godotenv.Load(p)
			break
		}
	}

	cfg := &Config{
		Addr:         getenv("APP_ADDR", ":8080"),
		MetricsAddr:  getenv("METRICS_ADDR", ":9091"),
		DatabaseURL:  os.Getenv("DATABASE_URL"),
		SessionKey:   os.Getenv("SESSION_KEY"),
		BaseURL:      getenv("BASE_URL", "http://localhost:8080"),
		Env:          getenv("APP_ENV", "development"),
		LocalAuth:    getenv("LOCAL_AUTH_ENABLED", "true") != "false",
		ResendAPIKey: os.Getenv("RESEND_API_KEY"),
		MailFrom:     getenv("MAIL_FROM", "Quest Board <no-reply@fontao.net>"),
		Discord: OAuthProvider{
			ClientID:     os.Getenv("DISCORD_CLIENT_ID"),
			ClientSecret: os.Getenv("DISCORD_CLIENT_SECRET"),
		},
		Google: OAuthProvider{
			ClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
			ClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
		},
	}

	var missing []string
	if cfg.DatabaseURL == "" {
		missing = append(missing, "DATABASE_URL")
	}
	if cfg.SessionKey == "" {
		missing = append(missing, "SESSION_KEY")
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("missing required env vars: %s", strings.Join(missing, ", "))
	}

	return cfg, nil
}

func (c *Config) IsProduction() bool { return c.Env == "production" }

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
