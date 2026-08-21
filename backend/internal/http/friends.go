package http

import (
	"context"
	"crypto/rand"
	"errors"
	"math/big"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/live"
)

/*
Friends, across the tables (#181).

Campaign chat already existed and is called the Chronicle. What did not was
knowing somebody OUTSIDE a campaign, which is what this is: a link between two
accounts that no campaign owns and that outlives any of them.

Discovery is a CODE you hand out, not a search. The app already has exactly
this idiom for campaigns, and it is right here for the same reasons: a search
box over accounts is an enumeration door onto what is meant to be a private
tavern, and half these accounts arrived through Google and have no username to
be found by. A code is given deliberately, to one person, and can be reforged
when it has been given to one person too many.

The refusals are all the same 404, on purpose. A code nobody holds, a code held
by somebody who has blocked you, and a code you have blocked all answer alike —
a block that could be detected by probing would not be much of a block.
*/

// friendCodeAlphabet leaves out the characters people misread aloud, because
// this is a thing read over a table or a voice call: no O/0, no I/1/L.
const friendCodeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

const friendCodeLen = 8

func newFriendCode() (string, error) {
	out := make([]byte, friendCodeLen)
	for i := range out {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(friendCodeAlphabet))))
		if err != nil {
			return "", err
		}
		out[i] = friendCodeAlphabet[n.Int64()]
	}
	return string(out), nil
}

// friendDirection reads a row from one side: who asked, and whether it stands.
func friendDirection(row db.ListFriendshipsRow, me uuid.UUID) api.FriendDirection {
	if row.State == "accepted" {
		return api.Mutual
	}
	if row.RequesterID == me {
		return api.Asked
	}
	return api.Invited
}

// friendRoll assembles everything the friends screen shows in one read.
func (s *Server) friendRoll(ctx context.Context, me uuid.UUID) (api.FriendRoll, error) {
	user, err := s.queries.GetUserByID(ctx, me)
	if err != nil {
		return api.FriendRoll{}, err
	}
	rows, err := s.queries.ListFriendships(ctx, me)
	if err != nil {
		return api.FriendRoll{}, err
	}
	out := api.FriendRoll{FriendCode: user.FriendCode, Friends: []api.Friend{}, Blocked: []api.Friend{}}
	for _, r := range rows {
		// The CASE that picks "the other one" comes back untyped, so it is
		// asserted here rather than trusted.
		other, ok := r.OtherID.([16]byte)
		if !ok {
			continue
		}
		out.Friends = append(out.Friends, api.Friend{
			UserId:    uuid.UUID(other),
			Name:      r.OtherName,
			Image:     r.OtherImage,
			State:     api.FriendState(r.State),
			Direction: friendDirection(r, me),
			Since:     r.CreatedAt.Time,
		})
	}
	blocked, err := s.queries.ListBlocked(ctx, me)
	if err != nil {
		return api.FriendRoll{}, err
	}
	for _, b := range blocked {
		out.Blocked = append(out.Blocked, api.Friend{
			UserId: b.BlockedID, Name: b.BlockedName,
			State: api.Accepted, Direction: api.Mutual,
		})
	}
	return out, nil
}

// rollResponse is the shape almost every friends door answers with: the whole
// roll, so a client never has to reason about what one act changed.
func (s *Server) rollFor(ctx context.Context) (api.FriendRoll, uuid.UUID, bool, error) {
	me, ok := auth.UserID(ctx)
	if !ok {
		return api.FriendRoll{}, uuid.Nil, false, nil
	}
	roll, err := s.friendRoll(ctx, me)
	return roll, me, true, err
}

func (s *Server) ListFriends(ctx context.Context, _ api.ListFriendsRequestObject) (api.ListFriendsResponseObject, error) {
	roll, _, ok, err := s.rollFor(ctx)
	if !ok {
		return api.ListFriends401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	if err != nil {
		return nil, err
	}
	return api.ListFriends200JSONResponse(roll), nil
}

func (s *Server) ReforgeFriendCode(ctx context.Context, _ api.ReforgeFriendCodeRequestObject) (api.ReforgeFriendCodeResponseObject, error) {
	me, ok := auth.UserID(ctx)
	if !ok {
		return api.ReforgeFriendCode401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	// Retry on the (vanishingly rare) collision, exactly as the invite code does.
	for attempt := 0; attempt < 5; attempt++ {
		code, err := newFriendCode()
		if err != nil {
			return nil, err
		}
		if _, err := s.queries.SetFriendCode(ctx, db.SetFriendCodeParams{ID: me, FriendCode: code}); err != nil {
			if isUniqueViolation(err) {
				continue
			}
			return nil, err
		}
		roll, err := s.friendRoll(ctx, me)
		if err != nil {
			return nil, err
		}
		return api.ReforgeFriendCode200JSONResponse(roll), nil
	}
	return nil, errors.New("could not draw a fresh friend code")
}

func (s *Server) AskFriend(ctx context.Context, request api.AskFriendRequestObject) (api.AskFriendResponseObject, error) {
	me, ok := auth.UserID(ctx)
	if !ok {
		return api.AskFriend401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	if request.Body == nil || strings.TrimSpace(request.Body.FriendCode) == "" {
		return api.AskFriend400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "a friend code is required"}}, nil
	}
	them, err := s.queries.GetUserByFriendCode(ctx, strings.TrimSpace(request.Body.FriendCode))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.AskFriend404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if them.ID == me {
		return api.AskFriend400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "that is your own code — hand it to somebody else",
		}}, nil
	}
	// A block answers exactly as a code nobody holds does.
	blocked, err := s.queries.BlockedBetween(ctx, db.BlockedBetweenParams{BlockerID: me, BlockedID: them.ID})
	if err != nil {
		return nil, err
	}
	if blocked {
		return api.AskFriend404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}

	existing, err := s.queries.GetFriendship(ctx, db.GetFriendshipParams{RequesterID: me, AddresseeID: them.ID})
	switch {
	case err != nil && !errors.Is(err, pgx.ErrNoRows):
		return nil, err
	case err == nil && existing.State == "accepted":
		// Already friends; asking again is a no-op rather than an error.
	case err == nil && existing.RequesterID == them.ID:
		// They asked first. Two people asking each other means yes.
		if _, err := s.queries.AcceptFriendship(ctx, db.AcceptFriendshipParams{
			RequesterID: them.ID, AddresseeID: me,
		}); err != nil {
			return nil, err
		}
		s.nudge(them.ID, live.TopicFriends)
	case err == nil:
		// Our own request, still waiting. Asking twice does not ask louder.
	default:
		if _, err := s.queries.AskFriendship(ctx, db.AskFriendshipParams{
			RequesterID: me, AddresseeID: them.ID,
		}); err != nil {
			return nil, err
		}
		s.nudge(them.ID, live.TopicFriends)
	}

	roll, err := s.friendRoll(ctx, me)
	if err != nil {
		return nil, err
	}
	return api.AskFriend200JSONResponse(roll), nil
}

func (s *Server) AcceptFriend(ctx context.Context, request api.AcceptFriendRequestObject) (api.AcceptFriendResponseObject, error) {
	me, ok := auth.UserID(ctx)
	if !ok {
		return api.AcceptFriend401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	them := uuid.UUID(request.UserId)
	if _, err := s.queries.AcceptFriendship(ctx, db.AcceptFriendshipParams{
		RequesterID: them, AddresseeID: me,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Nothing was asked of you. Not a thing to explain further.
			return api.AcceptFriend404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	s.nudge(them, live.TopicFriends)
	roll, err := s.friendRoll(ctx, me)
	if err != nil {
		return nil, err
	}
	return api.AcceptFriend200JSONResponse(roll), nil
}

func (s *Server) DropFriend(ctx context.Context, request api.DropFriendRequestObject) (api.DropFriendResponseObject, error) {
	me, ok := auth.UserID(ctx)
	if !ok {
		return api.DropFriend401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	them := uuid.UUID(request.UserId)
	// Withdrawing, declining and parting ways are one act: the row goes. What
	// was said is not deleted with it — a conversation you both had is not the
	// friendship's to erase.
	if _, err := s.queries.DropFriendship(ctx, db.DropFriendshipParams{
		RequesterID: me, AddresseeID: them,
	}); err != nil {
		return nil, err
	}
	s.nudge(them, live.TopicFriends)
	roll, err := s.friendRoll(ctx, me)
	if err != nil {
		return nil, err
	}
	return api.DropFriend200JSONResponse(roll), nil
}

func (s *Server) BlockUser(ctx context.Context, request api.BlockUserRequestObject) (api.BlockUserResponseObject, error) {
	me, ok := auth.UserID(ctx)
	if !ok {
		return api.BlockUser401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	them := uuid.UUID(request.UserId)
	if them == me {
		roll, err := s.friendRoll(ctx, me)
		if err != nil {
			return nil, err
		}
		return api.BlockUser200JSONResponse(roll), nil
	}
	if err := s.queries.BlockUser(ctx, db.BlockUserParams{BlockerID: me, BlockedID: them}); err != nil {
		return nil, err
	}
	// Blocking parts you as well. Staying friends with somebody you have
	// blocked is a state that would only ever confuse whoever read it.
	if _, err := s.queries.DropFriendship(ctx, db.DropFriendshipParams{
		RequesterID: me, AddresseeID: them,
	}); err != nil {
		return nil, err
	}
	s.nudge(them, live.TopicFriends)
	roll, err := s.friendRoll(ctx, me)
	if err != nil {
		return nil, err
	}
	return api.BlockUser200JSONResponse(roll), nil
}

func (s *Server) UnblockUser(ctx context.Context, request api.UnblockUserRequestObject) (api.UnblockUserResponseObject, error) {
	me, ok := auth.UserID(ctx)
	if !ok {
		return api.UnblockUser401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	// Lifting a block does not restore the friendship it ended; that has to be
	// asked for again, which is the honest thing for it to mean.
	if _, err := s.queries.UnblockUser(ctx, db.UnblockUserParams{
		BlockerID: me, BlockedID: uuid.UUID(request.UserId),
	}); err != nil {
		return nil, err
	}
	roll, err := s.friendRoll(ctx, me)
	if err != nil {
		return nil, err
	}
	return api.UnblockUser200JSONResponse(roll), nil
}
