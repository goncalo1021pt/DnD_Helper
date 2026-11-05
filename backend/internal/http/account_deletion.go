package http

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/accounts"
	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/mail"
)

/*
Deleting an account (#322): ask, wait a week, and be anonymised in place — the
purge itself lives in internal/accounts. This file is the asking.

Three ways to confirm, because an account may have three kinds of proof: a
password account types its password (as turning 2FA off does); one that signs
in through Discord or Google has none to type, so a link goes to its confirmed
address and the page it opens asks again before acting — the mail proves the
address and the session proves the account, and neither alone is enough; and
an account with neither a password nor a confirmed address types its name,
which is all there is to ask. Every operation is session-only: a token may not
take an account away from its owner.

Scheduling does four things at once and in this order: it stamps the day, stops
every API token, ends every session including this one, and tells the address
on file. Signing in again is the cancel (internal/auth, signIn), which is why a
scheduled account is signed out everywhere — there is nothing else to cancel
from.
*/

const (
	methodPassword = "password"
	methodEmail    = "email"
	methodName     = "name"

	deletionLinkTTL      = time.Hour
	deletionLinkThrottle = time.Minute
	deletionPurpose      = "delete"
)

// deletionMethod is how this account proves it means it.
func deletionMethod(u db.User) string {
	if u.PasswordHash != nil && *u.PasswordHash != "" {
		return methodPassword
	}
	if u.Email != nil && *u.Email != "" && u.EmailVerified {
		return methodEmail
	}
	return methodName
}

func deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func (s *Server) graceDays() int {
	if s.accounts != nil {
		return s.accounts.GraceDays()
	}
	return int(accounts.Grace.Hours() / 24)
}

func (s *Server) grace() time.Duration {
	if s.accounts != nil {
		return time.Duration(s.accounts.GraceDays()) * 24 * time.Hour
	}
	return accounts.Grace
}

// deletionBlockers are the tables the caller owns: handed over or disbanded
// before their owner can go.
func (s *Server) deletionBlockers(ctx context.Context, uid uuid.UUID) ([]api.AccountDeletionBlocker, error) {
	rows, err := s.queries.ListCampaignsOwnedBy(ctx, uid)
	if err != nil {
		return nil, err
	}
	out := make([]api.AccountDeletionBlocker, 0, len(rows))
	for _, r := range rows {
		out = append(out, api.AccountDeletionBlocker{CampaignId: r.ID, Name: r.Name})
	}
	return out, nil
}

func blockedMessage(blockers []api.AccountDeletionBlocker) string {
	names := make([]string, 0, len(blockers))
	for _, b := range blockers {
		names = append(names, b.Name)
	}
	return "you still own " + strings.Join(names, ", ") + ": hand each table over or disband it first"
}

func (s *Server) GetAccountDeletion(ctx context.Context, _ api.GetAccountDeletionRequestObject) (api.GetAccountDeletionResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.GetAccountDeletion401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	user, err := s.queries.GetUserByID(ctx, uid)
	if err != nil {
		return nil, err
	}
	blockers, err := s.deletionBlockers(ctx, uid)
	if err != nil {
		return nil, err
	}
	return api.GetAccountDeletion200JSONResponse{
		Method: api.AccountDeletionMethod(deletionMethod(user)), GraceDays: s.graceDays(), Blockers: blockers,
	}, nil
}

func (s *Server) RequestAccountDeletion(ctx context.Context, request api.RequestAccountDeletionRequestObject) (api.RequestAccountDeletionResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.RequestAccountDeletion401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	bad := func(msg string) (api.RequestAccountDeletionResponseObject, error) {
		return api.RequestAccountDeletion400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	if request.Body == nil {
		return bad("the request could not be read")
	}
	// The ceiling is read before the password is, so a guesser at an open
	// session learns nothing past it — not even whether this guess was right.
	if wait := s.deletionMisses.wait(uid); wait > 0 {
		return api.RequestAccountDeletion429JSONResponse{TooManyRequestsJSONResponse: api.TooManyRequestsJSONResponse{
			Error: fmt.Sprintf("too many wrong answers — try again in %d minutes", int(wait.Minutes())+1),
		}}, nil
	}
	user, err := s.queries.GetUserByID(ctx, uid)
	if err != nil {
		return nil, err
	}
	switch deletionMethod(user) {
	case methodPassword:
		if !auth.CheckPassword(*user.PasswordHash, deref(request.Body.Password)) {
			s.deletionMisses.miss(uid)
			return api.RequestAccountDeletion403JSONResponse{ForbiddenJSONResponse: api.ForbiddenJSONResponse{Error: "that password is incorrect"}}, nil
		}
	case methodName:
		if !strings.EqualFold(strings.TrimSpace(deref(request.Body.Name)), user.Name) {
			s.deletionMisses.miss(uid)
			return api.RequestAccountDeletion403JSONResponse{ForbiddenJSONResponse: api.ForbiddenJSONResponse{Error: "type your account name exactly to confirm"}}, nil
		}
	default:
		return bad("this account confirms by email: ask for the link first")
	}
	blockers, err := s.deletionBlockers(ctx, uid)
	if err != nil {
		return nil, err
	}
	if len(blockers) > 0 {
		return bad(blockedMessage(blockers))
	}
	at, err := s.scheduleDeletion(ctx, user)
	if err != nil {
		return nil, err
	}
	return api.RequestAccountDeletion200JSONResponse{ScheduledFor: at}, nil
}

func (s *Server) SendAccountDeletionLink(ctx context.Context, _ api.SendAccountDeletionLinkRequestObject) (api.SendAccountDeletionLinkResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.SendAccountDeletionLink401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	bad := func(msg string) (api.SendAccountDeletionLinkResponseObject, error) {
		return api.SendAccountDeletionLink400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	user, err := s.queries.GetUserByID(ctx, uid)
	if err != nil {
		return nil, err
	}
	if deletionMethod(user) != methodEmail {
		return bad("this account confirms with its password or its name, not a link")
	}
	// Refused before a mail is made for a request that could not go through.
	blockers, err := s.deletionBlockers(ctx, uid)
	if err != nil {
		return nil, err
	}
	if len(blockers) > 0 {
		return bad(blockedMessage(blockers))
	}
	recent, err := s.queries.CountRecentEmailTokens(ctx, db.CountRecentEmailTokensParams{
		UserID: uid, Purpose: deletionPurpose, CreatedAt: pgtype.Timestamptz{Time: time.Now().Add(-deletionLinkThrottle), Valid: true},
	})
	if err != nil {
		return nil, err
	}
	if recent > 0 {
		return api.SendAccountDeletionLink429JSONResponse{TooManyRequestsJSONResponse: api.TooManyRequestsJSONResponse{
			Error: "a link was just sent — give it a minute, and check your spam folder",
		}}, nil
	}
	// One live link at a time: asking again spends the one before it.
	if err := s.queries.InvalidateUserTokens(ctx, db.InvalidateUserTokensParams{UserID: uid, Purpose: deletionPurpose}); err != nil {
		return nil, err
	}
	raw, hash := auth.NewEmailToken()
	if _, err := s.queries.CreateEmailToken(ctx, db.CreateEmailTokenParams{
		UserID: uid, Purpose: deletionPurpose, TokenHash: hash,
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(deletionLinkTTL), Valid: true},
	}); err != nil {
		return nil, err
	}
	if s.mailer != nil {
		subject, htmlBody, textBody := mail.DeleteAccountLink(s.baseURL + "/confirm-deletion?token=" + url.QueryEscape(raw))
		if err := s.mailer.Send(ctx, mail.Message{To: *user.Email, Subject: subject, HTML: htmlBody, Text: textBody}); err != nil {
			log.Printf("deletion: send link to %s: %v", *user.Email, err)
		}
	}
	return api.SendAccountDeletionLink202Response{}, nil
}

func (s *Server) ConfirmAccountDeletion(ctx context.Context, request api.ConfirmAccountDeletionRequestObject) (api.ConfirmAccountDeletionResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.ConfirmAccountDeletion401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	bad := func(msg string) (api.ConfirmAccountDeletionResponseObject, error) {
		return api.ConfirmAccountDeletion400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	if request.Body == nil || strings.TrimSpace(request.Body.Token) == "" {
		return bad("the link is missing its token")
	}
	const gone = "that link is not valid any more — ask for another"
	tok, err := s.queries.GetEmailToken(ctx, auth.HashEmailToken(strings.TrimSpace(request.Body.Token)))
	if errors.Is(err, pgx.ErrNoRows) {
		return bad(gone)
	}
	if err != nil {
		return nil, err
	}
	// The mail proves the address and the session proves the account: a link
	// that reaches somebody else's browser does nothing there.
	if tok.Purpose != deletionPurpose || tok.UserID != uid {
		return bad(gone)
	}
	blockers, err := s.deletionBlockers(ctx, uid)
	if err != nil {
		return nil, err
	}
	if len(blockers) > 0 {
		return bad(blockedMessage(blockers))
	}
	user, err := s.queries.GetUserByID(ctx, uid)
	if err != nil {
		return nil, err
	}
	if err := s.queries.UseEmailToken(ctx, tok.ID); err != nil {
		return nil, err
	}
	at, err := s.scheduleDeletion(ctx, user)
	if err != nil {
		return nil, err
	}
	return api.ConfirmAccountDeletion200JSONResponse{ScheduledFor: at}, nil
}

// scheduleDeletion is what every way of confirming ends in. Asking twice never
// pushes the day back (the stamp keeps its first value). The mail is best
// effort: the deletion stands whether or not it arrives.
func (s *Server) scheduleDeletion(ctx context.Context, user db.User) (time.Time, error) {
	stamp, err := s.queries.RequestAccountDeletion(ctx, user.ID)
	if err != nil {
		return time.Time{}, err
	}
	due := stamp.Time.Add(s.grace())
	if err := s.queries.RevokeAPITokensOfUser(ctx, user.ID); err != nil {
		return time.Time{}, err
	}
	if s.sessions != nil {
		if err := auth.EndSessionsOf(ctx, s.sessions, user.ID); err != nil {
			return time.Time{}, err
		}
		// And the one this request rides on, which the store pass cannot reach.
		if err := auth.Logout(ctx, s.sessions); err != nil {
			return time.Time{}, err
		}
	}
	if s.mailer != nil && user.Email != nil && user.EmailVerified {
		subject, htmlBody, textBody := mail.DeletionScheduled(due.UTC().Format("Monday 2 January 2006"), s.baseURL)
		if err := s.mailer.Send(ctx, mail.Message{To: *user.Email, Subject: subject, HTML: htmlBody, Text: textBody}); err != nil {
			log.Printf("deletion: scheduled mail to %s: %v", *user.Email, err)
		}
	}
	return due, nil
}

// devPurgeAccounts runs the purge as if the week were up. With ?id= it purges
// that one account if it is scheduled, so a spec can drive its own account
// without sweeping up everyone else's; without, it sweeps every scheduled
// account. Mounted only outside production.
func (s *Server) devPurgeAccounts(w http.ResponseWriter, r *http.Request) {
	purged := 0
	if raw := r.URL.Query().Get("id"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			http.Error(w, "bad id", http.StatusBadRequest)
			return
		}
		pending, err := s.queries.IsPendingDeletion(r.Context(), id)
		if err != nil {
			http.Error(w, "lookup failed", http.StatusInternalServerError)
			return
		}
		if pending {
			if err := s.accounts.Purge(r.Context(), id, "sweep"); err != nil {
				http.Error(w, err.Error(), http.StatusConflict)
				return
			}
			purged = 1
		}
	} else {
		n, err := s.accounts.Sweep(r.Context(), time.Now().Add(time.Hour), "sweep")
		if err != nil {
			http.Error(w, "sweep failed", http.StatusInternalServerError)
			return
		}
		purged = n
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]int{"purged": purged})
}
