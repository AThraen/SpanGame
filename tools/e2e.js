// Headless end-to-end check for SPAN. Never opens a visible window.
// Usage: node tools/e2e.js [outDir=%TEMP%/span-e2e] [viewportW=1440] [viewportH=900]
// Drives the real game headless: level select (50 levels / 6 chapters), mouse-built level 1 (incl. the
// auto-split beginner path), pass/fail runs, templates (level 4), undo/redo, mirror + piers (level 11),
// frame timing, progress; Iron Road: campaign tab gating, mouse-built 101, a derail callout (102), 108, the
// follow-camera scenery cache, and the finale (120 only). Exit code 0 = all checks passed.
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
  const ls = await page.evaluate(() => ({ tiles: document.querySelectorAll('.tile').length, soon: document.querySelectorAll('.tile.soon').length, chapters: Array.from(document.querySelectorAll('.chapter h3')).map(h => h.textContent), ranges: Array.from(document.querySelectorAll('.chapter .ch-text p')).map(p => p.textContent.split(' · ')[0]), levels: BG.Levels.filter(l => l.campaign !== 'rail').length, tab: BG.Hud.tab }));
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

  ok('no console errors', errors.length === 0, errors.slice(0, 15));
  console.log(`\n${results.filter(r => r.pass).length}/${results.length} e2e checks passed`);
  await browser.close();
  process.exit(results.every(r => r.pass) ? 0 : 1);
})().catch(e => { console.error('ERR', e); process.exit(2); });
