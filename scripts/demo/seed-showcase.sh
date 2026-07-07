#!/usr/bin/env bash
# Seed a full showcase campaign against a running Quest Board instance.
#
#   ./scripts/demo/seed-showcase.sh [BASE_URL]     (default http://localhost:8080)
#
# Requires: curl, jq, python3. The instance must have dev login enabled
# (APP_ENV=development). Creates:
#   - DM "Aldric the Keeper" + player "Brakk Ironjaw" (dev users)
#   - campaign "Embers of the Sundered Crown" (invite code printed at the end)
#   - six quests across every difficulty + status, one claimed by the player
#   - three characters with HP state
#   - next session scheduled for the coming Saturday, 19:00
#   - "The Mark of Vecna": a 50-power six-limb skill-tree web
#     (scripts/demo/vecna-nodes.tsv + vecna-edges.txt), with both characters
#     bound and partway down their paths
set -euo pipefail

BASE="${1:-http://localhost:8080}"
API="$BASE/api"
DIR="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

req() { # req <jar> <method> <path> [json]
  local jar="$1" method="$2" path="$3" body="${4:-}"
  if [ -n "$body" ]; then
    curl -sm 15 -b "$TMP/$jar" -X "$method" "$API$path" -H 'content-type: application/json' -d "$body"
  else
    curl -sm 15 -b "$TMP/$jar" -X "$method" "$API$path"
  fi
}

echo "==> dev logins"
curl -sm 15 -c "$TMP/dm.jar" "$API/auth/dev/login?name=Aldric%20the%20Keeper" -o /dev/null
curl -sm 15 -c "$TMP/player.jar" "$API/auth/dev/login?name=Brakk%20Ironjaw" -o /dev/null

echo "==> campaign"
CAMP=$(req dm.jar POST /campaigns '{"name":"Embers of the Sundered Crown"}')
CID=$(echo "$CAMP" | jq -r .id)
CODE=$(echo "$CAMP" | jq -r .inviteCode)
req player.jar POST /campaigns/join "{\"code\":\"$CODE\"}" >/dev/null

echo "==> quests"
mkq() { req dm.jar POST "/campaigns/$CID/quests" "$1" | jq -r .id; }
Q_RATS=$(mkq '{"title":"Rats in the Cellar","description":"Something has been gnawing the ale barrels. Clear the cellar before the harvest mead is ruined.","giver":"Bram the Barkeep","location":"The Prancing Pony, Bree","difficulty":"trivial","rewards":[{"type":"gold","label":"Gold","value":"15 gp"},{"type":"reputation","label":"Favor","value":"Free Board"}]}')
Q_SMOKE=$(mkq '{"title":"Smoke Over Greywood","description":"A column of smoke rises where no charcoalers camp. Investigate the old druid grove.","giver":"Ranger Aldric","location":"Greywood Eaves","difficulty":"medium","rewards":[{"type":"gold","label":"Gold","value":"200 gp"},{"type":"item","label":"Item","value":"Cloak of Elvenkind"},{"type":"xp","label":"XP","value":"700"}]}')
mkq '{"title":"The Wyrm of Emberpeak","description":"A red wyrm has claimed the mountain pass and demands tribute in flesh and gold. End it.","giver":"Lord Castellan Vey","location":"Emberpeak Summit","difficulty":"deadly","rewards":[{"type":"gold","label":"Gold","value":"5,000 gp"},{"type":"item","label":"Hoard","value":"Dragon Trove"},{"type":"reputation","label":"Title","value":"Dragonsbane"}]}' >/dev/null
Q_BANDITS=$(mkq '{"title":"Bandits on the Kings Road","description":"The Red Sashes have been waylaying merchants past the old toll bridge. Break their grip.","giver":"Captain Sera","location":"Westmarch Crossroads","difficulty":"medium","rewards":[{"type":"gold","label":"Gold","value":"250 gp"},{"type":"xp","label":"XP","value":"600"}]}')
Q_CARAVAN=$(mkq '{"title":"Hold the Caravan","description":"Escort the spice caravan to Port Halen. The wagons were lost to a sandstorm and worse.","giver":"Merchant Doral","location":"Saltflat Trade Route","difficulty":"easy","rewards":[{"type":"gold","label":"Gold","value":"90 gp"},{"type":"other","label":"Boon","value":"Trade Discount"}]}')
mkq '{"title":"The Crypt of Saint Ulmar","description":"The wards on the tomb have failed. Something cold now walks the lower vaults.","giver":"Father Cordwain","location":"Old Chapel Undercroft","difficulty":"hard","rewards":[{"type":"gold","label":"Gold","value":"500 gp"},{"type":"item","label":"Item","value":"+1 Mace"},{"type":"reputation","label":"Rep","value":"+2 Temple"}]}' >/dev/null

# Player claims one; DM sets a spread of statuses.
req player.jar POST "/quests/$Q_SMOKE/claim" >/dev/null
req dm.jar PATCH "/quests/$Q_SMOKE" '{"title":"Smoke Over Greywood","description":"A column of smoke rises where no charcoalers camp. Investigate the old druid grove.","giver":"Ranger Aldric","location":"Greywood Eaves","difficulty":"medium","status":"active","rewards":[{"type":"gold","label":"Gold","value":"200 gp"},{"type":"item","label":"Item","value":"Cloak of Elvenkind"},{"type":"xp","label":"XP","value":"700"}]}' >/dev/null
req dm.jar PATCH "/quests/$Q_BANDITS" '{"title":"Bandits on the Kings Road","description":"The Red Sashes have been waylaying merchants past the old toll bridge. Break their grip.","giver":"Captain Sera","location":"Westmarch Crossroads","difficulty":"medium","status":"completed","rewards":[{"type":"gold","label":"Gold","value":"250 gp"},{"type":"xp","label":"XP","value":"600"}]}' >/dev/null
req dm.jar PATCH "/quests/$Q_CARAVAN" '{"title":"Hold the Caravan","description":"Escort the spice caravan to Port Halen. The wagons were lost to a sandstorm and worse.","giver":"Merchant Doral","location":"Saltflat Trade Route","difficulty":"easy","status":"failed","rewards":[{"type":"gold","label":"Gold","value":"90 gp"},{"type":"other","label":"Boon","value":"Trade Discount"}]}' >/dev/null

echo "==> party"
BRAKK=$(req player.jar POST "/campaigns/$CID/characters" '{"name":"Brakk Ironjaw","class":"Mountain Dwarf Fighter","level":6,"hpCurrent":40,"hpMax":61}' | jq -r .id)
LYRA=$(req dm.jar POST "/campaigns/$CID/characters" '{"name":"Lyra Wren","class":"Half-Elf Bard","level":6,"hpCurrent":43,"hpMax":44}' | jq -r .id)
req dm.jar POST "/campaigns/$CID/characters" '{"name":"Mortimer Vale","class":"Tiefling Warlock","level":5,"hpCurrent":9,"hpMax":40}' >/dev/null

echo "==> next gathering (coming Saturday, 19:00)"
NEXT=$(python3 -c "
from datetime import datetime, timedelta, timezone
now = datetime.now().astimezone()
days = (5 - now.weekday()) % 7 or 7
s = (now + timedelta(days=days)).replace(hour=19, minute=0, second=0, microsecond=0)
print(s.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))")
req dm.jar PUT "/campaigns/$CID/next-session" "{\"nextSessionAt\":\"$NEXT\"}" >/dev/null

echo "==> the Mark of Vecna (50 powers, 6 limbs)"
TID=$(req dm.jar POST "/campaigns/$CID/trees" '{"name":"The Mark of Vecna","description":"The complete mark: six limbs, fifty powers, six keystones. Every piece of him you take makes you more his.","keystonePickCost":1}' | jq -r .id)
> "$TMP/nodemap.tsv"
while IFS=$'\t' read -r limb rarity entry name desc trade; do
  BODY=$(jq -n --arg n "$name" --arg l "$limb" --arg r "$rarity" --arg d "$desc" --arg t "${trade:-}" \
    --argjson e "$([ "$entry" = "1" ] && echo true || echo false)" \
    '{name:$n, limb:$l, rarity:$r, isEntry:$e, description:$d} + (if $t != "" then {tradeoff:$t} else {} end)')
  ID=$(req dm.jar POST "/trees/$TID/nodes" "$BODY" | jq -r .id)
  printf '%s\t%s\n' "$name" "$ID" >> "$TMP/nodemap.tsv"
done < "$DIR/vecna-nodes.tsv"
EDGES=$(python3 - "$TMP/nodemap.tsv" "$DIR/vecna-edges.txt" <<'EOF'
import json, sys
m = dict(line.rstrip("\n").split("\t") for line in open(sys.argv[1]))
edges = []
for line in open(sys.argv[2]):
    a, b = line.rstrip("\n").split("|")
    edges.append({"a": m[a], "b": m[b]})
print(json.dumps({"edges": edges}))
EOF
)
req dm.jar PUT "/trees/$TID/edges" "$EDGES" | jq -c '{nodes: (.nodes|length), edges: (.edges|length)}'

echo "==> pacts + picks"
nid() { grep -P "^$1\t" "$TMP/nodemap.tsv" | cut -f2; }
req dm.jar PUT "/characters/$LYRA/tree" "{\"treeId\":\"$TID\"}" >/dev/null
req dm.jar POST "/characters/$LYRA/tree/grants" '{"picks":5}' >/dev/null
for n in "Withering Touch" "Hunger" "Sour Ground"; do
  req dm.jar POST "/characters/$LYRA/tree/picks" "{\"nodeId\":\"$(nid "$n")\"}" >/dev/null
done
req dm.jar PUT "/characters/$BRAKK/tree" "{\"treeId\":\"$TID\"}" >/dev/null
req dm.jar POST "/characters/$BRAKK/tree/grants" '{"picks":2}' >/dev/null
req player.jar POST "/characters/$BRAKK/tree/picks" "{\"nodeId\":\"$(nid "Cold Grip")\"}" >/dev/null

echo
echo "SEEDED. Campaign: Embers of the Sundered Crown"
echo "  invite code: $CODE"
echo "  DM login (dev door):     Aldric the Keeper"
echo "  player login (dev door): Brakk Ironjaw"
echo "  app: $BASE"
