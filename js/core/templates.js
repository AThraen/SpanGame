// SPAN — BG.Templates: bridge-type generators (SPEC §4.8).
// Produces ordinary design fragments {nodes, beams, piers} that span the level's main road anchors.
// Pure core module: no DOM, runs in browser and Node.
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});

  // ---------------------------------------------------------------------------
  // Material + vehicle fallbacks (used only when BG.Materials / BG.Vehicles are missing)
  // ---------------------------------------------------------------------------
  const FALLBACK_MATS = {
    road: { id: 'road', maxLength: 6, costPerMeter: 100, isRoad: true },
    reinforced_road: { id: 'reinforced_road', maxLength: 6, costPerMeter: 180, isRoad: true },
    wood: { id: 'wood', maxLength: 6, costPerMeter: 50 },
    steel: { id: 'steel', maxLength: 10, costPerMeter: 120 },
    rope: { id: 'rope', maxLength: 20, costPerMeter: 20, tensionOnly: true },
    cable: { id: 'cable', maxLength: 40, costPerMeter: 60, tensionOnly: true },
    rail: { id: 'rail', maxLength: 6, costPerMeter: 220, isRail: true },
    masonry: { id: 'masonry', maxLength: 5, costPerMeter: 40 },
    girder: { id: 'girder', maxLength: 12, costPerMeter: 300 },
  };
  const FALLBACK_VEH_MASS = { car: 1200, van: 2500, bus: 12000, truck: 20000, semi: 38000, tanker: 45000, heavy: 60000 };
  const EPS = 1e-6;

  function matDef(id) {
    const M = BG.Materials;
    return (M && M[id]) || FALLBACK_MATS[id] || null;
  }
  function maxLen(id) {
    const d = matDef(id);
    return d && d.maxLength > 0 ? d.maxLength : 6;
  }
  function r3(v) { return Math.round(v * 1000) / 1000; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hyp(dx, dy) { return Math.sqrt(dx * dx + dy * dy); }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

  function allowedMaterials(level) {
    if (level && Array.isArray(level.materials) && level.materials.length) return level.materials.slice();
    const M = BG.Materials;
    return M ? Object.keys(M) : Object.keys(FALLBACK_MATS);
  }

  function vehicleMass(type) {
    const V = BG.Vehicles;
    if (V && V[type] && V[type].mass) return V[type].mass;
    return FALLBACK_VEH_MASS[type] || 1500;
  }

  function isRailMat(id) { const d = matDef(id); return !!(d && d.isRail); }
  function isTrainGroup(g) { return !!g && (g.type === 'train' || !!g.train); }
  // rail levels (campaign 'rail', or trains in the traffic) get a rail deck when the level allows one
  function isRailLevel(level) {
    return !!level && (level.campaign === 'rail' || (level.traffic || []).some(isTrainGroup));
  }

  function pickMaterials(level, opts) {
    const allowed = allowedMaterials(level);
    const has = (m) => allowed.indexOf(m) >= 0;
    const first = (list) => { for (const m of list) if (has(m)) return m; return null; };
    let heaviest = 0;
    (level.traffic || []).forEach((g) => { if (!isTrainGroup(g)) heaviest = Math.max(heaviest, vehicleMass(g.type)); });
    const railDeck = first(allowed.filter(isRailMat).concat(['rail']));
    let road;
    if (opts.road && has(opts.road)) road = opts.road;
    else if (railDeck && (isRailLevel(level) || !first(['road', 'reinforced_road']))) road = railDeck;
    else if (heaviest >= 9000 && has('reinforced_road')) road = 'reinforced_road';
    else road = first(['road', 'reinforced_road']);
    const struct = (opts.struct && has(opts.struct)) ? opts.struct : first(['steel', 'girder', 'wood', 'reinforced_road', 'road', 'cable', 'rope', 'masonry'].concat(railDeck ? [railDeck] : []));
    const tension = (opts.tension && has(opts.tension)) ? opts.tension : first(['cable', 'rope', 'steel', 'girder', 'wood']);
    const masonry = first(['masonry']);
    return { road: road || struct, struct: struct || road, tension: tension || struct || road, masonry };
  }

  // ---------------------------------------------------------------------------
  // Geometry validation (own checks; BG.Model.validate is combined in when present)
  // ---------------------------------------------------------------------------
  function inRect(x, y, r, eps) {
    return x > r.x0 + eps && x < r.x1 - eps && y > r.y0 + eps && y < r.y1 - eps;
  }
  // Does segment (x1,y1)-(x2,y2) pass through the open interior of rect r?
  function segHitsRect(x1, y1, x2, y2, r, eps) {
    const rx0 = r.x0 + eps, rx1 = r.x1 - eps, ry0 = r.y0 + eps, ry1 = r.y1 - eps;
    if (rx0 >= rx1 || ry0 >= ry1) return false;
    let t0 = 0, t1 = 1;
    const dx = x2 - x1, dy = y2 - y1;
    const p = [-dx, dx, -dy, dy];
    const q = [x1 - rx0, rx1 - x1, y1 - ry0, ry1 - y1];
    for (let i = 0; i < 4; i++) {
      if (Math.abs(p[i]) < 1e-12) { if (q[i] <= 0) return false; continue; }
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return t1 - t0 > 1e-9;
  }
  function inTerrain(level, x, y, eps) {
    const t = level.terrain || {};
    if (typeof t.leftEdge === 'number' && x < t.leftEdge - eps && y < num(t.leftY, 0) - eps) return true;
    if (typeof t.rightEdge === 'number' && x > t.rightEdge + eps && y < num(t.rightY, 0) - eps) return true;
    if (typeof t.floorY === 'number' && y < t.floorY - eps) return true;
    return false;
  }

  function checkGeometry(level, design) {
    const errors = [];
    const err = (type, msg, extra) => errors.push(Object.assign({ type, msg }, extra || {}));
    const pos = {};
    (level.anchors || []).forEach((a, i) => { pos['a' + i] = { x: a.x, y: a.y, kind: 'anchor' }; });
    const piers = design.piers || [];
    piers.forEach((p, i) => { pos['p' + i] = { x: p.x, y: p.topY, kind: 'pier' }; });
    const ids = {};
    (design.nodes || []).forEach((n) => {
      if (ids[n.id]) err('duplicate_node', 'Duplicate joint id ' + n.id, { nodeId: n.id });
      ids[n.id] = true;
      pos[n.id] = { x: n.x, y: n.y, kind: 'user' };
    });
    const allowed = Array.isArray(level.materials) && level.materials.length ? level.materials : null;
    const area = level.buildArea;
    const noBuild = level.noBuild || [];
    const zones = level.pierZones || [];
    const floorY = num((level.terrain || {}).floorY, -1e9);

    (design.nodes || []).forEach((n) => {
      if (area && (n.x < area.x0 - EPS || n.x > area.x1 + EPS || n.y < area.y0 - EPS || n.y > area.y1 + EPS)) {
        err('outside_area', 'Joint outside build area', { nodeId: n.id });
      }
      for (const z of noBuild) if (inRect(n.x, n.y, z, 1e-4)) { err('nobuild', 'Joint in no-build zone', { nodeId: n.id }); break; }
      if (inTerrain(level, n.x, n.y, 0.02)) err('terrain', 'Joint inside terrain', { nodeId: n.id });
    });

    const maxPiers = num(level.maxPiers, zones.length ? 99 : 0);
    if (piers.length > maxPiers) err('too_many_piers', 'Too many piers');
    piers.forEach((p, i) => {
      const okZone = zones.some((z) => p.x >= z.x0 - EPS && p.x <= z.x1 + EPS);
      if (!okZone) err('pier_zone', 'Pier outside pier zone', { nodeId: 'p' + i });
      if (!(p.topY > floorY)) err('pier_height', 'Pier top below floor', { nodeId: 'p' + i });
      if (area && p.topY > area.y1 + EPS) err('outside_area', 'Pier top outside build area', { nodeId: 'p' + i });
      for (const z of noBuild) {
        if (p.x > z.x0 + 1e-4 && p.x < z.x1 - 1e-4 && p.topY > z.y0 + 1e-4 && floorY < z.y1) { err('nobuild', 'Pier in no-build zone', { nodeId: 'p' + i }); break; }
      }
    });

    const pairs = {};
    (design.beams || []).forEach((b, i) => {
      const A = pos[b.a], B = pos[b.b];
      if (!A || !B) { err('missing_node', 'Beam references a missing joint', { beamIndex: i }); return; }
      if (b.a === b.b) { err('zero_length', 'Zero-length beam', { beamIndex: i }); return; }
      const key = b.a < b.b ? b.a + '|' + b.b : b.b + '|' + b.a;
      if (pairs[key]) err('duplicate', 'Duplicate beam', { beamIndex: i });
      pairs[key] = true;
      if (!matDef(b.m)) err('material', 'Unknown material', { beamIndex: i });
      else if (allowed && allowed.indexOf(b.m) < 0) err('material', 'Material not allowed', { beamIndex: i });
      const len = hyp(B.x - A.x, B.y - A.y);
      if (len < 0.05) err('zero_length', 'Zero-length beam', { beamIndex: i });
      if (len > maxLen(b.m) + 1e-6) err('too_long', 'Beam too long', { beamIndex: i });
      for (const z of noBuild) if (segHitsRect(A.x, A.y, B.x, B.y, z, 1e-4)) { err('nobuild', 'Beam crosses no-build zone', { beamIndex: i }); break; }
      for (let k = 1; k < 8; k++) {
        const f = k / 8;
        if (inTerrain(level, A.x + (B.x - A.x) * f, A.y + (B.y - A.y) * f, 0.05)) { err('terrain', 'Beam passes through terrain', { beamIndex: i }); break; }
      }
    });
    return errors;
  }

  function fullCheck(level, design) {
    let errors = checkGeometry(level, design);
    const M = BG.Model;
    if (M && typeof M.validate === 'function') {
      try {
        const r = M.validate(level, design);
        if (r && Array.isArray(r.errors)) errors = errors.concat(r.errors.map((e) => Object.assign({ source: 'model' }, e)));
        else if (r && r.ok === false) errors.push({ type: 'model', msg: 'BG.Model.validate failed', source: 'model' });
      } catch (e) { /* model mid-development: ignore */ }
    }
    return errors;
  }

  // ---------------------------------------------------------------------------
  // Context: road anchors, materials, limits
  // ---------------------------------------------------------------------------
  function findAnchor(anchors, x, y, forced) {
    if (typeof forced === 'string' && /^a\d+$/.test(forced)) {
      const k = +forced.slice(1);
      if (anchors[k]) return k;
    }
    let best = -1, bd = Infinity;
    if (typeof x !== 'number') return -1;
    anchors.forEach((a, i) => {
      const d = hyp(a.x - x, (a.y - num(y, a.y)) * 1.5);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  function makeContext(level, opts) {
    const t = level.terrain || {};
    const anchors = level.anchors || [];
    if (anchors.length < 2) return null;
    let iL = findAnchor(anchors, t.leftEdge, t.leftY, opts.from);
    let iR = findAnchor(anchors, t.rightEdge, t.rightY, opts.to);
    if (iL < 0) iL = 0;
    if (iR < 0 || iR === iL) iR = iL === 1 ? 0 : 1;
    if (anchors[iL].x > anchors[iR].x) { const s = iL; iL = iR; iR = s; }
    const A = anchors[iL], B = anchors[iR];
    const L = B.x - A.x;
    if (!(L > 0.5)) return null;
    const mats = pickMaterials(level, opts);
    const area = level.buildArea || { x0: -1e6, x1: 1e6, y0: -1e6, y1: 1e6 };
    const floorY = num(t.floorY, Math.min(A.y, B.y) - 30);
    const waterY = typeof t.waterY === 'number' ? t.waterY : null;
    const ctx = {
      level, opts, anchors, iL, iR,
      aL: 'a' + iL, aR: 'a' + iR,
      xL: A.x, yL: A.y, xR: B.x, yR: B.y, L,
      mid: (A.x + B.x) / 2,
      road: mats.road, struct: mats.struct, tension: mats.tension, masonry: mats.masonry,
      roadMax: maxLen(mats.road), sMax: maxLen(mats.struct), tMax: maxLen(mats.tension),
      mMax: mats.masonry ? maxLen(mats.masonry) : 0,
      area, floorY, waterY,
      lowY: Math.max(floorY, waterY == null ? -1e9 : waterY) + 0.6,
      zones: level.pierZones || [],
      maxPiers: num(level.maxPiers, 0),
      noBuild: level.noBuild || [],
      existingPiers: (opts.design && Array.isArray(opts.design.piers)) ? opts.design.piers : [],
    };
    ctx.deckY = (x) => A.y + (B.y - A.y) * (x - A.x) / L;
    ctx.deckTop = Math.max(A.y, B.y);
    ctx.deckLow = Math.min(A.y, B.y);
    ctx.capAbove = area.y1 - ctx.deckTop - 0.05;
    ctx.capBelow = ctx.deckLow - Math.max(ctx.lowY, area.y0 + 0.05);
    return ctx;
  }

  // ---------------------------------------------------------------------------
  // Fragment builder
  // ---------------------------------------------------------------------------
  function Frag(ctx) {
    this.ctx = ctx;
    this.nodes = [];
    this.beams = [];
    this.piers = [];
    this._pos = [];
    this._pairs = {};
    this._next = Math.max(1, num(ctx.opts.startId, 1) | 0);
    ctx.anchors.forEach((a, i) => this._pos.push({ id: 'a' + i, x: a.x, y: a.y }));
  }
  Frag.prototype.node = function (x, y) {
    x = r3(x); y = r3(y);
    for (const p of this._pos) if (Math.abs(p.x - x) < 2e-3 && Math.abs(p.y - y) < 2e-3) return p.id;
    const id = 'n' + this._next++;
    this.nodes.push({ id, x, y });
    this._pos.push({ id, x, y });
    return id;
  };
  Frag.prototype.pier = function (x, topY) {
    const id = 'p' + this.piers.length;
    x = r3(x); topY = r3(topY);
    this.piers.push({ x, topY });
    this._pos.push({ id, x, y: topY });
    return id;
  };
  Frag.prototype.pos = function (id) {
    for (const p of this._pos) if (p.id === id) return p;
    return null;
  };
  Frag.prototype.len = function (a, b) {
    const A = this.pos(a), B = this.pos(b);
    return A && B ? hyp(B.x - A.x, B.y - A.y) : 0;
  };
  Frag.prototype.beam = function (a, b, m) {
    if (!a || !b || a === b || !m) return false;
    const key = a < b ? a + '|' + b : b + '|' + a;
    if (this._pairs[key]) return false;
    this._pairs[key] = true;
    this.beams.push({ a, b, m });
    return true;
  };
  // web member: structural if it fits, else tension material
  Frag.prototype.web = function (a, b) {
    const c = this.ctx, l = this.len(a, b);
    if (l <= c.sMax + 1e-9) return this.beam(a, b, c.struct) ? 'struct' : null;
    if (l <= c.tMax + 1e-9) return this.beam(a, b, c.tension) ? 'tension' : null;
    this.beam(a, b, c.struct); // invalid on purpose: lets the search reject this variant
    return 'struct';
  };
  Frag.prototype.out = function () {
    return {
      nodes: this.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y })),
      beams: this.beams.map((b) => ({ a: b.a, b: b.b, m: b.m })),
      piers: this.piers.map((p) => ({ x: p.x, topY: p.topY })),
    };
  };

  function deckX(c, n, i) { return c.xL + (c.L * i) / n; }

  // deck road from left to right anchor in n panels; pierAt: {index:true} → that deck joint is a pier top
  function buildDeck(F, n, pierAt) {
    const c = F.ctx, ids = [], xs = [], ys = [];
    for (let i = 0; i <= n; i++) {
      const x = deckX(c, n, i), y = c.deckY(x);
      xs.push(x); ys.push(y);
      if (i === 0) ids.push(c.aL);
      else if (i === n) ids.push(c.aR);
      else if (pierAt && pierAt[i]) ids.push(F.pier(x, y));
      else ids.push(F.node(x, y));
    }
    for (let i = 0; i < n; i++) F.beam(ids[i], ids[i + 1], c.road);
    return { ids, xs, ys };
  }

  function minPanels(c, limit) {
    return Math.max(2, Math.ceil(c.L / (Math.min(c.roadMax, limit || Infinity) * 0.999)));
  }

  function pierOK(c, x, topY) {
    if (!c.zones.some((z) => x >= z.x0 - EPS && x <= z.x1 + EPS)) return false;
    if (!(topY > c.floorY + 0.5)) return false;
    if (topY > c.area.y1 + EPS) return false;
    for (const z of c.noBuild) if (x > z.x0 - 0.05 && x < z.x1 + 0.05 && topY > z.y0 && c.floorY < z.y1) return false;
    return true;
  }

  // choose a pier position near `target` within [lo,hi]; prefers deck joints and existing piers
  function pickPierX(c, deck, target, lo, hi, H, used) {
    let best = null, bd = Infinity;
    const consider = (x, idx, bonus) => {
      if (x < lo || x > hi) return;
      if (used.some((u) => Math.abs(u - x) < 2)) return;
      const top = c.deckY(x) + H;
      if (!pierOK(c, x, top)) return;
      const d = Math.abs(x - target) - bonus;
      if (d < bd) { bd = d; best = { x, idx }; }
    };
    for (let i = 1; i < deck.xs.length - 1; i++) consider(deck.xs[i], i, 1.5);
    if (!best) {
      c.existingPiers.forEach((p) => consider(p.x, nearestIdx(deck.xs, p.x), 1));
      c.zones.forEach((z) => {
        for (let x = Math.ceil(z.x0 * 2) / 2; x <= z.x1 + EPS; x += 0.5) consider(x, nearestIdx(deck.xs, x), 0);
      });
    }
    return best;
  }
  function nearestIdx(xs, x) {
    let bi = 1, bd = Infinity;
    for (let i = 1; i < xs.length - 1; i++) { const d = Math.abs(xs[i] - x); if (d < bd) { bd = d; bi = i; } }
    return bi;
  }

  // ---------------------------------------------------------------------------
  // Search: try variants, keep the first fully valid one (or the least-bad)
  // ---------------------------------------------------------------------------
  function search(ctx, variants, build) {
    let best = null;
    for (const v of variants) {
      const F = new Frag(ctx);
      let info;
      try { info = build(F, v); } catch (e) { info = false; }
      if (info === false) continue;
      const design = F.out();
      if (!design.beams.length) continue;
      const errors = fullCheck(ctx.level, design);
      const score = errors.length * 100 + ((info && info.penalty) || 0);
      if (!best || score < best.score) best = { score, design, v };
      if (score === 0) break;
    }
    return best ? best.design : null;
  }

  // ---------------------------------------------------------------------------
  // Trusses (warren / pratt / howe) and the girder "beam" template
  // ---------------------------------------------------------------------------
  function trussBuild(kind) {
    return function (F, v) {
      const c = F.ctx, n = v.n, p = c.L / n, s = v.side === 'above' ? 1 : -1;
      const sMax = c.sMax * 0.995;
      const half = kind === 'warren';
      const d = half ? p / 2 : p;
      if (p > sMax) return false;
      let h = Math.min(v.h, Math.sqrt(Math.max(0, sMax * sMax - d * d)));
      if (!half) h = Math.min(h, sMax);
      if (h < 0.6) return false;
      const deck = buildDeck(F, n, v.pierAt);
      const D = deck.ids;
      const Y = (x) => c.deckY(x) + s * h;
      const S = c.struct;
      if (half) {
        const T = [];
        for (let i = 0; i < n; i++) { const x = deckX(c, n, i + 0.5); T.push(F.node(x, Y(x))); }
        for (let i = 0; i < n; i++) {
          F.beam(D[i], T[i], S); F.beam(T[i], D[i + 1], S);
          if (i > 0) F.beam(T[i - 1], T[i], S);
        }
      } else {
        const T = [];
        for (let i = 1; i < n; i++) { const x = deckX(c, n, i); T[i] = F.node(x, Y(x)); }
        F.beam(D[0], T[1], S);
        for (let i = 1; i < n; i++) { F.beam(D[i], T[i], S); if (i > 1) F.beam(T[i - 1], T[i], S); }
        F.beam(T[n - 1], D[n], S);
        const mid = n / 2;
        for (let i = 1; i < n - 1; i++) {
          const left = i + 1 <= mid, right = i >= mid;
          if (kind === 'pratt') {
            if (left || !right) F.beam(T[i], D[i + 1], S);
            if (right || !left) F.beam(T[i + 1], D[i], S);
          } else {
            if (left || !right) F.beam(D[i], T[i + 1], S);
            if (right || !left) F.beam(T[i], D[i + 1], S);
          }
        }
      }
      return { h };
    };
  }

  function trussVariants(c, kind, opts, defaults) {
    const sides = opts.side ? [opts.side] : defaults.sides;
    const scales = [1, 0.8, 0.62, 0.45, 0.32, 0.22];
    const half = kind === 'warren';
    const sMax = c.sMax * 0.995;
    const out = [];
    const n0 = minPanels(c, sMax);
    for (const side of sides) {
      const cap = side === 'above' ? c.capAbove : c.capBelow;
      const h0 = num(opts.depth, defaults.depth);
      for (const sc of scales) {
        const hT = Math.min(h0 * sc, cap);
        if (hT < 0.6) continue;
        const cands = [];
        let bestN = n0, bestH = -1;
        // depth worth adding panels for: never chase depths close to the member limit
        const goal = Math.min(hT, sMax * 0.8);
        for (let n = n0; n <= n0 + 16; n++) {
          const p = c.L / n;
          const d = half ? p / 2 : p;
          let hMax = Math.sqrt(Math.max(0, sMax * sMax - d * d));
          if (!half) hMax = Math.min(hMax, sMax);
          if (hMax > bestH) { bestH = hMax; bestN = n; }
          if (hMax >= goal * 0.98) {
            if (!half && n % 2 === 1) cands.push(n + 1, n); else cands.push(n, n + 1);
            break;
          }
        }
        if (!cands.length) cands.push(bestN);
        for (const n of opts.panels ? [opts.panels | 0] : cands) {
          const v = { side, n, h: hT };
          if (defaults.piers) {
            const pa = beamPiers(c, n);
            if (pa) out.push(Object.assign({}, v, { pierAt: pa }));
          }
          out.push(v);
        }
      }
    }
    return out;
  }

  // piers under deck joints for the girder template
  function beamPiers(c, n) {
    const k = Math.min(c.maxPiers, Math.max(0, Math.ceil(c.L / 18) - 1));
    if (k <= 0 || !c.zones.length) return null;
    const map = {}, usedIdx = [];
    let count = 0;
    for (let j = 1; j <= k; j++) {
      const target = c.xL + (c.L * j) / (k + 1);
      let bi = -1, bd = Infinity;
      for (let i = 1; i < n; i++) {
        if (map[i] || usedIdx.some((u) => Math.abs(u - i) < 2)) continue;
        const x = deckX(c, n, i);
        if (!pierOK(c, x, c.deckY(x))) continue;
        const d = Math.abs(x - target);
        if (d < bd) { bd = d; bi = i; }
      }
      if (bi > 0 && bd < c.L / (k + 1) * 0.6) { map[bi] = true; usedIdx.push(bi); count++; }
    }
    return count ? map : null;
  }

  // ---------------------------------------------------------------------------
  // Arches
  // ---------------------------------------------------------------------------
  // web between deck D[] and arch A[] (A[i] may equal D[i]); diagonals slope symmetric about centre
  function archWeb(F, D, A, n) {
    const c = F.ctx;
    for (let i = 0; i < n; i++) F.beam(A[i], A[i + 1], c.struct);
    for (let i = 1; i < n; i++) if (A[i] !== D[i]) F.web(D[i], A[i]);
    const mid = n / 2;
    for (let i = 0; i < n; i++) {
      const left = i + 1 <= mid, right = i >= mid;
      const d1 = [D[i], A[i + 1]], d2 = [D[i + 1], A[i]];
      const want = [];
      if (left || !right) want.push(d1);
      if (right || !left) want.push(d2);
      for (const d of want) {
        if (d[0] === d[1]) continue;
        const kind = F.web(d[0], d[1]);
        if (kind === 'tension') {
          // tension-only diagonal: brace the panel both ways
          const o = d === d1 ? d2 : d1;
          if (o[0] !== o[1]) F.web(o[0], o[1]);
        }
      }
    }
  }

  function lowerAnchor(c, side) {
    const xE = side === 'L' ? c.xL : c.xR, yE = side === 'L' ? c.yL : c.yR;
    const skip = side === 'L' ? c.iL : c.iR;
    let best = -1, by = Infinity;
    c.anchors.forEach((a, i) => {
      if (i === skip) return;
      if (Math.abs(a.x - xE) > 1.5) return;
      if (!(a.y <= yE - 1.5) || a.y < c.floorY) return;
      if (yE - a.y > c.L * 0.45) return;
      if (a.y < by) { by = a.y; best = i; }
    });
    return best;
  }

  function parab3(x0, y0, x1, y1, x2, y2) {
    return (x) =>
      (y0 * (x - x1) * (x - x2)) / ((x0 - x1) * (x0 - x2)) +
      (y1 * (x - x0) * (x - x2)) / ((x1 - x0) * (x1 - x2)) +
      (y2 * (x - x0) * (x - x1)) / ((x2 - x0) * (x2 - x1));
  }

  function deckArchBuild(F, v) {
    const c = F.ctx, n = v.n;
    if (c.L / n > c.sMax * 0.995) return false;
    const deck = buildDeck(F, n);
    const D = deck.ids, A = [];
    if (v.mode === 'arch') {
      const sl = c.anchors[v.sL], sr = c.anchors[v.sR];
      const xm = (sl.x + sr.x) / 2;
      const yc = c.deckY(xm) - v.g;
      const f = parab3(sl.x, sl.y, xm, yc, sr.x, sr.y);
      A[0] = 'a' + v.sL; A[n] = 'a' + v.sR;
      for (let i = 1; i < n; i++) {
        const x = deck.xs[i];
        if (x <= sl.x + 0.05 || x >= sr.x - 0.05) { A[i] = D[i]; continue; }
        const y = f(x);
        A[i] = deck.ys[i] - y < 0.45 ? D[i] : F.node(x, y);
      }
    } else {
      // fish-belly under-truss: curved bottom chord hung from the road anchors
      A[0] = D[0]; A[n] = D[n];
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const dep = v.h * 4 * t * (1 - t);
        A[i] = dep < 0.45 ? D[i] : F.node(deck.xs[i], deck.ys[i] - dep);
      }
    }
    archWeb(F, D, A, n);
    return {};
  }

  function deckArchVariants(c, opts) {
    const out = [];
    const n0 = minPanels(c, c.sMax * 0.995);
    const sL = lowerAnchor(c, 'L'), sR = lowerAnchor(c, 'R');
    if (sL >= 0 && sR >= 0 && !opts.fishBelly) {
      for (const g of [1, 0.7, 1.5, 2.2]) for (let n = n0; n <= n0 + 10; n++) out.push({ mode: 'arch', n, g, sL, sR });
    }
    const h0 = num(opts.depth, clamp(c.L * 0.16, 2, 14));
    for (const sc of [1, 0.75, 0.55, 0.4, 0.28]) {
      const h = Math.min(h0 * sc, c.capBelow);
      if (h < 0.8) continue;
      for (let n = n0; n <= n0 + 8; n++) out.push({ mode: 'belly', n, h });
    }
    return out;
  }

  function throughArchBuild(F, v) {
    const c = F.ctx, n = v.n;
    if (c.L / n > c.sMax * 0.995) return false;
    const deck = buildDeck(F, n);
    const D = deck.ids, A = [];
    A[0] = D[0]; A[n] = D[n];
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const rise = v.R * 4 * t * (1 - t);
      A[i] = rise < 0.45 ? D[i] : F.node(deck.xs[i], deck.ys[i] + rise);
    }
    archWeb(F, D, A, n);
    return {};
  }

  function throughArchVariants(c, opts) {
    const out = [];
    const n0 = minPanels(c, c.sMax * 0.995);
    const R0 = num(opts.depth, clamp(c.L * 0.2, 3, 32));
    for (const sc of [1, 0.8, 0.62, 0.48, 0.36, 0.26]) {
      const R = Math.min(R0 * sc, c.capAbove);
      if (R < 1) continue;
      for (let n = n0; n <= n0 + 10; n++) out.push({ n, R });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Towers (shared by suspension & cable-stayed)
  // ---------------------------------------------------------------------------
  // bank tower: braced steel post above a road anchor
  function bankTower(F, deck, side, H) {
    const c = F.ctx, n = deck.ids.length - 1;
    const p = c.L / n;
    const sMax = c.sMax * 0.995;
    const h = Math.min(H, sMax, Math.sqrt(Math.max(0, sMax * sMax - p * p)));
    if (h < 1.5) return null;
    const left = side === 'L';
    const base = left ? deck.ids[0] : deck.ids[n];
    const bx = left ? c.xL : c.xR, by = left ? c.yL : c.yR;
    const T = F.node(bx, by + h);
    F.beam(base, T, c.struct);
    F.beam(T, left ? deck.ids[1] : deck.ids[n - 1], c.struct);
    // backstay to an anchor further back on the same bank
    let best = -1, bd = Infinity;
    c.anchors.forEach((a, i) => {
      const behind = left ? a.x < bx - 1 : a.x > bx + 1;
      if (!behind) return;
      const l = hyp(a.x - bx, a.y - (by + h));
      if (l <= c.tMax * 0.995 && l < bd) { bd = l; best = i; }
    });
    if (best >= 0) F.beam(T, 'a' + best, c.tension);
    return { id: T, x: bx, y: by + h, idx: left ? 0 : n, bank: true };
  }

  function pierTower(F, deck, target, lo, hi, H, used) {
    const c = F.ctx;
    const pick = pickPierX(c, deck, target, lo, hi, H, used);
    if (!pick) return null;
    used.push(pick.x);
    const top = c.deckY(pick.x) + H;
    const id = F.pier(pick.x, top);
    const dk = deck.ids[pick.idx];
    // the deck joint beside the tower hangs from the tower top
    F.web(dk, id);
    return { id, x: pick.x, y: top, idx: pick.idx, bank: false };
  }

  function suspensionBuild(F, v) {
    const c = F.ctx, n = v.n;
    if (c.L / n > c.roadMax * 1.0001) return false;
    const deck = buildDeck(F, n);
    const D = deck.ids, xs = deck.xs, ys = deck.ys;
    const used = [];
    let TL = null, TR = null;
    if (v.towers === 'piers') {
      if (c.maxPiers < 2) return false;
      TL = pierTower(F, deck, c.xL + c.L * 0.22, c.xL + c.L * 0.08, c.xL + c.L * 0.42, v.H, used);
      TR = pierTower(F, deck, c.xR - c.L * 0.22, c.xR - c.L * 0.42, c.xR - c.L * 0.08, v.H, used);
      if (!TL || !TR) return false; // one-sided towers look and behave poorly: use bank towers instead
    }
    if (!TL) TL = bankTower(F, deck, 'L', v.Hb);
    if (!TR) TR = bankTower(F, deck, 'R', v.Hb);
    if (!TL || !TR) return false;
    const T = c.tension;
    const clear = 1.2;
    const xm = (TL.x + TR.x) / 2;
    const lin = (x) => TL.y + (TR.y - TL.y) * (x - TL.x) / (TR.x - TL.x);
    const sag = lin(xm) - (c.deckY(xm) + clear);
    let penalty = 0;
    if (sag < 0.8) penalty += 20;
    const cab = (x) => { const u = (x - TL.x) / (TR.x - TL.x); return lin(x) - Math.max(0, sag) * 4 * u * (1 - u); };
    // main span cable
    let prev = TL.id;
    const C = [];
    for (let i = 1; i < n; i++) {
      if (xs[i] <= TL.x + 0.05 || xs[i] >= TR.x - 0.05) continue;
      const y = cab(xs[i]);
      if (y - ys[i] < 0.5) { C[i] = D[i]; } else C[i] = F.node(xs[i], y);
      F.beam(prev, C[i], T);
      prev = C[i];
    }
    F.beam(prev, TR.id, T);
    // side spans: straight backstay cables from tower tops down to the road anchors
    const side = (tw, fromIdx, toIdx, anchorId) => {
      const ax = c.anchors[+anchorId.slice(1)].x, ay = c.anchors[+anchorId.slice(1)].y;
      let p2 = anchorId;
      const step = fromIdx <= toIdx ? 1 : -1;
      for (let i = fromIdx; step > 0 ? i <= toIdx : i >= toIdx; i += step) {
        if (i <= 0 || i >= n || i === tw.idx) continue;
        const y = ay + (tw.y - ay) * (xs[i] - ax) / (tw.x - ax);
        if (y - ys[i] < 0.5) continue;
        C[i] = F.node(xs[i], y);
        F.beam(p2, C[i], T);
        p2 = C[i];
      }
      F.beam(p2, tw.id, T);
    };
    if (!TL.bank) side(TL, 1, TL.idx - (Math.abs(xs[TL.idx] - TL.x) < 0.05 ? 1 : 0), c.aL);
    if (!TR.bank) side(TR, n - 1, TR.idx + (Math.abs(xs[TR.idx] - TR.x) < 0.05 ? 1 : 0), c.aR);
    // hangers: verticals + one inclined hanger per panel (triangulates the deck/cable network)
    const mid = n / 2;
    for (let i = 1; i < n; i++) if (C[i] && C[i] !== D[i]) F.beam(D[i], C[i], T);
    for (let i = 1; i < n - 1; i++) {
      if (!C[i] || !C[i + 1]) continue;
      if (i + 1 <= mid) F.beam(D[i], C[i + 1], T);
      else if (i >= mid) F.beam(D[i + 1], C[i], T);
      else { F.beam(D[i], C[i + 1], T); F.beam(D[i + 1], C[i], T); }
    }
    return { penalty };
  }

  function suspensionVariants(c, opts) {
    const out = [];
    const n0 = minPanels(c);
    const usePiers = c.maxPiers >= 1 && c.zones.length && opts.towers !== 'bank';
    const Hp0 = num(opts.height, clamp(c.L * 0.15, 5, 28));
    const Hb0 = c.sMax;
    const modes = usePiers ? ['piers', 'bank'] : ['bank'];
    for (const towers of modes) {
      for (const sc of [1, 0.8, 0.62, 0.45]) {
        const H = Math.min(Hp0 * sc, c.capAbove);
        if (H < 2.5) continue;
        for (let n = n0; n <= n0 + 6; n++) out.push({ towers, n, H, Hb: Math.min(Hb0, c.capAbove) * Math.max(sc, 0.6) });
      }
    }
    return out;
  }

  function cableStayedBuild(F, v) {
    const c = F.ctx, n = v.n;
    if (c.L / n > c.roadMax * 1.0001) return false;
    const deck = buildDeck(F, n);
    const D = deck.ids, xs = deck.xs, ys = deck.ys;
    const used = [];
    const towers = [];
    if (v.mode === 'center' && c.maxPiers >= 1) {
      const t = pierTower(F, deck, c.mid, c.mid - c.L * 0.25, c.mid + c.L * 0.25, v.H, used);
      if (!t) return false;
      towers.push(t);
    } else if (v.mode === 'pair' && c.maxPiers >= 2) {
      const a = pierTower(F, deck, c.xL + c.L * 0.27, c.xL + c.L * 0.1, c.mid - 2, v.H, used);
      const b = pierTower(F, deck, c.xR - c.L * 0.27, c.mid + 2, c.xR - c.L * 0.1, v.H, used);
      if (!a || !b) return false;
      towers.push(a, b);
    } else if (v.mode !== 'bank') return false;
    const reach = (t, i) => {
      const dx = Math.abs(xs[i] - t.x), dy = t.y - ys[i];
      if (dy < 0.8) return Infinity;
      if (dx > 0.05 && dy / dx < 0.16) return Infinity;
      const l = hyp(dx, dy);
      return l <= c.tMax * 0.995 ? l : Infinity;
    };
    const hasTower = (i) => towers.some((t) => t.idx === i);
    const unreachable = () => {
      let k = 0;
      for (let i = 1; i < n; i++) if (!hasTower(i) && towers.every((t) => reach(t, i) === Infinity)) k++;
      return k;
    };
    if (v.mode === 'bank' || unreachable() > 0) {
      const tl = bankTower(F, deck, 'L', v.Hb), tr = bankTower(F, deck, 'R', v.Hb);
      if (tl) towers.push(tl);
      if (tr) towers.push(tr);
    }
    let missing = 0;
    for (let i = 1; i < n; i++) {
      if (hasTower(i)) continue;
      const bankBraced = towers.some((t) => t.bank && Math.abs(t.idx - i) === 1);
      if (bankBraced) continue;
      let best = null, bd = Infinity;
      for (const t of towers) {
        const l = reach(t, i);
        const d = Math.abs(xs[i] - t.x);
        if (l < Infinity && d < bd) { bd = d; best = t; }
      }
      if (best) F.beam(D[i], best.id, c.tension); else missing++;
    }
    return { penalty: missing * 15 };
  }

  function cableStayedVariants(c, opts) {
    const out = [];
    const n0 = minPanels(c);
    const modes = [];
    if (c.maxPiers >= 1 && c.zones.length && opts.towers !== 'bank') {
      if (c.maxPiers >= 2 && c.L >= 70) modes.push('pair', 'center'); else modes.push('center', 'pair');
    }
    modes.push('bank');
    const H0 = num(opts.height, clamp(c.L * 0.24, 5, 32));
    for (const mode of modes) {
      for (const sc of [1, 0.8, 0.62, 0.45]) {
        const H = Math.min(H0 * sc, c.capAbove);
        if (H < 2.5) continue;
        for (let n = n0; n <= n0 + 4; n++) out.push({ mode, n, H, Hb: Math.min(c.sMax, c.capAbove) });
        if (mode === 'bank') break;
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Viaduct: a row of masonry arches carrying the deck on spandrel columns. The arches spring from
  // piers in the pier zones (their tops a little below the deck), and at the ends from the low cliff
  // anchors when there are any (else straight from the road anchors). Without piers: one big arch
  // between the low cliff anchors.
  // ---------------------------------------------------------------------------
  function viaductBuild(F, v) {
    const c = F.ctx, n = v.n;
    const M = c.masonry || c.struct;
    const mMax = maxLen(M) * 0.995;
    if (c.L / n > c.roadMax * 1.0001) return false;
    if (v.k - 1 > c.maxPiers) return false;
    const brace = v.brace && c.struct && c.struct !== M ? c.struct : null;
    const deck = buildDeck(F, n);
    const D = deck.ids, xs = deck.xs, ys = deck.ys;
    // columns: masonry when short enough, else the structural material if it reaches
    const post = (a, b) => {
      const l = F.len(a, b);
      if (l > mMax && c.struct && c.struct !== M && l <= c.sMax * 0.995) return F.beam(a, b, c.struct);
      return F.beam(a, b, M);
    };
    const anchorSup = (i) => ({ id: 'a' + i, x: c.anchors[i].x, y: c.anchors[i].y });
    const sup = [v.lowL >= 0 ? anchorSup(v.lowL) : { id: c.aL, x: c.xL, y: c.yL }];
    const A = D.slice(); // arch joint under each deck joint (the deck joint itself where they meet)
    const used = [];
    for (let j = 1; j < v.k; j++) {
      const target = c.xL + (c.L * j) / v.k, w = (c.L / v.k) * 0.35;
      const pick = pickPierX(c, deck, target, target - w, target + w, -v.rise, used);
      if (!pick) return false;
      used.push(pick.x);
      const top = c.deckY(pick.x) - v.rise;
      const id = F.pier(pick.x, top);
      if (Math.abs(xs[pick.idx] - pick.x) < 0.05) { post(D[pick.idx], id); A[pick.idx] = id; }
      sup.push({ id, x: pick.x, y: top });
    }
    sup.push(v.lowR >= 0 ? anchorSup(v.lowR) : { id: c.aR, x: c.xR, y: c.yR });
    const crowns = [];
    for (let s = 0; s < sup.length - 1; s++) {
      const s0 = sup[s], s1 = sup[s + 1];
      if (!(s1.x - s0.x > 1)) return false;
      const xm = (s0.x + s1.x) / 2;
      const yc = c.deckY(xm) - v.crown;
      const hi = Math.max(s0.y, s1.y);
      let f;
      if (yc > hi + 0.3) f = parab3(s0.x, s0.y, xm, yc, s1.x, s1.y);
      else {
        // one springing is level with the deck (a bank): half arch, horizontal at the high end
        const top = s0.y >= s1.y ? s0 : s1, bot = top === s0 ? s1 : s0;
        f = (x) => { const u = (x - top.x) / (bot.x - top.x); return top.y - (top.y - bot.y) * u * u; };
      }
      crowns.push({ x0: s0.x, x1: s1.x, xm: yc > hi + 0.3 ? xm : (s0.y >= s1.y ? s0.x : s1.x) });
      let prev = s0.id;
      for (let i = 1; i < n; i++) {
        const x = xs[i];
        if (x <= s0.x + 0.05 || x >= s1.x - 0.05) continue;
        const y = Math.min(f(x), ys[i]);
        const id = ys[i] - y < 0.7 ? D[i] : F.node(x, y);
        A[i] = id;
        if (id !== D[i]) post(D[i], id);
        F.beam(prev, id, M);
        prev = id;
      }
      F.beam(prev, s1.id, M);
    }
    // light diagonal bracing in the spandrels, sloping down toward each arch's crown
    if (brace) {
      const bMax = c.sMax * 0.995;
      for (let i = 0; i < n; i++) {
        const pc = (xs[i] + xs[i + 1]) / 2;
        const cr = crowns.find((q) => pc >= q.x0 - 0.05 && pc <= q.x1 + 0.05);
        if (!cr) continue;
        const d = pc < cr.xm ? [D[i], A[i + 1]] : [D[i + 1], A[i]];
        if (d[0] === d[1] || D.indexOf(d[1]) >= 0) continue;
        if (F.len(d[0], d[1]) <= bMax) F.beam(d[0], d[1], brace);
      }
    }
    return {};
  }

  function viaductVariants(c, opts) {
    const out = [];
    const M = c.masonry || c.struct;
    const mMax = maxLen(M);
    const lowL = lowerAnchor(c, 'L'), lowR = lowerAnchor(c, 'R');
    const n0 = Math.max(2, Math.ceil(c.L / (Math.min(c.roadMax, mMax * 0.8) * 0.999)));
    const braces = c.struct && c.struct !== M ? [true, false] : [false];
    if (c.maxPiers >= 1 && c.zones.length && opts.towers !== 'bank') {
      const kMax = Math.min(c.maxPiers + 1, 14);
      for (const rf of [0.9, 0.7, 1.4]) {
        const rise = num(opts.depth, mMax * rf);
        const kIdeal = clamp(Math.round(c.L / (rise * 3.2)), 2, kMax);
        const ks = [kIdeal, kIdeal + 1, kIdeal - 1, kMax].filter((k, i, a) => k >= 2 && k <= kMax && a.indexOf(k) === i);
        for (const k of ks) for (const brace of braces) for (let n = n0; n <= n0 + 2; n++) out.push({ n, k, rise, crown: 0, brace, lowL, lowR });
      }
    }
    if (lowL >= 0 && lowR >= 0) {
      for (const crown of [0, 1]) for (const brace of braces) for (let n = n0; n <= n0 + 6; n++) out.push({ n, k: 1, rise: 0, crown, brace, lowL, lowR });
    }
    return out;
  }
  // does this crossing offer what a viaduct springs from (piers, or low anchors on both banks)?
  function viaductSupports(c) {
    return (c.maxPiers >= 1 && c.zones.length > 0) || (lowerAnchor(c, 'L') >= 0 && lowerAnchor(c, 'R') >= 0);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  const LIST = [
    { id: 'beam', name: 'Beam', desc: 'Straight deck on a shallow girder, resting on piers where the level allows them.' },
    { id: 'warren', name: 'Warren Truss', desc: 'Equilateral zig-zag of diagonals. Light, simple and evenly loaded.' },
    { id: 'pratt', name: 'Pratt Truss', desc: 'Verticals with diagonals sloping toward the centre: diagonals work in tension.' },
    { id: 'howe', name: 'Howe Truss', desc: 'Verticals with diagonals sloping toward the banks: diagonals work in compression.' },
    { id: 'deck_arch', name: 'Deck Arch', desc: 'An arch below the road pushes up through columns. Springs from low anchors when available.' },
    { id: 'through_arch', name: 'Through Arch', desc: 'A tied arch rising over the road, with the deck hung beneath it.' },
    { id: 'suspension', name: 'Suspension', desc: 'Main cables draped over two towers carry the deck on hangers.' },
    { id: 'cable_stayed', name: 'Cable-Stayed', desc: 'Straight stays fan out from tall towers directly to the deck.' },
    { id: 'viaduct', name: 'Viaduct', desc: 'A row of masonry arches on piers carries the deck on stone columns. Stone loves compression.' },
  ];

  function generate(id, level, opts) {
    opts = opts || {};
    const empty = { nodes: [], beams: [], piers: [] };
    if (!level) return empty;
    const c = makeContext(level, opts);
    if (!c) return empty;
    let design = null;
    switch (id) {
      case 'beam':
        design = search(c, trussVariants(c, 'warren', opts, { sides: ['below', 'above'], depth: clamp(c.L / 14, 1.2, 2.5), piers: true }), trussBuild('warren'));
        break;
      case 'warren':
      case 'pratt':
      case 'howe':
        design = search(c, trussVariants(c, id, opts, { sides: ['above', 'below'], depth: clamp(c.L * 0.13, 2, 12) }), trussBuild(id));
        break;
      case 'deck_arch':
        design = search(c, deckArchVariants(c, opts), deckArchBuild);
        break;
      case 'through_arch':
        design = search(c, throughArchVariants(c, opts), throughArchBuild);
        break;
      case 'suspension':
        design = search(c, suspensionVariants(c, opts), suspensionBuild);
        break;
      case 'cable_stayed':
        design = search(c, cableStayedVariants(c, opts), cableStayedBuild);
        break;
      case 'viaduct':
        design = search(c, viaductVariants(c, opts), viaductBuild);
        break;
      default:
        return empty;
    }
    if (!design) {
      // last resort: a plain deck so the player always gets something editable
      const F = new Frag(c);
      buildDeck(F, minPanels(c));
      design = F.out();
    }
    return design;
  }

  // Which templates make sense for this level (all ids, flagged). A template whose best variant
  // still breaks the level's rules (no-build zones, max lengths...) is flagged ok:false with a reason.
  function available(level) {
    const allowed = allowedMaterials(level);
    const hasT = allowed.indexOf('cable') >= 0 || allowed.indexOf('rope') >= 0;
    const hasM = allowed.indexOf('masonry') >= 0;
    const ctx = level ? makeContext(level, {}) : null;
    return LIST.map((t) => {
      let ok = true, reason = null;
      if ((t.id === 'suspension' || t.id === 'cable_stayed') && !hasT) { ok = false; reason = 'needs rope or cable'; }
      if (t.id === 'viaduct') {
        if (!hasM) { ok = false; reason = 'needs masonry'; }
        else if (!ctx || !viaductSupports(ctx)) { ok = false; reason = 'needs piers or low cliff anchors'; }
      }
      if (ok && level) {
        let d = null;
        try { d = generate(t.id, level, {}); } catch (e) { d = null; }
        if (!d || !d.beams.length || fullCheck(level, d).length) { ok = false; reason = "doesn't fit this crossing"; }
      }
      return Object.assign({}, t, { ok, reason });
    });
  }

  BG.Templates = {
    list: LIST,
    generate,
    available,
    checkGeometry,
    validate: (level, design) => { const errors = fullCheck(level, design); return { ok: errors.length === 0, errors }; },
    roadAnchors: (level) => { const c = makeContext(level, {}); return c ? { left: c.aL, right: c.aR } : null; },
    materialsFor: (level, opts) => pickMaterials(level, opts || {}),
  };
})(typeof window !== 'undefined' ? window : globalThis);
