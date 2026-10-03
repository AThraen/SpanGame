/* SPAN — design model helpers (BG.Model): node lookup, cost, validation, serialization.
 * Pure data, no DOM. Node ids: anchors 'a<i>', pier tops 'p<i>', user joints 'n<int>'. */
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});
  const EPS = 1e-6;

  function mats() { return BG.Materials || {}; }
  function costs() { return BG.Costs || { joint: 0, pierBase: 1000, pierPerMeter: 250 }; }
  function hyp(x, y) { return Math.sqrt(x * x + y * y); }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

  function emptyDesign() { return { nodes: [], beams: [], piers: [] }; }

  function floorY(level) { return num(level && level.terrain && level.terrain.floorY, -10); }

  /** All joints: anchors, pier tops, user nodes -> [{id,x,y,fixed,kind}] */
  function allNodes(level, design) {
    const out = [];
    const anchors = (level && level.anchors) || [];
    for (let i = 0; i < anchors.length; i++) {
      out.push({ id: 'a' + i, x: anchors[i].x, y: anchors[i].y, fixed: true, kind: 'anchor' });
    }
    const piers = (design && design.piers) || [];
    for (let i = 0; i < piers.length; i++) {
      out.push({ id: 'p' + i, x: piers[i].x, y: piers[i].topY, fixed: true, kind: 'pier' });
    }
    const nodes = (design && design.nodes) || [];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      out.push({ id: n.id, x: n.x, y: n.y, fixed: false, kind: 'node' });
    }
    return out;
  }

  function nodeMap(level, design) {
    const m = new Map();
    const all = allNodes(level, design);
    for (const n of all) if (!m.has(n.id)) m.set(n.id, n);
    return m;
  }

  function findNode(level, design, id) { return nodeMap(level, design).get(id) || null; }

  function beamLength(level, design, beam, map) {
    const m = map || nodeMap(level, design);
    const a = m.get(beam.a), b = m.get(beam.b);
    if (!a || !b) return 0;
    return hyp(b.x - a.x, b.y - a.y);
  }

  function beamCost(level, design, beam, map) {
    const mat = mats()[beam.m];
    if (!mat) return 0;
    return mat.costPerMeter * beamLength(level, design, beam, map);
  }

  function pierCost(level, pier) {
    const c = costs();
    const h = Math.max(0, pier.topY - floorY(level));
    return c.pierBase + c.pierPerMeter * h;
  }

  function cost(level, design) {
    const map = nodeMap(level, design);
    let b = 0, p = 0;
    for (const beam of (design && design.beams) || []) b += beamCost(level, design, beam, map);
    for (const pier of (design && design.piers) || []) p += pierCost(level, pier);
    const nUser = ((design && design.nodes) || []).length;
    b += (costs().joint || 0) * nUser;
    const beams = Math.round(b), piers = Math.round(p);
    return { total: beams + piers, beams, piers };
  }

  /** Does segment (x1,y1)-(x2,y2) pass through the open interior of rect r? (Liang–Barsky) */
  function segmentHitsRect(x1, y1, x2, y2, r) {
    const rx0 = Math.min(r.x0, r.x1) + EPS, rx1 = Math.max(r.x0, r.x1) - EPS;
    const ry0 = Math.min(r.y0, r.y1) + EPS, ry1 = Math.max(r.y0, r.y1) - EPS;
    if (rx0 >= rx1 || ry0 >= ry1) return false;
    let t0 = 0, t1 = 1;
    const dx = x2 - x1, dy = y2 - y1;
    const p = [-dx, dx, -dy, dy];
    const q = [x1 - rx0, rx1 - x1, y1 - ry0, ry1 - y1];
    for (let i = 0; i < 4; i++) {
      if (Math.abs(p[i]) < 1e-12) { if (q[i] < 0) return false; }
      else {
        const t = q[i] / p[i];
        if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
        else { if (t < t0) return false; if (t < t1) t1 = t; }
      }
    }
    return t1 - t0 > 1e-9;
  }

  function pointInRect(x, y, r) {
    return x > Math.min(r.x0, r.x1) + EPS && x < Math.max(r.x0, r.x1) - EPS &&
      y > Math.min(r.y0, r.y1) + EPS && y < Math.max(r.y0, r.y1) - EPS;
  }

  /** True when (x,y) is strictly inside solid ground (bank or below the valley floor). */
  function inTerrain(level, x, y, tol) {
    const t = (level && level.terrain) || {};
    const e = tol == null ? 0.05 : tol;
    const fy = num(t.floorY, -10);
    if (y < fy - e) return true;
    if (x < num(t.leftEdge, 0) - e && y < num(t.leftY, 0) - e) return true;
    if (x > num(t.rightEdge, 0) + e && y < num(t.rightY, 0) - e) return true;
    return false;
  }

  /** Solid ground regions as rectangles (left bank, right bank, below the valley floor). */
  function terrainRects(level) {
    const t = (level && level.terrain) || {};
    const B = 1e6, fy = num(t.floorY, -10);
    return [
      { x0: -B, x1: num(t.leftEdge, 0), y0: -B, y1: num(t.leftY, 0) },
      { x0: num(t.rightEdge, 0), x1: B, y0: -B, y1: num(t.rightY, 0) },
      { x0: -B, x1: B, y0: -B, y1: fy },
    ];
  }

  /** Does the beam (x1,y1)-(x2,y2) cut through solid ground? (grazing within tol is allowed) */
  function segmentInTerrain(level, x1, y1, x2, y2, tol) {
    const e = tol == null ? 0.05 : tol;
    for (const r of terrainRects(level)) {
      const rr = { x0: r.x0 + e, x1: r.x1 - e, y0: r.y0 + e, y1: r.y1 - e };
      if (segmentHitsRect(x1, y1, x2, y2, rr)) return true;
    }
    return false;
  }

  /** Distance from (x,y) to the nearest terrain surface (bank tops, cliff faces, valley floor). */
  function terrainDistance(level, x, y) {
    const t = (level && level.terrain) || {};
    const L = num(t.leftEdge, 0), R = num(t.rightEdge, 0), ly = num(t.leftY, 0), ry = num(t.rightY, 0), fy = num(t.floorY, -10);
    const segs = [[L - 1e6, ly, L, ly], [L, ly, L, fy], [L, fy, R, fy], [R, fy, R, ry], [R, ry, R + 1e6, ry]];
    let best = Infinity;
    for (const [ax, ay, bx, by] of segs) {
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      let u = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const d = hyp(x - ax - u * dx, y - ay - u * dy);
      if (d < best) best = d;
    }
    return best;
  }

  /** User joints must keep this clearance from the ground: only anchors and piers may bear on rock. */
  const TERRAIN_CLEARANCE = 0.5;
  /** Rail beams steeper than this (|dy/dx|) are invalid: track is never a diagonal or a post.
   *  (Trains already derail above level.rail.maxGrade, default 6 %.) */
  const RAIL_MAX_SLOPE = 0.25;

  // terrain-fix: nothing but piers and anchors may stand below the waterline (water or lava).
  /** True when (x,y) lies below the level's water surface (false on dry levels). */
  function belowWater(level, x, y, tol) {
    const t = (level && level.terrain) || {};
    if (typeof t.waterY !== 'number' || !isFinite(t.waterY)) return false;
    return y < t.waterY - (tol == null ? EPS : tol);
  }
  const UNDERWATER_MSG = "Can't build under water — use a pier";

  /** The two main road anchors (left/right bank edge) -> {left:'a<i>', right:'a<j>'} */
  function roadAnchors(level) {
    const t = (level && level.terrain) || {};
    const anchors = (level && level.anchors) || [];
    let li = -1, ri = -1, ld = Infinity, rd = Infinity;
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const dl = hyp(a.x - num(t.leftEdge, 0), a.y - num(t.leftY, 0));
      const dr = hyp(a.x - num(t.rightEdge, 0), a.y - num(t.rightY, 0));
      if (dl < ld) { ld = dl; li = i; }
      if (dr < rd) { rd = dr; ri = i; }
    }
    return { left: li >= 0 ? 'a' + li : null, right: ri >= 0 ? 'a' + ri : null };
  }

  /** Which deck kinds the level's traffic needs -> {road, rail}. No traffic counts as road. */
  function trafficKinds(level) {
    let road = false, rail = false;
    for (const g of (level && level.traffic) || []) {
      if (g && g.type === 'train') rail = true; else road = true;
    }
    if (!road && !rail) road = true;
    return { road, rail };
  }

  /** Is there a continuous deck of the given kind ('road': road / reinforced road beams,
   *  'rail': rail beams) from the left road anchor to the right one? */
  function deckConnected(level, design, kind) {
    const ra = roadAnchors(level);
    if (!ra.left || !ra.right) return false;
    if (ra.left === ra.right) return true;
    const rail = kind === 'rail';
    const adj = new Map();
    for (const b of (design && design.beams) || []) {
      const mat = mats()[b && b.m];
      if (!mat || !(rail ? mat.isRail : mat.isRoad) || b.a === b.b) continue;
      if (!adj.has(b.a)) adj.set(b.a, []);
      if (!adj.has(b.b)) adj.set(b.b, []);
      adj.get(b.a).push(b.b); adj.get(b.b).push(b.a);
    }
    const seen = new Set([ra.left]), queue = [ra.left];
    while (queue.length) {
      const id = queue.shift();
      if (id === ra.right) return true;
      for (const o of adj.get(id) || []) if (!seen.has(o)) { seen.add(o); queue.push(o); }
    }
    return false;
  }

  function railConnected(level, design) { return deckConnected(level, design, 'rail'); }

  /** Every deck the level's traffic needs is continuous bank to bank (road levels: the road;
   *  rail levels: the rail; double-deck levels: both). */
  function roadConnected(level, design) {
    const k = trafficKinds(level);
    if (k.road && !deckConnected(level, design, 'road')) return false;
    if (k.rail && !deckConnected(level, design, 'rail')) return false;
    return true;
  }

  /** Derailment limits for a level (SPEC §9.1: optional level.rail overrides). */
  function railRules(level) {
    const R = BG.RailRules || {};
    const o = (level && level.rail) || {};
    return { maxGrade: num(o.maxGrade, num(R.maxGrade, 0.06)), maxKinkDeg: num(o.maxKinkDeg, num(R.maxKinkDeg, 4)) };
  }

  function nextNodeId(design) {
    let max = 0;
    for (const n of (design && design.nodes) || []) {
      const m = /^n(\d+)$/.exec(n.id);
      if (m) max = Math.max(max, +m[1]);
    }
    return 'n' + (max + 1);
  }

  function validate(level, design) {
    const errors = [];
    const lv = level || {};
    const ba = lv.buildArea;
    const noBuild = lv.noBuild || [];
    const allowed = lv.materials || Object.keys(mats());
    const d = design || emptyDesign();
    const map = new Map();
    for (const n of allNodes(lv, { nodes: [], piers: d.piers || [] })) map.set(n.id, n);

    // user nodes
    for (const n of d.nodes || []) {
      if (!n || typeof n.id !== 'string' || !/^n\d+$/.test(n.id)) {
        errors.push({ type: 'bad_node', msg: 'Invalid joint id', nodeId: n && n.id });
        continue;
      }
      if (map.has(n.id)) { errors.push({ type: 'duplicate_node', msg: 'Duplicate joint id ' + n.id, nodeId: n.id }); continue; }
      if (!isFinite(n.x) || !isFinite(n.y)) { errors.push({ type: 'bad_node', msg: 'Joint has an invalid position', nodeId: n.id }); continue; }
      map.set(n.id, { id: n.id, x: n.x, y: n.y, fixed: false });
      if (ba && (n.x < ba.x0 - EPS || n.x > ba.x1 + EPS || n.y < ba.y0 - EPS || n.y > ba.y1 + EPS)) {
        errors.push({ type: 'outside_build_area', msg: 'Joint outside the build area', nodeId: n.id });
      }
      for (const r of noBuild) {
        if (pointInRect(n.x, n.y, r)) { errors.push({ type: 'in_nobuild', msg: 'Joint inside a no-build zone', nodeId: n.id }); break; }
      }
      if (inTerrain(lv, n.x, n.y, 0.05)) errors.push({ type: 'in_terrain', msg: 'Joint is inside the ground', nodeId: n.id });
      else if (terrainDistance(lv, n.x, n.y) < TERRAIN_CLEARANCE - EPS) errors.push({ type: 'near_terrain', msg: 'Joints must stay ' + TERRAIN_CLEARANCE + ' m clear of the ground (use an anchor or a pier)', nodeId: n.id });
      // terrain-fix: user joints may not go below the waterline (a beam's lowest point is an endpoint,
      // so this also keeps beams out of the water unless they end on an anchor or a pier top)
      if (belowWater(lv, n.x, n.y)) errors.push({ type: 'underwater', msg: UNDERWATER_MSG, nodeId: n.id });
    }

    // piers
    const piers = d.piers || [];
    const zones = lv.pierZones || [];
    const maxP = num(lv.maxPiers, 0);
    if (piers.length > maxP) errors.push({ type: 'too_many_piers', msg: 'Too many piers (max ' + maxP + ')' });
    const fy = floorY(lv);
    for (let i = 0; i < piers.length; i++) {
      const p = piers[i];
      const id = 'p' + i;
      if (!p || !isFinite(p.x) || !isFinite(p.topY)) { errors.push({ type: 'bad_pier', msg: 'Invalid pier', nodeId: id, pierIndex: i }); continue; }
      let inZone = false;
      for (const z of zones) if (p.x >= Math.min(z.x0, z.x1) - EPS && p.x <= Math.max(z.x0, z.x1) + EPS) { inZone = true; break; }
      if (!inZone) errors.push({ type: 'pier_out_of_zone', msg: 'Piers must stand in a pier zone', nodeId: id, pierIndex: i });
      if (p.topY < fy + 0.5) errors.push({ type: 'pier_too_short', msg: 'Pier is too short', nodeId: id, pierIndex: i });
      if (ba && p.topY > ba.y1 + EPS) errors.push({ type: 'outside_build_area', msg: 'Pier rises above the build area', nodeId: id, pierIndex: i });
      for (const r of noBuild) {
        if (segmentHitsRect(p.x, fy, p.x, p.topY, r) || pointInRect(p.x, p.topY, r)) {
          errors.push({ type: 'in_nobuild', msg: 'Pier enters a no-build zone', nodeId: id, pierIndex: i }); break;
        }
      }
    }

    // beams
    const seen = new Set();
    const beams = d.beams || [];
    for (let i = 0; i < beams.length; i++) {
      const b = beams[i];
      const mat = b && mats()[b.m];
      if (!mat) { errors.push({ type: 'unknown_material', msg: 'Unknown material', beamIndex: i }); continue; }
      if (allowed.indexOf(b.m) < 0) errors.push({ type: 'material_not_allowed', msg: mat.name + ' is not available here', beamIndex: i });
      const na = map.get(b.a), nb = map.get(b.b);
      if (!na || !nb) { errors.push({ type: 'missing_node', msg: 'Beam references a missing joint', beamIndex: i }); continue; }
      const len = hyp(nb.x - na.x, nb.y - na.y);
      if (b.a === b.b || len < 0.05) { errors.push({ type: 'zero_length', msg: 'Beam has zero length', beamIndex: i }); continue; }
      if (len > mat.maxLength + 1e-6) errors.push({ type: 'too_long', msg: mat.name + ' max length is ' + mat.maxLength + ' m', beamIndex: i });
      const key = b.a < b.b ? b.a + '|' + b.b : b.b + '|' + b.a;
      if (seen.has(key)) errors.push({ type: 'duplicate_beam', msg: 'Duplicate beam', beamIndex: i });
      seen.add(key);
      for (const r of noBuild) {
        if (segmentHitsRect(na.x, na.y, nb.x, nb.y, r)) { errors.push({ type: 'in_nobuild', msg: 'Beam crosses a no-build zone', beamIndex: i }); break; }
      }
      if (segmentInTerrain(lv, na.x, na.y, nb.x, nb.y, 0.05)) errors.push({ type: 'in_terrain', msg: 'Beam passes through the ground', beamIndex: i });
      // track is laid (nearly) level - rail is not a structural web member
      if (mat.isRail && Math.abs(nb.y - na.y) > RAIL_MAX_SLOPE * Math.abs(nb.x - na.x) + EPS) {
        errors.push({ type: 'rail_too_steep', msg: 'Rail track must be laid nearly level (max ' + Math.round(RAIL_MAX_SLOPE * 100) + ' % slope)', beamIndex: i });
      }
    }
    return { ok: errors.length === 0, errors, warnings: railWarnings(lv, d, map) };
  }

  /** Non-blocking hints for rail decks as built: too steep (rail_grade) or kinked at a joint
   *  (rail_kink) - trains derail there (SPEC §9.3). */
  function railWarnings(level, design, map) {
    const out = [];
    const beams = (design && design.beams) || [];
    const rr = railRules(level);
    const kinkMax = rr.maxKinkDeg * Math.PI / 180;
    const ends = new Map();
    for (let i = 0; i < beams.length; i++) {
      const b = beams[i];
      const mat = b && mats()[b.m];
      if (!mat || !mat.isRail) continue;
      const na = map.get(b.a), nb = map.get(b.b);
      if (!na || !nb || b.a === b.b) continue;
      let dx = nb.x - na.x, dy = nb.y - na.y;
      const L = hyp(dx, dy);
      if (L < 0.05) continue;
      if (Math.abs(dx) < 1e-9 || Math.abs(dy / dx) > rr.maxGrade + 1e-9) {
        out.push({ type: 'rail_grade', msg: 'Rail steeper than ' + Math.round(rr.maxGrade * 1000) / 10 + ' % - trains derail', beamIndex: i });
      }
      if (dx < 0) { dx = -dx; dy = -dy; }
      for (const id of [b.a, b.b]) { if (!ends.has(id)) ends.set(id, []); ends.get(id).push({ i, ux: dx / L, uy: dy / L }); }
    }
    for (const [id, list] of ends) {
      for (let p = 0; p < list.length; p++) for (let q = p + 1; q < list.length; q++) {
        const u = list[p], w = list[q];
        const ang = Math.abs(Math.atan2(u.ux * w.uy - u.uy * w.ux, u.ux * w.ux + u.uy * w.uy));
        if (ang > kinkMax + 1e-9 && ang < 0.9) {
          out.push({ type: 'rail_kink', msg: 'Rail kinks ' + (ang * 180 / Math.PI).toFixed(1) + '° at a joint - trains derail', beamIndex: w.i, nodeId: id });
        }
      }
    }
    return out;
  }

  function clone(design) {
    const d = design || emptyDesign();
    return {
      nodes: (d.nodes || []).map(n => ({ id: n.id, x: n.x, y: n.y })),
      beams: (d.beams || []).map(b => ({ a: b.a, b: b.b, m: b.m })),
      piers: (d.piers || []).map(p => ({ x: p.x, topY: p.topY })),
    };
  }

  function serialize(design) {
    const d = clone(design);
    return JSON.stringify({ v: 1, nodes: d.nodes, beams: d.beams, piers: d.piers });
  }

  /** Parses a design string (or object). Never throws: bad input -> emptyDesign(). */
  function deserialize(str) {
    let o;
    try { o = typeof str === 'string' ? JSON.parse(str) : str; } catch (e) { return emptyDesign(); }
    if (!o || typeof o !== 'object') return emptyDesign();
    if (o.design && typeof o.design === 'object') o = o.design;
    const out = emptyDesign();
    if (Array.isArray(o.nodes)) for (const n of o.nodes) {
      if (n && typeof n.id === 'string' && isFinite(n.x) && isFinite(n.y)) out.nodes.push({ id: n.id, x: +n.x, y: +n.y });
    }
    if (Array.isArray(o.beams)) for (const b of o.beams) {
      if (b && typeof b.a === 'string' && typeof b.b === 'string' && typeof b.m === 'string') out.beams.push({ a: b.a, b: b.b, m: b.m });
    }
    if (Array.isArray(o.piers)) for (const p of o.piers) {
      if (p && isFinite(p.x) && isFinite(p.topY)) out.piers.push({ x: +p.x, topY: +p.topY });
    }
    return out;
  }

  /** Traffic description: {total, text: "3 cars, 1 bus", items:[{type,count,name}]} */
  function trafficSummary(level) {
    const parts = [], items = [];
    let total = 0;
    for (const g of (level && level.traffic) || []) {
      const c = g.count || 1;
      if (g.type === 'train') {
        const tr = BG.Trains && BG.Trains[g.train];
        const name = tr ? tr.name : String(g.train || 'train');
        const cars = tr ? tr.carCount : 0;
        total += c;
        items.push({ type: 'train', kind: 'train', train: g.train, preset: g.train, count: c, name, cars, mass: tr ? tr.mass : 0 });
        parts.push(c + ' ' + name.toLowerCase() + ' train' + (c > 1 ? 's' : '') + (cars > 1 ? ' (' + cars + ' cars)' : ''));
        continue;
      }
      const def = BG.Vehicles && BG.Vehicles[g.type];
      total += c;
      const name = def ? def.name.toLowerCase() : g.type;
      items.push({ type: g.type, kind: 'road', count: c, name });
      parts.push(c + ' ' + name + (c > 1 ? (/(s|sh|ch)$/.test(name) ? 'es' : 's') : ''));
    }
    return { total, text: parts.join(', '), items };
  }

  BG.Model = {
    emptyDesign, allNodes, nodeMap, findNode, cost, validate, clone, serialize, deserialize,
    beamLength, beamCost, pierCost, segmentHitsRect, pointInRect, inTerrain, roadAnchors,
    segmentInTerrain, terrainDistance, TERRAIN_CLEARANCE, RAIL_MAX_SLOPE,
    nextNodeId, trafficSummary, roadConnected, railConnected, deckConnected, trafficKinds, railRules,
    belowWater, UNDERWATER_MSG, // terrain-fix
  };
})(typeof window !== 'undefined' ? window : globalThis);
