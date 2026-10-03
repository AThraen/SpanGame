// Headless mobile / touch test for SPAN (js/features/mobile.js + css/mobile.css). Never opens a window.
// Usage: node tools/test-mobile.js [outDir=%TEMP%/span-mobile] [--only=<device>] [--no-shots]
// For every device (phone portrait / landscape, Android, iPad both ways; touch emulation):
//   - no visible HUD element overflows the viewport on title, level select, settings, edit, sheet,
//     templates, sim and results; HUD buttons are >= 44 px touch targets
//   - level 1's reference solution is built with real touch input (CDP touch events -> pointer events):
//     drag from an anchor, tap to finish the chain, pick wood in the palette / bottom sheet, drag a strut,
//     tap to stop; then Test is tapped and the run passes
//   - the magnifier loupe shows while dragging; long-press + lift opens the context menu (delete / undo)
//   - pinch zoom changes the camera in the editor and in the test view; one-finger pan in the test view
//   - haptics fire, BG.Perf is active on phones, rotate prompt appears in portrait on phones only
//   - offset cursor (Android run): the beam end follows the aim point above the finger
//   - phase 2, every screen the other features added: campaign tabs (Roads / Iron Road / Famous Bridges),
//     goals button + panel (closed by default on phones, closes when the canvas is touched) and the results
//     badge reveal; Iron Road track strip, derail callout and ride-quality results; daily panel (44 px days,
//     selected day in view), daily share card and endless score in the results; famous tiles, the history card
//     (scrolls with a finger) and the famous top bar; Forces of Nature forecast chip and warning banner; the
//     results action row stays on screen (Iron Road: ride card above the footer, "More below" cue); the title with
//     Continue / Resume
// Exit code 0 = all checks passed.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const url = require('url');
const ROOT = path.resolve(__dirname, '..');
const sol = n => JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'solutions', 'level-' + String(n).padStart(2, '0') + '.json'), 'utf8'));
const args = process.argv.slice(2);
const OUT = args.find(a => !a.startsWith('--')) || path.join(require('os').tmpdir(), 'span-mobile');
const ONLY = (args.find(a => a.startsWith('--only=')) || '').slice(7);
const SHOTS = !args.includes('--no-shots');
fs.mkdirSync(OUT, { recursive: true });

const UA_PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const UA_TAB = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const DEVICES = [
  { name: 'phone-portrait', viewport: { width: 390, height: 844 }, dsf: 3, ua: UA_PHONE, phone: true },
  { name: 'phone-landscape', viewport: { width: 844, height: 390 }, dsf: 3, ua: UA_PHONE, phone: true },
  { name: 'android-portrait', viewport: { width: 360, height: 740 }, dsf: 3, ua: UA_PHONE, phone: true, offset: true },
  { name: 'ipad-portrait', viewport: { width: 820, height: 1180 }, dsf: 2, ua: UA_TAB, phone: false },
  { name: 'ipad-landscape', viewport: { width: 1180, height: 820 }, dsf: 2, ua: UA_TAB, phone: false },
];

const results = [];
let prefix = '';
const ok = (name, cond, info) => {
  results.push({ name: prefix + name, pass: !!cond });
  console.log((cond ? 'PASS ' : 'FAIL ') + prefix + name + (info !== undefined && !cond ? '  ' + JSON.stringify(info) : ''));
};
const wait = ms => new Promise(r => setTimeout(r, ms));

// every visible element in #ui must lie inside the viewport (elements clipped by an on-screen scroll
// container are fine); also no horizontal page scroll
const OVERFLOW_JS = () => {
  const W = innerWidth, H = innerHeight, bad = [];
  const visible = el => {
    for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false;
    }
    return true;
  };
  const clippedOk = el => {
    for (let p = el.parentElement; p && p.id !== 'ui'; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden)/.test(cs.overflowX + cs.overflowY)) {
        const r = p.getBoundingClientRect();
        if (r.left >= -1 && r.top >= -1 && r.right <= W + 1 && r.bottom <= H + 1) return true;
      }
    }
    return false;
  };
  document.querySelectorAll('#ui *').forEach(el => {
    if (el instanceof SVGElement && el.tagName !== 'svg') return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    if (r.left >= -1 && r.top >= -1 && r.right <= W + 1 && r.bottom <= H + 1) return;
    if (!visible(el) || clippedOk(el)) return;
    bad.push((el.className && typeof el.className === 'string' ? el.className.split(' ').slice(0, 2).join('.') : el.tagName) + ' [' + [r.left, r.top, r.right, r.bottom].map(Math.round).join(',') + ']');
  });
  const se = document.scrollingElement || document.documentElement;
  if (se.scrollWidth > W + 1) bad.push('page scrollWidth ' + se.scrollWidth);
  return bad.slice(0, 8);
};
// every visible element matching sel lies fully inside the viewport and is the topmost element at its centre
// (a sticky action row inside a scrolled card counts; a button hidden under another overlay does not)
const REACHABLE_JS = (sel) => {
  const bad = [];
  document.querySelectorAll(sel).forEach(b => {
    const r = b.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || b.closest('[hidden]')) return;
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    if (r.top < -1 || r.left < -1 || r.bottom > innerHeight + 1 || r.right > innerWidth + 1 || !top || !(top === b || b.contains(top)))
      bad.push((b.dataset.act || b.className.split(' ')[0]) + ' [' + [r.left, r.top, r.right, r.bottom].map(Math.round).join(',') + '] under ' + (top ? top.className || top.tagName : 'nothing'));
  });
  return bad.slice(0, 6);
};
// visible HUD buttons smaller than 44 px
const TARGETS_JS = (sel) => {
  const out = [];
  const visible = el => {
    for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05 || cs.pointerEvents === 'none' && p === el) return false;
    }
    return true;
  };
  document.querySelectorAll(sel).forEach(b => {
    const r = b.getBoundingClientRect();
    if (r.width < 1 || !visible(b)) return;
    if (Math.min(r.width, r.height) < 43.5) out.push((b.dataset.act || b.dataset.tool || b.dataset.mat || b.dataset.speed || b.className.split(' ')[0]) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  });
  return out.slice(0, 10);
};

async function runDevice(browser, dev) {
  prefix = dev.name + ': ';
  const ctx = await browser.newContext({ viewport: dev.viewport, deviceScaleFactor: dev.dsf, isMobile: true, hasTouch: true, userAgent: dev.ua });
  await ctx.addInitScript(() => { window.__vib = 0; try { Object.defineProperty(navigator, 'vibrate', { configurable: true, value: function () { window.__vib++; return true; } }); } catch (e) { /* */ } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const cdp = await ctx.newCDPSession(page);
  const tp = (pts) => pts.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: p.id != null ? p.id : i, radiusX: 3, radiusY: 3, force: 1 }));
  const T = {
    start: pts => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(pts) }),
    move: pts => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(pts) }),
    end: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
    async tap(p) { await T.start([p]); await wait(45); await T.end(); await wait(90); },
    async drag(a, b, opts) {
      opts = opts || {};
      const n = opts.steps || 12;
      await T.start([a]); await wait(30);
      for (let i = 1; i <= n; i++) { await T.move([{ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n }]); await wait(18); }
      await wait(60);
      if (opts.during) await opts.during();
      await T.end(); await wait(110);
    },
    async pinch(c, d0, d1, steps) {
      steps = steps || 10;
      const P = d => [{ x: c.x - d / 2, y: c.y, id: 0 }, { x: c.x + d / 2, y: c.y, id: 1 }];
      await T.start(P(d0)); await wait(30);
      for (let i = 1; i <= steps; i++) { await T.move(P(d0 + (d1 - d0) * i / steps)); await wait(18); }
      await T.end(); await wait(120);
    },
  };
  const center = sel => page.evaluate(s => { const el = document.querySelector(s); if (!el) return null; let r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth) { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); r = el.getBoundingClientRect(); } return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }, sel);
  const tapEl = async sel => { const c = await center(sel); if (!c) throw new Error('no element ' + sel); await T.tap(c); };
  const W2S = (x, y) => page.evaluate(([x, y]) => { const p = BG.Game.renderer.worldToScreen(x, y); const r = BG.Game.canvas.getBoundingClientRect(); return { x: p.x + r.left, y: p.y + r.top }; }, [x, y]);
  const onCanvas = p => page.evaluate(({ x, y }) => document.elementFromPoint(x, y) === BG.Game.canvas, p);
  const shot = async n => { if (SHOTS) await page.screenshot({ path: path.join(OUT, dev.name + '-' + n + '.png') }); };
  const overflow = async (label) => { const bad = await page.evaluate(OVERFLOW_JS); ok('no overflow: ' + label, bad.length === 0, bad); };
  const targets = async (label, sel) => { const bad = await page.evaluate(TARGETS_JS, sel); ok('touch targets >= 44 px: ' + label, bad.length === 0, bad); };
  const reachable = async (label, sel) => { const bad = await page.evaluate(REACHABLE_JS, sel); ok('on screen and tappable: ' + label, bad.length === 0, bad); };
  const runSim = (maxSec) => page.evaluate((maxSec) => {
    const g = BG.Game; let t = 0;
    while (g.state === 'sim' && t < maxSec) { g._updateSim(1 / 6); t += 1 / 6; }
    const r = g.lastResult;
    return { state: g.state, res: r && { passed: r.passed, stars: r.stars, reason: r.reason } };
  }, maxSec);
  const quiet = () => page.evaluate(() => { BG.Hud.hideHint(); if (BG.Mobile.rotatePromptVisible()) document.querySelector('[data-mact=rotateOk]').click(); });
  const waitFor = async (fn, arg, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 15000)) { if (await page.evaluate(fn, arg)) return true; await wait(120); } return false; };
  const startWith = (design) => page.evaluate((d) => { if (d) BG.Game._replaceDesign(BG.Model.clone(d)); BG.Game._lastToggle = -1e9; BG.Game.startSim(); }, design || null);

  await page.goto(url.pathToFileURL(path.join(ROOT, 'index.html')).href + '?unlockall');
  await page.waitForTimeout(2300);
  const env = await page.evaluate(() => ({ cls: document.documentElement.className, coarse: matchMedia('(pointer: coarse)').matches, M: !!BG.Mobile, perf: BG.Perf && { low: BG.Perf.low, dpr: BG.Game.renderer.dpr, cap: BG.Perf.dprCap } }));
  ok('touch layer active', env.M && /m-touch/.test(env.cls) && (/m-phone/.test(env.cls) === dev.phone), env);
  ok('performance mode: phones auto-on, DPR <= 2', env.perf && env.perf.dpr <= 2 && (!dev.phone || env.perf.low), env.perf);

  // ---- title / level select / settings
  await overflow('title'); await targets('title', '#screen-title button'); await shot('01-title');
  await tapEl('#screen-title [data-act=play]'); await page.waitForTimeout(900);
  ok('tap Play -> level select', await page.evaluate(() => BG.Game.state) === 'levelSelect');
  await overflow('level select'); await targets('level select header + chapter (i)', '.ls-head button, .ch-info'); await shot('02-levels');
  await page.evaluate(() => BG.Hud.openSettings()); await page.waitForTimeout(450);
  await overflow('settings'); await targets('settings', '#settings .modal-head button, #settings .modal-foot button, #settings .m-set-row button');
  ok('settings: touch rows shown, keyboard row hidden', await page.evaluate(() => !!document.querySelector('[data-mset=loupe]') && getComputedStyle(document.querySelector('.set-row.keys')).display === 'none' && getComputedStyle(document.querySelector('.m-gestures')).display !== 'none'));
  await shot('03-settings');
  await tapEl('#settings .modal-foot [data-act=close]'); await page.waitForTimeout(350);
  ok('tap Done closes settings', !(await page.evaluate(() => BG.Hud.settingsOpen())));

  // ---- level 1 via a tile tap
  const tile = await center('.tile[data-id="1"]');
  await T.tap(tile); await page.waitForTimeout(1300);
  const lv1 = await page.evaluate((t) => ({ state: BG.Game.state, id: BG.Game.level && BG.Game.level.id, at: (document.elementFromPoint(t.x, t.y) || {}).className, settings: BG.Hud.settingsOpen() }), tile);
  ok('tap tile -> level 1 edit', lv1.state === 'edit' && lv1.id === 1, Object.assign(lv1, tile));
  const rot = await page.evaluate(() => BG.Mobile.rotatePromptVisible());
  ok('rotate prompt only on phones in portrait', rot === (dev.phone && dev.viewport.height > dev.viewport.width), rot);
  if (rot) { await tapEl('.m-rotate [data-mact=rotateOk]'); await page.waitForTimeout(400); }
  const hint = await page.evaluate(() => ({ show: document.querySelector('[data-ref=hint]').classList.contains('show'), text: document.querySelector('[data-ref=hintText]').textContent }));
  ok('hint wording adapted for touch', hint.show && !/right-click|\(Space\)|key 2/i.test(hint.text) && /tap/i.test(hint.text), hint.text);
  await overflow('edit + hint'); await targets('edit HUD', '#screen-level .topbar button, #screen-level .rail button, .test-btn, .m-mat-chip, [data-ref=hint] button');
  await shot('04-edit');
  await tapEl('[data-ref=hint] [data-act=hideHint]'); await page.waitForTimeout(450);
  const fit = await page.evaluate(() => { const r = BG.Game.renderer, t = BG.Game.level.terrain; const a = r.worldToScreen(t.leftEdge, 0), b = r.worldToScreen(t.rightEdge, 0); return { span: b.x - a.x, W: innerWidth, ins: BG.Mobile.lastInsets }; });
  ok('camera framed for the touch HUD', fit.ins && fit.span > fit.W * 0.25, fit);

  // ---- build level 1 (road a0 -> n1(6,0) -> a1, wood a3 -> n1) with touch only
  const pA0 = await W2S(0, 0), p6 = await W2S(6, 0), pA1 = await W2S(10, 0), pA3 = await W2S(10, -2.5);
  ok('build points are on the canvas (not under HUD)', (await onCanvas(pA0)) && (await onCanvas(p6)) && (await onCanvas(pA1)) && (await onCanvas(pA3)));
  let loupe = null;
  await T.drag(pA0, p6, { during: async () => { await shot('04b-loupe'); loupe = await page.evaluate(() => ({ v: BG.Mobile.loupeVisible, cls: document.querySelector('.m-loupe').classList.contains('show'), ghost: !!(BG.Game.editor.state.ghost) })); } });
  ok('magnifier loupe shows while dragging a beam', loupe && loupe.v && loupe.cls && loupe.ghost, loupe);
  let d = await page.evaluate(() => { const d = BG.Game.getDesign(); return { beams: d.beams.length, nodes: d.nodes.map(n => n.x + ',' + n.y), chain: BG.Game.editor.chainFrom }; });
  ok('touch drag builds the first road beam', d.beams === 1 && d.nodes[0] === '6,0' && d.chain === 'n1', d);
  await T.tap(pA1);
  d = await page.evaluate(() => ({ beams: BG.Game.getDesign().beams.length, chain: BG.Game.editor.chainFrom }));
  ok('tap on the far anchor finishes the road', d.beams === 2 && d.chain === null, d);
  // wood: bottom sheet on phones, palette on tablets
  if (dev.phone) {
    await tapEl('.m-mat-chip'); await page.waitForTimeout(450);
    ok('material chip opens the bottom sheet', await page.evaluate(() => BG.Mobile.sheetOpen()));
    await overflow('material sheet'); await targets('material sheet', '[data-ref=palette] .mat');
    await shot('05-sheet');
    await tapEl('[data-ref=palette] [data-mat=wood]'); await page.waitForTimeout(450);
    ok('picking wood closes the sheet', await page.evaluate(() => !BG.Mobile.sheetOpen() && BG.Game.editor.material === 'wood' && /Wood/.test(document.querySelector('.m-mat-chip b').textContent)));
  } else {
    await tapEl('[data-ref=palette] [data-mat=wood]'); await page.waitForTimeout(250);
    ok('tap palette picks wood', await page.evaluate(() => BG.Game.editor.material === 'wood'));
  }
  if (dev.offset) {
    // offset cursor: the finger ends 64 px below n1, the aim point (and the beam end) is on n1
    await page.evaluate(() => BG.Mobile.settings.set('offsetCursor', true));
    let ret = null;
    const below = { x: p6.x, y: p6.y + 64 };
    await T.drag(pA3, below, { steps: 14, during: async () => { ret = await page.evaluate(() => ({ r: document.querySelector('.m-reticle').classList.contains('show'), snap: BG.Game.editor.state.ghost && BG.Game.editor.state.ghost.snapNode })); } });
    ok('offset cursor: reticle shown and beam end aims above the finger', ret && ret.r && ret.snap === 'n1', ret);
    await page.evaluate(() => BG.Mobile.settings.set('offsetCursor', false));
  } else {
    await T.drag(pA3, p6);
  }
  d = await page.evaluate(() => { const d = BG.Game.getDesign(); return { beams: d.beams.map(b => b.a + '-' + b.b + ':' + b.m), chain: BG.Game.editor.chainFrom }; });
  ok('wood strut snaps to the road joint', d.beams.length === 3 && d.beams.indexOf('a3-n1:wood') >= 0 && d.chain === 'n1', d);
  await T.tap(p6); // tap the chain joint again: stop building
  ok('tap the last joint again stops the chain', await page.evaluate(() => BG.Game.editor.chainFrom === null));
  const v = await page.evaluate(() => { const d = BG.Game.getDesign(); return { ok: BG.Model.validate(BG.Game.level, d).ok, n: d.beams.length, cost: BG.Game.getCost() }; });
  ok('level 1 solution built by touch is valid', v.ok && v.n === 3, v);
  ok('haptics fired (snap / place)', (await page.evaluate(() => window.__vib)) > 0);
  await shot('06-built');

  // ---- long-press + lift on the joint -> context menu -> delete, then undo from the menu
  await T.start([p6]); await wait(Math.round(700)); await T.end(); await wait(200);
  const cm = await page.evaluate(() => ({ open: BG.Mobile.ctxOpen, target: BG.Mobile.ctxTarget, chain: BG.Game.editor.chainFrom, items: Array.from(document.querySelectorAll('.m-ctx button')).map(b => b.textContent) }));
  ok('long-press + lift opens the context menu (not a tap)', cm.open && cm.target === 'joint' && cm.chain === null && cm.items.some(t => /Delete joint/.test(t)), cm);
  await overflow('context menu'); await targets('context menu', '.m-ctx button');
  await shot('07-context');
  await tapEl('.m-ctx button.danger'); await page.waitForTimeout(150);
  ok('context menu deletes the joint', await page.evaluate(() => BG.Game.getDesign().beams.length === 0 && !BG.Mobile.ctxOpen));
  const empty = await W2S(5, 3);
  await T.start([empty]); await wait(700); await T.end(); await wait(200);
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.m-ctx button')).find(x => /Undo/.test(x.textContent)); window.__undoBtn = !!b; });
  const ub = await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.m-ctx button')).find(x => /Undo/.test(x.textContent)); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await T.tap(ub); await page.waitForTimeout(150);
  ok('context menu undo restores the bridge', await page.evaluate(() => BG.Game.getDesign().beams.length === 3 && BG.Model.validate(BG.Game.level, BG.Game.getDesign()).ok));

  // ---- pinch zoom + two-finger pan in the editor
  const z0 = await page.evaluate(() => ({ z: BG.Game.renderer.camera.zoom, n: BG.Game.getDesign().beams.length }));
  const mid = await W2S(5, 1.5);
  await T.pinch(mid, 80, 200);
  const z1 = await page.evaluate(() => ({ z: BG.Game.renderer.camera.zoom, n: BG.Game.getDesign().beams.length }));
  ok('pinch zoom (editor) changes the camera, design untouched', z1.z > z0.z * 1.5 && z1.n === z0.n, { z0, z1 });
  // two fingers moving together pan the editor view
  const c0 = await page.evaluate(() => BG.Game.renderer.camera.x);
  await T.start([{ x: mid.x - 50, y: mid.y, id: 0 }, { x: mid.x + 50, y: mid.y, id: 1 }]); await wait(30);
  for (let i = 1; i <= 8; i++) { await T.move([{ x: mid.x - 50 + i * 10, y: mid.y, id: 0 }, { x: mid.x + 50 + i * 10, y: mid.y, id: 1 }]); await wait(18); }
  await T.end(); await wait(120);
  const c1 = await page.evaluate(() => ({ x: BG.Game.renderer.camera.x, n: BG.Game.getDesign().beams.length }));
  ok('two-finger pan (editor) moves the camera', Math.abs(c1.x - c0) > 0.3 && c1.n === z0.n, { c0, c1 });
  await page.evaluate(() => BG.Mobile.fitLevel());
  await page.waitForTimeout(100);

  // ---- tap Test, pinch + pan in the test view, run to the result
  await tapEl('.test-btn'); await page.waitForTimeout(500);
  ok('tap Test starts the run', await page.evaluate(() => BG.Game.state) === 'sim');
  await overflow('sim'); await targets('sim controls', '#screen-level .simbar button, .test-btn');
  await shot('08-sim');
  const s0 = await page.evaluate(() => ({ ...BG.Game.renderer.camera }));
  const smid = { x: dev.viewport.width / 2, y: dev.viewport.height * 0.4 };
  await T.pinch(smid, 70, 170);
  const s1 = await page.evaluate(() => ({ ...BG.Game.renderer.camera }));
  ok('pinch zoom (test view) changes the camera', s1.zoom > s0.zoom * 1.4, { s0: s0.zoom, s1: s1.zoom });
  await T.drag({ x: smid.x, y: smid.y }, { x: smid.x + 80, y: smid.y });
  const s2 = await page.evaluate(() => ({ ...BG.Game.renderer.camera }));
  ok('one-finger pan (test view) moves the camera', Math.abs(s2.x - s1.x) > 0.5, { s1: s1.x, s2: s2.x });
  const r = await page.evaluate(() => {
    const g = BG.Game; let t = 0;
    while (g.state === 'sim' && t < 60) { g._updateSim(1 / 6); t += 1 / 6; }
    return { state: g.state, res: g.lastResult && { passed: g.lastResult.passed, stars: g.lastResult.stars } };
  });
  await page.waitForTimeout(1600);
  ok('touch-built level 1 passes', r.state === 'results' && r.res && r.res.passed, r);
  await overflow('results'); await targets('results', '.res-actions button');
  await shot('09-results');
  await page.waitForTimeout(1800); // staged badge reveal
  const rb = await page.evaluate(() => { const b = document.querySelector('.res-badges'); return { show: !!b && !b.hidden && b.classList.contains('show'), n: document.querySelectorAll('.res-badges .rb').length, in: document.querySelectorAll('.res-badges .rb.in').length }; });
  ok('goals: badge reveal in the results card', rb.show && rb.n >= 2 && rb.in === rb.n, rb);
  await overflow('results + badges'); await reachable('results actions (badges)', '.res-actions button');
  await shot('09b-results-badges');
  await tapEl('[data-act=resEdit]'); await page.waitForTimeout(500);
  ok('tap Edit returns to the editor', await page.evaluate(() => BG.Game.state === 'edit' && BG.Game.getDesign().beams.length === 3));

  // ---- integration: History screen (history.js), Install + Save data rows (pwa.js / history.js) under the touch layout
  await page.evaluate(() => BG.Game.goLevelSelect()); await page.waitForTimeout(700);
  await overflow('level select (with History button)'); await targets('level select header + chapter (i)', '.ls-head button, .ch-info');
  await page.evaluate(() => BG.Hud.setCampaignTab && BG.Hud.setCampaignTab('rail')); await page.waitForTimeout(400);
  await overflow('level select (rail tab)'); await shot('02b-levels-rail');
  await page.evaluate(() => BG.Hud.setCampaignTab && BG.Hud.setCampaignTab('road')); await page.waitForTimeout(300);
  await tapEl('#screen-levels .hist-open'); await page.waitForTimeout(450);
  ok('History opens from the level-select header', await page.evaluate(() => BG.History.isOpen()));
  for (const tab of ['runs', 'levels', 'stats']) {
    await tapEl('#history [data-htab=' + tab + ']'); await page.waitForTimeout(250);
    await overflow('history ' + tab); await targets('history ' + tab, '#history button, #history select');
    await shot('11-history-' + tab);
  }
  await tapEl('#history [data-htab=runs]'); await page.waitForTimeout(150);
  await page.selectOption('#history [data-hfilter=level]', '1'); await page.waitForTimeout(250);
  ok('history: level filter shows the sparkline and the touch-built run', await page.evaluate(() => !!document.querySelector('#history .hist-lvhead .hist-spark') && document.querySelectorAll('#history .hist-run').length >= 1));
  await overflow('history runs (level 1)'); await shot('11-history-level');
  // a long run list must scroll with a finger (the touch guards only let known scrollers scroll)
  await page.evaluate(() => {
    for (let i = 0; i < 30; i++) BG.History.recordRun({ levelId: 1, passed: i % 3 > 0, simOk: true, stars: i % 3, cost: 1200 + i * 10, budget: 1900, members: 3, peak: 0.5, time: 16, broken: 0, reason: i % 3 ? null : 'vehicle_fell' });
    BG.History.open('runs');
  });
  await page.waitForTimeout(200);
  const hb = await center('#history .hist-body');
  await T.drag({ x: hb.x, y: hb.y + hb.h * 0.3 }, { x: hb.x, y: hb.y - hb.h * 0.3 }, { steps: 10 });
  await page.waitForTimeout(300);
  const hs = await page.evaluate(() => { const b = document.querySelector('#history .hist-body'); return { top: b.scrollTop, max: b.scrollHeight - b.clientHeight }; });
  ok('history list scrolls with a finger', hs.max > 0 && hs.top > 0, hs);
  await tapEl('#history [data-hact=close]'); await page.waitForTimeout(350);
  ok('History closes', !(await page.evaluate(() => BG.History.isOpen())));
  // a fake beforeinstallprompt makes the PWA "Install SPAN" row appear (headless never fires the real one)
  await page.evaluate(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = () => Promise.resolve(); e.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.dispatchEvent(e); BG.Hud.openSettings(); });
  await page.waitForTimeout(450);
  await page.evaluate(() => { const c = document.querySelector('#settings .modal-card'); c.scrollTop = c.scrollHeight; }); await page.waitForTimeout(150);
  ok('settings: Install and Save data rows shown', await page.evaluate(() => !document.querySelector('[data-pwa=install]').hidden && !!document.querySelector('#settings .hist-save')));
  await overflow('settings (install + save rows)'); await targets('settings install / save', '#settings .pwa-btn, #settings .hist-save button');
  await shot('03b-settings-bottom');
  await page.evaluate(() => BG.Hud.closeSettings ? BG.Hud.closeSettings() : document.querySelector('#settings .modal-foot [data-act=close]').click()); await page.waitForTimeout(350);

  // ---- templates sheet (level 4)
  await page.evaluate(() => BG.Game.openLevel(4, { force: true })); await page.waitForTimeout(1100);
  await page.evaluate(() => { BG.Hud.hideHint(); if (BG.Mobile.rotatePromptVisible()) document.querySelector('[data-mact=rotateOk]').click(); });
  await page.waitForTimeout(300);
  await tapEl('[data-act=templates]'); await page.waitForTimeout(450);
  ok('templates menu opens', await page.evaluate(() => BG.Hud.templatesOpen()));
  await overflow('templates'); await shot('10-templates');
  await tapEl('[data-tpl=warren]'); await page.waitForTimeout(300);
  ok('tap template applies it', await page.evaluate(() => BG.Game.getDesign().beams.length > 5));

  // ================================================================ phase 2: feature screens
  // ---- goals panel in the editor (level 1)
  await page.evaluate(() => BG.Game.openLevel(1, { force: true })); await page.waitForTimeout(900); await quiet(); await page.waitForTimeout(300);
  const g0 = await page.evaluate(() => BG.GoalsUI.isOpen());
  if (dev.phone) ok('goals: panel starts closed on phones', g0 === false, g0);
  if (g0) { await tapEl('#screen-level .goals-btn'); await page.waitForTimeout(350); }
  await tapEl('#screen-level .goals-btn'); await page.waitForTimeout(450);
  ok('goals: tap the Goals button opens the panel', await page.evaluate(() => BG.GoalsUI.isOpen() && document.querySelector('.goals-panel').classList.contains('open')));
  await overflow('goals panel'); await targets('goals', '#screen-level .goals-btn, .goals-panel button, #screen-level .topbar button');
  await shot('12-goals');
  if (dev.phone) {
    // a canvas point that is not under the panel (or any other HUD)
    let pt = null;
    for (const [wx, wy] of [[5, -5], [5, 4], [1, -6], [9, -6], [5, -9]]) { const p = await W2S(wx, wy); if (await onCanvas(p)) { pt = p; break; } }
    ok('goals: some canvas stays free beside the open panel', !!pt);
    if (pt) await T.tap(pt);
    await page.waitForTimeout(350);
    ok('goals: touching the canvas closes the panel (phones)', !(await page.evaluate(() => BG.GoalsUI.isOpen())));
  } else { await tapEl('#screen-level .goals-btn'); await page.waitForTimeout(300); }

  // ---- campaign tabs + famous tiles
  await page.evaluate(() => BG.Game.goLevelSelect()); await page.waitForTimeout(600);
  for (const camp of ['rail', 'famous']) {
    await tapEl('#screen-levels .camp-tab[data-camp=' + camp + ']'); await page.waitForTimeout(500);
    ok('campaign tab ' + camp + ' opens with a tap', await page.evaluate(c => BG.Hud.tab === c, camp));
    await overflow('level select ' + camp); await targets('campaign tabs + tiles (' + camp + ')', '.ls-head button, .camp-tab, .fb-tile');
    await shot('13-levels-' + camp);
  }
  // ---- famous history card (intro) + famous level top bar
  await tapEl('.fb-tile[data-id="201"]'); await page.waitForTimeout(700);
  ok('famous: tile tap shows the history card', await page.evaluate(() => BG.Famous.card.open));
  await overflow('famous history card'); await targets('famous card', '.fb-overlay button'); await reachable('famous card actions', '.fb-actions button');
  await shot('14-famous-card');
  const sc = await page.evaluate(() => { const c = ['.fb-body', '.fb-card'].map(s => document.querySelector(s)).find(e => e && e.scrollHeight > e.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(e).overflowY)); if (!c) return null; const r = c.getBoundingClientRect(); return { sel: c.className, x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height }; });
  if (sc) {
    await T.drag({ x: sc.x, y: sc.y + sc.h * 0.25 }, { x: sc.x, y: sc.y - sc.h * 0.25 }, { steps: 8 }); await page.waitForTimeout(250);
    ok('famous card scrolls with a finger', await page.evaluate(s => document.querySelector('.' + s.split(' ')[0]).scrollTop > 0, sc.sel), sc);
  }
  await tapEl('.fb-actions [data-fb=build]'); await page.waitForTimeout(1100); await quiet(); await page.waitForTimeout(300);
  ok('famous: Build it opens level 201', await page.evaluate(() => BG.Game.state === 'edit' && BG.Game.level.id === 201));
  await overflow('famous level edit'); await targets('famous top bar', '#screen-level .topbar button');
  await shot('15-famous-edit');
  await tapEl('#screen-level [data-fb-history]'); await page.waitForTimeout(500);
  ok('famous: history button reopens the card', await page.evaluate(() => BG.Famous.card.open));
  await overflow('famous card (info)'); await reachable('famous card close', '.fb-actions button');
  await tapEl('.fb-actions [data-fb=close]'); await page.waitForTimeout(400);

  // ---- Iron Road: track strip, ride-quality results, derail callout
  await page.evaluate(() => BG.Game.openLevel(101, { force: true })); await page.waitForTimeout(900); await quiet(); await page.waitForTimeout(250);
  await startWith(sol(101)); await page.evaluate(() => { const g = BG.Game; for (let t = 0; t < 2.5 && g.state === 'sim'; t += 1 / 6) g._updateSim(1 / 6); });
  await page.waitForTimeout(500);
  ok('Iron Road: track strip shows in the run', await page.evaluate(() => document.querySelector('[data-ref=track]').classList.contains('show')));
  await overflow('rail sim + track strip'); await targets('rail sim controls', '#screen-level .simbar button, .test-btn');
  ok('track strip clear of the sim controls and the top bar', await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect(), a = r('[data-ref=track]');
    const hit = (b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    return !hit(r('#screen-level .simbar')) && !hit(r('#screen-level .topbar')) && !hit(r('.test-btn'));
  }));
  await shot('16-rail-sim');
  let rr = await runSim(60); await page.waitForTimeout(2600);
  const ride = await page.evaluate(() => { const c = document.querySelector('.ride-card'); return !!c && !c.closest('[hidden]'); });
  ok('Iron Road: 101 passes, ride-quality card shown', rr.res && rr.res.passed && ride, rr);
  await overflow('rail results'); await targets('rail results', '.res-actions button'); await reachable('rail results actions', '.res-actions button');
  await shot('17-rail-results');
  // the ride card and both verdicts are fully visible above the action footer without scrolling (phone landscape
  // used to hide the ride card behind it); while the card has more below, the footer says so - and not at the bottom
  const rideVis = await page.evaluate(() => {
    const card = document.querySelector('.results-card'), act = card.querySelector('.res-actions').getBoundingClientRect(), cr = card.getBoundingClientRect();
    const box = s => { const r = card.querySelector(s).getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; };
    const ride = box('.ride-card'), rv = box('.rv-row');
    const vis = b => b.top >= cr.top - 1 && b.bottom <= act.top + 1 && b.left >= cr.left - 1 && b.right <= cr.right + 1;
    return { ride, rv, footer: Math.round(act.top), scrollTop: card.scrollTop, ok: card.scrollTop === 0 && vis(ride) && vis(rv) };
  });
  ok('rail results: ride card + verdicts visible above the action footer without scrolling', rideVis.ok, rideVis);
  const more = await page.evaluate(async () => {
    const card = document.querySelector('.results-card');
    const scrolls = card.scrollHeight - card.clientHeight > 6;
    const before = card.classList.contains('m-more');
    const cue = getComputedStyle(card.querySelector('.res-actions'), '::before').content;
    card.scrollTop = card.scrollHeight; card.dispatchEvent(new Event('scroll'));
    await new Promise(r => setTimeout(r, 120));
    const after = card.classList.contains('m-more');
    card.scrollTop = 0; card.dispatchEvent(new Event('scroll'));
    await new Promise(r => setTimeout(r, 60));
    return { scrolls, before, after, cue };
  });
  ok('rail results: "More below" cue while the card has more, gone at the bottom', more.before === more.scrolls && !more.after && (!dev.phone || /More below/.test(more.cue)), more);
  await page.evaluate(() => BG.Game.openLevel(102, { force: true })); await page.waitForTimeout(900); await quiet();
  await startWith({ nodes: [{ id: 'n1', x: 4, y: 0 }, { id: 'n2', x: 8, y: 0 }], beams: [{ a: 'a0', b: 'n1', m: 'rail' }, { a: 'n1', b: 'n2', m: 'rail' }, { a: 'n2', b: 'a1', m: 'rail' }], piers: [] });
  const der = await page.evaluate(() => { const g = BG.Game; for (let i = 0; i < 60 * 20 && g.state === 'sim' && !g._derailFx; i++) g._updateSim(1 / 60); return !!g._derailFx; });
  await page.waitForTimeout(400);
  const dc = await page.evaluate(() => { const d = document.querySelector('[data-ref=derail]'); const r = d.firstElementChild.getBoundingClientRect(); return { der: d.classList.contains('show'), in: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, txt: d.textContent }; });
  ok('Iron Road: derail callout fully on screen', der && dc.der && dc.in, dc);
  ok('derail callout wording has no keyboard / mouse terms', !/click|(key|Space)|hover/i.test(dc.txt), dc.txt);
  await overflow('derail callout'); await shot('18-rail-derail');
  rr = await runSim(40); await page.waitForTimeout(1500);
  ok('102 bare track fails as derailed', rr.res && rr.res.reason === 'derailed', rr);
  await overflow('rail results (derailed)'); await reachable('rail results actions (derailed)', '.res-actions button');
  await shot('19-rail-results-derailed');

  // ---- Forces of Nature: forecast chip (phones) and the warning banner
  await page.evaluate(() => BG.Game.openLevel(51, { force: true })); await page.waitForTimeout(900); await quiet(); await page.waitForTimeout(300);
  const fc = await page.evaluate(() => { const e = document.querySelector('.fx-forecast'); if (!e) return null; const r = e.getBoundingClientRect(); return { vis: getComputedStyle(e).display !== 'none' && r.width > 0, n: e.querySelectorAll('.fx-item').length }; });
  ok('forces: forecast visible while building', fc && (fc.vis && fc.n > 0 || !dev.phone && dev.viewport.width < 1100), fc);
  await overflow('forces edit (forecast)'); await shot('20-forces-edit');
  await startWith(sol(51));
  const t0 = await page.evaluate(() => { const pl = BG.ForcesFx.plan(BG.Game.level); return pl && pl.tl && pl.tl.length ? pl.tl[0].start : 3; });
  await page.evaluate((t0) => { const g = BG.Game; for (let t = 0; t < t0 + 0.4 && g.state === 'sim'; t += 1 / 6) g._updateSim(1 / 6); }, t0);
  await page.waitForTimeout(500);
  const fb = await page.evaluate(() => { const b = document.querySelector('.fx-banner'); const r = b.getBoundingClientRect(); return { show: b.classList.contains('show'), in: r.left >= 0 && r.right <= innerWidth && r.top >= 0, w: Math.round(r.width) }; });
  ok('forces: warning banner shown and on screen', fb.show && fb.in, fb);
  await overflow('forces sim (banner)'); await targets('forces sim controls', '#screen-level .simbar button');
  await shot('21-forces-sim');
  await runSim(80); await page.waitForTimeout(400);

  // ---- Daily: panel, play, share card; Endless: score card
  await page.evaluate(() => { BG.Game.goTitle(); BG.Daily.openPanel(); }); await page.waitForTimeout(400);
  ok('daily: panel shows the crossing', await waitFor(() => document.querySelector('[data-dref=name]').textContent !== 'Surveying…', null, 20000));
  await page.waitForTimeout(300);
  await overflow('daily panel'); await targets('daily panel', '#daily-panel button');
  const strip = await page.evaluate(() => { const s = document.querySelector('.dly-hist'), d = s.querySelector('.dly-day.sel'); const a = s.getBoundingClientRect(), b = d.getBoundingClientRect(); return { days: s.children.length, sel: b.left >= a.left - 1 && b.right <= a.right + 1 }; });
  ok('daily: 14-day strip with the selected day in view', strip.days === 14 && strip.sel, strip);
  await shot('22-daily-panel');
  await tapEl('#daily-panel [data-dly=play]');
  ok('daily: Play opens the crossing', await waitFor(() => BG.Game.state === 'edit' && /^daily-/.test(BG.Game.level.id), null, 20000));
  await page.waitForTimeout(500); await quiet();
  await overflow('daily edit'); await targets('daily top bar', '#screen-level .topbar button');
  await page.evaluate(() => BG.Game._replaceDesign(BG.Model.clone(BG.Game.level.generator.solution.design)));
  await startWith(); rr = await runSim(120); await page.waitForTimeout(1800);
  const share = await page.evaluate(() => ({ txt: (document.querySelector('.dly-share-text') || {}).textContent || '' }));
  ok('daily: pass shows the share card', rr.res && rr.res.passed && /SPAN Daily/.test(share.txt), { rr, share });
  await overflow('daily results + share card'); await targets('daily results', '.res-actions button, .dly-res button'); await reachable('daily results actions', '.res-actions button');
  await shot('23-daily-results');
  await page.evaluate(() => BG.Daily.startEndless(true));
  ok('endless: a crossing opens', await waitFor(() => BG.Game.state === 'edit' && /^endless-/.test(BG.Game.level.id), null, 20000));
  await page.waitForTimeout(400); await quiet();
  await page.evaluate(() => BG.Game._replaceDesign(BG.Model.clone(BG.Game.level.generator.solution.design)));
  await startWith(); rr = await runSim(120); await page.waitForTimeout(1600);
  ok('endless: pass shows the run score', rr.res && rr.res.passed && /cleared/.test(await page.evaluate(() => (document.querySelector('.dly-res') || {}).textContent || '')), rr);
  await overflow('endless results'); await reachable('endless results actions', '.res-actions button');
  await shot('24-endless-results');

  // ---- title with Continue / Resume / Daily / Endless
  await page.evaluate(() => BG.Game.goTitle()); await page.waitForTimeout(1600);
  await overflow('title (all entry points)'); await targets('title (all entry points)', '#screen-title button');
  await shot('25-title-again');

  // ---- performance mode + particle cap
  const perf = await page.evaluate(() => {
    const P = BG.Perf;
    P.setMode('on');
    const E = BG.Effects.shared(); E.clear();
    for (let i = 0; i < 40; i++) BG.Effects.sparks(5, 0, 60, 1);
    const on = { low: P.low, n: E.particles.length, cap: P.maxParticles, cls: document.documentElement.classList.contains('m-lowperf') };
    P.setMode('off');
    const off = { low: P.low, cls: document.documentElement.classList.contains('m-lowperf'), cap: P.dprCap };
    P.setMode('auto'); E.clear();
    return { on, off };
  });
  ok('BG.Perf on: fewer particles (capped), off: full', perf.on.low && perf.on.cls && perf.on.n <= perf.on.cap && !perf.off.low && !perf.off.cls && perf.off.cap === 2, perf);
  ok('no page errors', errors.length === 0, errors.slice(0, 5));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    for (const dev of DEVICES) {
      if (ONLY && dev.name !== ONLY) continue;
      try { await runDevice(browser, dev); } catch (e) { ok('device run crashed', false, e.message); }
    }
  } finally { await browser.close(); }
  const fail = results.filter(r => !r.pass);
  console.log('\n' + (results.length - fail.length) + '/' + results.length + ' checks passed' + (fail.length ? '; FAILED: ' + fail.map(f => f.name).join(' | ') : ''));
  console.log('screenshots: ' + OUT);
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
