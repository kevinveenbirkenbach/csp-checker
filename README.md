# 🚀 CSP Checker

> A lightweight, containerized CSP compliance checker powered by Puppeteer.

---

## 📖 Description

**csp-checker** crawls your domains over HTTPS, captures both network failures and browser console CSP errors, and reports any blocked resources. Perfect for integrating into CI/CD pipelines or monitoring systems.

---

## ⚙️ Installation

You can also install this software via [Kevin’s Package Manager](https://github.com/kevinveenbirkenbach/package-manager):

```bash
pkgmgr install checkcsp
```

---

## 📋 Usage

After installation, invoke the `checkcsp` command:

```bash
# Show help & available commands
checkcsp --help

# Build or rebuild the Docker image
checkcsp build [--tag <your-tag>]

# Run the CSP checker against one or more domains
checkcsp start example.com api.example.com
```

---

## 👤 Author

**Kevin Veen-Birkenbach**
Consulting & Coaching Solutions
🌐 [https://www.veen.world/](https://www.veen.world/)

---

## 📄 License

This project is licensed under the **MIT License**.
Feel free to fork, extend, and contribute!