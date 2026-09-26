#!/usr/bin/env bash
# smoke-test-webhook.sh — End-to-end ingestion path smoke test.
#
# Exercises the full stack running inside Docker Compose:
#   1. POSTs a representative GitHub push-event to /webhook
#   2. Queries PostgreSQL to assert the event row exists in push_events
#   3. Fetches /metrics to assert the Prometheus counter incremented
#
# Usage:
#   ./scripts/smoke-test-webhook.sh
#
# Override defaults with environment variables:
#   WEBHOOK_URL    (default: http://localhost:8000/webhook)
#   METRICS_URL    (default: http://localhost:8000/metrics)
#   DATABASE_URL   (default: postgres://gitweave:gitweave@localhost:5432/gitweave)
#   EXPECTED_METRIC (default: gitweave_webhook_events_total)
set -euo pipefail

WEBHOOK_URL="${WEBHOOK_URL:-http://localhost:8000/webhook}"
METRICS_URL="${METRICS_URL:-http://localhost:8000/metrics}"
DATABASE_URL="${DATABASE_URL:-postgres://gitweave:gitweave@localhost:5432/gitweave}"
EXPECTED_METRIC="${EXPECTED_METRIC:-gitweave_webhook_events_total}"

# Representative GitHub push-event payload (subset of the real schema).
# repository.full_name, ref, and commits are required by the push handler.
PAYLOAD='{
  "ref": "refs/heads/main",
  "repository": {
    "full_name": "smoke-test-org/smoke-test-repo",
    "name": "smoke-test-repo",
    "html_url": "https://github.com/smoke-test-org/smoke-test-repo"
  },
  "commits": [
    {
      "id": "abc123def456abc123def456abc123def456abc123",
      "message": "smoke test commit",
      "timestamp": "2026-01-01T00:00:00Z",
      "author": {"name": "Smoke Test", "email": "smoke@test.local"}
    }
  ],
  "pusher": {"name": "Smoke Test", "email": "smoke@test.local"}
}'

# ---------------------------------------------------------------------------
# Step 1: POST push event to /webhook
# ---------------------------------------------------------------------------
echo "[1/3] Posting push event to /webhook..."
HTTP_CODE=$(curl -s -w '%{http_code}' -o /dev/null \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: push" \
  --data "$PAYLOAD" \
  "$WEBHOOK_URL")

if [ "$HTTP_CODE" != "200" ]; then
  echo "FAIL [webhook]: expected HTTP 200 from /webhook, got HTTP $HTTP_CODE" >&2
  exit 1
fi
echo "OK   [webhook]: received HTTP 200"

# ---------------------------------------------------------------------------
# Step 2: Assert event row exists in push_events via psql
# ---------------------------------------------------------------------------
echo "[2/3] Checking push_events row count in PostgreSQL..."
ROW_COUNT=$(psql "$DATABASE_URL" -tAc 'SELECT COUNT(*) FROM push_events')

if [ "$ROW_COUNT" -eq 0 ]; then
  echo "FAIL [database]: push_events has 0 rows — event was not persisted after the POST" >&2
  exit 1
fi
echo "OK   [database]: push_events has $ROW_COUNT row(s)"

# ---------------------------------------------------------------------------
# Step 3: Assert expected Prometheus metric label in /metrics
# ---------------------------------------------------------------------------
echo "[3/3] Checking /metrics for expected Prometheus counter..."
METRICS_OUTPUT=$(curl -s "$METRICS_URL")

if ! echo "$METRICS_OUTPUT" | grep -q "$EXPECTED_METRIC"; then
  echo "FAIL [metrics]: expected label '$EXPECTED_METRIC' not found in /metrics output" >&2
  exit 1
fi
echo "OK   [metrics]: found '$EXPECTED_METRIC' in /metrics"

echo ""
echo "Smoke test PASSED — full ingestion path is working."
