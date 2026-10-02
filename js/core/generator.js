/* SPAN — procedural level generator (BG.Generator). Pure core module: no DOM, runs in browser and Node.
 *
 *   BG.Generator.generate(seed, opts) -> level         synchronous (Node tests, small levels)
 *   BG.Generator.createJob(seed, opts) -> job          job.step(ms) runs for ~ms, returns true when done;
 *                                                      job.level / job.error / job.progress
 *   BG.Generator.generateAsync(seed, opts, done, onProgress)   browser: runs the job in time slices
 *   BG.Generator.daily(dateOrSeed, opts) -> level      daily challenge level for a date (seed = YYYYMMDD)
 *   BG.Generator.dailySeed(date) / dailyDifficulty(seed) / weekdayOf(seed) / dateLabel(seed)
 *
 * opts: { difficulty 0..1 (default: weekday curve for date seeds, else 0.5), mode: 'daily'|'endless'|'custom',
 *         index (endless crossing number), id, name }
 *
 * Every emitted level is PROVEN solvable: an in-generator solver builds parametric trusses
 * (Pratt / Warren, above or below the deck, wood or steel, road or reinforced road, optional piers),
 * snaps them to the editor's 0.25 m grid, validates them with BG.Model.validate and runs them through
 * BG.Simulation headless. The cheapest passing design (peak stress <= PEAK_MAX) sets the budget:
 * budget = cost / TARGET_RATIO, so ★★★ (<= 70 %) needs a better bridge than the solver found.
 * If nothing passes, the level is adjusted deterministically (more materials, lighter traffic,
 * shorter gap) and solved again. Only IEEE basic arithmetic + sqrt + Math.imul are used (no Math.random,
 * no transcendental functions), so a seed gives the bit-identical level in every JS engine.
 */
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});

  const VERSION = 1;
  const PEAK_MAX = 0.92;        // solver designs must keep this much margin (like the reference solutions)
  const TARGET_RATIO = 0.75;    // solver's best cost / budget
  const GRID = 0.25;            // editor fine snap: solver designs are editor-buildable
  const VERIFY_TIME = 150;      // s, generous limit while proving; the real limit is set from the run
  const STEPS_PER_YIELD = 40;   // sim steps between cooperative yields
  const MAX_SIMS = 26;          // per attempt
  const OPT_TRIES = 5;          // binary-search steps over cheaper variants after the first pass

  const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Mon easy -> Sun hard
  const WEEKDAY_CURVE = [0.08, 0.2, 0.33, 0.46, 0.6, 0.74, 0.88];
  const THEMES = ['meadow', 'autumn', 'desert', 'canyon', 'snow', 'night', 'city', 'tropical', 'volcanic'];
  const TRAFFIC_TIERS = [
    ['car', 'van'],
    ['car', 'van', 'bus'],
    ['van', 'bus', 'truck'],
    ['bus', 'truck', 'semi'],
    ['truck', 'semi', 'tanker'],
  ];
  const INTERVAL = { car: 2.4, van: 2.7, bus: 3.4, truck: 3.6, semi: 4.4, tanker: 4.6, heavy: 5 };
  const MASS_FALLBACK = { car: 1200, van: 2500, bus: 12000, truck: 20000, semi: 38000, tanker: 45000, heavy: 60000 };

  // ------------------------------------------------------------------ deterministic helpers
  function mulberry32(a) {
    a = (a >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash32() {
    let h = 0x811c9dc5;
    for (let i = 0; i < arguments.length; i++) {
      let v = arguments[i];
      if (typeof v === 'string') { for (let k = 0; k < v.length; k++) { h = Math.imul(h ^ v.charCodeAt(k), 0x01000193); } continue; }
      v = Math.floor(+v || 0);
      // split into two 32-bit halves so seeds above 2^32 still mix
      const lo = v % 4294967296, hi = Math.floor(v / 4294967296);
      h = Math.imul(h ^ (lo | 0), 0x01000193); h ^= h >>> 13;
      h = Math.imul(h ^ (hi | 0), 0x5bd1e995); h ^= h >>> 15;
    }
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function Rng(seed) {
    const f = mulberry32(seed);
    return {
      f,
      range(a, b) { return a + (b - a) * f(); },
      int(a, b) { return a + Math.floor(f() * (b - a + 1)); },
      pick(arr) { return arr[Math.floor(f() * arr.length)]; },
      chance(p) { return f() < p; },
      weighted(list) {
        let tot = 0;
        for (const it of list) tot += Math.max(0, it[1]);
        let r = f() * tot;
        for (const it of list) { if (it[1] <= 0) continue; r -= it[1]; if (r < 0) return it[0]; }
        return list[0][0];
      },
    };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function snap(v, g) { const s = g || GRID; return Math.round(v / s) * s; }
  function snapDown(v, g) { const s = g || GRID; return Math.floor(v / s + 1e-9) * s; }
  function r3(v) { return Math.round(v * 1000) / 1000; }
  function hyp(dx, dy) { return Math.sqrt(dx * dx + dy * dy); }
  function nowMs() { return (root.performance && root.performance.now) ? root.performance.now() : Date.now(); }
  function mat(id) { return (BG.Materials && BG.Materials[id]) || null; }
  function maxLen(id) { const m = mat(id); return m && m.maxLength > 0 ? m.maxLength : 6; }
  function vehMass(t) { const V = BG.Vehicles && BG.Vehicles[t]; return (V && V.mass) || MASS_FALLBACK[t] || 1500; }

  // ------------------------------------------------------------------ dates
  function isDateSeed(seed) {
    const s = Math.floor(+seed);
    if (!(s >= 19000101 && s <= 29991231)) return false;
    const m = Math.floor(s / 100) % 100, d = s % 100;
    return m >= 1 && m <= 12 && d >= 1 && d <= 31;
  }
  function seedParts(seed) { const s = Math.floor(+seed); return { y: Math.floor(s / 10000), m: Math.floor(s / 100) % 100, d: s % 100 }; }
  /** YYYYMMDD of a Date in the player's local calendar (default: today). */
  function dailySeed(date) {
    const dt = date instanceof Date ? date : (date != null ? new Date(date) : new Date());
    return dt.getFullYear() * 10000 + (dt.getMonth() + 1) * 100 + dt.getDate();
  }
  function dayNumber(seed) { const p = seedParts(seed); return Math.round(Date.UTC(p.y, p.m - 1, p.d) / 86400000); }
  function seedFromDayNumber(n) { const dt = new Date(n * 86400000); return dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate(); }
  function addDays(seed, k) { return seedFromDayNumber(dayNumber(seed) + k); }
  /** 0 = Monday ... 6 = Sunday; -1 when the seed is not a date. */
  function weekdayOf(seed) {
    if (!isDateSeed(seed)) return -1;
    const p = seedParts(seed);
    const js = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); // 0 = Sunday
    return (js + 6) % 7;
  }
  function dateLabel(seed) {
    if (!isDateSeed(seed)) return String(seed);
    const p = seedParts(seed), wd = weekdayOf(seed);
    return WEEKDAYS[wd].slice(0, 3) + ' ' + p.d + ' ' + MONTHS[p.m - 1] + ' ' + p.y;
  }
  function isoDate(seed) {
    const p = seedParts(seed);
    return p.y + '-' + (p.m < 10 ? '0' : '') + p.m + '-' + (p.d < 10 ? '0' : '') + p.d;
  }
  /** Weekday difficulty curve (Mon easy -> Sun hard) with a small per-date wobble. */
  function dailyDifficulty(seed) {
    const wd = weekdayOf(seed);
    if (wd < 0) return 0.5;
    const R = Rng(hash32(seed, 'difficulty'));
    return r3(clamp(WEEKDAY_CURVE[wd] + R.range(-0.035, 0.035), 0, 1));
  }

  // ------------------------------------------------------------------ level skeleton
  // adj: deterministic adjustments applied on retries
  //   { extraMats, trafficDown, gapScale, reroll, easy }
  function skeleton(seed, diff, opts, adj) {
    const R = Rng(hash32(seed, 'level', adj.reroll | 0));
    const d = clamp(diff, 0, 1);
    const arch = adj.easy ? 'open' : R.weighted([
      ['open', 1],
      ['ledges', 1.2],
      ['lowroof', 0.55],
      ['noledge', 0.55],
      ['channel', d >= 0.3 ? 0.9 : 0],
      ['piers', d >= 0.42 ? 1.1 : 0],
    ]);

    // gap
    let gap = arch === 'piers' ? 34 + 28 * d : 12 + 30 * d;
    gap += R.range(-3, 3);
    gap *= adj.gapScale || 1;
    if (adj.easy) gap = 12;
    gap = Math.max(10, Math.round(gap));

    // banks
    let dy = 0;
    if (!adj.easy && d >= 0.22 && R.chance(0.5)) dy = R.pick([-2, -1.5, -1, 1, 1.5, 2]) * (gap < 20 ? 0.5 : 1);
    dy = snap(dy, 0.5);
    const low = Math.min(0, dy), high = Math.max(0, dy);
    let floorY = -(6 + R.range(0, 5) + d * 7 + (arch === 'piers' ? 2 : 0));
    floorY = snap(low + floorY, 0.5);
    let waterY = null;
    if (arch === 'channel' || R.chance(0.55)) {
      waterY = snap(floorY + R.range(1.5, 3.5), 0.5);
      if (waterY > low - 3) waterY = snap(low - 3, 0.5);
      if (waterY <= floorY + 0.5) waterY = floorY + 1;
    }
    const lowY = Math.max(floorY, waterY == null ? -1e9 : waterY);

    // anchors (0 = left road anchor, 1 = right road anchor)
    const anchors = [{ x: 0, y: 0 }, { x: gap, y: dy }];
    const wantLedges = arch === 'ledges' || arch === 'lowroof' || (arch === 'open' && R.chance(0.4)) || (arch === 'piers' && R.chance(0.5));
    const hL = snap(R.range(2.5, 4.5 + d * 1.5), 0.5), hR = snap(R.range(2.5, 4.5 + d * 1.5), 0.5);
    if (wantLedges && !adj.easy) {
      const yL = -hL, yR = dy - hR;
      if (yL > lowY + 1 && yR > lowY + 1) { anchors.push({ x: 0, y: yL }, { x: gap, y: yR }); }
    }

    // build area
    const above = arch === 'lowroof' ? 1 : snap(clamp(6 + gap * 0.12, 6, 12), 1);
    let y0 = arch === 'noledge' ? low : Math.max(lowY + 1, low - (5 + d * 3));
    y0 = snap(y0, 0.5);
    const buildArea = { x0: 0, x1: gap, y0, y1: high + above };

    // ship channel
    const noBuild = [];
    if (arch === 'channel') {
      const w = Math.round(clamp(gap * 0.3, 6, 14));
      const x0 = Math.round(gap / 2 - w / 2);
      noBuild.push({ x0, x1: x0 + w, y0: waterY != null ? waterY : floorY, y1: low - R.pick([1, 1.5, 2]) });
    }

    // piers
    const pierZones = [];
    let maxPiers = 0;
    if (arch === 'piers') {
      const two = gap >= 50 && d > 0.55;
      const zw = snap(R.range(2.5, 4.5), 0.5);
      if (two) {
        for (const f of [1 / 3, 2 / 3]) { const c = Math.round(gap * f); pierZones.push({ x0: c - zw, x1: c + zw }); }
        maxPiers = 2;
      } else {
        const c = Math.round(gap / 2 + R.range(-2, 2));
        pierZones.push({ x0: c - zw, x1: c + zw });
        maxPiers = 1;
      }
    } else if (adj.addPier && gap >= 24) {
      // retry adjustment: give a too-hard crossing somewhere to stand (clear of any ship channel)
      const zw = 2.5;
      if (noBuild.length) {
        const z = noBuild[0];
        if (z.x0 - zw * 2 - 1 > 2) pierZones.push({ x0: z.x0 - 1 - zw * 2, x1: z.x0 - 1 });
        if (z.x1 + 1 + zw * 2 < gap - 2) pierZones.push({ x0: z.x1 + 1, x1: z.x1 + 1 + zw * 2 });
      } else {
        const c = Math.round(gap / 2);
        pierZones.push({ x0: c - zw, x1: c + zw });
      }
      maxPiers = pierZones.length;
    }

    // traffic
    let tier = Math.floor(d * 5 + R.range(-0.35, 0.35));
    tier = clamp(tier - (adj.trafficDown | 0), 0, 4);
    if (adj.easy) tier = 0;
    const pool = TRAFFIC_TIERS[tier];
    const nGroups = R.int(2, 3);
    const traffic = [];
    for (let g = 0; g < nGroups; g++) {
      const type = R.pick(pool);
      const m = vehMass(type);
      const count = m >= 30000 ? 1 : m >= 9000 ? R.int(1, 2) : R.int(1, 3);
      const last = traffic[traffic.length - 1];
      if (last && last.type === type) { last.count += count; continue; }
      traffic.push({ type, count, interval: INTERVAL[type] || 3 });
    }
    let heaviest = 0;
    for (const g of traffic) heaviest = Math.max(heaviest, vehMass(g.type));

    // materials
    const materials = ['road'];
    if (adj.extraMats || (heaviest >= 12000 && d >= 0.4)) materials.push('reinforced_road');
    materials.push('wood');
    if (adj.extraMats || d >= 0.2 || gap > 24 || heaviest >= 9000) materials.push('steel');
    if (d >= 0.45 && R.chance(0.6)) materials.push('rope');
    if (d >= 0.6 && R.chance(0.6)) materials.push('cable');

    const theme = R.pick(THEMES);
    const level = {
      id: opts.id != null ? opts.id : 'gen-' + seed,
      name: '',
      hint: '',
      theme,
      terrain: { leftEdge: 0, leftY: 0, rightEdge: gap, rightY: dy, floorY, waterY },
      anchors,
      pierZones,
      maxPiers,
      noBuild,
      buildArea,
      materials,
      budget: 0,
      traffic,
      timeLimit: 0,
      templates: false,
    };
    level.name = opts.name || makeName(seed, level, arch, opts, R);
    level.hint = makeHint(level, arch);
    if (adj.addPier && pierZones.length && arch !== 'piers') level.hint = 'Heavy traffic on a long span: the pier zone on the valley floor can carry the middle of the deck.';
    return { level, arch };
  }

  const NOUNS = {
    channel: ['Channel', 'Strait', 'Harbour', 'Sound', 'Shipway'],
    piers: ['Viaduct', 'Valley', 'Narrows', 'Causeway', 'Reach'],
    deep: ['Gorge', 'Canyon', 'Ravine', 'Chasm', 'Abyss'],
    water: ['Creek', 'River', 'Ford', 'Brook', 'Rapids'],
    dry: ['Crossing', 'Gap', 'Pass', 'Hollow', 'Notch'],
  };
  const ADJ = ['Windy', 'Quiet', 'Rusty', 'Misty', 'Golden', 'Crooked', 'Lonely', 'Stormy', 'Hidden', 'Silver', 'Broken', 'Sunny'];
  function makeName(seed, level, arch, opts, R) {
    const t = level.terrain;
    const depth = Math.min(t.leftY, t.rightY) - t.floorY;
    const key = arch === 'channel' ? 'channel' : arch === 'piers' ? 'piers' : depth >= 14 ? 'deep' : t.waterY != null ? 'water' : 'dry';
    const noun = R.pick(NOUNS[key]);
    if (opts.mode === 'daily' && isDateSeed(seed)) return WEEKDAYS[weekdayOf(seed)] + "'s " + noun;
    const adj = R.pick(ADJ);
    if (opts.mode === 'endless') return adj + ' ' + noun;
    return adj + ' ' + noun;
  }
  function makeHint(level, arch) {
    const gap = level.terrain.rightEdge - level.terrain.leftEdge;
    switch (arch) {
      case 'channel': return 'Ships need the channel under the deck kept clear: carry the road from above.';
      case 'piers': return 'A ' + gap + ' m span is a long way to go unsupported. One pier zone on the valley floor can split it.';
      case 'lowroof': return 'No headroom above the road. Build the truss underneath and tie it to the cliff ledges.';
      case 'noledge': return 'Nothing to push against below the deck. Hang the road from a truss above it.';
      default: return 'Triangles keep their shape. Deeper trusses carry more, but every metre costs.';
    }
  }

  // ------------------------------------------------------------------ parametric bridge builder
  // P: { kind: 'pratt'|'warren', n, road, struct, pierIdx: [deck indices], ties,
  //      above: {h, tiers} | null, below: {h, tiers} | null }
  // Pratt sides are stacks of `tiers` node rows; row j spans deck joints j..n-j (a polygonal, Parker-like
  // outline), so every member stays within the material's max length while the truss gets deep.
  // Both sides at once make a deep truss with the deck at mid-height. Warren sides are single-tier.
  function buildTruss(level, P) {
    const A = level.anchors[0], B = level.anchors[1];
    const G = B.x - A.x;
    const nodes = [], beams = [], piers = [];
    const pos = {};
    level.anchors.forEach((a, i) => { pos['a' + i] = a; });
    let next = 1;
    const node = (x, y) => {
      x = r3(snap(x)); y = r3(snap(y));
      for (const k in pos) if (Math.abs(pos[k].x - x) < 1e-6 && Math.abs(pos[k].y - y) < 1e-6) return k;
      const id = 'n' + next++;
      nodes.push({ id, x, y }); pos[id] = { x, y };
      return id;
    };
    const pairs = {};
    const beam = (a, b, m) => {
      if (!a || !b || a === b) return;
      const k = a < b ? a + '|' + b : b + '|' + a;
      if (pairs[k]) return;
      pairs[k] = 1; beams.push({ a, b, m });
    };
    const n = P.n;
    const deckY = (x) => A.y + (B.y - A.y) * (x - A.x) / G;
    const xs = [], D = [];
    for (let i = 0; i <= n; i++) xs.push(A.x + (G * i) / n);
    const pierSet = {};
    (P.pierIdx || []).forEach((i) => { pierSet[i] = true; });
    for (let i = 0; i <= n; i++) {
      if (i === 0) D.push('a0');
      else if (i === n) D.push('a1');
      else if (pierSet[i]) {
        const x = r3(snap(xs[i])), y = r3(snap(deckY(xs[i])));
        const id = 'p' + piers.length;
        piers.push({ x, topY: y }); pos[id] = { x, y };
        D.push(id);
      } else D.push(node(xs[i], deckY(xs[i])));
    }
    for (let i = 0; i < n; i++) beam(D[i], D[i + 1], P.road);
    const S = P.struct, mid = n / 2;
    const side = (spec, s) => {
      if (!spec) return null;
      if (P.kind === 'warren') {
        const T = [];
        for (let i = 0; i < n; i++) { const x = (xs[i] + xs[i + 1]) / 2; T.push(node(x, deckY(x) + s * spec.h)); }
        for (let i = 0; i < n; i++) {
          beam(D[i], T[i], S); beam(T[i], D[i + 1], S);
          if (i > 0) beam(T[i - 1], T[i], S);
        }
        return { first: T[0], last: T[n - 1] };
      }
      const k = spec.tiers || 1;
      let prev = D, out = null;
      for (let j = 1; j <= k; j++) {
        const off = s * spec.h * j / k;
        const row = [];
        for (let i = j; i <= n - j; i++) row[i] = node(xs[i], deckY(xs[i]) + off);
        beam(prev[j - 1], row[j], S);
        beam(row[n - j], prev[n - j + 1], S);
        for (let i = j; i <= n - j; i++) { beam(prev[i], row[i], S); if (i > j) beam(row[i - 1], row[i], S); }
        for (let i = j; i < n - j; i++) {
          const left = i + 1 <= mid, right = i >= mid;
          if (left || !right) beam(row[i], prev[i + 1], S);
          if (right || !left) beam(row[i + 1], prev[i], S);
        }
        if (j === 1) out = { first: row[1], last: row[n - 1] };
        prev = row;
      }
      return out;
    };
    side(P.above, 1);
    const low = side(P.below, -1);
    // below the deck: brace the first chord joints against the cliff ledges
    if (P.ties && low && level.anchors.length >= 4) {
      const tie = (ai, tid) => {
        const a = level.anchors[ai], t = pos[tid];
        if (!a || !t) return;
        if (hyp(t.x - a.x, t.y - a.y) <= maxLen(S) - 1e-6) beam('a' + ai, tid, S);
      };
      tie(2, low.first); tie(3, low.last);
    }
    return { nodes, beams, piers };
  }

  // geometry limits for a level
  function caps(level) {
    const A = level.anchors[0], B = level.anchors[1];
    const ba = level.buildArea;
    const t = level.terrain;
    const lowY = Math.max(t.floorY, t.waterY == null ? -1e9 : t.waterY);
    let below = Math.min(A.y, B.y) - Math.max(ba.y0, lowY + 0.6);
    for (const z of level.noBuild || []) below = Math.min(below, Math.min(A.y, B.y) - z.y1 - 0.3);
    const above = ba.y1 - Math.max(A.y, B.y);
    return { above: snapDown(Math.max(0, above - 0.05)), below: snapDown(Math.max(0, below)) };
  }

  function sideSpec(kind, h, sMax) {
    h = snap(h);
    if (h < 1) return null;
    if (kind === 'warren') return h <= sMax * 0.8 ? { h, tiers: 1 } : null;
    return { h, tiers: h > sMax * 0.72 ? 2 : 1 };
  }

  // a geometry variant -> truss params (n chosen so panels and members fit), or null
  function makeParams(level, kind, above, below, road, struct, nPiers) {
    const G = level.anchors[1].x - level.anchors[0].x;
    const sMax = maxLen(struct) * 0.985, rMax = Math.min(maxLen(road), 6) * 0.96;
    if (!above && !below) return null;
    const specs = [above, below].filter(Boolean);
    let tiers = 1;
    for (const sp of specs) tiers = Math.max(tiers, sp.tiers);
    let n = Math.max(2 * tiers + 1, Math.ceil(G / rMax));
    for (; n <= 80; n++) {
      const p = G / n;
      if (p > rMax) continue;
      let ok = true;
      for (const sp of specs) {
        const seg = sp.h / sp.tiers;
        const d = kind === 'warren' ? p / 2 : p;
        if (hyp(d + GRID, seg + GRID) > sMax || seg + GRID > sMax) { ok = false; break; }
      }
      if (ok) break;
    }
    if (n > 80) return null;
    const P = { kind, n, road, struct, above: above || null, below: below || null, pierIdx: [], ties: !!below };
    if (nPiers > 0) {
      const idx = pickPiers(level, n, nPiers);
      if (!idx) return null;
      P.pierIdx = idx;
    }
    return P;
  }

  function pickPiers(level, n, k) {
    const G = level.anchors[1].x - level.anchors[0].x;
    const zones = level.pierZones || [];
    if (zones.length < k) return null;
    const out = [];
    for (let z = 0; z < k; z++) {
      const zone = zones[z];
      const c = (zone.x0 + zone.x1) / 2;
      let best = -1, bd = Infinity;
      for (let i = 1; i < n; i++) {
        const x = snap(level.anchors[0].x + (G * i) / n);
        if (x < zone.x0 + 1e-6 || x > zone.x1 - 1e-6) continue;
        if (Math.abs(x - c) < bd) { bd = Math.abs(x - c); best = i; }
      }
      if (best < 0) return null;
      out.push(best);
    }
    return out;
  }

  function hasMat(level, m) { return level.materials.indexOf(m) >= 0; }
  /** 'prattx2/both/steel/road/p1' style summary of truss params */
  function describe(P) {
    const s = P.above && P.below ? 'both' : P.above ? 'above' : 'below';
    const t = Math.max(P.above ? P.above.tiers : 0, P.below ? P.below.tiers : 0);
    return P.kind + (t > 1 ? 'x' + t : '') + '/' + s + '/' + P.struct + '/' + P.road + '/p' + P.pierIdx.length;
  }

  // the candidate families (materials x piers), each with a "strongest" variant and cheaper ones
  function candidateFamilies(level) {
    const G = level.anchors[1].x - level.anchors[0].x;
    const cp = caps(level);
    const roads = ['road'].concat(hasMat(level, 'reinforced_road') ? ['reinforced_road'] : []);
    const structs = ['wood'].concat(hasMat(level, 'steel') ? ['steel'] : []);
    const pierCounts = [0];
    for (let k = 1; k <= (level.maxPiers | 0); k++) pierCounts.push(k);
    const fams = [];
    for (const road of roads) for (const struct of structs) for (const np of pierCounts) {
      const sMax = maxLen(struct) * 0.985;
      const span = G / (np + 1);
      const deep = Math.max(1.5, span * 0.22);
      const hA = Math.min(cp.above, sMax * 1.6, deep), hB = Math.min(cp.below, sMax * 1.6, deep);
      const geoms = [];
      for (const f of [1, 0.75, 0.55, 0.4]) {
        for (const kind of ['pratt', 'warren']) {
          if (cp.above >= 1) geoms.push([kind, sideSpec(kind, Math.max(1, hA * f), sMax), null]);
          if (cp.below >= 1) geoms.push([kind, null, sideSpec(kind, Math.max(1, hB * f), sMax)]);
        }
        if (cp.above >= 1 && cp.below >= 1 && f >= 0.55) {
          geoms.push(['pratt', sideSpec('pratt', Math.max(1, hA * f), sMax), sideSpec('pratt', Math.max(1, hB * f), sMax)]);
        }
      }
      const variants = [];
      const seen = {};
      for (const g of geoms) {
        if (!g[1] && !g[2]) continue;
        const P = makeParams(level, g[0], g[1], g[2], road, struct, np);
        if (!P) continue;
        const design = buildTruss(level, P);
        const key = JSON.stringify(design);
        if (seen[key]) continue;
        seen[key] = 1;
        if (!BG.Model.validate(level, design).ok) continue;
        const depth = (P.above ? P.above.h : 0) + (P.below ? P.below.h : 0);
        const cost = BG.Model.cost(level, design).total;
        variants.push({ P, design, cost, strength: depth * (g[0] === 'pratt' ? 1 : 0.9) });
      }
      if (!variants.length) continue;
      let strong = variants[0];
      for (const v of variants) if (v.strength > strong.strength + 1e-9 || (Math.abs(v.strength - strong.strength) < 1e-9 && v.cost > strong.cost)) strong = v;
      variants.sort((a, b) => a.cost - b.cost);
      fams.push({ road, struct, piers: np, strong, variants, cost: strong.cost });
    }
    fams.sort((a, b) => a.cost - b.cost);
    return fams;
  }

  // ------------------------------------------------------------------ the solver (a generator: yields to stay responsive)
  function* simulate(level, design, ctx) {
    const lv = Object.assign({}, level, { timeLimit: VERIFY_TIME, budget: 1e12 });
    const sim = new BG.Simulation(lv, design, { seed: 1 });
    const maxSteps = Math.ceil(VERIFY_TIME * 60);
    let k = 0;
    for (let i = 0; i < maxSteps && sim.status === 'running'; i++) {
      sim.step();
      sim.events.length = 0;
      // fail fast: peak stress only grows, so a candidate over the margin can never pass
      if (i % 10 === 9 && sim.summary().peakStress > PEAK_MAX) break;
      if (++k >= STEPS_PER_YIELD) { k = 0; ctx.steps += STEPS_PER_YIELD; yield; }
    }
    ctx.sims++;
    const s = sim.summary();
    return { pass: s.status === 'success' && s.peakStress <= PEAK_MAX, status: s.status, peak: s.peakStress, time: s.time, failReason: s.failReason };
  }

  function* solve(level, ctx) {
    const fams = candidateFamilies(level);
    let sims = 0;
    let found = null;
    // 1) cheapest family whose strongest variant passes
    for (const fam of fams) {
      if (sims >= MAX_SIMS) break;
      ctx.progress = { phase: 'proving', family: fam.struct + '/' + fam.road + '/' + fam.piers, sims: ctx.sims };
      sims++;
      const r = yield* simulate(level, fam.strong.design, ctx);
      if (r.pass) { found = { fam, v: fam.strong, r }; break; }
    }
    if (!found) return null;
    // 2) optimise inside that family: binary search over its variants by cost (cheaper ~ weaker)
    const vs = found.fam.variants;
    let lo = 0, hi = vs.indexOf(found.v);
    let best = found, tries = 0;
    while (lo < hi && tries < OPT_TRIES && sims < MAX_SIMS) {
      const m = (lo + hi) >> 1;
      tries++; sims++;
      ctx.progress = { phase: 'optimising', sims: ctx.sims };
      const r = yield* simulate(level, vs[m].design, ctx);
      if (r.pass) { hi = m; best = { fam: found.fam, v: vs[m], r }; } else lo = m + 1;
    }
    return { design: best.v.design, params: best.v.P, kind: describe(best.v.P), cost: best.v.cost, peak: best.r.peak, time: best.r.time };
  }

  const ADJUSTMENTS = [
    {},
    { extraMats: true },
    { extraMats: true, addPier: true },
    { extraMats: true, addPier: true, trafficDown: 1 },
    { extraMats: true, addPier: true, trafficDown: 1, gapScale: 0.8 },
    { extraMats: true, trafficDown: 2, gapScale: 0.65, reroll: 1 },
    { extraMats: true, trafficDown: 3, gapScale: 0.5, reroll: 2 },
    { easy: true, reroll: 3 },
  ];

  function resolveOpts(seed, opts) {
    const o = Object.assign({}, opts || {});
    if (o.difficulty == null) o.difficulty = isDateSeed(seed) ? dailyDifficulty(seed) : 0.5;
    o.difficulty = clamp(+o.difficulty || 0, 0, 1);
    if (!o.mode) o.mode = 'custom';
    return o;
  }

  function* run(seed, opts, ctx) {
    const o = resolveOpts(seed, opts);
    for (let a = 0; a < ADJUSTMENTS.length; a++) {
      ctx.attempt = a;
      const sk = skeleton(seed, o.difficulty, o, ADJUSTMENTS[a]);
      const level = sk.level;
      const sol = yield* solve(level, ctx);
      if (!sol) continue;
      level.budget = Math.ceil(sol.cost / TARGET_RATIO / 50) * 50;
      level.timeLimit = Math.max(25, Math.ceil((sol.time * 1.3 + 6) / 5) * 5);
      level.generator = {
        version: VERSION, seed, difficulty: o.difficulty, mode: o.mode, archetype: sk.arch, attempt: a,
        sims: ctx.sims,
        solution: { design: sol.design, kind: sol.kind, cost: sol.cost, peak: r3(sol.peak), time: r3(sol.time), params: sol.params },
      };
      if (o.mode === 'daily' && isDateSeed(seed)) level.generator.date = isoDate(seed);
      if (o.index != null) level.generator.index = o.index;
      return level;
    }
    throw new Error('generator: no solvable level for seed ' + seed);
  }

  // ------------------------------------------------------------------ public API
  function Job(seed, opts) {
    this.seed = seed;
    this.opts = opts || {};
    this.ctx = { sims: 0, steps: 0, attempt: 0, progress: null };
    this._it = run(seed, this.opts, this.ctx);
    this.done = false;
    this.level = null;
    this.error = null;
    this.elapsed = 0;
  }
  Job.prototype.step = function (budgetMs) {
    if (this.done) return true;
    const t0 = nowMs();
    const lim = budgetMs == null ? Infinity : budgetMs;
    try {
      for (;;) {
        const r = this._it.next();
        if (r.done) { this.level = r.value; this.done = true; break; }
        if (nowMs() - t0 >= lim) break;
      }
    } catch (e) { this.error = e; this.done = true; }
    this.elapsed += nowMs() - t0;
    return this.done;
  };
  Object.defineProperty(Job.prototype, 'progress', { get() { return Object.assign({ attempt: this.ctx.attempt, sims: this.ctx.sims, steps: this.ctx.steps }, this.ctx.progress || {}); } });

  function createJob(seed, opts) { return new Job(seed, opts); }

  function generate(seed, opts) {
    const job = new Job(seed, opts);
    job.step(Infinity);
    if (job.error) throw job.error;
    return job.level;
  }

  /** Runs a job in time slices (browser). done(err, level, job); onProgress(job). Returns the job (job.cancel()). */
  function generateAsync(seed, opts, done, onProgress) {
    const job = new Job(seed, opts);
    const slice = (opts && opts.sliceMs) || 14;
    let cancelled = false;
    job.cancel = () => { cancelled = true; };
    const schedule = (fn) => {
      if (typeof root.requestAnimationFrame === 'function' && !(opts && opts.noRaf)) root.requestAnimationFrame(fn);
      else setTimeout(fn, 0);
    };
    const tick = () => {
      if (cancelled) return;
      const fin = job.step(slice);
      if (onProgress) { try { onProgress(job); } catch (e) { /* ignore */ } }
      if (fin) { if (done) done(job.error, job.level, job); return; }
      schedule(tick);
    };
    schedule(tick);
    return job;
  }

  function daily(dateOrSeed, opts) {
    const seed = isDateSeed(dateOrSeed) ? Math.floor(+dateOrSeed) : dailySeed(dateOrSeed);
    return generate(seed, dailyOpts(seed, opts));
  }
  function dailyOpts(seed, opts) {
    return Object.assign({ mode: 'daily', difficulty: dailyDifficulty(seed), id: 'daily-' + seed }, opts || {});
  }
  /** Endless crossing k of a run: seed mixed from the run seed, difficulty rising with k. */
  function endlessOpts(runSeed, k, opts) {
    return Object.assign({ mode: 'endless', index: k, difficulty: r3(clamp(0.06 + 0.075 * k, 0, 1)), id: 'endless-' + runSeed + '-' + k }, opts || {});
  }
  function endlessSeed(runSeed, k) { return hash32(runSeed, 'endless', k); }

  BG.Generator = {
    VERSION, PEAK_MAX, TARGET_RATIO, WEEKDAYS, WEEKDAY_CURVE,
    generate, createJob, generateAsync, daily, dailyOpts, endlessOpts, endlessSeed,
    dailySeed, dailyDifficulty, weekdayOf, dateLabel, isoDate, isDateSeed, addDays, dayNumber,
    // exposed for tests / tooling
    _skeleton: skeleton, _buildTruss: buildTruss, _families: candidateFamilies, _describe: describe, _hash: hash32, _rng: Rng,
  };
})(typeof window !== 'undefined' ? window : globalThis);
