package http

import (
	"context"
	"errors"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/live"
)

/*
Saying something to one person, and to a party (#181).

Two rooms narrower than the Chronicle, which is already the whole table's.

A direct conversation opens between friends, and ALSO between anybody who
already shares a campaign — the social graph of this app is mostly the tables
you sit at, and making the player beside you send a friend request before they
can ask about next Tuesday would be ceremony. A block closes it in both
directions: the blocker does not want to hear from them, and letting the other
side still send would make it a mute rather than a block.

A party room is for a table that has split (#232). Its door is the DM and
whoever rides with that party at this moment. Riding elsewhere later takes
nothing already said out of the room — a message is a thing that happened, not
a thing the roster owns.

Both refuse with 404 rather than 403, as the rest of the app does for a room
you are not in: whether it exists is not a thing to confirm by probing.
*/

const maxMessageBody = 4000

// messageLimit is how much of a room comes back at once. A room is read from
// its end, and the whole of a long conversation is not a page.
const messageLimit = 200

func trimmedBody(body *api.SendMessageRequest) (string, string) {
	if body == nil {
		return "", "a message needs something in it"
	}
	text := strings.TrimSpace(body.Body)
	if text == "" {
		return "", "a message needs something in it"
	}
	if len([]rune(text)) > maxMessageBody {
		return "", "that is longer than a message — put it in a handout"
	}
	return text, ""
}

// maySpeakTo reports whether these two accounts have a conversation open at
// all: friends, or sharing a table, and never across a block.
func (s *Server) maySpeakTo(ctx context.Context, me, them uuid.UUID) (bool, error) {
	if me == them {
		return false, nil
	}
	blocked, err := s.queries.BlockedBetween(ctx, db.BlockedBetweenParams{BlockerID: me, BlockedID: them})
	if err != nil || blocked {
		return false, err
	}
	friendship, err := s.queries.GetFriendship(ctx, db.GetFriendshipParams{RequesterID: me, AddresseeID: them})
	if err == nil && friendship.State == "accepted" {
		return true, nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}
	return s.queries.ShareATable(ctx, db.ShareATableParams{UserID: me, UserID_2: them})
}

func toAPIMessage(id, authorID uuid.UUID, authorName, body string, at pgtype.Timestamptz, me uuid.UUID) api.Message {
	return api.Message{
		Id: id, AuthorId: authorID, AuthorName: authorName,
		Body: body, CreatedAt: at.Time, Mine: authorID == me,
	}
}

func (s *Server) ListThreads(ctx context.Context, _ api.ListThreadsRequestObject) (api.ListThreadsResponseObject, error) {
	me, ok := auth.UserID(ctx)
	if !ok {
		return api.ListThreads401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	rows, err := s.queries.ListDirectThreads(ctx, me)
	if err != nil {
		return nil, err
	}
	out := make([]api.DirectThread, 0, len(rows))
	for _, r := range rows {
		out = append(out, api.DirectThread{
			PeerId: r.PeerID, PeerName: r.PeerName, PeerImage: r.PeerImage,
			LastBody: r.LastBody, LastAt: r.LastAt.Time,
			LastWasMine: r.LastWasMine, Unread: int(r.Unread),
		})
	}
	// DISTINCT ON forces the query to order by peer, so the recency the inbox
	// is actually read in is applied here.
	sort.SliceStable(out, func(i, j int) bool { return out[i].LastAt.After(out[j].LastAt) })
	return api.ListThreads200JSONResponse(out), nil
}

func (s *Server) ReadThread(ctx context.Context, request api.ReadThreadRequestObject) (api.ReadThreadResponseObject, error) {
	me, ok := auth.UserID(ctx)
	if !ok {
		return api.ReadThread401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	them := uuid.UUID(request.UserId)
	// Reading a thread that already exists is allowed even where a NEW one
	// could not be opened — a friendship ending does not unsay what was said.
	// A block is the exception, and closes the door on the history too.
	blocked, err := s.queries.BlockedBetween(ctx, db.BlockedBetweenParams{BlockerID: me, BlockedID: them})
	if err != nil {
		return nil, err
	}
	if blocked {
		return api.ReadThread404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	rows, err := s.queries.ListDirectMessages(ctx, db.ListDirectMessagesParams{
		SenderID: me, RecipientID: them, Limit: messageLimit,
	})
	if err != nil {
		return nil, err
	}
	out := make([]api.Message, 0, len(rows))
	// The query takes the newest, so the page is turned back the right way up.
	for i := len(rows) - 1; i >= 0; i-- {
		r := rows[i]
		out = append(out, toAPIMessage(r.ID, r.SenderID, r.SenderName, r.Body, r.CreatedAt, me))
	}
	if err := s.queries.MarkDirectRead(ctx, db.MarkDirectReadParams{UserID: me, PeerID: them}); err != nil {
		return nil, err
	}
	return api.ReadThread200JSONResponse(out), nil
}

func (s *Server) SendDirectMessage(ctx context.Context, request api.SendDirectMessageRequestObject) (api.SendDirectMessageResponseObject, error) {
	me, ok := auth.UserID(ctx)
	if !ok {
		return api.SendDirectMessage401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	them := uuid.UUID(request.UserId)
	text, msg := trimmedBody(request.Body)
	if msg != "" {
		return api.SendDirectMessage400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	open, err := s.maySpeakTo(ctx, me, them)
	if err != nil {
		return nil, err
	}
	if !open {
		return api.SendDirectMessage404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	row, err := s.queries.SendDirectMessage(ctx, db.SendDirectMessageParams{
		SenderID: me, RecipientID: them, Body: text,
	})
	if err != nil {
		return nil, err
	}
	name, _ := s.ownerName(ctx, me)
	s.nudge(them, live.TopicMessages)
	return api.SendDirectMessage201JSONResponse(
		toAPIMessage(row.ID, row.SenderID, name, row.Body, row.CreatedAt, me)), nil
}

// requirePartyRoom resolves a party and enforces its door: the DM, or somebody
// whose own heroes ride with it right now.
func (s *Server) requirePartyRoom(ctx context.Context, partyID uuid.UUID) (db.Party, uuid.UUID, error) {
	party, err := s.queries.GetParty(ctx, partyID)
	if err != nil {
		return db.Party{}, uuid.Nil, err
	}
	member, err := s.requireMember(ctx, party.CampaignID)
	if err != nil {
		return db.Party{}, uuid.Nil, err
	}
	if member.Role == db.MembershipRoleDm {
		return party, member.UserID, nil
	}
	mine, err := s.viewerParties(ctx, party.CampaignID, member.UserID)
	if err != nil {
		return db.Party{}, uuid.Nil, err
	}
	if !mine[partyID] {
		return db.Party{}, uuid.Nil, pgx.ErrNoRows
	}
	return party, member.UserID, nil
}

func (s *Server) ListPartyMessages(ctx context.Context, request api.ListPartyMessagesRequestObject) (api.ListPartyMessagesResponseObject, error) {
	party, me, err := s.requirePartyRoom(ctx, uuid.UUID(request.PartyId))
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ListPartyMessages401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		default:
			return api.ListPartyMessages404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
	}
	rows, err := s.queries.ListPartyMessages(ctx, db.ListPartyMessagesParams{
		PartyID: party.ID, Limit: messageLimit,
	})
	if err != nil {
		return nil, err
	}
	out := make([]api.Message, 0, len(rows))
	for i := len(rows) - 1; i >= 0; i-- {
		r := rows[i]
		out = append(out, toAPIMessage(r.ID, r.AuthorID, r.AuthorName, r.Body, r.CreatedAt, me))
	}
	if err := s.queries.MarkPartyRead(ctx, db.MarkPartyReadParams{UserID: me, PartyID: party.ID}); err != nil {
		return nil, err
	}
	return api.ListPartyMessages200JSONResponse(out), nil
}

func (s *Server) SendPartyMessage(ctx context.Context, request api.SendPartyMessageRequestObject) (api.SendPartyMessageResponseObject, error) {
	party, me, err := s.requirePartyRoom(ctx, uuid.UUID(request.PartyId))
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.SendPartyMessage401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		default:
			return api.SendPartyMessage404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
	}
	text, msg := trimmedBody(request.Body)
	if msg != "" {
		return api.SendPartyMessage400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	row, err := s.queries.SendPartyMessage(ctx, db.SendPartyMessageParams{
		PartyID: party.ID, AuthorID: me, Body: text,
	})
	if err != nil {
		return nil, err
	}
	name, _ := s.ownerName(ctx, me)
	// A party room lives inside a campaign, so its nudge rides the campaign's
	// stream: everyone there re-asks, and the ones who may not read it are
	// told nothing by a topic that carries nothing.
	s.publish(party.CampaignID, live.TopicMessages)
	return api.SendPartyMessage201JSONResponse(
		toAPIMessage(row.ID, row.AuthorID, name, row.Body, row.CreatedAt, me)), nil
}
