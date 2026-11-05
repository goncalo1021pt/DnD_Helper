// Package notify is the subscriber that reaches people OUTSIDE the app (#316):
// an email per event to whoever in the audience asked for it, and the
// unsubscribe link every such email carries. A Discord channel is not here —
// it is a webhook wearing a different body, in package webhooks.
package notify

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"log"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/events"
	"github.com/goncalo1021pt/questboard/backend/internal/mail"
)

// Defaults is what a new account is told about until it says otherwise: the
// next gathering, and a handout to them. Nothing else — an inbox is not a
// feed.
var Defaults = []events.Name{events.SessionScheduled, events.SessionMoved, events.HandoutGiven}

// Offered reports whether an event may be emailed AS IT HAPPENS. A chronicle
// line per email is a flood; that one is for the daily digest (#339) alone,
// and is refused here so "now" cannot even be chosen for it.
func Offered(n events.Name) bool {
	return n != events.ChronicleWritten
}

// WantsDaily reports whether a person put this event in their daily digest.
// There are no defaults to fall back on: a digest is opt-in, so nobody
// receives one they did not choose.
func WantsDaily(digest []string, n events.Name) bool {
	for _, c := range digest {
		if c == string(n) {
			return true
		}
	}
	return false
}

// Wants reads a person's choice: NULL in the column (useDefaults) means the
// defaults, anything else is exactly the list, empty included.
func Wants(chosen []string, useDefaults bool, n events.Name) bool {
	if !Offered(n) {
		return false
	}
	if useDefaults {
		for _, d := range Defaults {
			if d == n {
				return true
			}
		}
		return false
	}
	for _, c := range chosen {
		if c == string(n) {
			return true
		}
	}
	return false
}

// Options wire a Service.
type Options struct {
	Mailer  mail.Mailer // nil sends nothing
	BaseURL string      // where links point
	Key     string      // the session key; the unsubscribe token is derived from it
}

// Service is the email subscriber and the unsubscribe token's keeper.
type Service struct {
	q    *db.Queries
	opts Options
	key  []byte
	// send is what a test replaces to watch what would go out.
	send func(ctx context.Context, m mail.Message) error
}

func New(pool *pgxpool.Pool, opts Options) *Service {
	s := &Service{q: db.New(pool), opts: opts, key: deriveKey(opts.Key)}
	if opts.Mailer != nil {
		s.send = opts.Mailer.Send
	}
	return s
}

// NewTokens is a Service that only mints and checks unsubscribe tokens —
// what a test of the door needs, with no pool behind it.
func NewTokens(key string) *Service {
	return &Service{key: deriveKey(key)}
}

func deriveKey(sessionKey string) []byte {
	k := sha256.Sum256([]byte("questboard-unsubscribe:" + sessionKey))
	return k[:]
}

// Subscriber is the bus subscriber: one email per person in the audience
// who asked for this event, has a confirmed address, and has not muted the
// table. The reads happen on the request; the sending does not — a slow
// mail provider must not hold a handler.
func (s *Service) Subscriber() events.Subscriber {
	return func(ctx context.Context, e events.Event) {
		if s.send == nil || len(e.Audience) == 0 {
			return
		}
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		rows, err := s.q.ListEmailRecipients(ctx, db.ListEmailRecipientsParams{Column1: e.Audience, CampaignID: e.Campaign})
		if err != nil {
			log.Printf("notify: recipients for %s: %v", e.Name, err)
			return
		}
		var to, later []db.ListEmailRecipientsRow
		for _, r := range rows {
			switch {
			case r.Email == nil:
			case Wants(r.EmailEvents, r.UseDefaults, e.Name):
				to = append(to, r)
			case WantsDaily(r.EmailDigestEvents, e.Name):
				later = append(later, r)
			}
		}
		if len(to) == 0 && len(later) == 0 {
			return
		}
		h := events.Happening{Name: e.Name, Payload: events.AsMap(e.Payload)}
		if c, err := s.q.GetCampaign(ctx, e.Campaign); err == nil {
			h.Campaign = c.Name
		}
		if e.Actor != uuid.Nil {
			if u, err := s.q.GetUserByID(ctx, e.Actor); err == nil {
				h.Actor = u.Name
			}
		}
		line := events.Describe(h, humanTime)
		s.hold(ctx, e, later, line)
		if len(to) == 0 {
			return
		}
		link := s.tableLink(e.Campaign)
		go s.deliver(to, e.Name, h.Campaign, line, link)
	}
}

// hold keeps a line for the daily digest (#339), rendered now so the
// audience and the veil stay the emitter's decision, due at each person's hour.
func (s *Service) hold(ctx context.Context, e events.Event, who []db.ListEmailRecipientsRow, line string) {
	now := time.Now()
	for _, r := range who {
		err := s.q.InsertDigestItem(ctx, db.InsertDigestItemParams{
			UserID:     pgtype.UUID{Bytes: r.ID, Valid: true},
			CampaignID: e.Campaign,
			EventID:    pgtype.UUID{Bytes: e.ID, Valid: e.ID != uuid.Nil},
			Name:       string(e.Name),
			Line:       line,
			DueAt:      pgtype.Timestamptz{Time: events.NextDigest(now, int(r.DigestHour)), Valid: true},
		})
		if err != nil {
			log.Printf("notify: hold %s for %s: %v", e.Name, r.ID, err)
		}
	}
}

func (s *Service) deliver(to []db.ListEmailRecipientsRow, name events.Name, campaign, line, link string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	for _, r := range to {
		token := s.UnsubscribeToken(r.ID)
		m := mail.Notification(mail.Notice{
			Line:     line,
			Campaign: campaign,
			Link:     link,
			Unsub:    s.unsubscribePage(token),
			OneClick: s.unsubscribeAPI(token),
		})
		m.To = *r.Email
		if err := s.send(ctx, m); err != nil {
			log.Printf("notify: %s to %s: %v", name, r.ID, err)
		}
	}
}

func humanTime(t time.Time) string {
	return t.UTC().Format("Mon 2 Jan 2006, 15:04 UTC")
}

func (s *Service) base() string { return strings.TrimRight(s.opts.BaseURL, "/") }

func (s *Service) tableLink(campaign uuid.UUID) string {
	return s.base() + "/questboard/campaigns/" + campaign.String()
}

// unsubscribePage is the link in the body: a page that asks before it acts,
// since a link scanner follows what it finds.
func (s *Service) unsubscribePage(token string) string {
	return s.base() + "/unsubscribe?token=" + url.QueryEscape(token)
}

// unsubscribeAPI is the List-Unsubscribe URL: a mail client POSTs to it
// (RFC 8058, one click) and it acts; a browser GETs it and is sent to the page.
func (s *Service) unsubscribeAPI(token string) string {
	return s.base() + "/api/notifications/unsubscribe?token=" + url.QueryEscape(token)
}

// UnsubscribeToken names a person to the unsubscribe door without a row to
// keep: the id and an HMAC of it under a key derived from the session key.
// It does not expire — a link in an old email must still work — and it can
// only ever do one thing, so there is nothing to steal by holding it.
func (s *Service) UnsubscribeToken(userID uuid.UUID) string {
	mac := hmac.New(sha256.New, s.key)
	mac.Write(userID[:])
	return base64.RawURLEncoding.EncodeToString(append(userID[:], mac.Sum(nil)...))
}

// ParseUnsubscribeToken is the check: who it names, when it is genuine.
func (s *Service) ParseUnsubscribeToken(token string) (uuid.UUID, bool) {
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(token))
	if err != nil || len(raw) != 16+sha256.Size {
		return uuid.Nil, false
	}
	var id uuid.UUID
	copy(id[:], raw[:16])
	mac := hmac.New(sha256.New, s.key)
	mac.Write(id[:])
	if subtle.ConstantTimeCompare(mac.Sum(nil), raw[16:]) != 1 {
		return uuid.Nil, false
	}
	return id, true
}

// Unsubscribe turns every email off for whoever the token names: an empty
// list, which is a choice and not the defaults.
func (s *Service) Unsubscribe(ctx context.Context, token string) error {
	id, ok := s.ParseUnsubscribeToken(token)
	if !ok {
		return ErrBadToken
	}
	u, err := s.q.GetEmailEvents(ctx, id)
	if err != nil {
		return err
	}
	// Everything off — and what was waiting for the digest goes with it.
	if err := s.q.SetEmailDigest(ctx, db.SetEmailDigestParams{ID: id, EmailEvents: []string{}, EmailDigestEvents: []string{}, DigestHour: u.DigestHour}); err != nil {
		return err
	}
	return s.q.DeleteUserDigest(ctx, pgtype.UUID{Bytes: id, Valid: true})
}

// ErrBadToken is an unsubscribe token that names nobody.
var ErrBadToken = errBadToken{}

type errBadToken struct{}

func (errBadToken) Error() string { return "that unsubscribe link is not one of ours" }
