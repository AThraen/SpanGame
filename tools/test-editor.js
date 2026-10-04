// Editor logic tests in Node with a fake game / renderer / canvas / window. Usage: node tools/test-editor.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
global.BG = global.BG || {};
function load(rel) { const f = path.join(ROOT, rel); if (fs.existsSync(f)) { try { require(f); return true; } catch (e) { console.warn('  (could not load ' + rel + ': ' + e.message + ')'); } } return false; }
// i18n: BG.i18n and every dictionary first, as in index.html (the editor's toasts go through it; language 'en')
['js/i18n/i18n.js'].concat(...['en', 'da'].map(l => fs.readdirSync(path.join(ROOT, 'js/i18n', l)).filter(f => /\.js$/.test(f)).map(f => 'js/i18n/' + l + '/' + f))).forEach(load);
['js/core/materials.js', 'js/core/vehicles.js', 'js/core/trains.js', 'js/core/model.js', 'js/core/templates.js'].forEach(load);
if (!load('js/ui/editor.js')) { console.error('editor.js missing'); process.exit(1); }
const BG = global.BG;

let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('  FAIL: ' + msg); } }
function near(a, b, e) { return Math.abs(a - b) <= (e || 1e-6); }
function section(name) { console.log('- ' + name); }

// ------------------------------------------------------------------ fakes
function makeLevel(o) {
  return Object.assign({
    id: 1, name: 'Test', theme: 'meadow',
    terrain: { leftEdge: 0, leftY: 0, rightEdge: 12, rightY: 0, floorY: -10, waterY: null },
    anchors: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 0, y: -3 }, { x: 12, y: -3 }],
    pierZones: [], maxPiers: 0, noBuild: [],
    buildArea: { x0: -2, x1: 14, y0: -10, y1: 10 },
    materials: ['road', 'wood', 'steel'], budget: 1e6, traffic: [{ type: 'car', count: 1, interval: 2 }], timeLimit: 30, templates: true,
  }, o || {});
}
function makeRenderer() {
  const W = 1000, H = 600;
  const r = {
    camera: { x: 6, y: 0, zoom: 40 },
    screenToWorld(sx, sy) { return { x: this.camera.x + (sx - W / 2) / this.camera.zoom, y: this.camera.y - (sy - H / 2) / this.camera.zoom }; },
    worldToScreen(x, y) { return { x: (x - this.camera.x) * this.camera.zoom + W / 2, y: (this.camera.y - y) * this.camera.zoom + H / 2 }; },
    fitToLevel() { this.fitted = true; },
  };
  return r;
}
function makeGame(level) {
  const g = {
    level, state: 'edit', renderer: makeRenderer(), sounds: [], changes: 0, tests: 0,
    audio: { play(n) { g.sounds.push(n); } },
    onDesignChanged(d) { g.changes++; g.lastDesign = d; },
    toggleTest() { g.tests++; },
    hud: { toast(m) { g.lastToast = m; } },
  };
  return g;
}
function fresh(levelOpts) {
  const level = makeLevel(levelOpts);
  const game = makeGame(level);
  const ed = new BG.Editor(game);
  game.editor = ed;
  return { level, game, ed };
}
// drag in world coordinates through the core API
function drag(ed, x0, y0, x1, y1, o) {
  ed.pointerDown(x0, y0, o);
  const steps = 6;
  for (let i = 1; i <= steps; i++) ed.pointerMove(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps, o);
  ed.pointerUp(x1, y1, o);
}
function click(ed, x, y, o) { ed.pointerDown(x, y, o); ed.pointerUp(x, y, o); }
function nodeAt(ed, x, y) { return ed.design.nodes.find((n) => near(n.x, x, 1e-3) && near(n.y, y, 1e-3)); }
function hasBeam(ed, a, b) { return ed.design.beams.some((q) => (q.a === a && q.b === b) || (q.a === b && q.b === a)); }
function valid(ed) { return !BG.Model || BG.Model.validate(ed._level(), ed.design).ok; }

// ------------------------------------------------------------------ tests
section('drag from anchor builds a beam, auto-chain continues');
{
  const { ed, game } = fresh();
  ok(ed.tool === 'build' && ed.material === 'road', 'defaults: build tool, road material');
  drag(ed, 0, 0, 4, 0);
  const n1 = nodeAt(ed, 4, 0);
  ok(n1 && hasBeam(ed, 'a0', n1.id), 'beam a0→(4,0)');
  ok(ed.design.beams[0].m === 'road', 'beam uses current material');
  ok(ed.chainFrom === n1.id && ed.state.chainFrom === n1.id, 'chain continues from beam end');
  ed.pointerMove(8, 0.2, {});
  ok(ed.state.ghost && near(ed.state.ghost.x1, 4) && near(ed.state.ghost.x2, 8) && near(ed.state.ghost.y2, 0), 'hover ghost from chain end, grid-snapped');
  ok(ed.state.ghost.valid && near(ed.state.ghost.len, 4) && ed.state.ghost.cost === 400, 'ghost valid, len 4, cost $400');
  click(ed, 8, 0.2);
  const n2 = nodeAt(ed, 8, 0);
  ok(n2 && hasBeam(ed, n1.id, n2.id), 'click places next chained beam');
  // click on the right anchor finishes the deck via magnet
  ed.pointerMove(11.7, 0.3, {});
  ok(ed.state.ghost.snapNode === 'a1', 'magnet snaps ghost to anchor a1');
  click(ed, 11.7, 0.3);
  ok(hasBeam(ed, n2.id, 'a1'), 'beam to anchor via magnet');
  ok(game.sounds.includes('place') && game.sounds.includes('snap'), 'place + snap sounds');
  ok(game.changes >= 3 && game.lastDesign === ed.design, 'onDesignChanged called with design');
  ed.keyDown('Escape');
  ok(ed.chainFrom === null && ed.state.ghost === null, 'Esc ends chain');
  ok(valid(ed), 'design valid per BG.Model');
  ok(ed.state.cost === 1200, 'cost tracked: 12 m road = $1200 (got ' + ed.state.cost + ')');
}

section('max length clamp');
{
  const { ed } = fresh();
  ed.pointerDown(0, 0, {});
  ed.pointerMove(5, 0, {});
  ed.pointerMove(20, 0, {});
  const g = ed.state.ghost;
  ok(g && near(g.len, 6) && near(g.x2, 6) && g.clamped, 'road ghost stops at 6 m');
  ed.pointerMove(20, 20, {});
  ok(ed.state.ghost.len <= 6 + 1e-9, 'diagonal clamp ≤ max (' + ed.state.ghost.len.toFixed(3) + ')');
  ed.pointerUp(20, 20, {});
  ok(ed.design.beams.length === 1 && BG.Model.beamLength(ed._level(), ed.design, ed.design.beams[0]) <= 6 + 1e-9, 'placed clamped beam within limit');
  ed.material = 'steel';
  ed.keyDown('Escape');
  ed.pointerDown(0, 0, {}); ed.pointerMove(30, 0, {});
  ok(near(ed.state.ghost.len, 10), 'steel clamps at 10 m');
  ed.pointerCancel();
}

section('grid & shift fine grid, magnet radius');
{
  const { ed } = fresh();
  ed.pointerDown(0, 0, {}); ed.pointerMove(3.3, 1.6, {});
  ok(near(ed.state.ghost.x2, 3) && near(ed.state.ghost.y2, 2), '1 m grid');
  ed.pointerMove(3.3, 1.6, { shift: true });
  ok(near(ed.state.ghost.x2, 3.25) && near(ed.state.ghost.y2, 1.5), 'Shift → 0.25 m grid');
  ed.pointerUp(3.3, 1.6, { shift: true });
  ed.keyDown('Escape');
  ed.pointerDown(0, -3, {}); ed.pointerMove(3.6, 1.2, {});
  ok(ed.state.ghost.snapNode && near(ed.state.ghost.x2, 3.25), 'magnet to existing joint within 0.6 m');
  ed.pointerCancel();
}

section('validity: noBuild, build area, terrain, duplicates');
{
  const { ed, game } = fresh({ noBuild: [{ x0: 4, x1: 8, y0: -10, y1: -2 }] });
  ed.pointerDown(0, -3, {}); ed.pointerMove(6, -3, {});
  ok(ed.state.ghost && !ed.state.ghost.valid && ed.state.ghost.reason === 'in_nobuild', 'ghost into noBuild invalid');
  ed.pointerUp(6, -3, {});
  ok(ed.design.beams.length === 0 && game.sounds.includes('error'), 'invalid drop refused with error sound');
  ed.keyDown('Escape');
  ed.pointerDown(0, 0, {}); ed.pointerMove(-1, -2, {});
  ok(!ed.state.ghost.valid && ed.state.ghost.reason === 'in_terrain', 'joint inside bank invalid');
  ed.pointerCancel();
  ed.pointerDown(12, 0, {}); ed.pointerMove(14.5, 4, {});
  ok(ed.state.ghost.x2 <= 14 + 1e-9 || !ed.state.ghost.valid, 'outside build area invalid or inside');
  ed.pointerCancel();
  drag(ed, 0, 0, 4, 0); ed.keyDown('Escape');
  ed.pointerDown(0, 0, {}); ed.pointerMove(4, 0, {});
  ok(ed.state.ghost.reason === 'duplicate_beam', 'duplicate beam detected');
  ed.pointerCancel();
}

section('mirror symmetry');
{
  const { ed } = fresh();
  ed.keyDown('m');
  ok(ed.mirror === true && ed.state.mirrorAxis === 6, 'M toggles mirror; axis = gap centre');
  drag(ed, 0, 0, 3, 2);
  const L = nodeAt(ed, 3, 2), R = nodeAt(ed, 9, 2);
  ok(L && R && hasBeam(ed, 'a0', L.id) && hasBeam(ed, 'a1', R.id), 'mirrored joint + beam created');
  ed.pointerMove(6, 4, {});
  ok(ed.state.ghosts.length === 2 && ed.state.ghosts[1].mirror, 'mirror ghost shown');
  click(ed, 6, 4);
  const C = nodeAt(ed, 6, 4);
  ok(C && hasBeam(ed, L.id, C.id) && hasBeam(ed, R.id, C.id), 'on-axis joint shared by both halves');
  ok(ed.design.nodes.filter((n) => near(n.x, 6) && near(n.y, 4)).length === 1, 'no duplicate on-axis joint');
  ed.keyDown('Escape');
  // horizontal beam across the axis is its own mirror
  drag(ed, 3, 2, 9, 2);
  ok(hasBeam(ed, L.id, R.id) && ed.design.beams.length === 5, 'self-symmetric beam added once');
  ed.keyDown('Escape');
  // move a joint: partner follows mirrored
  ed.pointerDown(3, 2, { ctrl: true }); ed.pointerMove(3, 3, { ctrl: true }); ed.pointerUp(3, 3, { ctrl: true });
  ok(nodeAt(ed, 3, 3) && nodeAt(ed, 9, 3) && !nodeAt(ed, 9, 2), 'moving a joint moves its mirror partner');
  // move on-axis joint: x locked
  ed.pointerDown(6, 4, { ctrl: true }); ed.pointerMove(7.2, 5, { ctrl: true }); ed.pointerUp(7.2, 5, { ctrl: true });
  ok(nodeAt(ed, 6, 5), 'on-axis joint stays on the axis');
  // erase deletes mirror too
  const nBefore = ed.design.beams.length;
  ed.tool = 'erase';
  click(ed, 1.5, 1.5);
  ok(ed.design.beams.length === nBefore - 2, 'erasing a beam erases its mirror');
  ok(valid(ed), 'mirrored design valid');
  ed.mirror = false;
}

section('move joint: beams follow, clamp at max length, merge');
{
  const { ed, game } = fresh();
  drag(ed, 0, 0, 4, 0); click(ed, 8, 0); click(ed, 12, 0); ed.keyDown('Escape');
  ed.material = 'wood';
  drag(ed, 0, -3, 4, 0); ed.keyDown('Escape');
  const n = nodeAt(ed, 4, 0);
  // long press arms move
  ed.pointerDown(4, 0, {});
  ok(ed.longPress() && ed.state.moveArmed === n.id, 'long press arms joint move');
  ed.pointerMove(4.5, 1, {}); ed.pointerMove(4, 1, {});
  ok(ed.state.moving, 'dragging after long press moves the joint');
  ed.pointerUp(4, 1, {});
  ok(near(n.x, 4) && near(n.y, 1), 'joint moved to (4,1)');
  ok(hasBeam(ed, 'a0', n.id), 'beams follow the joint');
  // clamp: road a0-n max 6
  ed.pointerDown(4, 1, { alt: true });
  ed.pointerMove(9, 1, { alt: true });
  ok(ed.state.clamped, 'move beyond max length is clamped');
  ed.pointerUp(9, 1, { alt: true });
  const L1 = Math.hypot(n.x, n.y), L2 = Math.hypot(8 - n.x, n.y);
  ok(L1 <= 6 + 1e-6 && L2 <= 6 + 1e-6 && n.x > 4.5, 'clamped position keeps all beams ≤ max (x=' + n.x.toFixed(2) + ')');
  ok(valid(ed), 'design valid after clamped move');
  ed.undo(); ed.undo();
  ok(near(n.x, 4) || nodeAt(ed, 4, 0), 'undo restores joint position');
  // merge: drag a free joint onto another joint
  const { ed: e2 } = fresh();
  e2.material = 'steel';
  drag(e2, 0, 0, 3, 2); e2.keyDown('Escape');
  drag(e2, 12, 0, 8, 2); e2.keyDown('Escape');
  const a = nodeAt(e2, 3, 2);
  e2.pointerDown(8, 2, { ctrl: true }); e2.pointerMove(5, 2, { ctrl: true }); e2.pointerMove(3.2, 2.1, { ctrl: true });
  ok(e2.state.mergeTarget === a.id, 'merge target shown');
  e2.pointerUp(3.2, 2.1, { ctrl: true });
  ok(e2.design.nodes.length === 1 && hasBeam(e2, 'a1', a.id) && hasBeam(e2, 'a0', a.id), 'joints merged, beams re-attached');
}

section('erase: click, sweep, right-click, orphan cleanup');
{
  const { ed, game } = fresh();
  drag(ed, 0, 0, 4, 0); click(ed, 8, 0); click(ed, 12, 0); ed.keyDown('Escape');
  ed.material = 'wood';
  drag(ed, 0, -3, 4, 0); ed.keyDown('Escape');
  drag(ed, 12, -3, 8, 0); ed.keyDown('Escape');
  ok(ed.design.beams.length === 5, '5 beams built');
  ed.keyDown('e');
  ok(ed.tool === 'erase', 'E selects erase');
  click(ed, 6, 0);
  ok(ed.design.beams.length === 4, 'click erases one beam');
  ed.pointerDown(1, 1.5, {}); ed.pointerMove(1, -1, {}); ed.pointerMove(11, -1, {}); ed.pointerMove(11, 1.5, {}); ed.pointerUp(11, 1.5, {});
  ok(ed.design.beams.length === 0, 'sweep erases crossed beams (' + ed.design.beams.length + ' left)');
  ok(ed.design.nodes.length === 0, 'orphan joints removed');
  ed.undo();
  ok(ed.design.beams.length === 4, 'sweep undone as one step');
  ed.keyDown('b');
  ed.rightClick(2, 0);
  ok(ed.design.beams.length === 3, 'right-click erases in build tool');
  drag(ed, 0, 0, 0.5, 2);
  ok(ed.chainFrom, 'chain active');
  ed.rightClick(5, 5);
  ok(!ed.chainFrom && ed.design.beams.length === 4, 'right-click ends chain without erasing');
}

section('undo / redo / clear');
{
  const { ed } = fresh();
  ok(!ed.canUndo() && !ed.canRedo(), 'empty history');
  drag(ed, 0, 0, 4, 0); click(ed, 8, 0);
  ok(ed.undoStack.length === 2, 'one undo step per beam');
  ed.keyDown('z', { ctrl: true });
  ok(ed.design.beams.length === 1, 'Ctrl+Z undo');
  ed.keyDown('y', { ctrl: true });
  ok(ed.design.beams.length === 2, 'Ctrl+Y redo');
  ed.keyDown('z', { ctrl: true, shift: true });
  ed.undo();
  ed.keyDown('z', { ctrl: true, shift: true });
  ok(ed.design.beams.length === 2, 'Ctrl+Shift+Z redo');
  const ref = ed.design;
  ed.clear();
  ok(ed.design === ref && ed.design.beams.length === 0, 'clear keeps design object identity');
  ed.undo();
  ok(ed.design.beams.length === 2 && ed.design === ref, 'clear is undoable');
  drag(ed, 0, -3, 2, -1);
  ok(!ed.canRedo(), 'new edit clears redo');
}

section('pier tool');
{
  const { ed, game } = fresh({ terrain: { leftEdge: 0, leftY: 0, rightEdge: 30, rightY: 0, floorY: -12 }, anchors: [{ x: 0, y: 0 }, { x: 30, y: 0 }],
    pierZones: [{ x0: 8, x1: 12 }, { x0: 18, x1: 22 }], maxPiers: 2, buildArea: { x0: -2, x1: 32, y0: -12, y1: 12 } });
  ok(ed.setTool('pier') && ed.tool === 'pier', 'pier tool');
  ed.pointerMove(15, -5, {});
  ok(ed.state.pierGhost === null, 'no pier ghost outside zones');
  click(ed, 15, -5);
  ok(ed.design.piers.length === 0 && game.sounds.includes('error'), 'click outside zone refused');
  ed.pointerDown(10.2, -6, {}); ed.pointerMove(10.2, -2, {}); ed.pointerMove(10.2, 0.3, {}); ed.pointerUp(10.2, 0.3, {});
  ok(ed.design.piers.length === 1 && near(ed.design.piers[0].x, 10) && near(ed.design.piers[0].topY, 0), 'pier placed, drag sets topY (snapped to deck level)');
  ed.pointerDown(10, -4, {}); ed.pointerMove(10, -2, {}); ed.pointerMove(10, 0, {}); ed.pointerUp(10, 0, {});
  ok(near(ed.design.piers[0].topY, 4), 'drag existing pier adjusts height keeping grab offset (topY=' + ed.design.piers[0].topY + ')');
  ed.pointerDown(10, 2, {}); ed.pointerMove(10, 0, {}); ed.pointerMove(10, -2, {}); ed.pointerUp(10, -2, {});
  ok(near(ed.design.piers[0].topY, 0), 'drag back down');
  // build to pier top
  ed.setTool('build');
  drag(ed, 0, 0, 5, 0); click(ed, 10, 0.2);
  ok(hasBeam(ed, nodeAt(ed, 5, 0).id, 'p0'), 'beam snaps to pier top joint');
  ed.keyDown('Escape');
  // mirror pier
  ed.mirror = true;
  ed.setTool('pier');
  click(ed, 20, -2);
  ok(ed.design.piers.length === 2, 'second pier (limit 2)');
  click(ed, 21.5, -2);
  ok(ed.design.piers.length === 2 && /limit/i.test(game.lastToast || ''), 'pier limit enforced');
  ed.mirror = false;
  // erase pier 0 → beams to p0 removed, p1 renamed
  drag(ed, 0, 0, 0, 0); // no-op press in pier tool area outside zone
  ed.setTool('build');
  drag(ed, 30, 0, 25, 0); click(ed, 20, -2); ed.keyDown('Escape');
  ok(hasBeam(ed, nodeAt(ed, 25, 0).id, 'p1'), 'beam to p1');
  ed.setTool('erase');
  click(ed, 10, -6);
  ok(ed.design.piers.length === 1 && near(ed.design.piers[0].x, 20), 'erase removes pier');
  ok(hasBeam(ed, nodeAt(ed, 25, 0).id, 'p0') && !ed.design.beams.some((b) => b.a === 'p1' || b.b === 'p1'), 'remaining pier ids renumbered in beams');
  ok(valid(ed), 'design valid after pier ops');
  // pier placed under an existing joint merges it
  const { ed: e3 } = fresh({ terrain: { leftEdge: 0, leftY: 0, rightEdge: 30, rightY: 0, floorY: -12 }, anchors: [{ x: 0, y: 0 }, { x: 30, y: 0 }],
    pierZones: [{ x0: 8, x1: 12 }], maxPiers: 1, buildArea: { x0: -2, x1: 32, y0: -12, y1: 12 } });
  drag(e3, 0, 0, 5, 0); click(e3, 10, 0); click(e3, 15, 0); e3.keyDown('Escape');
  e3.setTool('pier');
  e3.pointerDown(10.1, -8, {}); e3.pointerMove(10.1, -3, {}); e3.pointerMove(10.1, 0.1, {}); e3.pointerUp(10.1, 0.1, {});
  ok(e3.design.piers.length === 1 && !nodeAt(e3, 10, 0) && hasBeam(e3, nodeAt(e3, 5, 0).id, 'p0') && hasBeam(e3, 'p0', nodeAt(e3, 15, 0).id), 'pier merges with joint at its top');
}

section('select tool: box select, delete, group move');
{
  const { ed } = fresh();
  ed.material = 'wood';
  drag(ed, 0, 0, 3, 2); click(ed, 6, 3); click(ed, 9, 2); click(ed, 12, 0); ed.keyDown('Escape');
  ed.keyDown('s');
  ok(ed.tool === 'select', 'S → select tool');
  drag(ed, 2.5, 1.2, 7, 4);
  ok(ed.state.selection.nodes.length === 2 && ed.state.selection.beams.length === 1, 'box selects joints + inner beams');
  ed.pointerDown(3, 2, {}); ed.pointerMove(3, 2.6, {}); ed.pointerMove(3, 3, {}); ed.pointerUp(3, 3, {});
  ok(nodeAt(ed, 3, 3) && nodeAt(ed, 6, 4), 'group move');
  ed.keyDown('Delete');
  ok(ed.design.nodes.length === 1 && ed.design.beams.length === 1, 'Delete removes selection (' + ed.design.nodes.length + ' nodes, ' + ed.design.beams.length + ' beams)');
  ed.undo();
  ok(ed.design.nodes.length === 3, 'delete undone');
  ed.keyDown('a', { ctrl: true });
  ok(ed.state.selection.nodes.length === 3, 'Ctrl+A selects all');
  ed.keyDown('Escape');
  ok(ed.state.selection.nodes.length === 0, 'Esc clears selection');
}

section('keyboard: materials, tools');
{
  const { ed, game } = fresh({ materials: ['road', 'wood', 'steel', 'cable'] });
  ed.keyDown('2'); ok(ed.material === 'wood', '2 → second allowed material');
  ed.keyDown('4'); ok(ed.material === 'cable', '4 → cable');
  ok(ed.keyDown('6') === false, 'out-of-range material key ignored');
  ok(ed.setMaterial('rope') === false && ed.material === 'cable', 'disallowed material refused');
  ed.keyDown('e'); ed.keyDown('1');
  ok(ed.tool === 'build' && ed.material === 'road', 'material key returns to build tool');
  ok(ed.keyDown('p') && ed.tool === 'build', 'P refused without pier zones');
  game.state = 'sim';
  ok(ed.keyDown('e') === false && ed.tool === 'build', 'keys ignored outside edit state');
  game.state = 'edit';
}

section('templates');
{
  const { ed } = fresh();
  if (BG.Templates) {
    drag(ed, 0, 0, 3, 3);
    ok(ed.applyTemplate('warren'), 'applyTemplate warren');
    ok(ed.design.beams.length > 5 && valid(ed), 'template design valid');
    ed.undo();
    ok(ed.design.beams.length === 1, 'template undoable');
    ok(ed.applyTemplate('bogus') === false, 'bad template id refused');
  }
}

section('external design assignment / level switch');
{
  const { ed, game } = fresh();
  drag(ed, 0, 0, 4, 0);
  ok(ed.canUndo(), 'history exists');
  game.level = makeLevel({ id: 2 });
  ed.design = { nodes: [], beams: [], piers: [] };
  ok(!ed.canUndo() && ed.chainFrom === null, 'new level clears history');
  ed.load({ nodes: [{ id: 'n7', x: 4, y: 0 }], beams: [{ a: 'a0', b: 'n7', m: 'road' }] });
  ok(ed.design.piers && ed.design.piers.length === 0, 'load normalises missing arrays');
  drag(ed, 4, 0, 8, 0);
  ok(nodeAt(ed, 8, 0).id === 'n8', 'new ids continue after existing ones');
}

section('DOM layer with fake canvas: pointer, wheel, pan, pinch, keys');
{
  const { ed, game } = fresh();
  const mk = () => {
    const l = {};
    return {
      l,
      addEventListener(t, f) { (l[t] = l[t] || []).push(f); },
      removeEventListener(t, f) { l[t] = (l[t] || []).filter((x) => x !== f); },
      fire(t, e) { (l[t] || []).forEach((f) => f(Object.assign({ preventDefault() { this.defaultPrevented = true; }, defaultPrevented: false }, e))); },
    };
  };
  const canvas = Object.assign(mk(), { style: {}, clientWidth: 1000, clientHeight: 600, getBoundingClientRect() { return { left: 0, top: 0 }; }, setPointerCapture() {}, releasePointerCapture() {} });
  const win = mk();
  ed.attach(canvas, { keyTarget: win });
  ok(canvas.style.touchAction === 'none', 'touch-action none');
  const R = game.renderer;
  const S = (x, y) => R.worldToScreen(x, y);
  const pe = (type, x, y, extra) => { const s = S(x, y); canvas.fire(type, Object.assign({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: s.x, clientY: s.y }, extra || {})); };
  pe('pointerdown', 0, 0); pe('pointermove', 2, 0); pe('pointermove', 4, 0); pe('pointerup', 4, 0);
  ok(nodeAt(ed, 4, 0) && ed.design.beams.length === 1, 'mouse drag via DOM builds beam');
  win.fire('keydown', { key: 'Escape' });
  ok(!ed.chainFrom, 'Esc via window keydown');
  // wheel zoom keeps world point under cursor
  const s0 = S(3, 1);
  const before = R.screenToWorld(s0.x, s0.y);
  canvas.fire('wheel', { clientX: s0.x, clientY: s0.y, deltaY: -240, deltaMode: 0 });
  const after = R.screenToWorld(s0.x, s0.y);
  ok(R.camera.zoom > 40 && near(before.x, after.x, 1e-6) && near(before.y, after.y, 1e-6), 'wheel zoom anchored at cursor (zoom ' + R.camera.zoom.toFixed(1) + ')');
  // left drag on empty space pans
  const camX = R.camera.x;
  const sA = S(6, 6);
  canvas.fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: sA.x, clientY: sA.y });
  canvas.fire('pointermove', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: sA.x + 100, clientY: sA.y });
  canvas.fire('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: sA.x + 100, clientY: sA.y });
  ok(R.camera.x < camX - 1, 'empty-space drag pans camera');
  // right-drag pans, right-click erases
  const nb = ed.design.beams.length;
  const sB = S(2, 0);
  canvas.fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 2, clientX: sB.x, clientY: sB.y });
  canvas.fire('pointerup', { pointerId: 1, pointerType: 'mouse', button: 2, clientX: sB.x, clientY: sB.y });
  ok(ed.design.beams.length === nb - 1, 'right-click erases via DOM');
  // two-finger pinch cancels the build gesture and zooms
  const z0 = R.camera.zoom;
  const t1 = S(0, 0);
  canvas.fire('pointerdown', { pointerId: 11, pointerType: 'touch', button: 0, clientX: t1.x, clientY: t1.y });
  canvas.fire('pointermove', { pointerId: 11, pointerType: 'touch', button: 0, clientX: t1.x + 30, clientY: t1.y });
  canvas.fire('pointerdown', { pointerId: 12, pointerType: 'touch', button: 0, clientX: t1.x + 200, clientY: t1.y });
  canvas.fire('pointermove', { pointerId: 12, pointerType: 'touch', button: 0, clientX: t1.x + 400, clientY: t1.y });
  canvas.fire('pointerup', { pointerId: 12, pointerType: 'touch', button: 0, clientX: t1.x + 400, clientY: t1.y });
  canvas.fire('pointerup', { pointerId: 11, pointerType: 'touch', button: 0, clientX: t1.x + 30, clientY: t1.y });
  ok(R.camera.zoom > z0 * 1.3 && ed.design.beams.length === 0, 'pinch zooms and cancels the one-finger build');
  // one-finger touch build
  const ta = S(0, 0), tb = S(3, 0);
  canvas.fire('pointerdown', { pointerId: 21, pointerType: 'touch', button: 0, clientX: ta.x, clientY: ta.y });
  for (let i = 1; i <= 5; i++) canvas.fire('pointermove', { pointerId: 21, pointerType: 'touch', button: 0, clientX: ta.x + (tb.x - ta.x) * i / 5, clientY: ta.y });
  canvas.fire('pointerup', { pointerId: 21, pointerType: 'touch', button: 0, clientX: tb.x, clientY: tb.y });
  ok(ed.design.beams.length === 1 && nodeAt(ed, 3, 0), 'one-finger touch build');
  // keys
  win.fire('keydown', { key: 'z', ctrlKey: true });
  ok(ed.design.beams.length === 0, 'Ctrl+Z via DOM');
  win.fire('keydown', { key: ' ', code: 'Space' }); win.fire('keyup', { key: ' ', code: 'Space' });
  ok(game.tests === 1, 'Space tap → game.toggleTest()');
  // Space-drag pans and does not test
  win.fire('keydown', { key: ' ', code: 'Space' });
  const sC = S(0, 0);
  canvas.fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: sC.x, clientY: sC.y });
  canvas.fire('pointermove', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: sC.x + 50, clientY: sC.y });
  canvas.fire('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: sC.x + 50, clientY: sC.y });
  win.fire('keyup', { key: ' ', code: 'Space' });
  ok(game.tests === 1 && ed.design.beams.length === 0, 'Space-drag pans without testing or building');
  // someone else already handled Space (state changed) → no double toggle
  win.fire('keydown', { key: ' ', code: 'Space' }); game.state = 'sim'; win.fire('keyup', { key: ' ', code: 'Space' });
  ok(game.tests === 1, 'no Space double-toggle when game already switched state');
  game.state = 'edit';
  ed.detach();
  ok(Object.values(canvas.l).every((a) => a.length === 0) && Object.values(win.l).every((a) => a.length === 0), 'detach removes all listeners');
}

section('renderer state shape');
{
  const { ed } = fresh();
  const st = ed.state;
  ['hoverNode', 'hoverBeam', 'dragFrom', 'ghost', 'selection'].forEach((k) => ok(k in st, 'state.' + k));
  ed.pointerDown(0, 0, {}); ed.pointerMove(3, 1, {});
  const g = st.ghost;
  ok(g && ['x1', 'y1', 'x2', 'y2', 'valid', 'len', 'cost'].every((k) => k in g), 'ghost has x1,y1,x2,y2,valid,len,cost');
  ok(st.dragFrom === 'a0', 'dragFrom is joint id');
  ok(ed.state === st, 'state object identity is stable');
  ed.pointerUp(3, 1, {});
  ed.keyDown('Escape');
  ed.pointerMove(1.5, 0.5, {});
  ok(st.hoverBeam === null || typeof st.hoverBeam === 'number', 'hoverBeam index or null');
  ed.pointerMove(3, 1, {});
  ok(st.hoverNode === nodeAt(ed, 3, 1).id, 'hoverNode id');
}

section('chain: ends at anchors, out-of-reach click builds toward the joint');
{
  const { ed, game } = fresh();
  drag(ed, 0, 0, 6, 0);
  const n1 = nodeAt(ed, 6, 0);
  ok(ed.chainFrom === n1.id, 'chain continues from (6,0)');
  click(ed, 12, 0);
  ok(hasBeam(ed, n1.id, 'a1') && ed.chainFrom === null, 'connecting to the far anchor ends the chain');
  ed.keyDown('Escape');
  // chain from a2 (0,-3), click the right anchor a1 (12,0) which is 12.4 m away: wood stops at 6 m
  ed.material = 'wood';
  click(ed, 0, -3);
  ok(ed.chainFrom === 'a2', 'click on anchor starts a chain');
  ed.pointerMove(12, 0, {});
  const gx = ed.state.ghost && ed.state.ghost.x2, gy = ed.state.ghost && ed.state.ghost.y2;
  click(ed, 12, 0);
  const nEnd = ed.design.nodes.find((n) => near(n.x, gx) && near(n.y, gy));
  ok(nEnd && hasBeam(ed, 'a2', nEnd.id), 'out-of-reach click places the previewed (clamped) beam');
  ok(ed.chainFrom === (nEnd && nEnd.id) && /reaches at most 6\sm/.test(game.lastToast || ''), 'chain continues from the clamped end + toast');
}

section('auto-split: a new joint landing on a beam joins it');
{
  const { ed } = fresh();
  drag(ed, 0, 0, 6, 0);
  ed.keyDown('Escape');
  ed.material = 'wood';
  // a2 (0,-3) -> toward (6,0) is 6.7 m: wood stops at 6 m and snaps to (5,0), on the road a0-(6,0)
  drag(ed, 0, -3, 6, 0);
  const j = nodeAt(ed, 5, 0);
  const n6 = nodeAt(ed, 6, 0);
  ok(j && hasBeam(ed, 'a2', j.id), 'clamped strut ends at (5,0)');
  ok(j && hasBeam(ed, 'a0', j.id) && hasBeam(ed, j.id, n6.id) && !hasBeam(ed, 'a0', n6.id), 'road split at the strut joint');
  ok(ed.design.beams.filter((b) => b.m === 'road').length === 2, 'two road pieces');
  ed.undo();
  ok(hasBeam(ed, 'a0', n6.id) && !nodeAt(ed, 5, 0), 'undo restores the unsplit road');
}

section('terrain clearance + beams through rock');
{
  const { ed } = fresh();
  ed.material = 'steel';
  drag(ed, 0, -3, 0.25, -6);
  ok(!nodeAt(ed, 0.25, -6), 'no joint 0.25 m from the cliff face');
  ed.pointerDown(0, 0, {}); ed.pointerMove(-0.75, -6, {});
  ok(ed.state.ghost && !ed.state.ghost.valid, 'beam into the bank is invalid (' + (ed.state.ghost && ed.state.ghost.reason) + ')');
  ed.pointerCancel();
  ok(BG.Model.validate(ed._level(), { nodes: [{ id: 'n1', x: 0, y: -6 }], beams: [{ a: 'a0', b: 'n1', m: 'steel' }], piers: [] }).errors.some((e) => e.type === 'near_terrain'), 'validate: joint on the cliff face rejected');
  ok(BG.Model.validate(ed._level(), { nodes: [{ id: 'n1', x: 1, y: -6 }], beams: [{ a: 'a0', b: 'n1', m: 'steel' }, { a: 'n1', b: 'a2', m: 'steel' }], piers: [] }).ok, 'validate: joint 1 m off the face is fine');
  ok(BG.Model.validate(ed._level(), { nodes: [{ id: 'n1', x: 1, y: -6 }], beams: [{ a: 'n1', b: 'a0', m: 'steel' }, { a: 'n1', b: 'a2', m: 'steel' }, { a: 'n1', b: 'a0', m: 'wood' }], piers: [] }).errors.some((e) => e.type === 'duplicate_beam'), 'validate: duplicate beam still caught');
  const v = BG.Model.validate(ed._level(), { nodes: [{ id: 'n1', x: 1, y: -6 }], beams: [{ a: 'n1', b: 'a0', m: 'steel' }, { a: 'n1', b: 'a0', m: 'steel' }], piers: [] });
  ok(!v.ok, 'validate sanity');
  const rock = BG.Model.validate(ed._level(), { nodes: [{ id: 'n1', x: 1, y: -6 }], beams: [{ a: 'n1', b: 'a0', m: 'steel' }, { a: 'n1', b: 'a2', m: 'steel' }], piers: [] });
  ok(rock.ok, 'beams in the open are fine');
  const thru = BG.Model.validate(ed._level(), { nodes: [{ id: 'n1', x: 1, y: -6 }], beams: [{ a: 'n1', b: 'a0', m: 'steel' }, { a: 'n1', b: 'a2', m: 'steel' }, { a: 'a2', b: 'a1', m: 'steel' }], piers: [] });
  ok(thru.ok || thru.errors.every((e) => e.type !== 'in_terrain'), 'anchor-to-anchor beam over the gap is not through rock');
  const lv36 = { terrain: { leftEdge: 0, leftY: 0, rightEdge: 20, rightY: 0, floorY: -30, waterY: null }, anchors: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: -5, y: 0 }], materials: ['steel'] };
  ok(BG.Model.validate(lv36, { nodes: [{ id: 'n1', x: 2, y: -6 }], beams: [{ a: 'a2', b: 'n1', m: 'steel' }], piers: [] }).errors.some((e) => e.type === 'in_terrain' && e.beamIndex === 0), 'validate: beam through the bank rejected');
}

console.log(`${pass}/${pass + fail} editor checks passed`);
process.exit(fail ? 1 : 0);
