#!/usr/bin/env bash
set -euo pipefail

PROJECT="csp-e2e"
IMAGE="csp-checker:e2e"
COMPOSE_FILE="tests/e2e/docker-compose.yml"

log() { printf "\n== %s ==\n" "$*"; }

cleanup() {
  log "Cleanup"
  docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

log "Build image"
docker build --pull -t "${IMAGE}" .

log "Start E2E web fixtures (nginx)"
docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" up -d

NETWORK="${PROJECT}_default"

# small wait loop for nginx readiness
log "Wait for nginx services"
for svc in web-ok web-bad web-http-only; do
  for i in {1..30}; do
    if docker run --rm --network "${NETWORK}" curlimages/curl:8.10.1 -fsS "http://${svc}/" >/dev/null 2>&1; then
      echo "OK: ${svc}"
      break
    fi
    sleep 0.2
    if [[ "${i}" -eq 30 ]]; then
      echo "ERROR: ${svc} not reachable"
      docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" logs
      exit 1
    fi
  done
done

log "Test 1: web-ok should exit 0 and report no violations"
set +e
OUT_OK="$(docker run --rm --network "${NETWORK}" "${IMAGE}" web-ok 2>&1)"
RC_OK=$?
set -e
echo "${OUT_OK}"
if [[ "${RC_OK}" -ne 0 ]]; then
  echo "Expected exit code 0 for web-ok, got ${RC_OK}"
  exit 1
fi
echo "${OUT_OK}" | grep -q "web-ok: ✅ No CSP or network blocks detected\." \
  || { echo "Expected 'No CSP' line for web-ok"; exit 1; }

log "Test 2: web-bad should exit >0 and report CSP violations"
set +e
OUT_BAD="$(docker run --rm --network "${NETWORK}" "${IMAGE}" web-bad 2>&1)"
RC_BAD=$?
set -e
echo "${OUT_BAD}"
if [[ "${RC_BAD}" -eq 0 ]]; then
  echo "Expected non-zero exit code for web-bad, got 0"
  exit 1
fi
echo "${OUT_BAD}" | grep -q "web-bad: ❌ Blocked resources detected:" \
  || { echo "Expected 'Blocked resources detected' line for web-bad"; exit 1; }

# Ensure we saw at least one CSP event printed (DOM or CDP)
echo "${OUT_BAD}" | grep -Eq "\[CSP (DOM|CDP)\]" \
  || { echo "Expected CSP DOM or CSP CDP output for web-bad"; exit 1; }

log "Test 3: --short should reduce duplicate CSP DOM entries (2 inline scripts -> 1 line expected)"
set +e
OUT_SHORT="$(docker run --rm --network "${NETWORK}" "${IMAGE}" --short web-bad 2>&1)"
RC_SHORT=$?
set -e
echo "${OUT_SHORT}"
if [[ "${RC_SHORT}" -eq 0 ]]; then
  echo "Expected non-zero exit code for web-bad in short mode, got 0"
  exit 1
fi

# Count DOM lines; should be 1 in short mode for the same directive
DOM_COUNT="$(echo "${OUT_SHORT}" | grep -c "^\s*\[CSP DOM\]" || true)"
if [[ "${DOM_COUNT}" -gt 1 ]]; then
  echo "Expected <= 1 '[CSP DOM]' entry in --short mode, got ${DOM_COUNT}"
  exit 1
fi

log "Test 4: http-only service must not hang after a failed HTTPS probe (regression test)"
# If your fix is in place, checker should quickly choose HTTP (port 80 open, 443 refused) and exit 0.
# We also ensure it finishes within a short time to catch the timeout hang.
set +e
OUT_HTTP_ONLY="$(timeout 15s docker run --rm --network "${NETWORK}" "${IMAGE}" web-http-only 2>&1)"
RC_HTTP_ONLY=$?
set -e
echo "${OUT_HTTP_ONLY}"

if [[ "${RC_HTTP_ONLY}" -ne 0 ]]; then
  echo "Expected exit code 0 for web-http-only, got ${RC_HTTP_ONLY}"
  exit 1
fi

# Must say reachable via HTTP (and should not need HTTPS)
echo "${OUT_HTTP_ONLY}" | grep -q "web-http-only: ✅ reachable via HTTP" \
  || { echo "Expected 'reachable via HTTP' for web-http-only"; exit 1; }

log "All E2E tests passed ✅"
