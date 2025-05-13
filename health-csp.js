const puppeteer = require('puppeteer');

// Domains from CLI
const domains = process.argv.slice(2);
if (!domains.length) {
  console.error('No domains specified. Pass domains as CLI arguments.');
  process.exit(1);
}

(async () => {
  let errorCounter = 0;

  // Launch Chromium with no-sandbox flags
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

    // 1) Network failures (e.g.  DNS, blocked by extension, etc.)
    page.on('requestfailed', req => {
      const reason = req.failure()?.errorText || '';
      if (reason.toLowerCase().includes('blocked')) {
        blockedResources.push({ type: 'network', url: req.url(), reason });
      }
    });

    // 2) CSP console-logs
    page.on('console', msg => {
      const text = msg.text();
      if (
        msg.type() === 'error' &&
        text.includes('Refused to load') &&
        text.includes('violates the following Content Security Policy')
      ) {
        blockedResources.push({ type: 'csp', message: text });
      }
    });

    try {
      await page.goto(`https://${domain}`, {
        waitUntil: 'networkidle2',
        timeout: 20000
      });
    } catch (e) {
      console.error(`${domain}: ERROR visiting site - ${e.message}`);
      errorCounter++;
      await page.close();
      continue;
    }

    if (blockedResources.length > 0) {
      console.warn(`${domain}: Blocked resources detected:`);
      blockedResources.forEach(r => {
        if (r.type === 'network') {
          console.log(`  [NET] ${r.url} (${r.reason})`);
        } else if (r.type === 'csp') {
          console.log(`  [CSP] ${r.message}`);
        }
      });
      errorCounter++;
    } else {
      console.log(`${domain}: ✅ No CSP blocks detected.`);
    }

    await page.close();
  }

  await browser.close();
  process.exit(errorCounter);
})();