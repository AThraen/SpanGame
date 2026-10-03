// Headless end-to-end check for SPAN. Never opens a visible window.
// Usage: node tools/e2e.js [outDir=%TEMP%/span-e2e] [viewportW=1440] [viewportH=900]
// Drives the real game headless: level select (50 levels / 6 chapters), mouse-built level 1 (incl. the
// auto-split beginner path), pass/fail runs, templates (level 4), undo/redo, mirror + piers (level 11),
// frame timing, progress; Iron Road: campaign tab gating, mouse-built 101, a derail callout (102), 108, the
// follow-camera scenery cache, and the finale (120 only); the shared campaign system: one tab bar (Roads | Iron Road |
// Famous Bridges), unlock gates, Next / finale per campaign (bonus 53 too), Continue across campaigns, the title's
// Daily + Endless entry points, and results-modal layering (badges, history card over the results); the unlock rule
// explained (chapter-finale gates, skipped markers, the (i) tooltip, the skip toast, the migration) and the hint only
// auto-showing on an empty design or a level never passed. Exit code 0 = all passed.
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
  const ls = await page.evaluate(() => ({ tiles: document.querySelectorAll('.tile').length, soon: document.querySelectorAll('.tile.soon').length, chapters: Array.from(document.querySelectorAll('.chapter h3')).map(h => h.textContent), ranges: Array.from(document.querySelectorAll('.chapter .ch-text p')).map(p => p.textContent.split(' · ')[0]), levels: BG.Levels.filter(l => l.campaign !== 'rail' && l.id <= 50).length, tab: BG.Hud.tab })); // forces: bonus levels 51+ live in a hidden chapter
  ok('level select: 50 road levels in 6 chapters (Roads tab)', ls.tab === 'road' && ls.tiles === 50 && ls.soon === 0 && ls.levels === 50 && ls.chapters.length === 6, ls);
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

  // ================================================================ Iron Road (levels 101-120)
  await page.evaluate(() => BG.Game.goLevelSelect()); await page.waitForTimeout(700);
  const lockInfo = await page.evaluate(() => ({ locked: document.querySelector('[data-camp=rail]').classList.contains('locked'), sub: document.querySelector('[data-ref=ctRail]').textContent, open: BG.Storage.isCampaignUnlocked('rail') }));
  ok('Iron Road tab locked until level 10 is complete', lockInfo.locked && /Complete level 10/.test(lockInfo.sub) && !lockInfo.open, lockInfo);
  await page.click('[data-camp=rail]'); await page.waitForTimeout(400);
  const lockedView = await page.evaluate(() => ({ closed: !!document.querySelector('.camp-locked'), open: document.querySelectorAll('.tile.is-rail.open').length }));
  ok('locked Iron Road tab opens no level', lockedView.closed && lockedView.open === 0, lockedView);
  await shot('20-rail-locked');
  await page.evaluate(() => { BG.Storage.recordResult(10, { passed: true, stars: 1, cost: 1 }); BG.Hud.setCampaignTab('rail'); });
  await page.waitForTimeout(500);
  const openView = await page.evaluate(() => ({ locked: document.querySelector('[data-camp=rail]').classList.contains('locked'), tiles: document.querySelectorAll('.tile.is-rail').length, open: Array.from(document.querySelectorAll('.tile.is-rail.open')).map(t => +t.dataset.id) }));
  ok('level 10 done: Iron Road open, 20 levels, 101 open, 103 still locked', !openView.locked && openView.tiles === 20 && openView.open.includes(101) && !openView.open.includes(103), openView);
  await shot('21-rail-levelselect');

  // ---- 101 built with the mouse: two rail segments, then a pass
  await page.click('.tile[data-id="101"]'); await page.waitForTimeout(1200);
  await page.evaluate(() => BG.Hud.hideHint());
  await page.keyboard.press('1'); await page.waitForTimeout(50);
  const e101 = await page.evaluate(() => ({ state: BG.Game.state, id: BG.Game.level.id, mat: BG.Game.editor.material, follow: BG.Game.followOn }));
  ok('level 101 opens in edit with rail selected (follow off on a short gap)', e101.state === 'edit' && e101.id === 101 && e101.mat === 'rail' && !e101.follow, e101);
  await drag(0, 0, 5, 0);
  const a101 = await W2S(10, 0);
  await page.mouse.click(a101.x, a101.y); await page.waitForTimeout(100); // reaching the anchor ends the chain
  const d101 = await page.evaluate(() => { const d = BG.Game.getDesign(); return { beams: d.beams.map(b => b.a + '-' + b.b + ':' + b.m), v: BG.Model.validate(BG.Game.level, d).ok, rail: BG.Model.railConnected(BG.Game.level, d) }; });
  ok('101: rail laid bank to bank with the mouse', d101.beams.length === 2 && d101.v && d101.rail, d101);
  await page.keyboard.press('Space'); await page.waitForTimeout(1800);
  ok('101: track recording strip shows during the run', await page.evaluate(() => BG.Game.state === 'sim' && document.querySelector('[data-ref=track]').classList.contains('show')));
  await shot('22-rail101-sim');
  r = await runSim(60); await page.waitForTimeout(1600);
  const card101 = await page.evaluate(() => { const c = document.querySelector('.ride-card'); return { card: !!c && !c.closest('[hidden]'), text: (document.querySelector('.rv-row') || {}).textContent || '' }; });
  ok('101 passes; results show both verdicts and the ride card', r.res && r.res.passed && card101.card && /Structure held/.test(card101.text) && /stayed on the rails/.test(card101.text), r.res && { passed: r.res.passed, stars: r.res.stars, rail: r.res.rail, card101 });
  ok('101 is not the finale', r.res && !r.res.finale);
  await shot('23-rail101-results');
  await page.click('[data-act=resEdit]').catch(() => {}); await page.waitForTimeout(300);

  // ---- 102: bare track - the tram derails on a kink and the callout explains it
  await page.evaluate(() => { BG.Game.openLevel(102, { force: true }); });
  await page.waitForTimeout(900);
  await page.evaluate(() => BG.Hud.hideHint());
  await page.evaluate(() => { BG.Game.editor.design = { nodes: [{ id: 'n1', x: 4, y: 0 }, { id: 'n2', x: 8, y: 0 }], beams: [{ a: 'a0', b: 'n1', m: 'rail' }, { a: 'n1', b: 'n2', m: 'rail' }, { a: 'n2', b: 'a1', m: 'rail' }], piers: [] }; BG.Game._lastToggle = -1e9; BG.Game.startSim(); });
  const der = await page.evaluate(() => { const g = BG.Game; for (let i = 0; i < 60 * 20 && g.state === 'sim' && !g._derailFx; i++) g._updateSim(1 / 60); return { fx: !!g._derailFx, reason: g._derailFx && g._derailFx.ev.reason, firstDerail: g.sim.firstDerail && g.sim.firstDerail.reason }; });
  await page.waitForTimeout(350);
  const callout = await page.evaluate(() => { const dc = document.querySelector('[data-ref=derail]'); return { show: dc.classList.contains('show'), title: dc.querySelector('[data-ref=dcTitle]').textContent, cause: dc.querySelector('[data-ref=dcCause]').textContent }; });
  ok('102 bare track: the tram derails on a kink', der.fx && der.reason === 'kink', der);
  ok('derail callout shows the cause with numbers', callout.show && /kink/i.test(callout.title + callout.cause) && /\d/.test(callout.cause), callout);
  await shot('24-rail102-derail-callout');
  r = await runSim(40); await page.waitForTimeout(1500);
  ok('102 bare track fails as derailed', r.res && !r.res.passed && r.res.reason === 'derailed', r.res && { reason: r.res.reason, title: r.res.title });
  await page.click('[data-act=resEdit]').catch(() => {}); await page.waitForTimeout(300);

  // ---- 108: the reference viaduct passes in the browser
  await page.evaluate(() => { BG.Game.openLevel(108, { force: true }); });
  await page.waitForTimeout(900);
  await page.evaluate((d) => { BG.Hud.hideHint(); BG.Game.editor.design = d; BG.Game._lastToggle = -1e9; BG.Game.startSim(); }, sol(108));
  r = await runSim(120); await page.waitForTimeout(1500);
  const fin108 = await page.evaluate(() => document.querySelector('[data-ref=results]').classList.contains('finale'));
  ok('108 reference passes in the browser (not the finale)', r.res && r.res.passed && !r.res.finale && !fin108, r.res && { passed: r.res.passed, stars: r.res.stars, reason: r.res.reason, fin108 });
  await shot('25-rail108-results');
  await page.click('[data-act=resEdit]').catch(() => {}); await page.waitForTimeout(300);

  // ---- 120: follow camera on by default; the scenery cache is not rebuilt every frame; finale
  await page.evaluate(() => { BG.Game.openLevel(120, { force: true }); });
  await page.waitForTimeout(900);
  await page.evaluate((d) => { BG.Hud.hideHint(); BG.Game.editor.design = d; BG.Game._lastToggle = -1e9; BG.Game.startSim(); }, sol(120));
  const fol = await page.evaluate(() => new Promise(res => {
    const g = BG.Game, R = g.renderer;
    let frames = 0, rebuilds = 0, last = null;
    const tick = () => {
      if (frames > 0 && R._midAnchor !== last) rebuilds++;
      last = R._midAnchor;
      if (++frames < 150) requestAnimationFrame(tick);
      else res({ follow: g.followOn, following: !!R._followActive, frames, rebuilds, t: g.sim.time });
    };
    // let the follow camera zoom in first (a few seconds of frames), then watch the train cross at 1x
    let warm = 0;
    const warmup = () => { if (++warm < 200) requestAnimationFrame(warmup); else requestAnimationFrame(tick); };
    requestAnimationFrame(warmup);
  }));
  ok('120: camera follows the traffic; scenery cache reused (rebuilt on < 1 in 4 frames)', fol.follow && fol.following && fol.rebuilds < fol.frames / 4, fol);
  await shot('26-rail120-follow');
  r = await runSim(140); await page.waitForTimeout(1800);
  const fin = await page.evaluate(() => ({ cls: document.querySelector('[data-ref=results]').classList.contains('finale-rail'), banner: document.querySelector('[data-ref=resBanner]').textContent }));
  ok('120 reference passes and shows the Iron Road finale', r.res && r.res.passed && r.res.finale && fin.cls && /Iron Road complete/.test(fin.banner), r.res && { passed: r.res.passed, reason: r.res.reason, finale: r.res.finale, fin });
  await shot('27-rail120-finale');

  // ================================================================ one campaign system (Roads + bonus | Iron Road | Famous Bridges)
  await page.click('[data-act=resEdit]').catch(() => {}); await page.waitForTimeout(300);
  await page.evaluate(() => BG.Game.goLevelSelect()); await page.waitForTimeout(600);
  const tabs = await page.evaluate(() => ({
    camps: Array.from(document.querySelectorAll('.camp-tabs .camp-tab')).map(b => b.dataset.camp),
    famousLocked: document.querySelector('.camp-tab[data-camp=famous]').classList.contains('locked'),
    famousSub: document.querySelector('[data-ref=ctFamous]').textContent,
    lock: BG.Storage.campaignLockText('famous'),
  }));
  ok('level select: one tab bar - Roads | Iron Road | Famous Bridges; Famous locked until road 15', tabs.camps.join() === 'road,rail,famous' && tabs.famousLocked && /Complete level 15/.test(tabs.famousSub) && /level 15/.test(tabs.lock || ''), tabs);
  const rules = await page.evaluate(() => {
    const G = BG.Game, S = BG.Storage, L = id => G.findLevel(id), nx = id => { const n = G.nextInCampaign(L(id)); return n ? n.id : null; };
    return {
      next: [10, 50, 53, 105, 120, 204, 208, 211, 212].map(nx),
      finale: [49, 50, 53, 119, 120, 211, 212].map(id => S.finaleOf(L(id))),
      camp: [1, 51, 101, 205, 209].map(id => G.campaignOf(L(id))),
      famousCount: S.campaignLevels(BG.Levels, 'famous').length,
    };
  });
  ok('Next stays in the campaign (50 -> bonus 51, 204 -> Forth 205, 208 -> Tacoma 209; 53 / 120 / 212 end)', JSON.stringify(rules.next) === JSON.stringify([11, 51, null, 106, null, 205, 209, 212, null]), rules.next);
  ok('one finale per campaign (50 Roads, 53 bonus, 120 Iron Road, 212 Famous Bridges)', JSON.stringify(rules.finale) === JSON.stringify([null, 'road', 'bonus', null, 'rail', null, 'famous']), rules.finale);
  ok('campaigns: bonus levels are Roads, Forth + Tacoma are Famous Bridges (12 playable)', rules.camp.join() === 'road,road,rail,famous,famous' && rules.famousCount === 12, rules);
  // road 15 opens Famous Bridges: toast, tab, first bridge only
  await page.evaluate(() => { BG.Game.openLevel(15, { force: true }); }); await page.waitForTimeout(700);
  await page.evaluate((d) => { BG.Hud.hideHint(); BG.Game.editor.design = d; BG.Game._lastToggle = -1e9; BG.Game.startSim(); }, sol(15));
  r = await runSim(90); await page.waitForTimeout(1700);
  const open15 = await page.evaluate(() => ({ opened: BG.Game.lastResult.campaignsOpened, toast: Array.from(document.querySelectorAll('#toasts .toast')).map(t => t.textContent).join(' | '), open: BG.Storage.isCampaignUnlocked('famous') }));
  ok('passing road 15 opens Famous Bridges (toast)', r.res && r.res.passed && open15.open && (open15.opened || []).includes('famous') && /Famous Bridges is open/.test(open15.toast), open15);
  await page.evaluate(() => BG.Game.goLevelSelect()); await page.waitForTimeout(400);
  await page.click('.camp-tab[data-camp=famous]'); await page.waitForTimeout(500);
  const fv = await page.evaluate(() => ({ tab: BG.Hud.tab, mode: document.getElementById('screen-levels').classList.contains('fb-mode'), chaptersHidden: getComputedStyle(document.querySelector('.chapters')).display === 'none', tiles: document.querySelectorAll('.fb-tile').length, open: Array.from(document.querySelectorAll('.fb-tile.open')).map(t => +t.dataset.id), badges: document.querySelectorAll('.fb-tile .tile-badges').length, stars: document.querySelector('[data-ref=lsStars]').textContent }));
  ok('Famous Bridges tab: 12 picture tiles with badge counts, only 201 open, chapters hidden', fv.tab === 'famous' && fv.mode && fv.chaptersHidden && fv.tiles === 12 && fv.open.join() === '201' && fv.badges === 12 && /\/\s*36/.test(fv.stars), fv);
  await shot('28-famous-tab');
  // results layering: a famous result's Next opens the next bridge's history card OVER the results; Esc returns
  await page.click('.fb-tile[data-fbid="201"]'); await page.waitForTimeout(500);
  await page.keyboard.press('Enter'); await page.waitForTimeout(900);
  await page.evaluate((d) => { BG.Hud.hideHint(); BG.Game.editor.design = d; BG.Game._lastToggle = -1e9; BG.Game.startSim(); }, sol(201));
  r = await runSim(90); await page.waitForTimeout(2600);
  const lay = await page.evaluate(() => {
    const card = document.querySelector('.results-card');
    const kids = Array.from(card.children);
    const idx = sel => kids.findIndex(k => k.matches(sel));
    return { badges: idx('.res-badges'), actions: idx('.res-actions'), daily: !!card.querySelector('.dly-res'), hasNext: BG.Game.lastResult.hasNext, finale: BG.Game.lastResult.finale };
  });
  ok('famous result: badges above the buttons, no daily card, Next (not the finale)', r.res && r.res.passed && lay.badges >= 0 && lay.badges < lay.actions && !lay.daily && lay.hasNext && !lay.finale, lay);
  await page.click('[data-act=next]'); await page.waitForTimeout(600);
  const over = await page.evaluate(() => {
    const ov = document.querySelector('.fb-overlay'), res = document.querySelector('[data-ref=results]');
    const z = el => +getComputedStyle(el).zIndex || 0;
    const r = ov.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { card: BG.Famous.card.open, state: BG.Game.state, title: (document.querySelector('.fb-card h2') || {}).textContent, onTop: !!(top && top.closest('.fb-overlay')), resShown: res.classList.contains('show'), z: z(ov) };
  });
  ok('Next from a famous result: the next history card sits on top of the results', over.card && over.state === 'results' && over.onTop && over.resShown && /Ponte Vecchio/.test(over.title), over);
  await shot('29-famous-card-over-results');
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  ok('Esc closes the card and leaves the results as they were', await page.evaluate(() => !BG.Famous.card.open && BG.Game.state === 'results' && document.querySelector('[data-ref=results]').classList.contains('show')));
  // Continue works across campaigns: last played = an unfinished famous bridge
  await page.evaluate(() => { BG.Storage.setLastLevel(202); BG.Game.goTitle(); }); await page.waitForTimeout(700);
  const cont = await page.evaluate(() => ({ label: document.querySelector('[data-act=continue] .lbl').textContent, target: BG.Game.continueTarget().id, daily: !!document.querySelector('#screen-title .dly-title-btn'), endless: !!document.querySelector('#screen-title .dly-endless-btn'), endlessSub: (document.querySelector('.dly-endless-btn small') || {}).textContent, stars: document.querySelector('[data-ref=titleStars]').textContent }));
  ok('title: Continue resumes the famous bridge; Daily Challenge + Endless entry points', cont.target === 202 && /Continue · Ponte Vecchio/.test(cont.label) && cont.daily && cont.endless && !!cont.endlessSub, cont);
  await shot('30-title-entry-points');
  await page.click('[data-act=continue]'); await page.waitForTimeout(500);
  ok('Continue opens the history card of that bridge', await page.evaluate(() => BG.Famous.card.open && /Ponte Vecchio/.test(document.querySelector('.fb-card h2').textContent)));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  // all Iron Road levels finished, last = 120 -> Continue goes to the first open unfinished level of another campaign
  const cross = await page.evaluate(() => {
    const S = BG.Storage;
    for (let id = 101; id <= 120; id++) S.recordResult(id, { passed: true, stars: 1, cost: 1 });
    S.setLastLevel(120);
    const t = BG.Game.continueTarget();
    return { id: t && t.id, camp: t && BG.Game.campaignOf(t) };
  });
  ok('Continue after the whole Iron Road moves on to another campaign', cross.id != null && cross.camp !== 'rail', cross);
  // the bonus chapter finale (53) in the browser: hidden chapter revealed, its own finale text, 'All levels'
  await page.evaluate(() => { [5, 10, 20, 30, 40, 50].forEach(id => BG.Storage.recordResult(id, { passed: true, stars: 1, cost: 1 })); BG.Game.openLevel(53, { force: true }); }); // every chapter finale up to 50 (gates) await page.waitForTimeout(800);
  await page.evaluate((d) => { BG.Hud.hideHint(); BG.Game.editor.design = d; BG.Game._lastToggle = -1e9; BG.Game.startSim(); }, sol('53-best'));
  r = await runSim(90); await page.waitForTimeout(1800);
  const b53 = await page.evaluate(() => ({ banner: document.querySelector('[data-ref=resBanner]').textContent, cls: document.querySelector('[data-ref=results]').classList.contains('finale-bonus'), next: document.querySelector('[data-act=next] span').textContent }));
  ok('53 passes with the Forces of Nature finale', r.res && r.res.passed && r.res.finaleKind === 'bonus' && b53.cls && /Forces of Nature/.test(b53.banner) && b53.next === 'All levels', Object.assign({ passed: r.res && r.res.passed, kind: r.res && r.res.finaleKind }, b53));
  await shot('31-bonus-finale');
  await page.click('[data-act=next]'); await page.waitForTimeout(700);
  const back = await page.evaluate(() => ({ state: BG.Game.state, tab: BG.Hud.tab, bonus: Array.from(document.querySelectorAll('.chapter h3')).map(h => h.textContent).includes('Forces of Nature') }));
  ok('after the bonus finale: back on the Roads tab with the Forces of Nature chapter', back.state === 'levelSelect' && back.tab === 'road' && back.bonus, back);

  // ================================================================ unlock rule explained: gates on chapter finales
  const toasts = () => page.evaluate(() => Array.from(document.querySelectorAll('#toasts .toast')).map(t => t.textContent).join(' | '));
  const seed = (ids) => page.evaluate((ids) => {
    const S = BG.Storage; S.resetProgress(); S.set('unlockAll', false);
    ids.forEach(id => S.recordResult(id, { passed: true, stars: 1, cost: 1 }));
    BG.Game.goLevelSelect(); BG.Hud.setCampaignTab('road');
  }, ids);
  const r19 = []; for (let i = 1; i <= 19; i++) r19.push(i);
  await seed(r19); await page.waitForTimeout(500);
  const gate = await page.evaluate(() => {
    const t = id => document.querySelector('.tile[data-id="' + id + '"]');
    return { t20: t(20).classList.contains('open'), gate20: t(20).classList.contains('gate') && !!t(20).querySelector('.tile-gate'), t21: t(21).classList.contains('open'),
      gates: Array.from(document.querySelectorAll('.tile.gate')).map(e => +e.dataset.id), ends: BG.Hud.CHAPTERS.filter(c => !c.hidden).map(c => c.to) };
  });
  ok('unlock: 19 done -> chapter finale 20 open, 21 locked (finales can\'t be skipped); every chapter end is a gate', gate.t20 && gate.gate20 && !gate.t21 && gate.ends.every(id => gate.gates.includes(id)), gate);
  await page.evaluate(() => document.querySelector('.tile[data-id="21"]').click()); await page.waitForTimeout(300); // aria-disabled: no Playwright click
  const lock21 = await toasts();
  ok('unlock: tapping locked 21 names level 20 as the finale to finish', /level 20 first/.test(lock21) && /can't be skipped/.test(lock21) && await page.evaluate(() => BG.Game.state === 'levelSelect'), lock21);
  const info = await page.evaluate(() => { const b = document.querySelector('.chapter .ch-head .ch-info'); return b && { tip: b.dataset.tip, n: document.querySelectorAll('.chapter .ch-info').length, ch: document.querySelectorAll('.chapter').length }; });
  ok('unlock: every chapter header has an (i) with the rule', info && info.n === info.ch && /either of the two levels/.test(info.tip) && /Chapter finales/.test(info.tip), info);
  await page.click('.chapter .ch-info'); await page.waitForTimeout(300);
  ok('unlock: the (i) also shows the rule as a toast', /either of the two levels/.test(await toasts()));
  await seed(r19.slice(0, 18).concat([20])); await page.waitForTimeout(500);
  const skip = await page.evaluate(() => { const t = document.querySelector('.tile[data-id="19"]'); return { skipped: t.classList.contains('skipped'), text: (t.querySelector('.tile-skip') || {}).textContent, others: Array.from(document.querySelectorAll('.tile.skipped')).map(e => +e.dataset.id), open21: document.querySelector('.tile[data-id="21"]').classList.contains('open') }; });
  ok('unlock: skipped-but-open level 19 shows "Skipped — come back later" (finale 20 done -> 21 open)', skip.skipped && /Skipped — come back later/.test(skip.text) && skip.others.join() === '19' && skip.open21, skip);
  await shot('32-unlock-skipped');
  // a pass that opens a level by skipping explains the rule
  await seed([]); await page.evaluate(() => BG.Game.openLevel(1)); await page.waitForTimeout(800);
  await page.evaluate((d) => { BG.Hud.hideHint(); BG.Game.editor.design = d; BG.Game._lastToggle = -1e9; BG.Game.startSim(); }, sol(1));
  r = await runSim(60); await page.waitForTimeout(2000);
  const skipToast = await toasts();
  ok('unlock: passing 1 opens 3 by skipping -> toast "Level 3 unlocked — you can skip one level (chapter finales can\'t be skipped)"',
    r.res && r.res.passed && (r.res.skipUnlocked || []).join() === '3' && /Level 3 unlocked — you can skip one level \(chapter finales can't be skipped\)/.test(skipToast), { skip: r.res && r.res.skipUnlocked, skipToast });
  // migration: a player who already had levels open past an unbeaten finale keeps them, nothing new opens
  await page.evaluate(() => {
    const lv = {}; for (let i = 1; i <= 19; i++) lv[i] = { completed: true, stars: 1, bestCost: 1, attempts: 1 };
    lv[21] = { completed: true, stars: 1, bestCost: 1, attempts: 1 }; lv[22] = { completed: true, stars: 1, bestCost: 1, attempts: 1 };
    localStorage.setItem('span.v1.progress', JSON.stringify({ levels: lv, lastLevel: 22 }));
    localStorage.removeItem('span.v1.unlocks'); localStorage.removeItem('span.v1.hist.session');
  });
  await page.goto(url.pathToFileURL(path.join(ROOT, 'index.html')).href + '?screen=levels'); await page.waitForTimeout(1500);
  const mig = await page.evaluate(() => ({ open: [20, 21, 22, 23, 24, 25].filter(id => BG.Game.isUnlocked(id)), keep: BG.Storage.keptUnlocks() }));
  ok('unlock migration: 21-24 (open before the gates) stay open, 25 stays locked until 20 is done', mig.open.join() === '20,21,22,23,24', mig);
  // hint: auto-shown on an empty design or a level never passed; not on a built, passed level after a reload
  const hintAt = async (id, prep) => {
    await page.evaluate(() => BG.Game.goLevelSelect()); await page.waitForTimeout(200); // leave (and autosave) first
    await page.evaluate(prep, sol(1));
    await page.goto(url.pathToFileURL(path.join(ROOT, 'index.html')).href + '?level=' + id); await page.waitForTimeout(1400);
    return page.evaluate(() => ({ show: document.querySelector('[data-ref=hint]').classList.contains('show'), btn: !document.querySelector('[data-act=hint]').hidden, beams: BG.Game.getDesign().beams.length }));
  };
  const hBuilt = await hintAt(1, (d) => { const S = BG.Storage; S.resetProgress(); S.recordResult(1, { passed: true, stars: 3, cost: 1 }); S.saveDesign(1, d); });
  ok('hint: not auto-shown on reload of a built, passed level (hint button still there)', !hBuilt.show && hBuilt.btn && hBuilt.beams > 0, hBuilt);
  await page.click('[data-act=hint]'); await page.waitForTimeout(250);
  ok('hint: the hint button still opens it', await page.evaluate(() => document.querySelector('[data-ref=hint]').classList.contains('show')));
  const hEmpty = await hintAt(1, () => { BG.Storage.clearDesign(1); });
  ok('hint: auto-shown on a passed level with an empty design', hEmpty.show && hEmpty.beams === 0, hEmpty);
  const hNew = await hintAt(1, (d) => { const S = BG.Storage; S.resetProgress(); S.saveDesign(1, d); });
  ok('hint: auto-shown on a built level that was never passed', hNew.show && hNew.beams > 0, hNew);

  ok('no console errors', errors.length === 0, errors.slice(0, 15));
  console.log(`\n${results.filter(r => r.pass).length}/${results.length} e2e checks passed`);
  await browser.close();
  process.exit(results.every(r => r.pass) ? 0 : 1);
})().catch(e => { console.error('ERR', e); process.exit(2); });
