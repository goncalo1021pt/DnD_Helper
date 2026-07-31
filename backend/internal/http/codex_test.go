package http

import (
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

/*
Codex legality — the last Go target owed from post-v1 item 1 (#106).

Every other visibility rule in this codebase leaks *within* a table: a player
seeing a quest, a location, a sheet they should not. This one leaks *across*
tables. Homebrew belongs to its author until a DM admits it, so a mistake here
is one campaign seating or seeing another campaign's private content — and the
first playtest already found the other side of it (#128), where a correct
refusal was invisible.

codexRuling is that rule with the database taken out. It cannot be tested
through codexBlockers, which interleaves the decision with three queries, so
the decision moved out and the queries stayed.
*/

func TestCodexRulingCoversEverySourceAndRuling(t *testing.T) {
	const (
		ruled   = true
		unruled = false
	)
	cases := []struct {
		name   string
		source db.ContentSource
		status db.CodexStatus
		ruled  bool
		legal  bool
		state  api.SeatConflictMissingState
	}{
		// SRD is legal until somebody says otherwise. Silence means yes.
		{"srd, never ruled on", db.ContentSourceSrd, "", unruled, true, ""},
		{"srd, explicitly enabled", db.ContentSourceSrd, db.CodexStatusEnabled, ruled, true, ""},
		{"srd, banned by the DM", db.ContentSourceSrd, db.CodexStatusBanned, ruled, false, api.SeatConflictMissingStateBanned},
		// A proposal is not a ruling. SRD needs no proposal, so one leaves it legal.
		{"srd, sitting as a proposal", db.ContentSourceSrd, db.CodexStatusProposed, ruled, true, ""},

		// Homebrew is illegal until somebody says otherwise. Silence means no.
		{"homebrew, never offered here", db.ContentSourceHomebrew, "", unruled, false, api.SeatConflictMissingStateAbsent},
		{"homebrew, proposed but not yet admitted", db.ContentSourceHomebrew, db.CodexStatusProposed, ruled, false, api.SeatConflictMissingStateProposed},
		{"homebrew, enabled by the DM", db.ContentSourceHomebrew, db.CodexStatusEnabled, ruled, true, ""},
		{"homebrew, banned by the DM", db.ContentSourceHomebrew, db.CodexStatusBanned, ruled, false, api.SeatConflictMissingStateBanned},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			legal, state := codexRuling(c.source, c.status, c.ruled)
			if legal != c.legal {
				t.Errorf("legal = %v, want %v", legal, c.legal)
			}
			if state != c.state {
				t.Errorf("state = %q, want %q", state, c.state)
			}
		})
	}
}

/*
The asymmetry, stated on its own because it is the whole rule and the easiest
thing to invert while refactoring: with nothing said either way, SRD is in and
homebrew is out.
*/
func TestSilenceMeansYesForSrdAndNoForHomebrew(t *testing.T) {
	srdLegal, _ := codexRuling(db.ContentSourceSrd, "", false)
	if !srdLegal {
		t.Error("an SRD entry no DM has ruled on must be legal — a fresh table has every SRD class")
	}
	brewLegal, brewState := codexRuling(db.ContentSourceHomebrew, "", false)
	if brewLegal {
		t.Error("homebrew nobody admitted must be illegal — this is the cross-table leak")
	}
	if brewState != api.SeatConflictMissingStateAbsent {
		t.Errorf("state = %q, want absent: the DM has nothing to act on yet", brewState)
	}
}

/*
A proposal is a request, not permission. #128's report was that a hero could not
be seated "even by the DM"; the flip side is the one that would actually hurt —
a player proposing their own homebrew and being seated on the strength of asking.
*/
func TestProposingHomebrewDoesNotAdmitIt(t *testing.T) {
	legal, state := codexRuling(db.ContentSourceHomebrew, db.CodexStatusProposed, true)
	if legal {
		t.Fatal("a proposal must not make content legal — the DM has not answered yet")
	}
	if state != api.SeatConflictMissingStateProposed {
		t.Errorf("state = %q, want proposed so the DM sees something to rule on", state)
	}
}

/*
A ban outranks everything, and it is the only way to reach a homebrew-only
world: ban the SRD classes and the Forge offers exactly what the table wrote.
*/
func TestABanOutranksTheSourceItCameFrom(t *testing.T) {
	for _, source := range []db.ContentSource{db.ContentSourceSrd, db.ContentSourceHomebrew} {
		legal, state := codexRuling(source, db.CodexStatusBanned, true)
		if legal {
			t.Errorf("%s: a banned entry must stay banned", source)
		}
		if state != api.SeatConflictMissingStateBanned {
			t.Errorf("%s: state = %q, want banned so the refusal names the reason", source, state)
		}
	}
}

/*
`ruled` is a separate argument from `status` on purpose. Go's zero value for
CodexStatus is a real string, so a missing codex row read as its zero value
would be indistinguishable from an actual ruling. These pin that an unruled
entry is judged by its source alone, whatever happens to be in `status`.
*/
func TestAnUnruledEntryIgnoresWhateverStatusIsPassed(t *testing.T) {
	for _, status := range []db.CodexStatus{"", db.CodexStatusEnabled, db.CodexStatusProposed, db.CodexStatusBanned} {
		if legal, _ := codexRuling(db.ContentSourceSrd, status, false); !legal {
			t.Errorf("unruled SRD with status %q must stay legal", status)
		}
		if legal, _ := codexRuling(db.ContentSourceHomebrew, status, false); legal {
			t.Errorf("unruled homebrew with status %q must stay illegal", status)
		}
	}
}

// --- what a hero carries -----------------------------------------------------

func uid(t *testing.T) pgtype.UUID {
	t.Helper()
	return pgtype.UUID{Bytes: uuid.New(), Valid: true}
}

/*
sheetContentIDs is what the gate is applied TO, and missing one reference is a
hole in the gate rather than a visible bug: a hero whose subclass is homebrew
walks in, because nobody asked about the subclass.
*/
func TestSheetColumnIDsCollectsEveryReferenceAHeroCarries(t *testing.T) {
	class, species, background, subclass := uid(t), uid(t), uid(t), uid(t)

	full := db.Character{ClassID: class, SpeciesID: species, BackgroundID: background, SubclassID: subclass}
	if got := sheetColumnIDs(full); len(got) != 4 {
		t.Errorf("a fully specified hero carries 4 references, got %d", len(got))
	}

	// Level 1 has no subclass yet — three references, and no zero UUID smuggled
	// in as a fourth, which would be a dangling lookup on every seat attempt.
	young := db.Character{ClassID: class, SpeciesID: species, BackgroundID: background}
	got := sheetColumnIDs(young)
	if len(got) != 3 {
		t.Fatalf("a subclass-less hero carries 3 references, got %d", len(got))
	}
	for _, id := range got {
		if id == uuid.Nil {
			t.Error("an unset column must be skipped, not passed on as the nil UUID")
		}
	}
}

/*
A quick-added hero has no sheet at all — no class, no species, nothing. The gate
must find nothing to rule on rather than a list of nil UUIDs, which is exactly
why one can be seated at a table whose codex would refuse a forged hero.
*/
func TestAHeroWithNoSheetCarriesNothingToRuleOn(t *testing.T) {
	if got := sheetColumnIDs(db.Character{}); len(got) != 0 {
		t.Errorf("a sheet-less hero should carry no references, got %v", got)
	}
}
