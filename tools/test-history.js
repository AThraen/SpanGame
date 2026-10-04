// Tests for js/features/history.js (run history, personal bests, stats, snapshots, migration, export / import,
// autosave / resume). Usage: node tools/test-history.js [--node-only]
//  1. Node: BG.Storage + BG.History with a fake localStorage (also: no storage at all, quota errors).
//  2. Headless Chrome (never a visible window): autosave + resume across a page reload on desktop and on
//     emulated phones / tablets (touch, both orientations), results bests, history screen, load design,
//     export / import.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function ok(c, msg, info) { if (c) pass++; else { fail++; console.log('  FAIL: ' + msg + (info !== undefined ? '  ' + JSON.stringify(info) : '')); } }
function section(n) { console.log('- ' + n); }

// ------------------------------------------------------------------ fake localStorage
function makeLS(opts) {
  opts = opts || {};
  const m = new Map();
  let used = 0;
  const ls = {
    get length() { return m.size; },
    key(i) { return Array.from(m.keys())[i] || null; },
    getItem(k) { if (opts.throwAll) throw new Error('SecurityError'); return m.has(k) ? m.get(k) : null; },
    setItem(k, v) {
      if (opts.throwAll) throw new Error('SecurityError');
      v = String(v);
      const nu = used - (m.has(k) ? m.get(k).length : 0) + v.length;
      if (opts.quota && nu > opts.quota) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      m.set(k, v); used = nu;
    },
    removeItem(k) { if (m.has(k)) { used -= m.get(k).length; m.delete(k); } },
    clear() { m.clear(); used = 0; },
    _map: m, get _used() { return used; },
  };
  return ls;
}
// fresh BG with storage + history loaded against the given localStorage
function boot(ls) {
  ['js/ui/storage.js', 'js/features/history.js', 'js/core/materials.js', 'js/core/model.js', 'js/core/levels.js'].forEach(f => { delete require.cache[path.join(ROOT, f)]; });
  global.BG = {};
  if (ls === undefined) delete global.localStorage; else global.localStorage = ls;
  require(path.join(ROOT, 'js/core/materials.js'));
  require(path.join(ROOT, 'js/core/model.js'));
  require(path.join(ROOT, 'js/core/levels.js'));
  require(path.join(ROOT, 'js/ui/storage.js'));
  require(path.join(ROOT, 'js/features/history.js'));
  return global.BG;
}
const design = (n) => {
  const d = { nodes: [], beams: [], piers: [] };
  for (let i = 0; i < n; i++) { d.nodes.push({ id: 'n' + (i + 1), x: 1.25 * i + 0.3333333, y: -1.5 }); d.beams.push({ a: i ? 'n' + i : 'a0', b: 'n' + (i + 1), m: i % 2 ? 'wood' : 'road' }); }
  return d;
};
function run(H, o) {
  return H.recordRun(Object.assign({ levelId: 1, passed: true, simOk: true, stars: 2, cost: 1000, budget: 1500, members: 5, peak: 0.8, time: 12.3, broken: 0, reason: null, design: design(5), materials: { road: 3, wood: 2 } }, o || {}));
}

function nodeTests() {
  section('migration from the v1 keys');
  {
    const ls = makeLS();
    ls.setItem('span.v1.progress', JSON.stringify({ levels: { 1: { completed: true, stars: 2, bestCost: 1234, attempts: 4 }, 2: { completed: false, stars: 0, bestCost: null, attempts: 2 } }, lastLevel: 2 }));
    ls.setItem('span.v1.design.1', BG_serialize(design(3)));
    ls.setItem('span.v1.settings', JSON.stringify({ volume: 0.3 }));
    const BG = boot(ls);
    const H = BG.History;
    const m = H.migrate();
    ok(m.migrated && m.from === 1 && m.to === H.SCHEMA, 'migrates v1 -> current', m);
    const b1 = H.getBests(1);
    ok(b1 && b1.cost && b1.cost.v === 1234 && b1.stars.v === 2 && b1.runs === 4 && b1.passes === 1, 'bests seeded from progress', b1);
    ok(H.getBests(2).runs === 2 && !H.getBests(2).cost, 'unfinished level seeded without a cost');
    ok(H.getStats().runs === 6, 'run counter seeded from attempts', H.getStats());
    ok(!H.migrate().migrated, 'migration runs once');
    ok(BG.Storage.getProgress().levels[1].bestCost === 1234 && BG.Storage.loadDesign(1).beams.length === 3 && BG.Storage.getSettings().volume === 0.3, 'legacy keys untouched and still readable');
    ok(BG.Storage.SCHEMA === H.SCHEMA, 'BG.Storage.SCHEMA exposed');
  }

  section('runs, personal bests, improvements');
  {
    const BG = boot(makeLS());
    const H = BG.History;
    let t = 1e12; H._now = () => (t += 60000);
    const r1 = run(H, { cost: 1500, members: 9, peak: 0.95, time: 14 });
    ok(r1.first && r1.run.ok === 1 && r1.run.k, 'first pass recorded with a snapshot', r1);
    const r2 = run(H, { cost: 1080, members: 10, peak: 0.97, time: 13 });
    const c = r2.improvements.find(i => i.key === 'cost');
    ok(c && c.prev === 1500 && c.delta === -420, 'cheaper pass: New best -$420 vs previous', r2.improvements);
    ok(!r2.improvements.find(i => i.key === 'members') && !r2.improvements.find(i => i.key === 'peak'), 'worse members / peak are not bests');
    ok(r2.improvements.find(i => i.key === 'time'), 'faster crossing is a best');
    const r3 = run(H, { passed: false, simOk: false, stars: 0, cost: 600, reason: 'vehicle_fell', broken: 3 });
    ok(r3.run.ok === 0 && r3.run.f === 'vehicle_fell' && !r3.improvements.length, 'failed run recorded with reason, no bests');
    ok(H.getBests(1).cost.v === 1080, 'a cheaper failing run does not beat the best cost');
    const r4 = run(H, { passed: false, simOk: true, stars: 0, cost: 1600 });
    ok(r4.run.f === 'over_budget', 'over-budget run reason');
    const r5 = run(H, { stars: 3, cost: 1000, members: 7, peak: 0.7 });
    ok(['cost', 'members', 'peak', 'stars'].every(k => r5.improvements.find(i => i.key === k)), 'all-round improvement', r5.improvements.map(i => i.key));
    const b = H.getBests(1);
    ok(b.runs === 5 && b.passes === 3 && b.stars.v === 3 && b.members.v === 7 && b.cost.k, 'bests summary', b);
    const st = H.summary();
    ok(st.runs === 5 && st.bridgesBuilt === 3 && st.collapses === 1 && st.spent === 1500 + 1080 + 600 + 1600 + 1000, 'stats: runs / bridges / collapses / spent', st);
    H.addPlaced({ steel: 4, wood: 1 }); H.addPlaced({ steel: 1 });
    H.addPlayTime(65000);
    const s2 = H.summary();
    ok(s2.beamsPlaced === 6 && s2.favourite === 'steel' && s2.playMs === 65000, 'beams placed, favourite material, play time', s2);
    ok(H.runsFor(1).length === 5 && H.runsFor(2).length === 0, 'runsFor filters by level');
  }

  section('run cap and snapshot retention');
  {
    const BG = boot(makeLS());
    const H = BG.History;
    let t = 2e12; H._now = () => (t += 1000);
    for (let i = 0; i < 540; i++) run(H, { levelId: 1 + (i % 3), cost: 2000 - i, passed: i % 4 !== 0, simOk: i % 4 !== 0, design: design(4 + (i % 5)) });
    const runs = H.getRuns();
    ok(runs.length === H.MAX_RUNS, 'run history capped to MAX_RUNS', runs.length);
    ok(runs[runs.length - 1].c === 2000 - 539, 'newest run kept last');
    const idx = H._snapIndex();
    const per = {};
    idx.forEach(e => { const k = e.l + (e.ok ? 'p' : 'f'); per[k] = (per[k] || 0) + 1; });
    ok(Object.keys(per).every(k => per[k] <= (k.endsWith('p') ? 8 + 5 : 3)), 'per-level snapshot retention (8 latest passes + pinned bests, last 3 fails)', per);
    const bestK = H.getBests(1).cost.k;
    ok(bestK && H.hasSnapshot(bestK) && H.loadSnapshot(bestK).beams.length > 0, 'best-cost snapshot pinned and loadable');
    const withK = runs.filter(r => r.k);
    ok(withK.every(r => H.hasSnapshot(r.k)), 'every run that points at a snapshot has it');
    const stored = Array.from(global.localStorage._map.keys()).filter(k => k.indexOf('span.v1.hist.s.') === 0).length;
    ok(stored === idx.length, 'no orphaned snapshot keys', { stored, idx: idx.length });
  }

  section('compact snapshot encoding');
  {
    const BG = boot(makeLS());
    const H = BG.History;
    const d = design(30);
    d.piers.push({ x: 7.123456, topY: -2.0004 });
    d.beams.push({ a: 'p0', b: 'n3', m: 'steel' });
    const s = H.encodeDesign(d);
    const back = H.decodeDesign(s);
    ok(s.slice(0, 2) === 'c1' && s.length < BG.Model.serialize(d).length * 0.6, 'compact form is much smaller', { compact: s.length, full: BG.Model.serialize(d).length });
    ok(back.nodes.length === 30 && back.beams.length === 31 && back.piers.length === 1, 'roundtrip counts');
    ok(back.nodes.every((n, i) => n.id === d.nodes[i].id && Math.abs(n.x - d.nodes[i].x) < 6e-4 && Math.abs(n.y - d.nodes[i].y) < 6e-4), 'node positions rounded to 1 mm');
    ok(back.beams.every((b, i) => b.a === d.beams[i].a && b.b === d.beams[i].b && b.m === d.beams[i].m), 'beam endpoints / materials preserved');
    ok(Math.abs(back.piers[0].topY + 2) < 1e-3, 'pier preserved');
    ok(H.decodeDesign('c1{broken') === null && H.decodeDesign(null) === null, 'bad snapshot decodes to null');
    ok(H.decodeDesign(BG.Model.serialize(d)).beams.length === 31, 'decodes the plain serialize format too');
  }

  section('export / import');
  {
    const BG = boot(makeLS());
    const H = BG.History;
    BG.Storage.recordResult(1, { passed: true, stars: 3, cost: 900 });
    BG.Storage.saveDesign(1, design(4));
    BG.Storage.setSettings({ volume: 0.25, showGrid: false });
    run(H, { cost: 900, stars: 3 });
    H.saveSession({ state: 'edit', levelId: 1, cam: { x: 3, y: 1, zoom: 30 } });
    const str = H.exportString();
    const o = JSON.parse(str);
    ok(o.format === 'span-save' && o.schema === H.SCHEMA && o.data.progress && o.data['design.1'] && o.data['hist.runs'].length === 1, 'export contains progress, designs, history', Object.keys(o.data));
    ok(Object.keys(o.data).some(k => k.indexOf('hist.s.') === 0), 'export contains snapshots');

    const BG2 = boot(makeLS());
    const H2 = BG2.History;
    BG2.Storage.recordResult(5, { passed: true, stars: 1, cost: 5 });
    ok(!H2.importSave('nope').ok && !H2.importSave({ format: 'x', data: {} }).ok && !H2.importSave({ format: 'span-save', schema: 99, data: { a: 1 } }).ok, 'rejects junk / newer schema');
    ok(BG2.Storage.isCompleted(5), 'rejected import leaves data alone');
    const r = H2.importSave(str);
    ok(r.ok, 'import ok', r);
    ok(BG2.Storage.getLevelProgress(1).bestCost === 900 && !BG2.Storage.isCompleted(5), 'import replaces progress');
    ok(BG2.Storage.loadDesign(1).beams.length === 4 && BG2.Storage.getSettings().volume === 0.25, 'import restores designs and settings');
    ok(H2.getRuns().length === 1 && H2.getBests(1).cost.v === 900 && H2.loadSnapshot(H2.getRuns()[0].k).beams.length === 5, 'import restores history and snapshots');
    ok(H2.getSession().levelId === 1, 'import restores the session');
    // a legacy-shaped save (no history keys) is migrated on import
    const BG3 = boot(makeLS());
    const r3 = BG3.History.importSave({ format: 'span-save', version: 1, data: { progress: { levels: { 3: { completed: true, stars: 1, bestCost: 777, attempts: 2 } }, lastLevel: 3 } } });
    ok(r3.ok && BG3.History.getBests(3).cost.v === 777, 'old save without history migrates', BG3.History.getBests(3));
  }

  section('no storage / quota');
  {
    const BG = boot(makeLS({ throwAll: true }));
    const H = BG.History;
    ok(BG.Storage.available() === false, 'storage reported unavailable');
    let threw = false;
    try {
      H.migrate();
      run(H); run(H, { cost: 500 });
      H.addPlaced({ wood: 2 }); H.saveSession({ state: 'levelSelect' });
    } catch (e) { threw = e; }
    ok(!threw, 'nothing throws without storage', String(threw));
    ok(H.getRuns().length === 2 && H.getBests(1).cost.v === 500 && H.getSession().state === 'levelSelect', 'in-memory fallback keeps the session data');
    ok(JSON.parse(H.exportString()).data['hist.runs'].length === 2, 'export works from memory');

    const BG0 = boot(undefined);
    let t0 = false;
    try { run(BG0.History); } catch (e) { t0 = e; }
    ok(!t0 && BG0.History.getRuns().length === 1, 'works with no localStorage object at all');

    const ls = makeLS({ quota: 60000 });
    const BGq = boot(ls);
    const Hq = BGq.History;
    let tq = false;
    try { for (let i = 0; i < 120; i++) run(Hq, { cost: 3000 - i, levelId: 1 + (i % 6), design: design(60) }); } catch (e) { tq = e; }
    ok(!tq, 'quota errors never throw', String(tq));
    ok(ls._used <= 60000, 'stays inside the quota');
    const runs = Hq.getRuns();
    ok(runs.length > 0 && runs.filter(r => r.k).every(r => Hq.loadSnapshot(r.k)), 'runs keep only snapshots that really got stored', runs.length);
  }

  section('corrupt data');
  {
    const ls = makeLS();
    ls.setItem('span.v1.hist.runs', '{not json');
    ls.setItem('span.v1.hist.bests', '[1,2]');
    ls.setItem('span.v1.hist.stats', '"x"');
    ls.setItem('span.v1.hist.session', '5');
    const BG = boot(ls);
    const H = BG.History;
    let threw = false;
    try { H.migrate(); run(H); } catch (e) { threw = e; }
    ok(!threw && H.getRuns().length === 1 && H.getBests(1).runs === 1 && H.getSession() === null, 'corrupt keys are replaced, not fatal', String(threw));
  }

  section('resume plan');
  {
    const BG = boot(makeLS());
    const H = BG.History;
    const now = 5e12;
    ok(H.resumePlan({ state: 'edit', levelId: 3, t: now - 1000 }, now).action === 'level', 'recent level session resumes the level');
    ok(H.resumePlan({ state: 'results', levelId: 3, t: now - 1000 }, now).action === 'level', 'results session resumes the level (edit)');
    ok(H.resumePlan({ state: 'levelSelect', t: now - 1000 }, now).action === 'levelSelect', 'level select resumes');
    ok(H.resumePlan({ state: 'title', t: now - 1000 }, now).action === null, 'title stays on title');
    ok(H.resumePlan({ state: 'edit', levelId: 3, t: now - 80 * 3600e3 }, now).action === null, 'stale session -> title (Resume button)');
  }
}
function BG_serialize(d) { return JSON.stringify({ v: 1, nodes: d.nodes, beams: d.beams, piers: d.piers }); }

// ------------------------------------------------------------------ headless browser
async function browserTests() {
  let chromium, devices;
  try { ({ chromium, devices } = require('playwright')); } catch (e) { console.log('- browser: playwright not installed, skipped'); return; }
  const url = require('url');
  const os = require('os');
  const OUT = path.join(os.tmpdir(), 'span-history');
  fs.mkdirSync(OUT, { recursive: true });
  const href = url.pathToFileURL(path.join(ROOT, 'index.html')).href;
  const sol1 = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/solutions/level-01.json'), 'utf8'));
  const browser = await require('./browser').launch(chromium);
  const profiles = [
    ['desktop', { viewport: { width: 1280, height: 800 } }],
    ['iPhone 14', devices['iPhone 14']],
    ['iPhone 14 landscape', devices['iPhone 14 landscape']],
    ['Pixel 7', devices['Pixel 7']],
    ['iPad (gen 7) landscape', devices['iPad (gen 7) landscape']],
  ];
  try {
    for (const [name, prof] of profiles) {
      section('browser: ' + name);
      const ctx = await browser.newContext(Object.assign({}, prof, { acceptDownloads: true }));
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(href);
      await page.waitForFunction(() => window.BG && BG.Game && BG.Game.state === 'title', null, { timeout: 15000 });
      ok(await page.evaluate(() => !!BG.History && !!document.querySelector('#history') && !!document.querySelector('[data-hist=open]')), name + ': history UI installed');
      ok(await page.evaluate(() => document.querySelector('[data-hist=resume]').hidden), name + ': no Resume on a fresh profile');

      // open level 1 and build through the editor API (as touches / clicks would)
      await page.evaluate(() => { BG.Game.openLevel(1, { force: true }); BG.Hud.hideHint && BG.Hud.hideHint(); });
      await page.waitForTimeout(200);
      await page.evaluate(() => {
        const ed = BG.Game.editor;
        const drag = (x0, y0, x1, y1) => { ed.pointerDown(x0, y0, {}); for (let i = 1; i <= 6; i++) ed.pointerMove(x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6, {}); ed.pointerUp(x1, y1, {}); };
        drag(0, 0, 5, 0); ed.cancel ? ed.cancel() : (ed.chainFrom = null);
        ed.chainFrom = null;
        drag(0, -2.5, 5, 0); ed.chainFrom = null;
      });
      const built = await page.evaluate(() => BG.Game.getDesign().beams.length);
      ok(built >= 2, name + ': built beams via the editor', built);
      // move the camera, then wait for the debounced autosave (no explicit save call)
      await page.evaluate(() => { const c = BG.Game.renderer.camera; c.x += 1.75; c.y -= 0.5; c.zoom *= 1.2; });
      const cam = await page.evaluate(() => Object.assign({}, BG.Game.renderer.camera));
      await page.waitForTimeout(700);
      const savedBeams = await page.evaluate(() => (BG.Storage.loadDesign(1) || { beams: [] }).beams.length);
      ok(savedBeams === built, name + ': design autosaved (debounced) without leaving the level', { savedBeams, built });
      // the tab goes to the background (mobile: may be killed after this) -> everything flushed
      await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      const sess = await page.evaluate(() => BG.History.getSession());
      ok(sess && sess.state === 'edit' && sess.levelId === 1 && sess.cam && Math.abs(sess.cam.x - cam.x) < 1e-2, name + ': session + camera flushed on visibilitychange', sess);

      await page.reload();
      await page.waitForFunction(() => window.BG && BG.Game && BG.Game.state !== 'boot', null, { timeout: 15000 });
      await page.waitForTimeout(900);
      const after = await page.evaluate(() => ({ state: BG.Game.state, level: BG.Game.level && BG.Game.level.id, beams: BG.Game.getDesign().beams.length, cam: Object.assign({}, BG.Game.renderer.camera) }));
      ok(after.state === 'edit' && after.level === 1 && after.beams === built, name + ': reload resumes the level with the same design', after);
      ok(Math.abs(after.cam.x - cam.x) < 1e-2 && Math.abs(after.cam.y - cam.y) < 1e-2 && Math.abs(after.cam.zoom - cam.zoom) < 1e-2, name + ': camera restored', { cam, got: after.cam });

      // pass level 1 with the reference design -> results show a first pass; a cheaper re-run shows "New best"
      const res1 = await page.evaluate((sol) => {
        const g = BG.Game; g._replaceDesign(BG.Model.deserialize(JSON.stringify(sol)));
        g._lastToggle = -1e9; g.startSim(); let t = 0;
        while (g.state === 'sim' && t < 80) { g._updateSim(1 / 6); t += 1 / 6; }
        return { state: g.state, passed: g.lastResult && g.lastResult.passed, cost: g.lastResult && g.lastResult.cost, box: (document.querySelector('.hist-res') || {}).textContent || '' };
      }, sol1);
      ok(res1.state === 'results' && res1.passed && /First pass/.test(res1.box), name + ': results card shows first pass', res1);
      if (name === 'desktop' || name === 'iPhone 14') await page.screenshot({ path: path.join(OUT, name.replace(/\W+/g, '_') + '-results.png') });
      const res2 = await page.evaluate((sol) => {
        const g = BG.Game; g.backToEdit();
        const d = BG.Model.deserialize(JSON.stringify(sol));
        // a cheaper variant: same bridge, so it passes with the same cost -> no "new best"; then make it cheaper by
        // faking a lower previous best being higher (simulate an earlier pricier pass)
        const b = BG.Storage.get('hist.bests', {}); b['1'].cost.v += 420; BG.Storage.set('hist.bests', b);
        g._replaceDesign(d); g._lastToggle = -1e9; g.startSim(); let t = 0;
        while (g.state === 'sim' && t < 80) { g._updateSim(1 / 6); t += 1 / 6; }
        return { passed: g.lastResult && g.lastResult.passed, box: (document.querySelector('.hist-res') || {}).textContent || '' };
      }, sol1);
      ok(res2.passed && /New best!/.test(res2.box) && /420/.test(res2.box), name + ': results card shows New best vs previous', res2);

      // history screen: runs listed, filters, sparkline, load a design
      await page.evaluate(() => { BG.Game.backToEdit(); BG.Game.clearDesign(); BG.Game._saveNow(); BG.Game.goLevelSelect(); });
      await page.waitForTimeout(300);
      ok(await page.evaluate(() => /Best \$/.test((document.querySelector('.tile[data-id="1"]') || {}).title || '')), name + ': level tile tooltip shows personal bests');
      // (the level-select header overflows on narrow phones - mobile layout's area - so use the title button)
      await page.evaluate(() => BG.Game.goTitle());
      await page.waitForTimeout(300);
      await page.click('#screen-title [data-hist=open]');
      await page.waitForTimeout(400);
      const h1 = await page.evaluate(() => ({ open: BG.History.isOpen(), rows: document.querySelectorAll('#history .hist-run').length, loads: document.querySelectorAll('#history [data-hact=load]').length }));
      ok(h1.open && h1.rows === 2 && h1.loads === 2, name + ': history lists the runs with Load buttons', h1);
      await page.selectOption('#history [data-hfilter=level]', '1');
      ok(await page.evaluate(() => !!document.querySelector('#history .hist-lvhead .hist-spark circle')), name + ': per-level sparkline');
      await page.selectOption('#history [data-hfilter=result]', 'fail');
      ok(await page.evaluate(() => document.querySelectorAll('#history .hist-run').length === 0), name + ': result filter');
      await page.selectOption('#history [data-hfilter=result]', 'all');
      if (name === 'iPhone 14' || name === 'desktop') await page.screenshot({ path: path.join(OUT, name.replace(/\W+/g, '_') + '-history.png') });
      await page.click('#history [data-htab=stats]');
      const stats = await page.evaluate(() => document.querySelector('#history .hist-stats').textContent);
      ok(/Test runs\s*2/.test(stats) && /Bridges that held\s*2/.test(stats), name + ': stats tab', stats);
      await page.click('#history [data-htab=runs]');
      await page.click('#history [data-hact=load]');
      await page.waitForTimeout(300);
      const loaded = await page.evaluate((n) => ({ state: BG.Game.state, level: BG.Game.level && BG.Game.level.id, beams: BG.Game.getDesign().beams.length, open: BG.History.isOpen(), undo: BG.Game.editor.canUndo() }), sol1.beams.length);
      ok(loaded.state === 'edit' && loaded.level === 1 && loaded.beams === sol1.beams.length && !loaded.open && loaded.undo, name + ': Load opens the design in the editor (undoable)', loaded);

      // title: Resume button after going back to the title
      await page.evaluate(() => BG.Game.goTitle());
      await page.waitForTimeout(400);
      await page.reload();
      await page.waitForFunction(() => window.BG && BG.Game && BG.Game.state !== 'boot', null, { timeout: 15000 });
      await page.waitForTimeout(300);
      const t2 = await page.evaluate(() => ({ state: BG.Game.state, resume: !document.querySelector('[data-hist=resume]').hidden, label: document.querySelector('[data-hist=resume] .lbl').textContent }));
      ok(t2.state === 'title' && t2.resume && /Level 1/.test(t2.label), name + ': title after reload shows Resume', t2);
      await page.click('[data-hist=resume]');
      await page.waitForTimeout(300);
      ok(await page.evaluate(() => BG.Game.state === 'edit' && BG.Game.level.id === 1), name + ': Resume opens the level');

      if (name === 'desktop') {
        // export -> wipe -> import
        await page.evaluate(() => BG.Game.goTitle());
        await page.evaluate(() => BG.Hud.openSettings());
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#settings [data-hsave=export]')]);
        const file = path.join(OUT, 'export.json');
        await dl.saveAs(file);
        const exp = JSON.parse(fs.readFileSync(file, 'utf8'));
        ok(exp.format === 'span-save' && exp.data['hist.runs'].length === 2 && exp.data['design.1'], 'export downloads a JSON save', Object.keys(exp.data).length);
        await page.evaluate(() => { localStorage.clear(); });
        await page.reload();
        await page.waitForFunction(() => window.BG && BG.Game && BG.Game.state === 'title', null, { timeout: 15000 });
        ok(await page.evaluate(() => BG.History.getRuns().length === 0), 'wiped');
        await page.evaluate(() => BG.Hud.openSettings());
        await page.setInputFiles('#settings [data-hsave=file]', file);
        await page.waitForEvent('load', { timeout: 10000 });
        await page.waitForFunction(() => window.BG && BG.Game && BG.Game.state !== 'boot', null, { timeout: 15000 });
        const imp = await page.evaluate(() => ({ runs: BG.History.getRuns().length, done: BG.Storage.isCompleted(1), beams: (BG.Storage.loadDesign(1) || { beams: [] }).beams.length }));
        ok(imp.runs === 2 && imp.done && imp.beams > 0, 'import restores the save after reload', imp);
        // ?level= in the URL wins over resume
        await page.goto(href + '?screen=levels');
        await page.waitForTimeout(500);
        ok(await page.evaluate(() => BG.Game.state === 'levelSelect'), 'URL parameters override resume');
      }
      ok(!errors.length, name + ': no page errors', errors.slice(0, 5));
      await ctx.close();
    }
  } finally { await browser.close(); }
}

(async () => {
  nodeTests();
  if (process.argv.indexOf('--node-only') < 0) {
    try { await browserTests(); } catch (e) { fail++; console.log('  FAIL: browser tests threw: ' + (e && e.stack || e)); }
  }
  console.log((fail ? 'FAILED' : 'OK') + ': ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
