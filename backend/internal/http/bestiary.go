package http

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
	"github.com/goncalo1021pt/questboard/backend/internal/db"
)

// The four record sections a DM can unveil, in reading order.
var bestiarySections = []string{"defenses", "traits", "offense", "lore"}

// --- record carving -------------------------------------------------------
//
// A monster's stat block is one markdown blob plus a few structured fields.
// The Bestiary reveals it a section at a time, so the server carves the blob
// into named sections and hands members only the ones the DM has unveiled.
// Carving lives here (not the client) so unrevealed sections never cross the
// wire — the Den's data stays DM-only by construction.

type monsterFields struct {
	Size        string         `json:"size"`
	Type        string         `json:"type"`
	Alignment   string         `json:"alignment"`
	AC          int            `json:"ac"`
	HP          int            `json:"hp"`
	Speed       string         `json:"speed"`
	CR          string         `json:"cr"`
	Abilities   map[string]int `json:"abilities"`
	Description string         `json:"description"`
}

var offenseHeaders = map[string]bool{
	"**Actions**":           true,
	"**Bonus Actions**":     true,
	"**Reactions**":         true,
	"**Legendary Actions**": true,
}

// Defensive/sensory lines kept from the stat-block preamble (AC/HP/Speed/CR
// are rendered from structured fields instead, so they're skipped here).
var defenseLabels = []string{
	"**Saving Throws**", "**Skills**", "**Resistances**", "**Immunities**",
	"**Vulnerabilities**", "**Senses**", "**Languages**", "**Gear**",
}

// monsterSections splits a monster's data into the revealable sections. A
// section is omitted when the creature has nothing for it.
func monsterSections(raw []byte) map[string]string {
	var m monsterFields
	if err := json.Unmarshal(raw, &m); err != nil {
		return map[string]string{}
	}
	blocks := strings.Split(strings.TrimSpace(m.Description), "\n\n")
	for i := range blocks {
		blocks[i] = strings.TrimSpace(blocks[i])
	}

	traitsIdx, offenseIdx := -1, -1
	for i, b := range blocks {
		if b == "**Traits**" && traitsIdx == -1 {
			traitsIdx = i
		}
		if offenseIdx == -1 && offenseHeaders[b] {
			offenseIdx = i
		}
	}
	preEnd := len(blocks)
	if traitsIdx != -1 {
		preEnd = traitsIdx
	}
	if offenseIdx != -1 && offenseIdx < preEnd {
		preEnd = offenseIdx
	}

	out := map[string]string{}

	// Defenses: identity, AC/HP/Speed, ability table, plus any defensive
	// preamble lines (saves, skills, senses, languages, resistances…).
	var def strings.Builder
	fmt.Fprintf(&def, "_%s %s, %s_\n\n", m.Size, m.Type, m.Alignment)
	fmt.Fprintf(&def, "**AC** %d · **HP** %d · **Speed** %s\n\n", m.AC, m.HP, m.Speed)
	def.WriteString(abilityTable(m.Abilities))
	for _, b := range blocks[:preEnd] {
		if hasAnyPrefix(b, defenseLabels) {
			def.WriteString("\n\n" + b)
		}
	}
	out["defenses"] = strings.TrimSpace(def.String())

	// Traits: the block between the Traits header and the first offense header.
	if traitsIdx != -1 {
		tEnd := len(blocks)
		if offenseIdx != -1 && offenseIdx > traitsIdx {
			tEnd = offenseIdx
		}
		if body := strings.TrimSpace(strings.Join(blocks[traitsIdx+1:tEnd], "\n\n")); body != "" {
			out["traits"] = body
		}
	}

	// Offense: the actions header onward.
	if offenseIdx != -1 {
		if body := strings.TrimSpace(strings.Join(blocks[offenseIdx:], "\n\n")); body != "" {
			out["offense"] = body
		}
	}

	// Lore: the threat rating (the one flavor beat SRD blocks carry).
	if m.CR != "" {
		out["lore"] = "**Challenge Rating** " + m.CR
	}
	return out
}

func abilityTable(a map[string]int) string {
	order := []string{"str", "dex", "con", "int", "wis", "cha"}
	var cells strings.Builder
	cells.WriteString("|")
	for _, k := range order {
		cells.WriteString(fmt.Sprintf(" %d (%+d) |", a[k], abilityMod(a[k])))
	}
	return "| STR | DEX | CON | INT | WIS | CHA |\n" +
		"| --- | --- | --- | --- | --- | --- |\n" + cells.String()
}

func hasAnyPrefix(s string, prefixes []string) bool {
	for _, p := range prefixes {
		if strings.HasPrefix(s, p) {
			return true
		}
	}
	return false
}

// --- response assembly ----------------------------------------------------

// bestiaryRow is the shared shape of the list and get queries.
type bestiaryRow struct {
	ID          uuid.UUID
	ContentID   pgtype.UUID
	Title       string
	Revealed    []string
	CreatedBy   pgtype.UUID
	MonsterName *string
	MonsterData []byte
}

func rowFromList(r db.ListBestiaryEntriesRow) bestiaryRow {
	return bestiaryRow{r.ID, r.ContentID, r.Title, r.Revealed, r.CreatedBy, r.MonsterName, r.MonsterData}
}
func rowFromGet(r db.GetBestiaryEntryRow) bestiaryRow {
	return bestiaryRow{r.ID, r.ContentID, r.Title, r.Revealed, r.CreatedBy, r.MonsterName, r.MonsterData}
}

// toAPIBestiaryEntry renders one entry for a viewer: the DM sees every section
// (with revealed flags), a player sees only the unveiled ones.
func toAPIBestiaryEntry(row bestiaryRow, notes []db.ListBestiaryNotesRow, isDM bool, viewer uuid.UUID) api.BestiaryEntry {
	identified := row.ContentID.Valid
	revealedSet := map[string]bool{}
	revealed := make([]api.BestiaryEntryRevealed, 0, len(row.Revealed))
	for _, s := range row.Revealed {
		revealedSet[s] = true
		revealed = append(revealed, api.BestiaryEntryRevealed(s))
	}

	record := map[string]string{}
	if identified {
		all := monsterSections(row.MonsterData)
		for _, key := range bestiarySections {
			body, ok := all[key]
			if !ok {
				continue
			}
			// DM sees the whole record; players only unveiled sections.
			if isDM || revealedSet[key] {
				record[key] = body
			}
		}
	}

	out := api.BestiaryEntry{
		Id:         row.ID,
		Title:      row.Title,
		Identified: identified,
		Revealed:   revealed,
		Record:     record,
		Notes:      make([]api.BestiaryNote, 0, len(notes)),
		CanEdit:    isDM || (row.CreatedBy.Valid && uuid.UUID(row.CreatedBy.Bytes) == viewer),
		IsDM:       isDM,
	}
	if identified && row.MonsterName != nil {
		out.MonsterName = row.MonsterName
	}
	for _, n := range notes {
		note := api.BestiaryNote{
			Id:   n.ID,
			Body: n.Body,
			Mine: n.AuthorID.Valid && uuid.UUID(n.AuthorID.Bytes) == viewer,
		}
		if n.AuthorName != nil {
			note.AuthorName = n.AuthorName
		}
		if n.CreatedAt.Valid {
			t := n.CreatedAt.Time
			note.CreatedAt = &t
		}
		out.Notes = append(out.Notes, note)
	}
	return out
}

// --- handlers -------------------------------------------------------------

// ListBestiary returns the campaign's field journal, filtered per viewer.
func (s *Server) ListBestiary(ctx context.Context, request api.ListBestiaryRequestObject) (api.ListBestiaryResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireMember(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.ListBestiary401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.ListBestiary403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	rows, err := s.queries.ListBestiaryEntries(ctx, campaignID)
	if err != nil {
		return nil, err
	}
	notesByEntry, err := s.bestiaryNotesByEntry(ctx, entryIDs(rows))
	if err != nil {
		return nil, err
	}
	isDM := member.Role == db.MembershipRoleDm
	out := make(api.ListBestiary200JSONResponse, 0, len(rows))
	for _, r := range rows {
		out = append(out, toAPIBestiaryEntry(rowFromList(r), notesByEntry[r.ID], isDM, member.UserID))
	}
	return out, nil
}

// CreateBestiaryEntry logs a new sighting for any member of the table.
func (s *Server) CreateBestiaryEntry(ctx context.Context, request api.CreateBestiaryEntryRequestObject) (api.CreateBestiaryEntryResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireMember(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.CreateBestiaryEntry401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.CreateBestiaryEntry403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	if request.Body == nil {
		return api.CreateBestiaryEntry400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "a title is required"}}, nil
	}
	title := strings.TrimSpace(request.Body.Title)
	if title == "" || len([]rune(title)) > 120 {
		return api.CreateBestiaryEntry400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "title must be between 1 and 120 characters"}}, nil
	}
	id, err := s.queries.CreateBestiaryEntry(ctx, db.CreateBestiaryEntryParams{
		CampaignID: campaignID,
		Title:      title,
		CreatedBy:  pgUUID(member.UserID),
	})
	if err != nil {
		return nil, err
	}
	entry, err := s.freshBestiaryEntry(ctx, id, member)
	if err != nil {
		return nil, err
	}
	return api.CreateBestiaryEntry201JSONResponse(entry), nil
}

// UpdateBestiaryEntry renames a sighting (creator/DM) or identifies and
// unveils it (DM only).
func (s *Server) UpdateBestiaryEntry(ctx context.Context, request api.UpdateBestiaryEntryRequestObject) (api.UpdateBestiaryEntryResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireMember(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.UpdateBestiaryEntry401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.UpdateBestiaryEntry403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	badRequest := func(msg string) (api.UpdateBestiaryEntryResponseObject, error) {
		return api.UpdateBestiaryEntry400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: msg}}, nil
	}
	row, err := s.queries.GetBestiaryEntry(ctx, request.EntryId)
	if err != nil || row.CampaignID != campaignID {
		return api.UpdateBestiaryEntry404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	if request.Body == nil {
		return badRequest("a patch body is required")
	}
	isDM := member.Role == db.MembershipRoleDm
	isCreator := row.CreatedBy.Valid && uuid.UUID(row.CreatedBy.Bytes) == member.UserID
	body := request.Body

	// Identify/unveil are DM powers; renaming is the creator's or the DM's.
	if (body.ContentId != nil || body.Revealed != nil) && !isDM {
		return api.UpdateBestiaryEntry403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
	}
	if body.Title != nil && !isDM && !isCreator {
		return api.UpdateBestiaryEntry403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
	}

	title := row.Title
	if body.Title != nil {
		t := strings.TrimSpace(*body.Title)
		if t == "" || len([]rune(t)) > 120 {
			return badRequest("title must be between 1 and 120 characters")
		}
		title = t
	}

	contentID := row.ContentID
	revealed := row.Revealed
	if body.ContentId != nil {
		if uuid.UUID(*body.ContentId) == uuid.Nil {
			// Unlink: the creature is unknown again, nothing left to reveal.
			contentID = pgtype.UUID{}
			revealed = []string{}
		} else {
			content, err := s.queries.GetContent(ctx, uuid.UUID(*body.ContentId))
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return badRequest("no such creature in the Den")
				}
				return nil, err
			}
			if content.Kind != db.ContentKindMonster {
				return badRequest("only Den monsters can identify a sighting")
			}
			contentID = pgUUID(content.ID)
		}
	}
	if body.Revealed != nil {
		revealed = normalizeRevealed(*body.Revealed)
	}
	// A sighting with no creature can hold no revelations.
	if !contentID.Valid {
		revealed = []string{}
	}

	if err := s.queries.UpdateBestiaryEntry(ctx, db.UpdateBestiaryEntryParams{
		ID:        row.ID,
		Title:     title,
		ContentID: contentID,
		Revealed:  revealed,
	}); err != nil {
		return nil, err
	}
	entry, err := s.freshBestiaryEntry(ctx, row.ID, member)
	if err != nil {
		return nil, err
	}
	return api.UpdateBestiaryEntry200JSONResponse(entry), nil
}

// DeleteBestiaryEntry removes a sighting and its notes (creator or DM).
func (s *Server) DeleteBestiaryEntry(ctx context.Context, request api.DeleteBestiaryEntryRequestObject) (api.DeleteBestiaryEntryResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireMember(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.DeleteBestiaryEntry401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteBestiaryEntry403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	row, err := s.queries.GetBestiaryEntry(ctx, request.EntryId)
	if err != nil || row.CampaignID != campaignID {
		return api.DeleteBestiaryEntry404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	isCreator := row.CreatedBy.Valid && uuid.UUID(row.CreatedBy.Bytes) == member.UserID
	if member.Role != db.MembershipRoleDm && !isCreator {
		return api.DeleteBestiaryEntry403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
	}
	if err := s.queries.DeleteBestiaryEntry(ctx, row.ID); err != nil {
		return nil, err
	}
	return api.DeleteBestiaryEntry204Response{}, nil
}

// AddBestiaryNote pens a field note; any member may observe a creature.
func (s *Server) AddBestiaryNote(ctx context.Context, request api.AddBestiaryNoteRequestObject) (api.AddBestiaryNoteResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireMember(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.AddBestiaryNote401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.AddBestiaryNote403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	row, err := s.queries.GetBestiaryEntry(ctx, request.EntryId)
	if err != nil || row.CampaignID != campaignID {
		return api.AddBestiaryNote404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	if request.Body == nil {
		return api.AddBestiaryNote400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "a note body is required"}}, nil
	}
	note := strings.TrimSpace(request.Body.Body)
	if note == "" || len([]rune(note)) > 2000 {
		return api.AddBestiaryNote400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "a note must be between 1 and 2000 characters"}}, nil
	}
	if _, err := s.queries.AddBestiaryNote(ctx, db.AddBestiaryNoteParams{
		EntryID:  row.ID,
		AuthorID: pgUUID(member.UserID),
		Body:     note,
	}); err != nil {
		return nil, err
	}
	entry, err := s.freshBestiaryEntry(ctx, row.ID, member)
	if err != nil {
		return nil, err
	}
	return api.AddBestiaryNote201JSONResponse(entry), nil
}

// DeleteBestiaryNote erases a field note (its author, or the DM).
func (s *Server) DeleteBestiaryNote(ctx context.Context, request api.DeleteBestiaryNoteRequestObject) (api.DeleteBestiaryNoteResponseObject, error) {
	campaignID := uuid.UUID(request.CampaignId)
	member, err := s.requireMember(ctx, campaignID)
	if err != nil {
		switch {
		case errors.Is(err, errNoAuth):
			return api.DeleteBestiaryNote401JSONResponse{UnauthorizedJSONResponse: unauthorized()}, nil
		case errors.Is(err, errForbidden):
			return api.DeleteBestiaryNote403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
		default:
			return nil, err
		}
	}
	note, err := s.queries.GetBestiaryNote(ctx, request.NoteId)
	if err != nil || note.EntryID != request.EntryId {
		return api.DeleteBestiaryNote404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	entry, err := s.queries.GetBestiaryEntry(ctx, note.EntryID)
	if err != nil || entry.CampaignID != campaignID {
		return api.DeleteBestiaryNote404JSONResponse{NotFoundJSONResponse: notFound()}, nil
	}
	isAuthor := note.AuthorID.Valid && uuid.UUID(note.AuthorID.Bytes) == member.UserID
	if member.Role != db.MembershipRoleDm && !isAuthor {
		return api.DeleteBestiaryNote403JSONResponse{ForbiddenJSONResponse: forbidden()}, nil
	}
	if err := s.queries.DeleteBestiaryNote(ctx, note.ID); err != nil {
		return nil, err
	}
	return api.DeleteBestiaryNote204Response{}, nil
}

// --- helpers --------------------------------------------------------------

func (s *Server) freshBestiaryEntry(ctx context.Context, id uuid.UUID, member db.Membership) (api.BestiaryEntry, error) {
	row, err := s.queries.GetBestiaryEntry(ctx, id)
	if err != nil {
		return api.BestiaryEntry{}, err
	}
	notesByEntry, err := s.bestiaryNotesByEntry(ctx, []uuid.UUID{id})
	if err != nil {
		return api.BestiaryEntry{}, err
	}
	isDM := member.Role == db.MembershipRoleDm
	return toAPIBestiaryEntry(rowFromGet(row), notesByEntry[id], isDM, member.UserID), nil
}

func (s *Server) bestiaryNotesByEntry(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID][]db.ListBestiaryNotesRow, error) {
	out := map[uuid.UUID][]db.ListBestiaryNotesRow{}
	if len(ids) == 0 {
		return out, nil
	}
	notes, err := s.queries.ListBestiaryNotes(ctx, ids)
	if err != nil {
		return nil, err
	}
	for _, n := range notes {
		out[n.EntryID] = append(out[n.EntryID], n)
	}
	return out, nil
}

func entryIDs(rows []db.ListBestiaryEntriesRow) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	return ids
}

// normalizeRevealed keeps only known section keys, de-duplicated.
func normalizeRevealed(in []api.BestiaryEntryPatchRevealed) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, r := range in {
		key := string(r)
		for _, valid := range bestiarySections {
			if key == valid && !seen[key] {
				seen[key] = true
				out = append(out, key)
			}
		}
	}
	return out
}
