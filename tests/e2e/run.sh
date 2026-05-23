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

log "Ensure self-signed cert for TLS fixture exists"
TLS_CERTS_DIR="tests/e2e/web-tls-selfsigned/certs"
mkdir -p "${TLS_CERTS_DIR}"
if [[ ! -f "${TLS_CERTS_DIR}/server.crt" ]] || [[ ! -f "${TLS_CERTS_DIR}/server.key" ]]; then
  echo "generating new self-signed cert"
  openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
    -subj "/CN=web-tls-selfsigned" \
    -addext "subjectAltName=DNS:web-tls-selfsigned" \
    -keyout "${TLS_CERTS_DIR}/server.key" \
    -out    "${TLS_CERTS_DIR}/server.crt" >/dev/null 2>&1
  chmod 644 "${TLS_CERTS_DIR}/server.key" "${TLS_CERTS_DIR}/server.crt"
else
  echo "reusing existing self-signed cert"
fi

log "Start E2E web fixtures (nginx)"
docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" up -d

NETWORK="${PROJECT}_default"

# small wait loop for nginx readiness (curl -k so the same loop covers http + https-selfsigned)
log "Wait for nginx services"
for svc_pair in "web-ok:http" "web-bad:http" "web-http-only:http" "web-tls-selfsigned:https" "web-redirecting:http"; do
  svc="${svc_pair%:*}"
  proto="${svc_pair#*:}"
  for i in {1..30}; do
    if docker run --rm --network "${NETWORK}" curlimages/curl:8.10.1 -fkS "${proto}://${svc}/" >/dev/null 2>&1; then
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
OUT_OK="$(docker run --rm --network "${NETWORK}" "${IMAGE}" "http://web-ok/" 2>&1)"
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
OUT_BAD="$(docker run --rm --network "${NETWORK}" "${IMAGE}" "http://web-bad/" 2>&1)"
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
OUT_SHORT="$(docker run --rm --network "${NETWORK}" "${IMAGE}" --short "http://web-bad/" 2>&1)"
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

log "Test 4: http-only service must not hang (regression test)"
# URL-only mode: we always pass the exact URL; ensure it finishes quickly and exits 0.
set +e
OUT_HTTP_ONLY="$(timeout 15s docker run --rm --network "${NETWORK}" "${IMAGE}" "http://web-http-only/" 2>&1)"
RC_HTTP_ONLY=$?
set -e
echo "${OUT_HTTP_ONLY}"

if [[ "${RC_HTTP_ONLY}" -ne 0 ]]; then
  echo "Expected exit code 0 for web-http-only, got ${RC_HTTP_ONLY}"
  exit 1
fi

# Must say reachable via HTTP
echo "${OUT_HTTP_ONLY}" | grep -q "web-http-only: ✅ reachable via HTTP" \
  || { echo "Expected 'reachable via HTTP' for web-http-only"; exit 1; }

log "Test 5: self-signed HTTPS must be reachable (acceptInsecureCerts regression)"
# Guards against Chromium 113+ Chrome Root Store ignoring host NSS DB; needs Puppeteer cert-bypass.
set +e
OUT_TLS="$(docker run --rm --network "${NETWORK}" "${IMAGE}" "https://web-tls-selfsigned/" 2>&1)"
RC_TLS=$?
set -e
echo "${OUT_TLS}"
if [[ "${RC_TLS}" -ne 0 ]]; then
  echo "Expected exit code 0 for self-signed HTTPS, got ${RC_TLS}"
  echo "If the message above is 'ERR_CERT_AUTHORITY_INVALID', the Puppeteer launch is missing acceptInsecureCerts."
  exit 1
fi
echo "${OUT_TLS}" | grep -q "web-tls-selfsigned: ✅ reachable via HTTPS" \
  || { echo "Expected 'reachable via HTTPS' line for web-tls-selfsigned"; exit 1; }

log "Test 6: post-DOMContentLoaded navigation must not crash with 'Execution context was destroyed'"
set +e
OUT_REDIR="$(timeout 30s docker run --rm --network "${NETWORK}" "${IMAGE}" "http://web-redirecting/" 2>&1)"
RC_REDIR=$?
set -e
echo "${OUT_REDIR}"
if echo "${OUT_REDIR}" | grep -q "Execution context was destroyed"; then
  echo "Regression: 'Execution context was destroyed' was not retried"
  exit 1
fi
if [[ "${RC_REDIR}" -ne 0 ]]; then
  echo "Expected exit code 0 for web-redirecting after navigation retry, got ${RC_REDIR}"
  exit 1
fi
echo "${OUT_REDIR}" | grep -q "web-redirecting: ✅ reachable via HTTP" \
  || { echo "Expected 'reachable via HTTP' line for web-redirecting"; exit 1; }

log "All E2E tests passed ✅"
