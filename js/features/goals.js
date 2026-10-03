// SPAN — Goals beyond stars ("badges"). Pure evaluation logic: no DOM, runs in browser and Node.
//   BG.Goals.evaluate(level, design, simSummary) -> { passed, metrics, goals:[...], earned:[ids] }
//   BG.Goals.metrics(level, design, simSummary)  -> measurable facts about the design/run
//   BG.Goals.forLevel(levelOrId)                 -> goal specs [{type, ...params}] (from BG.GoalsData, js/features/goals-data.js)
//   BG.Goals.register(levelId, specs)            -> add/replace goal specs at runtime (campaigns, e.g. Iron Road 101-120)
// A badge is only ever awarded for a run that passed the level (sim success AND cost <= budget).
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});

  const EPS = 0.02;      // metres: coordinate tolerance for the symmetry check
  const registry = {};   // runtime-registered specs override BG.GoalsData

  function frac(limit, value) { return value <= 0 ? 1 : Math.max(0, Math.min(1, limit / value)); }
  function fmtMass(kg) { return kg >= 10000 ? (Math.round(kg / 100) / 10) + ' t' : Math.round(kg) + ' kg'; }
  function pct(v) { return Math.round(v * 100); }

  // ---- goal types ---------------------------------------------------------------------------
  // check(m, p) -> { met, value, target, text, frac } ; m = metrics, p = spec parameters.
  // live:true  -> can be judged from the design alone (shown with live progress while building)
  // live:false -> needs a finished test run (progress shows "run a test")
  const TYPES = {
    minimalist: {
      name: 'Minimalist', icon: 'minimalist', live: true,
      desc: p => 'Pass using at most ' + p.max + ' members',
      check: (m, p) => ({ met: m.members <= p.max, value: m.members, target: p.max, text: m.members + ' / ' + p.max + ' members', frac: frac(p.max, m.members) }),
    },
    penny: {
      name: 'Penny Pincher', icon: 'penny', live: true,
      desc: p => 'Pass for at most ' + pct(p.ratio) + '% of the budget',
      check: (m, p) => ({ met: m.costRatio <= p.ratio + 1e-9, value: m.costRatio, target: p.ratio, text: pct(m.costRatio) + '% / ' + pct(p.ratio) + '% of budget', frac: frac(p.ratio, m.costRatio) }),
    },
    featherweight: {
      name: 'Featherweight', icon: 'feather', live: true,
      desc: p => 'Pass with a structure lighter than ' + fmtMass(p.maxMass),
      check: (m, p) => ({ met: m.mass <= p.maxMass, value: m.mass, target: p.maxMass, text: fmtMass(m.mass) + ' / ' + fmtMass(p.maxMass), frac: frac(p.maxMass, m.mass) }),
    },
    cool_head: {
      name: 'Cool Head', icon: 'cool', live: false,
      desc: p => 'Pass with peak stress at or below ' + pct(p.max) + '%',
      check: (m, p) => m.peak == null
        ? { met: false, value: null, target: p.max, text: 'run a test', frac: 0 }
        : { met: m.peak <= p.max + 1e-9, value: m.peak, target: p.max, text: 'peak ' + pct(m.peak) + '% / ' + pct(p.max) + '%', frac: frac(p.max, m.peak) },
    },
    symmetric: {
      name: 'Symmetric', icon: 'symmetric', live: true,
      desc: () => 'Pass with a bridge that mirrors perfectly about mid-span',
      check: m => ({ met: m.symmetric, value: m.asymmetry, target: 0, text: m.symmetric ? 'mirror-symmetric' : (m.asymmetry + ' unmatched member' + (m.asymmetry === 1 ? '' : 's')), frac: m.symmetric ? 1 : Math.max(0, 1 - m.asymmetry / Math.max(1, m.members)) }),
    },
    no_steel: {
      name: 'No Steel', icon: 'nosteel', live: true,
      desc: () => 'Pass without a single steel beam',
      check: m => ({ met: !m.materials.steel, value: m.count.steel || 0, target: 0, text: m.materials.steel ? (m.count.steel + ' steel beam' + (m.count.steel === 1 ? '' : 's')) : 'no steel used', frac: m.materials.steel ? 0 : 1 }),
    },
    timber_only: {
      name: 'Timber Only', icon: 'timber', live: true,
      desc: () => 'Pass using only road and wood',
      check: m => {
        const bad = Object.keys(m.count).filter(k => k !== 'road' && k !== 'wood').reduce((a, k) => a + m.count[k], 0);
        return { met: bad === 0, value: bad, target: 0, text: bad ? (bad + ' beam' + (bad === 1 ? '' : 's') + ' of other material') : 'road and wood only', frac: bad ? 0 : 1 };
      },
    },
    // railway levels: the worst kink the train felt (sim.ride.kinkRatio, the same passage-mean kink / limit the
    // derail rule judges) at or below a share of its limit
    smooth_ride: {
      name: 'Smooth Ride', icon: 'smooth', live: false,
      desc: p => 'Pass with the worst track kink at or below ' + pct(p.max) + '% of its limit',
      check: (m, p) => m.ride == null
        ? { met: false, value: null, target: p.max, text: 'run a test', frac: 0 }
        : { met: m.ride <= p.max + 1e-9, value: m.ride, target: p.max, text: 'kink ' + pct(m.ride) + '% / ' + pct(p.max) + '% of limit', frac: frac(p.max, m.ride) },
    },
    no_piers: {
      name: 'No Piers', icon: 'nopiers', live: true,
      desc: () => 'Pass without building a single pier',
      check: m => ({ met: m.piers === 0, value: m.piers, target: 0, text: m.piers ? (m.piers + ' pier' + (m.piers === 1 ? '' : 's')) : 'no piers', frac: m.piers ? 0 : 1 }),
    },
  };

  // ---- metrics ------------------------------------------------------------------------------
  function nodeMap(level, design) {
    const out = {};
    for (const n of BG.Model.allNodes(level, design)) out[n.id] = n;
    return out;
  }
  function round3(v) { return Math.round(v * 1000) / 1000; }

  // How many members/piers have no mirror twin about the span's centre line (0 = perfectly symmetric).
  function asymmetry(level, design, nodes) {
    const t = level.terrain || {};
    const cx = ((t.leftEdge || 0) + (t.rightEdge || 0)) / 2;
    const q = v => Math.round(v / EPS);
    const key = (x1, y1, x2, y2, m) => {
      const a = [q(x1), q(y1)], b = [q(x2), q(y2)];
      const s = (a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1])) ? [a, b] : [b, a];
      return m + ':' + s[0] + ':' + s[1];
    };
    const list = [];
    for (const b of design.beams || []) {
      const A = nodes[b.a], B = nodes[b.b];
      if (!A || !B) continue;
      list.push({ k: key(A.x, A.y, B.x, B.y, b.m), mk: key(2 * cx - A.x, A.y, 2 * cx - B.x, B.y, b.m) });
    }
    const have = new Set(list.map(e => e.k));
    let miss = 0;
    for (const e of list) if (!have.has(e.mk)) miss++;
    const ps = new Set((design.piers || []).map(p => q(p.x) + ':' + q(p.topY)));
    for (const p of design.piers || []) if (!ps.has(q(2 * cx - p.x) + ':' + q(p.topY))) miss++;
    return miss;
  }

  function metrics(level, design, sim) {
    const M = BG.Model, mats = BG.Materials || {};
    design = design || { nodes: [], beams: [], piers: [] };
    const nodes = nodeMap(level, design);
    const count = {};
    let mass = 0;
    for (const b of design.beams || []) {
      count[b.m] = (count[b.m] || 0) + 1;
      const A = nodes[b.a], B = nodes[b.b], mat = mats[b.m];
      if (A && B && mat) mass += Math.hypot(A.x - B.x, A.y - B.y) * (mat.massPerMeter || 0);
    }
    const cost = M.cost(level, design).total;
    const budget = level.budget == null ? Infinity : level.budget;
    const asym = (design.beams || []).length ? asymmetry(level, design, nodes) : 1;
    const materials = {};
    for (const k in count) materials[k] = true;
    const simOk = !!sim && sim.status === 'success';
    // ride quality of a railway run: a summary may carry it (.ride), or the run object its sim (.sim.ride)
    const ride = sim && (sim.ride || (sim.sim && sim.sim.ride)) || null;
    return {
      members: (design.beams || []).length,
      cost, budget, costRatio: budget === Infinity ? 0 : round3(cost / budget),
      mass: Math.round(mass),
      peak: sim && sim.peakStress != null ? sim.peakStress : null,
      ride: ride && typeof ride.kinkRatio === 'number' ? Math.round(ride.kinkRatio * 1000) / 1000 : null,
      piers: (design.piers || []).length,
      count, materials,
      asymmetry: asym, symmetric: asym === 0,
      simOk, passed: simOk && cost <= budget,
    };
  }

  // ---- specs --------------------------------------------------------------------------------
  function idOf(levelOrId) { return levelOrId && typeof levelOrId === 'object' ? levelOrId.id : levelOrId; }
  function forLevel(levelOrId) {
    const id = idOf(levelOrId);
    if (registry[id]) return registry[id];
    const data = BG.GoalsData || {};
    return data[id] || [];
  }
  function register(levelId, specs) { registry[levelId] = Array.isArray(specs) ? specs : []; }

  function describe(spec) {
    const T = TYPES[spec.type];
    return { id: spec.type, type: spec.type, name: T ? T.name : spec.type, icon: T ? T.icon : spec.type, desc: T ? T.desc(spec) : '', live: T ? T.live : false };
  }

  // Evaluates every goal of the level. Goals are only 'met' on a passing run (see header).
  function evaluate(level, design, sim) {
    const m = metrics(level, design, sim);
    const goals = forLevel(level).map(spec => {
      const T = TYPES[spec.type];
      const info = describe(spec);
      if (!T) return Object.assign(info, { met: false, candidate: false, text: '', frac: 0 });
      const c = T.check(m, spec);
      // a badge needs a passing run; `candidate` = the design/run already satisfies the condition
      const empty = m.members === 0;   // nothing built yet: never 'on track'
      const met = !!c.met && m.passed && !empty;
      return Object.assign(info, { met, candidate: !!c.met && !empty, text: empty ? 'nothing built yet' : c.text, value: c.value, target: c.target, frac: empty ? 0 : c.frac });
    });
    return { passed: m.passed, metrics: m, goals, earned: goals.filter(g => g.met).map(g => g.id) };
  }

  BG.Goals = { TYPES, metrics, evaluate, forLevel, register, describe, asymmetry };
})(typeof window !== 'undefined' ? window : globalThis);
