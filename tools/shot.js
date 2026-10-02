// Headless screenshot / smoke helper. NEVER opens a visible window.
// Usage: node tools/shot.js [out.png] [script.js-to-eval-in-page] [waitMs]
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const out = process.argv[2] || 'shot.png';
  const evalFile = process.argv[3];
  const wait = +(process.argv[4] || 1500);
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
  await page.goto(require('url').pathToFileURL(path.resolve(__dirname, '..', 'index.html')).href);
  await page.waitForTimeout(800);
  if (evalFile) {
    const code = require('fs').readFileSync(evalFile, 'utf8');
    const r = await page.evaluate(code).catch(e => 'EVAL ERROR: ' + e.message);
    if (r !== undefined) console.log('eval result:', typeof r === 'string' ? r : JSON.stringify(r));
  }
  await page.waitForTimeout(wait);
  await page.screenshot({ path: out });
  console.log(logs.join('\n') || '(no console output)');
  console.log('saved', out);
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
