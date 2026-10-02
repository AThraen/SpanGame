#!/usr/bin/env node
// SPAN — verifies every level in BG.Levels against its reference solution
// (tools/solutions/level-NN.json). Exit code 1 on any failure:
//   not passing, peak stress > 0.92, cost > budget, invalid design, or missing solution.
// Usage: node tools/verify-levels.js [--only 1,2,3] [--verbose]
'use strict';
const fs = require('fs');
const path = require('path');
const { BG, runHeadless } = require('./harness');

const PEAK_MAX = 0.92;
const args = process.argv.slice(2);
const onlyArg = args.indexOf('--only') >= 0 ? args[args.indexOf('--only') + 1] : null;
const only = onlyArg ? new Set(onlyArg.split(',').map(Number)) : null;
const verbose = args.includes('--verbose');

function pad(s, n, right) { s = String(s); return right ? s.padStart(n) : s.padEnd(n); }

const levels = (BG.Levels || []).filter(l => !only || only.has(l.id));
if (!levels.length) { console.error('No levels found (BG.Levels empty?)'); process.exit(1); }

const cols = [['id', 4], ['name', 24], ['result', 9], ['time', 7], ['peak', 7], ['cost', 8], ['budget', 8], ['ratio', 6], ['veh', 6], ['brk', 4], ['wall', 7], ['problems', 0]];
console.log(cols.map(([c, w]) => pad(c, w)).join(' '));
console.log('-'.repeat(110));

let failures = 0;
const t0 = Date.now();
const seenIds = new Set();
for (const level of levels) {
  const nn = String(level.id).padStart(2, '0');
  const file = path.join(__dirname, 'solutions', 'level-' + nn + '.json');
  const problems = [];
  if (seenIds.has(level.id)) problems.push('duplicate level id');
  seenIds.add(level.id);
  let r = null;
  if (!fs.existsSync(file)) {
    problems.push('missing ' + path.basename(file));
  } else {
    let design;
    try { design = BG.Model.deserialize(fs.readFileSync(file, 'utf8')); }
    catch (e) { problems.push('unreadable solution: ' + e.message); }
    if (design) {
      try {
        r = runHeadless(level, design);
      } catch (e) {
        problems.push('sim crashed: ' + e.message);
      }
      if (r) {
        if (r.status !== 'success') problems.push('not passing (' + (r.failReason || r.status) + ')');
        if (!(r.peakStress <= PEAK_MAX)) problems.push('peak ' + r.peakStress.toFixed(3) + ' > ' + PEAK_MAX);
        if (!r.budgetOk) problems.push('over budget');
        if (!r.valid) problems.push('invalid: ' + r.errors.map(e => e.type + (e.beamIndex != null ? '#' + e.beamIndex : '') + (e.nodeId ? '@' + e.nodeId : '')).join(', '));
      }
    }
  }
  if (problems.length) failures++;
  const row = [
    level.id, (level.name || '').slice(0, 24), problems.length ? 'FAIL' : 'ok',
    r ? r.time.toFixed(1) : '-', r ? r.peakStress.toFixed(3) : '-',
    r ? r.cost : '-', level.budget, r && level.budget ? (r.cost / level.budget).toFixed(2) : '-',
    r ? r.vehiclesFinished + '/' + r.vehiclesTotal : '-', r ? r.brokenBeams : '-',
    r ? r.wallMs + 'ms' : '-', problems.join('; '),
  ];
  console.log(row.map((v, i) => pad(v, cols[i][1], i >= 3 && i <= 10)).join(' '));
  if (verbose && r) console.log('     ', JSON.stringify({ status: r.status, failReason: r.failReason, time: r.time }));
}
console.log('-'.repeat(110));
console.log(`${levels.length - failures}/${levels.length} levels verified in ${((Date.now() - t0) / 1000).toFixed(1)} s` + (failures ? `  —  ${failures} FAILED` : '  —  all green'));
process.exit(failures ? 1 : 0);
