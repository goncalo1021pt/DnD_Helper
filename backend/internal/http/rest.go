package http

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"sort"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/live"
	"github.com/goncalo1021pt/questboard/backend/internal/rules"
)

/*
The two rests (#118).

They existed only as reference text: nothing reset a spell slot, restored a hit
point, or spent a hit die. After a night at the table a player un-clicked every
spent slot by hand, clicked HP up to max, and then separately tapped the spell
swap — three chores standing in for one action in the rules, and three chances
to forget one.

The arithmetic is small and the handler around it is not, so the rules are pure
functions here and the handler only loads, calls and writes. The die roll is
passed in for the same reason: a short rest that heals a random amount is
otherwise a thing you can only test by running it and hoping.
*/

// restOutcome is the whole of what a rest changes, decided before anything is
// written. Hit points, spent slots, spent hit dice and spent pool uses move
// together — a hero left with their slots back and their wounds open has had
// half a rest, which is not a state the rules have a name for.
type restOutcome struct {
	HP        int32
	SlotsUsed []int16
	// Spent hit dice keyed by die size, the shape the column stores (#190).
	HitDiceSpentMap map[int]int
	// Pact slots still spent. Its own counter since #190: a Warlock 3 /
	// Wizard 3 getting their pact slots back over an hour must not also get
	// their Wizard slots back.
	PactUsed  int16
	PoolsUsed map[string]int

	HPRestored      int32
	HitDiceSpent    int
	HitDiceRegained int
	Rolls           []int
	SlotsRestored   bool
	PoolsRestored   []string
}

// restPools applies a rest to the hero's pools: what remains spent, and which
// pools got something back. A long rest clears everything; a short rest gives
// each pool what its declaration says — nothing, one use, or all of them.
func restPools(pools []resolvedPool, kind string) (map[string]int, []string) {
	used := map[string]int{}
	restored := []string{}
	for _, p := range pools {
		if p.Used == 0 {
			continue
		}
		remaining := p.Used
		if kind == "long" {
			remaining = 0
		} else {
			switch p.ShortRest {
			case rules.ShortRestAll:
				remaining = 0
			case rules.ShortRestOne:
				remaining = p.Used - 1
			}
		}
		if remaining != p.Used {
			restored = append(restored, p.Name)
		}
		if remaining > 0 {
			used[p.Name] = remaining
		}
	}
	return used, restored
}

// noSlots is nine levels of "nothing spent".
func noSlots() []int16 { return make([]int16, 9) }

/*
longRest: whole again.

Hit points to full, every slot back, and half the hero's hit dice returned —
"half your total, minimum one", so a level 1 hero gets their single die back
rather than none. Regaining is capped by what was actually spent; a rested hero
cannot bank dice they never used.
*/
func longRest(ch db.Character, pools []resolvedPool, dice []rules.HitDicePool) restOutcome {
	level := int(ch.Level)
	if level < 1 {
		level = 1
	}
	spent, regain := rules.RegainHitDice(dice, level)
	poolsUsed, poolsRestored := restPools(pools, "long")
	return restOutcome{
		HP:              ch.HpMax,
		SlotsUsed:       noSlots(),
		HitDiceSpentMap: spent,
		PactUsed:        0, // a night returns both pools
		PoolsUsed:       poolsUsed,
		HPRestored:      max32(0, ch.HpMax-ch.HpCurrent),
		HitDiceRegained: regain,
		SlotsRestored:   true,
		PoolsRestored:   poolsRestored,
	}
}

/*
shortRest: an hour and some bandages.

Hit dice are spent one at a time, each healing its roll plus the hero's
Constitution modifier — and never less than nothing, so a frail hero's bad roll
costs them the die without also costing hit points.

A pact caster's slots come back here; everyone else's wait for the night. That
is the whole of what makes a Warlock a Warlock at the table, and it is the
reason `slotsRestored` is a field rather than an assumption.
*/
// `want` is how many of each die size to spend, keyed by die. It arrives from
// the request and is clamped to what each pool actually has left, so asking
// for five d10 with three remaining spends three and heals for three.
func shortRest(
	ch db.Character,
	pools []resolvedPool,
	dice []rules.HitDicePool,
	want map[int]int,
	conMod int,
	pactCaster bool,
	roll func(sides int) int,
) restOutcome {
	spentMap, taken := rules.SpendHitDice(dice, want)

	// Largest die first, so the rolls read in the order a player would spend
	// them and the report is reproducible rather than map-ordered.
	sizes := make([]int, 0, len(taken))
	for die := range taken {
		sizes = append(sizes, die)
	}
	sort.Sort(sort.Reverse(sort.IntSlice(sizes)))

	healed, spend := 0, 0
	rolls := []int{}
	for _, die := range sizes {
		for i := 0; i < taken[die]; i++ {
			r := roll(die)
			rolls = append(rolls, r)
			gain := r + conMod
			if gain < 0 {
				gain = 0
			}
			healed += gain
			spend++
		}
	}

	hp := ch.HpCurrent + int32(healed)
	if hp > ch.HpMax {
		hp = ch.HpMax
	}

	poolsUsed, poolsRestored := restPools(pools, "short")
	out := restOutcome{
		HP:              hp,
		SlotsUsed:       ch.SpellSlotsUsed, // the shared pool waits for the night
		HitDiceSpentMap: spentMap,
		PactUsed:        ch.PactSlotsUsed,
		PoolsUsed:       poolsUsed,
		HPRestored:      max32(0, hp-ch.HpCurrent),
		HitDiceSpent:    spend,
		Rolls:           rolls,
		SlotsRestored:   pactCaster,
		PoolsRestored:   poolsRestored,
	}
	// Pact Magic is the one pool an hour refills, and since #190 it is the
	// ONLY one that does — a Warlock/Wizard keeps their Wizard slots spent.
	if pactCaster {
		out.PactUsed = 0
	}
	return out
}

func max32(a, b int32) int32 {
	if a > b {
		return a
	}
	return b
}

// RestCharacter takes a long or short rest and reports what it gave back.
func (s *Server) RestCharacter(ctx context.Context, request api.RestCharacterRequestObject) (api.RestCharacterResponseObject, error) {
	character, err := s.queries.GetCharacter(ctx, uuid.UUID(request.CharacterId))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return api.RestCharacter404JSONResponse{NotFoundJSONResponse: notFound()}, nil
		}
		return nil, err
	}
	if _, err := s.requireCharacterEditor(ctx, character); err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.RestCharacter401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.RestCharacter403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	actor, _ := auth.UserID(ctx)
	badRequest := func(msg string) (api.RestCharacterResponseObject, error) {
		return api.RestCharacter400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	if request.Body == nil {
		return badRequest("a rest body is required")
	}

	// The class says whether their slots are the kind that come back over an
	// hour. Hit dice now come from every class the hero holds (#190), pooled
	// by die size — a hero with no class at all still rests, on d8s.
	classData := s.classDataFor(ctx, character)
	classes := s.classesFor(ctx, character)
	var cr castingRules
	if classData != nil {
		_ = json.Unmarshal(classData, &cr)
	}
	// The starting class may cast through its subclass instead (#220), and its
	// spellChanges rule rides on the same block as the spellcaster kind.
	if cr.Spellcaster == "" && character.ClassID.Valid {
		for _, k := range classes {
			if k.ClassID == uuid.UUID(character.ClassID.Bytes) {
				if src := castingDataOf(k); src != nil {
					_ = json.Unmarshal(src, &cr)
				}
			}
		}
	}
	conMod := 0
	if character.Constitution != nil {
		conMod = abilityMod(int(*character.Constitution))
	}

	pools := s.resolvePools(ctx, character)
	dice := hitDicePoolsOf(classes, int(character.Level), character.HitDiceSpent)

	var outcome restOutcome
	switch request.Body.Kind {
	case "long":
		outcome = longRest(character, pools, dice)
	case "short":
		want, errMsg := parseHitDiceRequest(request.Body.HitDice, dice)
		if errMsg != "" {
			return badRequest(errMsg)
		}
		outcome = shortRest(character, pools, dice, want, conMod, cr.Spellcaster == "pact", func(sides int) int {
			return rollDie(sides)
		})
	default:
		return badRequest("a rest is either long or short")
	}

	poolsUsed, err := json.Marshal(outcome.PoolsUsed)
	if err != nil {
		return nil, err
	}
	hitDiceSpent, err := encodeHitDiceSpent(outcome.HitDiceSpentMap)
	if err != nil {
		return nil, err
	}
	updated, err := s.queries.RestCharacter(ctx, db.RestCharacterParams{
		ID:             character.ID,
		HpCurrent:      outcome.HP,
		SpellSlotsUsed: outcome.SlotsUsed,
		HitDiceSpent:   hitDiceSpent,
		PactSlotsUsed:  outcome.PactUsed,
		PoolsUsed:      poolsUsed,
	})
	if err != nil {
		return nil, err
	}

	// A seated hero's HP is mirrored into whichever fight they are standing in,
	// so a rest between rounds does not leave the tracker showing yesterday's
	// wounds.
	if err := s.syncCombatantHP(ctx, updated); err != nil {
		return nil, err
	}

	// The chronicle shows the shape of the adventuring day; a rest is one of
	// the few things every player at the table already agrees just happened.
	if campaignID, seated := seatedCampaign(updated); seated {
		s.publish(campaignID, live.TopicParty)
		s.logEvent(ctx, campaignID, actor, "rest_taken", restLine(updated.Name, string(request.Body.Kind), outcome))
	}

	canSwap := false
	if request.Body.Kind == "long" && cr.Spellcaster != "" {
		changes := spellChangesFor(cr)
		canSwap = changes.Prepared.allowance("long-rest") != 0 ||
			changes.Cantrips.allowance("long-rest") != 0
	}

	rolls := outcome.Rolls
	if rolls == nil {
		rolls = []int{}
	}
	poolsRestored := outcome.PoolsRestored
	if poolsRestored == nil {
		poolsRestored = []string{}
	}
	ownerName, err := s.ownerName(ctx, updated.OwnerUserID)
	if err != nil {
		return nil, err
	}
	// The report's hero carries the sheet the rest just refilled — slots and
	// pools included — rather than making the caller refetch to see it.
	hero := toAPICharacterWithClass(updated, ownerName, actor, classData, s.classesFor(ctx, updated))
	attachPools(&hero, s.resolvePools(ctx, updated))
	return api.RestCharacter200JSONResponse(api.RestReport{
		Character:       hero,
		Kind:            string(request.Body.Kind),
		HpRestored:      int(outcome.HPRestored),
		HitDiceSpent:    outcome.HitDiceSpent,
		HitDiceRegained: outcome.HitDiceRegained,
		HitDiceLeft:     rules.TotalHitDiceLeft(s.hitDiceFor(ctx, updated)),
		SlotsRestored:   outcome.SlotsRestored,
		Rolls:           rolls,
		CanSwapSpells:   canSwap,
		PoolsRestored:   poolsRestored,
	}), nil
}

// restLine is the sentence the chronicle carries.
func restLine(name, kind string, o restOutcome) string {
	if kind == "long" {
		return fmt.Sprintf("%s took a long rest", name)
	}
	if o.HitDiceSpent == 0 {
		return fmt.Sprintf("%s took a short rest", name)
	}
	dice := "die"
	if o.HitDiceSpent > 1 {
		dice = "dice"
	}
	return fmt.Sprintf("%s took a short rest, spending %d hit %s to heal %d",
		name, o.HitDiceSpent, dice, o.HPRestored)
}

// rollDie is the hit die itself. Separate from rollD20 because a hit die is
// whatever the class says it is.
func rollDie(sides int) int {
	if sides < 1 {
		return 0
	}
	return 1 + rand.IntN(sides)
}
