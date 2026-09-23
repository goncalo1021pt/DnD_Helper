#!/usr/bin/env bash
# Quest Board from a shell — a curl wrapper for a token holder (#348).
#
#   export QB_TOKEN=qb_…                  # minted on your profile: Settings → API tokens
#   export QB_URL=http://localhost:8080   # the default; https://dnd.fontao.net for the live tavern
#
# Staging (dnd-test.fontao.net) sits behind Cloudflare Access, which answers
# every request with a 302 to its login page before the app ever sees the
# bearer. A script gets through with an Access *service token* (Zero Trust →
# Access → Service Auth → Service Tokens; then a "Service Auth" policy on the
# staging application that includes it), sent as two extra headers:
#   export QB_CF_ID=…  QB_CF_SECRET=…
#
#   scripts/api/qb.sh tour                          # a walk through what the token can see
#   scripts/api/qb.sh GET /me                       # any door; the path is what /api/docs lists
#   scripts/api/qb.sh GET /rules/class
#   scripts/api/qb.sh POST /campaigns/join '{"code":"ABC123"}'
#
# Every door and the scope it needs is at $QB_URL/api/docs. A refusal comes
# back as {"error": "…"} — a 403 names the scope the token lacks.
set -euo pipefail

QB_URL="${QB_URL:-http://localhost:8080}"
: "${QB_TOKEN:?set QB_TOKEN to a token from your profile (Settings → API tokens)}"

# qb METHOD PATH [JSON]  — prints the JSON reply; a 4xx/5xx goes to stderr and
# fails, with the status left in QB_STATUS for a caller that wants to tell a
# refused door (403, the scope) from a refused token (401).
QB_STATUS=0
qb() {
  local method=$1 path=$2 body=${3:-} out code
  local -a args=(-sS -w $'\n%{http_code}' -H "Authorization: Bearer $QB_TOKEN" -X "$method" "$QB_URL/api$path")
  [[ -n ${QB_CF_ID:-} ]] && args+=(-H "CF-Access-Client-Id: $QB_CF_ID" -H "CF-Access-Client-Secret: ${QB_CF_SECRET:?}")
  [[ -n $body ]] && args+=(-H 'Content-Type: application/json' -d "$body")
  out=$(curl "${args[@]}")
  code=${out##*$'\n'}
  out=${out%$'\n'*}
  QB_STATUS=$code
  if (( code >= 400 )); then
    echo "$method $path → $code: $out" >&2
    return 1
  fi
  printf '%s\n' "$out"
}

# field JSON JQ-EXPR — one value out of a reply. The tour needs jq; a bare
# GET/POST does not, and prints the reply as it came.
field() { jq -r "$2" <<<"$1"; }

tour() {
  command -v jq >/dev/null || { echo "the tour reads replies with jq — install it (apt install jq), or call doors directly: $0 GET /me" >&2; return 2; }
  echo "▶ who the token acts as (account:read)"
  local me; if me=$(qb GET /me 2>/dev/null); then echo "  $(field "$me" '.user.name') (signed up through $(field "$me" '.user.provider'))"
  else
    qb GET /me >/dev/null 2>&1 || (( QB_STATUS != 401 )) || { echo "  the token itself is refused (401) — nothing below will answer either"; return 1; }
    echo "  (this token cannot read the account — mint one with Account ticked to ask who it is)"
  fi

  echo "▶ heroes (heroes:read)"
  local heroes; if heroes=$(qb GET /me/characters 2>/dev/null); then
    field "$heroes" '.[] | "  \(.name) — level \(.level) \(.class)"'
  else echo "  (this token cannot read heroes)"; fi

  echo "▶ tables and their boards (campaigns:read)"
  local tables; tables=$(qb GET /campaigns 2>/dev/null) || { echo "  (this token cannot read tables)"; tables="[]"; }
  field "$tables" '.[] | "\(.campaign.id) \(.role) \(.campaign.name)"' | while read -r id role name; do
    echo "  $name (as $role)"
    local quests; if quests=$(qb GET "/campaigns/$id/quests" 2>/dev/null); then
      field "$quests" '.[] | "     · \(.title) [\(.status // "open")]"'
    else echo "     (this token cannot read the board)"; fi
  done

  echo "▶ the archives (rules:read)"
  local classes; if classes=$(qb GET /rules/class 2>/dev/null); then
    echo "  $(field "$classes" 'length') classes, e.g. $(field "$classes" '[.[0:4][].name] | join(", ")')"
  else echo "  (this token cannot read the archives)"; fi
}

case "${1:-}" in
  tour) tour ;;
  GET|POST|PUT|PATCH|DELETE) qb "$1" "$2" "${3:-}" | if command -v jq >/dev/null; then jq .; else cat; fi ;;
  *) sed -n '2,15p' "$0"; exit 2 ;;
esac
