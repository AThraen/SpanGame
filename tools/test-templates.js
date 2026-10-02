// Unit tests for BG.Templates. Usage: node tools/test-templates.js [--verbose] [--svg out.html]
// Generates every template on a set of synthetic levels (and on BG.Levels if present), then checks
// geometry with BG.Templates.checkGeometry and BG.Model.validate (when js/core/model.js exists).
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
global.BG = global.BG || {};
function load(rel) {
  const f = path.join(ROOT, rel);
  if (!fs.existsSync(f)) return false;
  try { require(f); return true; } catch (e) { console.warn('  (could not load ' + rel + ': ' + e.message + ')'); return false; }
}
['js/core/materials.js', 'js/core/vehicles.js', 'js/core/model.js', 'js/core/levels.js'].forEach(load);
if (!load('js/core/templates.js')) { console.error('templates.js missing'); process.exit(1); }
const BG = global.BG;
const verbose = process.argv.includes('--verbose');
const svgIdx = process.argv.indexOf('--svg');
const svgOut = svgIdx > 0 ? process.argv[svgIdx + 1] : null;

let failures = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.log('  FAIL: ' + msg); } }

function lvl(o) {
  const t = Object.assign({ leftEdge: 0, leftY: 0, rightEdge: 12, rightY: 0, floorY: -10, waterY: null }, o.terrain);
  return Object.assign({
    id: o.id || 0, name: o.name || 'synthetic', theme: 'meadow',
    anchors: [{ x: t.leftEdge, y: t.leftY }, { x: t.rightEdge, y: t.rightY }],
    pierZones: [], maxPiers: 0, noBuild: [],
    buildArea: { x0: t.leftEdge - 4, x1: t.rightEdge + 4, y0: t.floorY, y1: Math.max(t.leftY, t.rightY) + 20 },
    materials: ['road', 'wood'], budget: 1e7, traffic: [{ type: 'car', count: 2, interval: 2.5 }], timeLimit: 60, templates: true,
  }, o, { terrain: t });
}

const levels = [
  lvl({ name: '12m road+wood', terrain: { rightEdge: 12 }, anchors: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 0, y: -3 }, { x: 12, y: -3 }] }),
  lvl({ name: '18m wood only lower anchors', terrain: { rightEdge: 18, floorY: -12 }, anchors: [{ x: 0, y: 0 }, { x: 18, y: 0 }, { x: 0, y: -4 }, { x: 18, y: -4 }], materials: ['road', 'wood', 'rope'] }),
  lvl({ name: '30m steel + pier zone', terrain: { rightEdge: 30, floorY: -14, waterY: -10 }, materials: ['road', 'wood', 'steel'],
    anchors: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 0, y: -5 }, { x: 30, y: -5 }], pierZones: [{ x0: 12, x1: 18 }], maxPiers: 1 }),
  lvl({ name: '45m uneven banks + cable', terrain: { rightEdge: 45, leftY: 0, rightY: 4, floorY: -16 }, materials: ['road', 'steel', 'cable', 'wood'],
    anchors: [{ x: 0, y: 0 }, { x: 45, y: 4 }, { x: 0, y: -4 }, { x: 45, y: -2 }, { x: -6, y: 0 }, { x: 51, y: 4 }], pierZones: [{ x0: 8, x1: 14 }, { x0: 31, x1: 37 }], maxPiers: 2,
    traffic: [{ type: 'bus', count: 1, interval: 3 }] }),
  lvl({ name: '60m ship channel', terrain: { rightEdge: 60, floorY: -20, waterY: -14 }, materials: ['road', 'reinforced_road', 'steel', 'cable'],
    anchors: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 0, y: -6 }, { x: 60, y: -6 }], pierZones: [{ x0: 10, x1: 18 }, { x0: 42, x1: 50 }], maxPiers: 2,
    noBuild: [{ x0: 20, x1: 40, y0: -14, y1: -3 }], traffic: [{ type: 'truck', count: 2, interval: 4 }] }),
  lvl({ name: '100m no piers', terrain: { rightEdge: 100, floorY: -40 }, materials: ['road', 'reinforced_road', 'steel', 'cable'],
    anchors: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: -8 }, { x: 100, y: -8 }, { x: -8, y: 0 }, { x: 108, y: 0 }],
    traffic: [{ type: 'semi', count: 1, interval: 4 }] }),
  lvl({ name: '150m piers + cable', terrain: { rightEdge: 150, floorY: -30, waterY: -22 }, materials: ['road', 'reinforced_road', 'steel', 'cable', 'wood', 'rope'],
    anchors: [{ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 0, y: -6 }, { x: 150, y: -6 }],
    pierZones: [{ x0: 20, x1: 45 }, { x0: 105, x1: 130 }, { x0: 70, x1: 80 }], maxPiers: 4, traffic: [{ type: 'heavy', count: 1, interval: 4 }] }),
  lvl({ name: 'low ceiling 24m', terrain: { rightEdge: 24, floorY: -10 }, materials: ['road', 'wood', 'steel'],
    buildArea: { x0: -2, x1: 26, y0: -10, y1: 3 } }),
  lvl({ name: 'offset anchors, shuffled order', terrain: { leftEdge: 10, rightEdge: 34, leftY: 2, rightY: 2, floorY: -10 }, materials: ['road', 'wood', 'steel', 'rope'],
    anchors: [{ x: 10, y: -2 }, { x: 34, y: -2 }, { x: 34, y: 2 }, { x: 10, y: 2 }] }),
];
if (Array.isArray(BG.Levels)) BG.Levels.forEach((l) => levels.push(l));

function geomOf(level, design) {
  const pos = {};
  (level.anchors || []).forEach((a, i) => { pos['a' + i] = a; });
  (design.piers || []).forEach((p, i) => { pos['p' + i] = { x: p.x, y: p.topY }; });
  design.nodes.forEach((n) => { pos[n.id] = n; });
  return pos;
}

function cost(level, d) {
  if (BG.Model && BG.Model.cost) { try { return BG.Model.cost(level, d).total; } catch (e) { /* ignore */ } }
  const pos = geomOf(level, d);
  let c = 0;
  d.beams.forEach((b) => { const A = pos[b.a], B = pos[b.b]; const m = (BG.Materials && BG.Materials[b.m]) || { costPerMeter: 100 }; c += Math.hypot(B.x - A.x, B.y - A.y) * m.costPerMeter; });
  return Math.round(c);
}

console.log('BG.Model ' + (BG.Model && BG.Model.validate ? 'present: validating with BG.Model.validate too' : 'not present: own geometry checks only'));
const ids = BG.Templates.list.map((t) => t.id);
ok(JSON.stringify(ids) === JSON.stringify(['beam', 'warren', 'pratt', 'howe', 'deck_arch', 'through_arch', 'suspension', 'cable_stayed']), 'template ids match spec');
BG.Templates.list.forEach((t) => ok(t.name && t.desc, 'template ' + t.id + ' has name/desc'));

const svgParts = [];
for (const level of levels) {
  const row = [];
  for (const id of ids) {
    const d = BG.Templates.generate(id, level, {});
    const errs = BG.Templates.checkGeometry(level, d);
    ok(errs.length === 0, `[${level.name}] ${id}: geometry errors ${JSON.stringify(errs.slice(0, 3))}`);
    if (BG.Model && BG.Model.validate) {
      let r;
      try { r = BG.Model.validate(level, d); } catch (e) { r = { ok: false, errors: [{ type: 'throw', msg: e.message }] }; }
      ok(r && r.ok, `[${level.name}] ${id}: BG.Model.validate errors ${JSON.stringify(r && r.errors && r.errors.slice(0, 3))}`);
    }
    ok(d.beams.length > 0, `[${level.name}] ${id}: has beams`);
    // deck connects both road anchors through road members
    const roadMats = d.beams.filter((b) => /road/.test(b.m));
    const ra = BG.Templates.roadAnchors(level);
    ok(roadMats.some((b) => b.a === ra.left || b.b === ra.left) && roadMats.some((b) => b.a === ra.right || b.b === ra.right), `[${level.name}] ${id}: road reaches both anchors`);
    // node ids unique & referenced
    const used = new Set(); d.beams.forEach((b) => { used.add(b.a); used.add(b.b); });
    ok(d.nodes.every((n) => used.has(n.id)), `[${level.name}] ${id}: no orphan joints`);
    // allowed materials
    ok(d.beams.every((b) => !level.materials || level.materials.includes(b.m)), `[${level.name}] ${id}: only allowed materials`);
    // every free joint has >= 2 members (no dangling pendulums)
    const deg = {}; d.beams.forEach((b) => { deg[b.a] = (deg[b.a] || 0) + 1; deg[b.b] = (deg[b.b] || 0) + 1; });
    ok(d.nodes.every((n) => deg[n.id] >= 2), `[${level.name}] ${id}: every joint has >= 2 members`);
    row.push({ id, d, n: d.nodes.length, b: d.beams.length, p: d.piers.length, cost: cost(level, d) });
    if (verbose) console.log(`  ${level.name.padEnd(32)} ${id.padEnd(13)} nodes ${String(d.nodes.length).padStart(3)} beams ${String(d.beams.length).padStart(3)} piers ${d.piers.length} cost $${cost(level, d)}`);
  }
  if (svgOut) svgParts.push({ level, row });
}

// determinism
const L = levels[4];
ok(JSON.stringify(BG.Templates.generate('suspension', L)) === JSON.stringify(BG.Templates.generate('suspension', L)), 'deterministic output');
// unknown id → empty fragment
const e = BG.Templates.generate('nope', levels[0]);
ok(e && e.nodes.length === 0 && e.beams.length === 0, 'unknown id gives empty fragment');
// startId option
const s = BG.Templates.generate('warren', levels[0], { startId: 50 });
ok(s.nodes.every((n) => +n.id.slice(1) >= 50), 'startId respected');
// symmetric span → mirror-symmetric design
{
  const d = BG.Templates.generate('pratt', levels[2]);
  const c = 15;
  const has = (x, y) => d.nodes.some((n) => Math.abs(n.x - x) < 1e-3 && Math.abs(n.y - y) < 1e-3) || levels[2].anchors.some((a) => Math.abs(a.x - x) < 1e-3 && Math.abs(a.y - y) < 1e-3);
  ok(d.nodes.every((n) => has(2 * c - n.x, n.y)), 'pratt on symmetric level is mirror-symmetric');
}
// max-length respected with wood fallback (no steel)
{
  const d = BG.Templates.generate('howe', levels[1]);
  ok(d.beams.every((b) => b.m !== 'steel'), 'steel falls back to wood when not allowed');
}
// suspension/cable-stayed use piers in zones when available
{
  const d = BG.Templates.generate('suspension', levels[4]);
  ok(d.piers.length === 2, 'suspension uses 2 pier towers on the channel level (got ' + d.piers.length + ')');
  const cs = BG.Templates.generate('cable_stayed', levels[6]);
  ok(cs.piers.length >= 1 && cs.piers.length <= 4, 'cable-stayed uses piers on 150 m level');
}

if (svgOut) {
  const html = ['<!doctype html><meta charset=utf-8><body style="margin:0;background:#1c2330;font:12px system-ui;color:#ccd">'];
  const col = { road: '#444', reinforced_road: '#222', wood: '#c08040', steel: '#9fb4c8', rope: '#d8c890', cable: '#f0f0f0' };
  for (const { level, row } of svgParts) {
    const t = level.terrain;
    const x0 = level.buildArea.x0 - 2, x1 = level.buildArea.x1 + 2, y0 = t.floorY - 1, y1 = level.buildArea.y1 + 1;
    for (const r of row) {
      const W = 340, sc = W / (x1 - x0), H = Math.max(60, (y1 - y0) * sc);
      const X = (x) => ((x - x0) * sc).toFixed(1), Y = (y) => ((y1 - y) * sc).toFixed(1);
      const pos = geomOf(level, r.d);
      let g = `<svg width=${W} height=${H.toFixed(0)} style="background:#2a3446;margin:3px">`;
      g += `<polygon fill="#566" points="${X(x0)},${Y(t.leftY)} ${X(t.leftEdge)},${Y(t.leftY)} ${X(t.leftEdge)},${Y(t.floorY)} ${X(t.rightEdge)},${Y(t.floorY)} ${X(t.rightEdge)},${Y(t.rightY)} ${X(x1)},${Y(t.rightY)} ${X(x1)},${Y(y0)} ${X(x0)},${Y(y0)}"/>`;
      if (t.waterY != null) g += `<rect x=${X(t.leftEdge)} y=${Y(t.waterY)} width=${((t.rightEdge - t.leftEdge) * sc).toFixed(1)} height=${((t.waterY - t.floorY) * sc).toFixed(1)} fill="#2b6cb0" opacity=.6 />`;
      (level.noBuild || []).forEach((z) => { g += `<rect x=${X(z.x0)} y=${Y(z.y1)} width=${((z.x1 - z.x0) * sc).toFixed(1)} height=${((z.y1 - z.y0) * sc).toFixed(1)} fill="#f55" opacity=.25 />`; });
      (level.pierZones || []).forEach((z) => { g += `<rect x=${X(z.x0)} y=${Y(t.floorY + 0.4)} width=${((z.x1 - z.x0) * sc).toFixed(1)} height=3 fill="#fd5" />`; });
      r.d.piers.forEach((p) => { g += `<rect x=${(X(p.x) - 2)} y=${Y(p.topY)} width=4 height=${((p.topY - t.floorY) * sc).toFixed(1)} fill="#aaa" />`; });
      r.d.beams.forEach((b) => { const A = pos[b.a], B = pos[b.b]; g += `<line x1=${X(A.x)} y1=${Y(A.y)} x2=${X(B.x)} y2=${Y(B.y)} stroke="${col[b.m] || '#f0f'}" stroke-width=${/road/.test(b.m) ? 3 : 1.4} />`; });
      Object.values(pos).forEach((p) => { g += `<circle cx=${X(p.x)} cy=${Y(p.y)} r=1.6 fill="#fff" />`; });
      g += `<text x=4 y=12 fill="#fff">${level.name} · ${r.id} · $${r.cost}</text></svg>`;
      html.push(g);
    }
    html.push('<br>');
  }
  fs.writeFileSync(svgOut, html.join('\n'));
  console.log('wrote ' + svgOut);
}

console.log(`${checks - failures}/${checks} checks passed across ${levels.length} levels × ${ids.length} templates`);
process.exit(failures ? 1 : 0);
