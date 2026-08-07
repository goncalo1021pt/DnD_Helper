#!/usr/bin/env python3
"""
Regenerate the SRD magic items in backend/internal/rules/srd/items.json (#189).

The mundane 55 stay hand-authored and untouched; everything with a rarity is
generated from two sources and appended after them:

  1. The +1/+2/+3 ladder, synthesized over the seed's own mundane armors,
     weapons and shield — the 2024 SRD carries these as generic variants
     ("+1 Weapon"), which no concrete data file expands, so we expand them
     over the bases this app actually ships.
  2. Every concrete item the hand-saved 5etools archive flags `srd52` with a
     real rarity — named weapons and armor with mechanics, rings, wondrous
     gear with an inferred `wear` slot, potions and scrolls as carried gear.

Descriptions ride through rhw_pack.py's battle-tested renderer (paragraphs,
bold, italics and tables only — the app's reader knows no lists), which is
why this script imports it rather than re-solving that.

Usage:
    python3 scripts/gen-srd-items.py [--tools ~/Documents/personal/dnd]

The output file is the artifact; review the diff, then commit it. Run the Go
test suite afterwards — backend/internal/http holds every generated entry to
the same validator a pack import faces.
"""

import argparse
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED = os.path.join(REPO, "backend", "internal", "rules", "srd", "items.json")

GOOD_RARITIES = {"common", "uncommon", "rare", "very rare", "legendary", "artifact"}

DMG_TYPES = {"S": "slashing", "P": "piercing", "B": "bludgeoning", "N": "necrotic",
             "R": "radiant", "F": "fire", "C": "cold", "L": "lightning", "A": "acid",
             "T": "thunder", "I": "poison", "Y": "psychic", "O": "force"}
PROPS = {"F": "Finesse", "L": "Light", "T": "Thrown", "V": "Versatile", "H": "Heavy",
         "R": "Reach", "2H": "Two-Handed", "A": "Ammunition", "LD": "Loading", "S": "Special"}
ARMOR_CATEGORY = {"LA": "Light", "MA": "Medium", "HA": "Heavy"}

# The XDMG rarities of the generic ladder.
LADDER_RARITY = {
    "armor":  {1: "Rare", 2: "Very Rare", 3: "Legendary"},
    "shield": {1: "Uncommon", 2: "Rare", 3: "Very Rare"},
    "weapon": {1: "Uncommon", 2: "Rare", 3: "Very Rare"},
}

# Worn-kind inference for wondrous items, by how the thing is named. Mirrors
# wearSlots in backend/internal/http/inventory.go.
WEAR_PREFIXES = [
    (("cloak", "cape", "mantle"), "cloak"),
    (("amulet", "necklace", "periapt", "medallion", "brooch", "scarab", "talisman"), "amulet"),
    (("helm", "hat", "circlet", "crown", "headband", "cap of"), "helm"),
    (("belt", "girdle"), "belt"),
    (("boots", "slippers"), "boots"),
    (("gloves", "gauntlets"), "gloves"),
    (("bracers", "bracelet"), "bracers"),
    (("ring ", "ring of"), "ring"),
]


def wear_of(name: str, type_code: str) -> str:
    if type_code == "RG":
        return "ring"
    lowered = name.lower()
    for prefixes, kind in WEAR_PREFIXES:
        if any(lowered.startswith(p) for p in prefixes):
            return kind
    return ""


def plus_of(raw) -> int:
    try:
        return int(str(raw).lstrip("+"))
    except (TypeError, ValueError):
        return 0


def type_code(it) -> str:
    return (it.get("type") or "").split("|")[0]


def build_archive_items(archive_dir, rp, taken_names):
    src = json.load(open(os.path.join(archive_dir, "data", "items.json")))["item"]
    out = []
    for it in sorted(src, key=lambda i: i["name"]):
        rarity = (it.get("rarity") or "").lower()
        if not it.get("srd52") or rarity not in GOOD_RARITIES:
            continue
        name = it["name"]
        if name.lower() in taken_names:
            continue

        code = type_code(it)
        wear = wear_of(name, code)
        data = {}
        if code in ("M", "R") and it.get("dmg1"):
            data = {
                "type": "weapon",
                "category": (it.get("weaponCategory") or "Simple").title(),
                "damage": it["dmg1"],
                "damageType": DMG_TYPES.get(it.get("dmgType", ""), ""),
            }
            if it.get("dmg2"):
                data["damage2"] = it["dmg2"]  # the Versatile two-handed die
            props = [PROPS[p.split("|")[0]] for p in it.get("property", [])
                     if p.split("|")[0] in PROPS]
            if props:
                data["properties"] = props
            # Thrown melee weapons carry a range too — only the true ranged
            # type swings off DEX.
            if code == "R":
                data["ranged"] = True
            if plus_of(it.get("bonusWeapon")):
                data["bonus"] = plus_of(it.get("bonusWeapon"))
        elif code in ARMOR_CATEGORY and isinstance(it.get("ac"), int):
            data = {"type": "armor", "category": ARMOR_CATEGORY[code], "ac": it["ac"]}
            if it.get("stealth"):
                data["stealthDisadvantage"] = True
            if plus_of(it.get("bonusAc")):
                data["bonus"] = plus_of(it.get("bonusAc"))
        elif code == "S":
            data = {"type": "shield", "acBonus": 2}
            if plus_of(it.get("bonusAc")):
                data["bonus"] = plus_of(it.get("bonusAc"))
        else:
            data = {"type": "gear"}
            if wear:
                data["wear"] = wear
                # Only a worn item's AC bonus is a number the engine applies;
                # anything else stays prose in the description.
                if plus_of(it.get("bonusAc")):
                    data["bonus"] = plus_of(it.get("bonusAc"))

        data["rarity"] = rarity.title()
        attune = it.get("reqAttune")
        if attune:
            data["attunement"] = True

        body = rp.render(it.get("entries"))
        if isinstance(attune, str):
            body = f"Requires Attunement {rp.detag(attune)}.\n\n{body}" if body \
                else f"Requires Attunement {rp.detag(attune)}."
        if body:
            data["description"] = body
        if isinstance(it.get("weight"), (int, float)) and it["weight"]:
            data["weight"] = it["weight"]

        out.append({"name": name, "summary": rp.summarize(body), "data": data})
        taken_names.add(name.lower())
    return out


LADDER_BLURB = {
    "armor": "You have a +{n} bonus to Armor Class while wearing this armor.",
    "shield": "While holding this shield, you have a +{n} bonus to Armor Class in addition to the shield's normal bonus.",
    "weapon": "You have a +{n} bonus to attack rolls and damage rolls made with this magic weapon.",
}


def build_ladder(seed, taken_names):
    out = []
    for base in seed:
        kind = base["data"].get("type")
        if kind not in ("armor", "shield", "weapon"):
            continue
        for n in (1, 2, 3):
            name = f"+{n} {base['name']}"
            if name.lower() in taken_names:
                continue
            data = dict(base["data"])
            data["bonus"] = n
            data["rarity"] = LADDER_RARITY[kind][n]
            data["description"] = LADDER_BLURB[kind].format(n=n)
            out.append({
                "name": name,
                "summary": f"A {base['name'].lower()} with a +{n} enchantment worked into it.",
                "data": data,
            })
            taken_names.add(name.lower())
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tools", default=os.path.expanduser("~/Documents/personal/dnd"),
                    help="directory holding rhw_pack.py and the data/ archive")
    args = ap.parse_args()

    sys.path.insert(0, args.tools)
    import rhw_pack as rp

    seed = json.load(open(SEED))
    mundane = [e for e in seed if not e["data"].get("rarity")]
    taken = {e["name"].lower() for e in mundane}

    ladder = build_ladder(mundane, taken)
    archive = build_archive_items(args.tools, rp, taken)
    merged = mundane + sorted(ladder + archive, key=lambda e: e["name"].lower())

    with open(SEED, "w") as f:
        f.write(json.dumps(merged, indent=1, ensure_ascii=False))
    print(f"mundane kept: {len(mundane)} · ladder: {len(ladder)} · archive: {len(archive)}"
          f" · total: {len(merged)}")


if __name__ == "__main__":
    main()
