# 🚀 CSP Checker (Docker)

[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-GitHub%20Sponsors-blue?logo=github)](https://github.com/sponsors/kevinveenbirkenbach)
[![Patreon](https://img.shields.io/badge/Support-Patreon-orange?logo=patreon)](https://www.patreon.com/c/kevinveenbirkenbach)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20me%20a%20Coffee-Funding-yellow?logo=buymeacoffee)](https://buymeacoffee.com/kevinveenbirkenbach)
[![PayPal](https://img.shields.io/badge/Donate-PayPal-blue?logo=paypal)](https://s.veen.world/paypaldonate)

> A lightweight, containerized **Content Security Policy (CSP)** compliance checker powered by **Puppeteer** and **Chromium**.

---

## 📖 Description

**csp-checker** runs fully inside a Docker container and crawls one or more domains to detect:

- ❌ CSP violations (via **DevTools Protocol** and **DOM events**)
- ❌ blocked network requests (e.g. ORB / blocked by browser)
- ✅ reachability via HTTPS (with HTTP fallback)

The container exits with a **non-zero exit code** if violations are detected, making it ideal for **CI/CD pipelines**, monitoring jobs, and automated checks.

---

## 🐳 Docker Image

Images are published to **GitHub Container Registry (GHCR)**:

```text
ghcr.io/kevinveenbirkenbach/csp-checker
```

Example:

```bash
docker pull ghcr.io/kevinveenbirkenbach/csp-checker:stable
```

---

## ▶️ Usage

The container entrypoint is the checker itself.
All arguments passed to `docker run` are forwarded to the checker.

### Basic usage

```bash
docker run --rm ghcr.io/kevinveenbirkenbach/csp-checker example.com
```

Check multiple domains:

```bash
docker run --rm ghcr.io/kevinveenbirkenbach/csp-checker example.com api.example.com
```

---

### Short mode (one example per policy/type)

```bash
docker run --rm ghcr.io/kevinveenbirkenbach/csp-checker \
  --short example.com
```

---

### Ignore network blocks from specific domains

Suppress known third-party hosts (e.g. CDNs):

```bash
docker run --rm ghcr.io/kevinveenbirkenbach/csp-checker \
  --ignore-network-blocks-from pxscdn.com cdn.example.org \
  -- example.com
```

> ℹ️ The `--` separator ensures that everything after it is treated as a domain.

---

## 🧾 Exit Codes

* `0` → No CSP or network violations detected
* `>0` → One or more domains reported violations or were unreachable

This makes the image suitable for use in CI jobs:

```bash
docker run --rm ghcr.io/kevinveenbirkenbach/csp-checker example.com
```

---

## 🛠 Local Development

### Build locally

```bash
make build
```

### Run locally built image

```bash
make run ARGS="example.com"
```

With flags:

```bash
make run ARGS="--short -- example.com"
```

---

## 🔒 Security Notes

* Chromium runs **headless** and **without sandbox** (required inside containers)
* The container runs as a **non-root user**
* No data is persisted; the container is fully ephemeral

---

## 👤 Author

**Kevin Veen-Birkenbach**
Consulting & Coaching Solutions
🌐 [https://www.veen.world/](https://www.veen.world/)

---

## 📄 License

This project is licensed under the **MIT License**.
Feel free to fork, extend, and contribute!
