// SPAN — Node loader for js/core/* + runHeadless().
// Usage: const { BG, runHeadless } = require('./harness');
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CORE = path.resolve(__dirname, '..', 'js', 'core');
const ORDER = ['materials.js', 'vehicles.js', 'trains.js', 'model.js', 'physics.js', 'events.js', 'levels.js', 'templates.js', 'curves.js']; // arch-tool: curves.js = BG.Curves // forces: events.js = BG.Forces

function load() {
  for (const f of ORDER) {
    const file = path.join(CORE, f);
    if (!fs.existsSync(file)) continue;
    const code = fs.readFileSync(file, 'utf8');
    try {
      vm.runInThisContext(code, { filename: file });
    } catch (e) {
      if (f === 'templates.js' || f === 'levels.js') console.warn('[harness] failed to load ' + f + ': ' + e.message);
      else throw e;
    }
  }
  // famous: optional feature modules that also run headless (level requirements)
  const REQ = path.resolve(__dirname, '..', 'js', 'features', 'requirements.js');
  if (fs.existsSync(REQ)) vm.runInThisContext(fs.readFileSync(REQ, 'utf8'), { filename: REQ });
  return globalThis.BG;
}

const BG = load();

/**
 * Runs a level headless until success/failure (or maxTime) and returns
 * sim.summary() plus { cost, budgetOk, valid, errors, wallMs }.
 * opts: { maxTime, seed, substeps, onStep(sim), keepSim (adds non-enumerable .sim) }
 */
function runHeadless(level, design, opts) {
  opts = opts || {};
  const t0 = Date.now();
  const sim = new BG.Simulation(level, design, { seed: opts.seed == null ? 1 : opts.seed, substeps: opts.substeps });
  const maxTime = opts.maxTime != null ? opts.maxTime : (level.timeLimit || 60) + 0.5;
  const maxSteps = Math.ceil(maxTime * 60 - 1e-6);
  for (let i = 0; i < maxSteps && sim.status === 'running'; i++) {
    sim.step();
    sim.events.length = 0;
    if (opts.onStep) opts.onStep(sim);
  }
  const s = sim.summary();
  const cost = BG.Model.cost(level, design);
  const val = BG.Model.validate(level, design);
  const out = Object.assign(s, {
    cost: cost.total,
    budgetOk: cost.total <= (level.budget == null ? Infinity : level.budget),
    valid: val.ok,
    errors: val.errors,
    wallMs: Date.now() - t0,
  });
  if (opts.keepSim) Object.defineProperty(out, 'sim', { value: sim, enumerable: false });
  return out;
}

module.exports = { BG, runHeadless, load };
