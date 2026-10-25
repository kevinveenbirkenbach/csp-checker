// files/health-csp.js
//
// CSP Checker (URL-only)
//
// - NOT backward compatible: accepts ONLY full URLs (http:// or https://)
// - Does NOT probe ports 80/443
// - Navigates exactly to the given URL
// - Treats 2xx and 304 as healthy; every other status must be declared via --accept-status
// - Follows redirect chains and judges the document they land on
// - Collects CSP violations via CDP + DOM events
// - Collects "blocked" network failures (e.g., ORB) unless ignored via --ignore-network-blocks-from
//
// Usage examples:
//   node health-csp.js http://baserow.infinito.example/
//   node health-csp.js --short -- http://baserow.infinito.example/login https://example.org/
//   node health-csp.js --ignore-network-blocks-from cdn.example.org -- https://example.org/
//   node health-csp.js --accept-status auth.example.org=401,403 -- https://auth.example.org/
//
// Exit codes:
//   0  -> no violations on all URLs
//   >0 -> at least one URL had violations or was unreachable

const puppeteer = require('puppeteer');
const { domainToASCII } = require('url');

const NO_CONTENT = 204;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DOCUMENT_STATUS_WAIT_MS = 2000;
const PAGE_CLOSE_WAIT_MS = 500;
const PAGE_RELEASE_WAIT_MS = 30000;
const BROWSER_CLOSE_WAIT_MS = 5000;

/**
 * Close a page or the browser without waiting forever.
 *
 * `page.close()` does not return while the page is committing a navigation,
 * which both the abort path and a page that navigates again after
 * domcontentloaded reach.
 *
 * @param {import('puppeteer').Page | import('puppeteer').Browser} closable page or browser to close
 * @param {number} timeoutMs milliseconds to wait before giving up on the close
 * @returns {Promise<void>} resolves on close or on the deadline, never rejects
 */
function closeBounded(closable, timeoutMs) {
  return Promise.race([
    closable.close().catch(() => {}),
    new Promise(resolve => setTimeout(resolve, timeoutMs).unref()),
  ]);
}

/**
 * Parse CLI args:
 *  - --short
 *  - --proxy <server>  (Chromium --proxy-server value, e.g. socks5://127.0.0.1:9050)
 *  - --proxy-bypass <hosts>  (Chromium --proxy-bypass-list value, e.g. .example.org,auth.example.net)
 *  - --confine-to <suffix>   (a target whose host ends with <suffix> must end on such a host)
 *  - --confine-allow <host ...>  (final hosts --confine-to accepts outside <suffix>)
 *  - --timeout <ms>    (navigation budget per URL until domcontentloaded, default 20000)
 *  - --ignore-network-blocks-from <domain ...>
 *  - --accept-status <host>=<code>[,<code>] ...
 *  - remaining positional args are target URLs (MUST be full URLs)
 */
/**
 * Comparable form of a host: lowercase ASCII, no trailing dot, no IPv6 brackets.
 *
 * Args:
 *   host: a hostname as given on the CLI or by URL.hostname.
 */
function bareHost(host) {
  const h = String(host).toLowerCase().replace(/\.$/, '').replace(/^\[(.*)\]$/, '$1');
  return domainToASCII(h) || h;
}

function parseArgs(argv) {
  const args = argv.slice(2); // skip node + script
  const result = {
    shortMode: false,
    proxy: '',
    proxyBypass: '',
    confineTo: '',
    confineAllow: new Set(),
    timeoutMs: 20000,
    ignoreDomains: [],
    acceptStatus: new Map(),
    urls: [],
  };

  let i = 0;
  const value = flag => {
    if (i >= args.length || String(args[i]).startsWith('--')) {
      console.error(`${flag} expects a value.`);
      process.exit(1);
    }
    return String(args[i++]);
  };
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

    if (token === '--proxy') {
      i += 1;
      if (i < args.length) {
        result.proxy = String(args[i]);
        i += 1;
      }
      continue;
    }

    if (token === '--proxy-bypass') {
      i += 1;
      result.proxyBypass = value(token);
      continue;
    }

    if (token === '--confine-to') {
      i += 1;
      result.confineTo = value(token).toLowerCase().replace(/\.$/, '');
      continue;
    }

    if (token === '--confine-allow') {
      i += 1;
      while (i < args.length && !String(args[i]).startsWith('--')) {
        result.confineAllow.add(bareHost(args[i]));
        i += 1;
      }
      continue;
    }

    if (token === '--timeout') {
      i += 1;
      result.timeoutMs = Number(args[i]);
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

    if (token === '--accept-status') {
      i += 1;
      while (i < args.length && !String(args[i]).startsWith('--')) {
        const [host, codes] = String(args[i]).split('=');
        if (host && codes) {
          const accepted = result.acceptStatus.get(host) || new Set();
          for (const code of codes.split(',')) {
            const parsed = Number(code);
            if (Number.isInteger(parsed)) accepted.add(parsed);
          }
          result.acceptStatus.set(host, accepted);
        }
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

const {
  shortMode, proxy, proxyBypass, confineTo, confineAllow, timeoutMs, ignoreDomains, acceptStatus, urls,
} = parseArgs(process.argv);

if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
  console.error('--timeout expects a positive integer number of milliseconds.');
  process.exit(1);
}

if (confineTo && !/^(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(confineTo)) {
  console.error('--confine-to expects a domain suffix with a leading dot, e.g. .onion');
  process.exit(1);
}

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

  // 3) Network: the status of a navigation that never commits, and block reasons
  let documentRequestId = null;
  let documentStatus = null;
  const documentStatusWaiters = [];
  await client.send('Network.enable');
  let documentUrl = null;
  client.on('Network.requestWillBeSent', event => {
    if (event.type !== 'Document') return;
    documentRequestId = event.requestId;
    documentUrl = event.request.url;
  });
  client.on('Network.responseReceivedExtraInfo', event => {
    if (event.requestId !== documentRequestId) return;
    if (REDIRECT_STATUSES.has(event.statusCode)) return;
    documentStatus = event.statusCode;
    documentStatusWaiters.splice(0).forEach(resolve => resolve(documentStatus));
  });

  const awaitDocumentStatus = timeoutMs => {
    if (documentStatus !== null) return Promise.resolve(documentStatus);
    return new Promise(resolve => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      documentStatusWaiters.push(status => {
        clearTimeout(timer);
        resolve(status);
      });
    });
  };

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

  return { page, blockedResources, client, awaitDocumentStatus, documentUrl: () => documentUrl };
}

// Retry page.evaluate on "Execution context was destroyed" thrown by mid-navigation races.
async function safeEvaluate(page, fn, { retries = 3, settleMs = 750 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await page.evaluate(fn);
    } catch (err) {
      const msg = String((err && err.message) || err);
      const isContextDestroyed = msg.includes('Execution context was destroyed')
        || msg.includes('Target closed');
      if (!isContextDestroyed || attempt === retries) throw err;
      await page
        .waitForNavigation({ timeout: 5000, waitUntil: 'domcontentloaded' })
        .catch(() => {});
      await new Promise(r => setTimeout(r, settleMs));
    }
  }
  return undefined;
}

function acceptsStatus(url, status) {
  try {
    return Boolean(acceptStatus.get(new URL(url).hostname)?.has(status));
  } catch {
    return false;
  }
}

/**
 * Whether a target under --confine-to ended on a host outside it that
 * --confine-allow does not list.
 *
 * Args:
 *   targetHost: host of the URL the checker was asked to visit.
 *   finalUrl: URL of the document the navigation ended on.
 */
function leftConfinement(targetHost, finalUrl) {
  if (!confineTo || !bareHost(targetHost).endsWith(confineTo)) return false;
  if (!isHttpUrl(finalUrl)) return false;
  const finalHost = bareHost(new URL(finalUrl).hostname);
  return !finalHost.endsWith(confineTo) && !confineAllow.has(finalHost);
}

/**
 * Navigate to an URL using a fresh instrumented page.
 * Returns:
 *  - { response, page, blockedResources }
 */
async function gotoUrl(browser, url, opts, ignoreDomainsList) {
  const { page, blockedResources, awaitDocumentStatus, documentUrl } = await createInstrumentedPage(
    browser,
    ignoreDomainsList,
  );

  try {
    const res = await page.goto(url, opts);
    if (!res) throw new Error('No response');

    const status = res.status();
    if (status >= 300 && status !== 304 && !acceptsStatus(url, status)) {
      throw new Error(`Status ${status}`);
    }

    return { response: res, page, blockedResources };
  } catch (err) {
    const status = await awaitDocumentStatus(DOCUMENT_STATUS_WAIT_MS);
    await closeBounded(page, PAGE_CLOSE_WAIT_MS);
    if (status === NO_CONTENT) return { documentless: status, finalUrl: documentUrl() };
    throw err;
  }
}

(async () => {
  let errorCount = 0;

  const browser = await puppeteer.launch({
    headless: 'new',
    // Chromium 113+ Chrome Root Store ignores host NSS DB; bypass cert validation (both names = Puppeteer v20/v21 compat).
    ignoreHTTPSErrors: true,
    acceptInsecureCerts: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--ignore-certificate-errors',
      '--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable',
      `--user-data-dir=${process.env.HOME || '/tmp'}/.config/chromium-profile`,
      ...(proxy ? [`--proxy-server=${proxy}`] : []),
      ...(proxy && proxyBypass ? [`--proxy-bypass-list=${proxyBypass}`] : []),
    ],
  });

  for (const url of urls) {
    const opts = { waitUntil: 'domcontentloaded', timeout: timeoutMs };

    let response, page, blockedResources, documentless, finalUrl;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      console.error(`${url}: ❌ Invalid URL`);
      errorCount++;
      continue;
    }

    try {
      ({ response, page, blockedResources, documentless, finalUrl } = await gotoUrl(
        browser, url, opts, ignoreDomains,
      ));
      const scheme = parsed.protocol.replace(':', '').toUpperCase();
      if (documentless) {
        if (leftConfinement(parsed.hostname, finalUrl)) {
          console.error(`${parsed.host}: ❌ left ${confineTo}: ended at ${finalUrl}`);
          errorCount++;
          continue;
        }
        console.log(`${parsed.host}: ✅ reachable via ${scheme} (${documentless}), no document to check`);
        continue;
      }
      console.log(`${parsed.host}: ✅ reachable via ${scheme} (${response.status()})`);
    } catch (err) {
      console.error(`${parsed.host}: ❌ Unable to reach ${url} (${err.message})`);
      errorCount++;
      continue;
    }

    const inPageViolations = await safeEvaluate(page, () => window.__cspViolations || []);
    inPageViolations.forEach(v => {
      blockedResources.push(Object.assign({ type: 'csp-dom' }, v));
    });

    const redirectChain = response.request().redirectChain();
    if (redirectChain.length > 0) {
      console.log(`${parsed.host}: ↪️ followed ${redirectChain.length} redirect(s) to ${page.url()}`);
    }

    const leftNetwork = leftConfinement(parsed.hostname, page.url());
    if (leftNetwork) {
      console.error(`${parsed.host}: ❌ left ${confineTo}: ended at ${page.url()}`);
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
      if (leftNetwork) errorCount++;
    }

    await closeBounded(page, PAGE_RELEASE_WAIT_MS);
  }

  await closeBounded(browser, BROWSER_CLOSE_WAIT_MS);
  process.exit(errorCount);
})().catch(err => {
  // Last-resort guard
  console.error(`Fatal: ${err && err.message ? err.message : String(err)}`);
  process.exit(2);
});
