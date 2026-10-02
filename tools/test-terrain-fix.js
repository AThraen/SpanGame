#!/usr/bin/env node
// terrain-fix tests: the waterline is a build limit and the drawn terrain matches the model's terrain.
//   Node part:    BG.Model 'underwater' rule, every solution design stays legal, editor ghost / toast.
//   Browser part: (headless Chromium via playwright, never a visible window) for every level the drawn cliff
//                 faces stay within the joint clearance of the model's vertical cliffs wherever joints may
//                 go, and the waterline overlay band matches the levels whose build area reaches under water.
// Usage: node tools/test-terrain-fix.js [--no-browser]
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { BG } = require('./harness');
const load = (rel) => require(path.join(ROOT, rel));
load('js/ui/editor.js');

let pass = 0, fail = 0;
const ok = (c, msg, info) => { if (c) pass++; else { fail++; console.log('  FAIL: ' + msg + (info !== undefined ? '  ' + JSON.stringify(info) : '')); } };
const section = (s) => console.log('- ' + s);

function level(o) {
  return Object.assign({
    id: 901, name: 'Wet test', theme: 'meadow',
    terrain: { leftEdge: 0, leftY: 0, rightEdge: 20, rightY: 0, floorY: -8, waterY: -4 },
    anchors: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: -6 }],
    pierZones: [{ x0: 8, x1: 12 }], maxPiers: 1, noBuild: [],
    buildArea: { x0: 0, x1: 20, y0: -8, y1: 8 },
    materials: ['road', 'wood', 'steel'], budget: 1e6, traffic: [{ type: 'car', count: 1, interval: 2 }], timeLimit: 30,
  }, o || {});
}
const types = (lv, d) => BG.Model.validate(lv, d).errors.map(e => e.type);

// ---------------------------------------------------------------- model
section('model: underwater rule');
{
  const L = level();
  ok(BG.Model.belowWater(L, 5, -4.5) && !BG.Model.belowWater(L, 5, -4) && !BG.Model.belowWater(L, 5, -3.9), 'belowWater boundary (waterline itself is buildable)');
  ok(!BG.Model.belowWater(level({ terrain: Object.assign({}, L.terrain, { waterY: null }) }), 5, -7), 'dry level: nothing is under water');
  ok(typeof BG.Model.UNDERWATER_MSG === 'string' && /under water/i.test(BG.Model.UNDERWATER_MSG), 'message exported');
  const under = { nodes: [{ id: 'n1', x: 5, y: -5 }], beams: [{ a: 'a0', b: 'n1', m: 'steel' }], piers: [] };
  const e = BG.Model.validate(L, under).errors.filter(x => x.type === 'underwater');
  ok(e.length === 1 && e[0].nodeId === 'n1' && e[0].msg === BG.Model.UNDERWATER_MSG, 'joint below the water -> underwater error on that joint', e);
  ok(types(L, { nodes: [{ id: 'n1', x: 5, y: -4 }], beams: [{ a: 'a0', b: 'n1', m: 'steel' }], piers: [] }).indexOf('underwater') < 0, 'joint exactly on the waterline is legal');
  ok(types(level({ terrain: Object.assign({}, L.terrain, { waterY: null }) }), under).indexOf('underwater') < 0, 'same joint on a dry level is legal');
  // anchors and piers may be under water; a beam between them may too
  const pierLow = { nodes: [], beams: [{ a: 'a2', b: 'p0', m: 'steel' }], piers: [{ x: 8, topY: -5 }] };
  const pt = types(L, pierLow);
  ok(pt.indexOf('underwater') < 0, 'anchor + pier top under water, beam between them: legal', pt);
  const pierUp = { nodes: [{ id: 'n1', x: 4, y: -2 }], beams: [{ a: 'a2', b: 'n1', m: 'steel' }, { a: 'n1', b: 'p0', m: 'steel' }], piers: [{ x: 8, topY: -2 }] };
  ok(types(L, pierUp).indexOf('underwater') < 0, 'beam rising from an underwater anchor to a joint above the water: legal');
}

section('model: every solution design is unaffected');
{
  let n = 0, bad = [];
  for (const L of BG.Levels) for (const suf of ['', '-best']) {
    const f = path.join(__dirname, 'solutions', 'level-' + String(L.id).padStart(2, '0') + suf + '.json');
    if (!fs.existsSync(f)) continue;
    n++;
    const d = BG.Model.deserialize(fs.readFileSync(f, 'utf8'));
    if (BG.Model.validate(L, d).errors.some(e => e.type === 'underwater')) bad.push(L.id + suf);
  }
  ok(n === 2 * BG.Levels.length, 'found all solution files', n);
  ok(bad.length === 0, 'no solution uses an underwater joint', bad);
}

// ---------------------------------------------------------------- editor
section('editor: red ghost, toast, no joint under water');
{
  const L = level();
  const game = { level: L, state: 'edit', sounds: [], audio: { play(nm) { game.sounds.push(nm); } }, hud: { toast(m) { game.lastToast = m; } },
    renderer: { camera: { x: 10, y: 0, zoom: 40 }, screenToWorld(x, y) { return { x, y }; }, worldToScreen(x, y) { return { x, y }; }, fitToLevel() {} }, onDesignChanged() {} };
  const ed = new BG.Editor(game);
  game.editor = ed;
  if (ed.load) ed.load(BG.Model.emptyDesign(), L);
  if (ed.setMaterial) ed.setMaterial('steel'); else ed.material = 'steel';
  ok(ed._pointProblem(5, -5) === 'underwater', 'point below the water is a problem', ed._pointProblem(5, -5));
  ok(ed._pointProblem(5, -3) === null, 'point above the water is fine', ed._pointProblem(5, -3));
  const g = ed._ghost('a0', 3, -5, {});
  ok(g && g.valid === false && g.reason === 'underwater', 'ghost into the water is red (invalid, reason underwater)', g && g.reason);
  const end = ed.buildBeam('a0', 3, -5, {});
  ok(end == null && ed.design.nodes.length === 0, 'beam into the water is not built');
  ok(game.lastToast === BG.Model.UNDERWATER_MSG, 'toast explains why', game.lastToast);
  ok(game.sounds.indexOf('error') >= 0, 'error sound');
  const ok1 = ed.buildBeam('a0', 4, -3, {});
  ok(!!ok1 && ed.design.nodes.length === 1, 'beam above the water still builds');
  const g2 = ed._ghost('a2', 3, -2, {});
  ok(g2 && g2.valid, 'beam from an underwater anchor up to a dry joint is allowed', g2 && g2.reason);
}

// ---------------------------------------------------------------- browser
async function browserPart() {
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { console.log('  (playwright not available: browser part skipped)'); return; }
  section('renderer: drawn cliffs match the model; waterline overlay');
  const url = require('url');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(url.pathToFileURL(path.join(ROOT, 'index.html')).href);
    await page.waitForTimeout(800);
    const res = await page.evaluate(() => {
      const out = [];
      for (const L of BG.Levels) {
        BG.Game.openLevel(L.id, { force: true });
        const r = BG.Game.renderer, T = r.terrain, t = L.terrain, ba = L.buildArea;
        const lim = Math.max(typeof t.waterY === 'number' ? t.waterY : -1e9, ba ? ba.y0 : -1e9);
        let worst = 0;
        for (const [pts, edge, s] of [[T.left, t.leftEdge, 1], [T.right, t.rightEdge, -1]]) {
          for (const q of pts) if (q.y >= lim + 0.01) worst = Math.max(worst, s * (q.x - edge));
        }
        r.render && r.render({ mode: 'edit', design: BG.Game.design, editorState: BG.Game.editor && BG.Game.editor.state }, 1 / 60);
        out.push({ id: L.id, worst, band: !!BG.TerrainFix.limitBand(L), under: typeof t.waterY === 'number' && ba && ba.y0 < t.waterY - 1e-6 });
      }
      BG.Game.goLevelSelect && BG.Game.goLevelSelect();
      return out;
    });
    const tooFar = res.filter(x => x.worst > 0.45 + 1e-6);
    ok(tooFar.length === 0, 'drawn cliff bulges < 0.45 m into the gap wherever joints may go (all levels)', tooFar.map(x => x.id + ':' + x.worst.toFixed(2)));
    const mism = res.filter(x => x.band !== !!x.under);
    ok(mism.length === 0, 'waterline band shown exactly on levels whose build area reaches under water', mism.map(x => x.id));
    ok(res.filter(x => x.band).length > 0, 'some levels show the waterline band', res.filter(x => x.band).map(x => x.id));
    ok(errs.length === 0, 'no page errors while rendering every level', errs.slice(0, 3));
  } finally { await browser.close(); }
}

(async () => {
  if (process.argv.indexOf('--no-browser') < 0) {
    try { await browserPart(); } catch (e) { ok(false, 'browser part crashed: ' + e.message); }
  }
  console.log(pass + '/' + (pass + fail) + ' terrain-fix checks passed');
  process.exit(fail ? 1 : 0);
})();
