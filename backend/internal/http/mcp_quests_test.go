package http

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/goncalo1021pt/questboard/backend/internal/api"
)

func TestReachNote(t *testing.T) {
	yes, no := true, false
	kraft := api.VisibilityOverride{CharacterName: "Kraft", Visible: true}
	jibo := api.VisibilityOverride{CharacterName: "Jibo", Visible: false}
	cases := []struct {
		name string
		vis  *bool
		over *[]api.VisibilityOverride
		want string
	}{
		{"a player's payload says nothing", nil, nil, ""},
		{"open to all", &yes, &[]api.VisibilityOverride{}, ""},
		{"hidden", &no, &[]api.VisibilityOverride{}, "hidden from the party"},
		{"hidden but given to one", &no, &[]api.VisibilityOverride{kraft}, "hidden from the party; shown to Kraft"},
		{"open except one", &yes, &[]api.VisibilityOverride{jibo}, "seen by the party except Jibo"},
	}
	for _, c := range cases {
		if got := reachNote(c.vis, c.over); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestRenderQuestIsWhole(t *testing.T) {
	long := strings.Repeat("The sea is wide. ", 40) + "\n\nSecond paragraph."
	yes, payable := true, true
	paid := time.Date(2026, 11, 1, 18, 0, 0, 0, time.UTC)
	hero := "Kraft"
	loc := "Porto"
	giver := "the Guildmistress"
	qty := 3
	value := "50 gp"
	q := api.Quest{
		Id: openapi_types.UUID(uuid.New()), Title: "Reach the sea", Description: long,
		Status: api.QuestStatusCompleted, Difficulty: "hard", Location: &loc, Giver: &giver,
		VisibleToParty: &yes, PaidAt: &paid,
		Rewards: []api.QuestReward{{Label: "Gold", Value: &value, Payable: &payable}, {Label: "Torch", Qty: &qty}},
		Claims:  []api.QuestClaim{{HeroName: &hero, UserName: "Sam", ClaimedAt: paid}},
	}
	got := renderQuest(q)
	for _, want := range []string{"Second paragraph.", "at Porto", "from the Guildmistress", "Gold (50 gp) — can be paid out", "Torch ×3", "Paid out", "Kraft (played by Sam)"} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in:\n%s", want, got)
		}
	}
	if strings.Count(got, "The sea is wide.") != 40 {
		t.Error("the description was cut")
	}
}

func pngOf(w, h int, a uint8) []byte {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.NRGBA{R: 30, G: 120, B: 60, A: a})
		}
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

func TestHandoutImageForModel(t *testing.T) {
	small := pngOf(240, 160, 255)
	data, mime, err := handoutImageForModel(small, "image/png")
	if err != nil || mime != "image/png" || !bytes.Equal(data, small) {
		t.Fatalf("a small picture should go as stored: mime=%s err=%v", mime, err)
	}

	data, mime, err = handoutImageForModel(pngOf(3000, 2000, 255), "image/png")
	if err != nil || mime != "image/jpeg" {
		t.Fatalf("a large picture should come back a JPEG: mime=%s err=%v", mime, err)
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || cfg.Width != modelImageEdge || cfg.Height != 1045 {
		t.Fatalf("scaled to %dx%d, err=%v", cfg.Width, cfg.Height, err)
	}

	// A clear PNG is flattened onto white, not onto the black JPEG would make.
	data, _, err = handoutImageForModel(pngOf(2000, 2000, 0), "image/png")
	if err != nil {
		t.Fatal(err)
	}
	img, _, _ := image.Decode(bytes.NewReader(data))
	r, g, b, _ := img.At(10, 10).RGBA()
	if r>>8 < 240 || g>>8 < 240 || b>>8 < 240 {
		t.Errorf("transparent pixel came out %d,%d,%d, want white", r>>8, g>>8, b>>8)
	}

	if _, _, err := handoutImageForModel([]byte("not an image"), "image/png"); err == nil {
		t.Error("garbage should not pass")
	}
}
