#!/usr/bin/env node
// SPAN — verifies every level in BG.Levels against its designs in tools/solutions/:
//   level-NN.json       reference: passes, peak stress <= 0.92, cost <= budget
//   level-NN-best.json  best:      passes, peak stress <= 0.99, cost <= 70 % of budget (proves ★★★ is reachable)
// Both must also be valid, buildable in the editor (joints on the 0.25 m grid, no two joints closer than
// the 0.6 m joint magnet) and free of floppy parts (no joint drifting > 1 m while nothing has broken).
// Exit code 1 on any failure.
// Works for both campaigns (rail levels: ids 101-120, files level-101.json ...).
// Usage: node tools/verify-levels.js [--only 1,2,3 | --only 1..50 | --only 101-120] [--campaign road|rail] [--ref-only] [--verbose]
'use strict';
const fs = require('fs');
const path = require('path');
const { BG, runHeadless } = require('./harness');

const PEAK_MAX = 0.92, BEST_PEAK_MAX = 0.99, BEST_RATIO = 0.70;
const GRID = 0.25, MIN_SPACING = 0.6, WANDER_MAX = 1.0;
const args = process.argv.slice(2);
const onlyArg = args.indexOf('--only') >= 0 ? args[args.indexOf('--only') + 1] : null;
// --only accepts ids and ranges: "3", "1,2,3", "1..50", "101-120", "1..10,101"
function parseOnly(s) {
  const out = new Set();
  for (const part of String(s).split(',')) {
    const m = /^\s*(\d+)\s*(?:\.\.|-)\s*(\d+)\s*$/.exec(part);
    if (m) { const a = +m[1], b = +m[2]; for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i); }
    else if (part.trim()) out.add(Number(part));
  }
  return out;
}
const only = onlyArg ? parseOnly(onlyArg) : null;
// --campaign road|rail (levels without a campaign field are road levels)
const campArg = args.indexOf('--campaign') >= 0 ? args[args.indexOf('--campaign') + 1] : null;
const verbose = args.includes('--verbose');
const refOnly = args.includes('--ref-only');

function pad(s, n, right) { s = String(s); return right ? s.padStart(n) : s.padEnd(n); }

function buildability(level, design) {
  const out = [];
  const off = design.nodes.filter(n => Math.abs(n.x / GRID - Math.round(n.x / GRID)) > 1e-6 || Math.abs(n.y / GRID - Math.round(n.y / GRID)) > 1e-6);
  if (off.length) out.push(off.length + ' joint(s) off the ' + GRID + ' m grid');
  const all = BG.Model.allNodes(level, design);
  let close = null;
  for (let i = 0; i < all.length && !close; i++) for (let j = i + 1; j < all.length; j++) {
    if (all[i].kind !== 'node' && all[j].kind !== 'node') continue;
    const d = Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y);
    if (d < MIN_SPACING - 1e-9) { close = all[i].id + '/' + all[j].id + ' ' + d.toFixed(2) + ' m apart'; break; }
  }
  if (close) out.push('joints ' + close);
  return out;
}

const levels = (BG.Levels || []).filter(l => (!only || only.has(l.id)) && (!campArg || (l.campaign || 'road') === campArg));
if (!levels.length) { console.error('No levels found (BG.Levels empty?)'); process.exit(1); }

const cols = [['id', 8], ['name', 24], ['result', 7], ['time', 7], ['peak', 7], ['cost', 8], ['budget', 8], ['ratio', 6], ['veh', 6], ['brk', 4], ['wall', 7], ['problems', 0]];
console.log(cols.map(([c, w]) => pad(c, w)).join(' '));
console.log('-'.repeat(112));

let failures = 0, checked = 0;
const t0 = Date.now();
const seenIds = new Set();
for (const level of levels) {
  const nn = String(level.id).padStart(2, '0');
  const kinds = refOnly ? [''] : ['', '-best'];
  if (seenIds.has(level.id)) { console.log(level.id + ' duplicate level id'); failures++; }
  seenIds.add(level.id);
  for (const suf of kinds) {
    const best = suf === '-best';
    const file = path.join(__dirname, 'solutions', 'level-' + nn + suf + '.json');
    const problems = [];
    let r = null;
    checked++;
    if (!fs.existsSync(file)) problems.push('missing ' + path.basename(file));
    else {
      let design;
      try { design = BG.Model.deserialize(fs.readFileSync(file, 'utf8')); }
      catch (e) { problems.push('unreadable solution: ' + e.message); }
      if (design) {
        try { r = runHeadless(level, design, { keepSim: true }); }
        catch (e) { problems.push('sim crashed: ' + e.message); }
        if (r) {
          const peakMax = best ? BEST_PEAK_MAX : PEAK_MAX;
          if (r.status !== 'success') problems.push('not passing (' + (r.failReason || r.status) + ')');
          if (!(r.peakStress <= peakMax)) problems.push('peak ' + r.peakStress.toFixed(3) + ' > ' + peakMax);
          if (!r.budgetOk) problems.push('over budget');
          if (best && level.budget && r.cost > BEST_RATIO * level.budget + 1e-9) problems.push('cost ' + (r.cost / level.budget).toFixed(3) + ' of budget > ' + BEST_RATIO);
          if (!r.valid) problems.push('invalid: ' + r.errors.map(e => e.type + (e.beamIndex != null ? '#' + e.beamIndex : '') + (e.nodeId ? '@' + e.nodeId : '')).join(', '));
          problems.push(...buildability(level, design));
          // floppy parts: a joint drifting far although nothing broke
          if (r.brokenBeams === 0) {
            const all = BG.Model.allNodes(level, design);
            let worst = 0, wid = null;
            for (let i = 0; i < all.length; i++) {
              if (all[i].fixed) continue;
              const n = r.sim.nodes[i];
              const dd = Math.hypot(n.x - all[i].x, n.y - all[i].y);
              if (dd > worst) { worst = dd; wid = all[i].id; }
            }
            if (worst > WANDER_MAX) problems.push('joint ' + wid + ' drifts ' + worst.toFixed(1) + ' m with nothing broken');
          }
        }
      }
    }
    if (problems.length) failures++;
    const row = [
      level.id + suf, (level.name || '').slice(0, 24), problems.length ? 'FAIL' : 'ok',
      r ? r.time.toFixed(1) : '-', r ? r.peakStress.toFixed(3) : '-',
      r ? r.cost : '-', level.budget, r && level.budget ? (r.cost / level.budget).toFixed(2) : '-',
      r ? r.vehiclesFinished + '/' + r.vehiclesTotal : '-', r ? r.brokenBeams : '-',
      r ? r.wallMs + 'ms' : '-', problems.join('; '),
    ];
    console.log(row.map((v, i) => pad(v, cols[i][1], i >= 3 && i <= 10)).join(' '));
    if (verbose && r) console.log('     ', JSON.stringify({ status: r.status, failReason: r.failReason, time: r.time }));
  }
}
console.log('-'.repeat(112));
console.log(`${checked - failures}/${checked} designs verified (${levels.length} levels${refOnly ? ', references only' : ', reference + best'}) in ${((Date.now() - t0) / 1000).toFixed(1)} s` + (failures ? `  —  ${failures} FAILED` : '  —  all green'));
process.exit(failures ? 1 : 0);
