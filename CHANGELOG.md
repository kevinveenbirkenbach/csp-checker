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

