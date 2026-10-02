#!/usr/bin/env node
// SPAN — physics / model behaviour tests. Usage: node tools/test-physics.js [filter]
'use strict';
const { BG, runHeadless } = require('./harness');

// ------------------------------------------------------------------ tiny test runner
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function approx(a, b, tol, msg) { assert(Math.abs(a - b) <= tol, (msg || 'approx') + `: ${a} vs ${b} (tol ${tol})`); }

// ------------------------------------------------------------------ helpers
function makeLevel(gap, traffic, extra) {
  return Object.assign({
    id: 900, name: 'test', hint: '', theme: 'meadow',
    terrain: { leftEdge: 0, leftY: 0, rightEdge: gap, rightY: 0, floorY: -15, waterY: -12 },
    anchors: [{ x: 0, y: 0 }, { x: gap, y: 0 }, { x: 0, y: -4 }, { x: gap, y: -4 }],
    pierZones: [], maxPiers: 0, noBuild: [],
    buildArea: { x0: -30, x1: gap + 30, y0: -14, y1: 40 },
    materials: Object.keys(BG.Materials), budget: 1e9,
    traffic: traffic || [], timeLimit: 60, templates: false,
  }, extra || {});
}

function Builder(level) {
  const d = { nodes: [], beams: [], piers: [] };
  const map = new Map();
  const key = (x, y) => x.toFixed(3) + ',' + y.toFixed(3);
  (level.anchors || []).forEach((a, i) => map.set(key(a.x, a.y), 'a' + i));
  let k = 0;
  const api = {
    d,
    pier(x, topY) { d.piers.push({ x, topY }); const id = 'p' + (d.piers.length - 1); map.set(key(x, topY), id); return id; },
    node(x, y) { const kk = key(x, y); if (map.has(kk)) return map.get(kk); const id = 'n' + (++k); d.nodes.push({ id, x, y }); map.set(kk, id); return id; },
    beam(a, b, m) { if (a !== b && !d.beams.some(e => (e.a === a && e.b === b) || (e.a === b && e.b === a))) d.beams.push({ a, b, m }); return d.beams.length - 1; },
    line(x0, y0, x1, y1, n, m) {
      const ids = []; for (let i = 0; i <= n; i++) ids.push(api.node(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n));
      for (let i = 0; i < n; i++) api.beam(ids[i], ids[i + 1], m); return ids;
    },
    // Pratt through truss: road chord at y, top chord at y + h
    truss(x0, x1, y, n, h, road, frame) {
      const bot = api.line(x0, y, x1, y, n, road);
      const dx = (x1 - x0) / n, top = [];
      for (let i = 1; i < n; i++) top.push(api.node(x0 + dx * i, y + h));
      api.beam(bot[0], top[0], frame);
      for (let i = 0; i < top.length - 1; i++) api.beam(top[i], top[i + 1], frame);
      api.beam(top[top.length - 1], bot[n], frame);
      for (let i = 1; i < n; i++) api.beam(bot[i], top[i - 1], frame);
      for (let i = 1; i < n - 1; i++) { if (i < n / 2) api.beam(top[i - 1], bot[i + 1], frame); else api.beam(top[i], bot[i], frame); }
      return { bot, top };
    },
  };
  return api;
}

function run(level, design, maxTime, onStep) {
  const sim = new BG.Simulation(level, design, { seed: 1 });
  const steps = Math.ceil((maxTime || level.timeLimit) * 60);
  for (let i = 0; i < steps && sim.status === 'running'; i++) { sim.step(); if (onStep) onStep(sim); sim.events.length = 0; }
  return sim;
}

function allFinite(sim) {
  for (let i = 0; i < sim.nNodes; i++) if (!isFinite(sim.px[i]) || !isFinite(sim.py[i]) || !isFinite(sim.vx[i]) || !isFinite(sim.vy[i])) return false;
  for (const n of sim.nodes) if (!isFinite(n.x) || !isFinite(n.y)) return false;
  for (const b of sim.beams) if (!isFinite(b.force) || !isFinite(b.stress) || !isFinite(b.peak)) return false;
  for (const v of sim.vehicles) {
    if (!isFinite(v.x) || !isFinite(v.y) || !isFinite(v.angle)) return false;
    for (const w of v.wheels) if (!isFinite(w.x) || !isFinite(w.y) || !isFinite(w.rot)) return false;
  }
  return true;
}

function flatDeck(level, gap, nseg, m) { const b = Builder(level); b.line(0, 0, gap, 0, nseg, m || 'road'); return b.d; }

// ------------------------------------------------------------------ model
test('model: cost, ids, serialization roundtrip', () => {
  const L = makeLevel(12, [], { pierZones: [{ x0: 4, x1: 8 }], maxPiers: 1 });
  const b = Builder(L);
  b.pier(6, 0);
  b.line(0, 0, 12, 0, 2, 'road');
  const c = BG.Model.cost(L, b.d);
  assert(c.beams === 1200, 'road cost 12 m x $100 = 1200, got ' + c.beams);
  assert(c.piers === BG.Costs.pierBase + BG.Costs.pierPerMeter * 15, 'pier cost');
  assert(c.total === c.beams + c.piers, 'total');
  const all = BG.Model.allNodes(L, b.d);
  assert(all.find(n => n.id === 'a0').fixed && all.find(n => n.id === 'p0').fixed, 'anchors and piers fixed');
  assert(all.find(n => n.id === 'p0').x === 6, 'pier node position');
  const s = BG.Model.serialize(b.d);
  const back = BG.Model.deserialize(s);
  assert(JSON.stringify(BG.Model.clone(b.d)) === JSON.stringify(back), 'roundtrip');
  assert(BG.Model.deserialize('{garbage').nodes.length === 0, 'garbage -> empty design');
  approx(BG.Model.beamLength(L, b.d, b.d.beams[0]), 6, 1e-9, 'beamLength');
});

test('model: validation catches every error class', () => {
  const L = makeLevel(20, [], {
    materials: ['road', 'wood'], pierZones: [{ x0: 8, x1: 12 }], maxPiers: 1,
    noBuild: [{ x0: 14, x1: 16, y0: -3, y1: -1 }], buildArea: { x0: 0, x1: 20, y0: -8, y1: 8 },
  });
  const v0 = BG.Model.validate(L, flatDeck(L, 18, 3, 'road'));
  assert(v0.ok, 'clean design valid: ' + JSON.stringify(v0.errors));
  const d = {
    nodes: [{ id: 'n1', x: 10, y: 0 }, { id: 'n2', x: 30, y: 0 }, { id: 'n3', x: 15, y: -2 }, { id: 'n4', x: 10, y: 0.01 }, { id: 'n5', x: -2, y: -3 }],
    beams: [
      { a: 'a0', b: 'n1', m: 'road' },            // too long (10 m)
      { a: 'n1', b: 'n4', m: 'steel' },           // not allowed (+ length fine)
      { a: 'n1', b: 'a0', m: 'wood' },            // duplicate of #0 (and too long)
      { a: 'n1', b: 'n1', m: 'wood' },            // zero length
      { a: 'a1', b: 'n3', m: 'wood' },            // n3 in noBuild
      { a: 'a2', b: 'n9', m: 'wood' },            // missing node
      { a: 'a2', b: 'a3', m: 'unobtanium' },      // unknown material
    ],
    piers: [{ x: 3, topY: 0 }, { x: 10, topY: -2 }],
  };
  const v = BG.Model.validate(L, d);
  const types = new Set(v.errors.map(e => e.type));
  for (const t of ['too_long', 'material_not_allowed', 'duplicate_beam', 'zero_length', 'in_nobuild', 'missing_node',
    'unknown_material', 'outside_build_area', 'too_many_piers', 'pier_out_of_zone', 'in_terrain']) {
    assert(types.has(t), 'expected error ' + t + ' in ' + [...types].join(','));
  }
  assert(!v.ok, 'invalid');
  assert(v.errors.some(e => e.type === 'too_long' && e.beamIndex === 0), 'beamIndex reported');
  // beam crossing a no-build zone without a joint inside it
  const d2 = { nodes: [{ id: 'n1', x: 12, y: -2 }], beams: [{ a: 'n1', b: 'a3', m: 'wood' }], piers: [] };
  L.anchors[3] = { x: 20, y: -2 };
  assert(BG.Model.validate(L, d2).errors.some(e => e.type === 'in_nobuild'), 'segment through no-build zone');
});

// ------------------------------------------------------------------ determinism
test('determinism: same input -> identical summary and state', () => {
  const L = makeLevel(20, [{ type: 'van', count: 2, interval: 2 }, { type: 'bus', count: 1, interval: 3 }]);
  const b = Builder(L); b.truss(0, 20, 0, 5, 3, 'road', 'wood');
  const hash = sim => { let h = 0; for (let i = 0; i < sim.nNodes; i++) h = (h * 31 + Math.round(sim.px[i] * 1e9) + Math.round(sim.py[i] * 1e9) * 7) % 1e15; return h; };
  const s1 = run(L, b.d, 20), s2 = run(L, b.d, 20);
  assert(JSON.stringify(s1.summary()) === JSON.stringify(s2.summary()), 'summary differs');
  assert(hash(s1) === hash(s2) && s1.nNodes === s2.nNodes, 'state differs');
  for (let i = 0; i < s1.vehicles.length; i++) assert(s1.vehicles[i].x === s2.vehicles[i].x && s1.vehicles[i].angle === s2.vehicles[i].angle, 'vehicle pose differs');
  const r1 = runHeadless(L, b.d), r2 = runHeadless(L, b.d);
  delete r1.wallMs; delete r2.wallMs;
  assert(JSON.stringify(r1) === JSON.stringify(r2), 'runHeadless differs');
});

// ------------------------------------------------------------------ structure behaviour
test('flat road deck: sags under own weight, survives; snaps with a car (~12 m)', () => {
  const L0 = makeLevel(12, []);
  const d = flatDeck(L0, 12, 2);
  const s0 = run(L0, d, 4);
  const mid = s0.nodes[s0.nodeIndex.get('n1')];
  assert(s0.summary().brokenBeams === 0, 'dead load alone must not break the deck');
  assert(mid.y < -0.08, 'visible sag expected, got ' + mid.y.toFixed(3));
  const s = run(makeLevel(12, [{ type: 'car', count: 2, interval: 2.5 }]), d);
  const sum = s.summary();
  assert(sum.brokenBeams > 0, 'car must snap the flat deck');
  assert(sum.status === 'failed', 'level must fail, got ' + sum.status);
  // 14 m / 3 segments too
  const L14 = makeLevel(14, [{ type: 'car', count: 2, interval: 2.5 }]);
  const s3 = run(L14, flatDeck(L14, 14, 3));
  assert(s3.summary().status === 'failed' && s3.summary().brokenBeams > 0, '14 m flat deck must fail');
  // single 6 m segment is fine
  const L6 = makeLevel(6, [{ type: 'car', count: 2, interval: 2.5 }]);
  const s1 = run(L6, flatDeck(L6, 6, 1));
  assert(s1.summary().status === 'success', 'single short road segment must carry cars');
});

test('wood truss carries cars over 12-20 m and clearly beats a flat deck', () => {
  for (const [gap, n, h] of [[12, 3, 3], [16, 4, 3], [20, 5, 3.5]]) {
    const L = makeLevel(gap, [{ type: 'car', count: 3, interval: 2 }]);
    const b = Builder(L); b.truss(0, gap, 0, n, h, 'road', 'wood');
    const r = runHeadless(L, b.d);
    assert(r.status === 'success', `wood truss ${gap} m failed: ${r.failReason}`);
    assert(r.peakStress < 0.8, `wood truss ${gap} m peak ${r.peakStress}`);
    assert(r.valid, 'truss design valid');
  }
  const L = makeLevel(12, []);
  const flat = run(L, flatDeck(L, 12, 3), 4).summary().peakStress;
  const b = Builder(L); b.truss(0, 12, 0, 3, 3, 'road', 'wood');
  const truss = run(L, b.d, 4).summary().peakStress;
  assert(truss < flat * 0.5, `truss peak ${truss} should be far below flat deck ${flat}`);
});

test('steel truss carries buses over 30-40 m; wood truss cannot carry a bus', () => {
  for (const [gap, n, h] of [[30, 6, 5], [40, 8, 6]]) {
    const L = makeLevel(gap, [{ type: 'bus', count: 2, interval: 3 }]);
    const b = Builder(L); b.truss(0, gap, 0, n, h, 'road', 'steel');
    const r = runHeadless(L, b.d);
    assert(r.status === 'success' && r.peakStress < 0.85, `steel ${gap} m: ${r.status} ${r.peakStress}`);
  }
  const L = makeLevel(20, [{ type: 'bus', count: 1, interval: 3 }]);
  const b = Builder(L); b.truss(0, 20, 0, 5, 4, 'road', 'wood');
  assert(runHeadless(L, b.d).status === 'failed', 'wood truss must not carry a bus');
});

test('tension-only cable goes slack in compression, carries tension', () => {
  const L = makeLevel(10, [], { anchors: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -3 }, { x: 5, y: 6 }] });
  const b = Builder(L);
  const r = b.line(0, 0, 10, 0, 2, 'road');
  const below = b.beam('a2', r[1], 'cable');   // pushed: deck node moves toward it
  const above = b.beam('a3', r[1], 'cable');   // pulled: holds the deck up
  const sim = run(L, b.d, 4);
  const cb = sim.beams[below], ca = sim.beams[above];
  assert(ca.force > 1000 && ca.stress > 0, 'upper cable should be in tension, force ' + ca.force);
  assert(cb.force === 0 && cb.stress === 0, 'lower cable must be slack, force ' + cb.force);
  // a strut made of cable cannot hold anything up: compare with wood strut
  const L2 = makeLevel(12, [], { anchors: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 6, y: -3 }] });
  const mk = m => { const bb = Builder(L2); const rr = bb.line(0, 0, 12, 0, 2, 'road'); bb.beam('a2', rr[1], m); return bb.d; };
  const sw = run(L2, mk('wood'), 4), sc = run(L2, mk('cable'), 4);
  const yW = sw.nodes[sw.nodeIndex.get('n1')].y, yC = sc.nodes[sc.nodeIndex.get('n1')].y;
  assert(yW > -0.05 && yC < yW - 0.05, `wood strut holds (${yW.toFixed(3)}), cable strut does not (${yC.toFixed(3)})`);
  assert(sc.beams[2].force === 0, 'compressed cable carries zero force');
  const sr = run(L2, mk('rope'), 4);
  assert(sr.beams[2].force === 0 && sr.nodes[sr.nodeIndex.get('n1')].y < yW - 0.05, 'rope strut is slack too');
});

test('deck arch works in compression and carries buses', () => {
  const gap = 30, rise = 8, n = 6;
  const L = makeLevel(gap, [{ type: 'bus', count: 2, interval: 3 }], { anchors: [{ x: 0, y: 0 }, { x: gap, y: 0 }, { x: 0, y: -rise }, { x: gap, y: -rise }] });
  L.terrain.floorY = -rise - 8; L.terrain.waterY = -rise - 5;
  const b = Builder(L);
  const road = b.line(0, 0, gap, 0, n, 'road');
  const ay = x => -rise + (rise - 0.8) * (1 - Math.pow((x - gap / 2) / (gap / 2), 2));
  const arch = ['a2'], archBeams = [];
  for (let i = 1; i < n; i++) { const id = b.node(gap * i / n, ay(gap * i / n)); archBeams.push(b.beam(arch[i - 1], id, 'steel')); b.beam(id, road[i], 'steel'); arch.push(id); }
  archBeams.push(b.beam(arch[n - 1], 'a3', 'steel')); arch.push('a3');
  b.beam('a2', road[1], 'steel'); b.beam('a3', road[n - 1], 'steel');
  for (let i = 1; i < n - 1; i++) { if (i < n / 2) b.beam(arch[i], road[i + 1], 'steel'); else b.beam(arch[i + 1], road[i], 'steel'); }
  let deadMax = -Infinity, minSum = 0, maxSum = -Infinity;
  const sim = run(L, b.d, 60, s => {
    if (s.time < 1.5) return;
    let sum = 0;
    for (const j of archBeams) { sum += s.beams[j].force; if (s.time < 2.4) deadMax = Math.max(deadMax, s.beams[j].force); }
    minSum = Math.min(minSum, sum); maxSum = Math.max(maxSum, sum);
  });
  assert(sim.status === 'success', 'arch bridge should pass, got ' + sim.status + ' ' + sim.failReason);
  assert(deadMax < 0, 'every arch rib is compressed under dead load, max ' + deadMax.toFixed(0));
  assert(maxSum < 0 && minSum < -400e3, `arch as a whole stays in compression and takes the bus load (sum ${(minSum / 1e3).toFixed(0)}..${(maxSum / 1e3).toFixed(0)} kN)`);
});

test('suspension bridge from pier towers carries semis over 100 m', () => {
  const gap = 100, tx = 10, th = 22, sagY = 4, sp = 5;
  const L = makeLevel(gap, [{ type: 'semi', count: 2, interval: 3 }], {
    pierZones: [{ x0: 0, x1: gap }], maxPiers: 2, timeLimit: 90,
    anchors: [{ x: 0, y: 0 }, { x: gap, y: 0 }, { x: -20, y: 0 }, { x: gap + 20, y: 0 }],
  });
  L.terrain.floorY = -20; L.terrain.waterY = -16;
  const b = Builder(L);
  const tl = b.pier(tx, th), tr = b.pier(gap - tx, th);
  b.line(0, 0, gap, 0, gap / sp, 'reinforced_road');
  const cy = x => sagY + (th - sagY) * Math.pow((x - gap / 2) / (gap / 2 - tx), 2);
  let prev = tl;
  for (let x = tx + sp; x < gap - tx - 1e-6; x += sp) { const c = b.node(x, cy(x)); b.beam(prev, c, 'cable'); prev = c; b.beam(c, b.node(x, 0), 'cable'); }
  b.beam(prev, tr, 'cable');
  b.beam('a2', tl, 'cable'); b.beam('a3', tr, 'cable');
  for (let x = sp; x <= tx + 1e-6; x += sp) { b.beam(tl, b.node(x, 0), 'cable'); b.beam(tr, b.node(gap - x, 0), 'cable'); }
  // shallow steel stiffening truss above the deck
  for (let x = sp; x < gap; x += sp) {
    const t = b.node(x, 3); b.beam(b.node(x, 0), t, 'steel');
    if (x + sp < gap) b.beam(t, b.node(x + sp, 3), 'steel');
    b.beam(t, x < gap / 2 ? (x + sp === gap ? 'a1' : b.node(x + sp, 0)) : b.node(x - sp, 0), 'steel');
  }
  b.beam('a0', b.node(sp, 3), 'steel'); b.beam(b.node(gap - sp, 3), 'a1', 'steel');
  const r = runHeadless(L, b.d);
  assert(r.valid, 'suspension design valid: ' + r.errors.map(e => e.type).join(','));
  assert(r.status === 'success', 'semis should cross the suspension bridge: ' + r.failReason + ' peak ' + r.peakStress);
});

test('60 t heavy vehicle collapses a bridge that carries cars (dramatic, finite)', () => {
  const L = makeLevel(20, [{ type: 'car', count: 2, interval: 2 }]);
  const b = Builder(L); b.truss(0, 20, 0, 5, 3.5, 'road', 'wood');
  assert(runHeadless(L, b.d).status === 'success', 'cars should pass');
  L.traffic = [{ type: 'heavy', count: 1, interval: 2 }];
  let breaks = 0, falls = 0, splashes = 0, maxV = 0;
  const sim = new BG.Simulation(L, b.d);
  for (let i = 0; i < 60 * 25; i++) {
    sim.step();
    for (const e of sim.drainEvents()) {
      if (e.type === 'break') { breaks++; assert(typeof e.beamIndex === 'number' && isFinite(e.x) && isFinite(e.y) && e.m, 'break event shape'); }
      if (e.type === 'vehicle_fall') falls++;
      if (e.type === 'splash') splashes++;
    }
    for (let k = 0; k < sim.nNodes; k++) maxV = Math.max(maxV, Math.hypot(sim.vx[k], sim.vy[k]));
  }
  const s = sim.summary();
  assert(s.status === 'failed' && s.failReason === 'vehicle_fell', 'heavy should fall: ' + JSON.stringify(s));
  assert(breaks >= 3 && s.brokenBeams >= 3, 'multiple beams should break');
  assert(falls === 1 && splashes >= 1, 'fall + splash events');
  assert(allFinite(sim), 'no NaN after collapse');
  assert(maxV <= 60.0001, 'velocities clamped, max ' + maxV);
  assert(sim.beams.some(bm => bm.fragment), 'broken beams leave dangling fragments');
  assert(sim.vehicles[0].state === 'fallen', 'vehicle state fallen');
});

// ------------------------------------------------------------------ vehicles
test('vehicles cross flat ground at cruise speed without bouncing', () => {
  const L = makeLevel(0, [{ type: 'car', count: 2, interval: 2 }, { type: 'truck', count: 1, interval: 2 }, { type: 'heavy', count: 1, interval: 2 }]);
  L.terrain.rightEdge = 0; L.anchors = [{ x: 0, y: 0 }];
  let maxVy = 0, maxDy = 0;
  const sim = run(L, { nodes: [], beams: [], piers: [] }, 60, s => {
    for (const v of s.vehicles) if (v.state === 'driving' && s.time > 0.5) { maxVy = Math.max(maxVy, Math.abs(v._vy)); maxDy = Math.max(maxDy, Math.abs(v.y)); }
  });
  const s = sim.summary();
  assert(s.status === 'success' && s.vehiclesFinished === 4, 'all vehicles finish: ' + JSON.stringify(s));
  assert(maxVy < 0.05, 'no bouncing on flat ground, max |vy| ' + maxVy);
  assert(maxDy < 0.12, 'stays on the ground line, max |y| ' + maxDy);
  approx(sim.vehicles[0].vx, BG.Vehicles.car.speed, 0.05, 'car cruise speed');
});

test('smooth over joint seams, climbs 15 degree slopes, no tunnelling', () => {
  const gap = 40, slope = 15 * Math.PI / 180;
  const prof = x => (x <= 20 ? x : 40 - x) * Math.tan(slope);
  const anchors = [{ x: 0, y: 0 }, { x: gap, y: 0 }];
  for (let x = 2; x < gap; x += 2) anchors.push({ x, y: prof(x) });
  const mk = (veh, flat) => {
    const L = makeLevel(gap, [{ type: veh, count: 2, interval: 2 }], { anchors: flat ? anchors.map(a => ({ x: a.x, y: 0 })) : anchors });
    const ids = ['a0']; for (let i = 2; i < anchors.length; i++) ids.push('a' + i); ids.push('a1');
    const d = { nodes: [], beams: [], piers: [] };
    for (let i = 0; i < ids.length - 1; i++) d.beams.push({ a: ids[i], b: ids[i + 1], m: 'road' });
    return { L, d };
  };
  // flat seams every 2 m: perfectly smooth
  {
    const { L, d } = mk('car', true);
    let maxVy = 0;
    const sim = run(L, d, 30, s => { const v = s.vehicles[0]; if (v.state === 'driving') maxVy = Math.max(maxVy, Math.abs(v._vy)); });
    assert(sim.status === 'success', 'flat seams pass');
    assert(maxVy < 0.05, 'seams must be smooth, max |vy| ' + maxVy);
  }
  for (const veh of ['car', 'bus', 'semi', 'heavy']) {
    const { L, d } = mk(veh, false);
    let minV = Infinity, minClear = Infinity;
    const sim = run(L, d, 60, s => {
      const v = s.vehicles[0];
      if (v.state !== 'driving') return;
      minV = Math.min(minV, Math.hypot(v._vx, v._vy));
      for (const w of v.wheels) if (w.x > 0.5 && w.x < 39.5) minClear = Math.min(minClear, w.y - prof(w.x) * Math.cos(0) - 0);
    });
    assert(sim.status === 'success', veh + ' must climb 15 deg: ' + sim.failReason);
    assert(minV > BG.Vehicles[veh].speed * 0.5, veh + ' keeps speed on slope, min ' + minV.toFixed(2));
    assert(minClear > 0.1, veh + ' wheel centres stay above the deck (no tunnelling), min ' + minClear.toFixed(3));
  }
});

test('wheel load transfers to the beam end joints', () => {
  // car parked mid-span on a short bridge: reactions must appear in supporting struts
  const L = makeLevel(12, [{ type: 'car', count: 1, interval: 2 }], { anchors: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 6, y: -4 }] });
  const b = Builder(L); const r = b.line(0, 0, 12, 0, 2, 'road'); const post = b.beam('a2', r[1], 'wood');
  let maxPost = 0, base = 0;
  run(L, b.d, 8, s => { const f = -s.beams[post].force; if (s.time < 1.8) base = f; maxPost = Math.max(maxPost, f); });
  // dead load of deck on the post ~ 6 m road * 120 kg/m * g ~ 7 kN; car adds ~ 5-12 kN
  assert(base > 5e3 && base < 10e3, 'post dead load ' + base.toFixed(0));
  assert(maxPost - base > 4e3, 'car weight reaches the post: +' + (maxPost - base).toFixed(0) + ' N');
});

// ------------------------------------------------------------------ robustness
test('stability: pathological design never produces NaN', () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const L = makeLevel(30, [{ type: 'heavy', count: 2, interval: 1 }, { type: 'car', count: 3, interval: 0.5 }, { type: 'semi', count: 1, interval: 1 }]);
  const d = { nodes: [], beams: [], piers: [] };
  const ids = ['a0', 'a1', 'a2', 'a3'];
  const pos = { a0: [0, 0], a1: [30, 0], a2: [0, -4], a3: [30, -4] };
  for (let i = 1; i <= 70; i++) {
    const x = i < 5 ? 15 : rnd() * 30, y = i < 5 ? 0 : (rnd() - 0.6) * 12; // first few coincident joints
    d.nodes.push({ id: 'n' + i, x, y }); ids.push('n' + i); pos['n' + i] = [x, y];
  }
  const mats = Object.keys(BG.Materials);
  const seen = new Set();
  for (let k = 0; k < 400 && d.beams.length < 260; k++) {
    const a = ids[Math.floor(rnd() * ids.length)], b2 = ids[Math.floor(rnd() * ids.length)];
    if (a === b2) continue;
    const key = a < b2 ? a + b2 : b2 + a; if (seen.has(key)) continue; seen.add(key);
    d.beams.push({ a, b: b2, m: mats[Math.floor(rnd() * mats.length)] });
  }
  d.beams.push({ a: 'n1', b: 'n2', m: 'road' });     // zero-length (coincident joints)
  d.beams.push({ a: 'n3', b: 'n3', m: 'steel' });    // self loop
  d.beams.push({ a: 'n4', b: 'n999', m: 'wood' });   // dangling reference
  d.beams.push({ a: 'a0', b: 'a1', m: 'cable' });    // anchor to anchor
  const sim = new BG.Simulation(L, d);
  let maxV = 0;
  for (let i = 0; i < 60 * 30; i++) {
    sim.step(); sim.drainEvents();
    for (let k = 0; k < sim.nNodes; k++) maxV = Math.max(maxV, Math.hypot(sim.vx[k], sim.vy[k]));
    if (i % 60 === 0) assert(allFinite(sim), 'NaN/Infinity at t=' + sim.time.toFixed(2));
  }
  assert(allFinite(sim), 'finite at end');
  assert(maxV <= 60.0001, 'velocity clamp respected: ' + maxV);
  const summ = sim.summary();
  assert(['running', 'success', 'failed'].includes(summ.status) && isFinite(summ.peakStress), 'summary sane');
  // empty design + empty level objects must not throw
  const e = new BG.Simulation({}, {}); for (let i = 0; i < 30; i++) e.step();
  assert(allFinite(e), 'empty sim finite');
});

test('performance: 300-beam bridge, 6 vehicles, 60 s sim time well under 30 s wall (>= 4x realtime)', () => {
  const gap = 150;
  const L = makeLevel(gap, [{ type: 'truck', count: 3, interval: 3 }, { type: 'bus', count: 3, interval: 3 }], { pierZones: [{ x0: 1, x1: 149 }], maxPiers: 10, timeLimit: 120 });
  const b = Builder(L);
  for (const x of [30, 60, 90, 120]) b.pier(x, 0);
  const t = b.truss(0, gap, 0, 60, 4, 'reinforced_road', 'steel');
  for (let i = 1; i < 59; i++) { if (i < 30) b.beam(t.top[i], t.bot[i], 'steel'); else b.beam(t.top[i - 1], t.bot[i + 1], 'steel'); }
  assert(b.d.beams.length >= 290, 'beams ' + b.d.beams.length);
  const sim = new BG.Simulation(L, b.d);
  const t0 = Date.now();
  let active = 0;
  while (sim.time < 60) { sim.step(); sim.events.length = 0; active = Math.max(active, sim.vehicles.filter(v => v.state === 'driving').length); }
  const wall = (Date.now() - t0) / 1000;
  const factor = 60 / wall;
  console.log(`      ${b.d.beams.length} beams, ${sim.vehicles.length} vehicles (max ${active} on road at once): 60 s in ${wall.toFixed(2)} s wall = ${factor.toFixed(1)}x realtime`);
  assert(factor >= 4, 'too slow: ' + factor.toFixed(1) + 'x');
  assert(allFinite(sim), 'finite');
});

test('events: finish events, creak near limit, drainEvents clears', () => {
  const L = makeLevel(12, [{ type: 'car', count: 2, interval: 2 }]);
  const b = Builder(L); b.truss(0, 12, 0, 3, 3, 'road', 'wood');
  const sim = new BG.Simulation(L, b.d);
  const seen = [];
  while (sim.status === 'running' && sim.time < 30) { sim.step(); for (const e of sim.drainEvents()) seen.push(e); }
  assert(sim.events.length === 0, 'drained');
  assert(seen.filter(e => e.type === 'vehicle_finish').map(e => e.i).join() === '0,1', 'finish events in order');
  assert(sim.status === 'success' && sim.summary().vehiclesFinished === 2, 'success');
  // creak: flat 12 m deck under dead load + car approaches the limit
  const s2 = new BG.Simulation(makeLevel(12, [{ type: 'car', count: 1, interval: 2 }]), flatDeck(L, 12, 2));
  let creak = false;
  for (let i = 0; i < 600; i++) { s2.step(); if (s2.drainEvents().some(e => e.type === 'creak' && e.stress > 0.8)) creak = true; }
  assert(creak, 'creak emitted before snapping');
});

test('exploits: finely cut road decks are not stiffer/cheaper than a supported deck', () => {
  // 14 m road-only deck under cars: every segment length must fail (deck bending no longer depends on cut density)
  const L = makeLevel(14, [{ type: 'car', count: 2, interval: 2.5 }, { type: 'van', count: 1, interval: 3 }]);
  for (const n of [56, 28, 14, 7, 3]) {
    const r = runHeadless(L, flatDeck(L, 14, n));
    assert(r.status === 'failed', 'road-only deck cut into ' + n + ' pieces must fail, got ' + r.status);
  }
  // bend link stiffness scales for short segments
  const s = new BG.Simulation(L, flatDeck(L, 14, 28), {});
  const ref = 1 / BG.Materials.road.bendStiffness;
  assert(s.lcompl[0] < ref * 0.2, 'short-segment link is stiffer (' + s.lcompl[0] + ' vs ' + ref + ')');
  const s2 = new BG.Simulation(makeLevel(15), flatDeck(makeLevel(15), 15, 3), {});
  approx(s2.lcompl[0], ref, 1e-12, '5 m segments keep the base stiffness');
});

test('exploits: ramps / unconnected roads cannot pass; first break is reported', () => {
  const L = makeLevel(10, [{ type: 'car', count: 2, interval: 2.5 }], { anchors: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: -2.5 }, { x: 10, y: -2.5 }] });
  const ramp = { nodes: [{ id: 'n1', x: 3.5, y: 1.75 }], beams: [{ a: 'a0', b: 'n1', m: 'road' }, { a: 'a2', b: 'n1', m: 'wood' }], piers: [] };
  assert(!BG.Model.roadConnected(L, ramp), 'ramp road is not connected');
  const r = runHeadless(L, ramp);
  assert(r.status === 'failed' && (r.failReason === 'vehicle_jumped' || r.failReason === 'vehicle_fell'), 'ramp jump must fail, got ' + r.status + '/' + r.failReason);
  const L12 = makeLevel(12, [{ type: 'car', count: 2, interval: 2.5 }]);
  const flat = flatDeck(L12, 12, 2);
  assert(BG.Model.roadConnected(L12, flat), 'flat deck is connected');
  const f = runHeadless(L12, flat);
  assert(f.status === 'failed' && f.firstBreak && f.firstBreak.m === 'road' && f.firstBreak.mode === 'bending', 'unsupported deck reports a bending failure: ' + JSON.stringify(f.firstBreak));
});

test('stalled traffic ends the run early', () => {
  // (physics only - the members are longer than the editor allows) a 5.5 m high peak the bus cannot climb: vehicles stop; the run ends with 'stalled' long before the 60 s limit
  const L = makeLevel(12, [{ type: 'bus', count: 1, interval: 2 }], { timeLimit: 60 });
  const b = Builder(L);
  const top = b.node(6, 5.5);
  b.beam('a0', top, 'reinforced_road'); b.beam(top, 'a1', 'reinforced_road');
  b.beam('a2', top, 'steel'); b.beam('a3', top, 'steel');
  const r = runHeadless(L, b.d);
  assert(r.status === 'failed' && r.failReason === 'stalled', 'got ' + r.status + '/' + r.failReason + ' at ' + r.time);
  assert(r.time < 20, 'stall detected early (' + r.time + ' s)');
});

test('model: joints keep clear of rock, beams may not pass through it', () => {
  const L = makeLevel(20);
  const v = (nodes, beams) => BG.Model.validate(L, { nodes, beams, piers: [] });
  assert(v([{ id: 'n1', x: 0, y: -6 }], [{ a: 'a0', b: 'n1', m: 'steel' }]).errors.some(e => e.type === 'near_terrain'), 'joint on the cliff face');
  assert(v([{ id: 'n1', x: 5, y: -14.8 }], [{ a: 'a2', b: 'n1', m: 'steel' }]).errors.some(e => e.type === 'near_terrain'), 'joint resting on the floor');
  assert(v([{ id: 'n1', x: 1, y: -6 }], [{ a: 'a0', b: 'n1', m: 'steel' }, { a: 'a2', b: 'n1', m: 'steel' }]).ok, 'joint 1 m off the face is fine');
  assert(v([{ id: 'n1', x: 2, y: -6 }], [{ a: 'n1', b: 'a0', m: 'steel' }, { a: 'n1', b: 'a2', m: 'steel' }, { a: 'a2', b: 'a0', m: 'steel' }]).ok, 'beam along the cliff face between bolts is fine');
  const thru = { nodes: [{ id: 'n1', x: 3, y: -6 }], beams: [{ a: 'n1', b: 'a0', m: 'steel' }], piers: [] };
  const L2 = makeLevel(20, [], { anchors: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: -5, y: 0 }] });
  thru.beams.push({ a: 'n1', b: 'a2', m: 'steel' });
  assert(BG.Model.validate(L2, thru).errors.some(e => e.type === 'in_terrain' && e.beamIndex === 1), 'beam from a bank-top anchor through the bank');
});

// ------------------------------------------------------------------ railway (SPEC §9)
const trainTraffic = (train, count, interval) => [{ type: 'train', train, count: count || 1, interval: interval || 3 }];

/** Pratt deck truss under a rail deck at y=0, X-braced panels; bottom chord at -h between anchors a2/a3. */
function railTruss(train, gap, panel, h, chord, web, piers, extra) {
  const L = makeLevel(gap, trainTraffic(train), Object.assign({
    anchors: [{ x: 0, y: 0 }, { x: gap, y: 0 }, { x: 0, y: -h }, { x: gap, y: -h }],
    pierZones: [{ x0: 1, x1: gap - 1 }], maxPiers: 9, timeLimit: 120,
  }, extra || {}));
  L.terrain.floorY = -h - 15; L.terrain.waterY = -h - 11;
  const b = Builder(L);
  for (const x of piers || []) b.pier(x, -h);
  const n = Math.round(gap / panel);
  const top = b.line(0, 0, gap, 0, n, 'rail'), bot = b.line(0, -h, gap, -h, n, chord);
  for (let i = 1; i < n; i++) b.beam(top[i], bot[i], web);
  for (let i = 0; i < n; i++) { b.beam(top[i], bot[i + 1], web); b.beam(bot[i], top[i + 1], web); }
  return { L, b, top, bot };
}

/** Masonry arch viaduct: arches spring from a2/a3 and pier tops at y=spring, masonry posts carry the rail at y=0. */
function railViaduct(train, gap, piers, spring, rise, diag, count) {
  const L = makeLevel(gap, trainTraffic(train, count, 4), {
    anchors: [{ x: 0, y: 0 }, { x: gap, y: 0 }, { x: 0, y: spring }, { x: gap, y: spring }],
    pierZones: [{ x0: 1, x1: gap - 1 }], maxPiers: piers.length,
  });
  L.terrain.floorY = -16; L.terrain.waterY = -13;
  const b = Builder(L);
  const springs = ['a2'].concat(piers.map(x => b.pier(x, spring)), ['a3']);
  const sx = [0].concat(piers, [gap]);
  const deckX = new Set(sx), arches = [];
  for (let s = 0; s + 1 < sx.length; s++) {
    const x0 = sx[s], S = sx[s + 1] - x0, n = 4, arch = [{ id: springs[s], x: x0, y: spring }];
    for (let i = 1; i < n; i++) {
      const x = x0 + S * i / n, u = (x - x0 - S / 2) / (S / 2), y = Math.round((spring + rise * (1 - u * u)) * 4) / 4;
      arch.push({ id: b.node(x, y), x, y }); deckX.add(x);
    }
    arch.push({ id: springs[s + 1], x: sx[s + 1], y: spring });
    arches.push(arch);
  }
  const xs = [...deckX].sort((p, q) => p - q);
  for (let i = 0; i + 1 < xs.length; i++) b.beam(b.node(xs[i], 0), b.node(xs[i + 1], 0), 'rail');
  for (const arch of arches) {
    for (let i = 0; i + 1 < arch.length; i++) b.beam(arch[i].id, arch[i + 1].id, 'masonry');
    for (let i = 1; i + 1 < arch.length; i++) b.beam(arch[i].id, b.node(arch[i].x, 0), 'masonry');
    if (diag) for (let i = 0; i + 1 < arch.length; i++) {
      if (i < (arch.length - 1) / 2) b.beam(arch[i].id, b.node(arch[i + 1].x, 0), diag);
      else b.beam(arch[i + 1].id, b.node(arch[i].x, 0), diag);
    }
  }
  piers.forEach((x, k) => b.beam('p' + k, b.node(x, 0), 'masonry'));
  return { L, d: b.d };
}

function couplerDev(T) {
  let dev = 0;
  for (let k = 0; k + 1 < T.cars.length; k++) {
    const A = T.cars[k], B = T.cars[k + 1];
    if (!A._sim || !B._sim) continue;
    const ax = A._px + A._qc * A._cxR - A._qs * A._chY, ay = A._py + A._qs * A._cxR + A._qc * A._chY;
    const bx = B._px + B._qc * B._cxF - B._qs * B._chY, by = B._py + B._qs * B._cxF + B._qc * B._chY;
    dev = Math.max(dev, Math.abs(Math.hypot(ax - bx, ay - by) - BG.RailRules.couplerGap));
  }
  return dev;
}

test('rail: definitions - car masses, presets ~1 t .. ~2000 t, sim.vehicles kinds', () => {
  for (const id of BG.RailCarOrder) {
    const c = BG.RailCars[id];
    assert(c && c.type === id && c.bogies.length >= 1 && c.wheels.length >= 2, 'car ' + id);
    approx(c.bogies.reduce((s, bg) => s + bg.mass, 0), c.mass, 1e-9, id + ' bogie masses sum to car mass');
  }
  for (const id of BG.TrainOrder) {
    const T = BG.Trains[id];
    assert(T && T.id === id && T.cars.length === T.carCount && T.speed > 0 && T.cars.every(t => BG.RailCars[t]), 'preset ' + id);
    assert(BG.RailCars[T.cars[0]].power, id + ' is led by a powered car');
  }
  approx(BG.Trains.handcar.mass, 1000, 200, 'handcar ~1 t');
  approx(BG.Trains.ore.mass, 2.0e6, 0.1e6, 'ore ~2000 t');
  assert(BG.Trains.ore.carCount === 24, 'ore train has 24 cars');
  const L = makeLevel(10, [{ type: 'car', count: 1 }, { type: 'train', train: 'steam_local', count: 1 }, { type: 'train', train: 'nope' }]);
  const sim = new BG.Simulation(L, flatDeck(L, 10, 2));
  assert(sim.vehicles.length === 2 && sim.vehicles[0].kind === 'road' && sim.vehicles[1].kind === 'train', 'kinds: ' + sim.vehicles.map(v => v.kind));
  const T = sim.vehicles[1];
  assert(T.type === 'train' && T.preset === 'steam_local' && T.cars.length === 4 && T.cars[0].type === 'loco_steam' && T.state === 'waiting', 'train entry shape');
  assert(T.cars[0].wheels.length === BG.RailCars.loco_steam.wheels.length && T.cars.every(c => c.state === 'waiting'), 'car entries');
});

test('rail: trains cross flat ground at cruise speed, wheels stay on the rail line', () => {
  for (const id of ['handcar', 'steam_local', 'freight_long', 'ore', 'highspeed']) {
    const L = makeLevel(0, trainTraffic(id), { timeLimit: 120 });
    L.terrain.rightEdge = 0; L.anchors = [{ x: 0, y: 0 }];
    let maxVy = 0, maxDy = 0, minV = Infinity;
    const sim = run(L, { nodes: [], beams: [], piers: [] }, 120, s => {
      const T = s.vehicles[0];
      if (T.state !== 'driving' || s.time < 0.5) return;
      for (const c of T.cars) {
        maxVy = Math.max(maxVy, Math.abs(c._vy)); minV = Math.min(minV, c._vx);
        for (const w of c.wheels) maxDy = Math.max(maxDy, Math.abs(w.y - w.r));
      }
    });
    const s = sim.summary();
    assert(s.status === 'success' && s.vehiclesFinished === 1 && s.derailedCars === 0, id + ': ' + JSON.stringify(s));
    assert(maxVy < 0.02, id + ' no bouncing, max |vy| ' + maxVy);
    assert(maxDy < 0.06, id + ' wheels sit on the rail line, max dev ' + maxDy.toFixed(3));
    approx(minV, BG.Trains[id].speed, 0.05, id + ' holds cruise speed');
    assert(sim.vehicles[0].cars.every(c => c.state === 'finished'), id + ' all cars finished');
  }
});

test('rail: couplers hold (slack only) while a train brakes hard behind another', () => {
  const L = makeLevel(0, trainTraffic('ore', 2, 0.5), { timeLimit: 120 });
  L.terrain.rightEdge = 0; L.anchors = [{ x: 0, y: 0 }];
  let dev = 0, minSpeed2 = Infinity, braking = false;
  const slack = BG.RailRules.couplerSlack;
  run(L, { nodes: [], beams: [], piers: [] }, 70, s => {
    for (const T of s.vehicles) if (T._live) dev = Math.max(dev, couplerDev(T));
    const T2 = s.vehicles[1];
    if (T2.state === 'driving') { minSpeed2 = Math.min(minSpeed2, T2.vx); if (T2._target < BG.Trains.ore.speed * 0.5) braking = true; }
  });
  assert(braking && minSpeed2 < BG.Trains.ore.speed * 0.8, 'second train had to brake (min speed ' + minSpeed2.toFixed(2) + ')');
  // (slack action: when the locos take up the free play the coupler overshoots a few cm - draft-gear travel)
  assert(dev <= slack + 0.06, 'coupler stays within slack + draft gear: max deviation ' + dev.toFixed(3) + ' m');
});

test('rail: trains ride only on rail, road vehicles never on rail; deck connectivity per traffic kind', () => {
  const L = makeLevel(10, trainTraffic('handcar'));
  const road = flatDeck(L, 10, 2, 'road'), rail = flatDeck(L, 10, 2, 'rail');
  const r1 = runHeadless(L, road);
  assert(r1.status === 'failed' && r1.failReason === 'derailed' && r1.firstDerail.reason === 'missing', 'handcar on a road deck derails: ' + JSON.stringify(r1.firstDerail));
  assert(!BG.Model.roadConnected(L, road) && BG.Model.roadConnected(L, rail) && BG.Model.railConnected(L, rail), 'rail level needs the rail');
  assert(runHeadless(L, rail).status === 'success', 'handcar crosses plain 10 m rail');
  const Lc = makeLevel(6, [{ type: 'car', count: 1 }]);
  const rc = runHeadless(Lc, flatDeck(Lc, 6, 1, 'rail'));
  assert(rc.status === 'failed' && (rc.failReason === 'vehicle_fell' || rc.failReason === 'vehicle_jumped'), 'a car falls through a rail-only deck: ' + rc.failReason);
  assert(!BG.Model.roadConnected(Lc, flatDeck(Lc, 6, 1, 'rail')), 'road level does not accept rail as road');
  const Lm = makeLevel(10, [{ type: 'car', count: 1 }].concat(trainTraffic('handcar')));
  const both = { nodes: [], beams: rail.beams.concat([{ a: 'a2', b: 'a3', m: 'road' }]), piers: [] };
  assert(!BG.Model.roadConnected(Lm, rail) && BG.Model.deckConnected(Lm, both, 'rail') && !BG.Model.roadConnected(Lm, both), 'double-deck needs both decks from the road anchors');
  const ts = BG.Model.trafficSummary({ traffic: [{ type: 'train', train: 'ore', count: 1 }, { type: 'car', count: 2 }] });
  assert(ts.total === 3 && ts.items[0].kind === 'train' && ts.items[0].cars === 24 && ts.items[1].kind === 'road' && /ore train \(24 cars\)/.test(ts.text), 'traffic summary: ' + ts.text);
});

test('rail: kink and grade derail; fast trains derail on dips slow ones ride through', () => {
  // a 0.6 m hump on a stiff truss: ~7 deg kinks -> derail 'kink'
  {
    const { L, b, top } = railTruss('steam_local', 30, 5, 8, 'steel', 'steel');
    b.d.nodes.find(n => n.id === top[3]).y = 0.6;
    const v = BG.Model.validate(L, b.d);
    assert(v.ok && v.warnings.some(w => w.type === 'rail_kink'), 'hump is valid but warned: ' + JSON.stringify(v.warnings.map(w => w.type)));
    const r = runHeadless(L, b.d);
    assert(r.failReason === 'derailed' && r.firstDerail.reason === 'kink', 'hump derails by kink: ' + JSON.stringify(r.firstDerail));
    assert(r.brokenBeams === 0, 'derailed by geometry, not by a failure');
  }
  // a straight 5 % ramp to a higher bank: fine with the default 6 %, derails with level.rail.maxGrade 0.03
  {
    const mk = extra => {
      const { L, b } = railTruss('freight_short', 30, 5, 8, 'steel', 'steel', [], extra);
      L.anchors[1].y = 1.5; L.terrain.rightY = 1.5;
      for (const n of b.d.nodes) if (Math.abs(n.y) < 1e-9) n.y = n.x * 0.05;
      return { L, d: b.d };
    };
    const a = mk(), r1 = runHeadless(a.L, a.d);
    assert(r1.status === 'success', '5 % grade within the default limit: ' + r1.failReason + ' ' + JSON.stringify(r1.firstDerail));
    const c = mk({ rail: { maxGrade: 0.03 } }), r2 = runHeadless(c.L, c.d);
    assert(r2.failReason === 'derailed' && r2.firstDerail.reason === 'grade', 'grade over the level limit derails: ' + JSON.stringify(r2.firstDerail));
    assert(BG.Model.validate(c.L, c.d).warnings.some(w => w.type === 'rail_grade'), 'grade warning');
  }
  // a 0.1 m dip (~2.3 deg kink): freight at 10 m/s rides through, high-speed (42 m/s, limit ~1.4 deg) derails
  {
    const dip = train => { const { L, b, top } = railTruss(train, 30, 5, 8, 'steel', 'steel'); b.d.nodes.find(n => n.id === top[3]).y = -0.1; return runHeadless(L, b.d); };
    const slow = dip('freight_short'), fast = dip('highspeed');
    assert(slow.status === 'success', 'freight rides through the dip: ' + JSON.stringify(slow.firstDerail));
    assert(fast.failReason === 'derailed' && fast.firstDerail.reason === 'kink', 'high-speed derails on the dip: ' + JSON.stringify(fast.firstDerail));
  }
  // rail must be laid nearly level (not a cheap web member)
  const Lv = makeLevel(10);
  assert(BG.Model.validate(Lv, { nodes: [], beams: [{ a: 'a2', b: 'a0', m: 'rail' }], piers: [] }).errors.some(e => e.type === 'rail_too_steep'), 'steep rail invalid');
});

test('rail: masonry arch viaduct carries steam trains; posts-only arch is a mechanism', () => {
  const v = railViaduct('steam_local', 40, [10, 20, 30], -4, 3, 'steel', 2);
  const r = runHeadless(v.L, v.d);
  assert(r.valid, 'viaduct valid: ' + r.errors.map(e => e.type));
  assert(r.status === 'success' && r.brokenBeams === 0 && r.peakStress < 0.7, 'steam over the masonry viaduct: ' + r.status + ' ' + r.failReason + ' peak ' + r.peakStress);
  const sim = new BG.Simulation(v.L, v.d);
  for (let i = 0; i < 60 * 8; i++) sim.step();
  for (let j = 0; j < v.d.beams.length; j++) if (v.d.beams[j].m === 'masonry' && v.d.beams[j].a !== 'p0' && v.d.beams[j].a !== 'p1' && v.d.beams[j].a !== 'p2') assert(sim.beams[j].force < 25e3, 'masonry stays (nearly) compressed, beam ' + j + ' force ' + sim.beams[j].force.toFixed(0));
  const loose = railViaduct('steam_local', 40, [10, 20, 30], -4, 3, null, 1);
  assert(runHeadless(loose.L, loose.d).status === 'failed', 'pinned arch with posts only must not carry the loco');
});

test('rail: masonry fails in tension, carries enormous compression', () => {
  const L = makeLevel(12, trainTraffic('tram'), { anchors: [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 6, y: 5 }, { x: 6, y: -4 }] });
  const mk = (anchor, m) => { const b = Builder(L); const r = b.line(0, 0, 12, 0, 2, 'rail'); const k = b.beam(anchor, r[1], m); return { d: b.d, k }; };
  const hang = mk('a2', 'masonry'), s1 = run(L, hang.d, 30);
  const fb = s1.summary().firstBreak;
  assert(fb && fb.beamIndex === hang.k && fb.m === 'masonry' && fb.mode === 'tension', 'masonry hanger snaps in tension: ' + JSON.stringify(fb));
  const steel = mk('a2', 'steel'), s2 = run(L, steel.d, 30);
  assert(s2.summary().status === 'success' && !s2.beams[steel.k].broken, 'a steel hanger holds the same deck');
  const post = mk('a3', 'masonry'), s3 = run(L, post.d, 30);
  assert(s3.summary().status === 'success' && s3.beams[post.k].peak < 0.2, 'the same masonry as a post is barely loaded: ' + s3.beams[post.k].peak);
  assert(BG.Materials.masonry.compressionLimit > 40 * BG.Materials.masonry.tensionLimit, 'masonry: compression >> tension');
});

test('rail: ore train collapses a bridge that carries steam (dramatic, finite, coupled)', () => {
  const steam = railTruss('steam_local', 30, 5, 8, 'steel', 'steel');
  assert(runHeadless(steam.L, steam.b.d).status === 'success', 'steam crosses the 30 m steel truss');
  steam.L.traffic = trainTraffic('ore');
  const sim = new BG.Simulation(steam.L, steam.b.d);
  const ev = {};
  let maxV = 0;
  for (let i = 0; i < 60 * 30; i++) {
    sim.step();
    for (const e of sim.drainEvents()) {
      ev[e.type] = (ev[e.type] || 0) + 1;
      if (e.type === 'derail') assert(e.i === 0 && typeof e.car === 'number' && isFinite(e.x) && isFinite(e.y) && e.reason, 'derail event shape');
    }
    for (let k = 0; k < sim.nNodes; k++) maxV = Math.max(maxV, Math.hypot(sim.vx[k], sim.vy[k]));
    for (const c of sim.vehicles[0].cars) maxV = Math.max(maxV, Math.hypot(c._vx, c._vy));
  }
  const s = sim.summary();
  assert(s.status === 'failed' && s.failReason === 'derailed' && s.brokenBeams >= 3, 'ore collapses it: ' + JSON.stringify(s));
  assert(ev.derail >= 2 && ev.vehicle_fall === 1 && ev.splash >= 1 && ev.break >= 3, 'events: ' + JSON.stringify(ev));
  const cars = sim.vehicles[0].cars;
  assert(cars.some(c => c.state === 'fallen') && cars.some(c => c.state === 'derailed' || c.state === 'running'), 'some cars fell, the rest were dragged / braked: ' + cars.map(c => c.state[0]).join(''));
  assert(cars.every(c => c.state === 'fallen' || c.state === 'derailed' || Math.abs(c._vx) < 2), 'cars still on the rail emergency-brake: ' + cars.map(c => c._vx.toFixed(1)).join(' '));
  assert(sim.vehicles[0].state === 'derailed', 'train state derailed');
  assert(allFinite(sim) && cars.every(c => isFinite(c.x) && isFinite(c.y) && isFinite(c.angle) && c.wheels.every(w => isFinite(w.x) && isFinite(w.y))), 'finite');
  assert(maxV <= 60.0001, 'velocities clamped: ' + maxV);
});

test('rail: determinism - identical summaries, structure and car poses', () => {
  const v = railViaduct('steam_local', 40, [10, 20, 30], -4, 3, 'wood', 2);
  const hash = sim => { let h = 0; for (let i = 0; i < sim.nNodes; i++) h = (h * 31 + Math.round(sim.px[i] * 1e9) + Math.round(sim.py[i] * 1e9) * 7) % 1e15; return h; };
  const s1 = run(v.L, v.d, 20), s2 = run(v.L, v.d, 20);
  assert(JSON.stringify(s1.summary()) === JSON.stringify(s2.summary()), 'summary differs');
  assert(hash(s1) === hash(s2), 'structure differs');
  for (let i = 0; i < s1.vehicles.length; i++) for (let k = 0; k < s1.vehicles[i].cars.length; k++) {
    const a = s1.vehicles[i].cars[k], b = s2.vehicles[i].cars[k];
    assert(a.x === b.x && a.y === b.y && a.angle === b.angle && a.state === b.state, 'car pose differs');
  }
  const ore = railTruss('ore', 30, 5, 8, 'steel', 'steel');
  const r1 = runHeadless(ore.L, ore.b.d, { maxTime: 20 }), r2 = runHeadless(ore.L, ore.b.d, { maxTime: 20 });
  delete r1.wallMs; delete r2.wallMs;
  assert(JSON.stringify(r1) === JSON.stringify(r2), 'collapse run differs');
});

test('rail: performance - 24-car ore train over a 300-beam bridge >= 3x realtime', () => {
  const { L, b } = railTruss('ore', 150, 2.5, 8, 'girder', 'girder', [30, 60, 90, 120]);
  for (let i = 0; i < b.d.beams.length; i++) if (b.d.beams[i].m === 'girder' && (b.d.beams[i].a.startsWith('n') && b.d.beams[i].b.startsWith('n'))) { /* keep */ }
  // verticals in steel (lighter), chords + diagonals girder
  const all = BG.Model.nodeMap(L, b.d);
  for (const bm of b.d.beams) { const A = all.get(bm.a), B = all.get(bm.b); if (bm.m === 'girder' && Math.abs(A.x - B.x) < 1e-9) bm.m = 'steel'; }
  assert(b.d.beams.length >= 295 && BG.Model.validate(L, b.d).ok, 'beams ' + b.d.beams.length);
  const sim = new BG.Simulation(L, b.d);
  const t0 = Date.now();
  let onBridge = 0;
  while (sim.time < 60) {
    sim.step(); sim.events.length = 0;
    onBridge = Math.max(onBridge, sim.vehicles[0].cars.filter(c => c.x > 0 && c.x < 150).length);
  }
  const wall = (Date.now() - t0) / 1000, factor = 60 / wall;
  console.log(`      ${b.d.beams.length} beams, ${sim.vehicles[0].cars.length} cars (max ${onBridge} on the bridge): 60 s in ${wall.toFixed(2)} s wall = ${factor.toFixed(1)}x realtime, ${sim.status}`);
  assert(onBridge >= 12, 'train actually on the bridge');
  assert(sim.summary().status === 'success', 'the girder bridge carries the ore train: ' + JSON.stringify(sim.summary().firstBreak || sim.summary().firstDerail));
  assert(factor >= 3, 'too slow: ' + factor.toFixed(1) + 'x');
  assert(allFinite(sim), 'finite');
});

// ------------------------------------------------------------------ run
(async function main() {
  const filter = process.argv[2];
  let pass = 0, fail = 0;
  const t0 = Date.now();
  for (const t of tests) {
    if (filter && !t.name.includes(filter)) continue;
    const ts = Date.now();
    try { await t.fn(); pass++; console.log(`PASS  ${t.name}  (${Date.now() - ts} ms)`); }
    catch (e) { fail++; console.log(`FAIL  ${t.name}\n      ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e}`); }
  }
  console.log(`\n${pass} passed, ${fail} failed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  process.exit(fail ? 1 : 0);
})();
