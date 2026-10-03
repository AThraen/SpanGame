#!/usr/bin/env node
// SPAN — Forces of Nature tests (js/core/events.js: wind + earthquake events).
// Usage: node tools/test-events.js [filter] [--full]
//   --full  bit-identity check on every road level (reference + best) instead of a sample
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { BG, runHeadless } = require('./harness');

const args = process.argv.slice(2);
const FULL = args.includes('--full');
const filter = args.find(a => !a.startsWith('--'));

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function approx(a, b, tol, msg) { assert(Math.abs(a - b) <= tol, (msg || 'approx') + `: ${a} vs ${b} (tol ${tol})`); }

const ROOT = path.resolve(__dirname, '..');
const solution = (id, best) => BG.Model.deserialize(fs.readFileSync(path.join(__dirname, 'solutions', 'level-' + String(id).padStart(2, '0') + (best ? '-best' : '') + '.json'), 'utf8'));
const level = id => BG.Levels.find(l => l.id === id);
const clone = o => JSON.parse(JSON.stringify(o));
function makeLevel(gap, extra) {
  return Object.assign({
    id: 900, name: 'test', theme: 'meadow',
    terrain: { leftEdge: 0, leftY: 0, rightEdge: gap, rightY: 0, floorY: -15, waterY: null },
    anchors: [{ x: 0, y: 0 }, { x: gap, y: 0 }, { x: 0, y: -4 }, { x: gap, y: -4 }],
    pierZones: [], maxPiers: 0, noBuild: [], buildArea: { x0: -30, x1: gap + 30, y0: -14, y1: 40 },
    materials: Object.keys(BG.Materials), budget: 1e9, traffic: [], timeLimit: 60, templates: false,
  }, extra || {});
}
function stepN(sim, seconds) { for (let i = 0, n = Math.round(seconds * 60); i < n; i++) { sim.step(); sim.events.length = 0; } }
function fingerprint(sim) {
  const s = sim.summary();
  return JSON.stringify(s) + '|' + Array.from(sim.px.subarray(0, sim.nNodes)).join(',') + '|' + Array.from(sim.py.subarray(0, sim.nNodes)).join(',');
}
function runFull(Sim, lv, d) {
  const sim = new Sim(lv, d, { seed: 1 });
  const maxSteps = Math.ceil(((lv.timeLimit || 60) + 0.5) * 60 - 1e-6);
  for (let i = 0; i < maxSteps && sim.status === 'running'; i++) { sim.step(); sim.events.length = 0; }
  return sim;
}

// a second copy of the engine WITHOUT events.js (pristine baseline for bit-identity)
function loadBaseline() {
  const ctx = vm.createContext({ console, Math, JSON, Float64Array, Int32Array, Uint8Array, Map, Set, Array, Object, Number, String, isFinite });
  ctx.globalThis = ctx;
  for (const f of ['materials.js', 'vehicles.js', 'trains.js', 'model.js', 'physics.js', 'levels.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'core', f), 'utf8'), ctx, { filename: f });
  }
  return ctx.BG;
}

// ------------------------------------------------------------------ determinism / no-op guarantee
test('levels without events are bit-identical to the engine without events.js', () => {
  const B0 = loadBaseline();
  assert(!B0.Forces && !B0.SimHooks, 'baseline engine must not have the forces module');
  const ids = BG.Levels.filter(l => !l.events).map(l => l.id).filter((id, i) => FULL || i % 5 === 0);
  let n = 0;
  for (const id of ids) {
    for (const best of FULL ? [false, true] : [false]) {
      const lv = level(id), d = solution(id, best);
      const a = runFull(BG.Simulation, lv, d), b = runFull(B0.Simulation, B0.Levels.find(l => l.id === id), d);
      assert(a._ext === null, 'no extension may attach to level ' + id);
      assert(fingerprint(a) === fingerprint(b), 'level ' + id + (best ? '-best' : '') + ' differs from the pristine engine');
      n++;
    }
  }
  assert(n >= 10, 'checked ' + n);
});

test('empty / unknown events attach nothing', () => {
  const lv = clone(level(5));
  for (const ev of [[], [{ type: 'meteor', start: 1 }], null]) {
    lv.events = ev;
    const sim = new BG.Simulation(lv, solution(5), { seed: 1 });
    assert(sim._ext === null && !sim.forces, 'events ' + JSON.stringify(ev) + ' attached an extension');
  }
});

test('event runs are deterministic, and the seed changes the quake signal', () => {
  const lv = level(52), d = solution(52, true);
  const a = runFull(BG.Simulation, lv, d), b = runFull(BG.Simulation, lv, d);
  assert(fingerprint(a) === fingerprint(b), 'two identical runs differ');
  const q = BG.Forces.normalize(lv.events)[0];
  const o1 = BG.Forces.groundOffset(Object.assign({}, q), 0, 12, 1), o2 = BG.Forces.groundOffset(Object.assign({}, q), 0, 12, 2);
  assert(o1.dx !== o2.dx, 'seed must change the displacement series');
});

test('sinDet matches Math.sin', () => {
  let worst = 0;
  for (let i = 0; i < 20000; i++) { const x = (i - 10000) * 0.0137; worst = Math.max(worst, Math.abs(BG.Forces.sinDet(x) - Math.sin(x))); }
  assert(worst < 1e-13, 'max error ' + worst);
});

// ------------------------------------------------------------------ API
test('normalize / timeline / labels / presets', () => {
  const evs = BG.Forces.normalize([{ type: 'quake', start: 9 }, { type: 'wind', start: 2, speed: 34, gust: 3, dir: -5 }, { type: 'earthquake', start: 1, magnitude: 7 }]);
  assert(evs.length === 3 && evs[0].start === 1 && evs[0].type === 'quake', 'sorted + earthquake alias');
  assert(evs[1].gust === 1.5 && evs[1].dir === -1, 'clamped gust, dir sign');
  approx(evs[0].pga, 0.2, 1e-9, 'M7 = 0.2 g');
  const tl = BG.Forces.timeline({ events: [{ type: 'wind', start: 5, duration: 10, speed: 34 }] });
  assert(tl[0].label === 'Hurricane 34 m/s' && tl[0].end === 15 && tl[0].warnAt === 2, JSON.stringify(tl[0]));
  assert(BG.Forces.label(BG.Forces.normalize([BG.Forces.presets.quake()])[0]) === 'Earthquake M7.0');
  const t = BG.Forces.normalize([BG.Forces.presets.tacoma({ period: [2.5, 1.7] })])[0];
  assert(Array.isArray(t.period) && t.lift > 0 && t.label.startsWith('Tacoma'), 'tacoma preset');
});

test('BG.Forces.attach == level.events', () => {
  const base = level(25), d = solution(25, true);
  const events = [BG.Forces.presets.gale({ start: 3, duration: 10 })];
  const a = runFull(BG.Simulation, Object.assign(clone(base), { events }), d);
  const s = new BG.Simulation(base, d, { seed: 1 });
  assert(BG.Forces.attach(s, events), 'attach returned a controller');
  assert(BG.Forces.attach(new BG.Simulation(base, d, { seed: 1 }), []) === null, 'attach([]) -> null');
  const maxSteps = Math.ceil((base.timeLimit + 0.5) * 60 - 1e-6);
  for (let i = 0; i < maxSteps && s.status === 'running'; i++) { s.step(); s.events.length = 0; }
  assert(fingerprint(a) === fingerprint(s), 'attach must behave exactly like level.events');
});

// ------------------------------------------------------------------ wind physics
test('wind: drag on a vertical member ~ 0.5 rho Cd D L v^2, along dir', () => {
  // a 6 m steel post standing on the left anchor, held by two stiff guys -> read the axial forces
  const lv = makeLevel(20, { anchors: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: -6, y: 0 }, { x: 6, y: 0 }], events: [{ type: 'wind', start: 2, duration: 30, speed: 30, gust: 0, dir: 1, lift: 0 }] });
  const d = { nodes: [{ id: 'n1', x: 0, y: 6 }], beams: [{ a: 'a0', b: 'n1', m: 'steel' }, { a: 'a2', b: 'n1', m: 'steel' }, { a: 'a3', b: 'n1', m: 'steel' }], piers: [] };
  const sim = new BG.Simulation(lv, d, { seed: 1 });
  stepN(sim, 1.9);
  const f0 = sim.beams[1].force - sim.beams[2].force;
  stepN(sim, 4);
  const f1 = sim.beams[1].force - sim.beams[2].force;
  // horizontal load on the top joint = half the drag of the post + ~half of each inclined guy's drag
  const k = BG.Forces.AERO.steel;
  const q = 0.5 * BG.Forces.AIR_DENSITY * 30 * 30;
  const expected = 0.5 * q * k.cd * k.depth * (6 + 6 + 6); // post (6 m) + two guys (6 m vertical projection each), half to the top
  // guys at 45°: horizontal equilibrium F = (T_left - T_right) * cos45
  const H = (f1 - f0) * Math.SQRT1_2;
  assert(H > 0, 'wind dir +1 must push the joint toward +x (left guy gains tension), got ' + H);
  approx(H, expected, expected * 0.25, 'horizontal wind load');
  assert(sim.forces.wind.active && Math.abs(sim.forces.wind.v - 30) < 1e-6, 'sim.forces.wind.v');
});

test('wind: a strong headwind slows traffic (a tailwind cannot beat cruise control)', () => {
  const lv = makeLevel(12, { traffic: [{ type: 'car', count: 1, interval: 1 }] });
  const d = { nodes: [], beams: [], piers: [{ x: 6, topY: 0 }] };
  // a road on a pier: a0 - p0 - a1
  d.beams.push({ a: 'a0', b: 'p0', m: 'reinforced_road' }, { a: 'p0', b: 'a1', m: 'reinforced_road' });
  const t = dir => runHeadless(Object.assign(clone(lv), { events: dir ? [{ type: 'wind', start: 0, duration: 60, speed: 42, gust: 0, dir, lift: 0 }] : [] }), d).time;
  const calm = t(0), head = t(-1), tail = t(1);
  assert(head > calm + 0.5 && tail <= calm + 0.05, `calm ${calm} head ${head} tail ${tail}`);
});

test('wind: turbulent gusts are smooth, bounded and convected along x', () => {
  const ev = BG.Forces.normalize([{ type: 'wind', start: 0, duration: 100, speed: 20, gust: 0.4 }])[0];
  let lo = Infinity, hi = -Infinity, jump = 0, prev = null;
  for (let t = 5; t < 95; t += 1 / 60) {
    const v = BG.Forces.windSpeed(ev, t, 1);
    lo = Math.min(lo, v); hi = Math.max(hi, v);
    if (prev !== null) jump = Math.max(jump, Math.abs(v - prev));
    prev = v;
  }
  assert(lo >= 20 * 0.6 - 1e-9 && hi <= 20 * 1.4 + 1e-9, `range ${lo}..${hi}`);
  assert(hi - lo > 6, 'gusts should vary the speed noticeably');
  assert(jump < 0.5, 'gusts must be smooth (max step ' + jump + ' m/s)');
  // frozen turbulence: the gust seen at x = 20 m is the one seen at x = 0, 1 s earlier (20 m / 20 m/s)
  approx(BG.Forces.windSpeed(ev, 31, 1, 20), BG.Forces.windSpeed(ev, 30, 1, 0), 1e-9, 'convected gust');
});

test('wind: swept period resonates a slender suspension deck (Tacoma), stiffening cures it', () => {
  const lv = level(53);
  const best = solution(53, true);
  // the same bridge without its diagonal hangers = a plain, slender suspension deck
  const all = new Map(BG.Model.allNodes(lv, best).map(n => [n.id, n]));
  const naive = clone(best);
  naive.beams = naive.beams.filter(b => !(b.m === 'rope' && Math.abs(all.get(b.a).x - all.get(b.b).x) > 0.01));
  assert(naive.beams.length < best.beams.length, 'removed the diagonal hangers');
  const calm = Object.assign(clone(lv), { events: [] });
  const rCalm = runHeadless(calm, naive), rWind = runHeadless(lv, naive), rBest = runHeadless(lv, best);
  assert(rCalm.status === 'success', 'slender deck passes in calm air: ' + rCalm.failReason);
  assert(rWind.status === 'failed' && rWind.firstBreak && rWind.firstBreak.mode === 'bending', 'slender deck must gallop to failure: ' + JSON.stringify(rWind.firstBreak));
  assert(rBest.status === 'success' && rBest.peakStress < 0.8, 'stiffened deck survives: ' + rBest.peakStress);
});

// ------------------------------------------------------------------ quake physics
test('quake: anchors follow the ground series; PGA, envelope, wave delay', () => {
  const lv = makeLevel(40, { events: [{ type: 'quake', start: 2, duration: 10, magnitude: 8, freq: 1.5 }] });
  const d = { nodes: [{ id: 'n1', x: 20, y: 2 }], beams: [{ a: 'a0', b: 'n1', m: 'steel' }, { a: 'n1', b: 'a1', m: 'steel' }], piers: [] };
  const sim = new BG.Simulation(lv, d, { seed: 1 });
  const ev = sim._ext[0].quakes[0];
  const xs = [], xr = [];
  let maxA = 0, starts = 0, ends = 0;
  for (let i = 0; i < 16 * 60; i++) {
    sim.step();
    for (const e of sim.events) { if (e.type === 'quake_start') starts++; if (e.type === 'quake_end') ends++; }
    sim.events.length = 0;
    xs.push(sim.px[0]); xr.push(sim.px[1]);
    approx(sim.px[0], 0 + BG.Forces.groundOffset(ev, 0, sim.time - 1 / 60 + 29 / 30 / 60, 1, 0).dx, 1e-9, 'anchor = last substep offset');
  }
  for (let i = 2; i < xs.length; i++) maxA = Math.max(maxA, Math.abs(xs[i] - 2 * xs[i - 1] + xs[i - 2]) * 3600);
  const pga = 0.4 * 9.81;
  assert(maxA > 0.6 * pga && maxA < 1.6 * pga, 'peak ground acceleration ' + maxA.toFixed(2) + ' vs ' + pga.toFixed(2));
  assert(xs[60] === 0 && xs[xs.length - 1] === 0, 'no motion before / after the quake');
  assert(starts === 1 && ends === 1, 'start/end events ' + starts + '/' + ends);
  // the far bank moves later (40 m at 300 m/s ~ 8 steps)
  const i0 = xs.findIndex(v => v !== 0), i1 = xr.findIndex(v => v !== 40);
  assert(i1 - i0 >= 6 && i1 - i0 <= 10, 'wave delay ' + (i1 - i0) + ' steps');
});

test('quake: terrain collider and piers move with the ground, then return', () => {
  const lv = clone(level(52));
  const d = solution(52); // has a pier
  const sim = new BG.Simulation(lv, d, { seed: 1 });
  const le0 = sim.terrain.leftEdge, fy0 = sim.terrain.floorY, px0 = sim.piers[0].x, g0 = sim.ground[2].ay;
  let moved = 0, pm = 0, gm = 0;
  for (let i = 0; i < 30 * 60; i++) {
    sim.step(); sim.events.length = 0;
    moved = Math.max(moved, Math.abs(sim.terrain.leftEdge - le0), Math.abs(sim.terrain.floorY - fy0));
    pm = Math.max(pm, Math.abs(sim.piers[0].x - px0)); gm = Math.max(gm, Math.abs(sim.ground[2].ay - g0));
  }
  assert(moved > 0.01 && pm > 0.01 && gm > 0.005, `terrain ${moved} pier ${pm} ground ${gm}`);
  assert(sim.terrain.leftEdge === le0 && sim.piers[0].x === px0, 'ground returns to rest after the quake');
});

test('quake: tossed traffic is not a "jump"; the quake loads the structure', () => {
  // level 20's best design bounces vans during an M8 quake: that must not count as a ramp jump
  const lv = Object.assign(clone(level(20)), { events: [{ type: 'quake', start: 8, duration: 12, magnitude: 8 }] });
  const r = runHeadless(lv, solution(20, true));
  assert(r.failReason !== 'vehicle_jumped', 'quake must not cause vehicle_jumped');
  // level 52's best truss survives the quake, but the shaking raises its peak stress well above calm air
  const best = solution(52, true);
  const rq = runHeadless(level(52), best), rc = runHeadless(Object.assign(clone(level(52)), { events: [] }), best);
  assert(rq.status === 'success', 'best design passes the quake');
  assert(rq.peakStress > rc.peakStress + 0.15, `quake peak ${rq.peakStress} vs calm ${rc.peakStress}`);
});

// ------------------------------------------------------------------ levels 51-53
test('bonus levels: hidden chapter ids, events, no template reaches 3 stars', () => {
  for (const id of [51, 52, 53]) {
    const lv = level(id);
    assert(lv && Array.isArray(lv.events) && lv.events.length, 'level ' + id + ' has events');
    for (const t of BG.Templates.list) {
      let d; try { d = BG.Templates.generate(t.id, lv, {}); } catch (e) { continue; }
      if (!d || !d.beams || !d.beams.length) continue;
      const r = runHeadless(lv, d);
      const three = r.status === 'success' && r.valid && r.cost <= 0.7 * lv.budget;
      assert(!three, `template ${t.id} reaches 3 stars on level ${id} (cost ${r.cost})`);
    }
  }
});

test('bonus levels: calm-weather control (events decide the outcome)', () => {
  // each level's lesson: a design that passes in calm air fails when the event hits
  const cases = [
    [51, () => solution(25, true)],                                     // plain road deck, cable stays
    [52, () => BG.Templates.generate('warren', level(52), {})],                // heavy reinforced deck truss
  ];
  for (const [id, mk] of cases) {
    const lv = level(id), d = mk();
    const calm = runHeadless(Object.assign(clone(lv), { events: [] }), d), storm = runHeadless(lv, d);
    assert(calm.status === 'success', id + ' calm should pass: ' + calm.failReason);
    assert(storm.status === 'failed', id + ' should fail when the event hits');
  }
});

test('performance: events cost < 35% extra and level 53 runs >= 4x realtime', () => {
  const lv = level(53), d = solution(53);
  const t0 = Date.now(); runHeadless(Object.assign(clone(lv), { events: [] }), d); const calm = Date.now() - t0;
  const t1 = Date.now(); const r = runHeadless(lv, d); const ev = Date.now() - t1;
  assert(ev < calm * 1.35 + 30, `with events ${ev} ms vs ${calm} ms`);
  assert(r.time * 1000 / ev >= 4, 'realtime factor ' + (r.time * 1000 / ev).toFixed(1));
});

// ------------------------------------------------------------------ run
let pass = 0, fail = 0;
const t0 = Date.now();
for (const t of tests) {
  if (filter && !t.name.includes(filter)) continue;
  const s = Date.now();
  try { t.fn(); pass++; console.log('PASS  ' + t.name + '  (' + (Date.now() - s) + ' ms)'); }
  catch (e) { fail++; console.log('FAIL  ' + t.name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e)); }
}
console.log(`\n${pass} passed, ${fail} failed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(fail ? 1 : 0);
