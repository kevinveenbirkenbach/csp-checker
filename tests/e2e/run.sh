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
for svc_pair in "web-ok:http" "web-bad:http" "web-404-by-design:http" "web-401-by-design:http" "web-304-revalidated:http" "web-204-bodyless:http" "web-200-download:http" "web-redirect-to-bad:http" "web-http-only:http" "web-tls-selfsigned:https" "web-redirecting:http" "web-slow:http"; do
  svc="${svc_pair%:*}"
  proto="${svc_pair#*:}"
  for i in {1..30}; do
    if docker run --rm --network "${NETWORK}" curlimages/curl:8.10.1 -kS "${proto}://${svc}/" >/dev/null 2>&1; then
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

log "Wait for socks proxy + proxied fixture"
for i in {1..30}; do
  if docker run --rm --network "${NETWORK}" curlimages/curl:8.10.1 \
      -fsS --socks5-hostname socks-proxy:1080 "http://web-proxied/" >/dev/null 2>&1; then
    echo "OK: web-proxied via socks-proxy"
    break
  fi
  sleep 0.2
  if [[ "${i}" -eq 30 ]]; then
    echo "ERROR: web-proxied not reachable via socks-proxy"
    docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" logs socks-proxy web-proxied
    exit 1
  fi
done

log "Test 7: --proxy reaches an isolated fixture through SOCKS; direct access must fail"
set +e
OUT_NOPROXY="$(timeout 60s docker run --rm --network "${NETWORK}" "${IMAGE}" "http://web-proxied/" 2>&1)"
RC_NOPROXY=$?
set -e
echo "${OUT_NOPROXY}"
if [[ "${RC_NOPROXY}" -eq 0 ]]; then
  echo "Expected non-zero exit code without --proxy (fixture must be isolated), got 0"
  exit 1
fi

set +e
OUT_PROXY="$(timeout 60s docker run --rm --network "${NETWORK}" "${IMAGE}" --proxy "socks5://socks-proxy:1080" "http://web-proxied/" 2>&1)"
RC_PROXY=$?
set -e
echo "${OUT_PROXY}"
if [[ "${RC_PROXY}" -ne 0 ]]; then
  echo "Expected exit code 0 with --proxy socks5://socks-proxy:1080, got ${RC_PROXY}"
  exit 1
fi
echo "${OUT_PROXY}" | grep -q "web-proxied: ✅" \
  || { echo "Expected success line for web-proxied via --proxy"; exit 1; }

log "Test 8: --timeout bounds the navigation; an invalid value is rejected"
set +e
OUT_TIMEOUT="$(timeout 60s docker run --rm --network "${NETWORK}" "${IMAGE}" --timeout 1 "http://web-ok/" 2>&1)"
RC_TIMEOUT=$?
set -e
echo "${OUT_TIMEOUT}"
if [[ "${RC_TIMEOUT}" -eq 0 ]]; then
  echo "Expected non-zero exit code with --timeout 1, got 0"
  exit 1
fi
echo "${OUT_TIMEOUT}" | grep -q "Navigation timeout of 1 ms exceeded" \
  || { echo "Expected the 1 ms budget to reach page.goto"; exit 1; }

set +e
OUT_LONG="$(timeout 60s docker run --rm --network "${NETWORK}" "${IMAGE}" --timeout 45000 "http://web-ok/" 2>&1)"
RC_LONG=$?
set -e
echo "${OUT_LONG}"
if [[ "${RC_LONG}" -ne 0 ]]; then
  echo "Expected exit code 0 with --timeout 45000, got ${RC_LONG}"
  exit 1
fi

for invalid in abc 0 -5 1.5; do
  set +e
  OUT_INVALID="$(timeout 60s docker run --rm --network "${NETWORK}" "${IMAGE}" --timeout "${invalid}" "http://web-ok/" 2>&1)"
  RC_INVALID=$?
  set -e
  echo "${OUT_INVALID}"
  if [[ "${RC_INVALID}" -ne 1 ]]; then
    echo "Expected exit code 1 for --timeout ${invalid}, got ${RC_INVALID}"
    exit 1
  fi
  echo "${OUT_INVALID}" | grep -q -- "--timeout expects a positive integer number of milliseconds." \
    || { echo "Expected the --timeout validation message for ${invalid}"; exit 1; }
done

log "Test 9: --timeout budgets a slow page, and the default stays 20000 ms"
set +e
OUT_SLOW_SHORT="$(timeout 60s docker run --rm --network "${NETWORK}" "${IMAGE}" --timeout 2000 "http://web-slow/?delay=5" 2>&1)"
RC_SLOW_SHORT=$?
set -e
echo "${OUT_SLOW_SHORT}"
if [[ "${RC_SLOW_SHORT}" -eq 0 ]]; then
  echo "Expected a 2000 ms budget to fail a page that answers after 5 s, got 0"
  exit 1
fi
echo "${OUT_SLOW_SHORT}" | grep -q "Navigation timeout of 2000 ms exceeded" \
  || { echo "Expected the 2000 ms navigation timeout for the slow page"; exit 1; }

set +e
OUT_SLOW_LONG="$(timeout 60s docker run --rm --network "${NETWORK}" "${IMAGE}" --timeout 15000 "http://web-slow/?delay=5" 2>&1)"
RC_SLOW_LONG=$?
set -e
echo "${OUT_SLOW_LONG}"
if [[ "${RC_SLOW_LONG}" -ne 0 ]]; then
  echo "Expected a 15000 ms budget to reach a page that answers after 5 s, got ${RC_SLOW_LONG}"
  exit 1
fi
echo "${OUT_SLOW_LONG}" | grep -q "web-slow: ✅ reachable via HTTP" \
  || { echo "Expected 'reachable via HTTP' for the slow page with a 15000 ms budget"; exit 1; }

set +e
OUT_SLOW_DEFAULT="$(timeout 90s docker run --rm --network "${NETWORK}" "${IMAGE}" "http://web-slow/?delay=30" 2>&1)"
RC_SLOW_DEFAULT=$?
set -e
echo "${OUT_SLOW_DEFAULT}"
if [[ "${RC_SLOW_DEFAULT}" -eq 0 ]]; then
  echo "Expected the default budget to fail a page that answers after 30 s, got 0"
  exit 1
fi
echo "${OUT_SLOW_DEFAULT}" | grep -q "Navigation timeout of 20000 ms exceeded" \
  || { echo "Expected the default navigation budget to stay 20000 ms"; exit 1; }

log "Test: a 4xx root fails by default and passes when --accept-status declares it healthy"
set +e
OUT_404_DEFAULT="$(docker run --rm --network "${NETWORK}" "${IMAGE}" "http://web-404-by-design/" 2>&1)"
RC_404_DEFAULT=$?
set -e
echo "${OUT_404_DEFAULT}"
if [[ "${RC_404_DEFAULT}" -eq 0 ]]; then
  echo "Expected a 404 root to fail without --accept-status, got 0"
  exit 1
fi
echo "${OUT_404_DEFAULT}" | grep -q "Status 404" \
  || { echo "Expected the failure to name the status code; ERR_INVALID_RESPONSE here means the fixture lost its default_type and the browser refused the body before any status was observed"; exit 1; }

set +e
OUT_404_ACCEPTED="$(docker run --rm --network "${NETWORK}" "${IMAGE}" \
  --accept-status "web-404-by-design=404" -- "http://web-404-by-design/" 2>&1)"
RC_404_ACCEPTED=$?
set -e
echo "${OUT_404_ACCEPTED}"
if [[ "${RC_404_ACCEPTED}" -ne 0 ]]; then
  echo "Expected the declared status to be accepted, got ${RC_404_ACCEPTED}"
  exit 1
fi
echo "${OUT_404_ACCEPTED}" | grep -q "web-404-by-design: ✅ No CSP or network blocks detected\." \
  || { echo "Expected the page's CSP to still be checked, not skipped"; exit 1; }

log "Test: a revisited page that revalidates to 304 stays healthy without --accept-status"
set +e
OUT_304="$(docker run --rm --network "${NETWORK}" "${IMAGE}" \
  "http://web-304-revalidated/" "http://web-304-revalidated/" 2>&1)"
RC_304=$?
set -e
echo "${OUT_304}"
if [[ "${RC_304}" -ne 0 ]]; then
  echo "Expected a 304 revalidation to count as reachable, got ${RC_304}"
  exit 1
fi
echo "${OUT_304}" | grep -q "web-304-revalidated: ✅ reachable via HTTP (304)" \
  || { echo "Expected the second visit to revalidate to 304; without that line this test proves nothing about 304 handling"; exit 1; }
echo "${OUT_304}" | grep -q "web-304-revalidated: ✅ No CSP or network blocks detected\." \
  || { echo "Expected the revalidated page's CSP to still be checked, not skipped"; exit 1; }

log "Test: a 200 that aborts is not a 204 and must still fail"
set +e
OUT_DL="$(docker run --rm --network "${NETWORK}" "${IMAGE}" "http://web-200-download/" 2>&1)"
RC_DL=$?
set -e
echo "${OUT_DL}"
if [[ "${RC_DL}" -eq 0 ]]; then
  echo "A download aborts the navigation too; only 204 declares an empty document"
  exit 1
fi

log "Test: a 204 is healthy and says it checked nothing"
set +e
OUT_204="$(docker run --rm --network "${NETWORK}" "${IMAGE}" "http://web-204-bodyless/" 2>&1)"
RC_204=$?
set -e
echo "${OUT_204}"
if [[ "${RC_204}" -ne 0 ]]; then
  echo "204 declares an empty document; the 2xx contract calls that healthy, got rc=${RC_204}"
  exit 1
fi
echo "${OUT_204}" | grep -q "web-204-bodyless: ✅ reachable via HTTP (204), no document to check" \
  || { echo "Expected the 204 to be reported as reachable AND as having checked nothing"; exit 1; }
if echo "${OUT_204}" | grep -q "web-204-bodyless: ✅ No CSP"; then
  echo "No document was committed, so claiming a clean CSP result would be a false green"
  exit 1
fi

log "Test: 401 is no longer healthy by default and must be declared"
set +e
OUT_401_DEFAULT="$(docker run --rm --network "${NETWORK}" "${IMAGE}" "http://web-401-by-design/" 2>&1)"
RC_401_DEFAULT=$?
set -e
echo "${OUT_401_DEFAULT}"
if [[ "${RC_401_DEFAULT}" -eq 0 ]]; then
  echo "Expected 401 to fail without --accept-status, got 0"
  exit 1
fi
echo "${OUT_401_DEFAULT}" | grep -q "Status 401" \
  || { echo "Expected the failure to name status 401"; exit 1; }

set +e
OUT_401_ACCEPTED="$(docker run --rm --network "${NETWORK}" "${IMAGE}" \
  --accept-status "web-401-by-design=401" -- "http://web-401-by-design/" 2>&1)"
RC_401_ACCEPTED=$?
set -e
echo "${OUT_401_ACCEPTED}"
if [[ "${RC_401_ACCEPTED}" -ne 0 ]]; then
  echo "Expected the declared 401 to be accepted, got ${RC_401_ACCEPTED}"
  exit 1
fi
echo "${OUT_401_ACCEPTED}" | grep -q "web-401-by-design: ✅ No CSP or network blocks detected\." \
  || { echo "Expected the login wall's own CSP to still be checked"; exit 1; }

log "Test: a violation on a redirect target is reported, not discarded"
set +e
OUT_REDIR_BAD="$(docker run --rm --network "${NETWORK}" "${IMAGE}" "http://web-redirect-to-bad/" 2>&1)"
RC_REDIR_BAD=$?
set -e
echo "${OUT_REDIR_BAD}"
if [[ "${RC_REDIR_BAD}" -eq 0 ]]; then
  echo "Expected the redirect target's CSP violation to fail the run, got 0"
  exit 1
fi
echo "${OUT_REDIR_BAD}" | grep -q "followed 1 redirect(s) to http://web-redirect-to-bad/landed" \
  || { echo "Expected the redirect to be named with its final URL"; exit 1; }
echo "${OUT_REDIR_BAD}" | grep -q "web-redirect-to-bad: ❌ Blocked resources detected" \
  || { echo "Expected the violation behind the redirect to be reported, not swallowed"; exit 1; }

log "All E2E tests passed ✅"
