package http

import (
	"fmt"
	"testing"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

/*
The Go half of the shared conditions contract (#173, #112).

Its twin is frontend/src/lib/conditions.test.ts, reading this same fixture.
The vocabulary is duplicated on purpose — the picker cannot ask the server what
exists on every paint — so what needs guarding is that neither copy can move
alone. Adding a condition here without adding it to the fixture fails this file;
adding it to the fixture without adding it to lib/conditions.ts fails vitest.
*/

type conditionFixture struct {
	Names         []string `json:"names"`
	MaxExhaustion int      `json:"maxExhaustion"`
	Cases         []struct {
		Name       string   `json:"name"`
		Input      []string `json:"input"`
		Normalized []string `json:"normalized"`
		Invalid    bool     `json:"invalid"`
	} `json:"cases"`
}

func loadConditions(t *testing.T) conditionFixture {
	t.Helper()
	var doc conditionFixture
	loadFixture(t, "conditions.json", &doc)
	return doc
}

func TestConditionVocabularyMatchesTheSharedFixture(t *testing.T) {
	doc := loadConditions(t)
	if len(doc.Names) != len(conditionNames) {
		t.Fatalf("fixture lists %d conditions; Go knows %d", len(doc.Names), len(conditionNames))
	}
	// Order matters as much as membership: it is the order both engines sort a
	// normalized set into, so a reshuffle here would reshuffle the DM's chips.
	for i, want := range doc.Names {
		if conditionNames[i] != want {
			t.Errorf("condition %d is %q; the fixture says %q", i, conditionNames[i], want)
		}
	}
	if doc.MaxExhaustion != maxExhaustion {
		t.Errorf("maxExhaustion = %d; the fixture says %d", maxExhaustion, doc.MaxExhaustion)
	}
}

func TestNormalizeConditionsMatchesTheSharedFixture(t *testing.T) {
	doc := loadConditions(t)
	var accepted, refused int
	for _, c := range doc.Cases {
		got, errMsg := normalizeConditions(c.Input)
		if c.Invalid {
			refused++
			if errMsg == "" {
				t.Errorf("%s: accepted %v; the fixture says it must be refused", c.Name, c.Input)
			}
			continue
		}
		accepted++
		if errMsg != "" {
			t.Errorf("%s: refused %v (%s); the fixture says it is legal", c.Name, c.Input, errMsg)
			continue
		}
		if len(got) != len(c.Normalized) {
			t.Errorf("%s: normalized to %v; the fixture says %v", c.Name, got, c.Normalized)
			continue
		}
		for i := range got {
			if got[i] != c.Normalized[i] {
				t.Errorf("%s: normalized to %v; the fixture says %v", c.Name, got, c.Normalized)
				break
			}
		}
	}
	if accepted == 0 || refused == 0 {
		t.Fatalf("fixture covers %d accepted and %d refused sets; it must cover both", accepted, refused)
	}
}

// An empty set has to survive the round trip as an empty array. A nil slice
// reaches Postgres as NULL, and the column is NOT NULL — so "the DM cleared
// every condition" would fail as a 500 instead of clearing anything.
func TestClearingEveryConditionYieldsAnEmptyArrayNotNil(t *testing.T) {
	got, errMsg := normalizeConditions(nil)
	if errMsg != "" {
		t.Fatalf("clearing conditions was refused: %s", errMsg)
	}
	if got == nil {
		t.Error("normalizeConditions(nil) returned a nil slice; it must return an empty one")
	}
	if len(got) != 0 {
		t.Errorf("normalizeConditions(nil) = %v; want empty", got)
	}
}

func TestEveryExhaustionLevelIsAcceptedAndNoOthers(t *testing.T) {
	for lvl := 1; lvl <= maxExhaustion; lvl++ {
		in := fmt.Sprintf("Exhaustion %d", lvl)
		got, ok := canonicalCondition(in)
		if !ok || got != in {
			t.Errorf("canonicalCondition(%q) = %q, %v; want %q, true", in, got, ok, in)
		}
	}
	for _, bad := range []string{"Exhaustion 0", "Exhaustion 7", "Exhaustion", "Exhaustion -1", "Exhaustion two"} {
		if _, ok := canonicalCondition(bad); ok {
			t.Errorf("canonicalCondition(%q) was accepted; a level outside 1..%d is not a condition", bad, maxExhaustion)
		}
	}
}

// --- death saves ------------------------------------------------------------

func pcRow(hp int32, succ, fail int16) db.GetCombatantRow {
	return db.GetCombatantRow{Kind: "pc", HpCurrent: hp, DeathSaveSuccesses: succ, DeathSaveFailures: fail}
}

func intp(v int) *int { return &v }

// The guard that matters: UpdateCombatant clears the pips on any write that
// raises hit points, so a request setting both a heal and a tally would undo
// itself silently. Refusing it is the only honest answer.
func TestDeathSavesRefusedOnAHeroWhoIsNotDown(t *testing.T) {
	b := &api.UpdateCombatantRequest{DeathSaveFailures: intp(1)}
	if _, errMsg := combatantDeathSaves(b, pcRow(0, 0, 0), 7); errMsg == "" {
		t.Error("pips were accepted on a hero at 7 hit points; the heal would have wiped them")
	}
}

// hpAfter, not the row's current HP: one PATCH may drop a hero to 0 and mark
// their first failed save, and that is the common case at a table.
func TestDeathSavesJudgedAgainstTheHitPointsTheRequestLeavesBehind(t *testing.T) {
	b := &api.UpdateCombatantRequest{HpCurrent: intp(0), DeathSaveFailures: intp(1)}
	got, errMsg := combatantDeathSaves(b, pcRow(12, 0, 0), 0)
	if errMsg != "" {
		t.Fatalf("dropping a hero to 0 and marking a failure was refused: %s", errMsg)
	}
	if got.failures != 1 {
		t.Errorf("failures = %d; want 1", got.failures)
	}
}

func TestDeathSavesRefusedOnAnythingThatIsNotAHero(t *testing.T) {
	b := &api.UpdateCombatantRequest{DeathSaveSuccesses: intp(1)}
	row := db.GetCombatantRow{Kind: "monster", HpCurrent: 0}
	if _, errMsg := combatantDeathSaves(b, row, 0); errMsg == "" {
		t.Error("a monster was given death saves; monsters die when their hit points do")
	}
}

// Marking a failure must not quietly reset the successes beside it — the two
// tallies are independent, and a client sends only the pip it toggled.
func TestAnOmittedTallyKeepsItsCurrentValue(t *testing.T) {
	b := &api.UpdateCombatantRequest{DeathSaveFailures: intp(2)}
	got, errMsg := combatantDeathSaves(b, pcRow(0, 1, 0), 0)
	if errMsg != "" {
		t.Fatalf("refused: %s", errMsg)
	}
	if got.successes != 1 {
		t.Errorf("successes = %d; want the row's existing 1, untouched", got.successes)
	}
	if got.failures != 2 {
		t.Errorf("failures = %d; want 2", got.failures)
	}
}

func TestDeathSavesStayWithinTheThreeTheRulesAllow(t *testing.T) {
	for _, n := range []int{-1, maxDeathSaves + 1} {
		if _, errMsg := combatantDeathSaves(&api.UpdateCombatantRequest{DeathSaveSuccesses: intp(n)}, pcRow(0, 0, 0), 0); errMsg == "" {
			t.Errorf("%d successes was accepted; the tally runs 0 to %d", n, maxDeathSaves)
		}
		if _, errMsg := combatantDeathSaves(&api.UpdateCombatantRequest{DeathSaveFailures: intp(n)}, pcRow(0, 0, 0), 0); errMsg == "" {
			t.Errorf("%d failures was accepted; the tally runs 0 to %d", n, maxDeathSaves)
		}
	}
}

// An untouched body must leave the row alone rather than write zeroes over it.
func TestABodyMentioningNeitherTallyWritesNothing(t *testing.T) {
	got, errMsg := combatantDeathSaves(&api.UpdateCombatantRequest{HpCurrent: intp(3)}, pcRow(0, 2, 1), 3)
	if errMsg != "" {
		t.Fatalf("refused: %s", errMsg)
	}
	if got != nil {
		t.Errorf("got %+v; a body that mentions no pips must write none", *got)
	}
}

// The same rule for conditions: omitted leaves them, an empty array clears them.
func TestOmittedConditionsWriteNothingButAnEmptyArrayClears(t *testing.T) {
	got, errMsg := combatantConditions(&api.UpdateCombatantRequest{})
	if errMsg != "" || got != nil {
		t.Errorf("an absent conditions field wrote %v (%s); it must write nothing", got, errMsg)
	}
	got, errMsg = combatantConditions(&api.UpdateCombatantRequest{Conditions: &[]string{}})
	if errMsg != "" {
		t.Fatalf("clearing conditions was refused: %s", errMsg)
	}
	if got == nil || len(got) != 0 {
		t.Errorf("an empty conditions array wrote %v; it must clear to an empty list", got)
	}
}
