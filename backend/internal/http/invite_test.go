package http

import (
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

func aCampaign() db.Campaign {
	return db.Campaign{
		ID:          uuid.New(),
		Name:        "Curse of Strahd",
		OwnerUserID: uuid.New(),
		InviteCode:  "PZA5YD",
	}
}

// The bug behind #207: the code rode along in every payload, and the UI alone
// decided who saw it. A player's copy of a campaign must not contain it at all.
func TestPlayersCampaignCarriesNoInviteCode(t *testing.T) {
	out := toAPICampaign(aCampaign(), false)

	if out.InviteCode != nil {
		t.Errorf("a player's payload must not carry the invite code; got %q", *out.InviteCode)
	}
	// The rest of the table still reaches them — this is a withheld field, not
	// a withheld campaign.
	if out.Name != "Curse of Strahd" {
		t.Errorf("the campaign itself should be intact; got name %q", out.Name)
	}
}

func TestDMsCampaignCarriesTheInviteCode(t *testing.T) {
	out := toAPICampaign(aCampaign(), true)

	if out.InviteCode == nil {
		t.Fatal("the DM needs the code — it is how they fill the table")
	}
	if *out.InviteCode != "PZA5YD" {
		t.Errorf("got %q; want PZA5YD", *out.InviteCode)
	}
}

// Absent, not blank. A player holding an empty string is a player the frontend
// might render a code box for; a player holding nothing is not.
func TestWithheldCodeIsAbsentRatherThanEmpty(t *testing.T) {
	out := toAPICampaign(aCampaign(), false)

	if out.InviteCode != nil && *out.InviteCode == "" {
		t.Error("the code should be omitted, not blanked to an empty string")
	}
}

func TestGeneratedCodesAvoidAmbiguousCharacters(t *testing.T) {
	// 0/O and 1/I are the pairs someone misreads when a code is spoken aloud
	// across a table or copied off a screenshot. L is deliberately not here:
	// it only collides in lower case, and these are upper-case throughout.
	const ambiguous = "01IO"
	for i := 0; i < 200; i++ {
		code := generateInviteCode()
		if len(code) != inviteCodeLength {
			t.Fatalf("code %q is %d characters; want %d", code, len(code), inviteCodeLength)
		}
		if strings.ContainsAny(code, ambiguous) {
			t.Fatalf("code %q contains a character that is misread aloud", code)
		}
		if strings.ToUpper(code) != code {
			t.Fatalf("code %q should be upper-case, to match how it is stored", code)
		}
	}
}

func TestCodesTypedByHandAreNormalized(t *testing.T) {
	for _, typed := range []string{"pza5yd", "  PZA5YD  ", "Pza5Yd", "\tpza5yd\n"} {
		if got := normalizeInviteCode(typed); got != "PZA5YD" {
			t.Errorf("normalizeInviteCode(%q) = %q; want PZA5YD", typed, got)
		}
	}
}
