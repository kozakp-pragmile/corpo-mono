#!/usr/bin/env bash
# Smoke requests for the analytics dashboard create endpoint (ANT-25).
#
# Assumes the w-dev local stack: analytics on ANA_PORT, auth-service on AS_PORT
# (defaults match corpo-scripts env.sh for CORPO_ENV=dev). Override via env:
#   ANA_PORT=8081 AS_PORT=8083 ./create-dashboard-smoke.sh
# TOKEN can be overridden too; the default is the shared long-lived dev JWT
# (sub jwt-example, expires 2045) that the local auth-service keystore signs.
set -euo pipefail

ANA_PORT="${ANA_PORT:-8081}"
AS_PORT="${AS_PORT:-8083}"
BASE="http://localhost:$ANA_PORT"
TOKEN="${TOKEN:-eyJhbGciOiJSUzI1NiJ9.eyJjbGkiOiI0NTY3Iiwic3ViIjoiand0LWV4YW1wbGUiLCJhdWQiOiI0NTY3IiwibG4iOiJFeGFtcGxlIiwiZm4iOiJKV1QiLCJmaW5nZXJQcmludEhhc2giOiI3MDI0OTE0Y2MyNTFjZmU2OTZmOWYwZDg3NTdhNzA3ZTlhZDc3NTIzYmYzMDY5ZWRiODQ5N2M1NTFjMzUyNThhIiwiZ3IiOlsiRXZlcnlvbmUiXSwiZXhwIjoyMzc1MjIyNTM0LCJpYXQiOjE2NTUyMjI1MzQsImVtYWlsIjoiand0LWV4YW1wbGVAZXhhbXBsZS5jb20ifQ.Dox5PkcLaUuU3UYsj5vmNzt9czCVPfz4ptHaE_Z7pA4DvvZWyv0UPOBP9q9k2UCHZLR79Nqbw87o_b4MWweHAqNlXcuPQx36KIIwHn_K2ZH7Lw9vBGsGP5idEMo8OzPP5Fdx80v0jNyxVvqhVXpElmmIN5xY4mVfC-xkoM2HzGxt_QOD4vV98LajrM3Pu7bDyFFaKIaPWGBDMpfVSxK3mQpVD3IJmu7lLtOolc3o_ykkSLnXlUM_NJSHnuDxaMe7IMjYB5m5k-GZEat85YSXhpgXKI_-r4-Wv8OJMOtSM3lToW50SP1Amub313QHhrLF-0IojlGqU7dWeJdVWSkULQ}"

step() {
  printf '\n== %s ==\n' "$1"
}

step "auth-service JWKS reachable (expect 200)"
http --print=h GET ":$AS_PORT/auth/jwks.json" | head -1

step "health, no auth (expect 200)"
http --print=hb GET "$BASE/sys/health"

step "create via public prefix (expect 201 + Location)"
http --print=hb POST "$BASE/public/api/v1/dashboards" "Authorization: Bearer $TOKEN" <<'EOF'
{
  "schemaVersion": 1,
  "title": "Incidents",
  "tiles": [
    { "id": "open-incidents", "kind": "metric", "title": "Open incidents" },
    { "id": "incidents-by-month", "kind": "chart", "title": "Incidents per month" }
  ]
}
EOF

step "create via private prefix (expect 201, Location carries /private)"
http --print=hb POST "$BASE/private/api/v1/dashboards" "Authorization: Bearer $TOKEN" <<'EOF'
{
  "schemaVersion": 1,
  "title": "Internal",
  "tiles": [ { "id": "a", "kind": "metric", "title": "A" } ]
}
EOF

step "unknown tile kind (expect 400: Tile kind must be one of: chart, metric)"
http --print=b POST "$BASE/public/api/v1/dashboards" "Authorization: Bearer $TOKEN" <<'EOF'
{ "schemaVersion": 1, "title": "Bad", "tiles": [ { "id": "x", "kind": "gauge", "title": "X" } ] }
EOF

step "blank title (expect 400: Dashboard title cannot be blank)"
http --print=b POST "$BASE/public/api/v1/dashboards" "Authorization: Bearer $TOKEN" <<'EOF'
{ "schemaVersion": 1, "title": " ", "tiles": [ { "id": "x", "kind": "metric", "title": "X" } ] }
EOF

step "no tiles (expect 400: Dashboard tiles cannot be null — the rest mapper rejects before the domain)"
http --print=b POST "$BASE/public/api/v1/dashboards" "Authorization: Bearer $TOKEN" <<'EOF'
{ "schemaVersion": 1, "title": "NoTiles" }
EOF

step "no schema version (expect 400: Dashboard schema version must be positive)"
http --print=b POST "$BASE/public/api/v1/dashboards" "Authorization: Bearer $TOKEN" <<'EOF'
{ "title": "NoVersion", "tiles": [ { "id": "x", "kind": "metric", "title": "X" } ] }
EOF

step "no token (expect 401)"
http --print=h POST "$BASE/public/api/v1/dashboards" <<'EOF'
{ "schemaVersion": 1, "title": "X", "tiles": [ { "id": "x", "kind": "metric", "title": "X" } ] }
EOF
