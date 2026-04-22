export CID=87284ee537befa8d253ed41db42743
export CSEC=e0e170fa35dc2069a9ddbac883628707da4250ba04fe5771fc39e23d03e9a90a
export BASE="https://corpo-dev.local"
export WS=default
export ID=100

TOKEN=$(curl -s -u "$CID:$CSEC" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=client_credentials' \
  "$BASE/CorpoWebserver/apitoken/$WS/$ID" | \
  jq -r .access_token)
echo "$TOKEN"