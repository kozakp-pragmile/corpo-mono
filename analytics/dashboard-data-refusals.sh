#!/usr/bin/env bash
# Requests analytics.backend refuses before the dashboard data stream opens.
# Each answers 400 application/problem+json whose detail names the parameter
# and never repeats the value sent. The parameters are checked before the
# dashboard is looked up, so ID needs no existing dashboard.
#
#   ./dashboard-data-refusals.sh
#   BASE=https://corpo-dev.local/analytics/server TOKEN=<raw JWT> ./dashboard-data-refusals.sh
# TOKEN is the raw auth-service JWT, without "Bearer "; unset, the node
# scripts' built-in dev token is used.
set -euo pipefail

CLIENT="$(dirname "$0")/analytics-api-tests/src/analytics-client.js"
DEV_TOKEN="$(sed -n '/^const DEV_TOKEN =/{n;s/^ *"\(.*\)";$/\1/p;}' "$CLIENT")"

BASE="${BASE:-http://localhost:4360/analytics/server}"
TOKEN="${TOKEN:-$DEV_TOKEN}"
ID="${ID:-D-6d1f9c3a-2f4b-4d8e-9a1b-3c5e7f9d0b21}"
PERIOD="${PERIOD:-1735686000000}"
PERIOD_TYPE="${PERIOD_TYPE:-Y}"

setting() {
  printf '  %-12s %s\n' "$1" "$2"
}

echo "Settings (env wins over default)"
setting BASE "$BASE"
setting TOKEN "$([[ -n "${TOKEN:-}" ]] && echo "set (${#TOKEN} chars, ends ${TOKEN: -6})" || echo "SET THIS: auth-service JWT of a BMP user, without Bearer")"
setting ID "$ID"
setting PERIOD "$PERIOD"
setting PERIOD_TYPE "$PERIOD_TYPE"
[[ -n "$TOKEN" ]] || { echo "Nothing answers without TOKEN; set it and run again." >&2; exit 1; }

AUTH="Authorization: Bearer $TOKEN"
STREAM="Accept: text/event-stream"

step() {
  printf '\n== %s ==\n' "$1"
}

data() {
  local prefix="$1"
  shift
  http --ignore-stdin --print=hb GET "$BASE/$prefix/api/v1/dashboards/$ID/data" "$AUTH" "$STREAM" "$@"
}

step "no selectedPeriod, public (expect 400, detail: selectedPeriod is required)"
data public "selectedPeriodType==$PERIOD_TYPE" "ytd==false" || true

step "no selectedPeriodType, private (expect 400, detail: selectedPeriodType is required)"
data private "selectedPeriod==$PERIOD" "ytd==false" || true

step "no ytd, public (expect 400, detail: ytd is required)"
data public "selectedPeriod==$PERIOD" "selectedPeriodType==$PERIOD_TYPE" || true

step "selectedPeriod not a whole number, private (expect 400, detail: selectedPeriod is not a valid value, no last-year in it)"
data private "selectedPeriod==last-year" "selectedPeriodType==$PERIOD_TYPE" "ytd==false" || true

step "ytd neither true nor false, public (expect 400, detail: ytd is not a valid value, no maybe in it)"
data public "selectedPeriod==$PERIOD" "selectedPeriodType==$PERIOD_TYPE" "ytd==maybe" || true

step "empty ytd, public (expect 400, detail: ytd is not a valid value)"
data public "selectedPeriod==$PERIOD" "selectedPeriodType==$PERIOD_TYPE" "ytd==" || true

step "blank selectedPeriodType, public (expect 400, detail: Selected period type cannot be blank)"
data public "selectedPeriod==$PERIOD" "selectedPeriodType== " "ytd==false" || true

step "dashboard list, page not a whole number, private (expect 400, detail: page is not a valid value)"
http --ignore-stdin --print=hb GET "$BASE/private/api/v1/dashboards" "$AUTH" "page==first" || true

step "every parameter fine, no dashboard under ID (expect 404, detail: Dashboard $ID not found)"
data public "selectedPeriod==$PERIOD" "selectedPeriodType==$PERIOD_TYPE" "ytd==false" || true

step "no token (expect 401, empty body with WWW-Authenticate)"
http --ignore-stdin --print=hb GET "$BASE/public/api/v1/dashboards/$ID/data" "$STREAM" "selectedPeriodType==$PERIOD_TYPE" || true
