// SPAN — batch test for the procedural level generator (js/core/generator.js).
// Generates 365 consecutive daily levels + 200 random seeds across the difficulty range and asserts that
// every level is well-formed and PROVABLY solvable: the generator's own solution is valid, editor-buildable,
// re-verified headless on the final level (pass, peak <= 0.92, within the time limit) and sets the budget
// (cost / budget in (0.70, 0.75], so ★★★ needs a better bridge than the solver's).
// Also checks determinism (same seed -> identical JSON; time-sliced job == synchronous run) and prints
// the distribution of gaps / traffic / archetypes / costs plus generation timing.
//
// Usage: node tools/test-generator.js [--days 365] [--random 200] [--start 20260101] [--quick] [--verbose]
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { BG, runHeadless } = require('./harness');
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'core', 'generator.js'), 'utf8'), { filename: 'generator.js' });
const G = BG.Generator;

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] != null ? +args[i + 1] : d; };
const quick = args.includes('--quick');
const verbose = args.includes('--verbose');
const DAYS = arg('--days', quick ? 28 : 365);
const RANDOM = arg('--random', quick ? 24 : 200);
const START = arg('--start', 20260101);

let failures = 0;
const fail = (msg) => { failures++; console.log('FAIL ' + msg); };
const near = (a, b) => Math.abs(a - b) < 1e-6;
const onGrid = (v) => Math.abs(v * 4 - Math.round(v * 4)) < 1e-6;
const THEMES = ['meadow', 'autumn', 'desert', 'canyon', 'snow', 'night', 'city', 'tropical', 'volcanic'];

function checkLevel(tag, lv) {
  const errs = [];
  const e = (m) => errs.push(m);
  if (!lv || typeof lv !== 'object') return ['no level'];
  if (typeof lv.id !== 'string' || !lv.id) e('id');
  if (typeof lv.name !== 'string' || lv.name.length < 3) e('name');
  if (THEMES.indexOf(lv.theme) < 0) e('theme ' + lv.theme);
  const t = lv.terrain || {};
  for (const k of ['leftEdge', 'leftY', 'rightEdge', 'rightY', 'floorY']) if (!isFinite(t[k])) e('terrain.' + k);
  if (!(t.rightEdge - t.leftEdge >= 10)) e('gap < 10');
  if (!(t.floorY < Math.min(t.leftY, t.rightY) - 3)) e('floor too high');
  if (t.waterY != null && !(t.waterY > t.floorY && t.waterY < Math.min(t.leftY, t.rightY))) e('waterY out of range');
  const A = lv.anchors || [];
  if (A.length < 2 || !near(A[0].x, t.leftEdge) || !near(A[0].y, t.leftY) || !near(A[1].x, t.rightEdge) || !near(A[1].y, t.rightY)) e('road anchors');
  for (const a of A) if (BG.Model.inTerrain(lv, a.x, a.y, 0.05)) e('anchor inside terrain');
  const ra = BG.Model.roadAnchors(lv);
  if (ra.left !== 'a0' || ra.right !== 'a1') e('roadAnchors ' + JSON.stringify(ra));
  const ba = lv.buildArea || {};
  if (!(ba.x0 < ba.x1 && ba.y0 < ba.y1)) e('buildArea');
  if (!Array.isArray(lv.materials) || lv.materials.indexOf('road') < 0) e('materials: no road');
  for (const m of lv.materials || []) if (!BG.Materials[m]) e('unknown material ' + m);
  if (!Array.isArray(lv.traffic) || !lv.traffic.length) e('traffic');
  for (const g of lv.traffic || []) {
    if (!BG.Vehicles[g.type]) e('vehicle ' + g.type);
    if (!(g.count >= 1) || !(g.interval > 0)) e('traffic group');
  }
  if (!(Number.isInteger(lv.budget) && lv.budget > 0)) e('budget');
  if (!(lv.timeLimit > 0)) e('timeLimit');
  if (!Array.isArray(lv.pierZones) || !(lv.maxPiers >= 0) || lv.maxPiers > lv.pierZones.length) e('piers');
  for (const z of lv.pierZones || []) if (!(z.x0 < z.x1 && z.x0 > t.leftEdge && z.x1 < t.rightEdge)) e('pier zone');
  for (const z of lv.noBuild || []) if (!(z.x0 < z.x1 && z.y0 < z.y1)) e('noBuild rect');
  if (typeof lv.templates !== 'boolean') e('templates flag');
  if (JSON.stringify(JSON.parse(JSON.stringify(lv))) !== JSON.stringify(lv)) e('not JSON round-trippable');
  const g = lv.generator || {};
  if (g.version !== G.VERSION) e('generator.version');
  const sol = g.solution;
  if (!sol || !sol.design) { e('no solution'); return errs; }
  const d = sol.design;
  const v = BG.Model.validate(lv, d);
  if (!v.ok) e('solution invalid: ' + v.errors.slice(0, 3).map(x => x.type).join(','));
  const cost = BG.Model.cost(lv, d).total;
  if (cost !== sol.cost) e('solution cost mismatch ' + cost + ' vs ' + sol.cost);
  const ratio = cost / lv.budget;
  if (!(ratio > 0.7 && ratio <= 0.75 + 1e-9)) e('cost/budget ' + ratio.toFixed(3));
  // editor-buildable: 0.25 m grid, joints >= 0.6 m apart
  const all = BG.Model.allNodes(lv, d);
  for (const n of d.nodes) if (!onGrid(n.x) || !onGrid(n.y)) { e('joint off grid ' + n.id); break; }
  for (const p of d.piers) if (!onGrid(p.x) || !onGrid(p.topY)) { e('pier off grid'); break; }
  outer: for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    if (Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y) < 0.6) { e('joints closer than 0.6 m'); break outer; }
  }
  if (!BG.Model.roadConnected(lv, d)) e('road not connected');
  return errs;
}

function reverify(lv) {
  const r = runHeadless(lv, lv.generator.solution.design, {});
  const errs = [];
  if (r.status !== 'success') errs.push('re-run ' + r.status + ' ' + r.failReason);
  if (!(r.peakStress <= G.PEAK_MAX)) errs.push('re-run peak ' + r.peakStress);
  if (!r.budgetOk || !r.valid) errs.push('re-run budget/valid');
  if (!(r.time < lv.timeLimit)) errs.push('re-run time ' + r.time + ' >= limit ' + lv.timeLimit);
  return { errs, r };
}

const rows = [];
function run(tag, seed, opts) {
  const t0 = Date.now();
  let lv;
  try { lv = G.generate(seed, opts); } catch (e) { fail(tag + ': threw ' + e.message); return null; }
  const ms = Date.now() - t0;
  const errs = checkLevel(tag, lv);
  const rv = reverify(lv);
  errs.push.apply(errs, rv.errs);
  if (errs.length) fail(tag + ' (' + lv.name + '): ' + errs.join('; '));
  const g = lv.generator;
  const heaviest = lv.traffic.reduce((a, x) => BG.Vehicles[x.type].mass > BG.Vehicles[a].mass ? x.type : a, 'car');
  const row = {
    tag, seed, name: lv.name, ms, d: g.difficulty, arch: g.archetype, attempt: g.attempt, sims: g.sims,
    gap: lv.terrain.rightEdge - lv.terrain.leftEdge, heaviest, vehicles: lv.traffic.reduce((a, x) => a + x.count, 0),
    budget: lv.budget, cost: g.solution.cost, kind: g.solution.kind,
    peak: rv.r.peakStress, timeLimit: lv.timeLimit, simT: rv.r.time,
  };
  rows.push(row);
  if (verbose) console.log([tag, lv.name, 'd=' + row.d, row.arch, 'gap ' + row.gap, row.vehicles + 'v/' + heaviest, '$' + row.budget, row.kind, 'sims ' + row.sims, row.ms + ' ms'].join('  '));
  return lv;
}

const T0 = Date.now();
console.log('Generator v' + G.VERSION + ': ' + DAYS + ' consecutive days from ' + START + ' + ' + RANDOM + ' random seeds');

// ---- dailies
let seed = START;
const byWeekday = [[], [], [], [], [], [], []];
for (let i = 0; i < DAYS; i++, seed = G.addDays(seed, 1)) {
  const lv = run(G.isoDate(seed), seed, G.dailyOpts(seed));
  if (!lv) continue;
  if (lv.id !== 'daily-' + seed) fail(seed + ': id ' + lv.id);
  if (!/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)'s /.test(lv.name)) fail(seed + ': daily name ' + lv.name);
  if (lv.name.indexOf(G.WEEKDAYS[G.weekdayOf(seed)]) !== 0) fail(seed + ': weekday in name');
  byWeekday[G.weekdayOf(seed)].push(rows[rows.length - 1]);
}
// ---- random seeds across difficulty
let s = 0x2545F491;
for (let i = 0; i < RANDOM; i++) {
  s = G._hash(s, i, 'test');
  const d = RANDOM > 1 ? i / (RANDOM - 1) : 0.5;
  run('rnd#' + i, s, { difficulty: d, mode: i % 2 ? 'endless' : 'custom', index: i % 2 ? i : undefined, id: 'test-' + i });
}

// ---- determinism
{
  const probe = [START, G.addDays(START, 3), G.addDays(START, 6), 123456789, 42];
  for (const sd of probe) {
    const o = G.isDateSeed(sd) ? G.dailyOpts(sd) : { difficulty: 0.7 };
    const a = JSON.stringify(G.generate(sd, o)), b = JSON.stringify(G.generate(sd, o));
    if (a !== b) fail('determinism: seed ' + sd + ' differs between runs');
    const job = G.createJob(sd, o);
    let slices = 0;
    while (!job.step(0.5)) slices++;
    if (job.error) fail('job error ' + job.error.message);
    else if (JSON.stringify(job.level) !== a) fail('determinism: sliced job differs for seed ' + sd);
    if (slices < 2) fail('job did not slice (seed ' + sd + ')');
  }
  // weekday mapping sanity: 2026-10-05 is a Monday, 2026-10-11 a Sunday
  if (G.weekdayOf(20261005) !== 0 || G.weekdayOf(20261011) !== 6) fail('weekdayOf');
  if (G.addDays(20261231, 1) !== 20270101 || G.addDays(20240301, -1) !== 20240229) fail('addDays');
}

// ---- weekday curve: average difficulty / cost rises Monday -> Sunday
const avg = (a, f) => a.length ? a.reduce((x, r) => x + f(r), 0) / a.length : 0;
if (DAYS >= 14) {
  const dAvg = byWeekday.map(w => avg(w, r => r.d));
  for (let i = 1; i < 7; i++) if (!(dAvg[i] > dAvg[i - 1])) fail('weekday difficulty not rising at ' + G.WEEKDAYS[i]);
  if (!(avg(byWeekday[6], r => r.budget) > avg(byWeekday[0], r => r.budget) * 2)) fail('Sunday budgets should dwarf Monday budgets');
  console.log('\nWeekday curve (avg difficulty / gap / budget):');
  byWeekday.forEach((w, i) => console.log('  ' + G.WEEKDAYS[i].padEnd(10) + avg(w, r => r.d).toFixed(2) + '   ' + avg(w, r => r.gap).toFixed(1).padStart(5) + ' m   $' + Math.round(avg(w, r => r.budget)).toLocaleString('en-US').padStart(7)));
}

// ---- distribution report
function hist(title, key, buckets) {
  const counts = {};
  for (const r of rows) { const k = buckets ? buckets(r[key]) : r[key]; counts[k] = (counts[k] || 0) + 1; }
  const keys = Object.keys(counts).sort((a, b) => (parseFloat(a) - parseFloat(b)) || a.localeCompare(b));
  console.log('\n' + title + ':');
  for (const k of keys) console.log('  ' + String(k).padEnd(28) + String(counts[k]).padStart(4) + '  ' + '#'.repeat(Math.ceil(counts[k] * 60 / rows.length)));
}
hist('Gap', 'gap', v => { const lo = Math.floor(v / 10) * 10; return lo + '-' + (lo + 9) + ' m'; });
hist('Heaviest vehicle', 'heaviest', v => (BG.Vehicles[v].mass / 1000).toFixed(1).padStart(5) + ' t ' + v);
hist('Archetype', 'arch');
hist('Solver design', 'kind');
hist('Budget', 'budget', v => (v < 5000 ? '$ 0k' : v < 10000 ? '$ 5k' : v < 20000 ? '$10k' : v < 40000 ? '$20k' : '$40k') + '+');
hist('Adjustment attempts', 'attempt');
const ms = rows.map(r => r.ms).sort((a, b) => a - b);
const pct = (p) => ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] : 0;
const sims = rows.map(r => r.sims);
console.log('\nTiming (generation incl. proof, Node): mean ' + Math.round(avg(rows, r => r.ms)) + ' ms, p50 ' + pct(0.5) + ', p95 ' + pct(0.95) + ', max ' + pct(1) + ' ms; sims mean ' + (sims.reduce((a, b) => a + b, 0) / Math.max(1, sims.length)).toFixed(1) + ', max ' + Math.max.apply(null, sims));
console.log('Solver peak stress: mean ' + avg(rows, r => r.peak).toFixed(2) + ', max ' + Math.max.apply(null, rows.map(r => r.peak)).toFixed(2) + '; cost/budget mean ' + avg(rows, r => r.cost / r.budget).toFixed(3));
if (pct(0.95) > 2000) fail('p95 generation time ' + pct(0.95) + ' ms > 2000 ms');

const n = rows.length;
console.log('\n' + (failures ? 'FAILED: ' + failures + ' problem(s)' : 'OK') + ' — ' + n + ' / ' + (DAYS + RANDOM) + ' levels generated, ' + (n - (failures ? 0 : 0)) + ' verified solvable, ' + ((Date.now() - T0) / 1000).toFixed(1) + ' s total');
process.exit(failures ? 1 : 0);
