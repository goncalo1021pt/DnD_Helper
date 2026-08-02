package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/config"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

/*
Operator commands, run on the box (#111).

A user who loses both their authenticator and their recovery codes is locked
out, and the fix was undocumented SQL typed into production by hand.

This is deliberately a command and deliberately not an endpoint. Clearing 2FA is
a credential-compromise amplifier: any route to it turns "attacker needs the
password AND the device" into "attacker needs the password" for whoever they
point it at. An endpoint would be reachable from the internet every second of
every day to serve something that may happen never, and would need an admin
concept this app has correctly avoided having. A command needs shell on the
production host — which the operator already has, and which is both the
strongest authentication available here and impossible to phish.

It is what the closest comparable projects settled on: GitLab, Mastodon and
Nextcloud all disable a user's 2FA from a console or CLI rather than a page.

Nothing destructive happens without --confirm. The default run prints who would
be touched, because the realistic failure of hand-written SQL is not being
attacked, it is a missing WHERE clause at eleven at night.
*/

const adminUsage = `Quest Board operator commands — run on the production host.

  unlock-2fa   Clear a user's two-factor auth after they lose both their
               authenticator and their recovery codes.

Usage:
  server admin unlock-2fa --login <username-or-email> [--note "..."] [--confirm]

Without --confirm nothing is written: it prints who matched so you can check
the name before acting.

Examples:
  server admin unlock-2fa --login player@example.com
  server admin unlock-2fa --login bryn --note "verified on Discord voice" --confirm
`

// runAdmin dispatches the operator subcommands. Returns an error for the caller
// to print and exit on.
func runAdmin(args []string) error {
	if len(args) == 0 {
		fmt.Print(adminUsage)
		return errors.New("no admin command given")
	}
	switch args[0] {
	case "unlock-2fa":
		return runUnlock2FA(args[1:])
	case "help", "-h", "--help":
		fmt.Print(adminUsage)
		return nil
	default:
		fmt.Print(adminUsage)
		return fmt.Errorf("unknown admin command %q", args[0])
	}
}

func runUnlock2FA(args []string) error {
	fs := flag.NewFlagSet("unlock-2fa", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)
	login := fs.String("login", "", "the user's username or email")
	note := fs.String("note", "", "how you verified they are who they say — recorded in the trail")
	confirm := fs.Bool("confirm", false, "actually clear it; without this, nothing is written")
	fs.Usage = func() { fmt.Print(adminUsage) }
	if err := fs.Parse(args); err != nil {
		return err
	}
	if strings.TrimSpace(*login) == "" {
		fs.Usage()
		return errors.New("--login is required")
	}

	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	q := db.New(pool)

	user, err := q.GetLocalUserByLogin(ctx, strings.TrimSpace(*login))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Said plainly: two-factor auth is only ever on password accounts,
			// so "no match" usually means they signed in with Discord or Google
			// and their provider holds the second factor, not us.
			return fmt.Errorf("no password account matches %q — if they sign in with Discord or Google, their provider holds their second factor and there is nothing to clear here", *login)
		}
		return err
	}

	codes, err := q.CountUnusedRecoveryCodes(ctx, user.ID)
	if err != nil {
		return err
	}

	fmt.Printf("\n  user     %s <%s>\n", user.Name, emailOf(user))
	fmt.Printf("  id       %s\n", user.ID)
	if user.TotpEnabled {
		fmt.Printf("  2FA      ON, %d recovery code(s) unused\n\n", codes)
	} else {
		fmt.Printf("  2FA      off already, %d recovery code(s) unused\n\n", codes)
	}

	if !user.TotpEnabled && codes == 0 {
		fmt.Println("  Nothing to clear. They can sign in with their password.")
		return nil
	}

	if !*confirm {
		fmt.Println("  Nothing written. Check the name above, then re-run with --confirm.")
		return nil
	}

	// Both halves, or the account is left half-locked: an authenticator gone
	// but codes still live is a worse state than either end.
	if err := q.DisableTOTP(ctx, user.ID); err != nil {
		return err
	}
	if err := q.DeleteRecoveryCodes(ctx, user.ID); err != nil {
		return err
	}
	if err := q.RecordAdminAction(ctx, db.RecordAdminActionParams{
		Action:       "unlock-2fa",
		TargetUserID: pgUUID(user.ID),
		TargetLabel:  fmt.Sprintf("%s <%s>", user.Name, emailOf(user)),
		Note:         strings.TrimSpace(*note),
	}); err != nil {
		// The account is already unlocked at this point; failing here would
		// leave the operator thinking it had not worked and doing it again.
		fmt.Printf("  WARNING: unlocked, but the trail could not be written: %v\n", err)
	}

	fmt.Printf("  Cleared for %s <%s>\n", user.Name, emailOf(user))
	fmt.Println("    · authenticator removed")
	fmt.Printf("    · %d recovery code(s) burned\n", codes)
	if strings.TrimSpace(*note) == "" {
		fmt.Println("    · no note recorded — next time, say how you verified them")
	}
	fmt.Println("\n  They sign in with their password alone now.")
	fmt.Println("  Tell them to set two-factor up again straight away.")
	return nil
}

// emailOf reads an account's email for display. It is nullable in the schema,
// so an account without one prints as "no email" rather than crashing the one
// command someone runs when they are already locked out.
func emailOf(u db.User) string {
	if u.Email == nil || strings.TrimSpace(*u.Email) == "" {
		return "no email"
	}
	return *u.Email
}

// pgUUID is the http package's helper, which is not importable from here.
func pgUUID(id uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: id, Valid: true}
}
