package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/goncalo1021pt/questboard/backend/internal/accounts"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/config"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/mail"
)

/*
Deleting an account from the shell (#322): for somebody who asks by email
rather than from their profile. It does what the profile does — schedule, with
the week's grace — and can purge at once (--now) when the request is an erasure
and the week is not wanted, or undo a scheduled one (--cancel) without anybody
typing SQL against production.

The trail names nobody: an admin_actions row that kept the address of the
person it deleted would be a copy of the thing being erased. The account's id
is what ties the row to the tombstone it leaves.
*/

func runDeleteAccount(args []string) error {
	fs := flag.NewFlagSet("delete-account", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	login := fs.String("login", "", "the user's username or email")
	now := fs.Bool("now", false, "purge at once, without the week's grace")
	cancel := fs.Bool("cancel", false, "undo a scheduled deletion")
	note := fs.String("note", "", "who asked and how — recorded in the trail")
	confirm := fs.Bool("confirm", false, "actually do it; without this, nothing is written")
	fs.Usage = func() { fmt.Print(adminUsage) }
	if err := fs.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*login) == "" {
		fs.Usage()
		return errors.New("--login is required")
	}
	if *now && *cancel {
		return errors.New("--now and --cancel cannot be used together")
	}

	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, stop := context.WithTimeout(context.Background(), 60*time.Second)
	defer stop()
	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	q := db.New(pool)

	user, err := q.FindLiveUserForOperator(ctx, strings.TrimSpace(*login))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("no live account matches %q — it may already be deleted", *login)
		}
		return err
	}
	owned, err := q.ListCampaignsOwnedBy(ctx, user.ID)
	if err != nil {
		return err
	}
	tables, err := q.ListMembershipCampaignsOfUser(ctx, user.ID)
	if err != nil {
		return err
	}
	heroes, err := q.CountCharactersOfUser(ctx, user.ID)
	if err != nil {
		return err
	}

	fmt.Printf("\n  user     %s <%s>\n  id       %s\n", user.Name, emailOf(user), user.ID)
	fmt.Printf("  sits at  %d table(s), %d hero(es)\n", len(tables), heroes)
	if user.DeletionRequestedAt.Valid {
		fmt.Printf("  status   scheduled since %s\n", user.DeletionRequestedAt.Time.UTC().Format("2006-01-02 15:04 UTC"))
	} else {
		fmt.Println("  status   not scheduled")
	}
	label := "account " + user.ID.String()
	people := accounts.New(pool, accounts.Options{
		Mailer: mail.New(cfg.ResendAPIKey, cfg.MailFrom), BaseURL: cfg.BaseURL, Grace: cfg.AccountDeletionGrace,
	})

	if *cancel {
		if !user.DeletionRequestedAt.Valid {
			fmt.Println("\n  Nothing scheduled, so nothing to cancel.")
			return nil
		}
		if !*confirm {
			fmt.Println("\n  Nothing written. Check the account above, then re-run with --confirm.")
			return nil
		}
		if _, err := q.CancelAccountDeletion(ctx, user.ID); err != nil {
			return err
		}
		trail(ctx, q, "account_deletion_cancelled", user, label, *note)
		fmt.Println("\n  Cancelled. They can sign in as before; their API tokens stay revoked.")
		return nil
	}

	if len(owned) > 0 {
		names := make([]string, 0, len(owned))
		for _, c := range owned {
			names = append(names, c.Name)
		}
		fmt.Printf("  owns     %s\n", strings.Join(names, ", "))
		return errors.New("they still own a campaign: it must be handed over or disbanded first, by them or from the database")
	}
	fmt.Println("  owns     nothing")

	if !*confirm {
		fmt.Printf("\n  Nothing written. With --confirm this would %s.\n", map[bool]string{
			true:  "purge the account NOW: heroes and everything personal struck, history kept as 'a departed player'",
			false: fmt.Sprintf("schedule the deletion for %d days from now and sign them out everywhere", people.GraceDays()),
		}[*now])
		return nil
	}

	stamp, err := q.RequestAccountDeletion(ctx, user.ID)
	if err != nil {
		return err
	}
	if err := q.RevokeAPITokensOfUser(ctx, user.ID); err != nil {
		return err
	}
	if err := auth.EndSessionsOf(ctx, auth.NewSessionManager(pool, cfg.IsProduction()), user.ID); err != nil {
		return fmt.Errorf("could not end their sessions: %w", err)
	}

	if *now {
		if err := people.Purge(ctx, user.ID, "operator"); err != nil {
			return err
		}
		trail(ctx, q, "account_deleted_now", user, label, *note)
		fmt.Println("\n  Purged. The account is a tombstone now.")
		return nil
	}

	due := stamp.Time.Add(cfg.AccountDeletionGrace)
	if user.Email != nil && user.EmailVerified {
		subject, htmlBody, textBody := mail.DeletionScheduled(due.UTC().Format("Monday 2 January 2006"), cfg.BaseURL)
		if err := mail.New(cfg.ResendAPIKey, cfg.MailFrom).Send(ctx, mail.Message{To: *user.Email, Subject: subject, HTML: htmlBody, Text: textBody}); err != nil {
			fmt.Printf("  WARNING: scheduled, but the email could not be sent: %v\n", err)
		}
	}
	trail(ctx, q, "account_deletion_scheduled", user, label, *note)
	fmt.Printf("\n  Scheduled for %s. They are signed out everywhere; signing in again cancels it.\n", due.UTC().Format("2006-01-02"))
	return nil
}

// trail records the action without naming the person: see the note above.
func trail(ctx context.Context, q *db.Queries, action string, user db.User, label, note string) {
	if err := q.RecordAdminAction(ctx, db.RecordAdminActionParams{
		Action: action, TargetUserID: pgUUID(user.ID), TargetLabel: label, Note: strings.TrimSpace(note),
	}); err != nil {
		fmt.Printf("  WARNING: done, but the trail could not be written: %v\n", err)
	}
}
