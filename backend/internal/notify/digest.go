package notify

import (
	"context"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/mail"
)

// Run is the digest worker (#339): once a minute, send whoever has lines
// whose hour has struck one email, until ctx ends.
func (s *Service) Run(ctx context.Context) {
	if s.send == nil {
		return
	}
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.SendDueDigests(ctx)
		}
	}
}

// SendDueDigests claims every person's due lines by deleting them and sends
// each person one email, a section per table. Nothing due sends nothing; a
// line for someone who can no longer be mailed (address unconfirmed, account
// leaving) is dropped rather than kept for a day that may never come.
func (s *Service) SendDueDigests(ctx context.Context) int {
	if s.send == nil {
		return 0
	}
	if err := s.q.DropUnmailableDigest(ctx); err != nil {
		log.Printf("notify: digest sweep: %v", err)
	}
	who, err := s.q.ListUsersWithDueDigest(ctx)
	if err != nil {
		log.Printf("notify: digest recipients: %v", err)
		return 0
	}
	sent := 0
	for _, u := range who {
		if u.Email == nil {
			continue
		}
		rows, err := s.q.ClaimEmailDigest(ctx, pgUUID(u.ID))
		if err != nil {
			log.Printf("notify: digest claim for %s: %v", u.ID, err)
			continue
		}
		if len(rows) == 0 {
			continue
		}
		var tables []mail.DigestTable
		at := map[uuid.UUID]int{}
		for _, r := range rows {
			i, ok := at[r.CampaignID]
			if !ok {
				i = len(tables)
				at[r.CampaignID] = i
				tables = append(tables, mail.DigestTable{Name: r.CampaignName, Link: s.tableLink(r.CampaignID)})
			}
			tables[i].Lines = append(tables[i].Lines, r.Line)
		}
		token := s.UnsubscribeToken(u.ID)
		m := mail.Digest(mail.DigestMail{Tables: tables, Link: s.base() + "/questboard", Unsub: s.unsubscribePage(token), OneClick: s.unsubscribeAPI(token)})
		m.To = *u.Email
		if err := s.send(ctx, m); err != nil {
			log.Printf("notify: digest to %s: %v", u.ID, err)
			continue
		}
		sent++
	}
	return sent
}

func pgUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }
