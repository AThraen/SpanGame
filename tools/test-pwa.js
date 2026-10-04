// pwa: headless checks for the PWA shell. Never opens a visible window.
// Usage: node tools/test-pwa.js [outDir=%TEMP%/span-pwa]
//  static : sw.js precache is fresh, covers every file index.html loads, manifest + icons are valid
//  http   : (tools/serve.js on localhost) SW installs, precache completes, the game loads OFFLINE
//           (context.setOffline + reload, deep link ?level=3), update toast -> tap -> new version
//  devices: Pixel 7 / iPhone 14 / iPad, portrait + landscape (hasTouch); install button via a
//           synthetic beforeinstallprompt; iOS "Add to Home Screen" hint
//  file://: no registration, no errors, the game still runs
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');
const url = require('url');
const { spawnSync } = require('child_process');
const { serve } = require('./serve');
const ROOT = path.resolve(__dirname, '..');
const OUT = process.argv[2] || path.join(require('os').tmpdir(), 'span-pwa');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const ok = (name, cond, info) => { results.push({ name, pass: !!cond, info }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };

function swData() {
  const src = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const version = (src.match(/const VERSION = '([^']+)'/) || [])[1];
  const list = [...(src.match(/const PRECACHE = \[([\s\S]*?)\];/) || ['', ''])[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  return { src, version, list };
}
function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

// ---------------------------------------------------------------- static checks
function staticChecks() {
  const chk = spawnSync(process.execPath, [path.join(__dirname, 'gen-precache.js'), '--check'], { encoding: 'utf8' });
  ok('gen-precache --check: sw.js list/version fresh', chk.status === 0, (chk.stdout + chk.stderr).trim());
  const { version, list } = swData();
  ok('precache has a version', !!version && version !== 'dev', version);
  ok('precache files all exist', list.every(f => fs.existsSync(path.join(ROOT, f))), list.filter(f => !fs.existsSync(path.join(ROOT, f))));
  ok('precache excludes tools/node_modules/.worktrees/.github', !list.some(f => /^(tools|node_modules|\.worktrees|\.github|\.git)\//.test(f)));
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]).filter(r => !/^(data:|https?:|#)/.test(r));
  ok('every file index.html loads is precached', refs.every(r => list.includes(r)), refs.filter(r => !list.includes(r)));
  const jsDirs = ['js', 'css'].flatMap(d => require('./gen-precache').collect().files.filter(f => f.startsWith(d + '/')));
  ok('all js/ and css/ files precached', jsDirs.every(f => list.includes(f)) && jsDirs.length > 10, jsDirs.length);

  let man = null;
  try { man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8')); } catch (e) { /* */ }
  ok('manifest parses', !!man);
  if (man) {
    ok('manifest name/short_name', man.name && /SPAN/.test(man.name) && man.short_name === 'SPAN', [man.name, man.short_name]);
    ok('manifest display + orientation', ['standalone', 'fullscreen'].includes(man.display) && man.orientation === 'any', [man.display, man.orientation]);
    ok('manifest colours match the game', man.theme_color === '#0d1424' && man.background_color === '#0b1120');
    ok('manifest categories include games', Array.isArray(man.categories) && man.categories.includes('games'));
    ok('manifest start_url/scope relative (works under a Pages subpath)', !/^\//.test(man.start_url) && !/^\//.test(man.scope));
    const need = [['any', 192], ['any', 512], ['maskable', 192], ['maskable', 512]];
    for (const [purpose, size] of need) {
      const ic = man.icons.find(i => i.purpose === purpose && i.sizes === size + 'x' + size);
      const dim = ic && fs.existsSync(path.join(ROOT, ic.src)) && pngSize(path.join(ROOT, ic.src));
      ok(`icon ${purpose} ${size} exists with correct size`, dim && dim.w === size && dim.h === size, ic && ic.src);
      ok(`icon ${purpose} ${size} is precached`, ic && list.includes(ic.src));
    }
  }
  const apple = path.join(ROOT, 'assets/icons/app/apple-touch-icon.png');
  ok('apple-touch-icon 180x180', fs.existsSync(apple) && pngSize(apple).w === 180);
  ok('index.html: manifest + iOS meta', /rel="manifest"/.test(html) && /rel="apple-touch-icon"/.test(html) && /apple-mobile-web-app-capable/.test(html) && /apple-mobile-web-app-title/.test(html));
  ok('pages workflow present', fs.existsSync(path.join(ROOT, '.github/workflows/pages.yml')));
}

// ---------------------------------------------------------------- browser helpers
const watch = (page, errors) => {
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  // the offline probe below fetches assets/nope.png on purpose: its 504 is expected
  page.on('console', m => { if (m.type() === 'error' && !/status of 504 \(Offline\)/.test(m.text())) errors.push('[console] ' + m.text()); });
};
const waitGame = (page, state) => page.waitForFunction(s => window.BG && BG.Game && BG.Game.state === s, state, { timeout: 15000 }).then(() => true, () => false);
const waitControlled = page => page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 }).then(() => true, () => false);
const cacheInfo = page => page.evaluate(async () => {
  const keys = (await caches.keys()).filter(k => k.startsWith('span-precache-'));
  const out = {};
  for (const k of keys) out[k] = (await (await caches.open(k)).keys()).length;
  return out;
});

async function deviceRun(browser, base, devName, opts) {
  const d = devices[devName];
  const ctx = await browser.newContext({ ...d, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  watch(page, errors);
  const tag = devName;
  await page.goto(base + 'index.html');
  ok(`[${tag}] game reaches title online`, await waitGame(page, 'title'));
  const reg = await page.evaluate(() => BG.PWA && BG.PWA.ready && BG.PWA.ready.then(r => !!r));
  ok(`[${tag}] service worker registered`, reg === true);
  ok(`[${tag}] page becomes SW-controlled (clients.claim)`, await waitControlled(page));
  const { version, list } = swData();
  const ci = await cacheInfo(page);
  ok(`[${tag}] precache complete (${list.length} files)`, ci['span-precache-' + version] === list.length, ci);
  const v = await page.evaluate(() => BG.PWA.getVersion());
  ok(`[${tag}] worker reports version`, v && v.version === version, v);

  if (opts.toastCheck) {
    const t = await page.waitForFunction(() => /ready to play offline/.test((document.getElementById('toasts') || {}).textContent || ''), null, { timeout: 5000 }).then(() => true, () => false);
    ok(`[${tag}] "ready to play offline" toast on first install`, t);
  }

  // ---- offline
  await ctx.setOffline(true);
  await page.reload();
  ok(`[${tag}] OFFLINE reload reaches title`, await waitGame(page, 'title'));
  const off = await page.evaluate(async () => {
    const title = document.getElementById('screen-title');
    const r = title && title.getBoundingClientRect();
    const car = await fetch('assets/sprites/car.svg').then(r => r.ok, () => false);
    const missing = await fetch('assets/nope.png').then(r => r.status, () => 'threw');
    return { online: navigator.onLine, titleVisible: !!(r && r.width > 0), car, missing, levels: (BG.Levels || []).length, css: getComputedStyle(document.body).backgroundColor };
  });
  ok(`[${tag}] offline: title visible, sprites served from cache`, off.titleVisible && off.car && off.levels >= 50 && off.online === false, off);
  ok(`[${tag}] offline: uncached file -> 504, not a crash`, off.missing === 504, off.missing);
  await page.goto(base + 'index.html?level=3');
  ok(`[${tag}] OFFLINE deep link ?level=3 opens the editor`, await waitGame(page, 'edit'));
  const bgOk = await page.waitForFunction(() => [...document.images].length >= 0 && BG.Game.renderer, null, { timeout: 3000 }).then(() => true, () => false);
  ok(`[${tag}] offline level renders`, bgOk);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, tag.replace(/\W+/g, '_') + '-offline-level3.png') });
  await ctx.setOffline(false);

  if (opts.updateFlow) {
    // ---- update flow: serve a changed sw.js, ask for an update, tap the toast
    await page.goto(base + 'index.html');
    await waitGame(page, 'title');
    await waitControlled(page);
    opts.setSwVersion('test-v2');
    await page.evaluate(() => BG.PWA.checkForUpdate());
    const shown = await page.waitForSelector('.pwa-update.in', { timeout: 15000 }).then(() => true, () => false);
    ok(`[${tag}] update toast appears when a new version is waiting`, shown);
    if (shown) {
      const box = await page.locator('.pwa-update').boundingBox();
      const vp = page.viewportSize();
      ok(`[${tag}] update toast fits the screen`, box && box.x >= 0 && box.x + box.width <= vp.width + 0.5, { box, vp });
      ok(`[${tag}] update toast text`, /New version available/.test(await page.locator('.pwa-update').textContent()));
      await page.screenshot({ path: path.join(OUT, tag.replace(/\W+/g, '_') + '-update-toast.png') });
      const nav = page.waitForEvent('framenavigated', { timeout: 15000 }).then(() => true, () => false);
      await page.locator('.pwa-update').tap();
      ok(`[${tag}] tapping the toast reloads the page`, await nav);
      await waitGame(page, 'title');
      await waitControlled(page);
      const v2 = await page.evaluate(() => BG.PWA.getVersion());
      ok(`[${tag}] new worker in control after reload`, v2 && v2.version === 'test-v2', v2);
      const ci2 = await cacheInfo(page);
      ok(`[${tag}] old cache deleted on activate`, Object.keys(ci2).length === 1 && ci2['span-precache-test-v2'] === list.length, ci2);
      ok(`[${tag}] no update toast after reload`, (await page.$('.pwa-update.in')) === null);
    }
    opts.setSwVersion(null);
  }

  if (opts.installPrompt) {
    await page.evaluate(() => {
      const e = new Event('beforeinstallprompt', { cancelable: true });
      e.prompt = () => { window.__prompted = (window.__prompted || 0) + 1; return Promise.resolve(); };
      e.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
      window.dispatchEvent(e);
      window.__bipDefault = e.defaultPrevented;
      BG.Hud.openSettings();
    });
    await page.waitForTimeout(350);
    const row = page.locator('#settings [data-pwa=install]');
    ok(`[${tag}] beforeinstallprompt deferred (preventDefault)`, await page.evaluate(() => window.__bipDefault === true));
    ok(`[${tag}] Install button shown in Settings`, await row.isVisible());
    ok(`[${tag}] offline-ready row shown in Settings`, await page.locator('#settings [data-pwa=offline]').isVisible());
    await page.screenshot({ path: path.join(OUT, tag.replace(/\W+/g, '_') + '-settings-install.png') });
    await page.locator('#settings [data-pwa-act=install]').tap();
    await page.waitForTimeout(150);
    ok(`[${tag}] Install button calls prompt() and hides`, await page.evaluate(() => window.__prompted === 1) && !(await row.isVisible()));
    ok(`[${tag}] settings still open after install tap`, await page.evaluate(() => BG.Hud.settingsOpen()));
  }

  if (opts.iosHint !== undefined) {
    await page.evaluate(() => BG.Hud.openSettings());
    await page.waitForTimeout(350);
    const vis = await page.locator('#settings [data-pwa=ios]').isVisible();
    ok(`[${tag}] iOS "Add to Home Screen" hint ${opts.iosHint ? 'shown' : 'hidden'}`, vis === opts.iosHint);
    if (opts.iosHint) {
      const box = await page.locator('#settings [data-pwa=ios]').boundingBox();
      ok(`[${tag}] iOS hint fits the screen`, box && box.x >= 0 && box.x + box.width <= page.viewportSize().width + 0.5, box);
      await page.screenshot({ path: path.join(OUT, tag.replace(/\W+/g, '_') + '-settings-ios.png') });
    }
    ok(`[${tag}] no Install button without beforeinstallprompt`, !(await page.locator('#settings [data-pwa=install]').isVisible()));
  }

  ok(`[${tag}] no page errors`, errors.length === 0, errors.slice(0, 8));
  await ctx.close();
}

async function fileRun(browser) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push('[' + m.type() + '] ' + m.text()); });
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  await page.goto(url.pathToFileURL(path.join(ROOT, 'index.html')).href);
  ok('[file://] game reaches title', await waitGame(page, 'title'));
  await page.waitForTimeout(500);
  const st = await page.evaluate(async () => ({ supported: BG.PWA.supported, reg: await BG.PWA.ready, rows: !!document.querySelector('#settings .pwa-rows'), offlineRow: !document.querySelector('#settings [data-pwa=offline]').hidden }));
  ok('[file://] PWA disabled, no registration', st.supported === false && st.reg === null, st);
  ok('[file://] settings rows mounted but offline row hidden', st.rows && !st.offlineRow, st);
  ok('[file://] no console errors/warnings', errors.length === 0, errors.slice(0, 8));
  await ctx.close();
}

(async () => {
  staticChecks();
  let swVersion = null;
  const srv = await serve({
    port: 0,
    transform: (rel, buf) => (rel === 'sw.js' && swVersion) ? Buffer.from(buf.toString('utf8').replace(/const VERSION = '[^']+'/, "const VERSION = '" + swVersion + "'")) : null,
  });
  const base = srv.url;
  const browser = await require('./browser').launch(chromium);
  try {
    await deviceRun(browser, base, 'Pixel 7', { toastCheck: true, updateFlow: true, installPrompt: true, iosHint: false, setSwVersion: v => { swVersion = v; } });
    await deviceRun(browser, base, 'Pixel 7 landscape', {});
    await deviceRun(browser, base, 'iPhone 14', { iosHint: true });
    await deviceRun(browser, base, 'iPhone 14 landscape', { iosHint: true });
    await deviceRun(browser, base, 'iPad (gen 7) landscape', { iosHint: true });
    await fileRun(browser);
  } catch (e) {
    ok('test run threw', false, e && e.stack);
  } finally {
    await browser.close();
    await srv.close();
  }
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed` + (failed.length ? ' - FAILED: ' + failed.map(f => f.name).join('; ') : '') + `\nscreenshots: ${OUT}`);
  process.exit(failed.length ? 1 : 0);
})();
