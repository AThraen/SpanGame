/* SPAN — BG.Requirements: which optional modules a level needs (level.requires = ['wind', 'rail', ...]).
 * Famous Bridges feature. Runs in the browser and in Node (tools/harness.js loads it), no DOM.
 * A level whose requirements are not met is shown locked in the UI and skipped by the verifiers,
 * so a campaign can ship stub levels (history card + terrain) before the module they need is merged.
 * Other modules can announce themselves with BG.Requirements.provide('wind') instead of relying on
 * the default detection below.
 * A level can also be a stub (level.stub: true or a string saying what is missing): its modules may be
 * present, but it has no verified solutions yet, so it stays locked and skipped exactly like a level
 * with a missing module. */
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});
  const provided = {};

  // default detection: a module counts as present when its global exists
  const CHECKS = {
    wind: () => !!(BG.Forces || BG.Events || BG.Weather || BG.Wind), // Forces of Nature (SPEC §12: js/core/events.js = BG.Forces)
    rail: () => !!(BG.Trains && BG.Materials && BG.Materials.rail), // Iron Road (SPEC §9)
    masonry: () => !!(BG.Materials && BG.Materials.masonry),
  };
  // i18n: the module names come from the dictionary (features.req.*); register(req, check, label) may give its own text
  const LABEL_KEYS = { wind: 'features.req.wind', rail: 'features.req.rail', masonry: 'features.req.masonry' };
  const LABELS = {};
  function tr(k) { return BG.i18n ? BG.i18n.t(k) : k; }

  function has(req) {
    if (provided[req]) return true;
    const c = CHECKS[req];
    try { return c ? !!c() : false; } catch (e) { return false; }
  }
  function missing(level) {
    const reqs = (level && Array.isArray(level.requires)) ? level.requires : [];
    return reqs.filter(r => !has(r));
  }
  function isStub(level) { return !!(level && level.stub); }

  BG.Requirements = {
    has,
    missing,
    met(level) { return !isStub(level) && missing(level).length === 0; },
    isStub,
    provide(req) { provided[req] = true; },
    label(req) { return LABELS[req] || (LABEL_KEYS[req] ? tr(LABEL_KEYS[req]) : req); },
    register(req, check, label) { CHECKS[req] = check; if (label) LABELS[req] = label; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
