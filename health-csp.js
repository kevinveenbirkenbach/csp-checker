const puppeteer = require('puppeteer');

// Process CLI args: detect --short flag
const rawArgs = process.argv.slice(2);
const shortModeIndex = rawArgs.indexOf('--short');
const shortMode = shortModeIndex > -1;
if (shortMode) {
  rawArgs.splice(shortModeIndex, 1);
}
const domains = rawArgs;

if (domains.length === 0) {
  console.error('No domains specified. Please pass domains as CLI arguments.');
  process.exit(1);
}

// Helper to filter resources in short mode: one example per type/policy
function filterShort(resources) {
  const seen = new Set();
  return resources.filter(res => {
    let key;
    switch (res.type) {
      case 'network':
        key = 'network';
        break;
      case 'csp-cdp':
      case 'csp-dom':
        // Group by effectiveDirective
        key = `${res.type}|${res.effectiveDirective}`;
        break;
      default:
        key = res.type;
    }
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

(async () => {
  let errorCount = 0;

  // Launch Chromium headlessly
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  });

  for (const domain of domains) {
    const page = await browser.newPage();
    const blockedResources = [];

    // 1) CDP: Listen for CSP via DevTools Protocol
    const client = await page.target().createCDPSession();
    await client.send('Security.enable');
    client.on('Security.cspViolationReported', event => {
      blockedResources.push({
        type: 'csp-cdp',
        documentURL:      event.documentURL,
        blockedURL:       event.blockedURL || '(inline)',
        violatedDirective: event.violatedDirective,
        effectiveDirective: event.effectiveDirective,
      });
    });

    // 2) DOM: Listen for CSP violations in-page
    await page.evaluateOnNewDocument(() => {
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', e => {
        window.__cspViolations.push({
          blockedURI:        e.blockedURI || '(inline)',
          violatedDirective: e.violatedDirective,
          effectiveDirective:e.effectiveDirective,
          sourceFile:        e.sourceFile,
          lineNumber:        e.lineNumber,
          columnNumber:      e.columnNumber
        });
      });
    });

    // 3) Network failures
    page.on('requestfailed', request => {
      const failure = request.failure();
      const reason = failure ? failure.errorText : 'unknown';
      if (reason.toLowerCase().includes('blocked')) {
        blockedResources.push({
          type: 'network',
          url:  request.url(),
          reason
        });
      }
    });

    let response;
    try {
      response = await page.goto(`https://${domain}`, {
        waitUntil: 'networkidle2',
        timeout: 20000
      });
    } catch (err) {
      console.error(`${domain}: ❌ ERROR visiting site – ${err.message}`);
      errorCount++;
      await page.close();
      continue;
    }

    // Pull in-page CSP violations
    const inPageViolations = await page.evaluate(() => window.__cspViolations);
    inPageViolations.forEach(v => {
      blockedResources.push(Object.assign({ type: 'csp-dom' }, v));
    });

    // Ignore HTTP redirect chains
    const redirectChain = response.request().redirectChain();
    if (redirectChain.length > 0) {
      console.log(`${domain}: 🚫 Ignored because of redirect (HTTP ${response.status()})`);
      await page.close();
      continue;
    }

    // Report results
    if (blockedResources.length > 0) {
      console.warn(`${domain}: ❌ Blocked resources detected:`);
      const toPrint = shortMode ? filterShort(blockedResources) : blockedResources;
      toPrint.forEach(res => {
        switch (res.type) {
          case 'network':
            console.log(`  [NETWORK] ${res.url} (${res.reason})`);
            break;
          case 'csp-cdp':
            console.log(`  [CSP CDP] Document:   ${res.documentURL}`);
            console.log(`             Blocked:    ${res.blockedURL}`);
            console.log(`             Violated:   ${res.violatedDirective}`);
            console.log(`             Effective:  ${res.effectiveDirective}`);
            break;
          case 'csp-dom':
            console.log(`  [CSP DOM] Blocked URI: ${res.blockedURI}`);
            console.log(`            Directive:   ${res.violatedDirective}`);
            console.log(`            Effective:   ${res.effectiveDirective}`);
            console.log(`            Source:      ${res.sourceFile}:${res.lineNumber}:${res.columnNumber}`);
            break;
        }
      });
      errorCount++;
    } else {
      console.log(`${domain}: ✅ No CSP or network blocks detected.`);
    }

    await page.close();
  }

  await browser.close();
  process.exit(errorCount);
})();
