package auth

import (
	"net/http"
	"time"

	"github.com/alexedwards/scs/pgxstore"
	"github.com/alexedwards/scs/v2"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewSessionManager configures an scs session manager backed by Postgres.
func NewSessionManager(pool *pgxpool.Pool, secure bool) *scs.SessionManager {
	m := scs.New()
	m.Store = pgxstore.New(pool)
	m.Lifetime = 30 * 24 * time.Hour
	m.Cookie.Name = "session"
	m.Cookie.HttpOnly = true
	m.Cookie.SameSite = http.SameSiteLaxMode
	m.Cookie.Secure = secure // true behind HTTPS in production
	m.Cookie.Path = "/"
	return m
}
