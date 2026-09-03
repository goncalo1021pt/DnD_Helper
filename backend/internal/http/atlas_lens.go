package http

import (
	"context"

	"github.com/google/uuid"

	"github.com/goncalo1021pt/questboard/backend/internal/live"
)

/*
The lens (#234).

A place or a map belongs to a realm, and a realm may hold several campaigns,
so an id-addressed atlas route can no longer read "the campaign" off its row.
Every such route takes a required `campaignId` query parameter instead — the
table it is read or changed through — and the queries resolve the row THROUGH
that campaign: `GetMapMetaForCampaign`, `GetLocationForCampaign`, `GetMapPin`,
`GetMapShape`, `GetRevealBatch` all join the campaign's realm and answer no
row when the thing is not on it, so a map you do not stand on cannot be told
from one that never was. Authorization does not change: it is `requireDM` or
`requireMember` on the lens, exactly as before.

Live updates split the same way as the data. A change to shared GROUND — a
place renamed, a map hung, a pin dropped, a road drawn — publishes to every
campaign on the realm, because a sibling table's open atlas must refresh. A
change to one table's KNOWLEDGE — a veil lifted, fog stamped — publishes to
the lens alone. A topic carries nothing, so the fan-out leaks nothing.
*/

// publishRealm nudges every table standing on a realm. Never blocks and never
// fails, like publish: a change that happened is not undone by nobody hearing
// of it, so a failed read of the campaign list simply nudges nobody.
func (s *Server) publishRealm(ctx context.Context, realmID uuid.UUID, topic live.Topic) {
	ids, err := s.queries.ListCampaignIDsByRealm(ctx, realmID)
	if err != nil {
		return
	}
	for _, id := range ids {
		s.publish(id, topic)
	}
}
