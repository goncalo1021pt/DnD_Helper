// Package webhooks delivers the event catalogue (#315) to URLs people chose
// (#295): the fan-out that turns an event into one delivery per matching
// subscription, and the worker that posts them with retries.
package webhooks

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/events"
	"github.com/goncalo1021pt/questboard/backend/internal/mail"
	"github.com/goncalo1021pt/questboard/backend/internal/metrics"
)

const (
	// MaxPerUser caps subscriptions per account.
	MaxPerUser = 10
	// maxAttempts is how many times one delivery is tried before it is dead.
	maxAttempts = 5
	// disableAfter is how many deliveries may die in a row before the hook is
	// disabled — roughly a day of a URL that is simply gone.
	disableAfter = 8
	// claimBatch bounds one tick of the worker.
	claimBatch = 10
	// maxResponse is how much of a reply is read; a receiver's body is not
	// something to store, only its status.
	maxResponse = 64 << 10
)

// backoff is the wait after the nth failed attempt (1-based); after the last
// entry the next failure is death.
var backoff = []time.Duration{time.Minute, 5 * time.Minute, 30 * time.Minute, 2 * time.Hour}

// Options wire a Service.
type Options struct {
	Guard     Guard
	Mailer    mail.Mailer // the disabled-hook email; nil sends nothing
	BaseURL   string      // where that email's link points
	UserAgent string
	Tick      time.Duration // how often the worker looks for due deliveries
}

// Service is the fan-out and the worker, over one pool.
type Service struct {
	pool   *pgxpool.Pool
	q      *db.Queries
	opts   Options
	client *http.Client
	now    func() time.Time
}

func New(pool *pgxpool.Pool, opts Options) *Service {
	if opts.Tick <= 0 {
		opts.Tick = 2 * time.Second
	}
	if opts.UserAgent == "" {
		opts.UserAgent = "QuestBoard-Hookshot"
	}
	return &Service{pool: pool, q: db.New(pool), opts: opts, client: opts.Guard.Client(), now: time.Now}
}

// Guard exposes the URL policy to the handler that registers a hook.
func (s *Service) Guard() Guard { return s.opts.Guard }

// Envelope is what a receiver gets: the catalogue envelope without the
// audience, plus the table's name. A ping has no campaign.
type Envelope struct {
	ID       uuid.UUID         `json:"id"`
	Name     string            `json:"name"`
	At       time.Time         `json:"at"`
	Campaign *EnvelopeCampaign `json:"campaign,omitempty"`
	Actor    *EnvelopeActor    `json:"actor,omitempty"`
	Payload  any               `json:"payload"`
}

type EnvelopeCampaign struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

type EnvelopeActor struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}

// ReadScopeOf is the read scope an event belongs to — what a token-born hook
// must hold to hear it. A hero's events are heroes:read; everything else at
// a table is campaigns:read.
func ReadScopeOf(name events.Name) auth.Scope {
	switch name {
	case events.HeroLevelled, events.HeroXPAwarded:
		return auth.HeroesRead
	default:
		return auth.CampaignsRead
	}
}

// Hears reports whether a hook wants this event, by its own three filters:
// the one table it was confined to, the names it picked, and — for a hook
// born of a token — the scopes that token held. The audience is not checked
// here: the caller already selected the hooks of the people in it.
func Hears(h db.Webhook, campaign uuid.UUID, name events.Name) bool {
	if h.CampaignID.Valid && uuid.UUID(h.CampaignID.Bytes) != campaign {
		return false
	}
	if len(h.Events) > 0 {
		found := false
		for _, e := range h.Events {
			if e == string(name) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	if h.Scopes != nil {
		var held auth.Scopes
		for _, raw := range h.Scopes {
			if sc, ok := auth.ParseScope(raw); ok {
				held = append(held, sc)
			}
		}
		if !held.Holds(ReadScopeOf(name)) {
			return false
		}
	}
	return true
}

// Fanout is the bus subscriber: one delivery row per hook that hears the
// event, written beside the outbox and off the request's cancellation.
func (s *Service) Fanout() events.Subscriber {
	return func(ctx context.Context, e events.Event) {
		if len(e.Audience) == 0 {
			return
		}
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		hooks, err := s.q.ListLiveWebhooksForUsers(ctx, e.Audience)
		if err != nil {
			log.Printf("webhooks: fan-out %s: %v", e.Name, err)
			return
		}
		var body []byte
		for _, h := range hooks {
			if !Hears(h, e.Campaign, e.Name) {
				continue
			}
			if body == nil {
				env, err := s.envelope(ctx, e)
				if err != nil {
					log.Printf("webhooks: envelope %s: %v", e.Name, err)
					return
				}
				body = env
			}
			if _, err := s.q.InsertWebhookDelivery(ctx, db.InsertWebhookDeliveryParams{
				WebhookID: h.ID,
				EventID:   pgtype.UUID{Bytes: e.ID, Valid: true},
				Name:      string(e.Name),
				Body:      body,
			}); err != nil {
				log.Printf("webhooks: queue %s for %s: %v", e.Name, h.ID, err)
			}
		}
	}
}

func (s *Service) envelope(ctx context.Context, e events.Event) ([]byte, error) {
	env := Envelope{ID: e.ID, Name: string(e.Name), At: e.At, Payload: e.Payload}
	if e.Payload == nil {
		env.Payload = map[string]any{}
	}
	if c, err := s.q.GetCampaign(ctx, e.Campaign); err == nil {
		env.Campaign = &EnvelopeCampaign{ID: c.ID, Name: c.Name}
	}
	if e.Actor != uuid.Nil {
		if u, err := s.q.GetUserByID(ctx, e.Actor); err == nil {
			env.Actor = &EnvelopeActor{ID: u.ID, Name: u.Name}
		}
	}
	return json.Marshal(env)
}

// Ping queues a test delivery for one hook and returns the delivery's id.
func (s *Service) Ping(ctx context.Context, hookID uuid.UUID) (uuid.UUID, error) {
	body, err := json.Marshal(Envelope{
		ID: uuid.New(), Name: "ping", At: s.now(),
		Payload: map[string]any{"webhookId": hookID, "message": "Quest Board can reach you."},
	})
	if err != nil {
		return uuid.Nil, err
	}
	row, err := s.q.InsertWebhookDelivery(ctx, db.InsertWebhookDeliveryParams{WebhookID: hookID, Name: "ping", Body: body})
	if err != nil {
		return uuid.Nil, err
	}
	return row.ID, nil
}

// Run is the worker: every tick, claim what is due and post it, until ctx ends.
func (s *Service) Run(ctx context.Context) {
	t := time.NewTicker(s.opts.Tick)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := s.deliverDue(ctx); err != nil && ctx.Err() == nil {
				log.Printf("webhooks: worker: %v", err)
			}
		}
	}
}

// deliverDue claims one batch under a transaction, posts each, and records
// the outcome before the lock is released.
func (s *Service) deliverDue(ctx context.Context) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	qtx := s.q.WithTx(tx)
	due, err := qtx.ClaimDueWebhookDeliveries(ctx, claimBatch)
	if err != nil {
		return err
	}
	for _, d := range due {
		status, err := s.post(ctx, d)
		switch {
		case err == nil:
			metrics.WebhookDelivery("delivered")
			if err := qtx.MarkWebhookDelivered(ctx, db.MarkWebhookDeliveredParams{ID: d.ID, LastStatus: &status}); err != nil {
				return err
			}
			if err := qtx.RecordWebhookSuccess(ctx, d.WebhookID); err != nil {
				return err
			}
		case int(d.Attempts)+1 >= maxAttempts:
			metrics.WebhookDelivery("dead")
			msg := err.Error()
			if err := qtx.MarkWebhookDeliveryDead(ctx, db.MarkWebhookDeliveryDeadParams{ID: d.ID, LastStatus: statusOrNil(status), LastError: &msg}); err != nil {
				return err
			}
			failures, err := qtx.RecordWebhookDeadDelivery(ctx, d.WebhookID)
			if err != nil {
				return err
			}
			if failures >= disableAfter {
				reason := fmt.Sprintf("%d deliveries in a row could not be delivered; the last said: %s", failures, msg)
				if err := qtx.DisableWebhook(ctx, db.DisableWebhookParams{ID: d.WebhookID, DisabledReason: &reason}); err != nil {
					return err
				}
				s.notifyDisabled(ctx, d.UserID, d.Url)
			}
		default:
			metrics.WebhookDelivery("retry")
			msg := err.Error()
			next := s.now().Add(backoff[min(int(d.Attempts), len(backoff)-1)])
			if err := qtx.MarkWebhookDeliveryFailed(ctx, db.MarkWebhookDeliveryFailedParams{
				ID: d.ID, NextAttemptAt: pgtype.Timestamptz{Time: next, Valid: true}, LastStatus: statusOrNil(status), LastError: &msg,
			}); err != nil {
				return err
			}
		}
	}
	return tx.Commit(ctx)
}

func statusOrNil(status int32) *int32 {
	if status == 0 {
		return nil
	}
	return &status
}

// post makes one attempt. A 2xx is success; anything else, or no answer at
// all, is a failure with the status (0 when nobody answered).
func (s *Service) post(ctx context.Context, d db.ClaimDueWebhookDeliveriesRow) (int32, error) {
	ts := s.now().Unix()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, d.Url, bytes.NewReader(d.Body))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", s.opts.UserAgent)
	req.Header.Set("X-QuestBoard-Event", d.Name)
	req.Header.Set("X-QuestBoard-Delivery", d.ID.String())
	req.Header.Set("X-QuestBoard-Timestamp", strconv.FormatInt(ts, 10))
	req.Header.Set("X-QuestBoard-Signature", Sign(d.Secret, ts, d.Body))
	res, err := s.client.Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, maxResponse))
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return int32(res.StatusCode), fmt.Errorf("the receiver answered %d", res.StatusCode)
	}
	return int32(res.StatusCode), nil
}

// notifyDisabled tells the owner, when they have a confirmed address.
func (s *Service) notifyDisabled(ctx context.Context, userID uuid.UUID, url string) {
	if s.opts.Mailer == nil {
		return
	}
	u, err := s.q.GetUserByID(ctx, userID)
	if err != nil || u.Email == nil || !u.EmailVerified {
		return
	}
	subject, html, text := mail.WebhookDisabled(url, s.opts.BaseURL+"/questboard/profile")
	if err := s.opts.Mailer.Send(ctx, *u.Email, subject, html, text); err != nil {
		log.Printf("webhooks: disabled email to %s: %v", userID, err)
	}
}
