package rules

import (
	"strings"
	"testing"
)

func scores(str, dex, con, intel, wis, cha int) map[string]int {
	return map[string]int{"str": str, "dex": dex, "con": con, "int": intel, "wis": wis, "cha": cha}
}

func TestSinglePrimaryAbilityGate(t *testing.T) {
	// Wizard: Intelligence.
	if ok, _ := MeetsPrereq([]string{"INT"}, nil, scores(10, 10, 10, 13, 10, 10)); !ok {
		t.Error("Intelligence 13 should qualify for Wizard")
	}
	ok, why := MeetsPrereq([]string{"INT"}, nil, scores(18, 18, 18, 12, 18, 18))
	if ok {
		t.Error("Intelligence 12 should not qualify, however good the rest is")
	}
	if !strings.Contains(why, "Intelligence 13") {
		t.Errorf("the refusal should name what is missing; got %q", why)
	}
}

// Paladin is "Strength and Charisma" — both, and the seed lists both, so the
// default reading of primaryAbility has to be "all".
func TestTwoPrimaryAbilitiesDefaultToBothRequired(t *testing.T) {
	if ok, _ := MeetsPrereq([]string{"STR", "CHA"}, nil, scores(13, 10, 10, 10, 10, 13)); !ok {
		t.Error("Strength 13 and Charisma 13 should qualify for Paladin")
	}
	ok, why := MeetsPrereq([]string{"STR", "CHA"}, nil, scores(13, 10, 10, 10, 10, 12))
	if ok {
		t.Error("Charisma 12 should refuse a Paladin")
	}
	if !strings.Contains(why, "Charisma 13") || strings.Contains(why, "Strength") {
		t.Errorf("the refusal should name only what is short; got %q", why)
	}
}

// Fighter is the exception: "Strength or Dexterity". Content says so.
func TestFighterTakesEitherStrengthOrDexterity(t *testing.T) {
	mc := &MulticlassData{Prerequisite: &MulticlassPrereq{Any: []string{"STR", "DEX"}}}

	if ok, _ := MeetsPrereq([]string{"STR", "DEX"}, mc, scores(13, 8, 10, 10, 10, 10)); !ok {
		t.Error("Strength 13 alone should qualify for Fighter")
	}
	if ok, _ := MeetsPrereq([]string{"STR", "DEX"}, mc, scores(8, 13, 10, 10, 10, 10)); !ok {
		t.Error("Dexterity 13 alone should qualify for Fighter")
	}
	ok, why := MeetsPrereq([]string{"STR", "DEX"}, mc, scores(12, 12, 18, 18, 18, 18))
	if ok {
		t.Error("neither at 13 should refuse")
	}
	if !strings.Contains(why, " or ") {
		t.Errorf("the refusal should offer the choice; got %q", why)
	}
}

// Without the declaration, the same two abilities read as "both" — the strict
// way round, so a homebrew class that says nothing refuses at the door rather
// than admitting someone it should not have.
func TestUndeclaredTwoAbilityClassIsStrict(t *testing.T) {
	if ok, _ := MeetsPrereq([]string{"STR", "DEX"}, nil, scores(13, 8, 10, 10, 10, 10)); ok {
		t.Error("with no multiclass block declared, both abilities are required")
	}
}

func TestAbilityNamesAreAcceptedInAnyForm(t *testing.T) {
	for _, spelling := range []string{"STR", "str", "Strength", " strength "} {
		if ok, _ := MeetsPrereq([]string{spelling}, nil, scores(13, 10, 10, 10, 10, 10)); !ok {
			t.Errorf("%q should be read as Strength", spelling)
		}
	}
}

// A class that names no primary ability at all cannot be gated on one.
func TestClassWithNoPrimaryAbilityAdmitsAnyone(t *testing.T) {
	if ok, _ := MeetsPrereq(nil, nil, scores(8, 8, 8, 8, 8, 8)); !ok {
		t.Error("nothing declared is nothing to fail")
	}
}

func TestRefusalListsEveryMissingAbility(t *testing.T) {
	_, why := MeetsPrereq([]string{"DEX", "WIS"}, nil, scores(10, 10, 10, 10, 10, 10))

	if !strings.Contains(why, "Dexterity 13") || !strings.Contains(why, "Wisdom 13") {
		t.Errorf("both shortfalls should be named; got %q", why)
	}
	if !strings.Contains(why, " and ") {
		t.Errorf("both are required, so the refusal joins with and; got %q", why)
	}
}
