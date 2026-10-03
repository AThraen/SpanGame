// SPAN — Daily Challenge / Endless tests (js/features/daily.js + js/core/generator.js).
// Part 1 (Node): records, streaks, practice runs, share text, endless scoring — against BG.Storage's
//                in-memory fallback.
// Part 2 (headless Chrome, never a visible window): title button + panel, in-browser generation time,
//                browser level == Node level (bit-identical), playing the daily with the generator's own
//                solution, results share card + clipboard, records kept out of campaign progress, cache +
//                saved design on reload, Esc back to the panel, Endless run (next crossing), phone layout.
// Usage: node tools/test-daily.js [outDir=%TEMP%/span-daily] [--node-only]
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const url = require('url');
const ROOT = path.resolve(__dirname, '..');
const OUT = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(require('os').tmpdir(), 'span-daily');
const nodeOnly = process.argv.includes('--node-only');

let failed = 0;
const ok = (name, cond, info) => { if (!cond) failed++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (info !== undefined && !cond ? '  ' + JSON.stringify(info) : '')); };

// ------------------------------------------------------------------ part 1: Node
const { BG } = require('./harness');
for (const f of ['js/core/generator.js', 'js/ui/storage.js', 'js/features/daily.js']) vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
const G = BG.Generator, D = BG.Daily;
{
  ok('daily.js loads in Node without installing UI hooks', D && !D._installed);
  const lvA = G.daily(20261005);
  ok('daily level id + Monday name', lvA.id === 'daily-20261005' && /^Monday's /.test(lvA.name), lvA.name);
  const B = lvA.budget;
  D._today = 20261005;
  ok('no streak yet', D.streakInfo(null, 20261005).current === 0);
  let r = D.recordDaily(20261005, lvA, { passed: false, stars: 0, cost: B * 1.2, members: 9 });
  ok('failed attempt recorded, no streak', D.loadDays().days[20261005].attempts === 1 && !D.loadDays().days[20261005].passed && D.streakInfo(null, 20261005).current === 0);
  r = D.recordDaily(20261005, lvA, { passed: true, stars: 1, cost: Math.round(B * 0.9), members: 20 });
  ok('pass -> streak 1, improved', r.improved && D.streakInfo(null, 20261005).current === 1 && r.entry.stars === 1);
  r = D.recordDaily(20261005, lvA, { passed: true, stars: 1, cost: Math.round(B * 0.95), members: 22 });
  ok('worse result does not replace best', !r.improved && D.loadDays().days[20261005].cost === Math.round(B * 0.9));
  r = D.recordDaily(20261005, lvA, { passed: true, stars: 2, cost: Math.round(B * 0.8), members: 18 });
  ok('better result replaces best', r.improved && D.loadDays().days[20261005].stars === 2 && D.loadDays().days[20261005].members === 18);
  // consecutive days
  const lvB = G.daily(20261006);
  D._today = 20261006;
  ok('streak survives until today is played', D.streakInfo(null, 20261006).current === 1 && !D.streakInfo(null, 20261006).today);
  D.recordDaily(20261006, lvB, { passed: true, stars: 3, cost: Math.round(lvB.budget * 0.69), members: 15 });
  ok('two-day streak', D.streakInfo(null, 20261006).current === 2 && D.streakInfo(null, 20261006).best === 2);
  // skip a day: streak resets, best streak kept
  D._today = 20261008;
  ok('missed day breaks the streak', D.streakInfo(null, 20261008).current === 0 && D.streakInfo(null, 20261008).best === 2);
  // practice: playing a past daily later does not count
  const lvC = G.daily(20261007);
  r = D.recordDaily(20261007, lvC, { passed: true, stars: 2, cost: Math.round(lvC.budget * 0.8), members: 30 });
  const e7 = D.loadDays().days[20261007];
  ok('late play is practice, not streak', !e7.passed && e7.practice && e7.practice.stars === 2 && D.streakInfo(null, 20261008).current === 0);
  // history
  const h = D.history(20261008, 14);
  ok('history: 14 days ending today', h.length === 14 && h[13].seed === 20261008 && h[0].seed === G.addDays(20261008, -13) && h[11].entry && h[11].entry.passed);
  // share text
  const e6 = D.loadDays().days[20261006];
  const txt = D.shareText(20261006, lvB, e6, { current: 2 });
  const lines = txt.split('\n');
  ok('share text: header, name, stars, grid, streak', lines.length === 5 && /^SPAN Daily #279 · Tue 6 Oct 2026$/.test(lines[0]) && lines[1].indexOf(lvB.name) >= 0 &&
    lines[2] === '★★★ · 69% of budget · 15 members' && Array.from(lines[3]).length === 10 && lines[4] === '🔥 2-day streak', lines);
  ok('share grid: 7 green cells for 69%', lines[3] === '🟩🟩🟩🟩🟩🟩🟩⬜⬜⬜', lines[3]);
  // endless
  BG.Storage.set('endless', { best: { cleared: 0, stars: 0 }, run: { seed: 7, index: 0, cleared: 0, stars: 0, starsBy: {} }, runs: 1 });
  D.recordEndless(0, { passed: true, stars: 2 });
  D.recordEndless(0, { passed: true, stars: 1 });
  D.recordEndless(1, { passed: true, stars: 3 });
  D.recordEndless(2, { passed: false, stars: 0 });
  const en = D.loadEndless();
  ok('endless: run score + best', en.run.cleared === 2 && en.run.stars === 5 && en.best.cleared === 2 && en.best.stars === 5, en);
  ok('generated ids are recognised', D.isGenId('daily-20261005') && D.isGenId('endless-1-2') && !D.isGenId(5) && !D.isGenId('level-5'));
  D._today = null;
}

if (nodeOnly) { console.log(failed ? '\nFAILED: ' + failed : '\nOK (node part)'); process.exit(failed ? 1 : 0); }

// ------------------------------------------------------------------ part 2: headless browser
(async () => {
  const { chromium } = require('playwright');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  const shot = name => page.screenshot({ path: path.join(OUT, name + '.png') });
  const runSim = (maxSec) => page.evaluate((maxSec) => {
    const g = BG.Game; let t = 0;
    while (g.state === 'sim' && t < maxSec) { g._updateSim(1 / 6); t += 1 / 6; }
    return { state: g.state, res: g.lastResult };
  }, maxSec);
  const waitFor = (fn, arg, ms) => page.waitForFunction(fn, arg, { timeout: ms || 15000 });
  const TODAY = 20261005; // a Monday
  const href = url.pathToFileURL(path.join(ROOT, 'index.html')).href + '?today=' + TODAY;

  await page.goto(href);
  await page.waitForTimeout(1600);
  ok('title has the Daily Challenge button', await page.evaluate(() => !!document.querySelector('#screen-title .dly-title-btn') && BG.Game.state === 'title'));
  ok('title button shows the date', /Mon 5 Oct/.test(await page.textContent('.dly-title-btn small')));

  // ---- panel + in-browser generation
  const t0 = Date.now();
  await page.click('.dly-title-btn');
  await waitFor(() => BG.Daily.panelOpen());
  // force a fresh, urgent generation so the timing is the real cold-start cost
  const gen = await page.evaluate(() => new Promise(res => {
    BG.Storage.remove('dailyCache');
    const t = performance.now();
    BG.Daily.getDaily(BG.Daily.todaySeed(), true, (err, lv) => res({ err: err && err.message, ms: performance.now() - t, level: lv }));
  }));
  ok('browser generates today\'s level', !gen.err && gen.level && gen.level.id === 'daily-' + TODAY, gen.err);
  ok('browser generation (urgent, time-sliced) < 2.5 s', gen.ms < 2500, Math.round(gen.ms));
  console.log('     browser generation: ' + Math.round(gen.ms) + ' ms (' + gen.level.generator.sims + ' sims), first panel open ' + (Date.now() - t0) + ' ms');
  const nodeLevel = G.daily(TODAY);
  ok('browser level is bit-identical to the Node level', JSON.stringify(gen.level) === JSON.stringify(nodeLevel));
  const sync = await page.evaluate((s) => { const t = performance.now(); const lv = BG.Generator.generate(s, BG.Generator.dailyOpts(s)); return { ms: performance.now() - t, json: JSON.stringify(lv) }; }, G.addDays(TODAY, 4));
  ok('browser Friday level == Node Friday level', sync.json === JSON.stringify(G.daily(G.addDays(TODAY, 4))));
  console.log('     browser sync generation of Friday: ' + Math.round(sync.ms) + ' ms');
  await page.evaluate(() => BG.Daily._renderPanel());
  await waitFor(() => document.querySelector('[data-dref=name]').textContent !== 'Surveying…');
  ok('panel shows level name', (await page.textContent('[data-dref=name]')) === nodeLevel.name);
  ok('panel history strip has 14 days, today marked', await page.evaluate(() => document.querySelectorAll('.dly-day').length === 14 && !!document.querySelector('.dly-day.today.sel')));
  await shot('01-daily-panel');

  // ---- Esc closes, Enter on title still goes to level select when the panel is closed
  await page.keyboard.press('Escape');
  ok('Esc closes the panel', await page.evaluate(() => !BG.Daily.panelOpen() && BG.Game.state === 'title'));
  await page.click('.dly-title-btn');
  await waitFor(() => BG.Daily.panelOpen());

  // ---- play
  const before = await page.evaluate(() => ({ prog: JSON.stringify(BG.Storage.getProgress()), stars: BG.Storage.totalStars() }));
  await page.click('[data-dly=play]');
  await waitFor(() => BG.Game.state === 'edit');
  const lvl = await page.evaluate(() => ({ id: BG.Game.level.id, k: document.querySelector('.lvl-k').textContent, n: document.querySelector('[data-ref=lvlNum]').textContent, sub: document.querySelector('[data-ref=lvlSub]').textContent, mode: document.body.classList.contains('dly-mode') }));
  ok('daily opens in the editor', lvl.id === 'daily-' + TODAY && lvl.k === 'DAILY' && lvl.n === '5' && /Mon 5 Oct 2026/.test(lvl.sub) && lvl.mode, lvl);
  await page.evaluate(() => BG.Hud.hideHint());
  await page.waitForTimeout(600); // title / panel fade-out
  await shot('02-daily-edit');
  // build the generator's proof design (editor-buildable, on the 0.25 m grid) and test it
  await page.evaluate(() => { BG.Game._replaceDesign(BG.Model.clone(BG.Game.level.generator.solution.design)); BG.Game._lastToggle = -1e9; BG.Game.startSim(); });
  const run1 = await runSim(120);
  ok('generator solution passes in the real game', run1.state === 'results' && run1.res && run1.res.passed && run1.res.stars >= 1, run1.res && { passed: run1.res.passed, reason: run1.res.reason });
  ok('solver solution earns ★★ (cost ~75% of budget)', run1.res && run1.res.stars === 2, run1.res && run1.res.stars);
  const resUi = await page.evaluate(() => ({ next: document.querySelector('[data-act=next] span').textContent, share: (document.querySelector('.dly-share-text') || {}).textContent || '', banner: document.querySelector('[data-ref=resBanner]').textContent }));
  ok('results: share card + Daily menu button', resUi.next === 'Daily menu' && /^SPAN Daily #278 · Mon 5 Oct 2026/.test(resUi.share) && /★★☆/.test(resUi.share), resUi);
  await page.waitForTimeout(1400);
  await shot('03-daily-results');
  // clipboard
  await page.evaluate(() => { window.__copied = null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { window.__copied = t; return Promise.resolve(); } } }); });
  await page.click('.dly-res [data-dly-res=copy]');
  await page.waitForTimeout(100);
  const copied = await page.evaluate(() => window.__copied);
  ok('Copy result writes the share text to the clipboard', copied && copied === resUi.share, copied);
  const after = await page.evaluate(() => ({ prog: JSON.stringify(BG.Storage.getProgress()), stars: BG.Storage.totalStars(), day: BG.Storage.get('daily').days[BG.Daily.todaySeed()] }));
  ok('daily result kept out of campaign progress', after.prog === before.prog && after.stars === before.stars, after.prog);
  ok('daily record saved (passed, stars, members)', after.day && after.day.passed && after.day.stars === 2 && after.day.members === nodeLevel.generator.solution.design.beams.length, after.day);

  // ---- Daily menu -> title + panel with today's result
  await page.click('[data-act=next]');
  await waitFor(() => BG.Game.state === 'title' && BG.Daily.panelOpen());
  const panel2 = await page.evaluate(() => ({ stats: document.querySelector('[data-dref=stats]').textContent, share: !document.querySelector('[data-dly=share]').hidden, title: document.querySelector('.dly-title-btn small').textContent }));
  ok('panel after a pass: streak 1, share button, title stars', /🔥 1/.test(panel2.stats) && panel2.share && /★★/.test(panel2.title), panel2);
  await shot('04-daily-panel-done');

  // ---- reload: level from cache, design restored
  await page.goto(href);
  await page.waitForTimeout(1200);
  const reload = await page.evaluate(() => {
    const seed = BG.Daily.todaySeed();
    return { cached: !!BG.Daily.cachedDaily(seed), design: (BG.Storage.loadDesign('daily-' + seed) || { beams: [] }).beams.length };
  });
  ok('reload: level cached, design saved', reload.cached && reload.design === nodeLevel.generator.solution.design.beams.length, reload);
  await page.evaluate(() => BG.Daily.playDaily());
  await waitFor(() => BG.Game.state === 'edit');
  ok('replay restores the saved design', await page.evaluate(() => BG.Game.getDesign().beams.length) === nodeLevel.generator.solution.design.beams.length);
  await page.keyboard.press('Escape');
  await waitFor(() => BG.Game.state === 'title' && BG.Daily.panelOpen());
  ok('Esc in a daily returns to the title + daily panel', true);

  // ---- endless
  await page.click('[data-dly=endlessNew]');
  await waitFor(() => BG.Game.state === 'edit', null, 20000);
  const e0 = await page.evaluate(() => ({ id: BG.Game.level.id, k: document.querySelector('.lvl-k').textContent, idx: BG.Game.level.generator.index }));
  ok('endless crossing 1 opens', /^endless-\d+-0$/.test(e0.id) && e0.k === 'ENDLESS' && e0.idx === 0, e0);
  await page.evaluate(() => { BG.Hud.hideHint(); BG.Game._replaceDesign(BG.Model.clone(BG.Game.level.generator.solution.design)); BG.Game._lastToggle = -1e9; BG.Game.startSim(); });
  const run2 = await runSim(120);
  const eres = await page.evaluate(() => ({ next: document.querySelector('[data-act=next] span').textContent, box: (document.querySelector('.dly-res') || {}).textContent || '', rec: BG.Storage.get('endless') }));
  ok('endless pass: Next crossing + run score', run2.res && run2.res.passed && eres.next === 'Next crossing' && eres.rec.run.cleared === 1 && /1 cleared/.test(eres.box), eres);
  await page.waitForTimeout(1200);
  await shot('05-endless-results');
  await page.click('[data-act=next]');
  await waitFor(() => BG.Game.state === 'edit' && /-1$/.test(BG.Game.level.id), null, 20000);
  const e1 = await page.evaluate(() => ({ d0: BG.Storage.get('endless').run.index, diff: BG.Game.level.generator.difficulty }));
  ok('next crossing is harder', e1.d0 === 1 && e1.diff > 0.06, e1);
  await page.evaluate(() => BG.Hud.hideHint());
  await shot('06-endless-crossing-2');

  // ---- campaign still works next to it
  await page.evaluate(() => BG.Game.goTitle());
  await page.waitForTimeout(300);
  await page.evaluate(() => BG.Daily.closePanel());
  await page.keyboard.press('Enter');
  await page.waitForTimeout(700);
  ok('Enter on title still opens level select', await page.evaluate(() => BG.Game.state === 'levelSelect' && document.querySelectorAll('.tile').length === 50));
  await page.click('.tile[data-id="1"]');
  await page.waitForTimeout(600);
  ok('campaign level 1 opens with the LEVEL badge', await page.evaluate(() => BG.Game.level.id === 1 && document.querySelector('.lvl-k').textContent === 'LEVEL' && !document.body.classList.contains('dly-mode')));

  // ---- phone layout
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await mob.newPage();
  mp.on('pageerror', e => errors.push(`[pageerror mobile] ${e.message}`));
  await mp.goto(href);
  await mp.waitForTimeout(1500);
  await mp.evaluate(() => BG.Daily.openPanel());
  await mp.waitForFunction(() => document.querySelector('[data-dref=name]').textContent !== 'Surveying…', null, { timeout: 15000 });
  const fit = await mp.evaluate(() => { const r = document.querySelector('.dly-card').getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth, sw: document.documentElement.scrollWidth }; });
  ok('phone: panel fits the screen width', fit.l >= 0 && fit.r <= fit.w && fit.sw <= fit.w, fit);
  await mp.screenshot({ path: path.join(OUT, '07-phone-panel.png') });
  await mob.close();

  ok('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log('\nscreenshots: ' + OUT);
  console.log(failed ? 'FAILED: ' + failed : 'OK — all daily checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
