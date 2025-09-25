# 🚀 CSP Checker

> A lightweight, containerized CSP compliance checker powered by Puppeteer.

---

## 📖 Description

**csp-checker** crawls your domains over HTTPS, captures both network failures and browser console CSP errors, and reports any blocked resources. Perfect for integrating into CI/CD pipelines or monitoring systems.

---

## ⚙️ Installation

Install via [Kevin’s Package Manager](https://github.com/kevinveenbirkenbach/package-manager):

```bash
pkgmgr install checkcsp
```

This will automatically build and install the Docker image as `csp-checker:latest`.

---

## 📋 Usage

After installation, simply use the `checkcsp` command:

```bash
# Show help & available commands
checkcsp --help

# Run the CSP checker against one or more domains
checkcsp example.com api.example.com

# Run in short mode (one example per type/policy)
checkcsp --short example.com
```

---

## 🧪 Testing

A small Python unit test suite is included:

```bash
make test
```

This runs `python3 -m unittest -v test.py` and verifies the container startup logic.

---

## 👤 Author

**Kevin Veen-Birkenbach**
Consulting & Coaching Solutions
🌐 [https://www.veen.world/](https://www.veen.world/)

---

## 📄 License

This project is licensed under the **MIT License**.
Feel free to fork, extend, and contribute!
