// Headless browser check of the goals/badges UI. Never opens a visible window.
// Usage: node tools/e2e-goals.js [outDir=%TEMP%/span-goals]   Exit code 0 = all checks passed.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const url = require('url');
const ROOT = path.resolve(__dirname, '..');
const OUT = process.argv[2] || path.join(require('os').tmpdir(), 'span-goals');
fs.mkdirSync(OUT, { recursive: true });
const pad2 = n => String(n).padStart(2, '0');
const results = [];
const ok = (name, cond, info) => { results.push(!!cond); console.log((cond ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  const file = url.pathToFileURL(path.join(ROOT, 'index.html')).href;
  const shot = n => page.screenshot({ path: path.join(OUT, n + '.png') });
  await page.goto(file); await page.waitForTimeout(1500);

  const goalsData = await page.evaluate(() => BG.GoalsData);
  const nLevels = await page.evaluate(() => BG.Levels.length);
  ok('goals data loaded for every level (road + rail)', Object.keys(goalsData).length === nLevels && nLevels >= 70, { goals: Object.keys(goalsData).length, nLevels });
  await page.evaluate(() => BG.Game.goLevelSelect()); await page.waitForTimeout(700);
  const ls = await page.evaluate(() => ({ tiles: document.querySelectorAll('.tile-badges').length, chip: (document.querySelector('.ls-right .badge-chip') || {}).textContent }));
  ok('level tiles show badge counts', ls.tiles === 50, ls);
  const maxB = await page.evaluate(() => BG.Storage.maxBadges());
  // unrevealed hidden bonus levels (Forces of Nature 51-53) are not counted until their chapter opens
  const hiddenIds = await page.evaluate(() => (BG.Hud.hiddenLevelIds ? BG.Hud.hiddenLevelIds() : []));
  const sumB = Object.entries(goalsData).reduce((a, [id, s]) => a + (hiddenIds.includes(+id) ? 0 : s.length), 0);
  ok('level select total badge chip (both campaigns)', new RegExp('0\\s*/\\s*' + sumB).test(ls.chip || '') && maxB === sumB, { chip: ls.chip, maxB, sumB, hiddenIds });
  await shot('01-levelselect');
  // campaign tabs: the Iron Road tab rebuilds the grid; its tiles get badge counts too, and back again
  await page.evaluate(() => BG.Hud.setCampaignTab('rail')); await page.waitForTimeout(500);
  const rl = await page.evaluate(() => ({ tab: BG.Hud.tab, tiles: document.querySelectorAll('.tile.is-rail .tile-badges').length, chips: document.querySelectorAll('.ls-right .badge-chip').length }));
  ok('Iron Road tab: rail tiles show badge counts, one total chip', rl.tab === 'rail' && rl.tiles === 20 && rl.chips === 1, rl);
  await shot('01b-levelselect-rail');
  await page.evaluate(() => BG.Hud.setCampaignTab('road')); await page.waitForTimeout(500);
  const rd = await page.evaluate(() => ({ tiles: document.querySelectorAll('.tile-badges').length, chips: document.querySelectorAll('.ls-right .badge-chip').length }));
  ok('Roads tab again: 50 tiles with badge counts, no duplicate chip', rd.tiles === 50 && rd.chips === 1, rd);

  // play level 1 with the symmetric goal design
  const sol = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'solutions', 'goals', 'level-01-' + goalsData[1][0].type + '.json'), 'utf8'));
  await page.evaluate(() => { BG.Game.openLevel(1, { force: true }); }); await page.waitForTimeout(1200);
  await page.evaluate(() => BG.Hud.hideHint());
  const panel = await page.evaluate(() => ({ btn: !document.querySelector('.goals-btn').hidden, rows: document.querySelectorAll('.goals-panel .gp-row').length, open: document.querySelector('.goals-panel').classList.contains('open') }));
  ok('goals button + open panel with one row per goal', panel.btn && panel.open && panel.rows === goalsData[1].length, panel);
  await shot('02-level1-goals-panel');

  await page.evaluate(d => { const ed = BG.Game.editor; if (ed.setDesign) ed.setDesign(d); else ed.design = d; }, sol);
  await page.waitForTimeout(700);
  const live = await page.evaluate(() => Array.from(document.querySelectorAll('.goals-panel .gp-row')).map(r => r.className));
  ok('panel shows live progress (on-track rows)', live.some(c => /ontrack/.test(c)), live);
  await page.evaluate(() => BG.Game.toggleTest());
  await page.evaluate(() => { const g = BG.Game; let t = 0; while (g.state === 'sim' && t < 60) { g._updateSim(1 / 6); BG.Effects.update && BG.Effects.update(1 / 60); t += 1 / 6; } });
  await page.waitForTimeout(500);
  const st = await page.evaluate(() => BG.Game.state);
  ok('run finished in results', st === 'results', st);
  await page.waitForTimeout(3400);
  const rb = await page.evaluate(() => ({ n: document.querySelectorAll('.res-badges .rb').length, fresh: document.querySelectorAll('.res-badges .rb.new').length, shown: document.querySelectorAll('.res-badges .rb.in').length, stored: BG.Storage.getBadges(1) }));
  const expect = await page.evaluate(() => { const g = BG.Game; return BG.Goals.evaluate(g.level, g.getDesign(), g.sim.summary()).earned; });
  ok('results modal lists all goals and reveals them', rb.n === goalsData[1].length && rb.shown === rb.n, rb);
  ok('earned badges are new + persisted', rb.fresh === expect.length && expect.length >= 1 && rb.stored.length === expect.length, { rb, expect });
  await shot('03-results-badges');

  // persistence across reload
  await page.reload(); await page.waitForTimeout(1500);
  await page.evaluate(() => BG.Game.goLevelSelect()); await page.waitForTimeout(700);
  const after = await page.evaluate(() => ({ total: BG.Storage.totalBadges(), t1: (document.querySelector('.tile[data-id="1"] .tile-badges') || {}).textContent, chip: document.querySelector('.ls-right .badge-chip').textContent }));
  ok('badges persist after reload (tile + total)', after.total === expect.length && after.t1.trim().startsWith(String(expect.length)), after);
  await shot('04-levelselect-after');
  await page.evaluate(() => BG.Game.goTitle()); await page.waitForTimeout(600);
  ok('title shows badge total', await page.evaluate(() => !!document.querySelector('#screen-title .badge-chip')));
  await shot('05-title');

  // Iron Road: play level 101 with a goal design; badges are keyed by the rail level id
  const g101 = goalsData[101][0].type;
  const sol101 = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'solutions', 'goals', 'level-101-' + g101 + '.json'), 'utf8'));
  await page.evaluate(() => { BG.Game.openLevel(101, { force: true }); }); await page.waitForTimeout(1200);
  await page.evaluate(() => BG.Hud.hideHint());
  const p101 = await page.evaluate(() => ({ btn: !document.querySelector('.goals-btn').hidden, rows: document.querySelectorAll('.goals-panel .gp-row').length }));
  ok('101: goals button + one panel row per goal', p101.btn && p101.rows === goalsData[101].length, p101);
  await page.evaluate(d => { const ed = BG.Game.editor; if (ed.setDesign) ed.setDesign(d); else ed.design = d; }, sol101);
  await page.waitForTimeout(500);
  await page.evaluate(() => BG.Game.toggleTest());
  await page.evaluate(() => { const g = BG.Game; let t = 0; while (g.state === 'sim' && t < 90) { g._updateSim(1 / 6); BG.Effects.update && BG.Effects.update(1 / 60); t += 1 / 6; } });
  await page.waitForTimeout(3900);
  const r101 = await page.evaluate(g => ({ state: BG.Game.state, n: document.querySelectorAll('.res-badges .rb').length, stored: BG.Storage.getBadges(101), shown: !!document.querySelector('.res-badges.show') }), g101);
  ok('101: passes, results list its badges and the goal badge is stored', r101.state === 'results' && r101.n === goalsData[101].length && r101.stored.includes(g101), r101);
  await shot('05b-results-101');
  const tot = await page.evaluate(() => BG.Storage.totalBadges());
  ok('total counts road + rail badges', tot >= expect.length + 1, tot);

  // mobile layout
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { BG.Game.openLevel(1, { force: true }); }); await page.waitForTimeout(1200);
  await page.evaluate(() => BG.Hud.hideHint());
  await page.click('.goals-btn'); await page.waitForTimeout(600);
  const mob = await page.evaluate(() => { const r = document.querySelector('.goals-panel').getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth, open: document.querySelector('.goals-panel').classList.contains('open') }; });
  ok('mobile: panel opens inside the viewport', mob.open && mob.l >= 0 && mob.r <= mob.w, mob);
  await shot('06-mobile-panel');

  ok('no console errors', errors.length === 0, errors.slice(0, 5));
  await browser.close();
  const bad = results.filter(x => !x).length;
  console.log(bad ? bad + ' FAILED' : 'all ' + results.length + ' checks passed');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
