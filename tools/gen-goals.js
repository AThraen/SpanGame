#!/usr/bin/env node
// SPAN — generates the per-level goal sets (js/features/goals-data.js) and PROVES each goal:
// for every goal shipped there is a verifying design in tools/solutions/goals/level-NN-<goal>.json
// (re-verified by tools/test-goals.js).
//
// Method per level: build a pool of candidate designs from the existing solutions (reference / best),
// quick optimisation with the headless sim (greedy member pruning, material upgrades / substitutions,
// mirror-symmetric rebuilds, templates) — every candidate must PASS the level (success, in budget, valid,
// editor-buildable, no floppy parts, peak <= 0.99). A goal is only offered when some candidate meets it;
// thresholds (member count, mass) are taken from the best candidate plus a little slack.
//
// Usage: node tools/gen-goals.js                 all levels (parallel worker processes), then writes goals-data.js
//        node tools/gen-goals.js --only 3,4,5    just these levels (merges into the existing data)
//        node tools/gen-goals.js --level N       worker mode (one level; writes tools/solutions/goals/_level-NN.json)
//        env GEN_BUDGET_MS=240000                per-level optimisation time budget
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { BG, runHeadless } = require('./harness');
require('../js/features/goals.js');

const ROOT = path.resolve(__dirname, '..');
const SOL = path.join(__dirname, 'solutions');
const OUTDIR = path.join(SOL, 'goals');
const DATA_FILE = path.join(ROOT, 'js', 'features', 'goals-data.js');
const GRID = 0.25, MIN_SPACING = 0.6, WANDER_MAX = 1.0, PEAK_MAX = 0.99;
const BUDGET_MS = +(process.env.GEN_BUDGET_MS || 240000);
const pad2 = n => String(n).padStart(2, '0');
const clone = d => JSON.parse(JSON.stringify(d));

// ------------------------------------------------------------------ acceptance
function buildability(level, design) {
  const off = design.nodes.filter(n => Math.abs(n.x / GRID - Math.round(n.x / GRID)) > 1e-6 || Math.abs(n.y / GRID - Math.round(n.y / GRID)) > 1e-6);
  if (off.length) return 'off-grid';
  const all = BG.Model.allNodes(level, design);
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    if (all[i].kind !== 'node' && all[j].kind !== 'node') continue;
    if (Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y) < MIN_SPACING - 1e-9) return 'joints too close';
  }
  return null;
}
// Full acceptance of a design as a level solution. Returns the run (with .sim) or null.
function accept(level, design) {
  if (!design.beams.length) return null;
  let r;
  try { r = runHeadless(level, design, { keepSim: true }); } catch (e) { return null; }
  if (r.status !== 'success' || !r.budgetOk || !r.valid || !(r.peakStress <= PEAK_MAX)) return null;
  if (buildability(level, design)) return null;
  if (r.brokenBeams === 0) {
    const all = BG.Model.allNodes(level, design);
    for (let i = 0; i < all.length; i++) {
      if (all[i].fixed) continue;
      const n = r.sim.nodes[i];
      if (Math.hypot(n.x - all[i].x, n.y - all[i].y) > WANDER_MAX) return null;
    }
  }
  return r;
}

// ------------------------------------------------------------------ design helpers
function compact(level, d) {
  // drop joints no beam uses
  const used = new Set();
  d.beams.forEach(b => { used.add(b.a); used.add(b.b); });
  const keep = d.nodes.filter(n => used.has(n.id));
  return { nodes: keep, beams: d.beams, piers: d.piers || [] };
}
function without(d, idxSet) {
  return { nodes: d.nodes, beams: d.beams.filter((b, i) => !idxSet.has(i)), piers: d.piers || [] };
}
const bkey = b => (b.a < b.b ? b.a + '|' + b.b : b.b + '|' + b.a) + '|' + b.m;

// geometry <-> design (used for the mirrored rebuilds)
function toSegments(level, d) {
  const nodes = {};
  BG.Model.allNodes(level, d).forEach(n => { nodes[n.id] = n; });
  return d.beams.map(b => ({ x1: nodes[b.a].x, y1: nodes[b.a].y, x2: nodes[b.b].x, y2: nodes[b.b].y, m: b.m }));
}
function fromSegments(level, segs, piers) {
  const d = { nodes: [], beams: [], piers: piers.map(p => ({ x: p.x, topY: p.topY })) };
  const fixed = BG.Model.allNodes(level, d).filter(n => n.fixed);
  let next = 1;
  const at = (x, y) => {
    for (const n of fixed) if (Math.abs(n.x - x) < 1e-6 && Math.abs(n.y - y) < 1e-6) return n.id;
    for (const n of d.nodes) if (Math.abs(n.x - x) < 1e-6 && Math.abs(n.y - y) < 1e-6) return n.id;
    const id = 'n' + next++;
    d.nodes.push({ id, x, y });
    return id;
  };
  const seen = new Set();
  for (const s of segs) {
    const a = at(s.x1, s.y1), b = at(s.x2, s.y2);
    if (a === b) continue;
    const k = bkey({ a, b, m: s.m });
    if (seen.has(k)) continue;
    seen.add(k);
    d.beams.push({ a, b, m: s.m });
  }
  return d;
}
function mirrorX(level) { const t = level.terrain; return (t.leftEdge + t.rightEdge) / 2; }
// Keep one half of the design and reflect it: guaranteed mirror-symmetric (if the level's anchors are).
function mirrorHalf(level, d, keepLeft) {
  const cx = mirrorX(level);
  const segs = toSegments(level, d);
  const out = [];
  const half = (s) => (s.x1 + s.x2) / 2;
  for (const s of segs) {
    const mx = half(s);
    if (Math.abs(mx - cx) < 1e-6) {
      // centred member: keep if self-symmetric, else add its twin
      out.push(s);
      out.push({ x1: 2 * cx - s.x1, y1: s.y1, x2: 2 * cx - s.x2, y2: s.y2, m: s.m });
    } else if (keepLeft ? mx < cx : mx > cx) {
      out.push(s);
      out.push({ x1: 2 * cx - s.x1, y1: s.y1, x2: 2 * cx - s.x2, y2: s.y2, m: s.m });
    }
  }
  const piers = [];
  for (const p of d.piers || []) {
    if (keepLeft ? p.x <= cx + 1e-6 : p.x >= cx - 1e-6) { piers.push(p); if (Math.abs(p.x - cx) > 1e-6) piers.push({ x: 2 * cx - p.x, topY: p.topY }); }
  }
  return fromSegments(level, out, piers);
}
function substitute(level, d, map) {
  const out = clone(d);
  out.beams.forEach(b => { if (map[b.m] && level.materials.includes(map[b.m])) b.m = map[b.m]; });
  return out;
}

// ------------------------------------------------------------------ optimisation
function makeClock(ms) { const t0 = Date.now(); return () => Date.now() - t0 < ms; }

// Greedy member pruning: drop the least-stressed members (chunks first, then one at a time) while the level still passes.
function prune(level, d0, alive, label) {
  let d = compact(level, clone(d0));
  let run = accept(level, d);
  if (!run) return null;
  const needed = new Set();
  let chunkDiv = 6;
  let guard = 0;
  while (alive() && guard++ < 400) {
    const peaks = d.beams.map((b, i) => run.sim.beams[i] ? (run.sim.beams[i].peak || 0) : 0);
    const order = d.beams.map((b, i) => i).filter(i => !needed.has(bkey(d.beams[i]))).sort((a, b) => peaks[a] - peaks[b]);
    if (!order.length) break;
    let chunk = Math.max(1, Math.floor(order.length / chunkDiv));
    let idx = 0, progressed = false;
    while (idx < order.length && alive()) {
      const take = order.slice(idx, idx + chunk);
      const cand = compact(level, without(d, new Set(take)));
      const r = accept(level, cand);
      if (r) { d = cand; run = r; progressed = true; break; }
      if (chunk > 1) chunk = Math.ceil(chunk / 2);
      else { needed.add(bkey(d.beams[order[idx]])); idx++; }
    }
    if (!progressed) break;
  }
  return { design: d, run, label };
}

// ------------------------------------------------------------------ one level
function solve(level) {
  const nn = pad2(level.id);
  const alive = makeClock(BUDGET_MS);
  const load = s => { const f = path.join(SOL, 'level-' + nn + s + '.json'); return fs.existsSync(f) ? BG.Model.deserialize(fs.readFileSync(f, 'utf8')) : null; };
  const ref = load(''), best = load('-best');
  const pool = [];   // { label, design, run, m }
  const seen = new Set();
  const add = (label, design) => {
    if (!design) return null;
    const k = JSON.stringify(design);
    if (seen.has(k)) return null;
    seen.add(k);
    const run = accept(level, design);
    if (!run) return null;
    const e = { label, design, run, m: BG.Goals.metrics(level, design, run) };
    pool.push(e);
    return e;
  };
  add('ref', ref); add('best', best);

  // templates (symmetric by construction on level-symmetric terrain)
  try {
    for (const t of BG.Templates.list) {
      let frag = null;
      try { frag = BG.Templates.generate(t.id, level, {}); } catch (e) { /* */ }
      if (frag && frag.beams && frag.beams.length) add('tpl-' + t.id, { nodes: frag.nodes || [], beams: frag.beams, piers: frag.piers || [] });
    }
  } catch (e) { /* templates optional */ }

  // material substitutions / upgrades
  const bases = pool.slice();
  for (const e of bases) {
    add(e.label + '-nosteel', substitute(level, e.design, { steel: 'wood' }));
    add(e.label + '-timber', substitute(level, e.design, { steel: 'wood', reinforced_road: 'road' }));
    add(e.label + '-steel', substitute(level, e.design, { wood: 'steel' }));
    add(e.label + '-steel-rr', substitute(level, e.design, { wood: 'steel', road: 'reinforced_road', rope: 'cable' }));
    add(e.label + '-rr', substitute(level, e.design, { road: 'reinforced_road' }));
  }

  // symmetric rebuilds
  for (const e of pool.slice()) {
    if (e.m.symmetric) continue;
    add(e.label + '-mirL', mirrorHalf(level, e.design, true));
    add(e.label + '-mirR', mirrorHalf(level, e.design, false));
  }

  // pruned (minimal member count / mass / cost)
  const prunedSources = [];
  const bestE = pool.find(e => e.label === 'best'), refE = pool.find(e => e.label === 'ref');
  if (bestE) prunedSources.push(bestE);
  if (refE) prunedSources.push(refE);
  for (const e of pool.filter(x => x.m.symmetric && /^(tpl|ref|best)/.test(x.label)).slice(0, 2)) prunedSources.push(e);
  const per = Math.max(20000, Math.floor(BUDGET_MS / Math.max(1, prunedSources.length)));
  for (const src of prunedSources) {
    const clk = makeClock(per);
    const p = prune(level, src.design, clk, src.label + '-pruned');
    if (p && JSON.stringify(p.design) !== JSON.stringify(src.design)) add(p.label, p.design);
  }
  // a symmetric pruned design: prune the mirrored one
  for (const e of pool.filter(x => /-mir[LR]$/.test(x.label)).slice(0, 2)) {
    const p = prune(level, e.design, makeClock(Math.floor(per / 2)), e.label + '-pruned');
    if (p) add(p.label, p.design);
  }
  return pool;
}

const PRIORITY = { no_piers: 5, no_steel: 5, timber_only: 5, smooth_ride: 5, symmetric: 4, cool_head: 4, featherweight: 3, minimalist: 3, penny: 3 };
const EFFICIENCY = ['minimalist', 'featherweight', 'penny'];

function achievable(level, pool) {
  const usedAny = (pred) => pool.some(e => (e.label === 'ref' || e.label === 'best') && pred(e.m));
  const out = {};   // type -> { spec, entry }
  const pick = (type, fn, spec) => {
    const c = pool.filter(fn);
    if (!c.length) return;
    out[type] = { spec: spec(c), entry: null };
  };
  const minBy = (arr, key) => arr.reduce((a, b) => (key(b) < key(a) ? b : a));
  // minimalist: member count of the sparsest proven design + slack
  {
    const e = minBy(pool, x => x.m.members);
    const max = e.m.members + Math.max(1, Math.round(e.m.members * 0.08));
    const holder = pool.filter(x => x.m.members <= max).sort((a, b) => a.m.members - b.m.members)[0];
    out.minimalist = { spec: { type: 'minimalist', max }, entry: holder };
  }
  {
    const e = minBy(pool, x => x.m.mass);
    const maxMass = Math.ceil(e.m.mass * 1.06 / 10) * 10;
    const holder = pool.filter(x => x.m.mass <= maxMass).sort((a, b) => a.m.mass - b.m.mass)[0];
    out.featherweight = { spec: { type: 'featherweight', maxMass }, entry: holder };
  }
  {
    const e = minBy(pool, x => x.m.costRatio);
    if (e.m.costRatio <= 0.62) {
      const ratio = Math.max(0.5, Math.ceil((e.m.costRatio + 0.005) * 20) / 20);
      out.penny = { spec: { type: 'penny', ratio }, entry: pool.filter(x => x.m.costRatio <= ratio).sort((a, b) => a.m.costRatio - b.m.costRatio)[0] };
    }
  }
  {
    const e = minBy(pool, x => x.run.peakStress);
    const max = e.run.peakStress <= 0.5 ? 0.5 : e.run.peakStress <= 0.6 ? 0.6 : 0;
    if (max) out.cool_head = { spec: { type: 'cool_head', max }, entry: e };
  }
  {
    const c = pool.filter(x => x.m.symmetric);
    // trivial only if the plain references are already symmetric
    if (c.length && !(usedAny(m => m.symmetric) && pool.filter(x => /^(ref|best)$/.test(x.label)).every(x => x.m.symmetric))) {
      const hold = c.sort((a, b) => a.m.cost - b.m.cost)[0];
      out.symmetric = { spec: { type: 'symmetric' }, entry: hold };
    }
  }
  if (level.materials.includes('steel') && usedAny(m => m.materials.steel)) {
    const c = pool.filter(x => !x.m.materials.steel);
    if (c.length) out.no_steel = { spec: { type: 'no_steel' }, entry: c.sort((a, b) => a.m.cost - b.m.cost)[0] };
  }
  if (level.materials.some(k => k !== 'road' && k !== 'wood') && usedAny(m => Object.keys(m.count).some(k => k !== 'road' && k !== 'wood'))) {
    const c = pool.filter(x => Object.keys(x.m.count).every(k => k === 'road' || k === 'wood'));
    if (c.length) out.timber_only = { spec: { type: 'timber_only' }, entry: c.sort((a, b) => a.m.cost - b.m.cost)[0] };
  }
  // railway levels (Iron Road, Forth Bridge): Smooth Ride - the worst kink the train felt, as a share of its limit,
  // from the smoothest proven design plus slack (rounded up to 5 %); not offered when the plain solutions already
  // ride that smoothly
  if ((level.traffic || []).some(g => g.type === 'train')) {
    const c = pool.filter(x => x.m.ride != null);
    if (c.length) {
      const e = minBy(c, x => x.m.ride);
      const max = Math.min(0.6, Math.max(0.2, Math.ceil((e.m.ride + 0.03) * 20 - 1e-9) / 20));
      const trivial = pool.filter(x => /^(ref|best)$/.test(x.label)).every(x => x.m.ride != null && x.m.ride <= max);
      if (e.m.ride <= max && !trivial) out.smooth_ride = { spec: { type: 'smooth_ride', max }, entry: c.filter(x => x.m.ride <= max).sort((a, b) => a.m.cost - b.m.cost)[0] };
    }
  }
  if ((level.maxPiers | 0) > 0 && usedAny(m => m.piers > 0)) {
    const c = pool.filter(x => x.m.piers === 0);
    if (c.length) out.no_piers = { spec: { type: 'no_piers' }, entry: c.sort((a, b) => a.m.cost - b.m.cost)[0] };
  }
  return out;
}

function choose(level, ach) {
  const types = Object.keys(ach);
  const k = level.id <= 5 ? 2 : 3;
  const noise = t => ((level.id * 2654435761 + t.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) >>> 0) % 4;
  const score = t => PRIORITY[t] + noise(t) * 0.8;
  const sorted = types.sort((a, b) => score(b) - score(a));
  let chosen = [];
  for (const t of sorted) if (chosen.length < k && !(EFFICIENCY.includes(t) && chosen.some(c => EFFICIENCY.includes(c)))) chosen.push(t);
  for (const t of sorted) if (chosen.length < k && !chosen.includes(t)) chosen.push(t);
  if (!chosen.some(t => EFFICIENCY.includes(t))) {
    const eff = sorted.find(t => EFFICIENCY.includes(t));
    if (eff) chosen[chosen.length - 1] = eff;
  }
  return chosen;
}

function workerMain(id) {
  const level = BG.Levels.find(l => l.id === id);
  if (!level) throw new Error('no level ' + id);
  const t0 = Date.now();
  const pool = solve(level);
  const ach = achievable(level, pool);
  const chosen = choose(level, ach);
  fs.mkdirSync(OUTDIR, { recursive: true });
  for (const f of fs.readdirSync(OUTDIR)) if (f.startsWith('level-' + pad2(id) + '-')) fs.unlinkSync(path.join(OUTDIR, f));
  const specs = [];
  for (const t of BG.Goals ? chosen : []) {
    const a = ach[t];
    fs.writeFileSync(path.join(OUTDIR, 'level-' + pad2(id) + '-' + t + '.json'), BG.Model.serialize(a.entry.design));
    specs.push(a.spec);
  }
  const meta = { id, goals: specs, pool: pool.map(e => e.label + ':' + e.m.members + 'm/' + e.m.mass + 'kg/' + e.m.costRatio + '/' + e.run.peakStress), achievable: Object.keys(ach), sec: Math.round((Date.now() - t0) / 1000) };
  fs.writeFileSync(path.join(OUTDIR, '_level-' + pad2(id) + '.json'), JSON.stringify(meta));
  console.log('level ' + id + ': ' + specs.map(s => s.type).join(', ') + '  (achievable: ' + meta.achievable.join(',') + ') ' + meta.sec + 's');
}

function writeData(all) {
  const ids = Object.keys(all).map(Number).sort((a, b) => a - b);
  const lines = ids.map(id => '  ' + id + ': ' + JSON.stringify(all[id]));
  const src = '/* SPAN — per-level goal sets (BG.GoalsData). GENERATED by tools/gen-goals.js — do not edit by hand.\n' +
    '   Every goal here has a verifying design in tools/solutions/goals/ (checked by tools/test-goals.js). */\n' +
    '(function (root) {\n  \'use strict\';\n  const BG = (root.BG = root.BG || {});\n  BG.GoalsData = {\n' + lines.join(',\n') + '\n  };\n})(typeof window !== \'undefined\' ? window : globalThis);\n';
  fs.writeFileSync(DATA_FILE, src);
}
function readData() {
  if (!fs.existsSync(DATA_FILE)) return {};
  const ctx = { BG: {} };
  new Function('window', fs.readFileSync(DATA_FILE, 'utf8'))(ctx);
  return ctx.BG.GoalsData || {};
}

function main() {
  const args = process.argv.slice(2);
  const li = args.indexOf('--level');
  if (li >= 0) return workerMain(+args[li + 1]);
  const oi = args.indexOf('--only');
  const only = oi >= 0 ? args[oi + 1].split(',').map(Number) : null;
  const ids = BG.Levels.map(l => l.id).filter(id => !only || only.includes(id));
  const conc = Math.max(1, Math.min(ids.length, (require('os').cpus().length || 4) - 2, 12));
  const queue = ids.slice().sort((a, b) => b - a);   // big levels first
  let running = 0, failed = 0;
  const next = () => {
    if (!queue.length) { if (!running) finish(); return; }
    const id = queue.shift();
    running++;
    const p = spawn(process.execPath, [__filename, '--level', String(id)], { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('exit', code => { running--; if (code) { failed++; console.error('level ' + id + ' worker failed (' + code + ')'); } next(); });
  };
  const finish = () => {
    const all = only ? readData() : {};
    for (const id of ids) {
      const f = path.join(OUTDIR, '_level-' + pad2(id) + '.json');
      if (!fs.existsSync(f)) continue;
      all[id] = JSON.parse(fs.readFileSync(f, 'utf8')).goals;
    }
    writeData(all);
    for (const id of ids) { const f = path.join(OUTDIR, '_level-' + pad2(id) + '.json'); if (fs.existsSync(f)) fs.unlinkSync(f); }
    console.log('wrote ' + path.relative(ROOT, DATA_FILE) + ' (' + Object.keys(all).length + ' levels)');
    process.exit(failed ? 1 : 0);
  };
  for (let i = 0; i < conc; i++) next();
}

if (require.main === module) main();
module.exports = { accept, buildability, fromSegments, toSegments, mirrorHalf, prune };
