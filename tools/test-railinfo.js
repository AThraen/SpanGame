#!/usr/bin/env node
// SPAN — derailment explainer tests (BG.RailInfo + the sim's read-only readouts).
// Every derail cause gets a deliberately bad design; the explanation must name it with numbers.
// Usage: node tools/test-railinfo.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { BG } = require('./harness');
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'ui', 'railinfo.js'), 'utf8'), { filename: 'railinfo.js' });
const RI = BG.RailInfo;

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + e.message); }
}
function assert(c, msg) { if (!c) throw new Error(msg); }
const level = (id, patch) => Object.assign(JSON.parse(JSON.stringify(BG.Levels.find(l => l.id === id))), patch ? JSON.parse(JSON.stringify(patch)) : {});
const sol = n => JSON.parse(fs.readFileSync(path.join(__dirname, 'solutions', 'level-' + n + '.json'), 'utf8'));
const train = (t, n) => ({ traffic: [{ type: 'train', train: t, count: n || 1, interval: 4 }] });

/** run until the first derailment (or the end); returns {sim, ev (derail event), car} */
function runToDerail(lv, d, maxT) {
  const sim = new BG.Simulation(lv, d, { seed: 1 });
  let ev = null;
  for (let i = 0; i < 60 * (maxT || 40) && !ev; i++) {
    sim.step();
    for (const e of sim.drainEvents()) if (e.type === 'derail' && !ev) ev = e;
    if (sim.status !== 'running' && !ev) break;
  }
  const car = ev ? sim.vehicles[ev.i].cars[ev.car] : null;
  return { sim, ev, car, info: ev ? RI.explain(ev.detail, sim, lv, d, car) : null };
}
const plain101 = { nodes: [{ id: 'n1', x: 5, y: 0 }], beams: [{ a: 'a0', b: 'n1', m: 'rail' }, { a: 'n1', b: 'a1', m: 'rail' }], piers: [] };
function truss108(web) {
  const d = { nodes: [], beams: [], piers: [] }, n = 8, P = 5, h = 4, top = [], bot = [];
  for (let i = 0; i <= n; i++) {
    top.push(i === 0 ? 'a0' : i === n ? 'a1' : 'n' + i); bot.push(i === 0 ? 'a2' : i === n ? 'a3' : 'n' + (100 + i));
    if (i > 0 && i < n) { d.nodes.push({ id: 'n' + i, x: i * P, y: 0 }); d.nodes.push({ id: 'n' + (100 + i), x: i * P, y: -h }); }
  }
  for (let i = 0; i < n; i++) { d.beams.push({ a: top[i], b: top[i + 1], m: 'rail' }); d.beams.push({ a: bot[i], b: bot[i + 1], m: 'steel' }); }
  for (let i = 1; i < n; i++) d.beams.push({ a: top[i], b: bot[i], m: web });
  for (let i = 0; i < n; i++) { d.beams.push({ a: top[i], b: bot[i + 1], m: web }); d.beams.push({ a: bot[i], b: top[i + 1], m: web }); }
  return d;
}

test('readouts are read-only: reading them every step changes nothing', () => {
  for (const [lv, d] of [[level(108), sol('108')], [level(101, train('tram')), plain101]]) {
    const a = new BG.Simulation(lv, d, { seed: 1 }), b = new BG.Simulation(lv, d, { seed: 1 });
    for (let i = 0; i < 60 * 12; i++) {
      a.step(); b.step();
      RI.profile(b); RI.rideCard(b, b.summary()); b.drainEvents();
    }
    for (let k = 0; k < a.nNodes; k++) assert(a.px[k] === b.px[k] && a.py[k] === b.py[k], 'node ' + k + ' differs');
    assert(JSON.stringify(a.summary()) === JSON.stringify(b.summary()), 'summaries differ');
  }
  const road = level(1);
  assert(new BG.Simulation(road, { nodes: [], beams: [], piers: [] }).ride === null, 'road levels have no ride readout');
});

test('kink: tram on plain 10 m rail - "Kink x° at v m/s - limit here is 4°", dip advice', () => {
  const r = runToDerail(level(101, train('tram')), plain101);
  assert(r.ev && r.ev.reason === 'kink' && r.ev.detail && r.ev.detail.reason === 'kink', 'derails by kink: ' + JSON.stringify(r.ev));
  assert(/^Kink \d+\.\d° at 7 m\/s — limit here is 4°\.$/.test(r.info.cause), r.info.cause);
  assert(r.info.at === 'dip' && /Stiffen the deck/.test(r.info.advice), r.info.at + ' ' + r.info.advice);
  assert(r.ev.detail.seg >= 0 && r.ev.detail.segPrev >= 0 && r.ev.detail.seg !== r.ev.detail.segPrev, 'kink names both segments');
  assert(r.ev.detail.value > r.ev.detail.limit, 'kink over its limit');
  assert(r.sim.firstDerail.detail === r.ev.detail, 'firstDerail carries the detail');
});

test('kink at speed: the limit shrinks for the high-speed set', () => {
  const r = runToDerail(level(101, train('highspeed')), sol('101'));
  assert(r.ev && r.ev.reason === 'kink', JSON.stringify(r.ev));
  const m = /limit here is ([\d.]+)°/.exec(r.info.cause);
  assert(m && +m[1] < 2 && /at 42 m\/s/.test(r.info.cause), r.info.cause);
  assert(/limit shrinks above 15 m\/s/.test(r.info.advice), r.info.advice);
  approx(RI.kinkLimit(r.sim, 42) * 180 / Math.PI, 4 * 15 / 42, 1e-9, 'kinkLimit(42 m/s)');
});

test('grade: "Grade x% - trains can\'t climb more than 6%"', () => {
  const lv = level(101, { terrain: { leftEdge: 0, leftY: 0, rightEdge: 10, rightY: 0.65, floorY: -8, waterY: -5.5 }, anchors: [{ x: 0, y: 0 }, { x: 10, y: 0.65 }, { x: 0, y: -2.5 }, { x: 10, y: -2.5 }] });
  const d = { nodes: [{ id: 'n1', x: 5, y: 0.25 }], beams: [{ a: 'a0', b: 'n1', m: 'rail' }, { a: 'n1', b: 'a1', m: 'rail' }, { a: 'a2', b: 'n1', m: 'wood' }], piers: [] };
  const r = runToDerail(lv, d);
  assert(r.ev && r.ev.reason === 'grade', JSON.stringify(r.ev));
  assert(/^Grade \d+\.\d% — trains can't climb more than 6%\.$/.test(r.info.cause), r.info.cause);
  assert(/built too steep \(8\.0%\)/.test(r.info.advice), r.info.advice);
});

test('missing: rail broke under the wheel (truss gave way first)', () => {
  const d = truss108('steel');
  assert(BG.Model.validate(level(108), d).ok, 'design is valid');
  const r = runToDerail(level(108), d);
  assert(r.ev && r.ev.reason === 'missing', JSON.stringify(r.ev));
  assert(r.info.cause === 'Rail broke under the wheel.' && r.info.seg >= 0 && r.sim.beams[r.info.seg].broken, r.info.cause + ' seg ' + r.info.seg);
  assert(/gave way first \(steel, compression\)/.test(r.info.advice), r.info.advice);
});

test('missing: a gap in the track / a road deck', () => {
  const gap = { nodes: [{ id: 'n1', x: 5, y: 0 }], beams: [{ a: 'a0', b: 'n1', m: 'rail' }, { a: 'a2', b: 'n1', m: 'wood' }], piers: [] };
  const r = runToDerail(level(101), gap);
  assert(r.ev && r.ev.reason === 'missing' && /gap in the track/.test(r.info.cause), r.info && r.info.cause);
  const road = { nodes: [{ id: 'n1', x: 5, y: 0 }], beams: [{ a: 'a0', b: 'n1', m: 'road' }, { a: 'n1', b: 'a1', m: 'road' }, { a: 'a2', b: 'n1', m: 'wood' }], piers: [] };
  const lv = level(101, { materials: ['rail', 'wood', 'road'] });
  const q = runToDerail(lv, road);
  assert(q.ev && q.ev.reason === 'missing' && /only run on Rail Track/.test(q.info.cause), q.info && q.info.cause);
});

test('lift and fell explanations', () => {
  const sim = new BG.Simulation(level(101), sol('101'));
  const lift = RI.explain({ reason: 'lift', wheel: 0, wx: 5, wy: 0, seg: 0, value: 1.4, limit: 1, speed: 31.6 }, sim, level(101), sol('101'), { type: 'hs_coach' });
  assert(lift.cause === 'Bogie lifted off a crest at 32 m/s.' && lift.car === 'High-Speed Coach', lift.cause + ' / ' + lift.car);
  const fell = RI.explain({ reason: 'fell', wheel: 0, wx: 5, wy: -3, seg: -1, speed: 2 }, sim, level(101), sol('101'), { type: 'tender' });
  assert(/tender fell with the bridge/.test(fell.cause), fell.cause);
});

test('ride card: verdicts, worst values, smoothness grade', () => {
  for (const id of ['101', '108']) {
    const sim = new BG.Simulation(level(+id), sol(id), { seed: 1 });
    for (let i = 0; i < 60 * 60 && sim.status === 'running'; i++) { sim.step(); sim.events.length = 0; }
    const c = RI.rideCard(sim, sim.summary());
    assert(sim.status === 'success' && c.structureOk && c.railsOk, id + ' passes cleanly');
    assert(c.grade > 0 && c.grade < c.gradeLim && c.kink > 0 && c.kink < c.kinkLim && c.sag > 0 && c.sag < 0.5, id + ' worst values: ' + JSON.stringify(c));
    assert(/^[A-D]$/.test(c.letter), id + ' letter ' + c.letter);
  }
  const r = runToDerail(level(101, train('tram')), plain101);
  for (let i = 0; i < 120; i++) r.sim.step();
  const c = RI.rideCard(r.sim, r.sim.summary());
  assert(!c.railsOk && c.letter === 'F' && c.kinkRatio > 1, 'derailed run: ' + JSON.stringify(c));
});

test('masonry thrust readout: peak tension of masonry members', () => {
  const ref = sol('108');
  const bad = JSON.parse(JSON.stringify(ref));
  bad.beams.forEach(b => { if (b.m === 'steel') b.m = 'masonry'; });
  const peakT = d => {
    const sim = new BG.Simulation(level(108), d, { seed: 1 });
    for (let i = 0; i < 60 * 25; i++) sim.step();
    let mx = 0;
    sim.beams.forEach((b, j) => { if (j < sim.nDesignBeams && b.m === 'masonry') { assert(typeof b.peakTension === 'number', 'masonry has peakTension'); mx = Math.max(mx, b.peakTension); } else if (j < sim.nDesignBeams) assert(b.peakTension === undefined, 'only brittle members carry peakTension'); });
    return mx;
  };
  const good = peakT(ref), cracked = peakT(bad);
  assert(cracked > 0.4 && cracked > 3 * good, 'masonry diagonals are pulled hard (' + cracked.toFixed(2) + ') where the steel-braced viaduct keeps its stone squeezed (' + good.toFixed(2) + ')');
});

test('track profile: joints and kinks along the deck, bank joints included', () => {
  const lv = level(101, train('tram'));
  const sim = new BG.Simulation(lv, plain101, { seed: 1 });
  const p0 = RI.profile(sim);
  assert(p0.segs.length === 2 && p0.joints.length === 3, 'two segments, three joints (2 banks + middle): ' + p0.segs.length + '/' + p0.joints.length);
  assert(p0.joints.every(j => j.kink < 1e-9), 'flat as built');
  for (let i = 0; i < 60 * 3; i++) sim.step();
  const p1 = RI.profile(sim);
  assert(p1.joints[1].kink > 0.03, 'the middle joint kinks under the tram: ' + p1.joints[1].kink);
  const rec = new RI.Recorder(sim);
  rec.sample(p1);
  assert(rec.kink.get(p1.joints[1].node) === p1.joints[1].kink, 'recorder keeps the peak');
});

function approx(a, b, tol, msg) { assert(Math.abs(a - b) <= tol, msg + ': ' + a + ' vs ' + b); }

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
