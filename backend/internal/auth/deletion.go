package auth

import (
	"context"
	"log"

	"github.com/alexedwards/scs/v2"
	"github.com/google/uuid"

	"github.com/goncalo1021pt/questboard/backend/internal/mail"
)

// signIn is Login for every door that proves who somebody is (#322): it makes
// the session, and then undoes a scheduled account deletion — signing in again
// IS the cancel, because a scheduled account is signed out everywhere and has
// no other way back in. The cancel is best effort; failing to clear it must
// never stop somebody signing in.
func (o *OAuth) signIn(ctx context.Context, userID uuid.UUID) error {
	if err := Login(ctx, o.sm, userID); err != nil {
		return err
	}
	n, err := o.queries.CancelAccountDeletion(ctx, userID)
	if err != nil {
		log.Printf("auth: cancel deletion of %s: %v", userID, err)
		return nil
	}
	if n == 0 || o.mailer == nil {
		return nil
	}
	// Tell the address on file: the one tripwire for somebody who signed in to
	// an account its owner had meant to delete.
	user, err := o.queries.GetUserByID(ctx, userID)
	if err != nil || user.Email == nil || !user.EmailVerified {
		return nil
	}
	subject, htmlBody, textBody := mail.DeletionCancelled(o.baseURL)
	if err := o.mailer.Send(ctx, mail.Message{To: *user.Email, Subject: subject, HTML: htmlBody, Text: textBody}); err != nil {
		log.Printf("auth: deletion-cancelled mail to %s: %v", *user.Email, err)
	}
	return nil
}

// NewEmailToken and HashEmailToken let a handler outside this package mint and
// check the one-time links email carries, so there is one way a link is made.
func NewEmailToken() (raw, hash string) { return newEmailToken() }

func HashEmailToken(raw string) string { return hashToken(raw) }

// EndSessionsOf destroys every stored session that belongs to userID (#322):
// scheduling a deletion signs the account out of every browser it is open in,
// not only the one that asked. A handler also logs out the session it is
// riding on; the operator's shell has none and needs only this.
func EndSessionsOf(ctx context.Context, sm *scs.SessionManager, userID uuid.UUID) error {
	want := userID.String()
	return sm.Iterate(ctx, func(ctx context.Context) error {
		if sm.GetString(ctx, sessionUserKey) == want {
			return sm.Destroy(ctx)
		}
		return nil
	})
}
