package http

import (
	"context"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

/*
Multiclassing (#190), the read half.

A hero is a list of classes. `character_classes` holds the levels;
`characters.class_id` keeps the different fact that it is the class they
*started* as, which the 2024 rules single out — you take full starting
proficiencies from that one and a reduced set from every class after it
(PHB 2024, p.44).

Everything here is display and resolution. Nothing in this file can make a
hero multiclassed; taking a level in a second class is the next step, and
until it lands every hero has exactly one row and reads exactly as before.
*/

// heroClass is the shared shape of the three ListCharacterClasses* rows. sqlc
// generates a distinct struct per query even when the columns are identical,
// so the conversion happens once, here, rather than at each call site.
type heroClass struct {
	CharacterID  uuid.UUID
	ClassID      uuid.UUID
	SubclassID   pgtype.UUID
	Level        int16
	Position     int16
	ClassName    string
	ClassData    []byte
	SubclassName *string
}

func classesFromCampaign(rows []db.ListCharacterClassesForCampaignRow) []heroClass {
	out := make([]heroClass, 0, len(rows))
	for _, r := range rows {
		out = append(out, heroClass(r))
	}
	return out
}

func classesFromOwner(rows []db.ListCharacterClassesForOwnerRow) []heroClass {
	out := make([]heroClass, 0, len(rows))
	for _, r := range rows {
		out = append(out, heroClass(r))
	}
	return out
}

func classesFromCharacter(rows []db.ListCharacterClassesRow) []heroClass {
	out := make([]heroClass, 0, len(rows))
	for _, r := range rows {
		out = append(out, heroClass(r))
	}
	return out
}

// byCharacter groups a bulk read, so a roster of six heroes costs one query
// rather than six.
func byCharacter(rows []heroClass) map[uuid.UUID][]heroClass {
	out := map[uuid.UUID][]heroClass{}
	for _, r := range rows {
		out[r.CharacterID] = append(out[r.CharacterID], r)
	}
	return out
}

// classesFor reads one hero's classes. Best-effort in the same way
// classDataFor is: a hero whose class rows cannot be read is a hero with a
// thinner sheet, not a request that fails.
func (s *Server) classesFor(ctx context.Context, c db.Character) []heroClass {
	rows, err := s.queries.ListCharacterClasses(ctx, c.ID)
	if err != nil {
		return nil
	}
	return classesFromCharacter(rows)
}

// toAPICharacterClasses renders a hero's classes for the sheet. `starting` is
// resolved against characters.class_id rather than position 0 — position is
// the order they were taken, and those agree today, but only one of them is
// the fact the proficiency rules actually ask about.
func toAPICharacterClasses(rows []heroClass, startingClassID pgtype.UUID) []api.CharacterClass {
	out := make([]api.CharacterClass, 0, len(rows))
	for _, r := range rows {
		entry := api.CharacterClass{
			ClassId:   r.ClassID,
			ClassName: r.ClassName,
			Level:     int(r.Level),
		}
		if r.SubclassID.Valid {
			id := uuid.UUID(r.SubclassID.Bytes)
			entry.SubclassId = &id
		}
		if r.SubclassName != nil {
			name := *r.SubclassName
			entry.SubclassName = &name
		}
		starting := startingClassID.Valid && uuid.UUID(startingClassID.Bytes) == r.ClassID
		entry.Starting = &starting
		out = append(out, entry)
	}
	return out
}

// TotalLevel sums a hero's class levels. characters.level is meant to equal
// this; where they disagree the rows are the truth, because they are what a
// level-up writes.
func totalLevel(rows []heroClass) int {
	total := 0
	for _, r := range rows {
		total += int(r.Level)
	}
	return total
}

// classLine renders the line a sheet header shows: "Rogue 5 / Wizard 3", or
// just "Rogue 5" for the single-classed, which is nearly everyone. Empty for
// a quick-add hero, whose freeform `class` text is all they have.
func classLine(rows []heroClass) string {
	if len(rows) == 0 {
		return ""
	}
	parts := make([]string, 0, len(rows))
	for _, r := range rows {
		parts = append(parts, r.ClassName+" "+strconv.Itoa(int(r.Level)))
	}
	return strings.Join(parts, " / ")
}
