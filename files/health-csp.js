// files/health-csp.js
//
// CSP Checker (URL-only)
//
// - NOT backward compatible: accepts ONLY full URLs (http:// or https://)
// - Does NOT probe ports 80/443
// - Navigates exactly to the given URL
// - Ignores redirect chains (same behavior as before)
// - Collects CSP violations via CDP + DOM events
// - Collects "blocked" network failures (e.g., ORB) unless ignored via --ignore-network-blocks-from
//
// Usage examples:
//   node health-csp.js http://baserow.infinito.example/
//   node health-csp.js --short -- http://baserow.infinito.example/login https://example.org/
//   node health-csp.js --ignore-network-blocks-from cdn.example.org -- https://example.org/
//
// Exit codes:
//   0  -> no violations on all URLs
//   >0 -> at least one URL had violations or was unreachable

const puppeteer = require('puppeteer');

/**
 * Parse CLI args:
 *  - --short
 *  - --ignore-network-blocks-from <domain ...>
 *  - remaining positional args are target URLs (MUST be full URLs)
 */
function parseArgs(argv) {
  const args = argv.slice(2); // skip node + script
  const result = {
    shortMode: false,
    ignoreDomains: [],
    urls: [],
  };

  let i = 0;
  while (i < args.length) {
    const token = args[i];

    // Explicit separator: everything after -- is treated as URLs
    if (token === '--') {
      i += 1;
      while (i < args.length) {
        result.urls.push(args[i]);
        i += 1;
      }
      break;
    }

    if (token === '--short') {
      result.shortMode = true;
      i += 1;
      continue;
    }

    if (token === '--ignore-network-blocks-from') {
      i += 1;
      while (i < args.length && !String(args[i]).startsWith('--')) {
        result.ignoreDomains.push(args[i]);
        i += 1;
      }
      continue;
    }

    // Positional URL
    result.urls.push(token);
    i += 1;
  }

  return result;
}

const { shortMode, ignoreDomains, urls } = parseArgs(process.argv);

function isHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

if (urls.length === 0) {
  console.error('No URLs specified. Please pass full URLs as CLI arguments (http:// or https://).');
  process.exit(1);
}

const badUrls = urls.filter(u => !isHttpUrl(u));
if (badUrls.length > 0) {
  console.error('URL-only mode: the following inputs are not valid http(s) URLs:');
  for (const u of badUrls) console.error(`  - ${u}`);
  process.exit(1);
}

// Helper: determine whether a URL should be ignored based on its hostname
function shouldIgnoreUrl(urlStr, ignoreList) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    return ignoreList.some(dom => {
      const d = String(dom).toLowerCase();
      return host === d || host.endsWith(`.${d}`);
    });
  } catch {
    const lower = String(urlStr).toLowerCase();
    return ignoreList.some(dom => lower.includes(String(dom).toLowerCase()));
  }
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
        key = `${res.type}|${res.effectiveDirective}`;
        break;
      default:
        key = res.type;
    }
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Create a new page that is fully configured for CSP/network collection.
 * Returns:
 *  - page
 *  - blockedResources (array)
 *  - client (CDP session)
 */
async function createInstrumentedPage(browser, ignoreDomainsList) {
  const page = await browser.newPage();

  // Auto-dismiss/accept dialogs so they can't block DOMContentLoaded.
  // For SSO "notice" popups etc, accepting is fine.
  page.on('dialog', async (dialog) => {
    try {
      await dialog.accept();
    } catch {
      // ignore
    }
  });

  await page.setUserAgent('CSP-CheckerBot (https://github.com/kevinveenbirkenbach/csp-checker)');

  const blockedResources = [];

  // 1) CDP: Listen for CSP via DevTools Protocol
  const client = await page.target().createCDPSession();
  await client.send('Security.enable');
  client.on('Security.cspViolationReported', event => {
    blockedResources.push({
      type: 'csp-cdp',
      documentURL: event.documentURL,
      blockedURL: event.blockedURL || '(inline)',
      violatedDirective: event.violatedDirective,
      effectiveDirective: event.effectiveDirective,
    });
  });

  // 2) DOM: Listen for CSP violations in-page
  await page.evaluateOnNewDocument(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', e => {
      window.__cspViolations.push({
        blockedURI: e.blockedURI || '(inline)',
        violatedDirective: e.violatedDirective,
        effectiveDirective: e.effectiveDirective,
        sourceFile: e.sourceFile,
        lineNumber: e.lineNumber,
        columnNumber: e.columnNumber,
      });
    });
  });

  // 3) Network failures (ORB and other block reasons)
  page.on('requestfailed', request => {
    const failure = request.failure();
    const reason = failure ? failure.errorText : 'unknown';
    const url = request.url();

    // Only consider "blocked" type failures (e.g., ORB / blocked by client)
    if (reason && reason.toLowerCase().includes('blocked')) {
      if (ignoreDomainsList.length > 0 && shouldIgnoreUrl(url, ignoreDomainsList)) {
        return; // suppressed
      }
      blockedResources.push({
        type: 'network',
        url,
        reason,
      });
    }
  });

  return { page, blockedResources, client };
}

/**
 * Navigate to an URL using a fresh instrumented page.
 * Returns:
 *  - { response, page, blockedResources }
 */
async function gotoUrl(browser, url, opts, ignoreDomainsList) {
  const { page, blockedResources } = await createInstrumentedPage(browser, ignoreDomainsList);

  try {
    const res = await page.goto(url, opts);
    if (!res) throw new Error('No response');

    const status = res.status();
    // allow 401 and 403 (reachable but unauthorized/forbidden)
    if (status >= 400 && status !== 401 && status !== 403) {
      throw new Error(`Status ${status}`);
    }

    return { response: res, page, blockedResources };
  } catch (err) {
    try { await page.close(); } catch {}
    throw err;
  }
}

(async () => {
  let errorCount = 0;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      `--user-data-dir=${process.env.HOME || '/tmp'}/.config/chromium-profile`,
    ],
  });

  for (const url of urls) {
    const opts = { waitUntil: 'domcontentloaded', timeout: 20000 };

    let response, page, blockedResources;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      console.error(`${url}: ❌ Invalid URL`);
      errorCount++;
      continue;
    }

    try {
      ({ response, page, blockedResources } = await gotoUrl(browser, url, opts, ignoreDomains));
      console.log(`${parsed.host}: ✅ reachable via ${parsed.protocol.replace(':', '').toUpperCase()} (${response.status()})`);
    } catch (err) {
      console.error(`${parsed.host}: ❌ Unable to reach ${url} (${err.message})`);
      errorCount++;
      continue;
    }

    // Pull in-page CSP violations
    const inPageViolations = await page.evaluate(() => window.__cspViolations);
    inPageViolations.forEach(v => {
      blockedResources.push(Object.assign({ type: 'csp-dom' }, v));
    });

    // Ignore redirect chains
    const redirectChain = response.request().redirectChain();
    if (redirectChain.length > 0) {
      console.log(`${parsed.host}: 👻 Ignored because of redirect (HTTP ${response.status()})`);
      await page.close();
      continue;
    }

    // Report results
    if (blockedResources.length > 0) {
      console.warn(`${parsed.host}: ❌ Blocked resources detected:`);
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
      console.log(`${parsed.host}: ✅ No CSP or network blocks detected.`);
    }

    await page.close();
  }

  await browser.close();
  process.exit(errorCount);
})().catch(err => {
  // Last-resort guard
  console.error(`Fatal: ${err && err.message ? err.message : String(err)}`);
  process.exit(2);
});
