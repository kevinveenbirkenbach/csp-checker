# Changelog

## [3.0.4] - 2026-09-18

* Status: a 204 is finally reported as reachable, not as unreachable
* 3.0.3 published no image: its release build failed on that same fixture
* It read the status the moment page.goto rejected, before the event arrived
* The listener sits on a second CDP session, and two sessions have no order
* The status is now awaited; an expired deadline rethrows the original error
* Awaiting delays page.close() into the commit window, where it never returns
* The close is bounded: unchanged when quick, abandoned after half a second
* Tests: four URLs in one run, the 204 fixture visited twice must report twice

## [3.0.3] - 2026-09-17

* Status: the 204 handling from 3.0.2 never fired and is now actually wired
* A 204 is not committed, so Chromium emits no Network.responseReceived at all
* 3.0.2 listened for that event, so the catch read an empty list and gave up
* responseReceivedExtraInfo carries the status of an uncommitted navigation
* It is matched to the Document request id so a subresource cannot answer
* Network.enable on that session leaves the 304 revalidation fixture green
* Tests: the 204 fixture passes and the download fixture still fails

## [3.0.2] - 2026-09-17

* Status: a 204 counts as reachable instead of unreachable
* Chromium cancels the navigation, so page.goto throws and yields no response
* The status survives on the response event, which nothing was listening for
* A 204 reports *no document to check*: page.url is about:blank afterwards
* Exactly 204, not the 2xx range: a 200 with Content-Disposition is a download
* Tests: a 204 fixture that passes, a download fixture that must keep failing

## [3.0.1] - 2026-09-17

* Status: a 304 revalidation counts as reachable again
* 3.0.0 swept every code above 299 into the failure branch, 304 included
* A host revisited inside one run answers 304 from cache and must stay healthy
* Tests: a fixture that serves 200 first and revalidates to 304 on the revisit
* Build: *make test* runs the three CI linters and the E2E suite instead of nothing

## [3.0.0] - 2026-09-16

* Status: only 2xx is healthy; 401 and 403 lose their hardcoded pass
* CLI: *--accept-status host=code[,code]* declares a by-design status per host
* Unlike *--skip-domain* the declared page stays under CSP inspection
* Redirects: the chain is followed, printed, and the final document judged
* A violation on a redirect target is reported instead of being discarded
* Tests: fixtures for a 404 root, a 401 root, and a 302 to a violating target

## [2.3.0] - 2026-09-12

* CLI: *--timeout* sets the per-URL navigation budget in ms, default 20000
* Tor: a larger budget lets slow onion pages finish before the check aborts
* Validation: a non-positive or non-integer *--timeout* exits 1 with a message
* Test coverage: a slow fixture pins both budgets and the unchanged default

## [2.2.1] - 2026-08-10

* Bump Puppeteer 20.9.0 → 25.5.0 and the GitHub Actions
(metadata/login/setup-buildx/build-push, setup-node) to current majors.
* Add workflow concurrency groups keyed by workflow and ref, so a new push
supersedes running lint and e2e checks; the tag build queues instead of
cancelling to keep registry pushes intact.
* Ignore .mcp.json.

## [2.2.0] - 2026-07-18

Add a *--proxy* CLI option that is passed to Chromium as *--proxy-server*.
This lets the checker probe Tor hidden services (.onion vhosts) through a
SOCKS proxy, for example *--proxy socks5://127.0.0.1:9050*; SOCKS5 resolves
hostnames proxy-side, so .onion targets need no local DNS. When unset the
checker keeps its direct connection. Ships an isolated-network e2e fixture
proving both directions (unreachable directly, reachable via the proxy)
plus lint and dependabot workflows.

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

