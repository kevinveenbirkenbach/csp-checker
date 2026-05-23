## [2.1.2] - 2026-05-23

* Fix Fatal: Execution context was destroyed, most likely because of a navigation when an app fires a client-side navigation after the initial domcontentloaded (e.g. LAM session redirect, meta-refresh, inline location.href assignment). page.evaluate now retries on the destroyed-context error, waiting for the next navigation to commit before reading window.__cspViolations from the new document. evaluateOnNewDocument reinstalls the violation collector on every document, so the retry returns the violations from the final document.


## [2.1.1] - 2026-05-22

* Chromium 113 and newer uses the Chrome Root Store and ignores the host
NSS database at HOME/.pki/nssdb. The existing nss-tools workaround
installed the project CA there but Chromium never read it, so Puppeteer
kept failing internal probes with ERR_CERT_AUTHORITY_INVALID.

csp-checker only validates reachability and CSP behavior of internal
targets, not TLS chain integrity, so the Puppeteer launch now bypasses
cert validation at three layers: ignoreHTTPSErrors for Puppeteer 20,
acceptInsecureCerts for Puppeteer 21 and newer, plus the
--ignore-certificate-errors Chromium command line flag.

Adds tests/e2e/web-tls-selfsigned, an nginx fixture served with an
ephemeral self-signed cert generated on the fly, plus Test 5 in the e2e
harness that asserts the checker can reach it. Without the fix, Test 5
prints ERR_CERT_AUTHORITY_INVALID and fails, guarding the regression.


## [2.1.0] - 2026-01-31

* Fix Chromium CA trust handling so injected certificates are correctly honored during CSP checks.


## [2.0.0] - 2026-01-25

* ⚠ BREAKING CHANGES
- CSP checker now accepts **only full URLs** (`http://` / `https://`)
- Removed HTTPS/HTTP port probing and automatic fallback
- Navigation happens exactly to the provided URL


## [1.0.1] - 2026-01-12

* Fix HTTP fallback after failed HTTPS probe by detecting open ports first and isolating navigation attempts to prevent timeouts.


## [1.0.0] - 2025-12-28

* Official Release 🥳

