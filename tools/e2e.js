// Headless end-to-end check for SPAN. Never opens a visible window.
// Usage: node tools/e2e.js [outDir=%TEMP%/span-e2e] [viewportW=1440] [viewportH=900] [--lang=da]
//   --lang=da  plays everything in Danish (?lang=da): the texts it checks come from the dictionaries, so the same
//              checks run in either language; the screenshots then show the Danish layout
// Drives the real game headless: the title's "umage.ai presents" credit and the About screen (links, Esc, Settings
// row, language switch in place), level select (50 levels / 6 chapters), mouse-built level 1 (incl. the
// auto-split beginner path), pass/fail runs, templates (level 4), undo/redo, mirror + piers (level 11),
// frame timing, progress; Iron Road: campaign tab gating, mouse-built 101, a derail callout (102), 108, the
// follow-camera scenery cache, and the finale (120 only); the shared campaign system: one tab bar (Roads | Iron Road |
// Famous Bridges), unlock gates, Next / finale per campaign (bonus 53 too), Continue across campaigns, the title's
// Daily + Endless entry points, and results-modal layering (badges, history card over the results); the unlock rule
// explained (chapter-finale gates, skipped markers, the (i) tooltip, the skip toast, the migration) and the hint only
// auto-showing on an empty design or a level never passed; land-side structures (§17) on a test level; the hidden
// Anchorages chapter (opened by level 40, its own Next / finale on 58). Exit code 0 = all passed.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const url = require('url');
const ROOT = path.resolve(__dirname, '..');
const POS = process.argv.slice(2).filter(a => !a.startsWith('--'));
const LANG = (process.argv.find(a => a.startsWith('--lang=')) || '').slice(7);
const Q = LANG ? 'lang=' + LANG : '';
const OUT = POS[0] || path.join(require('os').tmpdir(), 'span-e2e' + (LANG ? '-' + LANG : ''));
const VW = +(POS[1] || 1440), VH = +(POS[2] || 900);
fs.mkdirSync(OUT, { recursive: true });
const sol = n => JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'solutions', 'level-' + String(n).padStart(2, '0') + '.json'), 'utf8'));
const results = [];
const ok = (name, cond, info) => { results.push({ name, pass: !!cond, info }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };

(async () => {
  const browser = await require('./browser').launch(chromium);
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

  await page.goto(url.pathToFileURL(path.join(ROOT, 'index.html')).href + (Q ? '?' + Q : ''));
  await page.waitForTimeout(1800);
  ok('title state', await page.evaluate(() => BG.Game.state) === 'title');
  const X = await page.evaluate(() => { const t = (k, p) => BG.i18n.t(k, p); const anch = t('hud.chapter.anchorages.name'); return {
    lang: BG.i18n.lang(), tabLocked10: t('hud.levels.tabLocked', { n: 10 }), tabLocked15: t('hud.levels.tabLocked', { n: 15 }), ref15: t('hud.unlock.levelRef', { n: 15 }),
    ref40: t('hud.unlock.levelRef', { n: 40 }), gate20: t('hud.unlock.gate.road', { name: t('hud.unlock.levelRef', { n: 20 }) }), structure: t('results.rail.structure'),
    onRails: t('results.rail.onRails'), railFinale: t('results.finale.rail.banner'), forces: t('hud.chapter.forces.name'), allLevels: t('hud.camp.road.all'),
    rule: t('hud.unlock.rule.road'), skipped: t('hud.levels.skipped'), roadway: t('editor.reason.roadway'), anch, anchBanner: t('results.finale.anchorages.banner'),
    anchToast: t('results.toast.bonus', { name: anch, from: 54, to: 58 }), why: ['results.why.bendRoad', 'results.why.bendTrack', 'results.why.compression', 'results.why.tension'].map(k => t(k)),
    pierCount: t('hud.tool.pierCount'), kinkTitle: t('results.derail.kink.title'), famousOpen: t('results.toast.open.famous'),
    contPonte: t('hud.title.continueLevel', { level: 'Ponte Vecchio' }), skip3: t('results.toast.skip.road', { name: t('core.level', { n: 3 }) }), topple: t('results.why.topple'),
    anchSub: anch + ' · ' + t('hud.level.gap', { gap: BG.i18n.meters(36, 0) }) }; });
  // a dictionary template as a pattern: {params} match anything
  const tplRx = tpl => new RegExp(String(tpl).split(/\{\w+\}/).map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+?'));
  ok('language on screen: ' + (LANG || 'en'), X.lang === (LANG || 'en'), X.lang);
  ok('real renderer', await page.evaluate(() => !BG.Game.usingFallbackRenderer));
  await shot('01-title');

  // ---- about: "umage.ai presents" on the title, the About screen (from the title and from Settings), its links,
  //      the language switch while it is open; the credit and the About button clear the title's buttons and chips
  const titleClear = () => page.evaluate(() => {
    const vis = e => { if (!e || e.closest('[hidden]')) return false; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
    const box = (name, r) => ({ name, l: r.left, t: r.top, r: r.right, b: r.bottom });
    const boxes = [];
    ['.abt-presents', '.abt-title-btn', '#screen-title .title-meta > *', '#screen-title .title-buttons > *'].forEach(sel => document.querySelectorAll(sel).forEach(e => { if (vis(e)) boxes.push(box(e.className.split(' ')[0] || sel, e.getBoundingClientRect())); }));
    const foot = document.querySelector('#screen-title .title-foot');
    if (vis(foot)) { const rg = document.createRange(); rg.selectNodeContents(foot); Array.from(rg.getClientRects()).forEach(r => boxes.push(box('title-foot text', r))); }
    const mine = boxes.filter(b => /^abt-/.test(b.name)), hits = [];
    mine.forEach(a => boxes.forEach(b => { if (a !== b && a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1) hits.push(a.name + ' x ' + b.name); }));
    const out = mine.filter(a => a.l < -1 || a.t < -1 || a.r > innerWidth + 1 || a.b > innerHeight + 1).map(a => a.name + ' off screen');
    return hits.concat(out);
  });
  const AB = await page.evaluate(() => {
    const p = document.querySelector('.abt-presents'), img = p && p.querySelector('img'), b = document.querySelector('.abt-title-btn');
    return { href: p && p.getAttribute('href'), target: p && p.target, rel: p && p.rel, img: !!(img && img.complete && img.naturalWidth > 0), alt: img && img.alt,
      text: p && p.textContent.trim(), want: BG.i18n.t('features.about.presents'), shown: !!(p && p.getBoundingClientRect().height > 20 && +getComputedStyle(p).opacity > 0.9),
      btn: !!(b && b.getBoundingClientRect().width > 30 && +getComputedStyle(b).opacity > 0.9), btnText: b && b.textContent.trim(), btnWant: BG.i18n.t('features.about.button'),
      logoAbove: !!(p && p.getBoundingClientRect().bottom <= document.querySelector('.logo-art').getBoundingClientRect().top + 4) };
  });
  ok('title: "umage.ai presents" above the logo, linking to umage.ai in a new tab', AB.href === 'https://umage.ai' && AB.target === '_blank' && /noopener/.test(AB.rel) && AB.img && AB.alt === 'umage.ai' && AB.text === AB.want && AB.shown && AB.logoAbove, AB);
  ok('title: About button shown', AB.btn && AB.btnText === AB.btnWant, AB);
  ok('title: credit and About clear the buttons and chips (' + VW + 'x' + VH + ')', (await titleClear()).length === 0, await titleClear());
  await page.setViewportSize({ width: 1024, height: 640 }); await page.waitForTimeout(250);
  ok('title: credit and About clear the buttons and chips (1024x640)', (await titleClear()).length === 0, await titleClear());
  await shot('01b-title-1024');
  await page.setViewportSize({ width: VW, height: VH }); await page.waitForTimeout(250);
  await page.click('.abt-title-btn'); await page.waitForTimeout(450);
  const AM = await page.evaluate(() => {
    const m = document.querySelector('#about'), D = BG.AboutData, t = (k, p) => BG.i18n.t(k, p);
    const links = Array.from(m.querySelectorAll('a[href]')).map(a => ({ href: a.getAttribute('href'), target: a.target, rel: a.rel, id: a.dataset.alink || a.className.split(' ')[0] }));
    const imgs = Array.from(m.querySelectorAll('img')).map(i => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0, link: !!i.closest('a[href="https://umage.ai"]') }));
    return { open: BG.About.isOpen() && m.classList.contains('show'), title: m.querySelector('.modal-head h3').textContent.trim(), wantTitle: t('features.about.title'),
      ver: m.querySelector('[data-aref=ver]').textContent, D: D && { version: D.version, levels: D.levels }, tiles: m.querySelectorAll('.abt-stat').length,
      levelsTile: (m.querySelector('.abt-stat b') || {}).textContent, steps: m.querySelectorAll('.abt-step').length, links, imgs,
      cta: (m.querySelector('.abt-cta') || {}).textContent, ctaWant: t('features.about.ctaLink'), state: BG.Game.state };
  });
  ok('About opens from the title', AM.open && AM.title === AM.wantTitle && AM.state === 'title', AM.title);
  ok('About: version and numbers from BG.AboutData', AM.D && AM.ver === AM.D.version && /^v\d+\.\d+/.test(AM.ver) && AM.tiles >= 6 && AM.levelsTile === String(AM.D.levels) && AM.steps === 5, { ver: AM.ver, D: AM.D, tiles: AM.tiles, levelsTile: AM.levelsTile, steps: AM.steps });
  const want = { 'https://umage.ai': 1, 'https://github.com/umage-ai/SpanGame': 1, 'https://github.com/umage-ai/SpanGame/tree/main/docs': 1, 'https://github.com/umage-ai/SpanGame/issues': 1,
    'https://github.com/umage-ai/SpanGame/blob/main/LICENSE': 1, ['https://github.com/umage-ai/SpanGame/releases/tag/' + (AM.D && AM.D.version)]: 1 };
  ok('About: links to umage.ai, source, docs, issues, license and these release notes', Object.keys(want).every(h => AM.links.some(l => l.href === h)) && AM.links.every(l => /^https:\/\//.test(l.href)), AM.links.map(l => l.href));
  ok('About: every link opens a new tab (rel=noopener)', AM.links.length >= 8 && AM.links.every(l => l.target === '_blank' && /noopener/.test(l.rel)), AM.links.filter(l => l.target !== '_blank' || !/noopener/.test(l.rel)));
  ok('About: the umage.ai logos load and each one links to umage.ai', AM.imgs.length >= 2 && AM.imgs.every(i => i.ok && i.link && /^assets\/brand\/umage-ai-/.test(i.src)), AM.imgs);
  ok('About: call to action', AM.cta && AM.cta.indexOf(AM.ctaWant) >= 0, AM.cta);
  await shot('01c-about');
  await page.keyboard.press('Enter'); await page.waitForTimeout(250);
  ok('About: keys do not reach the game while it is open', await page.evaluate(() => BG.Game.state === 'title' && BG.About.isOpen()));
  // language switch while open: the static texts and the numbers re-render, nothing from the old language remains
  const other = (LANG || 'en') === 'en' ? 'da' : 'en';
  const sw = await page.evaluate(([to, from]) => {
    const m = document.querySelector('#about'), before = BG.i18n.t('features.about.stat.lines');
    BG.i18n.setLanguage(to);
    const t = k => BG.i18n.t(k);
    const r = { title: m.querySelector('.modal-head h3').textContent.trim(), want: t('features.about.title'), eyebrow: m.querySelector('.abt-eyebrow').textContent, wantEyebrow: t('features.about.eyebrow'),
      linesLbl: Array.from(m.querySelectorAll('.abt-stat span')).map(s => s.textContent), wantLines: t('features.about.stat.lines'), before,
      presents: document.querySelector('.abt-presents span').textContent, wantPresents: t('features.about.presents'),
      setRow: document.querySelector('.abt-set-row span').textContent.trim(), notes: (m.querySelector('[data-alink=notes]') || {}).textContent };
    BG.i18n.setLanguage(from);
    r.back = m.querySelector('.modal-head h3').textContent.trim() === BG.i18n.t('features.about.title');
    return r;
  }, [other, LANG || 'en']);
  ok('About: switching the language re-renders it in place (' + other + ' and back)', sw.title === sw.want && sw.title !== AM.title && sw.eyebrow === sw.wantEyebrow && sw.linesLbl.indexOf(sw.wantLines) >= 0 && sw.linesLbl.indexOf(sw.before) < 0 &&
    sw.presents === sw.wantPresents && sw.setRow === sw.want && sw.back, sw);
  await page.keyboard.press('Escape'); await page.waitForTimeout(350);
  ok('About: Esc closes it', await page.evaluate(() => !BG.About.isOpen() && BG.Game.state === 'title'));
  await page.click('#screen-title [data-act=settings]'); await page.waitForTimeout(400);
  await page.click('#settings .abt-set-row'); await page.waitForTimeout(450);
  ok('About opens from Settings (Settings closes)', await page.evaluate(() => BG.About.isOpen() && !BG.Hud.settingsOpen()));
  await page.click('#about .modal-foot [data-aact=close]'); await page.waitForTimeout(350);
  ok('About: Done closes it', await page.evaluate(() => !BG.About.isOpen()));

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
  ok('failure explains the first break', r.res && r.res.firstBreak && X.why.some(w => tplRx(w).test(r.res.reasonText)), r.res && r.res.reasonText);
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
  ok('pier tool shows the pier allowance', await page.evaluate(() => document.querySelector('[data-tool=pier] span').textContent) === await page.evaluate(() => BG.i18n.t('hud.tool.pierCount', { n: 1, max: BG.Game.level.maxPiers })));
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
  ok('level 3 frame work < 12ms p95' + (require('./browser').software() ? ' (software rendering: not timed)' : ''), require('./browser').software() || perf.p95Work < 12, perf);
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
  ok('Iron Road tab locked until level 10 is complete', lockInfo.locked && lockInfo.sub.includes(X.tabLocked10) && !lockInfo.open, lockInfo);
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
  ok('101 passes; results show both verdicts and the ride card', r.res && r.res.passed && card101.card && card101.text.includes(X.structure) && card101.text.includes(X.onRails), r.res && { passed: r.res.passed, stars: r.res.stars, rail: r.res.rail, card101 });
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
  ok('derail callout shows the cause with numbers', callout.show && callout.title === X.kinkTitle && /\d/.test(callout.cause), callout);
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

  // ---- 120: follow camera (a remembered preference, switched on here); the scenery cache is not rebuilt every frame; finale
  await page.evaluate(() => { BG.Game.openLevel(120, { force: true }); });
  await page.waitForTimeout(900);
  await page.evaluate((d) => { BG.Hud.hideHint(); BG.Game.setFollow(true); BG.Game.editor.design = d; BG.Game._lastToggle = -1e9; BG.Game.startSim(); }, sol(120));
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
  ok('120 reference passes and shows the Iron Road finale', r.res && r.res.passed && r.res.finale && fin.cls && fin.banner.includes(X.railFinale), r.res && { passed: r.res.passed, reason: r.res.reason, finale: r.res.finale, fin });
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
  ok('level select: one tab bar - Roads | Iron Road | Famous Bridges; Famous locked until road 15', tabs.camps.join() === 'road,rail,famous' && tabs.famousLocked && tabs.famousSub.includes(X.tabLocked15) && (tabs.lock || '').includes(X.ref15), tabs);
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
  ok('passing road 15 opens Famous Bridges (toast)', r.res && r.res.passed && open15.open && (open15.opened || []).includes('famous') && open15.toast.includes(X.famousOpen), open15);
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
  ok('title: Continue resumes the famous bridge; Daily Challenge + Endless entry points', cont.target === 202 && cont.label.includes(X.contPonte) && cont.daily && cont.endless && !!cont.endlessSub, cont);
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
  ok('53 passes with the Forces of Nature finale', r.res && r.res.passed && r.res.finaleKind === 'bonus' && b53.cls && b53.banner.includes(X.forces) && b53.next === X.allLevels, Object.assign({ passed: r.res && r.res.passed, kind: r.res && r.res.finaleKind }, b53));
  await shot('31-bonus-finale');
  await page.click('[data-act=next]'); await page.waitForTimeout(700);
  const back = await page.evaluate(() => ({ state: BG.Game.state, tab: BG.Hud.tab, bonus: Array.from(document.querySelectorAll('.chapter h3')).map(h => h.textContent).includes(BG.i18n.t('hud.chapter.forces.name')) }));
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
  ok('unlock: tapping locked 21 names level 20 as the finale to finish', lock21.includes(X.gate20) && await page.evaluate(() => BG.Game.state === 'levelSelect'), lock21);
  const info = await page.evaluate(() => { const b = document.querySelector('.chapter .ch-head .ch-info'); return b && { tip: b.dataset.tip, n: document.querySelectorAll('.chapter .ch-info').length, ch: document.querySelectorAll('.chapter').length }; });
  ok('unlock: every chapter header has an (i) with the rule', info && info.n === info.ch && info.tip === X.rule, info);
  await page.click('.chapter .ch-info'); await page.waitForTimeout(300);
  ok('unlock: the (i) also shows the rule as a toast', (await toasts()).includes(X.rule));
  await seed(r19.slice(0, 18).concat([20])); await page.waitForTimeout(500);
  const skip = await page.evaluate(() => { const t = document.querySelector('.tile[data-id="19"]'); return { skipped: t.classList.contains('skipped'), text: (t.querySelector('.tile-skip') || {}).textContent, others: Array.from(document.querySelectorAll('.tile.skipped')).map(e => +e.dataset.id), open21: document.querySelector('.tile[data-id="21"]').classList.contains('open') }; });
  ok('unlock: skipped-but-open level 19 shows "Skipped — come back later" (finale 20 done -> 21 open)', skip.skipped && (skip.text || '').includes(X.skipped) && skip.others.join() === '19' && skip.open21, skip);
  await shot('32-unlock-skipped');
  // a pass that opens a level by skipping explains the rule
  await seed([]); await page.evaluate(() => BG.Game.openLevel(1)); await page.waitForTimeout(800);
  await page.evaluate((d) => { BG.Hud.hideHint(); BG.Game.editor.design = d; BG.Game._lastToggle = -1e9; BG.Game.startSim(); }, sol(1));
  r = await runSim(60); await page.waitForTimeout(2000);
  const skipToast = await toasts();
  ok('unlock: passing 1 opens 3 by skipping -> toast "Level 3 unlocked — you can skip one level (chapter finales can\'t be skipped)"',
    r.res && r.res.passed && (r.res.skipUnlocked || []).join() === '3' && skipToast.includes(X.skip3), { skip: r.res && r.res.skipUnlocked, skipToast });
  // migration: a player who already had levels open past an unbeaten finale keeps them, nothing new opens
  await page.evaluate(() => {
    const lv = {}; for (let i = 1; i <= 19; i++) lv[i] = { completed: true, stars: 1, bestCost: 1, attempts: 1 };
    lv[21] = { completed: true, stars: 1, bestCost: 1, attempts: 1 }; lv[22] = { completed: true, stars: 1, bestCost: 1, attempts: 1 };
    localStorage.setItem('span.v1.progress', JSON.stringify({ levels: lv, lastLevel: 22 }));
    localStorage.removeItem('span.v1.unlocks'); localStorage.removeItem('span.v1.hist.session');
  });
  await page.goto(url.pathToFileURL(path.join(ROOT, 'index.html')).href + '?screen=levels' + (Q ? '&' + Q : '')); await page.waitForTimeout(1500);
  const mig = await page.evaluate(() => ({ open: [20, 21, 22, 23, 24, 25].filter(id => BG.Game.isUnlocked(id)), keep: BG.Storage.keptUnlocks() }));
  ok('unlock migration: 21-24 (open before the gates) stay open, 25 stays locked until 20 is done', mig.open.join() === '20,21,22,23,24', mig);
  // hint: auto-shown on an empty design or a level never passed; not on a built, passed level after a reload
  const hintAt = async (id, prep) => {
    await page.evaluate(() => BG.Game.goLevelSelect()); await page.waitForTimeout(200); // leave (and autosave) first
    await page.evaluate(prep, sol(1));
    await page.goto(url.pathToFileURL(path.join(ROOT, 'index.html')).href + '?level=' + id + (Q ? '&' + Q : '')); await page.waitForTimeout(1400);
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

  // ================================================================ land-side structures (SPEC §17): inland anchors, land pylons, roadway envelope
  await page.goto(url.pathToFileURL(path.join(ROOT, 'index.html')).href + '?noresume' + (Q ? '&' + Q : '')); await page.waitForTimeout(1200);
  const landLevel = {
    id: 9901, name: 'Anchor Yard', theme: 'meadow', hint: 'Guy the pylons back to the anchors.',
    terrain: { leftEdge: 0, leftY: 0, rightEdge: 40, rightY: 0, floorY: -10, waterY: -6 },
    anchors: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: -24, y: 0, inland: true }, { x: 60, y: 7, inland: true }],
    pierZones: [{ x0: -8, x1: -3, ground: 'left' }, { x0: 43, x1: 48, ground: 'right' }], maxPiers: 2,
    noBuild: [], buildArea: { x0: -26, x1: 62, y0: -6, y1: 26 },
    materials: ['road', 'reinforced_road', 'steel', 'cable'], budget: 100000,
    traffic: [{ type: 'bus', count: 2, interval: 3 }], timeLimit: 30, templates: true,
  };
  await page.evaluate((L) => { BG.Levels.push(L); BG.Game.openLevel(9901, { force: true }); }, landLevel); await page.waitForTimeout(900);
  await page.evaluate(() => { BG.Hud.hideHint(); BG.Game.editor.design = { nodes: [], beams: [], piers: [] }; });
  const fit = await page.evaluate(() => {
    const r = BG.Game.renderer, c = BG.Game.canvas.getBoundingClientRect(), s = (x, y) => r.worldToScreen(x, y);
    const inView = (x, y) => { const p = s(x, y); return p.x >= 0 && p.x <= c.width && p.y >= 0 && p.y <= c.height; };
    return { a2: inView(-24, 0), a3: inView(60, 7), hill: inView(64, 0), b: r.levelBounds() };
  });
  ok('§17 fitToLevel frames the inland anchors and the hillside anchorage', fit.a2 && fit.a3 && fit.hill && fit.b.x0 <= -27 && fit.b.x1 >= 66, fit);
  await shot('40-land-empty');
  // a steel member from the road anchor back over the bank road, through the vehicle envelope: red ghost + toast
  await page.keyboard.press('3'); // steel
  const a0s = await W2S(0, 0), low = await W2S(-6, 2);
  await page.mouse.move(a0s.x, a0s.y); await page.mouse.down();
  await page.mouse.move((a0s.x + low.x) / 2, (a0s.y + low.y) / 2, { steps: 4 }); await page.mouse.move(low.x, low.y, { steps: 4 });
  const gh = await page.evaluate(() => { const g = BG.Game.editor.state.ghost; return g && { valid: g.valid, reason: g.reason }; });
  await shot('41-land-roadway-ghost');
  await page.mouse.up(); await page.waitForTimeout(150);
  const rw = await page.evaluate(() => ({ beams: BG.Game.getDesign().beams.length, toast: Array.from(document.querySelectorAll('#toasts .toast')).map(t => t.textContent).join(' | ') }));
  ok('§17 a member into the roadway envelope: red ghost "roadway", refused with "Keep the road clear"', gh && gh.valid === false && gh.reason === 'roadway' && rw.beams === 0 && rw.toast.includes(X.roadway), { gh, rw });
  await page.keyboard.press('Escape');
  // pier tool on the bank: a land pylon whose top clears the envelope
  await page.keyboard.press('p');
  const lpz = await W2S(-5, 1);
  await page.mouse.move(lpz.x, lpz.y); await page.mouse.down(); await page.mouse.move(lpz.x, lpz.y - 4, { steps: 3 }); await page.mouse.up(); await page.waitForTimeout(150);
  const pyl = await page.evaluate(() => { const d = BG.Game.getDesign(); return { piers: d.piers, base: d.piers[0] && BG.Model.pierBaseY(BG.Game.level, d.piers[0]), valid: BG.Model.validate(BG.Game.level, d).ok }; });
  ok('§17 pier tool in a land pier zone: pylon on the bank, top above the envelope', pyl.piers.length === 1 && pyl.base === 0 && pyl.piers[0].topY >= 3.7 && pyl.valid, pyl);
  await page.keyboard.press('b');
  // cable-stayed template: land pylons backstayed to the inland anchors; the run passes, the pylons stand
  await page.evaluate(() => { BG.Game.editor.design = { nodes: [], beams: [], piers: [] }; BG.Game.editor.applyTemplate('cable_stayed'); });
  const tpl = await page.evaluate(() => { const L = BG.Game.level, d = BG.Game.getDesign(); return { land: d.piers.filter(p => BG.Model.landPierBank(L, p)).length, back: d.beams.filter(b => /^a[23]$/.test(b.a) || /^a[23]$/.test(b.b)).length, valid: BG.Model.validate(L, d).ok }; });
  ok('§17 cable-stayed template uses both land pylons and backstays them to the inland anchors', tpl.land === 2 && tpl.back === 2 && tpl.valid, tpl);
  await page.mouse.move(VW / 2, 40); await page.waitForTimeout(200);
  await shot('42-land-template');
  await page.evaluate(() => { BG.Game._lastToggle = -1e9; BG.Game.startSim(); });
  r = await runSim(4);
  await shot('43-land-sim');
  r = await runSim(60); await page.waitForTimeout(400);
  const st = await page.evaluate(() => (BG.Game.sim && BG.Game.sim.piers || []).map(p => ({ ground: p.ground, tilt: p.tilt, failed: p.failed })));
  ok('§17 guyed land pylons: the run passes and both pylons stand', r.res && r.res.passed && st.length === 2 && st.every(p => p.ground && !p.failed && Math.abs(p.tilt) < 0.01), { passed: r.res && r.res.passed, st });
  // the same bridge without its backstays: the pylons topple and the results say why
  await page.evaluate(() => BG.Game.backToEdit()); await page.waitForTimeout(300);
  await page.evaluate(() => {
    const d = BG.Game.getDesign(); d.beams = d.beams.filter(b => !/^a[23]$/.test(b.a) && !/^a[23]$/.test(b.b)); BG.Game.editor.design = d;
    BG.Game._lastToggle = -1e9; BG.Game.startSim();
  });
  r = await runSim(30); await page.waitForTimeout(1500);
  const top = await page.evaluate(() => ({ text: document.querySelector('[data-ref=results]').textContent, piers: (BG.Game.sim.piers || []).map(p => p.failed) }));
  ok('§17 without backstays the land pylons topple; the results explain it', r.res && !r.res.passed && top.piers.some(Boolean) && top.text.includes(X.topple), { passed: r.res && r.res.passed, piers: top.piers });
  await shot('44-land-toppled');
  await page.evaluate(() => { const i = BG.Levels.findIndex(l => l.id === 9901); if (i >= 0) BG.Levels.splice(i, 1); BG.Storage.clearDesign && BG.Storage.clearDesign(9901); });

  // ================================================================ the hidden Anchorages chapter (54-58): opens after level 40
  const anch = await page.evaluate(() => {
    const G = BG.Game, S = BG.Storage, L = id => G.findLevel(id), nx = id => { const n = G.nextInCampaign(L(id)); return n ? n.id : null; };
    return { next: [40, 53, 54, 57, 58].map(nx), finale: S.finaleOf(L(58)), gate: S.isGate(L(58)) };
  });
  ok('Anchorages: Next 40 -> 41, 53 ends, 54 -> 55, 57 -> 58, 58 ends; 58 is its finale, not a gate', JSON.stringify(anch.next) === '[41,null,55,58,null]' && anch.finale === 'anchorages' && !anch.gate, anch);
  const r39 = []; for (let i = 1; i <= 39; i++) r39.push(i);
  await seed(r39); await page.waitForTimeout(500);
  const shut = await page.evaluate(() => ({ chapters: Array.from(document.querySelectorAll('.chapter h3')).map(h => h.textContent), lock: BG.Storage.lockText(54, BG.Levels) }));
  ok('before level 40: the Anchorages chapter is hidden and locked', !shut.chapters.includes(X.anch) && (shut.lock || '').includes(X.ref40), shut);
  await page.evaluate(() => { BG.Game.openLevel(40, { force: true }); }); await page.waitForTimeout(900);
  await page.evaluate((d) => { BG.Hud.hideHint(); BG.Game.editor.design = d; BG.Game._lastToggle = -1e9; BG.Game.startSim(); }, sol(40));
  r = await runSim(120); await page.waitForTimeout(1900);
  const op = await page.evaluate(() => ({ opened: BG.Game.lastResult.bonusOpened, next: BG.Game.lastResult.hasNext, toast: Array.from(document.querySelectorAll('#toasts .toast')).map(t => t.textContent).join(' | '), open54: BG.Game.isUnlocked(54), open55: BG.Game.isUnlocked(55) }));
  ok('passing level 40 reveals the Anchorages (toast), opens 54 only; Next still leads to 41', r.res && r.res.passed && (op.opened || []).includes('anchorages') && op.toast.includes(X.anchToast) && op.open54 && !op.open55 && op.next, op);
  await page.evaluate(() => BG.Game.goLevelSelect()); await page.waitForTimeout(600);
  const ls2 = await page.evaluate(() => ({ chapters: Array.from(document.querySelectorAll('.chapter h3')).map(h => h.textContent), open: Array.from(document.querySelectorAll('.tile.open')).map(t => +t.dataset.id).filter(id => id >= 51), sub: (document.querySelector('[data-ref=lsSub]') || document.querySelector('#screen-levels .ls-sub') || {}).textContent || '' }));
  ok('level select: the Anchorages chapter (54 open) after Grand Spans; Forces of Nature still hidden', ls2.chapters[ls2.chapters.length - 1] === X.anch && !ls2.chapters.includes(X.forces) && ls2.open.join() === '54', ls2);
  await page.evaluate(() => BG.Hud.scrollToLevel(54)); await page.waitForTimeout(300);
  await shot('45-anchorages-chapter');
  await page.click('.tile[data-id="54"]'); await page.waitForTimeout(1000);
  const bar = await page.evaluate(() => ({ id: BG.Game.level.id, sub: document.querySelector('#screen-level').textContent }));
  ok('level 54 opens from its tile; the top bar names the Anchorages chapter', bar.id === 54 && bar.sub.includes(X.anchSub), bar.id);
  // the "KEEP CLEAR" labels (drawn over the structure): on screen, clear of the HUD side panels, of every built
  // land pylon and of the hillsides; at least one per level on a desktop screen
  const labels = [];
  for (const id of [54, 55, 56, 57, 58]) {
    labels.push(await page.evaluate(async ([id, d]) => {
      BG.Game.openLevel(id, { force: true }); BG.Hud.hideHint(); BG.Game.editor.design = d;
      await new Promise((r) => setTimeout(r, 250));
      const R = BG.Game.renderer, ins = R.insets, M = BG.Model, L = BG.Game.level, c = document.createElement('canvas').getContext('2d');
      const bad = [];
      for (const [x, , text] of R._roadLabels || []) {
        c.font = '700 10px ' + getComputedStyle(document.body).fontFamily;
        const hw = (c.measureText(text).width + 13) / 2, x0 = x - hw, x1 = x + hw;
        if (x0 < ins.left || x1 > R.W - ins.right) bad.push('hud');
        for (const p of d.piers) if (M.landPierBank(L, p)) { const sx = R.worldToScreen(p.x, 0).x; if (sx > x0 && sx < x1) bad.push('pylon ' + p.x); }
        for (const m of M.anchorMounds(L)) { const sx = R.worldToScreen(m.anchor.x, 0).x; if (sx > x0 && sx < x1) bad.push('hill ' + m.anchor.x); }
      }
      return { id, n: (R._roadLabels || []).length, bad };
    }, [id, sol(id + '-best')]));
  }
  ok('Anchorages: "KEEP CLEAR" labels stay clear of the HUD, the pylons and the hillsides (one or two per level)', labels.every((l) => l.n >= 1 && !l.bad.length), labels);
  await page.evaluate(() => BG.Game.openLevel(54, { force: true })); await page.waitForTimeout(400);
  // the chapter finale (58)
  await page.evaluate(() => { [54, 55, 56, 57].forEach(id => BG.Storage.recordResult(id, { passed: true, stars: 1, cost: 1 })); BG.Game.openLevel(58, { force: true }); }); await page.waitForTimeout(900);
  await page.evaluate((d) => { BG.Hud.hideHint(); BG.Game.editor.design = d; BG.Game._lastToggle = -1e9; BG.Game.startSim(); }, sol('58-best'));
  r = await runSim(90); await page.waitForTimeout(1800);
  const f58 = await page.evaluate(() => ({ banner: document.querySelector('[data-ref=resBanner]').textContent, cls: document.querySelector('[data-ref=results]').classList.contains('finale-bonus'), next: document.querySelector('[data-act=next] span').textContent, piers: (BG.Game.sim.piers || []).map(p => p.failed) }));
  ok('58 passes with the Anchorages finale, pylons standing, then "All levels"', r.res && r.res.passed && r.res.finaleKind === 'anchorages' && f58.cls && f58.banner.includes(X.anchBanner) && f58.next === X.allLevels && !f58.piers.some(Boolean), Object.assign({ passed: r.res && r.res.passed, kind: r.res && r.res.finaleKind }, f58));
  await shot('46-anchorages-finale');

  ok('no console errors', errors.length === 0, errors.slice(0, 15));
  console.log(`\n${results.filter(r => r.pass).length}/${results.length} e2e checks passed`);
  await browser.close();
  process.exit(results.every(r => r.pass) ? 0 : 1);
})().catch(e => { console.error('ERR', e); process.exit(2); });
