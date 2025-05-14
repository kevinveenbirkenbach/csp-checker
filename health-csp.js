const puppeteer = require('puppeteer');

// Get domains from command-line arguments
const domains = process.argv.slice(2);
if (domains.length === 0) {
  console.error('No domains specified. Please pass domains as CLI arguments.');
  process.exit(1);
}

(async () => {
  let errorCount = 0;

  // Launch Chromium in headless mode with no-sandbox flags
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

    // Create a CDP session to listen for CSP violations
    const client = await page.target().createCDPSession();
    await client.send('Security.enable');

    client.on('Security.cspViolationReported', event => {
      blockedResources.push({
        type: 'csp',
        documentURL: event.documentURL,
        blockedURL: event.blockedURL,
        violatedDirective: event.violatedDirective,
        effectiveDirective: event.effectiveDirective
      });
    });

    // Capture network request failures (e.g., DNS errors, blocked)
    page.on('requestfailed', request => {
      const failure = request.failure();
      const reason = failure ? failure.errorText : 'unknown';
      if (reason.toLowerCase().includes('blocked')) {
        blockedResources.push({
          type: 'network',
          url: request.url(),
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
      console.error(`${domain}: ERROR visiting site – ${err.message}`);
      errorCount++;
      await page.close();
      continue;
    }

    // Ignore domains that issue HTTP redirects
    const redirectChain = response.request().redirectChain();
    if (redirectChain.length > 0) {
      console.log(`${domain}: Ignored because of redirect (HTTP ${response.status()})`);
      await page.close();
      continue;
    }

    // Report any blocked resources or confirm none found
    if (blockedResources.length > 0) {
      console.warn(`${domain}: Blocked resources detected:`);
      blockedResources.forEach(resource => {
        if (resource.type === 'network') {
          console.log(`  [NETWORK] ${resource.url} (${resource.reason})`);
        } else if (resource.type === 'csp') {
          console.log(`  [CSP] Document: ${resource.documentURL}`);
          console.log(`        Blocked:  ${resource.blockedURL}`);
          console.log(`        Directive: ${resource.violatedDirective}`);
          console.log(`        Effective: ${resource.effectiveDirective}`);
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
