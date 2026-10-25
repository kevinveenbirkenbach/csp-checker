# 🚀 CSP Checker (Docker)

[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-GitHub%20Sponsors-blue?logo=github)](https://github.com/sponsors/kevinveenbirkenbach)
[![Patreon](https://img.shields.io/badge/Support-Patreon-orange?logo=patreon)](https://www.patreon.com/c/kevinveenbirkenbach)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20me%20a%20Coffee-Funding-yellow?logo=buymeacoffee)](https://buymeacoffee.com/kevinveenbirkenbach)
[![PayPal](https://img.shields.io/badge/Donate-PayPal-blue?logo=paypal)](https://s.veen.world/paypaldonate)

> A lightweight, containerized **Content Security Policy (CSP)** compliance checker powered by **Puppeteer** and **Chromium**.

---

## 📖 Description

**csp-checker** runs fully inside a Docker container and checks one or more **explicit URLs** for:

- ❌ **CSP violations**
  - via Chrome DevTools Protocol (CDP)
  - via DOM `securitypolicyviolation` events
- ❌ **Blocked network requests**
  - e.g. ORB / blocked-by-client
- ✅ **Reachability of the given URL**

The container exits with a **non-zero exit code** if any URL reports violations or is unreachable, making it ideal for:

- CI/CD pipelines
- automated health checks
- security monitoring jobs

---

## 🐳 Docker Image

Images are published to **GitHub Container Registry (GHCR)**:

```

ghcr.io/kevinveenbirkenbach/csp-checker

```

Example:

```bash
docker pull ghcr.io/kevinveenbirkenbach/csp-checker:stable
```

---

## ▶️ Usage

The container entrypoint is the checker itself.
All arguments passed to `docker run` are forwarded directly to the checker.

### Basic usage (single URL)

```bash
docker run --rm ghcr.io/kevinveenbirkenbach/csp-checker \
  http://example.com/
```

### Multiple URLs

```bash
docker run --rm ghcr.io/kevinveenbirkenbach/csp-checker \
  https://example.com/ \
  https://example.com/login
```

Every URL is checked in its own fresh browser context: no cache, cookie, storage or service worker carries over from another URL, so a URL gets the same verdict wherever it stands in the list.

---

### Short mode

Print only one representative violation per policy/type:

```bash
docker run --rm ghcr.io/kevinveenbirkenbach/csp-checker \
  --short \
  -- https://example.com/
```

---

### Ignore blocked network requests from specific hosts

Useful for known CDNs or analytics endpoints:

```bash
docker run --rm ghcr.io/kevinveenbirkenbach/csp-checker \
  --ignore-network-blocks-from cdn.example.org analytics.example.com \
  -- https://example.com/
```

> ℹ️ The `--` separator ensures everything after it is treated as a URL.

---

### Accept a status code a host serves by design

Declare per host, comma-separated for several codes, repeatable for several
hosts. The page is navigated and CSP-checked as usual:

```bash
docker run --rm ghcr.io/kevinveenbirkenbach/csp-checker \
  --accept-status auth.example.org=401,403 mirror.example.org=404 \
  -- https://auth.example.org/ https://mirror.example.org/
```

The host must match the URL's hostname exactly; no subdomain suffixes.

---

### Proxy bypass

Reach the listed hosts directly while `--proxy` serves the rest. The value is a Chromium `--proxy-bypass-list`; a leading dot matches every subdomain:

```bash
docker run --rm ghcr.io/kevinveenbirkenbach/csp-checker \
  --proxy socks5://127.0.0.1:9050 \
  --proxy-bypass .example.org,auth.example.net \
  -- http://example.onion/
```

Without `--proxy` the flag has no effect.

---

### Network confinement

Fail a target whose host ends with `--confine-to` when it ends on a host that does not, unless `--confine-allow` lists that host. The suffix needs a leading dot. The checker judges the HTTP redirect chain, including a chain that ends on a `204`, and any client-side navigation that has committed by the time the page is inspected; a later JavaScript redirect and a navigation that ends on a browser error page are not judged. Targets outside the suffix are not checked:

```bash
docker run --rm ghcr.io/kevinveenbirkenbach/csp-checker \
  --proxy socks5://127.0.0.1:9050 \
  --confine-to .onion \
  --confine-allow auth.example.org \
  -- http://example.onion/
```

---

### Navigation timeout

Set how long each URL may take to reach `domcontentloaded`, in milliseconds (default `20000`):

```bash
docker run --rm ghcr.io/kevinveenbirkenbach/csp-checker \
  --proxy socks5://127.0.0.1:9050 \
  --timeout 100000 \
  -- http://example.onion/
```

---

### Parallel checks

Check up to `<n>` URLs at the same time, each in its own browser context of the same browser (default `1`, one URL after another):

```bash
docker run --rm ghcr.io/kevinveenbirkenbach/csp-checker \
  --concurrency 4 \
  -- https://example.com/ https://example.com/login https://example.org/
```

The report keeps the input order: a URL's lines are printed together as soon as that URL and every URL before it are done. The exit code still counts the failing URLs. With a value above `1`:

- each URL's lines go to stdout as one block, so they stay together in a combined log; without the flag, findings go to stderr as before
- the pages share the container's CPU, so raise `--timeout` when a small CPU quota slows the navigations down

---

## 🧾 Exit Codes

| Code | Meaning                                             |
| ---: | --------------------------------------------------- |
|  `0` | No CSP or network violations detected               |
| `>0` | One or more URLs had violations or were unreachable |
|  `2` | Fatal/internal error                                |

This makes the image suitable for CI pipelines:

```bash
docker run --rm ghcr.io/kevinveenbirkenbach/csp-checker \
  https://example.com/
```

---

## 🛠 Local Development

### Build locally

```bash
make build
```

### Run locally built image

```bash
make run ARGS="http://example.com/"
```

With flags:

```bash
make run ARGS="--short -- http://example.com/"
```

---

## 🔒 Security Notes

* Chromium runs **headless** and **without sandbox** (required in containers)
* The container runs as a **non-root user**
* No state or data is persisted

---

## 👤 Author

**Kevin Veen-Birkenbach**
Consulting & Coaching Solutions
🌐 [https://www.veen.world/](https://www.veen.world/)

---

## 📄 License

This project is licensed under the **MIT License**.
Feel free to fork, extend, and contribute!
