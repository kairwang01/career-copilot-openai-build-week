#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Phase B Concurrency Test — B7
#
# Proves M9: 0 lost/duplicate credit deductions at N concurrent requests
# against a single users/{uid} document on the Firestore Emulator.
#
# What it does:
#   1. Seeds a test user in the Firestore Emulator with a known credit balance.
#   2. Fires N concurrent analyzeResume calls (all authenticated as that user).
#   3. Reads the final balance from Firestore.
#   4. Asserts: final = start − (N × cost). Zero anomalies = M9 passes.
#
# Prerequisites:
#   1. functions/.env exists with GEMINI_API_KEY set.
#   2. Emulator running with Firestore + Auth + Functions:
#        cd functions && firebase emulators:start --only functions,auth,firestore --project demo-careercopilot
#
# Usage:
#   chmod +x functions/scripts/concurrency-test.sh
#   ./functions/scripts/concurrency-test.sh [N]   (default N=10)
# ---------------------------------------------------------------------------

set -euo pipefail

AUTH_URL="http://127.0.0.1:9199"
FUNCTIONS_URL="http://127.0.0.1:5001"
FIRESTORE_URL="http://127.0.0.1:8080"
PROJECT_ID="demo-careercopilot"
API_KEY="demo-key"
CURL_TIMEOUT=90

# Number of concurrent requests (pass as first arg, default 10)
N="${1:-10}"
if [[ ! "${N}" =~ ^[1-9][0-9]*$ ]] || (( N > 50 )); then
  echo "ERROR: concurrency must be an integer between 1 and 50."
  exit 1
fi
if [[ "${ALLOW_LLM_LOAD_TEST:-}" != "1" ]]; then
  echo "ERROR: set ALLOW_LLM_LOAD_TEST=1 to acknowledge that this emulator test may call a billed LLM."
  exit 1
fi
COST_PER_CALL=10           # must match TOOL_CREDIT_COSTS["resume-analysis"] in schema.ts
START_CREDITS=$(( N * COST_PER_CALL + 50 ))   # give just enough + 50 buffer
EXPECTED_FINAL=$(( START_CREDITS - N * COST_PER_CALL ))

echo ""
echo "=== Phase B Concurrency Test (M9) ==="
echo "  Concurrent requests : ${N}"
echo "  Starting credits    : ${START_CREDITS}"
echo "  Cost per call       : ${COST_PER_CALL}"
echo "  Expected final      : ${EXPECTED_FINAL}"
echo ""

# ---------------------------------------------------------------------------
# Step 1: Sign up a test user via Auth emulator
# ---------------------------------------------------------------------------
echo "[ 1/4 ] Creating test user in Auth emulator..."

AUTH_RESPONSE=$(curl -sf -X POST \
  "${AUTH_URL}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"returnSecureToken": true}')

ID_TOKEN=$(echo "$AUTH_RESPONSE" | grep -o '"idToken":"[^"]*"' | cut -d'"' -f4 || true)
USER_UID=$(echo "$AUTH_RESPONSE" | grep -o '"localId":"[^"]*"' | cut -d'"' -f4 || true)

if [ -z "$ID_TOKEN" ] || [ -z "$USER_UID" ]; then
  echo "ERROR: Could not create test user. Is the Auth emulator running?"
  exit 1
fi
echo "  ✓ uid: ${USER_UID}"

# ---------------------------------------------------------------------------
# Step 2: Seed Firestore with starting credits via REST (Emulator only)
# ---------------------------------------------------------------------------
echo ""
echo "[ 2/4 ] Seeding Firestore with ${START_CREDITS} credits..."

FIRESTORE_DOC_URL="${FIRESTORE_URL}/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${USER_UID}"

curl -sf -X PATCH \
  "${FIRESTORE_DOC_URL}?updateMask.fieldPaths=credits&updateMask.fieldPaths=role&updateMask.fieldPaths=subscriptionStatus" \
  -H "Content-Type: application/json" \
  -d "{
    \"fields\": {
      \"credits\":            { \"integerValue\": \"${START_CREDITS}\" },
      \"role\":               { \"stringValue\": \"candidate\" },
      \"subscriptionStatus\": { \"stringValue\": \"free\" }
    }
  }" > /dev/null

echo "  ✓ Seeded users/${USER_UID}.credits = ${START_CREDITS}"

# ---------------------------------------------------------------------------
# Step 3: Fire N concurrent requests
# ---------------------------------------------------------------------------
echo ""
echo "[ 3/4 ] Firing ${N} concurrent analyzeResume calls..."

REQUEST_BODY='{"data":{"resumeText":"John Doe, Software Engineer. Skills: TypeScript, React, Node.js.","marketName":"Canada"}}'

TMPDIR_RESULTS=$(mktemp -d)
trap 'rm -rf -- "${TMPDIR_RESULTS}"' EXIT

for i in $(seq 1 "$N"); do
  curl -s -o "${TMPDIR_RESULTS}/result_${i}.json" -w "%{http_code}" \
    --max-time "${CURL_TIMEOUT}" \
    -X POST \
    "${FUNCTIONS_URL}/${PROJECT_ID}/us-central1/analyzeResume" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${ID_TOKEN}" \
    -d "${REQUEST_BODY}" > "${TMPDIR_RESULTS}/status_${i}.txt" &
done

wait || true
echo "  ✓ All ${N} requests completed"

# Count successes and failures
SUCCESSES=0
FAILURES=0
for i in $(seq 1 "$N"); do
  STATUS=$(cat "${TMPDIR_RESULTS}/status_${i}.txt" 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    SUCCESSES=$(( SUCCESSES + 1 ))
  else
    FAILURES=$(( FAILURES + 1 ))
    BODY=$(cat "${TMPDIR_RESULTS}/result_${i}.json" 2>/dev/null || echo "")
    echo "  ✗ Request ${i} failed (HTTP ${STATUS}): ${BODY}"
  fi
done

echo "  Successes: ${SUCCESSES} / ${N}"
echo "  Failures : ${FAILURES} / ${N}"

# ---------------------------------------------------------------------------
# Step 4: Read final balance and assert correctness
# ---------------------------------------------------------------------------
echo ""
echo "[ 4/4 ] Checking final credit balance..."

FINAL_DOC=$(curl -sf "${FIRESTORE_DOC_URL}" -H "Content-Type: application/json")
FINAL_CREDITS=$(echo "$FINAL_DOC" | grep -o '"credits":{[^}]*}' | grep -o '"integerValue":"[^"]*"' | cut -d'"' -f4 || true)

if [ -z "$FINAL_CREDITS" ]; then
  # Try doubleValue (Firestore may return as double)
  FINAL_CREDITS=$(echo "$FINAL_DOC" | grep -o '"credits":{[^}]*}' | grep -o '"doubleValue":[0-9.]*' | cut -d: -f2 | cut -d. -f1 || true)
fi

if [[ ! "${FINAL_CREDITS}" =~ ^[0-9]+$ ]]; then
  echo "ERROR: Firestore did not return a numeric credit balance."
  exit 1
fi

echo "  Final credits in Firestore: ${FINAL_CREDITS}"
echo "  Expected                  : ${EXPECTED_FINAL}"

echo ""
echo "=== Result ==="

if [ "$FINAL_CREDITS" = "$EXPECTED_FINAL" ] && [ "$FAILURES" -eq 0 ]; then
  echo ""
  echo "  ✓ M9 PASSED"
  echo "  ✓ Final balance is exactly start − (N × cost): ${START_CREDITS} − (${N} × ${COST_PER_CALL}) = ${EXPECTED_FINAL}"
  echo "  ✓ 0 lost / duplicate deductions"
  echo "  ✓ ${SUCCESSES}/${N} requests succeeded"
else
  ACTUAL_DEDUCTED=$(( START_CREDITS - FINAL_CREDITS ))
  EXPECTED_DEDUCTED=$(( N * COST_PER_CALL ))
  echo ""
  echo "  ✗ M9 FAILED"
  echo "  Expected deducted: ${EXPECTED_DEDUCTED}  (${N} × ${COST_PER_CALL})"
  echo "  Actual deducted  : ${ACTUAL_DEDUCTED}"
  echo "  Discrepancy      : $(( ACTUAL_DEDUCTED - EXPECTED_DEDUCTED )) credits"
  exit 1
fi

echo ""
