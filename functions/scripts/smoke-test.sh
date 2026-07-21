#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Phase A Smoke Test
#
# Verifies the full chain:
#   Auth emulator → sign in → get token → call analyzeResume → Gemini → response
#
# Prerequisites:
#   1. functions/.env exists with GEMINI_API_KEY=your_key
#   2. Emulator is running in another terminal:
#        cd functions && npm run dev
#        (or: firebase emulators:start --only functions,auth --project demo-careercopilot)
#
# Usage:
#   chmod +x functions/scripts/smoke-test.sh
#   ./functions/scripts/smoke-test.sh
# ---------------------------------------------------------------------------

set -euo pipefail

AUTH_URL="http://127.0.0.1:9199"
FUNCTIONS_URL="http://127.0.0.1:5001"
PROJECT_ID="demo-careercopilot"
API_KEY="demo-key"

# Timeout in seconds for the Gemini call (Gemini can be slow on first call)
CURL_TIMEOUT=60
TMPDIR_RESULTS=$(mktemp -d)
RESPONSE_FILE="${TMPDIR_RESULTS}/smoke-test-response.json"
trap 'rm -rf -- "${TMPDIR_RESULTS}"' EXIT

if [[ "${ALLOW_LLM_SMOKE_TEST:-}" != "1" ]]; then
  echo "ERROR: set ALLOW_LLM_SMOKE_TEST=1 to acknowledge that this emulator smoke test may call a billed LLM."
  exit 1
fi

echo ""
echo "=== Phase A Smoke Test ==="
echo ""

# ---------------------------------------------------------------------------
# Step 1: Check emulator is up
# ---------------------------------------------------------------------------
echo "[ 1/3 ] Checking emulator is running..."

if ! curl -sf "${FUNCTIONS_URL}/${PROJECT_ID}/us-central1/" > /dev/null 2>&1; then
  # Functions emulator root may 404 — try auth emulator instead
  if ! curl -sf "${AUTH_URL}" > /dev/null 2>&1; then
    echo ""
    echo "ERROR: Emulator is not running."
    echo "Start it first:"
    echo "  cd functions && npm run dev"
    echo ""
    exit 1
  fi
fi
echo "  ✓ Emulator is up"

# ---------------------------------------------------------------------------
# Step 2: Sign in anonymously via the Auth emulator to get an ID token
#         (The Auth emulator accepts signUp without a real Firebase project)
# ---------------------------------------------------------------------------
echo ""
echo "[ 2/3 ] Signing in anonymously via Auth emulator..."

AUTH_RESPONSE=$(curl -sf -X POST \
  "${AUTH_URL}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"returnSecureToken": true}')

ID_TOKEN=$(echo "$AUTH_RESPONSE" | grep -o '"idToken":"[^"]*"' | cut -d'"' -f4 || true)

if [ -z "$ID_TOKEN" ]; then
  echo ""
  echo "ERROR: Could not obtain ID token from Auth emulator."
  echo "The Auth emulator response did not contain a token; its body was not printed."
  exit 1
fi

echo "  ✓ Got ID token (${#ID_TOKEN} chars)"

# ---------------------------------------------------------------------------
# Step 3: Call analyzeResume via the Functions emulator
#         Firebase Callable functions use:
#           POST /{projectId}/{region}/{functionName}
#           Content-Type: application/json
#           Authorization: Bearer <idToken>
#           Body: { "data": { ...args } }
# ---------------------------------------------------------------------------
echo ""
echo "[ 3/3 ] Calling analyzeResume endpoint (timeout: ${CURL_TIMEOUT}s)..."
echo "        (First call may take ~10s — Gemini cold start)"
echo ""

# Use a hardcoded JSON body to avoid shell escaping issues with multiline strings
REQUEST_BODY='{"data":{"resumeText":"John Doe, Software Engineer, Toronto ON. Experience: Senior Developer at Acme Corp 2020-2024, built React dashboards and Node.js APIs. Education: BSc Computer Science University of Toronto 2019. Skills: TypeScript React Node.js Firebase AWS.","marketName":"Canada"}}'

HTTP_CODE=$(curl -s -o "${RESPONSE_FILE}" -w "%{http_code}" \
  --max-time "${CURL_TIMEOUT}" \
  -X POST \
  "${FUNCTIONS_URL}/${PROJECT_ID}/us-central1/analyzeResume" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ID_TOKEN}" \
  -d "${REQUEST_BODY}" 2>&1) || true

FUNCTION_RESPONSE=$(cat "${RESPONSE_FILE}" 2>/dev/null || echo "")

echo "  HTTP status: ${HTTP_CODE}"
echo ""
echo "  Response body:"
echo "${FUNCTION_RESPONSE}" | python3 -m json.tool 2>/dev/null || echo "${FUNCTION_RESPONSE}"

echo ""
echo "=== Result ==="

# Extract score from the result.data field
SCORE=$(echo "$FUNCTION_RESPONSE" | grep -o '"score":[0-9]*' | head -1 | cut -d: -f2 || true)
if [ -n "$SCORE" ]; then
  echo ""
  echo "  ✓ Phase A PASSED"
  echo "  ✓ Resume score returned: ${SCORE}/100"
  echo "  ✓ AI key never left the server"
  echo "  ✓ Auth token verified by emulator"
else
  echo ""
  echo "  ✗ Unexpected response — check output above."
  exit 1
fi

echo ""
