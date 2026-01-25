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

## ⚠️ Breaking Change (v2.0.0)

Starting with **v2.0.0**, the checker is **URL-only**:

- ✅ **Only full URLs are accepted**
  - `http://example.com/`
  - `https://example.com/login`
- ❌ **No domain-only input**
  - `example.com` ❌
- ❌ **No HTTPS/HTTP probing**
- ❌ **No automatic fallback**

The checker navigates **exactly** to the provided URL.

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
