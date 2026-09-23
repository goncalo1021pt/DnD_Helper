#!/usr/bin/env python3
"""Quest Board from Python — a token holder's client, standard library only (#348).

    export QB_TOKEN=qb_…                  # minted on your profile: Settings → API tokens
    export QB_URL=http://localhost:8080   # the default; https://dnd.fontao.net for the live tavern

    python3 scripts/api/quest_board.py                 # the tour: who you are, your heroes, your tables, the archives
    python3 scripts/api/quest_board.py GET /me         # any door; the path is what /api/docs lists
    python3 scripts/api/quest_board.py POST /campaigns/join '{"code":"ABC123"}'

Every door and the scope it needs is at $QB_URL/api/docs; the contract itself
is $QB_URL/api/openapi.json. A refusal raises Refused with the server's own
words — a 403 names the scope the token lacks.

Staging (dnd-test.fontao.net) sits behind Cloudflare Access, which answers
every request with a 302 to its login page before the app ever sees the
bearer. A script gets through with an Access service token (Zero Trust →
Access → Service Auth → Service Tokens; then a "Service Auth" policy on the
staging application that includes it), sent as two extra headers:

    export QB_CF_ID=…  QB_CF_SECRET=…
"""
import json
import os
import sys
import urllib.error
import urllib.request


class Refused(Exception):
    """A 4xx/5xx, carrying the status and the server's {"error": …} text."""

    def __init__(self, status, error):
        super().__init__(f"{status}: {error}")
        self.status, self.error = status, error


class QuestBoard:
    def __init__(self, url=None, token=None):
        self.url = (url or os.environ.get("QB_URL") or "http://localhost:8080").rstrip("/")
        self.token = token or os.environ.get("QB_TOKEN")
        if not self.token:
            sys.exit("set QB_TOKEN to a token from your profile (Settings → API tokens)")

    def call(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(f"{self.url}/api{path}", data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.token}")
        if os.environ.get("QB_CF_ID"):
            req.add_header("CF-Access-Client-Id", os.environ["QB_CF_ID"])
            req.add_header("CF-Access-Client-Secret", os.environ["QB_CF_SECRET"])
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=20) as res:
                raw = res.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                error = json.loads(raw).get("error", raw.decode())
            except ValueError:
                error = raw.decode(errors="replace")[:200]
            raise Refused(e.code, error) from None

    def get(self, path):
        return self.call("GET", path)

    def post(self, path, body=None):
        return self.call("POST", path, body or {})

    def put(self, path, body=None):
        return self.call("PUT", path, body or {})

    def delete(self, path):
        return self.call("DELETE", path)


def tour(qb):
    """Read what the token can see, and say plainly what it cannot."""
    print("▶ who the token acts as (account:read)")
    try:
        me = qb.get("/me")["user"]
        print(f"  {me['name']} (signed up through {me['provider']})")
    except Refused as r:
        if r.status == 401:  # the token itself is refused: nothing below will answer either
            sys.exit(f"  {r.error}")
        print(f"  ({r.error} — mint one with Account ticked to ask who it is)")

    print("▶ heroes (heroes:read)")
    try:
        for hero in qb.get("/me/characters"):
            sheet = qb.get(f"/characters/{hero['id']}")["character"]
            dice = ", ".join(f"{d['max']}d{d['die']}" for d in sheet.get("hitDice", []))
            print(f"  {hero['name']} — level {hero['level']} {hero.get('class', '')}, {sheet.get('hpMax')} hp, hit dice {dice or '—'}")
    except Refused as r:
        print(f"  ({r.error})")

    print("▶ tables and their boards (campaigns:read)")
    try:
        seats = qb.get("/campaigns")
    except Refused as r:
        seats = []
        print(f"  ({r.error})")
    for seat in seats:
        table = seat["campaign"]
        print(f"  {table['name']} (as {seat['role']})")
        try:
            for quest in qb.get(f"/campaigns/{table['id']}/quests"):
                print(f"     · {quest['title']}")
        except Refused as r:
            print(f"     ({r.error})")

    print("▶ the archives (rules:read)")
    try:
        classes = qb.get("/rules/class")
        first = classes[0]
        entry = qb.get(f"/rules/content/{first['id']}")
        at5 = [f["name"] for f in entry.get("data", {}).get("features", []) if f.get("level") == 5]
        print(f"  {len(classes)} classes; {first['name']} at level 5 gains {', '.join(at5) or 'nothing new'}")
    except Refused as r:
        print(f"  ({r.error})")


if __name__ == "__main__":
    qb = QuestBoard()
    if len(sys.argv) == 1:
        tour(qb)
    elif len(sys.argv) in (3, 4) and sys.argv[1] in ("GET", "POST", "PUT", "PATCH", "DELETE"):
        body = json.loads(sys.argv[3]) if len(sys.argv) == 4 else None
        try:
            print(json.dumps(qb.call(sys.argv[1], sys.argv[2], body), indent=2))
        except Refused as r:
            sys.exit(f"{sys.argv[1]} {sys.argv[2]} → {r}")
    else:
        sys.exit(__doc__)
