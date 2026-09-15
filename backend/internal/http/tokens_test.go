package http

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/goncalo1021pt/questboard/backend/internal/auth"
)

func TestTableAllowed(t *testing.T) {
	mine, other := uuid.New(), uuid.New()

	// No grant at all (a test context) and a session both reach every table.
	if !tableAllowed(context.Background(), other) {
		t.Fatal("no grant should restrict nothing")
	}
	session := auth.WithGrant(context.Background(), auth.Grant{Kind: auth.GrantSession})
	if !tableAllowed(session, other) {
		t.Fatal("a session reaches every table")
	}
	if _, restricted := restrictedTable(session); restricted {
		t.Fatal("a session is not restricted")
	}

	// A token minted for every table its owner sits at.
	wide := auth.WithGrant(context.Background(), auth.Grant{Kind: auth.GrantToken, Scopes: auth.Scopes{auth.CampaignsRead}})
	if !tableAllowed(wide, other) {
		t.Fatal("an unrestricted token reaches every table")
	}

	// A token minted for one table.
	narrow := auth.WithGrant(context.Background(), auth.Grant{Kind: auth.GrantToken, Campaign: &mine})
	if !tableAllowed(narrow, mine) {
		t.Fatal("a restricted token reaches its own table")
	}
	if tableAllowed(narrow, other) {
		t.Fatal("a restricted token must not reach another table")
	}
	if only, restricted := restrictedTable(narrow); !restricted || only != mine {
		t.Fatalf("restrictedTable = %v, %v", only, restricted)
	}
}
