// Package accounts deletes people (#322).
//
// A deleted account is anonymised in place, not removed: the users row stays as
// a tombstone — "a departed player", no address, no avatar, no password, no way
// in — so every foreign key that points at it keeps working. The other side of
// a conversation keeps theirs, a chronicle line keeps its place, a quest keeps
// its author, and not one reader had to learn that deletion exists. What is
// personal is struck explicitly, in one transaction, and what a person ran for
// the table (the bodies of the Folk a co-DM forged, an ally they steered) goes
// back to the table rather than dying with them.
//
// Deletion is scheduled first and purged a week later (Grace), and signing in
// in between cancels it — that lives with the sign-in doors; this package is
// the purge and the sweep that runs it.
package accounts

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/mail"
	"github.com/goncalo1021pt/questboard/backend/internal/metrics"
)

// Grace is how long a scheduled deletion waits, unless configured otherwise.
const Grace = 7 * 24 * time.Hour

// TombstoneName is what a departed account is called wherever it is still read.
const TombstoneName = "a departed player"

// ErrOwnsTable means the account still owns a campaign. A table is handed over
// or disbanded before its owner can go; the purge refuses, and the account
// stays scheduled until it is so.
var ErrOwnsTable = errors.New("the account still owns a campaign")

// Options is what the service reaches out for. Every field may be zero: no
// mailer sends nothing, no publish tells nobody.
type Options struct {
	Mailer  mail.Mailer
	BaseURL string
	Grace   time.Duration
	// Publish nudges a table's open streams that its roster changed.
	Publish func(campaignID uuid.UUID)
}

type Service struct {
	pool *pgxpool.Pool
	q    *db.Queries
	opts Options
}

func New(pool *pgxpool.Pool, opts Options) *Service {
	if opts.Grace <= 0 {
		opts.Grace = Grace
	}
	return &Service{pool: pool, q: db.New(pool), opts: opts}
}

// SetPublish says how to nudge a table's open streams that its roster changed.
// It is set after construction because the hub is built with the router, which
// is built after the service that has to be running for it.
func (s *Service) SetPublish(f func(campaignID uuid.UUID)) { s.opts.Publish = f }

// GraceDays is the grace in whole days, as the profile words it.
func (s *Service) GraceDays() int { return int(s.opts.Grace.Hours() / 24) }

// LeaveTable removes a person's presence at one table: the seat, the heroes
// that only existed for it, the claims still in play, the party and the door
// queue. Heroes are unseated rather than deleted — a player who walks away
// keeps them in My Heroes. It is the leaving the app already did (a kick, a
// ban, a walk-out) lifted out so the purge does not keep a second copy.
func LeaveTable(ctx context.Context, q *db.Queries, userID, campaignID uuid.UUID) error {
	if _, err := q.DeleteMembership(ctx, db.DeleteMembershipParams{UserID: userID, CampaignID: campaignID}); err != nil {
		return err
	}
	cid := pgUUID(campaignID)
	if err := q.DeleteTableBornOfUser(ctx, db.DeleteTableBornOfUserParams{OwnerUserID: userID, CampaignID: cid}); err != nil {
		return err
	}
	if err := q.UnseatCharactersOfUser(ctx, db.UnseatCharactersOfUserParams{OwnerUserID: userID, CampaignID: cid}); err != nil {
		return err
	}
	if err := q.ReleaseQuestClaimsOfUser(ctx, db.ReleaseQuestClaimsOfUserParams{UserID: userID, CampaignID: campaignID}); err != nil {
		return err
	}
	if err := q.ClearPartyForUserAtCampaign(ctx, db.ClearPartyForUserAtCampaignParams{OwnerUserID: userID, CampaignID: cid}); err != nil {
		return err
	}
	return q.DeleteSeatRequestsOfUser(ctx, db.DeleteSeatRequestsOfUserParams{OwnerUserID: userID, CampaignID: campaignID})
}

// Purge anonymises one scheduled account. It is a no-op for an account that is
// not scheduled, already gone, or locked by another purge, and ErrOwnsTable for
// one that still owns a campaign. trigger labels the metric: "sweep" or
// "operator".
func (s *Service) Purge(ctx context.Context, userID uuid.UUID, trigger string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	locked, err := q.LockUserForPurge(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	owned, err := q.ListCampaignsOwnedBy(ctx, userID)
	if err != nil {
		return err
	}
	if len(owned) > 0 {
		return ErrOwnsTable
	}

	// What they ran for the table goes back to it, before their heroes go.
	if err := q.HandBodiesToOwners(ctx, userID); err != nil {
		return err
	}
	if err := q.ReturnAlliesToDM(ctx, pgUUID(userID)); err != nil {
		return err
	}
	tables, err := q.ListMembershipCampaignsOfUser(ctx, userID)
	if err != nil {
		return err
	}
	for _, c := range tables {
		if err := LeaveTable(ctx, q, userID, c); err != nil {
			return fmt.Errorf("leave table %s: %w", c, err)
		}
	}

	// What is theirs alone. The order is not decoration: homebrew goes after
	// the heroes, whose class rows would otherwise still point at it.
	for _, strike := range []struct {
		what string
		do   func(context.Context, uuid.UUID) error
	}{
		{"heroes", q.DeleteCharactersOfUser},
		{"realms", q.DeleteRealmsOfUser},
		{"identities", q.DeleteIdentitiesOfUser},
		{"email tokens", q.DeleteEmailTokensOfUser},
		{"api tokens", q.DeleteAPITokensOfUser},
		{"webhooks", func(ctx context.Context, id uuid.UUID) error { return q.DeleteWebhooksOfUser(ctx, pgUUID(id)) }},
		{"digest", func(ctx context.Context, id uuid.UUID) error { return q.DeleteUserDigest(ctx, pgUUID(id)) }},
		{"recovery codes", q.DeleteRecoveryCodes},
		{"friendships", q.DeleteFriendshipsOfUser},
		{"blocks", q.DeleteBlocksOfUser},
		{"direct reads", q.DeleteDirectReadsOfUser},
		{"party reads", q.DeletePartyReadsOfUser},
		{"bans", q.DeleteBansOfUser},
		{"homebrew", func(ctx context.Context, id uuid.UUID) error { return q.DeleteUnadmittedHomebrewOf(ctx, pgUUID(id)) }},
	} {
		if err := strike.do(ctx, userID); err != nil {
			return fmt.Errorf("strike %s: %w", strike.what, err)
		}
	}

	if err := q.ScrubUser(ctx, userID); err != nil {
		return err
	}
	// The audit row names nobody: the tombstone's id is what ties it to the
	// history it left behind.
	if err := q.RecordAdminAction(ctx, db.RecordAdminActionParams{
		Action: "account_deleted", TargetUserID: pgUUID(userID), TargetLabel: TombstoneName, Note: trigger,
	}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	metrics.AccountDeleted(trigger)

	// After the commit, best effort: the person is gone either way.
	if s.opts.Mailer != nil && locked.Email != nil && locked.EmailVerified {
		subject, htmlBody, textBody := mail.AccountDeleted(s.opts.BaseURL)
		if err := s.opts.Mailer.Send(ctx, mail.Message{To: *locked.Email, Subject: subject, HTML: htmlBody, Text: textBody}); err != nil {
			log.Printf("accounts: farewell: %v", err)
		}
	}
	if s.opts.Publish != nil {
		for _, c := range tables {
			s.opts.Publish(c)
		}
	}
	return nil
}

// Sweep purges every account scheduled before cutoff and reports how many went.
// An account that still owns a table is logged and left scheduled.
func (s *Service) Sweep(ctx context.Context, cutoff time.Time, trigger string) (int, error) {
	due, err := s.q.ListUsersDueForPurge(ctx, db.ListUsersDueForPurgeParams{
		DeletionRequestedAt: pgTime(cutoff), Limit: 50,
	})
	if err != nil {
		return 0, err
	}
	purged := 0
	for _, id := range due {
		switch err := s.Purge(ctx, id, trigger); {
		case errors.Is(err, ErrOwnsTable):
			log.Printf("accounts: %s is due but still owns a campaign; left scheduled", id)
		case err != nil:
			log.Printf("accounts: purge %s: %v", id, err)
		default:
			purged++
		}
	}
	return purged, nil
}

// Run sweeps once an hour. The grace is a week, so a coarse tick loses nothing.
func (s *Service) Run(ctx context.Context) {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if n, err := s.Sweep(ctx, time.Now().Add(-s.opts.Grace), "sweep"); err != nil && ctx.Err() == nil {
				log.Printf("accounts: sweep: %v", err)
			} else if n > 0 {
				log.Printf("accounts: purged %d account(s)", n)
			}
		}
	}
}
