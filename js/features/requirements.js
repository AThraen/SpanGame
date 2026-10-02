/* SPAN — BG.Requirements: which optional modules a level needs (level.requires = ['wind', 'rail', ...]).
 * Famous Bridges feature. Runs in the browser and in Node (tools/harness.js loads it), no DOM.
 * A level whose requirements are not met is shown locked in the UI and skipped by the verifiers,
 * so a campaign can ship stub levels (history card + terrain) before the module they need is merged.
 * Other modules can announce themselves with BG.Requirements.provide('wind') instead of relying on
 * the default detection below. */
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});
  const provided = {};

  // default detection: a module counts as present when its global exists
  const CHECKS = {
    wind: () => !!(BG.Events || BG.Weather || BG.Wind),         // weather-events branch
    rail: () => !!(BG.Trains && BG.Materials && BG.Materials.rail), // Iron Road (SPEC §9)
    masonry: () => !!(BG.Materials && BG.Materials.masonry),
  };
  const LABELS = { wind: 'Weather & wind', rail: 'Iron Road (trains)', masonry: 'Masonry' };

  function has(req) {
    if (provided[req]) return true;
    const c = CHECKS[req];
    try { return c ? !!c() : false; } catch (e) { return false; }
  }
  function missing(level) {
    const reqs = (level && Array.isArray(level.requires)) ? level.requires : [];
    return reqs.filter(r => !has(r));
  }

  BG.Requirements = {
    has,
    missing,
    met(level) { return missing(level).length === 0; },
    provide(req) { provided[req] = true; },
    label(req) { return LABELS[req] || req; },
    register(req, check, label) { CHECKS[req] = check; if (label) LABELS[req] = label; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
