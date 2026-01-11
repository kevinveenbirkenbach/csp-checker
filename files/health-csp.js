const net = require('net');
const puppeteer = require('puppeteer');

/**
 * Parse CLI args:
 *  - --short
 *  - --ignore-network-blocks-from <domain ...>
 *  - remaining positional args are target domains
 */
function parseArgs(argv) {
  const args = argv.slice(2); // skip node + script
  const result = {
    shortMode: false,
    ignoreDomains: [],
    domains: []
  };

  // Simple stateful parse
  let i = 0;
  while (i < args.length) {
    const token = args[i];

    // Explicitly handle arg separator: everything after -- are positional domains
    if (token === '--') {
      i += 1;
      while (i < args.length) {
        result.domains.push(args[i]);
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
      i += 1; // move to first domain
      while (i < args.length && !String(args[i]).startsWith('--')) {
        result.ignoreDomains.push(args[i]);
        i += 1;
      }
      continue;
    }

    // Positional target domain
    result.domains.push(token);
    i += 1;
  }

  return result;
}

const { shortMode, ignoreDomains, domains } = parseArgs(process.argv);

if (domains.length === 0) {
  console.error('No domains specified. Please pass domains as CLI arguments.');
  process.exit(1);
}

// Helper: determine whether a URL should be ignored based on its hostname
function shouldIgnoreUrl(urlStr, ignoreList) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    return ignoreList.some(dom => {
      const d = String(dom).toLowerCase();
      // exact host or subdomain match
      return host === d || host.endsWith(`.${d}`);
    });
  } catch {
    // If URL can't be parsed, fallback to a conservative substring test
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
 * TCP reachability check for a host:port.
 * This avoids "probe HTTPS then fallback to HTTP" inside the same browser context,
 * which can lead to timeouts on some sites after a failed TLS navigation attempt.
 */
function canConnect(host, port, timeoutMs = 800) {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let done = false;

    const finish = ok => {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));

    socket.connect(port, host);
  });
}

/**
 * Decide which scheme(s) to try based on open ports.
 * - Prefer HTTPS if 443 is reachable
 * - Otherwise try HTTP if 80 is reachable
 * - If both reachable, prefer HTTPS first then HTTP
 * - If none reachable, return []
 */
async function decideSchemes(domain) {
  const httpsOk = await canConnect(domain, 443);
  if (httpsOk) {
    // If HTTPS is reachable, prefer it first; HTTP can still be tried if wanted.
    const httpOk = await canConnect(domain, 80);
    return httpOk ? ['https', 'http'] : ['https'];
  }

  const httpOk = await canConnect(domain, 80);
  return httpOk ? ['http'] : [];
}

/**
 * Create a new page that is fully configured for CSP/network collection.
 * Returns:
 *  - page
 *  - blockedResources (array)
 *  - client (CDP session)
 */
async function createInstrumentedPage(browser, domain, ignoreDomainsList) {
  const page = await browser.newPage();
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
      effectiveDirective: event.effectiveDirective
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
        columnNumber: e.columnNumber
      });
    });
  });

  // 3) Network failures (ORB and other block reasons)
  page.on('requestfailed', request => {
    const failure = request.failure();
    const reason = failure ? failure.errorText : 'unknown';
    const url = request.url();

    // Only consider "blocked" type failures (e.g., ORB)
    if (reason && reason.toLowerCase().includes('blocked')) {
      // Ignore if URL host matches any of the ignore list entries
      if (ignoreDomainsList.length > 0 && shouldIgnoreUrl(url, ignoreDomainsList)) {
        return; // suppressed
      }
      blockedResources.push({
        type: 'network',
        url,
        reason
      });
    }
  });

  return { page, blockedResources, client };
}

/**
 * Navigate using a *fresh page per scheme attempt*.
 *
 * Why:
 * - A failed HTTPS attempt can poison the subsequent HTTP attempt in the same page/context
 *   (seen as "HTTP timeout after HTTPS ERR_CONNECTION_REFUSED/ERR_*").
 * - Creating a new page avoids hanging/aborted pending navigations.
 *
 * Returns:
 *  - { response, scheme, page, blockedResources }
 */
async function gotoWithIsolatedFallback(browser, domain, schemes, opts, ignoreDomainsList) {
  let lastErr = null;

  for (const s of schemes) {
    const url = `${s}://${domain}`;

    // New instrumented page for each scheme attempt
    const { page, blockedResources } = await createInstrumentedPage(browser, domain, ignoreDomainsList);

    try {
      const res = await page.goto(url, opts);
      if (!res) throw new Error('No response');

      const status = res.status();
      // allow 401 and 403 (reachable but unauthorized/forbidden)
      if (status >= 400 && status !== 401 && status !== 403) {
        throw new Error(`Status ${status}`);
      }

      return { response: res, scheme: s, page, blockedResources };
    } catch (err) {
      lastErr = err;
      console.warn(`→ ${s.toUpperCase()} failed (${err.message})`);
      try {
        await page.close();
      } catch {
        // ignore
      }
    }
  }

  const why = lastErr ? ` (${lastErr.message})` : '';
  throw new Error(`Unable to reach ${domain} via ${schemes.join(', ')}${why}`);
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
    const opts = { waitUntil: 'domcontentloaded', timeout: 20000 };

    // Decide schemes based on open ports first (fast + avoids poisoned fallback)
    let schemes = [];
    try {
      schemes = await decideSchemes(domain);
    } catch {
      schemes = [];
    }

    if (schemes.length === 0) {
      console.error(`${domain}: ❌ Unable to reach ${domain} via https, http (no reachable ports 443/80)`);
      errorCount++;
      continue;
    }

    let response, scheme, page, blockedResources;

    try {
      ({ response, scheme, page, blockedResources } = await gotoWithIsolatedFallback(
        browser,
        domain,
        schemes,
        opts,
        ignoreDomains
      ));
      console.log(`${domain}: ✅ reachable via ${scheme.toUpperCase()} (${response.status()})`);
    } catch (err) {
      console.error(`${domain}: ❌ ${err.message}`);
      errorCount++;
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
      console.log(`${domain}: 👻 Ignored because of redirect (HTTP ${response.status()})`);
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
