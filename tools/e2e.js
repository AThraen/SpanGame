// Headless end-to-end check for SPAN. Never opens a visible window.
// Usage: node tools/e2e.js [outDir=%TEMP%/span-e2e] [viewportW=1440] [viewportH=900]
// Drives the real game headless: level select (50 levels / 6 chapters), mouse-built level 1 (incl. the
// auto-split beginner path), pass/fail runs, templates (level 4), undo/redo, mirror + piers (level 11),
// frame timing, progress. Exit code 0 = all checks passed.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const url = require('url');
const ROOT = path.resolve(__dirname, '..');
const OUT = process.argv[2] || path.join(require('os').tmpdir(), 'span-e2e');
const VW = +(process.argv[3] || 1440), VH = +(process.argv[4] || 900);
fs.mkdirSync(OUT, { recursive: true });
const sol = n => JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'solutions', 'level-' + String(n).padStart(2, '0') + '.json'), 'utf8'));
const results = [];
const ok = (name, cond, info) => { results.push({ name, pass: !!cond, info }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
  const shot = async name => { await page.screenshot({ path: path.join(OUT, name + '.png') }); };
  const W2S = (x, y) => page.evaluate(([x, y]) => { const p = BG.Game.renderer.worldToScreen(x, y); const r = BG.Game.canvas.getBoundingClientRect(); return { x: p.x + r.left, y: p.y + r.top }; }, [x, y]);
  const drag = async (x1, y1, x2, y2) => {
    const a = await W2S(x1, y1), b = await W2S(x2, y2);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 });
    await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(60);
  };
  const runSim = (maxSec) => page.evaluate((maxSec) => {
    const g = BG.Game; let t = 0;
    while (g.state === 'sim' && t < maxSec) { g._updateSim(1 / 6); BG.Effects.update && BG.Effects.update(1 / 60); t += 1 / 6; }
    return { state: g.state, time: g.sim ? g.sim.time : null, res: g.lastResult };
  }, maxSec);

  await page.goto(url.pathToFileURL(path.join(ROOT, 'index.html')).href);
  await page.waitForTimeout(1800);
  ok('title state', await page.evaluate(() => BG.Game.state) === 'title');
  ok('real renderer', await page.evaluate(() => !BG.Game.usingFallbackRenderer));
  await shot('01-title');

  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  ok('level select state', await page.evaluate(() => BG.Game.state) === 'levelSelect');
  const ls = await page.evaluate(() => ({ tiles: document.querySelectorAll('.tile').length, soon: document.querySelectorAll('.tile.soon').length, chapters: Array.from(document.querySelectorAll('.chapter h3')).map(h => h.textContent), ranges: Array.from(document.querySelectorAll('.chapter .ch-text p')).map(p => p.textContent.split(' · ')[0]), levels: BG.Levels.length }));
  ok('level select: 50 levels in 6 chapters', ls.tiles === 50 && ls.soon === 0 && ls.levels === 50 && ls.chapters.length === 6, ls);
  await shot('02-levelselect');

  await page.click('.tile[data-id="1"]');
  await page.waitForTimeout(1200);
  ok('level 1 edit', await page.evaluate(() => BG.Game.state === 'edit' && BG.Game.level.id === 1));
  await shot('03-level1-empty');

  // ---- build level 1 reference solution by real mouse drags
  await page.evaluate(() => BG.Hud.hideHint());
  await drag(0, 0, 5, 0);                    // road a0 -> (5,0); chain continues from n
  const b1 = await page.evaluate(() => BG.Game.getDesign().beams.length);
  ok('mouse drag builds beam', b1 === 1, b1);
  // chain: click at a1 (reaching an anchor ends the chain)
  const a1 = await W2S(10, 0);
  await page.mouse.click(a1.x, a1.y);
  await page.waitForTimeout(80);
  ok('chain ends at the far anchor', await page.evaluate(() => BG.Game.editor.chainFrom === null && BG.Game.state === 'edit'));
  await page.keyboard.press('2'); // wood
  await drag(0, -2.5, 5, 0);
  await page.keyboard.press('Escape');
  await drag(10, -2.5, 5, 0);
  await page.keyboard.press('Escape');
  await page.mouse.move(VW / 2, 40);
  await page.waitForTimeout(300);
  const d1 = await page.evaluate(() => { const d = BG.Game.getDesign(); return { beams: d.beams.map(b => b.a + '-' + b.b + ':' + b.m), nodes: d.nodes, v: BG.Model.validate(BG.Game.level, d).ok, cost: BG.Game.getCost(), state: BG.Game.state }; });
  ok('built level 1 solution via mouse', d1.beams.length === 4 && d1.v, d1);
  await shot('04-level1-built');

  // ---- test via Space
  await page.keyboard.press('Space');
  await page.waitForTimeout(400);
  ok('space starts sim', await page.evaluate(() => BG.Game.state) === 'sim');
  await page.waitForTimeout(2500);
  await shot('05-level1-sim');
  let r = await runSim(60);
  await page.waitForTimeout(1900);
  ok('level 1 pass with stars', r.state === 'results' && r.res && r.res.passed && r.res.stars >= 1, r.res && { passed: r.res.passed, stars: r.res.stars, cost: r.res.cost, vf: r.res.vehiclesFinished });
  ok('results modal visible', await page.evaluate(() => document.querySelector('[data-ref=results]').classList.contains('show')));
  await shot('06-level1-results');
  await page.click('[data-act=inspect]'); await page.waitForTimeout(500);
  await shot('07-level1-inspect');
  await page.click('[data-act=uninspect]'); await page.waitForTimeout(300);
  await page.click('[data-act=resEdit]'); await page.waitForTimeout(400);
  ok('back to edit keeps design', await page.evaluate(() => BG.Game.state === 'edit' && BG.Game.getDesign().beams.length === 4));

  // ---- weak design: road only
  await page.evaluate(() => { BG.Game.editor.design = { nodes: [{ id: 'n1', x: 5, y: 0 }], beams: [{ a: 'a0', b: 'n1', m: 'road' }, { a: 'n1', b: 'a1', m: 'road' }], piers: [] }; });
  await page.evaluate(() => { BG.Game._lastToggle = -1e9; BG.Game.startSim(); });
  const fxInfo = await page.evaluate(() => {
    const g = BG.Game; let breaks = 0, maxFx = 0;
    const orig = g._onSimEvent.bind(g);
    g._onSimEvent = (ev, sim, a) => { if (ev.type === 'break') breaks++; return orig(ev, sim, a); };
    for (let i = 0; i < 60 * 5 && g.state === 'sim'; i++) { g._updateSim(1 / 60); BG.Effects.update(1 / 60); const c = typeof BG.Effects.count === 'function' ? BG.Effects.count() : BG.Effects.count; maxFx = Math.max(maxFx, +c || 0); if (breaks && i > 200) break; }
    g._onSimEvent = orig;
    return { breaks, maxFx, broken: g.sim && g.sim.beams.filter(b => b.broken).length };
  });
  ok('weak design breaks + effects fire', fxInfo.breaks > 0 && fxInfo.maxFx > 0, fxInfo);
  await page.waitForTimeout(200);
  await shot('08-level1-collapse');
  r = await runSim(60);
  await page.waitForTimeout(1500);
  ok('weak design fails', r.res && !r.res.passed && r.res.brokenBeams > 0, r.res && { title: r.res.title, reason: r.res.reason, broken: r.res.brokenBeams });
  ok('failure explains the first break', r.res && r.res.firstBreak && /bent too far|compression|tension/.test(r.res.reasonText), r.res && r.res.reasonText);
  ok('after a failure Edit is the main action', await page.evaluate(() => document.querySelector('[data-act=resEdit]').classList.contains('btn-primary') && !document.querySelector('[data-act=retry]').classList.contains('btn-primary')));
  await shot('09-level1-fail');
  await page.click('[data-act=inspect]'); await page.waitForTimeout(400);
  await shot('09b-level1-fail-inspect');
  await page.click('[data-act=uninspect]'); await page.waitForTimeout(200);
  await page.click('[data-act=resEdit]'); await page.waitForTimeout(400);

  // ---- beginner path: strut from the far-away lower-left anchor stops at 6 m on the road and joins it
  await page.evaluate(() => { BG.Game.editor.design = { nodes: [], beams: [], piers: [] }; BG.Game.editor.setMaterial('road'); });
  await drag(0, 0, 9, 0);                    // clamps at (6,0), chain continues
  const a1b = await W2S(10, 0);
  await page.mouse.click(a1b.x, a1b.y); await page.waitForTimeout(80);
  await page.keyboard.press('2');
  await drag(0, -2.5, 6, 0);                 // 6.5 m away: wood stops at (5,0) on the road
  await page.keyboard.press('Escape');
  const sp = await page.evaluate(() => { const d = BG.Game.getDesign(); return { road: d.beams.filter(b => b.m === 'road').length, wood: d.beams.filter(b => b.m === 'wood').length, v: BG.Model.validate(BG.Game.level, d).ok, connected: BG.Model.roadConnected(BG.Game.level, d) }; });
  ok('strut landing on the road splits it (auto-join)', sp.road === 3 && sp.wood === 1 && sp.v && sp.connected, sp);
  await page.evaluate(() => { BG.Game._lastToggle = -1e9; BG.Game.startSim(); });
  r = await runSim(60);
  await page.waitForTimeout(1500);
  ok('beginner strut design passes level 1', r.res && r.res.passed, r.res && { passed: r.res.passed, stars: r.res.stars, title: r.res.title });
  await page.click('[data-act=resEdit]').catch(() => {}); await page.waitForTimeout(300);

  // ---- level 4: templates (off on levels 1-3)
  await page.evaluate(() => { BG.Game.openLevel(4, { force: true }); });
  await page.waitForTimeout(900);
  await page.evaluate(() => BG.Hud.hideHint());
  await page.click('[data-act=templates]'); await page.waitForTimeout(300);
  await shot('10-level4-tplmenu');
  const tplIds = await page.evaluate(() => Array.from(document.querySelectorAll('[data-tpl]')).map(b => b.dataset.tpl));
  ok('template menu lists only templates that fit', tplIds.length > 0 && (await page.evaluate(() => BG.Templates.available(BG.Game.level).filter(t => t.ok).length)) === tplIds.length, tplIds);
  const tplRes = {};
  for (const id of tplIds) {
    await page.evaluate(() => { if (!BG.Hud.templatesOpen()) document.querySelector('[data-act=templates]').click(); });
    await page.waitForTimeout(120);
    await page.click(`[data-tpl="${id}"]`);
    await page.waitForTimeout(120);
    tplRes[id] = await page.evaluate(() => { const d = BG.Game.getDesign(); return d.beams.length + (BG.Model.validate(BG.Game.level, d).ok ? '' : '!'); });
  }
  ok('templates apply', Object.values(tplRes).every(v => /^\d+$/.test(v) && +v > 0), tplRes);
  await page.evaluate(() => document.querySelector('[data-act=templates]').click()); await page.waitForTimeout(100);
  await page.click('[data-tpl="warren"]'); await page.waitForTimeout(300);
  await shot('11-level4-warren');
  // undo/redo
  const ur = await page.evaluate(() => {
    const g = BG.Game, n0 = g.getDesign().beams.length;
    g.undo(); const n1 = g.getDesign().beams.length;
    g.redo(); const n2 = g.getDesign().beams.length;
    return { n0, n1, n2 };
  });
  ok('undo/redo', ur.n0 === ur.n2 && ur.n1 !== ur.n0, ur);
  // undo via keyboard
  await page.keyboard.press('Control+z'); await page.waitForTimeout(80);
  const urk = await page.evaluate(() => BG.Game.getDesign().beams.length);
  await page.keyboard.press('Control+y'); await page.waitForTimeout(80);
  const urk2 = await page.evaluate(() => BG.Game.getDesign().beams.length);
  ok('undo/redo keyboard', urk !== ur.n0 && urk2 === ur.n0, { urk, urk2 });
  // run warren on level 4 at 4x speed
  await page.evaluate(() => { BG.Game._lastToggle = -1e9; BG.Game.startSim(); });
  await page.click('[data-speed="4"]'); await page.waitForTimeout(100);
  ok('4x speed selectable', await page.evaluate(() => BG.Game.speed === 4 && document.querySelector('[data-speed="4"]').classList.contains('active')));
  r = await runSim(60);
  ok('level 4 warren template run completes', r.state === 'results', r.res && { passed: r.res.passed, stars: r.res.stars, broken: r.res.brokenBeams, title: r.res.title });
  await page.evaluate(() => BG.Game.setSpeed(1));

  // ---- level 11: mirror + pier
  await page.evaluate(() => { BG.Game.openLevel(11, { force: true }); });
  await page.waitForTimeout(900);
  await page.evaluate(() => BG.Hud.hideHint());
  await page.keyboard.press('p'); await page.waitForTimeout(50);
  const zx = await page.evaluate(() => { const z = BG.Game.level.pierZones[0]; return (z.x0 + z.x1) / 2; });
  const pz = await W2S(zx, 0);
  await page.mouse.move(pz.x, pz.y); await page.waitForTimeout(80);
  await shot('12-level11-pierghost');
  await page.mouse.click(pz.x, pz.y); await page.waitForTimeout(100);
  const piers = await page.evaluate(() => BG.Game.getDesign().piers);
  ok('pier placed on level 11', piers.length === 1, piers);
  ok('pier tool shows the pier allowance', await page.evaluate(() => /Pier 1\/\d/.test(document.querySelector('[data-tool=pier] span').textContent)));
  await page.keyboard.press('b');
  await page.keyboard.press('m');
  await page.keyboard.press('1');
  await drag(0, 0, 5, 0); await page.keyboard.press('Escape');
  const mir = await page.evaluate(() => BG.Game.getDesign().beams.map(b => b.a + '-' + b.b));
  ok('mirror builds symmetric beam', mir.length === 2, mir);
  await shot('13-level11-mirror');
  await page.evaluate(() => BG.Game.openLevel(3, { force: true })); await page.waitForTimeout(700);
  await page.keyboard.press('m');

  // ---- level 3 solution + fps
  await page.evaluate((d) => { BG.Game.editor.design = d; }, sol(3));
  await page.waitForTimeout(300);
  await shot('14-level3-solution');
  await page.evaluate(() => { BG.Game._lastToggle = -1e9; BG.Game.startSim(); });
  const perf = await page.evaluate(() => new Promise(res => {
    const g = BG.Game; const frames = []; const work = []; let last = performance.now();
    const orig = g._frame.bind(g);
    g._frame = ts => { const t0 = performance.now(); orig(ts); work.push(performance.now() - t0); };
    const tick = () => { const n = performance.now(); frames.push(n - last); last = n; if (frames.length < 240) requestAnimationFrame(tick); else { g._frame = orig; frames.sort((a, b) => a - b); work.sort((a, b) => a - b); const avg = a => a.reduce((s, x) => s + x, 0) / a.length; res({ avgFrame: avg(frames), p95Frame: frames[Math.floor(frames.length * 0.95)], avgWork: avg(work), p95Work: work[Math.floor(work.length * 0.95)], maxWork: work[work.length - 1], simTime: g.sim && g.sim.time }); } };
    requestAnimationFrame(tick);
  }));
  ok('level 3 frame work < 12ms p95', perf.p95Work < 12, perf);
  await shot('15-level3-sim');
  r = await runSim(80);
  await page.waitForTimeout(1600);
  ok('level 3 solution passes in browser', r.res && r.res.passed, r.res && { passed: r.res.passed, stars: r.res.stars, vf: r.res.vehiclesFinished, vt: r.res.vehiclesTotal });
  await shot('16-level3-results');

  // progress: next level + unlocks
  await page.click('[data-act=next]').catch(()=>{}); await page.waitForTimeout(700);
  ok('next level button opens level 4 or level select', await page.evaluate(() => BG.Game.state === 'levelSelect' || (BG.Game.level && BG.Game.level.id === 4)));
  await page.evaluate(() => BG.Game.goLevelSelect()); await page.waitForTimeout(700);
  const prog = await page.evaluate(() => ({ t2: document.querySelector('.tile[data-id="2"]').classList.contains('open'), t3: document.querySelector('.tile[data-id="3"]').classList.contains('open'), stars1: BG.Storage.getStars(1), total: BG.Storage.totalStars() }));
  ok('progress saved + unlocks', prog.t2 && prog.t3 && prog.stars1 === 3, prog);
  await shot('18-levelselect-progress');
  await page.evaluate(() => BG.Game.goTitle()); await page.waitForTimeout(900);
  ok('title shows continue', await page.evaluate(() => !document.querySelector('[data-act=continue]').hidden));
  await shot('19-title-continue');
  await page.evaluate(() => BG.Game.openLevel(1)); await page.waitForTimeout(500);
  ok('saved design restored', await page.evaluate(() => BG.Game.getDesign().beams.length) > 0);
  // settings modal
  await page.evaluate(() => BG.Hud.openSettings()); await page.waitForTimeout(400);
  await shot('17-settings');
  await page.evaluate(() => BG.Hud.closeSettings());

  ok('no console errors', errors.length === 0, errors.slice(0, 15));
  console.log(`\n${results.filter(r => r.pass).length}/${results.length} e2e checks passed`);
  await browser.close();
  process.exit(results.every(r => r.pass) ? 0 : 1);
})().catch(e => { console.error('ERR', e); process.exit(2); });
