// Arch & Curve tool tests (SPEC §18). Usage: node tools/test-arch-tool.js [--node-only] [outDir=%TEMP%/span-arch]
//  1. geometry (BG.Curves, Node): parabola / circle / catenary sampling, equal chords, fewest segments under the max
//     length after grid snapping, deck-aligned stations, parabola fit
//  2. editor (Node, fake game / renderer / canvas like test-editor.js): the drag-release-rise-click gesture, magnet
//     endpoints, segment count (+/-, wheel), Esc / right-click / two-finger-tap cancel, validity reasons (no-build,
//     tension-only arches, hanging stone, terrain), Connect to deck (posts, hangers, deck splits, bracing), mirror,
//     one undo step, live cost, Smooth for the select tool, the overlay renderer on a fake canvas; usability fixes (fair
//     snapping, deck crossings, cable bracing, deck-aware defaults, Place, labels clear of the HUD)
//  3. headless sim (Node): level 15 (deck arch from the cliff bolts), level 106 (masonry arch under a rail deck),
//     level 25 and level 208 (suspension main cable + side cables) built with the tool all pass
//  4. browser (headless Chrome, never a visible window): the same four levels built with real mouse input and the
//     contextual bar, then Test is pressed and the run passes; the "Try the Arch tool (A)" hint; a touch phone builds
//     an arch with the loupe and the rise handle, the bar fits and has 44 px targets, a two-finger tap cancels.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const NODE_ONLY = args.includes('--node-only');
const OUT = args.find((a) => !a.startsWith('--')) || path.join(require('os').tmpdir(), 'span-arch');

const { BG, runHeadless } = require('./harness');
require(path.join(ROOT, 'js/ui/editor.js'));
require(path.join(ROOT, 'js/ui/arch-tool.js'));
const Cv = BG.Curves;
const DEFAULT_OPT = Object.assign({}, BG.ArchTool.OPT); // before any test changes the shared options

let pass = 0, fail = 0;
function ok(c, msg, info) { if (c) pass++; else { fail++; console.log('  FAIL: ' + msg + (info !== undefined ? '  ' + JSON.stringify(info) : '')); } }
function near(a, b, e) { return Math.abs(a - b) <= (e == null ? 1e-6 : e); }
function section(name) { console.log('- ' + name); }
const hyp = (x, y) => Math.sqrt(x * x + y * y);
const onGrid = (v, g) => near(Math.round(v / g) * g, v, 1e-6);

// ===================================================================== 1. geometry
section('geometry: shapes');
{
  for (const sh of Cv.SHAPES) {
    const c = Cv.make(sh, 0, 0, 20, 0, 5);
    const a = c.at(0), b = c.at(1), m = c.at(0.5);
    ok(near(a.x, 0) && near(a.y, 0) && near(b.x, 20) && near(b.y, 0), sh + ': exact endpoints');
    ok(near(m.x, 10, 1e-6) && near(m.y, 5, 1e-6), sh + ': crown at mid-span, rise 5', m);
    const p = c.at(0.3), q = c.at(0.7);
    ok(near(p.y, q.y, 1e-6) && near(p.x + q.x, 20, 1e-6), sh + ': symmetric');
    ok(c.length > 20 && c.length < 20 + 2 * 5, sh + ': arc length between chord and chord + 2 rise', c.length);
    const s = Cv.make(sh, 0, 0, 20, 0, -4);
    ok(near(s.at(0.5).y, -4, 1e-6), sh + ': negative rise sags below the chord');
  }
  const par = Cv.make('parabolic', 0, 0, 20, 0, 5);
  ok(near(par.at(0.25).y, 5 * 4 * 0.25 * 0.75), 'parabola y = 4 rise t (1 - t)');
  const cat = Cv.make('catenary', 0, 0, 40, 0, -10);
  const k = Cv.catenaryK(10 / 20);
  ok(near((Math.cosh(k) - 1) / k, 0.5, 1e-9), 'catenary k solves (cosh k - 1) / k = sag / half-span');
  ok(!near(cat.at(0.25).y, Cv.make('parabolic', 0, 0, 40, 0, -10).at(0.25).y, 1e-3), 'catenary differs from the parabola');
  const circ = Cv.make('circular', 0, 0, 10, 0, 5);
  const R = circ.radius;
  ok(near(R, 5, 1e-9), 'semicircle radius = half chord');
  let onCircle = true;
  for (let t = 0; t <= 1; t += 0.05) { const p = circ.at(t); if (!near(hyp(p.x - 5, p.y), 5, 1e-6)) onCircle = false; }
  ok(onCircle, 'circular points lie on the circle');
  const clamp = Cv.make('circular', 0, 0, 10, 0, 9);
  ok(near(clamp.rise, 5) && near(clamp.at(0.5).y, 5, 1e-6), 'circular rise clamps to a half circle (Roman arch)');
  const sl = Cv.make('circular', 0, 0, 12, 4, 2);
  const mid = sl.at(0.5), dx = 12, dy = 4, L = hyp(dx, dy);
  ok(near(((mid.x - 6) * -dy + (mid.y - 2) * dx) / L, 2, 1e-6), 'circular sagitta measured across a sloped chord');
  ok(Cv.yAt(par, 5) !== null && near(Cv.yAt(par, 5), par.at(0.25).y), 'yAt on a parabola');
  ok(Cv.yAt(clamp, 2.5) !== null && near(Cv.yAt(clamp, 5), 5, 1e-3), 'yAt on a circle (from samples)');
  ok(Cv.yAt(par, 25) === null, 'yAt outside the span = null');
}

section('geometry: equal chords, fewest segments, grid');
{
  for (const sh of Cv.SHAPES) {
    const c = Cv.make(sh, 0, -9, 36, -9, 8.5);
    const pts = Cv.divide(c, 7);
    const Ls = Cv.lengthsOf(pts);
    ok(pts.length === 8 && Ls.every((l) => near(l, Ls[0], 1e-3)), sh + ': divide() gives equal chords', Ls.map((l) => +l.toFixed(4)));
    let onCurve = true;
    for (const p of pts) { const y = Cv.yAt(c, p.x); if (y == null || !near(y, p.y, 1e-3)) onCurve = false; }
    ok(onCurve, sh + ': divided points lie on the curve');
    for (const maxLen of [5, 6, 10]) {
      const s = Cv.segment(c, { maxLen, grid: 0.25, margin: 0.02 });
      ok(s.ok && s.lengths.every((l) => l <= maxLen * 0.98 + 1e-9), sh + ' max ' + maxLen + ': all segments <= max length minus margin', s.lengths);
      ok(s.points.slice(1, -1).every((p) => onGrid(p.x, 0.25) && onGrid(p.y, 0.25)), sh + ' max ' + maxLen + ': interior joints on the 0.25 m grid');
      const fewer = Cv.snapped(c, s.n - 1, 0.25);
      ok(s.n === 1 || Cv.lengthsOf(fewer).some((l) => l > maxLen * 0.98 + 1e-9), sh + ' max ' + maxLen + ': the fewest segments (' + s.n + ')');
      ok(s.n === s.nMin, sh + ': n = nMin without an override');
      const more = Cv.segment(c, { maxLen, grid: 0.25, n: s.n + 3 });
      ok(more.n === s.n + 3 && more.nMin === s.n, sh + ': an explicit n overrides the count');
      // smoothness: no snapped joint strays more than half a grid diagonal from the curve
      let dev = 0;
      for (const p of s.points) { const y = Cv.yAt(c, p.x); if (y != null) dev = Math.max(dev, Math.abs(y - p.y)); }
      ok(dev <= 0.25, sh + ': snapped joints stay on the curve (dev ' + dev.toFixed(3) + ' m)');
    }
  }
}

section('geometry: deck-aligned stations, parabola fit');
{
  const c = Cv.make('parabolic', 0, -9, 36, -9, 8.5);
  const s = Cv.alignedSegment(c, [6, 12, 18, 24, 30], { maxLen: 10, grid: 0.25 });
  ok(s && s.ok && s.n === 6 && [6, 12, 18, 24, 30].every((x, i) => near(s.points[i + 1].x, x) && s.points[i + 1].station), 'stations become joints at the deck joints', s && s.points);
  const m = Cv.alignedSegment(c, [6, 12, 18, 24, 30], { maxLen: 5, grid: 0.25 });
  ok(m && m.ok && m.n > 6 && m.lengths.every((l) => l <= 5 * 0.98 + 1e-9), 'short material: intervals subdivided', m && m.lengths);
  const x = Cv.alignedSegment(c, [6, 12, 18, 24, 30], { maxLen: 10, grid: 0.25, n: 9 });
  ok(x && x.n === 9 && x.nMin === 6, '+ segments splits the longest chords');
  const pts = [];
  for (let i = 0; i <= 8; i++) { const xx = i * 4; pts.push({ x: xx, y: 2 + 0.25 * xx + 6 * 4 * (xx / 32) * (1 - xx / 32) }); }
  const f = Cv.fitParabola(pts);
  ok(near(f.rise, 6, 1e-9) && near(f.x0, 0) && near(f.y1, 10), 'fitParabola recovers an exact parabola', f.rise);
  const noisy = pts.map((p, i) => ({ x: p.x, y: p.y + (i % 2 ? 0.3 : -0.3) * (i > 0 && i < 8 ? 1 : 0) }));
  ok(near(Cv.fitParabola(noisy).rise, 6, 0.4), 'fitParabola: least squares through noise');
}

// ===================================================================== 2. editor
function makeLevel(o) {
  return Object.assign({
    id: 1, name: 'Arch test', theme: 'canyon',
    terrain: { leftEdge: 0, leftY: 0, rightEdge: 24, rightY: 0, floorY: -14, waterY: null },
    anchors: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 0, y: -6 }, { x: 24, y: -6 }],
    pierZones: [], maxPiers: 0, noBuild: [],
    buildArea: { x0: 0, x1: 24, y0: -10, y1: 10 },
    materials: ['road', 'wood', 'steel', 'cable', 'masonry'], budget: 1e6, traffic: [{ type: 'car', count: 1, interval: 2 }], timeLimit: 30, templates: true,
  }, o || {});
}
function makeGame(level) {
  const W = 1000, H = 600;
  const g = {
    level, state: 'edit', sounds: [], changes: 0, toasts: [],
    renderer: {
      camera: { x: 12, y: -2, zoom: 30 },
      screenToWorld(sx, sy) { return { x: this.camera.x + (sx - W / 2) / this.camera.zoom, y: this.camera.y - (sy - H / 2) / this.camera.zoom }; },
      worldToScreen(x, y) { return { x: (x - this.camera.x) * this.camera.zoom + W / 2, y: (this.camera.y - y) * this.camera.zoom + H / 2 }; },
    },
    audio: { play(n) { g.sounds.push(n); } },
    onDesignChanged() { g.changes++; },
    hud: { toast(m) { g.toasts.push(m); } },
  };
  return g;
}
function fresh(lv) {
  const level = lv && lv.terrain && lv.anchors && lv.id > 1 ? lv : makeLevel(lv);
  const game = makeGame(level);
  const ed = new BG.Editor(game);
  game.editor = ed;
  const opt = ed.archOptions();
  Object.assign(opt, { shape: 'parabolic', connect: false, brace: true, connMat: 'auto' });
  return { level, game, ed, opt };
}
const levelById = (id) => BG.Levels.find((l) => l.id === id);
function deck(ed, x0, x1, step, m, y) {
  const prev = ed.tool, pm = ed.material;
  ed.setTool('build'); ed.setMaterial(m || 'road');
  let from = ed._nodes().list.find((n) => near(n.x, x0) && near(n.y, y || 0)).id;
  for (let x = x0; x < x1 - 1e-9;) { x = Math.min(x + step, x1); from = ed.buildBeam(from, x, y || 0); if (!from) break; }
  ed.escape();
  ed.setTool(prev); if (pm) ed.setMaterial(pm);
}
function drag(ed, x0, y0, x1, y1, o) {
  o = Object.assign({ pointerType: 'mouse', button: 0 }, o || {});
  ed.pointerDown(x0, y0, o);
  for (let i = 1; i <= 6; i++) ed.pointerMove(x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6, o);
  ed.pointerUp(x1, y1, o);
}
const M = (o) => Object.assign({ pointerType: 'mouse', button: 0 }, o || {});
const hasBeam = (ed, a, b) => ed.design.beams.some((q) => (q.a === a && q.b === b) || (q.a === b && q.b === a));
const valid = (ed) => BG.Model.validate(ed._level(), ed.design);

section('editor: tool, key A, material, bar options');
{
  const { ed, game } = fresh();
  ok(ed.keyDown('a') === true && ed.tool === 'arch', 'A selects the arch tool');
  ok(ed.material === 'masonry' || ed.material === 'steel', 'a road material switches to an arch material', ed.material);
  ok(ed.state.arch && ed.state.arch.phase === 'idle', 'renderer state: arch idle');
  ed.setMaterial('wood');
  ok(ed.tool === 'arch' && ed.material === 'wood', 'picking a material keeps the arch tool');
  ed.keyDown('a');
  ok(ed.tool === 'build', 'A again returns to build');
  ed.setTool('arch');
  ok(ed.setArchShape('circular') && ed.archOptions().shape === 'circular' && !ed.setArchShape('gothic'), 'shape chips');
  ed.setArchShape('parabolic');
  ed.setArchConnect(true); ok(ed.archOptions().connect === true, 'connect toggle');
  ed.setArchBrace(false); ok(ed.archOptions().brace === false, 'brace toggle');
  ok(ed.setArchConnector('steel') === 'steel' && ed.setArchConnector('nonsense') === 'auto', 'connector material');
  ed.setArchConnect(false); ed.setArchBrace(true);
  ok(game.sounds.length > 0, 'sounds');
}

section('editor: drag, release, rise, click (mouse)');
{
  const { ed, game } = fresh();
  ed.setTool('arch'); ed.setMaterial('steel');
  drag(ed, 0.1, -6.1, 23.9, -5.9);
  let av = ed.state.arch;
  ok(av.phase === 'rise' && av.a.id === 'a2' && av.b.id === 'a3', 'press on a bolt, release on the other: magnet endpoints, rise phase', av && { a: av.a, b: av.b, phase: av.phase });
  ed.pointerMove(12, 0.2, M());
  av = ed.state.arch;
  ok(near(av.plan.rise, 6.25) && av.plan.valid, 'the crown follows the pointer height (rise on the 0.25 m grid)', av.plan.rise);
  ok(av.plan.n === av.plan.nMin && av.plan.segs.every((s) => s.len <= 10 * 0.98 + 1e-9), 'fewest steel segments, each <= 10 m');
  ok(av.handle && near(av.handle.x, 12, 1e-6), 'rise handle at the crown');
  const nMin = av.plan.n;
  ok(ed.keyDown('+') && ed.state.arch.plan.n === nMin + 1, '+ adds a segment');
  ok(ed._archWheel(-120) && ed.state.arch.plan.n === nMin + 2, 'wheel adds a segment while setting the rise');
  ed.keyDown('-'); ed.keyDown('-'); ed.keyDown('-');
  ok(ed.state.arch.plan.n === nMin, '- stops at the fewest legal segments');
  const cost0 = ed.cost;
  const planCost = ed.state.arch.plan.cost;
  ok(planCost > 0, 'plan cost', planCost);
  const changes0 = game.changes, undo0 = ed.undoStack.length;
  ed.pointerDown(12, 0.2, M()); ed.pointerUp(12, 0.2, M());
  ok(ed.state.arch.phase === 'idle' && ed.lastArch && ed.lastArch.ids[0] === 'a2' && ed.lastArch.ids[ed.lastArch.ids.length - 1] === 'a3', 'click places the arch between the bolts');
  ok(ed.design.beams.length === nMin && ed.design.beams.every((b) => b.m === 'steel'), nMin + ' steel members');
  ok(valid(ed).ok, 'design valid', valid(ed).errors);
  ok(ed.design.nodes.every((n) => onGrid(n.x, 0.25) && onGrid(n.y, 0.25)), 'joints on the grid');
  ok(near(ed.cost - cost0, planCost, 1.5), 'cost rises by the previewed amount', [ed.cost - cost0, planCost]);
  ok(ed.undoStack.length === undo0 + 1 && game.changes > changes0, 'one undo step');
  ed.undo();
  ok(ed.design.beams.length === 0 && ed.design.nodes.length === 0, 'undo removes the whole arch');
  ed.redo();
  ok(ed.design.beams.length === nMin, 'redo brings it back');
}

section('editor: cancel (Esc, right-click, second finger), click-click, touch');
{
  const { ed } = fresh();
  ed.setTool('arch'); ed.setMaterial('steel');
  drag(ed, 0, -6, 24, -6);
  ok(ed.archActive(), 'curve in progress');
  ok(ed.keyDown('Escape') && !ed.archActive() && ed.design.beams.length === 0 && ed.tool === 'arch', 'Esc cancels (tool stays)');
  ed.keyDown('Escape');
  ok(ed.tool === 'build', 'a second Esc leaves the tool');
  ed.setTool('arch');
  drag(ed, 0, -6, 24, -6);
  ok(ed.rightClick(12, 3, M()) && !ed.archActive() && ed.design.beams.length === 0, 'right-click cancels');
  ed.pointerDown(0, -6, M()); ed.pointerMove(6, -5, M()); ed.pointerMove(12, -5, M());
  ed.pointerCancel();
  ok(!ed.archActive(), 'a second finger mid-drag (pointerCancel) cancels the drag');
  // click-click
  ed.pointerDown(0, -6, M()); ed.pointerUp(0, -6, M());
  ok(ed.state.arch.phase === 'end', 'a click picks the start; the end follows the pointer');
  ed.pointerMove(24, -6, M());
  ok(ed.state.arch.b && ed.state.arch.b.id === 'a3', 'end magnet while hovering');
  ed.pointerDown(24, -6, M()); ed.pointerUp(24, -6, M());
  ok(ed.state.arch.phase === 'rise', 'second click: rise phase');
  ed.pointerMove(12, -1, M());
  ed.pointerDown(12, -1, M()); ed.pointerUp(12, -1, M());
  ok(ed.design.beams.length > 0 && valid(ed).ok, 'click-click-click builds');
  ed.undo();
  // touch: default rise, relative drag on the handle, tap to place
  const T = M({ pointerType: 'touch' });
  drag(ed, 0, -6, 24, -6, T);
  const r0 = ed.state.arch.rise;
  ok(ed.state.arch.phase === 'rise' && r0 > 0 && ed.state.arch.touch, 'touch release: a default rise to start from', r0);
  ed.pointerMove(12, 8, T);
  ok(ed.state.arch.rise === r0, 'touch: hovering does not exist, rise unchanged');
  const h = ed.state.arch.handle;
  ed.pointerDown(h.x, h.y, T);
  for (let i = 1; i <= 5; i++) ed.pointerMove(h.x, h.y + i * 0.4, T);
  ok(near(ed.state.arch.rise, r0 + 2, 1e-9) && ed.state.arch.pressing, 'dragging the handle raises the crown', ed.state.arch.rise);
  ed.pointerUp(h.x, h.y + 2, T);
  ok(ed.archActive() && ed.design.beams.length === 0, 'releasing a handle drag does not place');
  ed.pointerDown(5, 5, T); ed.pointerUp(5, 5, T);
  ok(!ed.archActive() && ed.design.beams.length > 0, 'a tap places');
  ok(Math.abs(ed.lastArch.rise - (r0 + 2)) < 1e-9, 'placed with the dragged rise');
}

section('editor: validity reasons');
{
  const { ed } = fresh({ noBuild: [{ x0: 10, x1: 14, y0: -2, y1: 4 }] });
  ed.setTool('arch'); ed.setMaterial('steel');
  drag(ed, 0, -6, 24, -6);
  ed.pointerMove(12, 1, M());
  let p = ed.state.arch.plan;
  ok(!p.valid && p.segs.some((s) => !s.valid && s.reason === 'in_nobuild') && p.segs.some((s) => s.valid), 'per-segment validity: segments through the no-build zone are red', p.segs.map((s) => s.reason));
  ok(/no-build/.test(p.reasonText), 'reason text', p.reasonText);
  const n0 = ed.design.beams.length;
  ed.pointerDown(12, 1, M()); ed.pointerUp(12, 1, M());
  ok(ed.design.beams.length === n0 && ed.archActive(), 'an invalid curve is not placed (the curve stays to fix)');
  ed.pointerMove(12, -4.5, M());
  ok(ed.state.arch.plan.valid, 'lower crown clears the zone');
  ed.archCancel();
  // tension-only material
  ed.setMaterial('cable');
  drag(ed, 0, -6, 24, -6);
  ed.pointerMove(12, -1, M());
  p = ed.state.arch.plan;
  ok(!p.valid && p.reason === 'tension_only' && /tension/.test(p.reasonText), 'cable arch: explained, not allowed', p.reasonText);
  ed.pointerMove(12, -9, M());
  ok(ed.state.arch.plan.valid && ed.state.arch.plan.rise < 0, 'cable sagging below the line is fine');
  ed.archCancel();
  ed.setMaterial('masonry');
  drag(ed, 0, -6, 24, -6);
  ed.pointerMove(12, -9, M());
  ok(ed.state.arch.plan.reason === 'stone_hangs', 'hanging stone: explained, not allowed');
  ed.archCancel();
  // terrain + build area
  ed.setMaterial('steel');
  drag(ed, 0, -6, 24, -6);
  ed.pointerMove(12, -12, M());
  p = ed.state.arch.plan;
  ok(!p.valid && /build area|ground/i.test(p.reasonText), 'sag out of the build area / into the ground is red', p.reasonText);
  ed.archCancel();
  drag(ed, 3, 3, 3.3, 3);
  ok(ed.state.arch.phase === 'end', 'a too-short drag becomes a start click');
  ed.archCancel();
}

section('editor: interior joints join the deck; Connect to deck (posts, bracing, hangers)');
{
  const { ed, opt } = fresh();
  deck(ed, 0, 24, 6);
  ed.setTool('arch'); ed.setMaterial('steel');
  // an arch whose crown touches the deck: the crown joint reuses a deck joint ...
  const r = ed.placeArch(0, -6, 24, -6, 6, { n: 4 });
  ok(r && valid(ed).ok, 'arch under the deck placed', valid(ed).errors);
  const crown = r.ids.map((id) => ed._node(id)).find((n) => near(n.y, 0));
  ok(crown && near(crown.x, 12) && ed.design.beams.some((b) => (b.a === crown.id || b.b === crown.id) && b.m === 'road'), 'a curve joint on a deck joint uses it');
  ed.undo();
  // ... or splits the deck beam it lands on
  const rs = ed.placeArch(1, -6, 17, -6, 6, { n: 4 });
  const cr2 = rs && rs.ids.map((id) => ed._node(id)).find((n) => near(n.y, 0));
  ok(cr2 && near(cr2.x, 9) && ed.design.beams.filter((b) => (b.a === cr2.id || b.b === cr2.id) && b.m === 'road').length === 2 && valid(ed).ok, 'a curve joint on a deck beam splits it (joined)', cr2);
  ed.undo();
  // connect + brace
  opt.connect = true; opt.brace = true;
  drag(ed, 0, -6, 24, -6);
  ed.pointerMove(12, -1, M());
  const p = ed.state.arch.plan;
  ok(p.aligned && p.joints.slice(1, -1).every((j) => [6, 12, 18].some((x) => near(j.x, x))) , 'Connect: curve joints line up under the deck joints', p.joints.map((j) => j.x));
  ok(p.connectors.length === 3 && p.connectors.every((c) => c.valid && c.kind === 'post' && c.m === 'steel' && c.target), 'preview: three steel posts to existing deck joints', p.connectors.map((c) => [c.kind, c.m, c.target]));
  ok(p.braces.length > 0 && p.braces.every((b) => b.valid), 'preview: bracing diagonals', p.braces.length);
  const nb0 = ed.design.beams.length;
  ed.pointerDown(12, -1, M()); ed.pointerUp(12, -1, M());
  const la = ed.lastArch;
  ok(la && la.posts === 3 && la.braces === p.braces.length, 'placed with posts and braces', la);
  ok(ed.design.beams.length === nb0 + p.n + 3 + la.braces, 'member count = curve + posts + braces');
  ok(valid(ed).ok, 'valid', valid(ed).errors);
  ok(ed.undoStack.length && (ed.undo(), ed.design.beams.length === nb0), 'one undo step for curve + posts + braces');
  // a curve joint between deck joints: the deck beam is split for its post
  opt.brace = false;
  const r2 = ed.placeArch(0, -6, 24, -6, 5, { n: 5 });
  ok(r2 && r2.posts >= 3, 'extra segments: more posts', r2);
  const deckJoints = new Set(); ed.design.beams.filter((b) => b.m === 'road').forEach((b) => { deckJoints.add(b.a); deckJoints.add(b.b); });
  ok(deckJoints.size > 5 && valid(ed).ok, 'deck beams split where a post needs a joint (' + deckJoints.size + ' deck joints)');
  ed.undo();
  // a through arch over the deck: hangers (cable when offered)
  const r3 = ed.placeArch(0, 0, 24, 0, 6, {});
  const hangers = ed.design.beams.filter((b) => b.m === 'cable');
  ok(r3 && hangers.length >= 3 && valid(ed).ok, 'through arch: cable hangers down to the deck', { r3, h: hangers.length });
  ed.undo();
  // no deck: nothing to connect, explained
  const f2 = fresh();
  f2.opt.connect = true;
  f2.ed.setTool('arch'); f2.ed.setMaterial('steel');
  f2.ed.placeArch(0, -6, 24, -6, 5, {});
  ok(f2.game.toasts.some((t) => /deck first/.test(t)), 'no deck: toast explains', f2.game.toasts);
  // connectors that would break a rule are skipped
  const f3 = fresh({ noBuild: [{ x0: 11, x1: 13, y0: -3, y1: -0.5 }] });
  deck(f3.ed, 0, 24, 6);
  f3.opt.connect = true; f3.opt.brace = false;
  f3.ed.setTool('arch'); f3.ed.setMaterial('steel');
  const r4 = f3.ed.placeArch(0, -6, 24, -6, 2.5, {});
  ok(r4 && r4.skipped >= 1 && valid(f3.ed).ok && f3.game.toasts.some((t) => /skipped/.test(t)), 'a post into a no-build zone is skipped', r4);
}

section('editor: mirror');
{
  const { ed } = fresh();
  ed.setTool('arch'); ed.setMaterial('steel');
  ed.toggleMirror();
  const r = ed.placeArch(0, -6, 12, 0, 2, {});
  ok(r && r.mirror.length === r.ids.length, 'an arch on one side is mirrored', r);
  const L = r.ids.map((id) => ed._node(id)), Rr = r.mirror.map((id) => ed._node(id));
  ok(L.every((n, i) => near(n.x, 24 - Rr[i].x, 1e-6) && near(n.y, Rr[i].y, 1e-6)), 'mirror joints are mirror images');
  ok(Rr[0].id === 'a3' && valid(ed).ok, 'the mirrored arch springs from the mirrored bolt');
  ed.undo();
  ok(ed.design.beams.length === 0, 'both arches in one undo step');
  const r2 = ed.placeArch(0, -6, 24, -6, 5, {});
  ok(r2 && !r2.mirror.length && valid(ed).ok, 'an arch across the axis is already symmetric: not doubled');
}

section('editor: Smooth (select tool)');
{
  const { ed, game } = fresh();
  ed.setMaterial('steel');
  // a jagged hand-built arch from bolt to bolt
  const ys = [-6, -2.5, -1.25, 0.5, -0.75, -2, -6];
  let from = 'a2';
  for (let i = 1; i < ys.length; i++) from = ed.buildBeam(from, i * 4, ys[i]);
  ed.escape();
  ok(ed.design.nodes.length === 5 && valid(ed).ok, 'jagged chain built');
  ed.setTool('select');
  ed.select(ed.design.nodes.map((n) => n.id));
  ok(ed.state.smooth === 5, 'select: 5 joints can be smoothed');
  const before = ed.design.nodes.map((n) => [n.x, n.y]);
  const und = ed.undoStack.length;
  ok(ed.smoothSelection(), 'Smooth');
  const pts = [{ x: 0, y: -6 }].concat(ed.design.nodes.map((n) => ({ x: n.x, y: n.y }))).concat([{ x: 24, y: -6 }]).sort((a, b) => a.x - b.x);
  const Ls = Cv.lengthsOf(pts);
  ok(Math.max.apply(null, Ls) - Math.min.apply(null, Ls) < 0.6, 'evenly spaced along the curve (chords ' + Ls.map((l) => l.toFixed(2)).join(', ') + ')');
  ok(ed.design.nodes.every((n) => onGrid(n.x, 0.25) && onGrid(n.y, 0.25)), 'on the grid');
  const fit = Cv.fitParabola(pts);
  ok(pts.every((p) => Math.abs(p.y - Cv.yAt(Cv.make('parabolic', fit.x0, fit.y0, fit.x1, fit.y1, fit.rise), p.x)) < 0.2), 'on a parabola that springs from the bolts (fixed joints kept)');
  ok(ed.undoStack.length === und + 1 && valid(ed).ok, 'one undo step, still valid');
  ed.undo();
  ok(JSON.stringify(ed.design.nodes.map((n) => [n.x, n.y])) === JSON.stringify(before), 'undo restores');
  ed.select([ed.design.nodes[0].id, ed.design.nodes[1].id]);
  ok(!ed.smoothSelection() && game.toasts.some((t) => /at least 3/.test(t)), 'fewer than 3 joints: explained');
}

section('editor: DOM layer (fake canvas): wheel, +/- keys, two-finger tap');
{
  const { ed, game } = fresh();
  const mk = () => { const l = {}; return { l, addEventListener(t, f) { (l[t] = l[t] || []).push(f); }, removeEventListener(t, f) { l[t] = (l[t] || []).filter((x) => x !== f); }, fire(t, e) { (l[t] || []).forEach((f) => f(Object.assign({ preventDefault() { this.defaultPrevented = true; }, defaultPrevented: false }, e))); } }; };
  const canvas = Object.assign(mk(), { style: {}, clientWidth: 1000, clientHeight: 600, getBoundingClientRect() { return { left: 0, top: 0 }; }, setPointerCapture() {}, releasePointerCapture() {} });
  const win = mk();
  ed.attach(canvas, { keyTarget: win });
  const R = game.renderer, S = (x, y) => R.worldToScreen(x, y);
  const pe = (type, x, y, extra) => { const s = S(x, y); canvas.fire(type, Object.assign({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: s.x, clientY: s.y }, extra || {})); };
  win.fire('keydown', { key: 'a' });
  ok(ed.tool === 'arch', 'A via window keydown');
  ed.setMaterial('steel');
  pe('pointerdown', 0, -6); for (let i = 1; i <= 6; i++) pe('pointermove', 4 * i, -6); pe('pointerup', 24, -6);
  pe('pointermove', 12, 0);
  const n0 = ed.state.arch.plan.n, z0 = R.camera.zoom;
  const s = S(12, 0);
  canvas.fire('wheel', { clientX: s.x, clientY: s.y, deltaY: -120, deltaMode: 0 });
  ok(ed.state.arch.plan.n === n0 + 1 && R.camera.zoom === z0, 'wheel changes segments (not zoom) while setting the rise');
  win.fire('keydown', { key: '-' });
  ok(ed.state.arch.plan.n === n0 && R.camera.zoom === z0, '- key: segments, not zoom');
  win.fire('keydown', { key: '=' });
  ok(ed.state.arch.plan.n === n0 + 1, '= key: one more segment');
  // two-finger tap cancels
  const t = S(12, 3);
  canvas.fire('pointerdown', { pointerId: 31, pointerType: 'touch', button: 0, clientX: t.x, clientY: t.y });
  canvas.fire('pointerdown', { pointerId: 32, pointerType: 'touch', button: 0, clientX: t.x + 80, clientY: t.y });
  canvas.fire('pointerup', { pointerId: 32, pointerType: 'touch', button: 0, clientX: t.x + 80, clientY: t.y });
  canvas.fire('pointerup', { pointerId: 31, pointerType: 'touch', button: 0, clientX: t.x, clientY: t.y });
  ok(!ed.archActive() && ed.design.beams.length === 0, 'two-finger tap cancels the curve');
  pe('pointerdown', 0, -6); pe('pointermove', 12, -6); pe('pointerup', 24, -6);
  pe('pointermove', 12, 0); pe('pointerdown', 12, 0); pe('pointerup', 12, 0);
  ok(ed.design.beams.length > 0 && valid(ed).ok, 'mouse via DOM: drag, move, click builds');
  const zB = R.camera.zoom;
  canvas.fire('wheel', { clientX: s.x, clientY: s.y, deltaY: -120, deltaMode: 0 });
  ok(R.camera.zoom > zB, 'without a curve in progress the wheel zooms');
  ed.detach();
  ok(Object.values(canvas.l).every((a) => a.length === 0), 'detach removes the arch listeners too');
}

section('overlay renderer (fake canvas)');
{
  const { ed, game } = fresh();
  deck(ed, 0, 24, 6);
  ed.archOptions().connect = true;
  ed.setTool('arch'); ed.setMaterial('steel');
  drag(ed, 0, -6, 24, -6);
  ed.pointerMove(12, -1, M());
  const calls = { label: [], beams: 0, halo: 0 };
  const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  const r = Object.assign({}, game.renderer, {
    camera: game.renderer.camera,
    _worldXf() {}, _screenXf() {},
    _halo() { calls.halo++; }, _drawBeamItems(c, items) { calls.beams += items.length; },
    _label(c, x, y, text) { calls.label.push(text); },
  });
  BG.ArchTool.drawOverlay(r, ctx, { editorState: ed.state }, { x: 0, y: 0 });
  ok(calls.beams >= ed.state.arch.plan.n + 3, 'segments, posts and braces drawn', calls.beams);
  ok(calls.label.some((t) => /Parabolic/.test(t) && /× Steel/.test(t) && /span 24\.0\sm/.test(t) && /rise 5\.0\sm/.test(t) && /\$/.test(t)), 'label: shape, segments × material, span, rise, cost', calls.label);
  ok(calls.label.some((t) => /posts to the deck/.test(t)), 'second line: posts + gesture help', calls.label);
  BG.ArchTool.drawOverlay(r, ctx, { editorState: {} }, { x: 0, y: 0 });
  ok(true, 'no arch state: nothing drawn, no throw');
}


section('usability: fair snapping, deck crossings, defaults, place, labels');
{
  ok(DEFAULT_OPT.connect === true && DEFAULT_OPT.brace === true, 'Connect to deck and Brace panels are on by default', DEFAULT_OPT);
  // snapping never makes the polyline lumpy: it keeps turning one way, like the curve
  const turns = (pts, t) => pts.slice(1, -1).every((b, i) => { const a = pts[i], d = pts[i + 2]; return ((b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x)) * t >= -1e-9; });
  const lumpy = [];
  let cases = 0;
  for (const sh of ['parabolic', 'circular', 'catenary']) for (const span of [12, 18, 26, 36, 40, 60, 96]) for (const rr of [-0.4, -0.2, -0.1, 0.1, 0.2, 0.3, 0.5]) for (const maxLen of [5, 6, 10, 40]) {
    const c = Cv.make(sh, 0, -5, span, -5, span * rr), t = Cv.turnOf(c);
    const s1 = Cv.segment(c, { maxLen, grid: 0.25 });
    cases++; if (!turns(s1.points, t)) lumpy.push([sh, span, rr, maxLen]);
    if (sh === 'circular' && Math.abs(rr) >= 0.5) continue; // a near semicircle is not a function of x for stations
    const xs = []; for (let x = 6; x < span - 0.5; x += 6) xs.push(x);
    const s2 = Cv.alignedSegment(c, xs, { maxLen, grid: 0.25 });
    if (s2) { cases++; if (!turns(s2.points, t)) lumpy.push(['aligned', sh, span, rr, maxLen]); }
  }
  ok(lumpy.length === 0, 'snapped curves are never lumpy (' + cases + ' shapes / spans / rises / materials)', lumpy.slice(0, 5));
  const sym = Cv.segment(Cv.make('parabolic', 0, -9, 36, -9, 8.5), { maxLen: 10, grid: 0.25 }).points;
  ok(sym.every((p, i) => near(p.x, 36 - sym[sym.length - 1 - i].x) && near(p.y, sym[sym.length - 1 - i].y)), 'a symmetric arch stays symmetric after snapping', sym);
  const al = Cv.alignedSegment(Cv.make('parabolic', 0, -6, 24, -6, 9), [{ x: 5, y: 0 }, 6, 12, 18], { maxLen: 10, grid: 0.25 });
  ok(al && al.points.some((p) => near(p.x, 5) && p.y === 0 && p.pinY), 'a pinned station keeps its height', al && al.points);

  // a through arch crossing the deck between deck joints: a joint on the road, joined to it
  {
    const { ed, opt } = fresh();
    deck(ed, 0, 24, 6);
    Object.assign(opt, { connect: true, brace: true });
    ed.setTool('arch'); ed.setMaterial('steel');
    const r = ed.placeArch(0, -6, 24, -6, 9, {});
    const onDeck = r && r.ids.map((id) => ed._node(id)).filter((n) => n.kind === 'node' && near(n.y, 0) && !near(n.x % 6, 0));
    ok(onDeck && onDeck.length === 2 && onDeck.every((n) => ed.design.beams.filter((b) => (b.a === n.id || b.b === n.id) && b.m === 'road').length === 2), 'where the arch crosses the road it joins it (deck split, both sides)', onDeck);
    ok(valid(ed).ok, 'through arch valid', valid(ed).errors);
    const keys = new Set();
    let dup = 0;
    for (const b of ed.design.beams) { const k = [b.a, b.b].sort().join('|'); if (keys.has(k)) dup++; keys.add(k); }
    ok(dup === 0, 'no doubled members');
  }
  // a crown on the deck: the panels next to it are triangles already - no braces doubling the curve
  {
    const { ed, opt } = fresh();
    deck(ed, 0, 24, 6);
    Object.assign(opt, { connect: true, brace: true });
    ed.setTool('arch'); ed.setMaterial('steel');
    drag(ed, 0, -6, 24, -6);
    ed.pointerMove(12, 0, M());
    const p = ed.state.arch.plan;
    const segKeys = new Set(p.segs.map((q) => [q.x1, q.y1, q.x2, q.y2].join(',')).concat(p.segs.map((q) => [q.x2, q.y2, q.x1, q.y1].join(','))));
    ok(p.braces.every((b) => !segKeys.has([b.x1, b.y1, b.x2, b.y2].join(','))), 'no brace on top of a curve segment', p.braces.length);
    const nb = ed.design.beams.length;
    ed.pointerDown(12, 0, M()); ed.pointerUp(12, 0, M());
    ok(ed.lastArch && ed.design.beams.length - nb === p.n + p.connectors.filter((c) => c.valid).length + p.braces.length, 'placed = previewed (curve + posts + braces)', [ed.design.beams.length - nb, p.n, p.connectors.length, p.braces.length]);
  }
  // under a hanging cable the panel bracing is crossed cables, never a lone strut
  {
    const { ed, opt } = fresh({ materials: ['road', 'wood', 'cable'] });
    deck(ed, 0, 24, 6);
    Object.assign(opt, { connect: true, brace: true });
    ed.setTool('arch'); ed.setMaterial('cable');
    const r = ed.placeArch(2, 8, 22, 8, -7, {});
    const hang = ed.design.beams.filter((b) => b.m !== 'road');
    ok(r && r.posts >= 3 && r.braces >= 2 && hang.every((b) => b.m === 'cable'), 'hanging cable: hangers and crossed cable braces', { r, mats: hang.map((b) => b.m) });
  }
  // touch release: the starting rise keeps the curve clear of the deck
  {
    const { ed, opt } = fresh();
    deck(ed, 0, 24, 6);
    Object.assign(opt, { connect: true });
    ed.setTool('arch'); ed.setMaterial('cable');
    const T = M({ pointerType: 'touch' });
    drag(ed, 2, 4, 22, 4, T);
    ok(near(ed.state.arch.rise, -3) && ed.state.arch.plan.valid, 'a cable starts hanging 1 m above the road (not on it)', ed.state.arch.rise);
    // the connectors only show once the end is set
    ed.archCancel();
    ed.pointerDown(2, 4, T); ed.pointerMove(12, 4, T); ed.pointerMove(22, 4, T);
    ok(ed.state.arch.phase === 'drag' && ed.state.arch.plan.connectors.length === 0, 'no posts / hangers while the end is still being dragged');
    ed.pointerUp(22, 4, T);
    // a tap on the handle is a grab, not a place; the bar's Place places
    const h = ed.state.arch.handle;
    ed.pointerDown(h.x, h.y, T); ed.pointerUp(h.x, h.y, T);
    ok(ed.archActive() && ed.design.beams.filter((b) => b.m === 'cable').length === 0, 'touch: a tap on the rise handle does not place');
    ok(ed.archPlace() && !ed.archActive() && ed.design.beams.some((b) => b.m === 'cable'), 'archPlace() (the Place button) places');
    ok(!ed.archPlace(), 'Place with no curve: nothing');
  }
  // skipped connectors say why
  {
    const f3 = fresh({ noBuild: [{ x0: 11, x1: 13, y0: -3, y1: -0.5 }] });
    deck(f3.ed, 0, 24, 6);
    Object.assign(f3.opt, { connect: true, brace: false });
    f3.ed.setTool('arch'); f3.ed.setMaterial('steel');
    drag(f3.ed, 0, -6, 24, -6);
    f3.ed.pointerMove(12, -3.5, M());
    const p = f3.ed.state.arch.plan;
    ok(p.skipped >= 1 && /no-build/.test(p.skipReason), 'preview: skipped members carry the reason', [p.skipped, p.skipReason]);
    f3.ed.pointerDown(12, -3.5, M()); f3.ed.pointerUp(12, -3.5, M());
    ok(f3.game.toasts.some((t) => /skipped: Crosses a no-build zone/.test(t)), 'toast names the rule', f3.game.toasts);
  }
  // labels stay out of the HUD: above the curve when there is room, else below it
  {
    const { ed, game } = fresh();
    deck(ed, 0, 24, 6);
    Object.assign(ed.archOptions(), { connect: true });
    ed.setTool('arch'); ed.setMaterial('steel');
    drag(ed, 0, -6, 24, -6);
    ed.pointerMove(12, -1, M());
    const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
    const labels = [];
    const r = Object.assign({}, game.renderer, { W: 1000, H: 600, camera: game.renderer.camera, _worldXf() {}, _screenXf() {}, _halo() {}, _drawBeamItems() {}, _label(c, x, y, text) { labels.push({ x, y, text }); } });
    const deckY = r.worldToScreen(0, 0).y;
    BG.ArchTool.drawOverlay(r, ctx, { editorState: ed.state }, { x: 0, y: 0 });
    ok(labels.length === 2 && labels.every((l) => l.y < deckY), 'room above: labels above the curve', labels);
    BG.ArchTool.safeRect = () => ({ top: deckY - 20, left: 120, right: 1000, bottom: 600 });
    labels.length = 0;
    BG.ArchTool.drawOverlay(r, ctx, { editorState: ed.state }, { x: 0, y: 0 });
    const lowest = r.worldToScreen(0, -6).y;
    ok(labels.length === 2 && labels.every((l) => l.y > lowest), 'a panel over the space above: labels go below the curve', { labels, lowest });
    ok(BG.ArchTool.lastLabels.every((q) => q.x >= 120), 'and stay right of the rail', BG.ArchTool.lastLabels);
    delete BG.ArchTool.safeRect;
    ed.archCancel();
    labels.length = 0;
    BG.ArchTool.placed = 0;
    BG.ArchTool.drawOverlay(r, ctx, { editorState: ed.state, mode: 'edit' }, { x: 0, y: 0 });
    ok(labels.length === 1 && /drag from one support to the other/.test(labels[0].text), 'idle: a how-to hint until a first curve is placed', labels);
  }
}

// ===================================================================== 3. headless sim
function buildLevel(id, steps) {
  const level = levelById(id);
  const { ed, opt } = fresh(level);
  steps(ed, opt, level);
  return { level, ed, res: runHeadless(level, ed.design, {}) };
}
section('headless sim: levels built with the tool pass');
{
  const t15 = buildLevel(15, (ed, opt) => {
    deck(ed, 0, 36, 6, 'road');
    opt.connect = true; opt.brace = true;
    ed.setTool('arch'); ed.setMaterial('steel');
    ed.placeArch(0, -9, 36, -9, 8.5, {});
  });
  ok(t15.res.valid && t15.res.status === 'success' && t15.res.budgetOk, 'level 15 Keystone: deck arch from the low bolts passes', { s: t15.res.status, peak: t15.res.peakStress, cost: t15.res.cost, f: t15.res.failReason });
  const t106 = buildLevel(106, (ed, opt) => {
    deck(ed, 0, 26, 6, 'rail');
    opt.connect = true; opt.brace = true;
    ed.setTool('arch'); ed.setMaterial('masonry');
    ed.placeArch(0, -7, 26, -7, 6, {});
  });
  ok(t106.res.valid && t106.res.status === 'success' && t106.res.budgetOk, 'level 106 (rail, masonry arch) passes', { s: t106.res.status, peak: t106.res.peakStress, cost: t106.res.cost, f: t106.res.failReason });
  const t208 = buildLevel(208, (ed, opt) => {
    ed.load({ nodes: [], beams: [], piers: [{ x: 22, topY: 16 }, { x: 118, topY: 16 }] }, ed._level());
    deck(ed, 0, 140, 5, 'reinforced_road');
    opt.connect = true; opt.brace = false;
    ed.setTool('arch'); ed.setMaterial('cable');
    ed.placeArch(22, 16, 118, 16, -14.5, { shape: 'catenary' });
    ed.placeArch(0, 0, 22, 16, -1.5, {});
    ed.placeArch(118, 16, 140, 0, -1.5, {});
  });
  const t25 = buildLevel(25, (ed, opt) => {
    ed.load({ nodes: [], beams: [], piers: [{ x: 10, topY: 8 }, { x: 50, topY: 8 }] }, ed._level());
    deck(ed, 0, 60, 5, 'road');
    Object.assign(opt, { connect: true, brace: true });
    ed.setTool('arch'); ed.setMaterial('cable');
    ed.placeArch(10, 8, 50, 8, -7, {});
    ed.placeArch(-14, 0, 10, 8, -0.5, {});
    ed.placeArch(50, 8, 74, 0, -0.5, {});
  });
  ok(t25.res.valid && t25.res.status === 'success' && t25.res.budgetOk, 'level 25 (no steel): road hung from a cable between two towers, with crossed cable bracing, passes', { s: t25.res.status, peak: t25.res.peakStress, cost: t25.res.cost, f: t25.res.failReason });
  const hangers = t208.ed.design.beams.filter((b) => b.m === 'cable').length;
  ok(t208.res.valid && t208.res.status === 'success' && t208.res.budgetOk && hangers > 40, 'level 208 (suspension): catenary main cable + side cables + hangers pass', { s: t208.res.status, peak: t208.res.peakStress, cost: t208.res.cost, hangers });
}

function finish() {
  console.log((fail ? 'FAILED: ' : '') + pass + '/' + (pass + fail) + ' arch-tool checks passed');
  process.exit(fail ? 1 : 0);
}

// ===================================================================== 4. browser
if (NODE_ONLY) finish();
else browser().then(finish, (e) => { console.log('  FAIL: browser run threw: ' + (e && e.stack || e)); fail++; finish(); });

async function browser() {
  const { chromium } = require('playwright');
  const url = require('url');
  fs.mkdirSync(OUT, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const b = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    // ---------------------------------------------------------------- desktop
    section('browser (desktop 1440x900): levels 15, 106, 208 with mouse + bar, Test passes');
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push('[' + m.type() + '] ' + m.text()); });
    page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
    const W2S = (x, y) => page.evaluate(([x, y]) => { const p = BG.Game.renderer.worldToScreen(x, y); const r = BG.Game.canvas.getBoundingClientRect(); return { x: p.x + r.left, y: p.y + r.top }; }, [x, y]);
    const mdrag = async (x1, y1, x2, y2) => {
      const a = await W2S(x1, y1), c = await W2S(x2, y2);
      await page.mouse.move(a.x, a.y); await page.mouse.down();
      await page.mouse.move((a.x + c.x) / 2, (a.y + c.y) / 2, { steps: 6 });
      await page.mouse.move(c.x, c.y, { steps: 6 }); await page.mouse.up();
      await wait(60);
    };
    const runSim = (maxSec) => page.evaluate((maxSec) => {
      const g = BG.Game; let t = 0;
      while (g.state === 'sim' && t < maxSec) { g._updateSim(1 / 6); t += 1 / 6; }
      const r = g.lastResult;
      return { state: g.state, res: r && { passed: r.passed, stars: r.stars, reason: r.reason, cost: r.cost } };
    }, maxSec);
    const open = async (id) => {
      await page.evaluate((id) => { BG.Game.openLevel(id); }, id);
      await wait(600);
      // Famous Bridges open with a history card: "Build it"
      if (await page.evaluate(() => !!(BG.Famous && BG.Famous.card && BG.Famous.card.open))) { await page.evaluate(() => BG.Famous.card.build()); await wait(900); }
      await wait(300);
      await page.evaluate(() => { BG.Game.editor.load({ nodes: [], beams: [], piers: [] }, BG.Game.level); });
    };
    const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });
    // a deck built by mouse with the build tool (auto-chain clicks)
    const mouseDeck = async (x0, x1, step, mat) => {
      await page.evaluate((m) => { BG.Game.setTool('build'); BG.Game.setMaterial(m); }, mat);
      const xs = []; for (let x = x0; x < x1 - 1e-9;) { x = Math.min(x + step, x1); xs.push(x); }
      await mdrag(x0, 0, xs[0], 0);
      for (const x of xs.slice(1)) { const p = await W2S(x, 0); await page.mouse.click(p.x, p.y); await wait(40); }
      // the chain ends on the far road anchor (no Esc: that would leave the level)
    };
    // the gesture: press, drag, release, move to the crown height, click
    const mouseArch = async (x0, y0, x1, y1, crownY) => {
      await mdrag(x0, y0, x1, y1);
      const c = await W2S((x0 + x1) / 2, crownY);
      await page.mouse.move(c.x, c.y, { steps: 8 });
      await wait(120);
      const pv = await page.evaluate(() => { const av = BG.Game.editor.state.arch; return av && av.plan ? { phase: av.phase, n: av.plan.n, rise: av.plan.rise, valid: av.plan.valid, cost: av.plan.cost, posts: av.plan.connectors.length, shown: BG.Game.getCost() } : av; });
      await page.mouse.click(c.x, c.y);
      await wait(150);
      return pv;
    };

    await page.goto(url.pathToFileURL(path.join(ROOT, 'index.html')).href + '?unlockall&noresume');
    await wait(1800);
    // hint on an arch level
    await page.evaluate(() => { BG.Game.openLevel(107); });
    await wait(1500);
    const hint107 = await page.evaluate(() => ({ text: document.querySelector('[data-ref=hintText]').textContent, show: document.querySelector('[data-ref=hint]').classList.contains('show') }));
    ok(hint107.show && /Try the Arch tool \(A\)/.test(hint107.text), 'level 107 opens with a hint pointing at the Arch tool (A)', hint107);
    await page.evaluate(() => BG.Game.openLevel(1)); await wait(1500);
    ok(!/Arch tool/.test(await page.evaluate(() => document.querySelector('[data-ref=hintText]').textContent)), 'a level without arches in its hint does not mention it');

    // ---- level 15
    await open(15);
    await page.evaluate(() => BG.Hud.hideHint());
    ok(await page.evaluate(() => !!document.querySelector('.rail [data-tool=arch] svg')), 'rail: Arch button with an icon');
    await mouseDeck(0, 36, 6, 'road');
    await page.click('.rail [data-tool=arch]');
    await wait(150);
    const bar = await page.evaluate(() => { const el = document.querySelector('.arch-bar'); const r = el.getBoundingClientRect(); return { show: el.classList.contains('show'), mat: BG.Game.editor.material, tool: BG.Game.editor.tool, r: [r.left, r.top, r.right, r.bottom], chips: el.querySelectorAll('[data-ab-shape]').length, on: (el.querySelector('.ab-chip.on') || {}).textContent }; });
    ok(bar.show && bar.tool === 'arch' && bar.mat === 'steel' && bar.chips === 3 && bar.on === 'Parabolic', 'tool button opens the contextual bar (Parabolic default, steel)', bar);
    ok(bar.r[0] >= 0 && bar.r[2] <= 1440 && bar.r[1] >= 0 && bar.r[3] < 450, 'bar on screen, over the sky', bar.r);
    const bt = () => page.evaluate(() => ({ connect: BG.Game.editor.archOptions().connect, checked: document.querySelector('.arch-bar [data-ab=connect]').checked, brace: !document.querySelector('.arch-bar [data-ab=brace]').disabled, cmat: !document.querySelector('.arch-bar [data-ab=cmat]').disabled }));
    let b0 = await bt();
    ok(b0.connect && b0.checked && b0.brace && b0.cmat, 'Connect to deck is on by default (bracing + connector material enabled)', b0);
    await page.click('.arch-bar [data-ab=connect]');
    b0 = await bt();
    ok(!b0.connect && !b0.brace && !b0.cmat, 'Connect off: Brace panels and the connector material are disabled', b0);
    await page.click('.arch-bar [data-ab=connect]');
    ok((await bt()).connect, 'Connect to deck back on from the bar');
    const pv15 = await mouseArch(0, -9, 36, -9, -0.5);
    ok(pv15 && pv15.phase === 'rise' && pv15.valid && pv15.posts >= 5 && Math.abs(pv15.rise - 8.5) < 0.3, 'preview while setting the rise', pv15);
    ok(pv15 && pv15.shown >= pv15.cost, 'cost bar includes the preview', pv15);
    await shot('15-placed');
    const d15 = await page.evaluate(() => ({ la: BG.Game.editor.lastArch, v: BG.Model.validate(BG.Game.level, BG.Game.getDesign()), n: BG.Game.getDesign().beams.length, cost: BG.Game.getCost() }));
    ok(d15.la && d15.la.posts >= 5 && d15.la.braces > 0 && d15.v.ok, 'level 15: arch + posts + bracing placed, valid', d15);
    await page.keyboard.press('Space');
    await wait(400);
    let r = await runSim(70);
    ok(r.res && r.res.passed, 'level 15: Test passes', r);
    await wait(800);
    await shot('15-results');

    // ---- level 106 (rail, masonry)
    await open(106);
    await page.evaluate(() => BG.Hud.hideHint());
    await mouseDeck(0, 26, 6, 'rail');
    await page.keyboard.press('a');
    await page.evaluate(() => BG.Game.setMaterial('masonry'));
    await page.evaluate(() => { const o = BG.Game.editor.archOptions(); o.connect = true; o.brace = true; });
    await mdrag(0, -7, 26, -7);
    const c106 = await W2S(13, -1);
    await page.mouse.move(c106.x, c106.y, { steps: 8 });
    await wait(150);
    const pv106 = await page.evaluate(() => { const av = BG.Game.editor.state.arch; return { n: av.plan.n, valid: av.plan.valid, placing: document.querySelector('.arch-bar').classList.contains('placing'), place: !document.querySelector('.arch-bar [data-ab=place]').disabled }; });
    ok(pv106.placing && pv106.place, 'setting the rise: the bar shows an enabled Place button', pv106);
    await page.click('.arch-bar [data-ab=place]');
    await wait(150);
    ok(pv106 && pv106.valid && pv106.n >= 6, 'level 106: masonry arch preview (5 m stones)', pv106);
    const d106 = await page.evaluate(() => ({ la: BG.Game.editor.lastArch, v: BG.Model.validate(BG.Game.level, BG.Game.getDesign()).ok }));
    ok(d106.la && d106.la.m === 'masonry' && d106.v, 'level 106: placed', d106);
    await page.click('.test-btn');
    await wait(400);
    r = await runSim(60);
    ok(r.res && r.res.passed, 'level 106: Test passes', r);
    await wait(600);
    await shot('106-results');

    // ---- level 208 (suspension): towers, deck, main cable with the Catenary chip, side cables
    await open(208);
    await page.evaluate(() => { BG.Hud.hideHint(); BG.Game.editor.load({ nodes: [], beams: [], piers: [{ x: 22, topY: 16 }, { x: 118, topY: 16 }] }, BG.Game.level); });
    await page.evaluate(() => { const ed = BG.Game.editor; ed.setMaterial('reinforced_road'); let f = 'a0'; for (let x = 5; x <= 140; x += 5) f = ed.buildBeam(f, x, 0); ed.escape(); });
    await page.keyboard.press('a');
    await page.evaluate(() => BG.Game.setMaterial('cable'));
    await page.click('.arch-bar [data-ab-shape=catenary]');
    const o208 = await page.evaluate(() => { const o = BG.Game.editor.archOptions(); o.connect = true; o.brace = false; return Object.assign({}, o); });
    ok(o208.shape === 'catenary', 'Catenary chip');
    const pvS = await mouseArch(22, 16, 118, 16, 1.5);
    ok(pvS && pvS.valid && pvS.rise < 0 && pvS.posts > 15, 'suspension main cable sags between the towers with hangers', pvS);
    await mouseArch(0, 0, 22, 16, 6.5);
    await mouseArch(118, 16, 140, 0, 6.5);
    const d208 = await page.evaluate(() => ({ cables: BG.Game.getDesign().beams.filter((b) => b.m === 'cable').length, v: BG.Model.validate(BG.Game.level, BG.Game.getDesign()).ok }));
    ok(d208.v && d208.cables > 40, 'level 208: cables + hangers placed', d208);
    await shot('208-built');
    await page.evaluate(() => { BG.Game._lastToggle = -1e9; BG.Game.startSim(); });
    r = await runSim(70);
    ok(r.res && r.res.passed, 'level 208: Test passes', r);

    // ---- level 25 (no steel): a suspension bridge by mouse - towers, road, main cable + side cables with the tool
    await open(25);
    await page.evaluate(() => BG.Hud.hideHint());
    await page.click('.rail [data-tool=pier]');
    for (const x of [10, 50]) { const p0 = await W2S(x, 1), p1 = await W2S(x, 8); await page.mouse.move(p0.x, p0.y); await page.mouse.down(); await page.mouse.move(p1.x, p1.y, { steps: 6 }); await page.mouse.up(); await wait(60); }
    await mouseDeck(0, 60, 5, 'road');
    await page.click('.rail [data-tool=arch]');
    await page.click('.palette [data-mat=cable]');
    await wait(100);
    if (!(await page.evaluate(() => BG.Game.editor.archOptions().brace))) await page.click('.arch-bar [data-ab=brace]'); // 208 above switched it off
    await page.click('.arch-bar [data-ab-shape=parabolic]'); // ... and picked Catenary
    ok(await page.evaluate(() => { const o = BG.Game.editor.archOptions(); return o.connect && o.brace; }), 'level 25: Connect to deck + Brace panels on');
    const pv25 = await mouseArch(10, 8, 50, 8, 1);
    ok(pv25 && pv25.valid && pv25.rise === -7 && pv25.posts === 9, 'level 25: the main cable sags between the tower tops with 9 hangers', pv25);
    await mouseArch(-14, 0, 10, 8, 3.5);
    await mouseArch(50, 8, 74, 0, 3.5);
    const d25 = await page.evaluate(() => ({ tool: BG.Game.editor.tool, mats: BG.Game.getDesign().beams.reduce((m, b) => { m[b.m] = (m[b.m] || 0) + 1; return m; }, {}), v: BG.Model.validate(BG.Game.level, BG.Game.getDesign()).ok }));
    ok(d25.v && d25.tool === 'arch' && d25.mats.cable > 20 && !d25.mats.wood, 'level 25: cables, hangers and crossed cable bracing (no wood struts)', d25);
    await shot('25-built');
    await page.click('.test-btn');
    await wait(400);
    r = await runSim(60);
    ok(r.res && r.res.passed, 'level 25: Test passes', r);

    // ---- Smooth in the browser + Esc / right-click
    await open(15);
    await page.evaluate(() => { BG.Hud.hideHint(); const ed = BG.Game.editor; ed.setTool('build'); ed.setMaterial('steel'); let f = 'a2'; [[6, -4.5], [12, -1], [18, 0.5], [24, -2], [30, -3.5], [36, -9]].forEach(([x, y]) => { f = ed.buildBeam(f, x, y); }); ed.escape(); ed.setTool('select'); ed.selectAll(); BG.Game.setTool('select'); });
    await wait(200);
    const sb = await page.evaluate(() => { const el = document.querySelector('.arch-bar'); return { show: el.classList.contains('show'), sel: el.classList.contains('mode-select') }; });
    ok(sb.show && sb.sel, 'select tool with >= 3 joints: the bar offers Smooth', sb);
    await page.click('.arch-bar [data-ab=smooth]');
    await wait(150);
    ok(await page.evaluate(() => !!BG.Game.editor.lastSmooth && BG.Model.validate(BG.Game.level, BG.Game.getDesign()).ok), 'Smooth button smooths (valid design)');
    await page.keyboard.press('a');
    await mdrag(0, -5, 36, -5);
    ok(await page.evaluate(() => BG.Game.editor.archActive()), 'curve in progress');
    await page.keyboard.press('Escape');
    ok(await page.evaluate(() => !BG.Game.editor.archActive() && BG.Game.state === 'edit' && BG.Game.editor.tool === 'arch'), 'Esc cancels the curve (stays in the level, tool kept)');
    await mdrag(0, -5, 36, -5);
    const rc = await W2S(18, 4);
    await page.mouse.click(rc.x, rc.y, { button: 'right' });
    ok(await page.evaluate(() => !BG.Game.editor.archActive()), 'right-click cancels the curve');
    ok(errors.length === 0, 'desktop: no console errors / warnings', errors.slice(0, 5));
    await ctx.close();

    // ---------------------------------------------------------------- touch phone
    section('browser (touch phone 844x390): arch by touch with loupe + rise handle');
    const tctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
    const tp = await tctx.newPage();
    const terr = [];
    tp.on('pageerror', (e) => terr.push(e.message));
    tp.on('console', (m) => { if (m.type() === 'error') terr.push(m.text()); });
    const cdp = await tctx.newCDPSession(tp);
    const pts = (ps) => ps.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: p.id != null ? p.id : i, radiusX: 3, radiusY: 3, force: 1 }));
    const T = {
      start: (ps) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(ps) }),
      move: (ps) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(ps) }),
      end: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
      async tap(p) { await T.start([p]); await wait(45); await T.end(); await wait(90); },
    };
    const TW = (x, y) => tp.evaluate(([x, y]) => { const p = BG.Game.renderer.worldToScreen(x, y); const r = BG.Game.canvas.getBoundingClientRect(); return { x: p.x + r.left, y: p.y + r.top }; }, [x, y]);
    await tp.goto(url.pathToFileURL(path.join(ROOT, 'index.html')).href + '?unlockall&noresume');
    await wait(2000);
    await tp.evaluate(() => { BG.Game.openLevel(15); });
    await wait(1500);
    const tHint = await tp.evaluate(() => document.querySelector('[data-ref=hintText]').textContent);
    ok(/Try the Arch tool\.$/.test(tHint) && !/\(A\)/.test(tHint), 'touch hint: no key in it', tHint);
    await tp.evaluate(() => { BG.Hud.hideHint(); if (BG.Mobile.rotatePromptVisible()) document.querySelector('[data-mact=rotateOk]').click(); const ed = BG.Game.editor; ed.setMaterial('road'); let f = 'a0'; for (let x = 6; x <= 36; x += 6) f = ed.buildBeam(f, x, 0); ed.escape(); });
    const ab = await tp.evaluate(() => { const r = document.querySelector('.rail [data-tool=arch]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await T.tap(ab);
    await wait(150);
    const tb = await tp.evaluate(() => {
      const el = document.querySelector('.arch-bar'), r = el.getBoundingClientRect();
      const small = Array.from(el.querySelectorAll('button, select, input')).filter((x) => x.offsetParent).map((x) => { const q = x.tagName === 'INPUT' ? x.closest('label').getBoundingClientRect() : x.getBoundingClientRect(); return { n: x.dataset.ab || x.dataset.abShape, w: q.width, h: q.height }; }).filter((q) => Math.min(q.w, q.h) < 43.5);
      return { tool: BG.Game.editor.tool, show: el.classList.contains('show'), r: [r.left, r.top, r.right, r.bottom], W: innerWidth, H: innerHeight, small };
    });
    ok(tb.tool === 'arch' && tb.show, 'tap the rail button: arch tool + bar', tb);
    ok(tb.r[0] >= 0 && tb.r[1] >= 0 && tb.r[2] <= tb.W && tb.r[3] <= tb.H, 'bar inside the viewport', tb.r);
    ok(tb.small.length === 0, 'bar targets >= 44 px', tb.small);
    await tp.evaluate(() => { BG.Game.editor.archOptions().connect = true; BG.Game.editor._refresh(); });
    // drag from bolt to bolt with the loupe
    const a = await TW(0, -9), e = await TW(36, -9);
    await T.start([a]); await wait(30);
    let loupe = false;
    for (let i = 1; i <= 12; i++) { await T.move([{ x: a.x + (e.x - a.x) * i / 12, y: a.y }]); await wait(20); if (i === 8) loupe = await tp.evaluate(() => BG.Mobile.loupeVisible); }
    await T.end(); await wait(120);
    let st = await tp.evaluate(() => { const av = BG.Game.editor.state.arch; return { phase: av.phase, rise: av.rise, a: av.a && av.a.id, b: av.b && av.b.id, h: av.handle }; });
    ok(loupe, 'loupe shows while dragging the curve');
    ok(st.phase === 'rise' && st.a === 'a2' && st.b === 'a3' && st.rise > 0, 'touch release: rise phase with a default rise', st);
    // drag the rise handle up to the deck
    const h = await TW(st.h.x, st.h.y), top = await TW(18, -0.5);
    await T.start([h]); await wait(30);
    for (let i = 1; i <= 10; i++) { await T.move([{ x: h.x, y: h.y + (top.y - h.y) * i / 10 }]); await wait(20); }
    await T.end(); await wait(120);
    st = await tp.evaluate(() => { const av = BG.Game.editor.state.arch; return { phase: av.phase, rise: av.rise, valid: av.plan && av.plan.valid }; });
    ok(st.phase === 'rise' && Math.abs(st.rise - 8.5) <= 0.5 && st.valid, 'dragging the handle sets the rise', st);
    // a two-finger tap cancels ...
    const mid = await TW(18, -13); // in the gorge, clear of the bar and the curve
    await T.start([{ x: mid.x, y: mid.y, id: 0 }, { x: mid.x + 60, y: mid.y, id: 1 }]); await wait(60); await T.end(); await wait(150);
    ok(await tp.evaluate(() => !BG.Game.editor.archActive() && BG.Game.getDesign().beams.length === 6), 'two-finger tap cancels');
    // ... so do it again and tap to place
    await T.start([a]); await wait(30);
    for (let i = 1; i <= 12; i++) { await T.move([{ x: a.x + (e.x - a.x) * i / 12, y: a.y }]); await wait(20); }
    await T.end(); await wait(120);
    st = await tp.evaluate(() => BG.Game.editor.state.arch.handle);
    const h2 = await TW(st.x, st.y);
    await T.start([h2]); await wait(30);
    for (let i = 1; i <= 10; i++) { await T.move([{ x: h2.x, y: h2.y + (top.y - h2.y) * i / 10 }]); await wait(20); }
    await T.end(); await wait(120);
    await tp.screenshot({ path: path.join(OUT, 'phone-rise.png') });
    const lab = await tp.evaluate(() => { const c = BG.Game.canvas.getBoundingClientRect(), b = document.querySelector('.arch-bar').getBoundingClientRect(); return { labels: BG.ArchTool.lastLabels, barBottom: b.bottom - c.top, H: c.height }; });
    ok(lab.labels && lab.labels.length === 2 && lab.labels.every((q) => q.y >= lab.barBottom && q.y + q.h <= lab.H), 'phone: the preview labels are not hidden under the bar', lab);
    st = await tp.evaluate(() => BG.Game.editor.state.arch.handle);
    await T.tap(await TW(st.x, st.y));
    ok(await tp.evaluate(() => BG.Game.editor.archActive()), 'a tap on the rise handle does not place');
    const pl = await tp.evaluate(() => { const r = document.querySelector('.arch-bar [data-ab=place]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; });
    ok(pl.w >= 44 && pl.h >= 44 && pl.x > 0 && pl.x < 844, 'Place button in view, 44 px', pl);
    await T.tap(pl);
    await wait(200);
    const td = await tp.evaluate(() => ({ la: BG.Game.editor.lastArch, v: BG.Model.validate(BG.Game.level, BG.Game.getDesign()).ok }));
    ok(td.la && td.la.posts >= 5 && td.v, 'tap places the arch with its posts', td);
    await tp.screenshot({ path: path.join(OUT, 'phone-placed.png') });
    ok(terr.length === 0, 'phone: no console errors', terr.slice(0, 5));
    await tctx.close();
  } finally {
    await b.close();
  }
}
