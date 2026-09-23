package http

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/auth"
)

/*
Everything you own, as one document (#317).

The document is composed by calling the strict handlers in-process with the
caller's own context — the same doors the app reads through — and keeping
each 200. That is the whole design: there is no second read path, so a veil
that holds on the screen holds here, and a veil added anywhere later is
exported correctly without anyone remembering this file exists. A non-200
from a door drops that piece, never the document.

A token gets only the sections its scopes could read; the endpoint sits under
account:read and a whole-document read must not become the back door the
scope cap closed. Images are URLs with the table as their lens.
*/

const exportVersion = 1

// as keeps a handler's 200 and drops anything else.
func as[T any](v any, err error) (T, bool, error) {
	var zero T
	if err != nil {
		return zero, false, err
	}
	t, ok := v.(T)
	return t, ok, nil
}

func (s *Server) ExportMe(ctx context.Context, _ api.ExportMeRequestObject) (api.ExportMeResponseObject, error) {
	uid, ok := auth.UserID(ctx)
	if !ok {
		return api.ExportMe401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	grant, _ := auth.GrantOf(ctx)
	holds := func(sc auth.Scope) bool { return grant.Kind != auth.GrantToken || grant.Scopes.Holds(sc) }

	out := api.MeExport{ExportVersion: exportVersion, ExportedAt: time.Now().UTC(), Omitted: []api.MeExportOmitted{}}

	// The account: who you are, your friends, every conversation whole.
	me, ok, err := as[api.GetCurrentUser200JSONResponse](s.GetCurrentUser(ctx, api.GetCurrentUserRequestObject{}))
	if err != nil {
		return nil, err
	}
	if !ok {
		return api.ExportMe401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
	}
	out.Account.User = me.User
	if roll, ok, err := as[api.ListFriends200JSONResponse](s.ListFriends(ctx, api.ListFriendsRequestObject{})); err != nil {
		return nil, err
	} else if ok {
		out.Account.Friends = api.FriendRoll(roll)
	}
	out.Account.Threads = []api.MeExportThread{}
	if threads, ok, err := as[api.ListThreads200JSONResponse](s.ListThreads(ctx, api.ListThreadsRequestObject{})); err != nil {
		return nil, err
	} else if ok {
		for _, t := range threads {
			msgs, ok, err := as[api.ReadThread200JSONResponse](s.ReadThread(ctx, api.ReadThreadRequestObject{UserId: t.PeerId}))
			if err != nil {
				return nil, err
			}
			if !ok {
				msgs = api.ReadThread200JSONResponse{}
			}
			out.Account.Threads = append(out.Account.Threads, api.MeExportThread{Thread: t, Messages: []api.Message(msgs)})
		}
	}

	// Heroes: every one you own, as its sheet reads.
	if !holds(auth.HeroesRead) {
		out.Omitted = append(out.Omitted, api.MeExportOmittedHeroes)
	} else {
		heroes := []api.MeExportHero{}
		mine, ok, err := as[api.ListMyCharacters200JSONResponse](s.ListMyCharacters(ctx, api.ListMyCharactersRequestObject{}))
		if err != nil {
			return nil, err
		}
		if ok {
			for _, c := range mine {
				sheet, ok, err := as[api.GetCharacter200JSONResponse](s.GetCharacter(ctx, api.GetCharacterRequestObject{CharacterId: c.Id}))
				if err != nil {
					return nil, err
				}
				if !ok {
					continue
				}
				hero := api.MeExportHero{Sheet: api.CharacterDetail(sheet)}
				if tree, ok, err := as[api.GetCharacterTree200JSONResponse](s.GetCharacterTree(ctx, api.GetCharacterTreeRequestObject{CharacterId: c.Id})); err != nil {
					return nil, err
				} else if ok {
					t := api.CharacterTreeState(tree)
					hero.Tree = &t
				}
				heroes = append(heroes, hero)
			}
		}
		out.Heroes = &heroes
	}

	// Tables: every one you sit at, as it reads to you. A token minted for
	// one table lists that table alone already.
	if !holds(auth.CampaignsRead) {
		out.Omitted = append(out.Omitted, api.MeExportOmittedCampaigns)
	} else {
		tables := []api.MeExportCampaign{}
		for _, m := range me.Campaigns {
			t, err := s.exportCampaign(ctx, m)
			if err != nil {
				return nil, err
			}
			tables = append(tables, t)
		}
		out.Campaigns = &tables
	}

	// Homebrew, exactly as the pack export gives it.
	if !holds(auth.RulesRead) {
		out.Omitted = append(out.Omitted, api.MeExportOmittedHomebrew)
	} else if pack, ok, err := as[api.ExportContentPack200JSONResponse](s.ExportContentPack(ctx, api.ExportContentPackRequestObject{})); err != nil {
		return nil, err
	} else if ok {
		out.Homebrew = &api.MeExportHomebrew{Entries: pack.Entries}
	}

	_ = uid
	return api.ExportMe200JSONResponse(out), nil
}

// exportCampaign reads one table through every door a member has.
func (s *Server) exportCampaign(ctx context.Context, m api.CampaignMembership) (api.MeExportCampaign, error) {
	id := m.Campaign.Id
	out := api.MeExportCampaign{
		Campaign: m.Campaign, Role: m.Role,
		Members: []api.Member{}, Quests: []api.Quest{}, Locations: []api.Location{}, Npcs: []api.Npc{},
		Maps: []api.MeExportMap{}, Handouts: []api.MeExportHandout{}, Chronicle: []api.ChronicleEvent{},
		Parties: []api.Party{}, Vendors: []api.Vendor{}, Encounters: []api.Encounter{}, Bestiary: []api.BestiaryEntry{},
		Trees: []api.SkillTree{}, Pregens: []api.Character{},
	}
	if v, ok, err := as[api.ListMembers200JSONResponse](s.ListMembers(ctx, api.ListMembersRequestObject{CampaignId: id})); err != nil {
		return out, err
	} else if ok {
		out.Members = v
	}
	if v, ok, err := as[api.ListQuests200JSONResponse](s.ListQuests(ctx, api.ListQuestsRequestObject{CampaignId: id})); err != nil {
		return out, err
	} else if ok {
		out.Quests = v
	}
	if v, ok, err := as[api.ListLocations200JSONResponse](s.ListLocations(ctx, api.ListLocationsRequestObject{CampaignId: id})); err != nil {
		return out, err
	} else if ok {
		out.Locations = v
	}
	if v, ok, err := as[api.ListNpcs200JSONResponse](s.ListNpcs(ctx, api.ListNpcsRequestObject{CampaignId: id})); err != nil {
		return out, err
	} else if ok {
		out.Npcs = v
	}
	if maps, ok, err := as[api.ListMaps200JSONResponse](s.ListMaps(ctx, api.ListMapsRequestObject{CampaignId: id})); err != nil {
		return out, err
	} else if ok {
		for _, mp := range maps {
			detail, ok, err := as[api.GetMap200JSONResponse](s.GetMap(ctx, api.GetMapRequestObject{MapId: mp.Id, Params: api.GetMapParams{CampaignId: id}}))
			if err != nil {
				return out, err
			}
			if !ok {
				continue
			}
			out.Maps = append(out.Maps, api.MeExportMap{
				Map:      api.MapDetail(detail),
				ImageUrl: fmt.Sprintf("/api/maps/%s/image?campaignId=%s", uuid.UUID(mp.Id), uuid.UUID(id)),
			})
		}
	}
	if v, ok, err := as[api.ListHandouts200JSONResponse](s.ListHandouts(ctx, api.ListHandoutsRequestObject{CampaignId: id})); err != nil {
		return out, err
	} else if ok {
		for _, h := range v {
			out.Handouts = append(out.Handouts, api.MeExportHandout{Handout: h, ImageUrl: fmt.Sprintf("/api/handouts/%s/image", uuid.UUID(h.Id))})
		}
	}
	// The whole chronicle: the handler's limit is a page size, not a veil.
	whole := 100000
	if v, ok, err := as[api.ListEvents200JSONResponse](s.ListEvents(ctx, api.ListEventsRequestObject{CampaignId: id, Params: api.ListEventsParams{Limit: &whole}})); err != nil {
		return out, err
	} else if ok {
		out.Chronicle = v
	}
	if v, ok, err := as[api.ListParties200JSONResponse](s.ListParties(ctx, api.ListPartiesRequestObject{CampaignId: id})); err != nil {
		return out, err
	} else if ok {
		out.Parties = v
	}
	if v, ok, err := as[api.ListVendors200JSONResponse](s.ListVendors(ctx, api.ListVendorsRequestObject{CampaignId: id})); err != nil {
		return out, err
	} else if ok {
		out.Vendors = v
	}
	if v, ok, err := as[api.ListEncounters200JSONResponse](s.ListEncounters(ctx, api.ListEncountersRequestObject{CampaignId: id})); err != nil {
		return out, err
	} else if ok {
		out.Encounters = v
	}
	if v, ok, err := as[api.ListBestiary200JSONResponse](s.ListBestiary(ctx, api.ListBestiaryRequestObject{CampaignId: id})); err != nil {
		return out, err
	} else if ok {
		out.Bestiary = v
	}
	if v, ok, err := as[api.ListTrees200JSONResponse](s.ListTrees(ctx, api.ListTreesRequestObject{CampaignId: id})); err != nil {
		return out, err
	} else if ok {
		out.Trees = v
	}
	if v, ok, err := as[api.ListPregens200JSONResponse](s.ListPregens(ctx, api.ListPregensRequestObject{CampaignId: id})); err != nil {
		return out, err
	} else if ok {
		out.Pregens = v
	}
	return out, nil
}

var _ = openapi_types.UUID{}
