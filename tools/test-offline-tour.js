// pwa: offline guarantee. Headless only - never opens a visible window.
// Usage: node tools/test-offline-tour.js [outDir=%TEMP%/span-offline] [--no-shots] [--drop=<file>,...]
// Serves the repo with tools/serve.js, loads the game ONCE online and waits until the service worker has
// precached every file, then switches the browser context offline (context.setOffline) and reloads.
// Offline, it tours every screen and campaign on desktop (1440x900) and a phone (844x390, touch):
//   title, level select (every campaign tab, every famous art tile force-loaded), road level 1 (sim run ->
//   results modal with the badge reveal), bonus 52 (quake banner + dust FX), Iron Road 106 and 120 (sim
//   run, steam smoke, track strip), Famous 208 + 209 (history card + SVG art, sim run), daily challenge
//   (generated offline), endless, history (every tab), settings (install row + save export download).
// Every request is recorded. The tour FAILS on:
//   - a page request that was not answered by the service worker (or that failed)
//   - a network fetch the worker made for anything but the network-first index.html probe
//     (that would mean a cache miss -> the file is missing from the precache)
//   - any console error / page error, any <img> that finished loading with naturalWidth 0,
//     any sprite the renderer failed to load
// Also: the precache total size is reported (README quotes it), and the update path is checked
// (a changed sw.js installs, the toast appears, tapping it activates the new cache, old cache deleted).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { serve } = require('./serve');
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const OUT = args.find(a => !a.startsWith('--')) || path.join(require('os').tmpdir(), 'span-offline');
const SHOTS = !args.includes('--no-shots');
// --drop=<file>[,<file>]  self-check of the detector: serve a sw.js whose precache omits these files.
//                          The tour must then FAIL (e.g. --drop=assets/sprites/rail/tender.svg).
const DROP = ((args.find(a => a.startsWith('--drop=')) || '').slice(7)).split(',').filter(Boolean);
fs.mkdirSync(OUT, { recursive: true });
const sol = n => JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'solutions', 'level-' + String(n).padStart(2, '0') + '.json'), 'utf8'));

const results = [];
const ok = (name, cond, info) => { results.push({ name, pass: !!cond, info }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };

function swData() {
  const src = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const version = (src.match(/const VERSION = '([^']+)'/) || [])[1];
  const list = [...(src.match(/const PRECACHE = \[([\s\S]*?)\];/) || ['', ''])[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  return { version, list: list.filter(f => !DROP.includes(f)) };
}

// ---------------------------------------------------------------- static: every asset URL the code can build is precached
function staticChecks() {
  const { list } = swData();
  const has = f => list.includes(f);
  const src = ['index.html', ...list.filter(f => /\.(js|css)$/.test(f))].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  // literal asset paths (famous art in levels.js, icons in css/js)
  const lits = [...new Set([...src.matchAll(/(assets\/[\w\-\/]+\.(?:svg|png|jpg|jpeg|webp|gif|json|woff2?|mp3|ogg|wav))/g)].map(m => m[1]))];
  const miss = lits.filter(f => !has(f));
  ok('static: every literal assets/ path in the code is precached (' + lits.length + ')', miss.length === 0, miss.length ? miss : undefined);
  // dynamically built URLs: backgrounds (assets/bg/<theme>.jpg) and badges (goals icons); sprites are checked in the tour
  const themes = [...new Set([...src.matchAll(/"theme":"(\w+)"/g)].map(m => m[1]))];
  const gen = fs.readFileSync(path.join(ROOT, 'js/core/generator.js'), 'utf8').match(/THEMES\s*=\s*\[([^\]]*)\]/);
  if (gen) for (const m of gen[1].matchAll(/'(\w+)'/g)) if (!themes.includes(m[1])) themes.push(m[1]);
  const bgMiss = themes.filter(t => !has('assets/bg/' + t + '.jpg'));
  ok('static: a precached background for every theme (' + themes.length + ')', themes.length >= 8 && bgMiss.length === 0, bgMiss.length ? bgMiss : undefined);
  const icons = [...new Set([...fs.readFileSync(path.join(ROOT, 'js/features/goals.js'), 'utf8').matchAll(/icon\s*:\s*'(\w+)'/g)].map(m => m[1]))];
  // the README quotes the precache size: keep it honest (within 15 %)
  const bytes = require('./gen-precache').collect().bytes;
  const quoted = +((fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').match(/precaches every game file \(about ([\d.]+) MB/) || [])[1]);
  ok('static: README precache size matches (' + (bytes / 1048576).toFixed(2) + ' MB, README says ' + quoted + ' MB)', quoted > 0 && Math.abs(quoted * 1048576 - bytes) / bytes < 0.15);
  const iconMiss = icons.filter(i => !has('assets/icons/badges/' + i + '.svg'));
  ok('static: every badge icon precached (' + icons.length + ')', icons.length > 0 && iconMiss.length === 0, iconMiss.length ? iconMiss : undefined);
}

const DEVICES = [
  { name: 'desktop', ctx: { viewport: { width: 1440, height: 900 } } },
  { name: 'phone', ctx: { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36' } },
];

async function tour(browser, base, dev, setSwVersion) {
  const tag = '[' + dev.name + '] ';
  const ctx = await browser.newContext({ ...dev.ctx, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message + ' ' + String(e.stack || '').split(/\n/).slice(1, 3).join(' ').trim()));
  page.on('console', m => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
  const shot = async n => { if (SHOTS) await page.screenshot({ path: path.join(OUT, dev.name + '-' + n + '.png') }); };
  const wait = ms => page.waitForTimeout(ms);
  const waitFor = async (fn, arg, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 15000)) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await wait(120); } return false; };
  const waitGame = s => waitFor(st => window.BG && BG.Game && BG.Game.state === st, s, 20000);
  const quiet = () => page.evaluate(() => { try { BG.Hud.hideHint(); } catch (e) { /* */ } if (BG.Mobile && BG.Mobile.rotatePromptVisible && BG.Mobile.rotatePromptVisible()) { const b = document.querySelector('[data-mact=rotateOk]'); if (b) b.click(); } });
  const open = async id => { await page.evaluate(i => BG.Game.openLevel(i, { force: true, skipCard: true }), id); await waitFor(i => BG.Game.state === 'edit' && BG.Game.level && BG.Game.level.id === i, id); await wait(500); await quiet(); };
  const startWith = d => page.evaluate(d => { if (d) BG.Game._replaceDesign(BG.Model.clone(d)); BG.Game._lastToggle = -1e9; BG.Game.startSim(); }, d || null);
  const runSim = maxSec => page.evaluate(maxSec => {
    const g = BG.Game; let t = 0;
    while (g.state === 'sim' && t < maxSec) { g._updateSim(1 / 6); t += 1 / 6; }
    const r = g.lastResult;
    return { state: g.state, res: r && { passed: r.passed, stars: r.stars, reason: r.reason } };
  }, maxSec);
  const brokenImages = () => page.evaluate(() => [...document.images]
    .filter(i => i.getAttribute('src') && i.complete && i.naturalWidth === 0)
    .map(i => i.getAttribute('src')));
  const imgCheck = async label => { const b = await brokenImages(); ok(tag + 'offline: no missing images (' + label + ')', b.length === 0, b.length ? b : undefined); };

  // ---------------------------------------------------------------- online: install + precache
  await page.goto(base + 'index.html?unlockall');
  ok(tag + 'online: game reaches title', await waitGame('title'));
  ok(tag + 'online: page is SW-controlled', await waitFor(() => !!navigator.serviceWorker.controller, null, 20000));
  const { version, list } = swData();
  const precached = await waitFor(([v, n]) => caches.open('span-precache-' + v).then(c => c.keys()).then(k => k.length === n), [version, list.length], 20000);
  ok(tag + `online: precache complete (${list.length} files, version ${version})`, precached);
  const size = await page.evaluate(async v => {
    const c = await caches.open('span-precache-' + v); let bytes = 0;
    for (const r of await c.keys()) bytes += (await (await c.match(r)).arrayBuffer()).byteLength;
    return bytes;
  }, version);
  ok(tag + 'precache size reported: ' + (size / 1048576).toFixed(2) + ' MB', size > 100000, size);

  // ---------------------------------------------------------------- offline: record every request
  const reqs = []; // { url, sw, ok, why }
  const viaWorker = []; // network fetches made by the service worker itself
  let recording = false;
  const short = u => u.replace(base, '');
  ctx.on('requestfinished', async req => {
    if (!recording) return;
    const u = req.url();
    if (/^(data|blob):/.test(u)) return;
    if (req.serviceWorker()) { viaWorker.push({ url: short(u), ok: true }); return; }
    const res = await req.response().catch(() => null);
    reqs.push({ url: short(u), sw: !!(res && res.fromServiceWorker()), status: res && res.status() });
  });
  ctx.on('requestfailed', req => {
    if (!recording) return;
    const u = req.url();
    if (/^(data|blob):/.test(u)) return;
    if (req.serviceWorker()) { viaWorker.push({ url: short(u), ok: false, why: (req.failure() || {}).errorText }); return; }
    // a download (save export) is a blob: URL and never reaches here; anything else that fails is a bug
    reqs.push({ url: short(u), sw: false, failed: (req.failure() || {}).errorText });
  });

  await ctx.setOffline(true);
  recording = true;
  await page.reload();
  ok(tag + 'OFFLINE reload reaches title', await waitGame('title'));
  await wait(1200);
  ok(tag + 'offline: navigator.onLine is false', await page.evaluate(() => navigator.onLine === false));
  await imgCheck('title'); await shot('01-title');

  // ---- level select, every campaign tab
  await page.evaluate(() => BG.Game.goLevelSelect()); await waitGame('levelSelect'); await wait(500);
  const tabs = await page.evaluate(() => [...document.querySelectorAll('#screen-levels .camp-tab')].map(t => t.dataset.camp));
  ok(tag + 'level select: campaign tabs present', tabs.length >= 3, tabs);
  for (const camp of tabs) {
    await page.evaluate(c => BG.Hud.setCampaignTab(c), camp); await wait(450);
    ok(tag + 'level select tab ' + camp, await page.evaluate(c => BG.Hud.tab === c, camp));
    if (camp === 'famous') {
      // tiles lazy-load their art: force every one so all 12 SVGs are proven to come from the cache
      await page.evaluate(() => document.querySelectorAll('.fb-tile img').forEach(i => { i.loading = 'eager'; i.src = i.getAttribute('src'); }));
      const loaded = await waitFor(() => { const im = [...document.querySelectorAll('.fb-tile img')]; return im.length >= 12 && im.every(i => i.complete); }, null, 8000);
      const arts = await page.evaluate(() => [...document.querySelectorAll('.fb-tile img')].map(i => i.naturalWidth > 0));
      ok(tag + 'famous tiles: all art loaded offline', loaded && arts.length >= 12 && arts.every(Boolean), { n: arts.length, bad: arts.filter(a => !a).length });
    }
    await imgCheck('levels ' + camp); await shot('02-levels-' + camp);
  }

  // ---- road level 1: sim run -> results modal with badges
  await open(1);
  await imgCheck('level 1 edit'); await shot('03-level1-edit');
  await startWith(sol(1)); await wait(900);
  let rr = await runSim(60); await wait(3400);
  ok(tag + 'level 1: run passes -> results', rr.state === 'results' && rr.res && rr.res.passed, rr);
  const rb = await page.evaluate(() => { const b = document.querySelector('.res-badges'); return { show: !!b && !b.hidden && b.classList.contains('show'), n: document.querySelectorAll('.res-badges .rb').length }; });
  ok(tag + 'results modal shows badges', rb.show && rb.n >= 1, rb);
  await imgCheck('results + badges'); await shot('04-results-badges');

  // ---- bonus 52: quake
  await open(52);
  await startWith(sol(52)); await wait(300);
  const q0 = await page.evaluate(() => { const pl = BG.ForcesFx.plan(BG.Game.level); return pl && pl.quakes && pl.quakes.length ? pl.quakes[0].start : null; });
  ok(tag + 'bonus 52 has a quake', q0 !== null, q0);
  await page.evaluate(t0 => { const g = BG.Game; for (let t = 0; t < t0 + 0.6 && g.state === 'sim'; t += 1 / 30) g._updateSim(1 / 30); }, q0 || 3);
  await wait(700);
  const qf = await page.evaluate(() => ({ banner: (document.querySelector('.fx-banner.show') || {}).textContent || '', dust: BG.Game.renderer.effects.particles.length }));
  ok(tag + 'bonus 52: quake banner + dust FX offline', /shak|quake/i.test(qf.banner) && qf.dust > 0, qf);
  await imgCheck('bonus 52 quake'); await shot('05-bonus52-quake');
  rr = await runSim(90); await wait(1200);
  ok(tag + 'bonus 52: run finishes', rr.state === 'results', rr);

  // ---- Iron Road 106 + 120: sim run, smoke, track strip
  for (const id of [106, 120]) {
    await open(id);
    await startWith(sol(id));
    await page.evaluate(() => { const g = BG.Game; for (let t = 0; t < 2 && g.state === 'sim'; t += 1 / 6) g._updateSim(1 / 6); });
    await wait(400);
    const strip = await page.evaluate(() => { const t = document.querySelector('[data-ref=track]'); return !!t && t.classList.contains('show'); });
    ok(tag + `rail ${id}: track strip shows`, strip);
    await imgCheck('rail ' + id); await shot('06-rail' + id + '-sim');
    // smoke / steam / diesel exhaust is spawned by the renderer: advance the run 1 s at a time and let frames draw
    let smoke = false;
    for (let i = 0; i < 160 && !smoke; i++) {
      smoke = await page.evaluate(() => BG.Game.renderer.effects.particles.some(p => p.kind === 'soft'));
      if (smoke || !(await page.evaluate(() => { const g = BG.Game; for (let t = 0; t < 0.75 && g.state === 'sim'; t += 1 / 30) g._updateSim(1 / 30); return g.state === 'sim'; }))) break;
      await wait(90);
    }
    ok(tag + `rail ${id}: smoke / steam / exhaust particles in the run`, smoke);
    if (smoke) await shot('06-rail' + id + '-smoke');
    rr = await runSim(120); await wait(1500);
    ok(tag + `rail ${id}: run passes`, rr.state === 'results' && rr.res && rr.res.passed, rr);
  }

  // ---- Famous 208 + 209: history card with the SVG art, then a run
  for (const id of [208, 209]) {
    await page.evaluate(i => BG.Famous.showCard(BG.Levels.find(l => l.id === i), { mode: 'info' }), id);
    await wait(500);
    const art = await waitFor(() => { const i = document.querySelector('.fb-art-fg'); return i && i.complete && i.naturalWidth > 0; }, null, 6000);
    const card = await page.evaluate(() => ({ open: BG.Famous.card.open, src: (document.querySelector('.fb-art-fg') || {}).getAttribute && document.querySelector('.fb-art-fg').getAttribute('src'), facts: document.querySelectorAll('.fb-overlay li').length }));
    ok(tag + `famous ${id}: history card with art`, card.open && art, card);
    await imgCheck('famous card ' + id); await shot('07-famous' + id + '-card');
    await page.evaluate(() => { const b = document.querySelector('.fb-actions [data-fb=close]') || document.querySelector('.fb-actions button'); if (b) b.click(); });
    await wait(400);
    await open(id);
    await startWith(sol(id)); await wait(600);
    await imgCheck('famous ' + id + ' sim'); await shot('08-famous' + id + '-sim');
    rr = await runSim(120); await wait(1200);
    ok(tag + `famous ${id}: run finishes`, rr.state === 'results', rr);
  }

  // ---- daily (the generator runs offline) + endless
  await page.evaluate(() => { BG.Game.goTitle(); BG.Daily.openPanel(); });
  ok(tag + 'daily: crossing generated offline', await waitFor(() => { const n = document.querySelector('[data-dref=name]'); return n && n.textContent && n.textContent !== 'Surveying…'; }, null, 30000));
  await wait(300); await imgCheck('daily panel'); await shot('09-daily-panel');
  await page.evaluate(() => document.querySelector('#daily-panel [data-dly=play]').click());
  ok(tag + 'daily: crossing opens', await waitFor(() => BG.Game.state === 'edit' && /^daily-/.test(BG.Game.level.id), null, 30000));
  await wait(400); await quiet();
  await page.evaluate(() => BG.Game._replaceDesign(BG.Model.clone(BG.Game.level.generator.solution.design)));
  await startWith(); rr = await runSim(120); await wait(1800);
  ok(tag + 'daily: run passes, share card', rr.res && rr.res.passed && await page.evaluate(() => /SPAN Daily/.test((document.querySelector('.dly-share-text') || {}).textContent || '')), rr);
  await imgCheck('daily results'); await shot('10-daily-results');
  await page.evaluate(() => BG.Daily.startEndless(true));
  ok(tag + 'endless: crossing opens', await waitFor(() => BG.Game.state === 'edit' && /^endless-/.test(BG.Game.level.id), null, 30000));
  await wait(400); await quiet();
  await page.evaluate(() => BG.Game._replaceDesign(BG.Model.clone(BG.Game.level.generator.solution.design)));
  await startWith(); rr = await runSim(120); await wait(1600);
  ok(tag + 'endless: run passes', rr.res && rr.res.passed, rr);
  await imgCheck('endless results'); await shot('11-endless-results');

  // ---- history
  await page.evaluate(() => { BG.Game.goLevelSelect(); BG.History.open(); }); await wait(500);
  ok(tag + 'history opens', await page.evaluate(() => BG.History.isOpen()));
  for (const t of ['runs', 'levels', 'stats']) {
    await page.evaluate(t => { const b = document.querySelector('#history [data-htab=' + t + ']'); if (b) b.click(); }, t); await wait(250);
    await imgCheck('history ' + t); await shot('12-history-' + t);
  }
  await page.evaluate(() => BG.History.close()); await wait(300);

  // ---- settings: install row + save export
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = () => Promise.resolve(); e.userChoice = Promise.resolve({ outcome: 'dismissed', platform: 'web' });
    window.dispatchEvent(e); BG.Hud.openSettings();
  });
  await wait(450);
  const set = await page.evaluate(() => ({ install: !document.querySelector('#settings [data-pwa=install]').hidden, offline: !document.querySelector('#settings [data-pwa=offline]').hidden, save: !!document.querySelector('#settings [data-hsave=export]') }));
  ok(tag + 'settings: install + offline-ready + save rows', set.install && set.offline && set.save, set);
  const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await page.evaluate(() => { const b = document.querySelector('#settings [data-hsave=export]'); b.scrollIntoView(); b.click(); });
  const d = await dl;
  let saved = null;
  if (d) { const p = path.join(OUT, dev.name + '-' + d.suggestedFilename()); await d.saveAs(p).catch(() => {}); try { saved = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { /* */ } }
  ok(tag + 'settings: save export downloads valid JSON offline', !!(d && saved && typeof saved === 'object'), d && d.suggestedFilename());
  await imgCheck('settings'); await shot('13-settings');
  await page.evaluate(() => BG.Hud.closeSettings ? BG.Hud.closeSettings() : document.querySelector('#settings .modal-foot [data-act=close]').click());
  await wait(300);
  ok(tag + 'renderer sprites all loaded', await page.evaluate(() => Object.keys(BG.Sprites.failed).length === 0 && BG.Sprites.names.every(n => BG.Sprites.ok[n])), await page.evaluate(() => Object.keys(BG.Sprites.failed)));

  // ---------------------------------------------------------------- verdict on the recorded traffic
  recording = false;
  await wait(200);
  const notSW = reqs.filter(r => !r.sw || r.failed || (r.status && r.status >= 400));
  ok(tag + `offline: every request served by the service worker (${reqs.length} requests)`, reqs.length > 20 && notSW.length === 0, notSW.slice(0, 12));
  // the worker probes the network only for the page itself (network-first index.html); any other
  // network fetch from the worker is a precache miss
  const misses = viaWorker.filter(r => !/^(index\.html)?(\?.*)?$/.test(r.url));
  ok(tag + 'offline: no precache misses (worker went to the network only for index.html)', misses.length === 0, misses.slice(0, 12));
  const urls = new Set(reqs.map(r => r.url.replace(/\?.*$/, '')));
  ok(tag + 'offline: tour touched sprites, backgrounds, famous art and badges', ['assets/sprites/', 'assets/bg/', 'assets/famous/', 'assets/icons/badges/', 'assets/sprites/rail/'].every(p => [...urls].some(u => u.startsWith(p))), [...urls].filter(u => u.startsWith('assets/')).length);
  ok(tag + 'offline: no console / page errors', errors.length === 0, errors.slice(0, 10));

  // ---------------------------------------------------------------- update path (desktop only)
  if (setSwVersion) {
    await ctx.setOffline(false);
    await page.goto(base + 'index.html');
    await waitGame('title');
    setSwVersion('offline-tour-v2');
    // Chrome may hold this update job for up to a minute (seen on a busy machine: the request for the new sw.js
    // only goes out after ~60 s), so the wait is generous; the check is that the toast comes, not how fast
    await page.evaluate(() => { BG.PWA.checkForUpdate(); });
    const shown = await page.waitForSelector('.pwa-update.in', { timeout: 120000 }).then(() => true, () => false);
    ok(tag + 'update: toast appears for a new worker', shown);
    if (shown) {
      const nav = page.waitForEvent('framenavigated', { timeout: 15000 }).then(() => true, () => false);
      await page.locator('.pwa-update').click();
      ok(tag + 'update: tapping the toast reloads', await nav);
      await waitGame('title');
      await waitFor(() => !!navigator.serviceWorker.controller, null, 15000);
      const v2 = await page.evaluate(() => BG.PWA.getVersion());
      ok(tag + 'update: new worker in control', v2 && v2.version === 'offline-tour-v2', v2);
      const keys = await page.evaluate(async () => { const out = {}; for (const k of (await caches.keys()).filter(k => k.startsWith('span-precache-'))) out[k] = (await (await caches.open(k)).keys()).length; return out; });
      ok(tag + 'update: old cache deleted, new cache complete', Object.keys(keys).length === 1 && keys['span-precache-offline-tour-v2'] === list.length, keys);
      // and the updated install still plays offline
      await ctx.setOffline(true);
      await page.reload();
      ok(tag + 'update: offline reload after the update reaches title', await waitGame('title'));
      await ctx.setOffline(false);
    }
    setSwVersion(null);
  }
  await ctx.close();
  return size;
}

(async () => {
  staticChecks();
  let swVersion = null;
  const srv = await serve({
    port: 0,
    transform: (rel, buf) => {
      if (rel !== 'sw.js' || (!swVersion && !DROP.length)) return null;
      let s = buf.toString('utf8');
      if (swVersion) s = s.replace(/const VERSION = '[^']+'/, "const VERSION = '" + swVersion + "'");
      s = s.split(/\r?\n/).filter(line => !DROP.some(f => line === "  '" + f + "',")).join('\n');
      return Buffer.from(s);
    },
  });
  const browser = await require('./browser').launch(chromium);
  let size = 0;
  try {
    for (const dev of DEVICES) size = await tour(browser, srv.url, dev, dev.name === 'desktop' ? v => { swVersion = v; } : null) || size;
  } catch (e) {
    ok('test run threw', false, e && e.stack);
  } finally {
    await browser.close();
    await srv.close();
  }
  const failed = results.filter(r => !r.pass);
  console.log(`\nprecache: ${swData().list.length} files, ${(size / 1048576).toFixed(2)} MB`);
  console.log(`${results.length - failed.length}/${results.length} passed` + (failed.length ? ' - FAILED: ' + failed.map(f => f.name).join('; ') : '') + (SHOTS ? `\nscreenshots: ${OUT}` : ''));
  process.exit(failed.length ? 1 : 0);
})();
