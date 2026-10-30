#!/usr/bin/env bash
# Prints the RID of a BMP user looked up by login id via GET /web/users.
#
# Auth: any logged-in BMP user (no admin needed). Either
#   BMP_USER=jdoe BMP_PASS=secret ./user-rid.sh [login-id]   # session login on /cs/authentication
#   TOKEN=<auth-service JWT> ./user-rid.sh <login-id>         # BMP started with --auth-service
# login-id defaults to BMP_USER, so a non-admin can check himself with no argument.
set -euo pipefail

BASE="${BASE:-https://corpo-dev.local/CorpoWebserver}"
TOKEN="${TOKEN:-}"
BMP_USER="${BMP_USER:-}"
BMP_PASS="${BMP_PASS:-}"
LOGIN_ID="${1:-$BMP_USER}"

[[ -n "$LOGIN_ID" ]] || { echo "usage: BMP_USER=.. BMP_PASS=.. $0 [login-id]   or   TOKEN=.. $0 <login-id>" >&2; exit 1; }

JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT
AUTH=()

if [[ -n "$TOKEN" ]]; then
  AUTH=(-H "Authorization: Bearer $TOKEN")
else
  [[ -n "$BMP_USER" && -n "$BMP_PASS" ]] || { echo "Set TOKEN, or BMP_USER and BMP_PASS." >&2; exit 1; }
  echo "== login as $BMP_USER (POST /cs/authentication)"
  LOGIN_JSON="$(curl -sS -c "$JAR" -X POST "$BASE/cs/authentication" \
    --data-urlencode "username=$BMP_USER" --data-urlencode "password=$BMP_PASS")"
  if jq -e '.error' <<<"$LOGIN_JSON" >/dev/null 2>&1; then
    echo "login failed: $(jq -r '.error' <<<"$LOGIN_JSON")" >&2; exit 1
  fi
  echo "own rid from login response: $(jq -r '.userName' <<<"$LOGIN_JSON") (userId $(jq -r '.userId' <<<"$LOGIN_JSON"))"
  AUTH=(-b "$JAR")
fi

echo "== lookup $LOGIN_ID (GET /web/users)"
FILTER="{\"field\":\"id\",\"operator\":\"EQUALS\",\"value\":\"$LOGIN_ID\"}"
RESPONSE="$(curl -sS "${AUTH[@]}" -G "$BASE/web/users" --data-urlencode "filter=$FILTER" -w '\n%{http_code}')"
STATUS="${RESPONSE##*$'\n'}"
BODY="${RESPONSE%$'\n'*}"

[[ "$STATUS" == "200" ]] || { echo "HTTP $STATUS: $BODY" >&2; exit 1; }
jq -e '.data | length > 0' <<<"$BODY" >/dev/null || { echo "no active assignable user with id '$LOGIN_ID'" >&2; exit 1; }
jq -r '.data[] | "\(.id)\t\(.rid)\t\(.firstName) \(.lastName)"' <<<"$BODY"
