// Headless browser check for the Forces of Nature feature (levels 51-53). Never opens a visible window.
// Usage: node tools/e2e-events.js [outDir=%TEMP%/span-e2e-events]
// Checks: hidden bonus chapter (hidden on a fresh profile, shown when unlocked), forecast chip, warning banner
// before an event, live banner + timeline during it, quake camera rumble, wind / quake overlay drawing, the
// reference designs passing in the real game, frame cost, and no console errors.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const url = require('url');
const ROOT = path.resolve(__dirname, '..');
const OUT = process.argv[2] || path.join(require('os').tmpdir(), 'span-e2e-events');
fs.mkdirSync(OUT, { recursive: true });
const sol = (n, best) => JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'solutions', 'level-' + n + (best ? '-best' : '') + '.json'), 'utf8'));
const results = [];
const ok = (name, cond, info) => { results.push({ name, pass: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  const shot = async name => { await page.screenshot({ path: path.join(OUT, name + '.png') }); };
  const home = url.pathToFileURL(path.join(ROOT, 'index.html')).href;

  // ---- fresh profile: the bonus chapter is hidden
  await page.goto(home + '?screen=levels');
  await page.waitForTimeout(1200);
  const fresh = await page.evaluate(() => ({ chapters: Array.from(document.querySelectorAll('.chapter h3')).map(h => h.textContent), tiles: document.querySelectorAll('.tile').length, forces: !!BG.Forces, fx: !!BG.ForcesFx }));
  ok('modules loaded', fresh.forces && fresh.fx);
  ok('bonus chapter hidden on a fresh profile', fresh.chapters.length === 6 && fresh.tiles === 50, fresh);
  // merge (goals / Iron Road): unrevealed bonus levels stay out of the star and badge totals
  const t0 = await page.evaluate(() => { const totals = () => ({ stars: document.querySelector('[data-ref=lsStars]').textContent.trim(), badges: (document.querySelector('.ls-right .badge-chip') || {}).textContent || null }); return Object.assign(totals(), { gd: Object.keys(BG.GoalsData || {}).length, all: Object.values(BG.GoalsData || {}).reduce((a, g) => a + g.length, 0) }); });
  ok('hidden bonus levels not counted in road stars / badge totals', t0.stars.endsWith('/ 150') && !!t0.badges && !t0.badges.endsWith('/ ' + t0.all), t0);
  // completing level 50 reveals it (the chapter finales before it are gates, so they are complete too)
  const after = await page.evaluate(() => { [5, 10, 20, 30, 40, 50].forEach(id => BG.Storage.recordResult(id, { passed: true, stars: 1, cost: 1 })); BG.Hud.buildLevelSelect(); return { chapters: Array.from(document.querySelectorAll('.chapter h3')).map(h => h.textContent), open51: !!document.querySelector('.tile.open[data-id="51"]'), open53: !!document.querySelector('.tile.open[data-id="53"]') }; });
  ok('Forces of Nature chapter appears after level 50', after.chapters.length === 7 && after.chapters[6] === 'Forces of Nature' && after.open51 && !after.open53, after);
  const t1 = await page.evaluate(() => { const totals = () => ({ stars: document.querySelector('[data-ref=lsStars]').textContent.trim(), badges: (document.querySelector('.ls-right .badge-chip') || {}).textContent || null }); return totals(); });
  ok('revealed bonus levels count in the totals', t1.stars.endsWith('/ 159') && (t1.badges || '').endsWith('/ ' + t0.all), Object.assign({ allGoals: t0.all }, t1));
  await page.waitForTimeout(700);
  await shot('01-levelselect-bonus');
  // the Iron Road tab never shows the bonus chapter
  const railTab = await page.evaluate(() => { BG.Storage.recordResult(10, { passed: true, stars: 1, cost: 1 }); BG.Hud.setCampaignTab('rail'); BG.Hud.buildLevelSelect(); const r = { tab: BG.Hud.tab, chapters: Array.from(document.querySelectorAll('.chapter h3')).map(h => h.textContent), tiles: document.querySelectorAll('.tile').length }; BG.Hud.setCampaignTab('road'); return r; });
  ok('Iron Road tab: 4 rail chapters, no bonus chapter', railTab.tab === 'rail' && railTab.chapters.length === 4 && railTab.tiles === 20 && !railTab.chapters.includes('Forces of Nature'), railTab);
  await page.evaluate(() => { BG.Storage.resetProgress(); });

  // ---- each level: edit view, warning, live event, run to completion with the reference design
  const plan = { 51: { warnT: 3, liveT: 11, type: 'wind' }, 52: { warnT: 6, liveT: 11.5, type: 'quake' }, 53: { warnT: 2, liveT: 16, type: 'wind' } };
  for (const id of [51, 52, 53]) {
    const P = plan[id];
    await page.evaluate((id) => { BG.Game.openLevel(id, { force: true }); BG.Hud.hideHint && BG.Hud.hideHint(); }, id);
    await page.waitForTimeout(500);
    const ed = await page.evaluate(() => { const f = document.querySelector('.fx-forecast'); const tl = document.querySelector('.fx-timeline'); return { fc: f && !f.hidden ? f.textContent : null, segs: document.querySelectorAll('.fx-timeline .fx-seg').length, tlHidden: !tl || tl.hidden }; });
    ok(id + ': forecast chip + timeline segments in edit mode', ed.fc && /Forecast/.test(ed.fc) && ed.segs >= 1, ed);
    await shot(id + '-1-edit');
    // load the reference design and test it
    await page.evaluate((d) => { const g = BG.Game; g.editor.design = d; g._lastToggle = -1e9; g.startSim(); }, sol(id));
    const warn = await page.evaluate((T) => { const g = BG.Game; while (g.state === 'sim' && g.sim.time < T) g._updateSim(1 / 30); return new Promise(r => setTimeout(() => { const b = document.querySelector('.fx-banner'); r({ show: b.classList.contains('show'), cls: b.className, text: b.textContent }); }, 250)); }, P.warnT);
    ok(id + ': warning banner before the event', warn.show && /incoming in \d s/.test(warn.text) && /fx-warn/.test(warn.cls), warn);
    await shot(id + '-2-warning');
    const live = await page.evaluate((T) => { const g = BG.Game; g.paused = false; while (g.state === 'sim' && g.sim.time < T) g._updateSim(1 / 30); return new Promise(r => setTimeout(() => { const b = document.querySelector('.fx-banner'); const F = g.sim.forces; r({ show: b.classList.contains('show'), cls: b.className, text: b.textContent, wind: F.wind.v, quake: F.quake.intensity, trauma: g.renderer.effects ? g.renderer.effects.trauma : null, now: document.querySelector('.fx-now').style.left, fxs: !!g.renderer._fxs }); }, 400)); }, P.liveT);
    ok(id + ': live banner during the event', live.show && /fx-live/.test(live.cls) && new RegExp('fx-' + P.type).test(live.cls), live);
    ok(id + ': timeline cursor moves', parseFloat(live.now) > 5, live.now);
    if (P.type === 'quake') ok(id + ': camera rumble during the quake', live.quake > 0.3 && live.trauma > 0.3, { q: live.quake, trauma: live.trauma });
    else ok(id + ': wind blowing', Math.abs(live.wind) > 10 && live.fxs, live.wind);
    await shot(id + '-3-live');
    // frame cost with the overlay active
    const perf = await page.evaluate(() => new Promise(res => {
      const r = BG.Game.renderer; const ws = []; let n = 0;
      const o = r.render; r.render = function (s) { const t = performance.now(); const out = o.call(this, s); ws.push(performance.now() - t); return out; };
      const tick = () => { if (++n < 40) requestAnimationFrame(tick); else { r.render = o; ws.sort((a, b) => a - b); res({ p95: ws[Math.floor(ws.length * 0.95)], avg: ws.reduce((a, b) => a + b, 0) / ws.length }); } };
      requestAnimationFrame(tick);
    }));
    ok(id + ': render p95 < 16 ms with weather', perf.p95 < 16, perf);
    const end = await page.evaluate(() => { const g = BG.Game; let k = 0; while (g.state === 'sim' && k++ < 4000) g._updateSim(1 / 10); return { state: g.state, res: g.lastResult && { passed: g.lastResult.passed, stars: g.lastResult.stars } }; });
    ok(id + ': reference design passes in the browser', end.state === 'results' && end.res && end.res.passed, end);
    await page.evaluate(() => BG.Game.backToEdit && BG.Game.backToEdit());
    await page.waitForTimeout(100);
    const gone = await page.evaluate(() => !document.querySelector('.fx-banner').classList.contains('show'));
    ok(id + ': banner hidden back in edit mode', gone);
  }
  // a road level shows none of it
  await page.evaluate(() => { BG.Game.openLevel(3, { force: true }); });
  await page.waitForTimeout(300);
  const road = await page.evaluate(() => ({ fc: document.querySelector('.fx-forecast').hidden, tl: document.querySelector('.fx-timeline').hidden, fxs: BG.Game.renderer._fxs }));
  ok('road level: no forecast, no timeline, no overlay', road.fc && road.tl && !road.fxs, road);
  // ...and neither does a rail level (a train runs without any weather)
  await page.evaluate(() => { BG.Game.openLevel(101, { force: true }); });
  await page.waitForTimeout(300);
  const rail = await page.evaluate((d) => { const g = BG.Game; g.editor.design = d; g._lastToggle = -1e9; g.startSim(); for (let i = 0; i < 60 && g.state === 'sim'; i++) g._updateSim(1 / 30); return { fc: document.querySelector('.fx-forecast').hidden, tl: document.querySelector('.fx-timeline').hidden, fxs: g.renderer._fxs, ext: g.sim ? g.sim._ext : 'nosim', state: g.state }; }, sol(101));
  ok('rail level: no forecast, no timeline, no overlay, no sim extension', rail.fc && rail.tl && !rail.fxs && rail.ext === null, rail);
  await page.evaluate(() => BG.Game.backToEdit && BG.Game.backToEdit());

  ok('no console errors', errors.length === 0, errors.slice(0, 5));
  await browser.close();
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} forces e2e checks passed (screenshots in ${OUT})`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
