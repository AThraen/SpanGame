// SPAN — regenerates the README / docs screenshots in docs/screenshots/. Headless Chrome only; never opens a window.
// Usage: node tools/screenshots.js [--only hero,collapse,...] [--out dir]
// Every scene drives the real game with a fake clock (Playwright clock.install) and takes over its frame loop,
// so a scene renders the same frames on every run: load a level, put a saved solution from tools/solutions/
// (or a deliberately weakened copy, or a template) into the editor, start the test and step the game frame by
// frame to the moment worth showing. The collapse is captured frame by frame and encoded as a GIF by
// tools/gif.js (no external dependencies).
// Exploring: SPAN_LV=24 SPAN_T=5,8 [SPAN_VARIANT=thin3 | SPAN_TEMPLATE=warren] node tools/screenshots.js --only probe --out <dir>
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const url = require('url');
const { decodePNG, downscale, encodeGIF } = require('./gif');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const argVal = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const OUT = path.resolve(argVal('--out') || path.join(ROOT, 'docs', 'screenshots'));
const ONLY = argVal('--only') ? argVal('--only').split(',') : null;
fs.mkdirSync(OUT, { recursive: true });

const HREF = url.pathToFileURL(path.join(ROOT, 'index.html')).href;
const sol = n => JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'solutions', 'level-' + String(n).replace(/^\d+/, d => d.padStart(2, '0')) + '.json'), 'utf8'));
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const UA_PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const PHONE_LANDSCAPE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA_PHONE };

let browser;
const written = [];

async function newPage(ctxOpts, query, opts) {
  opts = opts || {};
  const ctx = await browser.newContext(Object.assign({}, ctxOpts));
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('  [pageerror] ' + e.message));
  await page.clock.install({ time: new Date(opts.date || '2026-10-05T10:00:00') });
  if (opts.init) await page.addInitScript(opts.init);
  await page.goto(HREF + (query ? '?' + query : ''));
  await page.clock.runFor(1600);
  // from here on the game only draws frames when a scene asks for them (advance), each with an exact dt,
  // so a scene always lands on the same moment no matter how long a screenshot takes
  await page.evaluate(() => {
    const g = BG.Game, frame = g._frame;
    let t = performance.now();
    g._frame = function () {};
    g._lastTs = t;
    window.__spanStep = (sec, fps) => { const n = Math.max(1, Math.round(sec * fps)); for (let i = 0; i < n; i++) { t += 1000 / fps; frame.call(g, t); } };
  });
  page._ctx = ctx;
  return page;
}
// advance the game by sec seconds: frames at fps, then the page's timers (toasts, card animations)
async function run(page, sec, fps) {
  await page.evaluate(([s, f]) => window.__spanStep(s, f), [sec, fps || 60]);
  await page.clock.runFor(Math.round(sec * 1000));
}
const E = (page, fn, arg) => page.evaluate(fn, arg);

// open a level in the editor with a design loaded (closes a Famous Bridges history card first)
async function openWithDesign(page, design) {
  await E(page, () => { if (BG.Famous && BG.Famous.card && BG.Famous.card.open) { const b = document.querySelector('[data-fb=build]'); if (b) b.click(); } });
  await run(page, 0.6);
  await E(page, d => {
    if (BG.Hud.hideHint) BG.Hud.hideHint();
    const close = document.querySelector('.goals-panel.open [data-goals-close]'); // the badges panel covers part of the view
    if (close) close.click();
    if (d) BG.Game._replaceDesign(d);
  }, design || null);
  await run(page, 0.4);
}
async function startTest(page, follow) {
  await E(page, f => { BG.Game.setFollow(!!f); BG.Game._lastToggle = -1e9; BG.Game.startSim(); }, !!follow);
}

async function save(page, name, opts) {
  opts = opts || {};
  const file = path.join(OUT, name);
  const jpeg = /\.jpe?g$/.test(name);
  await page.screenshot({ path: file, type: jpeg ? 'jpeg' : 'png', quality: jpeg ? (opts.quality || 82) : undefined, clip: opts.clip });
  written.push(file);
  console.log('  ' + path.relative(ROOT, file) + '  ' + Math.round(fs.statSync(file).size / 1024) + ' KB');
}

// ------------------------------------------------------------------ scenes
const W2S = (page, x, y) => E(page, ([x, y]) => { const p = BG.Game.renderer.worldToScreen(x, y); const r = BG.Game.canvas.getBoundingClientRect(); return { x: p.x + r.left, y: p.y + r.top }; }, [x, y]);
const nodePos = (design, level, id) => {
  if (/^a\d+$/.test(id)) return level.anchors[+id.slice(1)];
  if (/^p\d+$/.test(id)) { const p = design.piers[+id.slice(1)]; return { x: p.x, y: p.topY }; }
  return design.nodes.find(n => n.id === id);
};

// weakened copies of saved solutions, for the failure scenes
const VARIANTS = {
  thin3: d => { d.beams = d.beams.filter((b, i) => /rail|road/.test(b.m) || i % 3); },
  thin5: d => { d.beams = d.beams.filter((b, i) => /rail|road/.test(b.m) || i % 5); },
  cable2rope: d => { d.beams.forEach(b => { if (b.m === 'cable') b.m = 'rope'; }); },
};
const weakened = (id, v) => { const d = sol(id); VARIANTS[v](d); return d; };

const SCENES = {
  // exploration helper (not part of the default set): SPAN_LV=108 SPAN_T=4,8 [SPAN_FOLLOW=1] [SPAN_REF=1]
  // [SPAN_VARIANT=thin3|thin5|cable2rope] [SPAN_TEMPLATE=<template id>]
  async probe() {
    const lv = process.env.SPAN_LV, times = (process.env.SPAN_T || '5').split(',').map(Number);
    const page = await newPage(DESKTOP, 'level=' + lv + '&unlockall&noresume');
    const name = lv + (process.env.SPAN_REF ? '' : '-best');
    await openWithDesign(page, process.env.SPAN_TEMPLATE ? await templateDesign(page, process.env.SPAN_TEMPLATE) : process.env.SPAN_VARIANT ? weakened(name, process.env.SPAN_VARIANT) : sol(name));
    await startTest(page, !!process.env.SPAN_FOLLOW);
    let now = 0;
    for (const t of times) { await run(page, t - now); now = t; await save(page, 'probe-' + lv + '-' + t + '.jpg', { quality: 70 }); }
    await page._ctx.close();
  },

  // the editor mid-build: part of a truss placed, a member being dragged out with its length readout
  async editor() {
    const LV = +(process.env.SPAN_EDITOR_LEVEL || 22);
    const page = await newPage(DESKTOP, 'level=' + LV + '&unlockall&noresume');
    const level = await E(page, () => BG.Game.level);
    // take away the last few structural members; the first of them is the one being dragged
    const { keep, removed, full } = partial(sol(LV + '-best'), 4);
    await openWithDesign(page, keep);
    const drag = removed[0];
    await E(page, m => BG.Game.editor.setMaterial(m), drag.m);
    const A = nodePos(full, level, drag.a), B = nodePos(full, level, drag.b);
    const a = await W2S(page, A.x, A.y), b = await W2S(page, A.x + (B.x - A.x) * 0.8, A.y + (B.y - A.y) * 0.8);
    await page.mouse.move(a.x, a.y); await run(page, 0.1);
    await page.mouse.down(); await run(page, 0.1);
    for (let k = 1; k <= 8; k++) { await page.mouse.move(a.x + (b.x - a.x) * k / 8, a.y + (b.y - a.y) * k / 8); await run(page, 0.05); }
    await run(page, 0.3);
    await save(page, 'editor.jpg', { quality: 84 });
    await page._ctx.close();
  },

  // the title screen with its live demo bridge
  async title() {
    const page = await newPage(DESKTOP, 'noresume');
    await run(page, 6);
    await save(page, 'title.jpg', { quality: 84 });
    await page._ctx.close();
  },

  // a long suspension bridge carrying heavy traffic, live stress colours on
  async hero() {
    const page = await newPage(DESKTOP, 'level=47&unlockall&noresume');
    await openWithDesign(page, sol('47-best'));
    await startTest(page, false);
    await run(page, 29.5);
    await save(page, 'hero.jpg', { quality: 84 });
    await page._ctx.close();
  },

  // a truss whose hangers were swapped for rope: it snaps under two buses and drops them into the bay
  async collapse() {
    const page = await newPage(DESKTOP, 'level=24&unlockall&noresume');
    await openWithDesign(page, weakened('24-best', 'cable2rope'));
    await startTest(page, false);
    await E(page, () => { BG.Game._finishRun = () => {}; }); // keep the wreck on screen instead of the results card
    await run(page, 5.2);
    const clip = { x: 120, y: 250, width: 1200, height: 520 };
    const frames = [];
    const FPS = 12.5, N = 66;
    for (let i = 0; i < N; i++) {
      const png = await page.screenshot({ type: 'png', clip });
      frames.push(downscale(decodePNG(png), 2));
      await run(page, 1 / FPS);
      if (process.env.SPAN_DEBUG) console.log(i, await E(page, () => BG.Game.sim.time.toFixed(2) + ' broken ' + BG.Game.sim.beams.filter(b => b.broken).length));
    }
    const gif = encodeGIF(frames, { delay: 1000 / FPS, lastDelay: 1500 });
    const file = path.join(OUT, 'collapse.gif');
    fs.writeFileSync(file, gif);
    written.push(file);
    console.log('  ' + path.relative(ROOT, file) + '  ' + Math.round(gif.length / 1024) + ' KB (' + frames.length + ' frames, ' + frames[0].width + 'x' + frames[0].height + ')');
    await page._ctx.close();
  },

  // Iron Road: a steam train on a masonry-and-steel viaduct, smoke trailing, track recording strip open
  async ironroad() { await simShot('ironroad.jpg', 108, sol('108-best'), 5); },

  // Iron Road: a high-speed set derails on a humped deck; slow motion, the callout names the cause with numbers
  async derail() { await simShot('derail.jpg', 116, weakened('116-best', 'thin3'), 3.2); },

  // Famous Bridges: the history card that opens before the Golden Gate level
  async famous() {
    const page = await newPage(DESKTOP, 'level=208&unlockall&noresume');
    await run(page, 1.2);
    await save(page, 'famous-card.jpg', { quality: 88, clip: { x: 210, y: 130, width: 1020, height: 640 } });
    await page._ctx.close();
  },

  // Forces of Nature: the M8 earthquake on level 52 (the banks lurch and crack, the banner shows the shaking)
  // (the deck-arch template holds the traffic but not the shaking: it breaks up with a bus on it)
  async quake() {
    const page = await newPage(DESKTOP, 'level=52&unlockall&noresume');
    await openWithDesign(page, await templateDesign(page, 'deck_arch'));
    await startTest(page, false);
    await run(page, 15);
    await save(page, 'quake.jpg', { quality: 84 });
    await page._ctx.close();
  },

  // Forces of Nature: hurricane-force gusts and rain on level 51
  async wind() { await simShot('wind.jpg', 51, sol('51-best'), 11); },

  // Daily Challenge: today's generated crossing passed, the results show the share card
  async daily() {
    const page = await newPage(DESKTOP, 'today=' + (process.env.SPAN_DAY || '20261007') + '&noresume');
    await page.click('.dly-title-btn');
    for (let i = 0; i < 60 && !(await E(page, () => BG.Daily.panelOpen() && document.querySelector('[data-dref=name]').textContent !== 'Surveying…')); i++) await run(page, 0.25);
    await run(page, 0.6);
    await save(page, 'daily-panel.jpg', { quality: 86 });
    await page.click('[data-dly=play]');
    for (let i = 0; i < 40 && !(await E(page, () => BG.Game.state === 'edit')); i++) await run(page, 0.25);
    await E(page, () => { BG.Hud.hideHint(); BG.Game._replaceDesign(BG.Model.clone(BG.Game.level.generator.solution.design)); });
    await run(page, 0.8);
    await startTest(page, false);
    for (let i = 0; i < 400 && !(await E(page, () => BG.Game.state === 'results')); i++) await run(page, 0.5);
    await run(page, 3);
    await save(page, 'daily-share.jpg', { quality: 86 });
    await page._ctx.close();
  },

  // level select with a campaign in progress (stars, badges, a skipped level, the Iron Road and Famous tabs)
  async levels() {
    const page = await newPage(DESKTOP, 'screen=levels&noresume', { init: seedProgress });
    await E(page, () => {
      for (let id = 1; id <= 22; id++) { const g = BG.Goals.forLevel(id); if (g.length && id % 3 !== 1) BG.Storage.recordBadges(id, g.slice(0, 1 + (id % 2)).map(x => x.type)); }
      BG.Game.goLevelSelect();
    });
    await run(page, 1.2);
    await save(page, 'levels.jpg', { quality: 86 });
    await E(page, () => { const t = document.querySelector('.camp-tab[data-camp=rail]'); if (t) t.click(); });
    await run(page, 1);
    await save(page, 'levels-ironroad.jpg', { quality: 86 });
    await page._ctx.close();
  },

  // a phone held sideways: the touch layout while a steam train crosses, and the editor with its touch tools
  async phone() {
    let page = await newPage(PHONE_LANDSCAPE, 'level=104&unlockall&noresume');
    await openWithDesign(page, sol('104-best'));
    await startTest(page, false);
    await run(page, 5.5);
    await save(page, 'phone-train.jpg', { quality: 80 });
    await page._ctx.close();
    // building by touch: a finger drags out a member, the magnifier shows the spot under it
    page = await newPage(PHONE_LANDSCAPE, 'level=' + PHONE_EDIT_LEVEL + '&unlockall&noresume');
    const level = await E(page, () => BG.Game.level);
    const { keep, removed, full } = partial(sol(PHONE_EDIT_LEVEL + '-best'), 3);
    await openWithDesign(page, keep);
    await run(page, 1);
    await E(page, () => BG.Hud.hideHint());
    await E(page, m => BG.Game.editor.setMaterial(m), removed[0].m);
    await run(page, 0.5);
    const A = nodePos(full, level, removed[0].a), B = nodePos(full, level, removed[0].b);
    const pa = await W2S(page, A.x, A.y), pb = await W2S(page, A.x + (B.x - A.x) * 0.85, A.y + (B.y - A.y) * 0.85);
    const cdp = await page._ctx.newCDPSession(page);
    const touch = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: Math.round(p.x), y: Math.round(p.y), id: 0, radiusX: 3, radiusY: 3, force: 1 }] : [] });
    await touch('touchStart', pa); await run(page, 0.05);
    for (let k = 1; k <= 12; k++) { await touch('touchMove', { x: pa.x + (pb.x - pa.x) * k / 12, y: pa.y + (pb.y - pa.y) * k / 12 }); await run(page, 0.03); }
    await run(page, 0.3);
    await save(page, 'phone-edit.jpg', { quality: 80 });
    await page._ctx.close();
  },
};

// one of the built-in templates (js/core/templates.js) generated for the open level
const templateDesign = (page, id) => E(page, t => BG.Templates.generate(t, BG.Game.level, {}), id);

const PHONE_EDIT_LEVEL = 9;
// a saved design with its last n structural members taken away (the first of them is the next one to build)
function partial(full, n) {
  const keep = Object.assign({}, full, { beams: full.beams.slice() }), removed = [];
  for (let i = keep.beams.length - 1; i >= 0 && removed.length < n; i--) if (!/road|rail/.test(keep.beams[i].m)) removed.unshift(keep.beams.splice(i, 1)[0]);
  return { keep, removed, full };
}

// a level with a design, tested for t seconds of game time
async function simShot(name, id, design, t, opts) {
  opts = opts || {};
  const page = await newPage(opts.ctx || DESKTOP, 'level=' + id + '&unlockall&noresume');
  await openWithDesign(page, design);
  await startTest(page, !!opts.follow);
  await run(page, t);
  await save(page, name, { quality: opts.quality || 84 });
  await page._ctx.close();
}

// localStorage for the level-select scene: Roads 1-23 done (mixed stars, 21 skipped), Iron Road 101-104 done
function seedProgress() {
  if (localStorage.getItem('span.v1.progress')) return;
  const levels = {};
  const stars = [3, 3, 2, 3, 3, 2, 3, 1, 3, 2, 3, 3, 2, 3, 2, 3, 3, 1, 2, 3, 0, 2, 3];
  stars.forEach((s, i) => { if (i + 1 !== 21) levels[i + 1] = { completed: true, stars: s, bestCost: 1000, attempts: 2 }; });
  [3, 2, 3, 2].forEach((s, i) => { levels[101 + i] = { completed: true, stars: s, bestCost: 1000, attempts: 1 }; });
  localStorage.setItem('span.v1.progress', JSON.stringify({ levels, lastLevel: 23 }));
}

(async () => {
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  for (const [name, fn] of Object.entries(SCENES)) {
    if (ONLY ? ONLY.indexOf(name) < 0 : name === 'probe') continue;
    console.log(name);
    await fn();
  }
  await browser.close();
  console.log(written.length + ' files in ' + path.relative(ROOT, OUT));
})().catch(async e => { console.error('ERR', e && e.stack || e); if (browser) await browser.close(); process.exit(1); });
