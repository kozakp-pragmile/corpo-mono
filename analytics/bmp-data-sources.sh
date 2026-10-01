#!/usr/bin/env bash
# Requests for the BMP data API sources family (/api/data/sources), published
# only under the ai-dashboarding-sources feature toggle — without it the
# catalogue is empty and every source answers "No such source".
#
# BMP must run with auth-service (bmp.sh with auth-service, which enables
# tokenAuthentication) so jwtFilter accepts the JWT. Override via env:
#   TOKEN=<raw JWT> RID=<object rid> KPI=<kpi rid> ./bmp-data-sources.sh
#   BASE=http://localhost:8080/CorpoWebserver TOKEN=... ./bmp-data-sources.sh
# TOKEN is the raw auth-service JWT, without "Bearer ".
set -euo pipefail

BASE="${BASE:-https://corpo-dev.local/CorpoWebserver}"
TOKEN="${TOKEN:-}"
RID="${RID:-}"
KPI="${KPI:-}"
PERIOD="${PERIOD:-$(date +%s)000}"
PERIOD_TYPE="${PERIOD_TYPE:-M}"
YTD="${YTD:-false}"

setting() {
  printf '  %-12s %s\n' "$1" "$2"
}

echo "Settings (env wins over default)"
setting BASE "$BASE"
setting TOKEN "$([[ -n "$TOKEN" ]] && echo "set (${#TOKEN} chars)" || echo "SET THIS: auth-service JWT of a BMP user, without Bearer")"
setting RID "${RID:-SET THIS: rid of the organisation whose structure is read}"
setting KPI "${KPI:-SET THIS: rid of the KPI read per organisation}"
setting PERIOD "$PERIOD"
setting PERIOD_TYPE "$PERIOD_TYPE"
setting YTD "$YTD"
[[ -n "$TOKEN" ]] || { echo "Nothing answers without TOKEN; set it and run again." >&2; exit 1; }

SOURCES="$BASE/api/data/sources"
AUTH="Authorization: Bearer $TOKEN"
PERIOD_PARAMS=("selectedPeriod==$PERIOD" "selectedPeriodType==$PERIOD_TYPE" "ytd==$YTD")

step() {
  printf '\n== %s ==\n' "$1"
}

step "catalogue (expect 200, both sources listed)"
http --print=hb GET "$SOURCES" "$AUTH"

step "owningOrganisationStructure versions (expect 200)"
http --print=b GET "$SOURCES/owningOrganisationStructure" "$AUTH"

step "owningOrganisationStructure v1 schemas (expect 200)"
http --print=b GET "$SOURCES/owningOrganisationStructure/v1" "$AUTH"

step "owningOrganisationStructure v1 read (expect 200, organisation tree)"
http --ignore-stdin --print=hb POST "$SOURCES/owningOrganisationStructure/v1" "$AUTH" "${PERIOD_PARAMS[@]}" rid="$RID"

step "kpiPerOrganisation v1 schemas (expect 200)"
http --print=b GET "$SOURCES/kpiPerOrganisation/v1" "$AUTH"

step "kpiPerOrganisation v1 read (expect 200, KPI per sub-organisation)"
http --ignore-stdin --print=hb POST "$SOURCES/kpiPerOrganisation/v1" "$AUTH" "${PERIOD_PARAMS[@]}" kpi="$KPI"

step "no token (expect 401)"
http --print=h GET "$SOURCES"
