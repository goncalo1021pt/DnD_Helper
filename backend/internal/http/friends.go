package http

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"sync"
	"time"

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

Discovery is a TAG you hand out, not a search (#387 — it was a code until
then). `Sam#4821` is the display name people already know and four digits that
tell two Sams apart; you type the whole of it or nobody answers. A search box
over accounts would be an enumeration door onto what is meant to be a private
tavern, so the one thing a tag gives up against the old eight-symbol code —
it is ten thousand guesses once you know a name — is paid back by counting the
misses (friendMisses).

The digits are drawn in the database, by a trigger under every write of a name
(migration 77): a rename keeps them unless the new name already wears them.

The refusals are all the same 404, on purpose. A tag nobody holds, a tag held
by somebody who has blocked you, and a tag you have blocked all answer alike —
a block that could be detected by probing would not be much of a block.
*/

// friendTag is how a tag is written: the name, a hash, the four digits.
func friendTag(name, digits string) string { return name + "#" + digits }

// parseFriendTag reads "Sam#4821" back into its name and digits. The split is
// on the LAST hash, so a name with one of its own still reads; the spaces a
// paste brings along do not count, inside the name or around it.
func parseFriendTag(raw string) (name, digits string, ok bool) {
	i := strings.LastIndex(raw, "#")
	if i < 0 {
		return "", "", false
	}
	name = strings.Join(strings.Fields(raw[:i]), " ")
	digits = strings.TrimSpace(raw[i+1:])
	if name == "" || len(digits) != 4 || digits == "0000" {
		return "", "", false
	}
	for _, r := range digits {
		if r < '0' || r > '9' {
			return "", "", false
		}
	}
	return name, digits, true
}

// drawDigits is four digits, 0001-9999, for a tag drawn on request; the
// database draws its own the same way when a name lands on taken digits.
func drawDigits() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(9999))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%04d", n.Int64()+1), nil
}

// tagMissLimit is how many tags that answered nobody a person may try in
// tagMissWindow before the door answers 429. Ten is generous for typos and
// hopeless for walking the ten thousand digits of a name.
const (
	tagMissLimit  = 10
	tagMissWindow = time.Hour
)

// missLedger counts each person's misses. In memory, like the rate limiter:
// one container, and a restart forgiving everyone is fine.
type missLedger struct {
	mu     sync.Mutex
	misses map[uuid.UUID][]time.Time
	now    func() time.Time
}

func newMissLedger() *missLedger {
	return &missLedger{misses: map[uuid.UUID][]time.Time{}, now: time.Now}
}

// wait says how long until who may miss again; zero means they may ask now.
func (l *missLedger) wait(who uuid.UUID) time.Duration {
	if l == nil {
		return 0
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	kept := l.misses[who][:0]
	for _, t := range l.misses[who] {
		if now.Sub(t) < tagMissWindow {
			kept = append(kept, t)
		}
	}
	if len(kept) == 0 {
		delete(l.misses, who)
		return 0
	}
	l.misses[who] = kept
	if len(kept) < tagMissLimit {
		return 0
	}
	return tagMissWindow - now.Sub(kept[0])
}

func (l *missLedger) miss(who uuid.UUID) {
	if l == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.misses[who] = append(l.misses[who], l.now())
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
	out := api.FriendRoll{FriendTag: friendTag(user.Name, user.FriendTag), Friends: []api.Friend{}, Blocked: []api.Friend{}}
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

func (s *Server) NewFriendTag(ctx context.Context, _ api.NewFriendTagRequestObject) (api.NewFriendTagResponseObject, error) {
	me, ok := auth.UserID(ctx)
	if !ok {
		return api.NewFriendTag401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	user, err := s.queries.GetUserByID(ctx, me)
	if err != nil {
		return nil, err
	}
	// New means different: draw until the digits are not the ones held. The
	// trigger then moves them again if somebody of the same name holds them.
	digits := user.FriendTag
	for digits == user.FriendTag {
		if digits, err = drawDigits(); err != nil {
			return nil, err
		}
	}
	if _, err := s.queries.SetFriendTag(ctx, db.SetFriendTagParams{ID: me, FriendTag: digits}); err != nil {
		return nil, err
	}
	roll, err := s.friendRoll(ctx, me)
	if err != nil {
		return nil, err
	}
	return api.NewFriendTag200JSONResponse(roll), nil
}

func (s *Server) AskFriend(ctx context.Context, request api.AskFriendRequestObject) (api.AskFriendResponseObject, error) {
	me, ok := auth.UserID(ctx)
	if !ok {
		return api.AskFriend401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	tag := ""
	if request.Body != nil && request.Body.Tag != nil {
		tag = strings.TrimSpace(*request.Body.Tag)
	}
	byID := request.Body != nil && request.Body.UserId != nil
	if (tag == "") == !byID {
		return api.AskFriend400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "a friend tag or a table-mate is required"}}, nil
	}
	var them db.User
	var err error
	if byID {
		// A table-mate needs no tag (#302); anybody else's id answers as a
		// tag nobody holds, so an id is no way to find a stranger.
		id := uuid.UUID(*request.Body.UserId)
		if id == me {
			return api.AskFriend400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "you cannot befriend yourself"}}, nil
		}
		shared, serr := s.queries.ShareATable(ctx, db.ShareATableParams{UserID: me, UserID_2: id})
		if serr != nil {
			return nil, serr
		}
		if !shared {
			return api.AskFriend404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		them, err = s.queries.GetUserByID(ctx, id)
		if err != nil {
			return nil, err
		}
	} else {
		// The ceiling is read before the lookup, so a guesser past it learns
		// nothing more — not even whether this guess would have hit.
		if wait := s.friendMisses.wait(me); wait > 0 {
			mins := int(wait.Minutes()) + 1
			return api.AskFriend429JSONResponse{TooManyRequestsJSONResponse: api.TooManyRequestsJSONResponse{
				Error: fmt.Sprintf("too many tags that answered nobody — try again in %d minutes", mins),
			}}, nil
		}
		name, digits, ok := parseFriendTag(tag)
		if !ok {
			return api.AskFriend400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
				Error: "a tag is a name, #, and four digits — like Sam#4821",
			}}, nil
		}
		them, err = s.queries.GetUserByFriendTag(ctx, db.GetUserByFriendTagParams{Name: name, Tag: digits})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				s.friendMisses.miss(me)
				return api.AskFriend404JSONResponse{NotFoundJSONResponse: notFound()}, nil
			}
			return nil, err
		}
	}
	if them.ID == me {
		return api.AskFriend400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{
			Error: "that is your own tag — hand it to somebody else",
		}}, nil
	}
	// A block answers exactly as a tag nobody holds does, and counts as the
	// same miss, or the ceiling would tell the two apart.
	blocked, err := s.queries.BlockedBetween(ctx, db.BlockedBetweenParams{BlockerID: me, BlockedID: them.ID})
	if err != nil {
		return nil, err
	}
	if blocked {
		if !byID {
			s.friendMisses.miss(me)
		}
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
