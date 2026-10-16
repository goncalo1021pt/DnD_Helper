package http

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/goncalo1021pt/questboard/backend/internal/db"
	"github.com/goncalo1021pt/questboard/backend/internal/rules"
)

// The SRD's armory as a kit is matched against it, by lowercased name.
func seededLibrary(t *testing.T) itemLibrary {
	t.Helper()
	lib := itemLibrary{}
	for _, e := range seededItems(t) {
		lib[strings.ToLower(e.Name)] = db.ListContentByKindRow{ID: uuid.New(), Name: e.Name}
	}
	return lib
}

type seededEntry struct {
	Name string          `json:"name"`
	Data json.RawMessage `json:"data"`
}

func seeded(t *testing.T, file string) []seededEntry {
	t.Helper()
	raw, err := rules.SRDFile("srd/" + file)
	if err != nil {
		t.Fatal(err)
	}
	var out []seededEntry
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// The bug this issue is: twenty kit names matched nothing, so a Fighter's pack
// was half free text. Every name a book kit or an equipment pack uses must be
// an armory item, so a hero is handed things they can equip and use (#390).
func TestEveryStartingKitNameIsInTheArmory(t *testing.T) {
	lib := seededLibrary(t)
	checked := 0
	check := func(source, label string, it kitItem) {
		checked++
		if len(it.Choose) > 0 {
			for _, name := range it.Choose {
				if _, _, ok := lib.find(name, 1); !ok {
					t.Errorf("%s %s: choose option %q is not in the armory", source, label, name)
				}
			}
			return
		}
		if _, _, ok := lib.find(it.Name, max(it.Qty, 1)); !ok {
			t.Errorf("%s %s: %q is not in the armory", source, label, it.Name)
		}
	}
	for _, file := range []string{"classes.json", "backgrounds.json"} {
		for _, e := range seeded(t, file) {
			for _, o := range kitOptionsOf(e.Data, true) {
				for _, it := range o.Items {
					check(e.Name, o.Label, it)
				}
			}
		}
	}
	if checked < 80 {
		t.Fatalf("only %d kit lines were checked — the guard is not reading the kits", checked)
	}
	packs := 0
	for _, e := range seeded(t, "items.json") {
		for _, c := range contentsOf(e.Data) {
			packs++
			if _, ok := lib[strings.ToLower(c.Name)]; !ok {
				t.Errorf("%s holds %q, which is not an armory item", e.Name, c.Name)
			}
		}
	}
	if packs == 0 {
		t.Error("no equipment pack declares contents")
	}
}

func TestEveryClassAndBackgroundOffersAKit(t *testing.T) {
	for _, e := range seeded(t, "classes.json") {
		if len(kitOptionsOf(e.Data, false)) < 2 {
			t.Errorf("%s offers fewer than two starting options", e.Name)
		}
	}
	for _, e := range seeded(t, "backgrounds.json") {
		opts := kitOptionsOf(e.Data, true)
		if len(opts) != 2 || opts[1].Gold != 50 || len(opts[1].Items) != 0 {
			t.Errorf("%s should offer its kit or 50 gp, got %+v", e.Name, opts)
		}
	}
}

func TestSRDBackgroundsAreLegalContent(t *testing.T) {
	for _, e := range seeded(t, "backgrounds.json") {
		var data map[string]interface{}
		if err := json.Unmarshal(e.Data, &data); err != nil {
			t.Fatal(err)
		}
		if msg := validateContentData(db.ContentKindBackground, data); msg != "" {
			t.Errorf("%s: %s", e.Name, msg)
		}
	}
}

func TestLibraryMatchesAKitName(t *testing.T) {
	lib := seededLibrary(t)
	cases := []struct {
		name   string
		bundle int
		want   string
		qty    int
		ok     bool
	}{
		{"Longsword", 1, "Longsword", 1, true},
		{"longswords", 1, "Longsword", 1, true},
		{"Leather", 1, "Leather Armor", 1, true},
		{"Arrow", 20, "Arrows (20)", 1, true},
		{"Arrows", 20, "Arrows (20)", 1, true},
		{"Explorer's Pack", 1, "Explorer's Pack", 1, true},
		{"Philosopher's Stone", 1, "", 1, false},
	}
	for _, c := range cases {
		row, qty, ok := lib.find(c.name, c.bundle)
		if ok != c.ok || (ok && (row.Name != c.want || qty != c.qty)) {
			t.Errorf("%s ×%d: got %q ×%d ok=%v, want %q ×%d ok=%v", c.name, c.bundle, row.Name, qty, ok, c.want, c.qty, c.ok)
		}
	}
}

func TestPackUnpacksToItsContents(t *testing.T) {
	lib := seededLibrary(t)
	var explorer []packContent
	for _, e := range seeded(t, "items.json") {
		if e.Name == "Explorer's Pack" {
			explorer = contentsOf(e.Data)
		}
	}
	lines := unpackedLines(lib, explorer, 1)
	byName := map[string]int32{}
	for _, l := range lines {
		byName[l.name] += l.qty
		if !l.contentID.Valid {
			t.Errorf("%s should be matched to the armory", l.name)
		}
	}
	if byName["Torch"] != 10 || byName["Rations"] != 10 || byName["Backpack"] != 1 || byName["Rope (50 ft)"] != 1 {
		t.Errorf("an Explorer's Pack is a backpack, rope, 10 torches and 10 days of rations: %v", byName)
	}
	for _, l := range unpackedLines(lib, explorer, 2) {
		if l.name == "Torch" && l.qty != 20 {
			t.Errorf("two packs hold 20 torches, got %d", l.qty)
		}
	}
	// A name the library lacks is written in rather than dropped.
	odd := unpackedLines(lib, []packContent{{Name: "Philosopher's Stone", Qty: 1}}, 1)
	if len(odd) != 1 || odd[0].contentID.Valid || odd[0].name != "Philosopher's Stone" {
		t.Errorf("an unknown name should ride as free text: %+v", odd)
	}
}

func TestProseKitFallback(t *testing.T) {
	items, gold := parseEquipmentLine("Spear, shortbow with 20 arrows, two pouches, 14 gp")
	names := []string{}
	for _, it := range items {
		names = append(names, strings.ToLower(it.Name))
	}
	if gold != 14 || strings.Join(names, "|") != "spear|shortbow|arrows|pouches" {
		t.Errorf("got %v %d", names, gold)
	}
	if items[2].Qty != 20 || items[3].Qty != 2 {
		t.Errorf("quantities lost: %+v", items)
	}
	opts := kitOptionsOf([]byte(`{"equipment":"Rope, 5 gp"}`), true)
	if len(opts) != 2 || opts[0].Gold != 5 || opts[1].Gold != 50 {
		t.Errorf("prose becomes A, with the books' 50 gp as B: %+v", opts)
	}
	if got := kitOptionsOf([]byte(`{"equipment":"Rope, 5 gp"}`), false); len(got) != 0 {
		t.Errorf("a class has no prose fallback: %+v", got)
	}
}

func TestPackOptionsSpeakTheTablesMoney(t *testing.T) {
	lib := seededLibrary(t)
	shards := Coinage{Coins: []Coin{{Name: "Shard", Abbrev: "sh", Value: 1}, {Name: "Crown", Abbrev: "cr", Value: 20}}}
	opt := packOption(kitOption{Label: "B", Gold: 155}, lib, shards)
	// On a table with no gold the largest coin stands in for one.
	if opt.Coin == nil || *opt.Coin != "155 cr" {
		t.Errorf("155 gp at a table of crowns is 155 crowns, got %v", opt.Coin)
	}
	std := packOption(kitOption{Label: "A", Gold: 4, Items: []kitItem{
		{Name: "Chain Mail", Qty: 1},
		{Name: "Musical Instrument", Qty: 1, Choose: []string{"Lute", "Flute"}},
	}}, lib, standardCoinage)
	if std.Coin == nil || *std.Coin != "4 gp" || len(std.Lines) != 2 {
		t.Fatalf("got %+v", std)
	}
	if std.Lines[0].ContentId == nil || std.Lines[1].Choose == nil || len(*std.Lines[1].Choose) != 2 {
		t.Errorf("fixed lines carry an armory id, choose lines carry their options: %+v", std.Lines)
	}
}

func TestPackValidation(t *testing.T) {
	var ok map[string]interface{}
	_ = json.Unmarshal([]byte(`{"contents":[{"name":"Torch","qty":10}]}`), &ok)
	if msg := validatePackContents(ok); msg != "" {
		t.Errorf("a good pack is refused: %s", msg)
	}
	bad := map[string]string{
		"empty":      `{"contents":[]}`,
		"no name":    `{"contents":[{"qty":1}]}`,
		"no qty":     `{"contents":[{"name":"Torch"}]}`,
		"too many":   `{"contents":[{"name":"Torch","qty":1000}]}`,
		"not a list": `{"contents":"torches"}`,
	}
	for name, raw := range bad {
		var d map[string]interface{}
		_ = json.Unmarshal([]byte(raw), &d)
		if validatePackContents(d) == "" {
			t.Errorf("%s: should be refused", name)
		}
	}
	kit := func(raw string) string {
		var d map[string]interface{}
		_ = json.Unmarshal([]byte(raw), &d)
		return validateStartingEquipment(d)
	}
	if msg := kit(`{"startingEquipment":[{"label":"A","items":[{"name":"Lute","qty":1,"choose":["Lute","Flute"]}],"gold":5},{"label":"B","gold":50}]}`); msg != "" {
		t.Errorf("a good kit is refused: %s", msg)
	}
	for name, raw := range map[string]string{
		"two A":             `{"startingEquipment":[{"label":"A"},{"label":"a"}]}`,
		"choose of one":     `{"startingEquipment":[{"label":"A","items":[{"name":"x","choose":["y"]}]}]}`,
		"negative gold":     `{"startingEquipment":[{"label":"A","gold":-1}]}`,
		"an item with none": `{"startingEquipment":[{"label":"A","items":[{"qty":1}]}]}`,
	} {
		if kit(raw) == "" {
			t.Errorf("%s: should be refused", name)
		}
	}
}
