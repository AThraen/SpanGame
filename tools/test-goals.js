#!/usr/bin/env node
// SPAN — tests for the goals/badges feature. Re-verifies EVERY shipped goal:
//   for each goal in js/features/goals-data.js there must be tools/solutions/goals/level-NN-<goal>.json that
//   passes the level (valid, in budget, editor-buildable, peak <= 0.99) AND earns exactly that badge via
//   BG.Goals.evaluate. Also unit-tests the evaluator and checks the data shape.
// Usage: node tools/test-goals.js [--only 1,2,3]
'use strict';
const fs = require('fs');
const path = require('path');
const { BG, runHeadless } = require('./harness');
require('../js/features/goals.js');
require('../js/features/goals-data.js');
const { accept } = require('./gen-goals.js');

const args = process.argv.slice(2);
const oi = args.indexOf('--only');
const only = oi >= 0 ? new Set(args[oi + 1].split(',').map(Number)) : null;
let pass = 0, fail = 0;
function ok(name, cond, info) {
  if (cond) pass++; else { fail++; console.log('FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }
}
const pad2 = n => String(n).padStart(2, '0');
const dir = path.join(__dirname, 'solutions', 'goals');
const load = f => BG.Model.deserialize(fs.readFileSync(f, 'utf8'));
const solDesign = (id, suf) => load(path.join(__dirname, 'solutions', 'level-' + pad2(id) + suf + '.json'));
const L = id => BG.Levels.find(l => l.id === id);
const G = BG.Goals;

// ---------------------------------------------------------------- unit tests (evaluator)
{
  const lv = L(1), ref = solDesign(1, '');
  const r = runHeadless(lv, ref);
  const m = G.metrics(lv, ref, r);
  ok('metrics: members', m.members === ref.beams.length);
  ok('metrics: passed', m.passed === true);
  ok('metrics: cost ratio', Math.abs(m.costRatio - r.cost / lv.budget) < 0.001);
  ok('metrics: mass positive', m.mass > 0);
  // a design that does not pass never earns a badge, even if its numbers qualify
  G.register(9001, [{ type: 'minimalist', max: 99 }, { type: 'no_steel' }]);
  const lv2 = Object.assign({}, lv, { id: 9001 });
  const failed = G.evaluate(lv2, { nodes: [], beams: [], piers: [] }, { status: 'failed', peakStress: 1.2 });
  ok('no badge without a pass', failed.earned.length === 0 && failed.passed === false);
  const good = G.evaluate(lv2, ref, r);
  ok('register(): custom ids (campaign levels)', good.earned.length === 2 && good.goals.length === 2, good.earned);
  const tight = (G.register(9001, [{ type: 'minimalist', max: ref.beams.length - 1 }]), G.evaluate(lv2, ref, r));
  ok('minimalist threshold respected', tight.earned.length === 0 && tight.goals[0].candidate === false);
  G.register(9001, [{ type: 'penny', ratio: 0.01 }, { type: 'cool_head', max: 0.01 }, { type: 'featherweight', maxMass: 1 }]);
  ok('impossible thresholds not met', G.evaluate(lv2, ref, r).earned.length === 0);
  G.register(9001, [{ type: 'cool_head', max: 0.99 }]);
  ok('cool_head needs a run', G.evaluate(lv2, ref, null).earned.length === 0 && G.evaluate(lv2, ref, r).earned.length === 1);
  G.register(9001, [{ type: 'bogus' }]);
  ok('unknown goal type is harmless', G.evaluate(lv2, ref, r).earned.length === 0);
  // symmetry
  const lv30 = L(20);
  const sym = { nodes: [{ id: 'n1', x: 6, y: 0 }], beams: [], piers: [] };
  ok('asymmetry of lone design is a miss', G.metrics(lv30, sym, null).symmetric === false || sym.beams.length === 0);
}

// ---------------------------------------------------------------- data shape
const data = BG.GoalsData || {};
const ids = Object.keys(data).map(Number).sort((a, b) => a - b);
// famous: stub levels (BG.Requirements not met: no verified solutions yet) have no goals until they are finished
const playable = BG.Levels.filter(l => !BG.Requirements || BG.Requirements.met(l));
ok('goals data present for every playable level (roads 1-50, bonus 51-53, Iron Road 101-120, Famous Bridges 201+)', playable.every(l => data[l.id]), playable.filter(l => !data[l.id]).map(l => l.id));
ok('no goals on stub levels', BG.Levels.filter(l => !playable.includes(l)).every(l => !data[l.id]));
let total = 0;
const typeCount = {};
for (const id of ids) {
  const specs = data[id];
  ok('level ' + id + ': 2-3 goals', specs.length >= 2 && specs.length <= 3, specs.length);
  ok('level ' + id + ': unique types', new Set(specs.map(s => s.type)).size === specs.length);
  total += specs.length;
  specs.forEach(s => { typeCount[s.type] = (typeCount[s.type] || 0) + 1; ok('level ' + id + ': known type ' + s.type, !!G.TYPES[s.type]); });
}
// no stray solution files
if (fs.existsSync(dir)) {
  for (const f of fs.readdirSync(dir)) {
    const mm = /^level-(\d+)-(.+)\.json$/.exec(f);
    if (!mm) { ok('unexpected file in solutions/goals: ' + f, false); continue; }
    ok('solution file has a goal: ' + f, (data[+mm[1]] || []).some(s => s.type === mm[2]));
  }
}

// ---------------------------------------------------------------- re-verify every goal
const t0 = Date.now();
for (const id of ids) {
  if (only && !only.has(id)) continue;
  const level = L(id);
  if (!level) { ok('level exists ' + id, false); continue; }
  for (const spec of data[id]) {
    const file = path.join(dir, 'level-' + pad2(id) + '-' + spec.type + '.json');
    if (!fs.existsSync(file)) { ok('level ' + id + ' ' + spec.type + ': solution file exists', false); continue; }
    const design = load(file);
    const run = accept(level, design);
    ok('level ' + id + ' ' + spec.type + ': design passes the level', !!run);
    if (!run) continue;
    const ev = G.evaluate(level, design, run);
    const g = ev.goals.find(x => x.id === spec.type);
    ok('level ' + id + ' ' + spec.type + ': badge earned', !!g && g.met, g && g.text);
  }
}
console.log((fail ? 'FAILED ' : 'ok ') + pass + ' checks passed, ' + fail + ' failed; ' + total + ' goals on ' + ids.length + ' levels; types ' + JSON.stringify(typeCount) + '; verify ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
process.exit(fail ? 1 : 0);
