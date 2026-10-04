/* SPAN — derailment explainer + ride quality for Iron Road levels (BG.RailInfo). Display only.
 *
 * Reads the simulation's read-only readouts (physics.js `_initReadouts`): sim.ride (worst grade /
 * kink / sag while the run was live), derail events' .detail and sim.firstDerail.detail, and the
 * live rail geometry (sim.nodes + sim.beams). Nothing here writes to the simulation.
 *
 *   RailInfo.profile(sim)               live track: {segs:[{j,x0,y0,x1,y1,grade,broken}], joints:[{x,y,kink,node}]}
 *   RailInfo.Recorder(sim)              per-joint / per-segment peaks sampled every frame (track recording strip)
 *   RailInfo.explain(detail, sim, lv, design)   friendly cause: {title, cause, advice, reason, car}
 *   RailInfo.rideCard(sim, summary)     results score card: {structureOk, railsOk, grade, gradeLim, kink,
 *                                        kinkLim, kinkSpeed, sag, letter, score}
 *   RailInfo.drawStrip(canvas, sim, rec, opts)  the live "track recording" chart
 */
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});
  const DEG = 180 / Math.PI;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function isRailBeam(b) {
    if (!b) return false;
    const m = b.material || (BG.Materials && BG.Materials[b.m]);
    return !!(m ? m.isRail : b.m === 'rail');
  }
  function rules(sim) {
    const r = (sim && sim.railRules) || {};
    const RR = BG.RailRules || {};
    const maxKinkDeg = r.maxKinkDeg != null ? r.maxKinkDeg : (RR.maxKinkDeg || 4);
    return {
      maxGrade: r.maxGrade != null ? r.maxGrade : (RR.maxGrade || 0.06),
      maxKinkDeg, kinkMax: maxKinkDeg / DEG, kinkRefSpeed: r.kinkRefSpeed || RR.kinkRefSpeed || 15,
    };
  }
  /** kink limit (rad) for a train running at speed v (m/s): shrinks as ref/v above the reference speed */
  function kinkLimit(sim, v) {
    const R = rules(sim);
    v = Math.abs(v || 0);
    return v > R.kinkRefSpeed ? R.kinkMax * R.kinkRefSpeed / v : R.kinkMax;
  }
  // i18n (docs/I18N.md): texts come from the dictionary (results.derail.*, results.strip.*), numbers from BG.i18n
  function I() { return BG.i18n || null; }
  function t(key, params) { return I() ? I().t(key, params) : key; }
  function fmt(v, d) { const k = Math.pow(10, d == null ? 1 : d); const r = Math.round(v * k) / k; return I() ? I().num(r) : String(r); }
  function fixed1(v) { return I() ? I().num(v, 1) : v.toFixed(1); }
  // measured values keep one decimal ("3.0°"); limits read cleaner trimmed ("4°", "1.4°")
  function pct(g, fixed) { return fixed ? fixed1(g * 100) : fmt(g * 100, 1); }
  function deg(rad, fixed) { return fixed ? fixed1(rad * DEG) : fmt(rad * DEG, 1); }
  // a name from the data tables in the current language: vehicles.<kind>.<id> when the dictionary has it
  function dictName(kind, id, fallback) {
    const k = 'vehicles.' + kind + '.' + id;
    return I() && (I().has(k) || I().has(k, 'en')) ? I().t(k) : fallback;
  }
  function carName(type) {
    const c = BG.RailCars && BG.RailCars[type];
    return dictName('car', type, (c && c.name) || t('results.derail.train'));
  }
  function matName(id) {
    const m = BG.Materials && BG.Materials[id];
    return dictName('material', id, (m && m.name) || String(id));
  }

  // ------------------------------------------------------------------ live track geometry
  function profile(sim) {
    const segs = [], joints = [];
    if (!sim || !sim.beams || !sim.nodes) return { segs, joints };
    const N = sim.nodes, n0 = sim.nDesignBeams != null ? sim.nDesignBeams : sim.beams.length;
    const at = new Map();
    const T = sim.terrain || {};
    for (let j = 0; j < n0; j++) {
      const b = sim.beams[j];
      if (!b || b.invalid || !isRailBeam(b)) continue;
      let A = N[b.a], B = N[b.b], ia = b.a, ib = b.b;
      if (!A || !B) continue;
      if (B.x < A.x) { const t = A; A = B; B = t; const q = ia; ia = ib; ib = q; }
      const dx = B.x - A.x;
      if (dx < 0.05) continue;
      const s = { j, x0: A.x, y0: A.y, x1: B.x, y1: B.y, ux: dx, uy: B.y - A.y, grade: Math.abs(B.y - A.y) / dx, broken: !!b.broken, ia, ib };
      segs.push(s);
      if (s.broken) continue;
      if (!at.has(ia)) at.set(ia, { L: [], R: [] });
      if (!at.has(ib)) at.set(ib, { L: [], R: [] });
      at.get(ia).R.push(s); at.get(ib).L.push(s);
    }
    const ang = (a, b) => Math.abs(Math.atan2(a.ux * b.uy - a.uy * b.ux, a.ux * b.ux + a.uy * b.uy));
    const flat = { ux: 1, uy: 0 };
    at.forEach((e, i) => {
      const n = N[i];
      let k = -1;
      for (const l of e.L) for (const r of e.R) k = Math.max(k, ang(l, r));
      // where the track meets a bank, the bank top is the other "segment"
      if (k < 0 && n && n.fixed && T.leftEdge != null) {
        const nearL = Math.abs(n.x - T.leftEdge) < 0.3 && Math.abs(n.y - T.leftY) < 0.3;
        const nearR = Math.abs(n.x - T.rightEdge) < 0.3 && Math.abs(n.y - T.rightY) < 0.3;
        if (nearL && e.R.length) k = Math.max.apply(null, e.R.map(r => ang(flat, r)));
        else if (nearR && e.L.length) k = Math.max.apply(null, e.L.map(l => ang(l, flat)));
      }
      if (k >= 0 && n) joints.push({ x: n.x, y: n.y, kink: k, node: i });
    });
    segs.sort((a, b) => a.x0 - b.x0);
    joints.sort((a, b) => a.x - b.x);
    return { segs, joints };
  }

  /** peaks per rail joint / segment, sampled once a frame (the strip's "recorded" envelope) */
  function Recorder(sim) {
    this.sim = sim;
    this.kink = new Map();   // node index -> peak kink (rad)
    this.grade = new Map();  // beam index -> peak grade
    this.speed = 0;
  }
  Recorder.prototype.sample = function (prof) {
    const sim = this.sim;
    if (!sim || sim.status !== 'running') return;
    for (const jt of prof.joints) { const p = this.kink.get(jt.node) || 0; if (jt.kink > p) this.kink.set(jt.node, jt.kink); }
    for (const s of prof.segs) { if (s.broken) continue; const p = this.grade.get(s.j) || 0; if (s.grade > p) this.grade.set(s.j, s.grade); }
  };

  // ------------------------------------------------------------------ trains on the strip
  function trainSpans(sim) {
    const out = [];
    for (const v of (sim && sim.vehicles) || []) {
      if (!v || v.kind !== 'train' || !v.cars) continue;
      if (v.state === 'waiting') continue;
      let x0 = Infinity, x1 = -Infinity;
      for (const c of v.cars) {
        if (!c || c.state === 'waiting') continue;
        const L = (c.def && c.def.length) || 10;
        const ca = Math.cos(c.angle || 0);
        x0 = Math.min(x0, c.x, c.x + ca * L); x1 = Math.max(x1, c.x, c.x + ca * L);
      }
      if (!(x1 > x0)) continue;
      const lead = v.cars[0];
      out.push({ x0, x1, speed: Math.abs((lead && lead.vx) || v.vx || 0), state: v.state, derailed: v.state === 'derailed' });
    }
    return out;
  }

  // ------------------------------------------------------------------ explanations
  function brokenRailNear(sim, x) {
    const N = sim.nodes;
    let best = null, bd = Infinity;
    for (let j = 0; j < (sim.nDesignBeams || sim.beams.length); j++) {
      const b = sim.beams[j];
      if (!b || !b.broken || b.invalid || !isRailBeam(b)) continue;
      const rest = b.restLength || 0;
      // a snapped beam's own nodes may have drifted with its fragments: judge by the remaining stubs
      const A = N[b.a], B = N[b.b];
      if (!A || !B) continue;
      const lo = Math.min(A.x, B.x) - 1.5, hi = Math.max(A.x, B.x, Math.min(A.x, B.x) + rest) + 1.5;
      const d = x < lo ? lo - x : x > hi ? x - hi : 0;
      if (d < bd) { bd = d; best = j; }
    }
    return bd < 3 ? best : null;
  }
  function roadUnder(sim, x) {
    const N = sim.nodes;
    for (let j = 0; j < (sim.nDesignBeams || sim.beams.length); j++) {
      const b = sim.beams[j];
      if (!b || b.broken || b.invalid) continue;
      const m = b.material || (BG.Materials && BG.Materials[b.m]);
      if (!m || !m.isRoad) continue;
      const A = N[b.a], B = N[b.b];
      if (A && B && x >= Math.min(A.x, B.x) - 0.2 && x <= Math.max(A.x, B.x) + 0.2) return true;
    }
    return false;
  }
  function railCovers(sim, x) {
    const N = sim.nodes, T = sim.terrain || {};
    if (x <= T.leftEdge + 0.05 || x >= T.rightEdge - 0.05) return true;
    for (let j = 0; j < (sim.nDesignBeams || sim.beams.length); j++) {
      const b = sim.beams[j];
      if (!b || b.invalid || !isRailBeam(b)) continue;
      const A = N[b.a], B = N[b.b];
      if (A && B && x >= Math.min(A.x, B.x) - 0.05 && x <= Math.max(A.x, B.x) + 0.05) return true;
    }
    return false;
  }
  /** a rail joint over the gap where the track just ends (only one rail beam, not on a bank) */
  function deadEndNear(sim, x, reach) {
    const N = sim.nodes, T = sim.terrain || {}, deg = new Map();
    for (let j = 0; j < (sim.nDesignBeams || sim.beams.length); j++) {
      const b = sim.beams[j];
      if (!b || b.invalid || !isRailBeam(b)) continue;
      for (const i of [b.a, b.b]) deg.set(i, (deg.get(i) || 0) + 1);
    }
    let best = null;
    deg.forEach((d, i) => {
      const n = N[i];
      if (d !== 1 || !n) return;
      const onBank = (Math.abs(n.x - T.leftEdge) < 0.3 && Math.abs(n.y - T.leftY) < 0.5) || (Math.abs(n.x - T.rightEdge) < 0.3 && Math.abs(n.y - T.rightY) < 0.5);
      if (!onBank && Math.abs(n.x - x) < reach && (!best || Math.abs(n.x - x) < Math.abs(best.x - x))) best = n;
    });
    return best;
  }
  /** as-built y of a node by sim index (design positions; falls back to the live ones) */
  function builtNodes(sim, lv, design) {
    const map = {};
    try { if (BG.Model && BG.Model.allNodes && lv && design) for (const n of BG.Model.allNodes(lv, design)) map[n.id] = n; } catch (e) { /* */ }
    return i => { const n = sim.nodes[i]; return (n && map[n.id]) || n; };
  }

  /**
   * detail = derail event .detail (physics) — {reason, wheel, wx, wy, seg, segPrev, value, limit, speed}
   * Returns {reason, car, title, cause (with numbers), advice, x, y, seg, segPrev, at:'bank'|'dip'|'crest'|...}
   */
  function explain(detail, sim, lv, design, car) {
    const D = detail || {};
    const R = rules(sim);
    const ctype = car && car.type;
    const name = () => carName(ctype).toLowerCase();
    const out = { reason: D.reason || 'derail', car: '', title: '', cause: '', advice: '', x: D.wx, y: D.wy, seg: D.seg, segPrev: D.segPrev, speed: D.speed || 0 };
    // the texts are kept as dictionary keys + params (functions are read when the text is built), so retext(out)
    // can rebuild them in another language; title / cause / advice / car are plain strings for the HUD
    const parts = { title: [['results.derail.title']], cause: [], advice: [], car: ctype };
    const say = (field, key, params) => { if (field === 'title') parts.title = []; parts[field].push([key, params || null]); };
    Object.defineProperty(out, '_parts', { value: parts, enumerable: false });
    const sp = Math.round(D.speed || 0);
    const ms = () => (I() ? I().num(sp) : String(sp));
    const N = sim && sim.nodes;
    const segOf = j => { const b = j != null && j >= 0 && sim.beams[j]; if (!b) return null; let A = N[b.a], B = N[b.b]; if (!A || !B) return null; if (B.x < A.x) { const t = A; A = B; B = t; } return { A, B, dx: B.x - A.x, dy: B.y - A.y, b }; };
    switch (D.reason) {
      case 'kink': {
        say('title', 'results.derail.kink.title');
        const s0 = segOf(D.segPrev), s1 = segOf(D.seg);
        // where: at the bank joint, in a dip (track bends up again) or over a crest
        let at = 'joint';
        const sl = s => (s ? s.dy / Math.max(1e-6, s.dx) : 0);
        if (!s0 || !s1) at = 'bank';
        else {
          const first = s0.A.x <= s1.A.x ? s0 : s1, second = first === s0 ? s1 : s0;
          at = sl(second) > sl(first) ? 'dip' : 'crest';
        }
        out.at = at;
        say('cause', 'results.derail.kink.cause', { v: () => deg(D.value, true), speed: ms, limit: () => deg(D.limit) });
        say('advice', at === 'bank' ? 'results.derail.kink.bank' : at === 'dip' ? 'results.derail.kink.dip' : 'results.derail.kink.crest');
        if ((D.speed || 0) > R.kinkRefSpeed + 0.5) say('advice', 'results.derail.kink.fast', { speed: () => fmt(R.kinkRefSpeed) });
        break;
      }
      case 'grade': {
        say('title', 'results.derail.grade.title');
        say('cause', 'results.derail.grade.cause', { v: () => pct(D.value, true), limit: () => pct(D.limit) });
        // as built or sagged under the train?
        let built = null;
        const b = D.seg >= 0 && sim.beams[D.seg];
        if (b) { const at = builtNodes(sim, lv, design); const A = at(b.a), B = at(b.b); if (A && B) built = Math.abs(B.y - A.y) / Math.max(1e-6, Math.abs(B.x - A.x)); }
        if (built != null && built > R.maxGrade - 1e-6) say('advice', 'results.derail.grade.steep', { v: () => pct(built, true) });
        else if (built != null) say('advice', 'results.derail.grade.saggedBuilt', { v: () => pct(built, true) });
        else say('advice', 'results.derail.grade.sagged');
        break;
      }
      case 'missing': {
        const wx = D.wx != null ? D.wx : (car ? car.x : 0);
        const br = brokenRailNear(sim, wx);
        if (br != null) {
          say('title', 'results.derail.broken.title');
          say('cause', 'results.derail.broken.cause');
          out.seg = br;
          const fb = sim.firstBreak;
          const fbm = fb && BG.Materials && BG.Materials[fb.m];
          if (fb && !(fbm ? fbm.isRail : fb.m === 'rail')) say('advice', 'results.derail.broken.under', { name: () => matName(fb.m).toLowerCase(), mode: () => t('results.mode.' + fb.mode) });
          else say('advice', 'results.derail.broken.track');
          out.at = 'broken';
        } else if (roadUnder(sim, wx) && !railCovers(sim, wx)) {
          say('title', 'results.derail.road.title');
          say('cause', 'results.derail.road.cause', { rail: () => matName('rail') });
          say('advice', 'results.derail.layTrack', { rail: () => matName('rail') });
          out.at = 'road';
        } else if (!railCovers(sim, wx) || deadEndNear(sim, wx, 2.5)) {
          say('title', 'results.derail.gap.title');
          say('cause', 'results.derail.gap.cause');
          say('advice', 'results.derail.layTrack', { rail: () => matName('rail') });
          out.at = 'gap';
        } else {
          say('title', 'results.derail.sharp.title');
          say('cause', 'results.derail.sharp.cause');
          say('advice', 'results.derail.sharp.advice');
          out.at = 'sharp';
        }
        break;
      }
      case 'lift': {
        say('title', 'results.derail.lift.title');
        say('cause', sp ? 'results.derail.lift.causeAt' : 'results.derail.lift.cause', { speed: ms });
        say('advice', 'results.derail.lift.advice');
        break;
      }
      case 'fell': {
        say('title', 'results.derail.fell.title');
        say('cause', 'results.derail.fell.cause', { car: name });
        say('advice', 'results.derail.fell.advice');
        break;
      }
      default:
        say('cause', 'results.derail.other.cause', { car: name });
        say('advice', 'results.derail.other.advice', { grade: () => pct(R.maxGrade), kink: () => fmt(R.maxKinkDeg) });
    }
    return retext(out);
  }
  /** (re)builds an explain() result's title / cause / advice / car in the current language */
  function retext(info) {
    const parts = info && info._parts;
    if (!parts) return info;
    const val = (p) => { if (!p) return p; const o = {}; for (const k in p) o[k] = typeof p[k] === 'function' ? p[k]() : p[k]; return o; };
    const join = (list) => list.map((q) => t(q[0], val(q[1]))).join(' ');
    info.title = join(parts.title);
    info.cause = join(parts.cause);
    info.advice = join(parts.advice);
    info.car = carName(parts.car);
    return info;
  }

  // ------------------------------------------------------------------ results score card
  const LETTERS = [[0.4, 'A'], [0.6, 'B'], [0.8, 'C'], [Infinity, 'D']];
  function rideCard(sim, sum) {
    if (!sim || !sim.ride) return null;
    const R = rules(sim), r = sim.ride;
    sum = sum || {};
    const broken = sum.brokenBeams != null ? sum.brokenBeams : 0;
    const railsOk = !(sum.derailedCars > 0) && sum.failReason !== 'derailed';
    const score = Math.max(r.gradeRatio || 0, r.kinkRatio || 0);
    let letter = 'F';
    if (railsOk) for (const [lim, l] of LETTERS) if (score < lim) { letter = l; break; }
    return {
      structureOk: broken === 0, broken, railsOk,
      grade: r.grade || 0, gradeLim: R.maxGrade, gradeRatio: r.gradeRatio || 0,
      kink: r.kink || 0, kinkLim: r.kinkLim || R.kinkMax, kinkSpeed: r.kinkSpeed || 0, kinkRatio: r.kinkRatio || 0,
      sag: Math.max(0, r.sag || 0), letter, score,
    };
  }

  // ------------------------------------------------------------------ the strip chart
  const COL = {
    text: 'rgba(238,243,251,0.92)', muted: 'rgba(154,171,196,0.95)', grid: 'rgba(255,255,255,0.08)',
    band: 'rgba(255,77,94,0.16)', limit: 'rgba(255,107,120,0.95)', grade: '#49c6f2', kink: '#ffb547',
    peak: 'rgba(255,255,255,0.55)', over: '#ff4d5e', train: 'rgba(255,255,255,0.15)', trainEdge: 'rgba(255,255,255,0.55)',
  };
  /**
   * canvas: the strip's <canvas> (CSS-sized), opts: {limitKink (rad, smoothed), speed, derail: {x}}
   * Two lanes, each scaled to 1.6 x its static limit: grade (%) per rail segment, kink (deg) per joint.
   */
  function drawStrip(canvas, sim, rec, opts) {
    opts = opts || {};
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    const W = canvas.clientWidth || 600, H = canvas.clientHeight || 84;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!sim) return;
    const R = rules(sim), T = sim.terrain || { leftEdge: 0, rightEdge: 10 };
    const prof = opts.profile || profile(sim);
    const padL = 62, padR = 112, padT = 6, padB = 6, laneGap = 6;
    const cw = Math.max(40, W - padL - padR);
    const laneH = (H - padT - padB - laneGap) / 2;
    const span = Math.max(1, T.rightEdge - T.leftEdge);
    const xa = T.leftEdge - Math.max(3, span * 0.06), xb = T.rightEdge + Math.max(3, span * 0.06);
    const X = x => padL + (x - xa) / (xb - xa) * cw;
    const lanes = [
      { key: 'grade', y0: padT, label: t('results.strip.grade'), color: COL.grade, max: R.maxGrade * 1.6, limit: R.maxGrade },
      { key: 'kink', y0: padT + laneH + laneGap, label: t('results.strip.kink'), color: COL.kink, max: R.kinkMax * 1.6, limit: opts.limitKink != null ? opts.limitKink : R.kinkMax },
    ];
    ctx.font = '700 9.5px ui-sans-serif, "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const ln of lanes) {
      // gentle power scale: small values stay readable, the limit line sits at ~3/4 of the lane
      const Y = v => ln.y0 + laneH - Math.pow(clamp(v / ln.max, 0, 1), 0.6) * laneH;
      // lane frame
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(padL, ln.y0, cw, laneH);
      // bridge extents (banks shaded)
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      ctx.fillRect(padL, ln.y0, X(T.leftEdge) - padL, laneH);
      ctx.fillRect(X(T.rightEdge), ln.y0, padL + cw - X(T.rightEdge), laneH);
      // red limit band
      const yl = Y(ln.limit);
      ctx.fillStyle = COL.band;
      ctx.fillRect(padL, ln.y0, cw, Math.max(0, yl - ln.y0));
      ctx.strokeStyle = COL.limit; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(padL, yl + 0.5); ctx.lineTo(padL + cw, yl + 0.5); ctx.stroke(); ctx.setLineDash([]);
      // data
      if (ln.key === 'grade') {
        for (const s of prof.segs) {
          const x0 = X(s.x0), x1 = X(s.x1);
          if (s.broken) {
            ctx.fillStyle = 'rgba(255,77,94,0.35)'; ctx.fillRect(x0, ln.y0, Math.max(1, x1 - x0), laneH);
            ctx.strokeStyle = COL.over; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x0, ln.y0); ctx.lineTo(x1, ln.y0 + laneH); ctx.moveTo(x0, ln.y0 + laneH); ctx.lineTo(x1, ln.y0); ctx.stroke();
            continue;
          }
          const y = Y(s.grade), over = s.grade > ln.limit;
          ctx.fillStyle = over ? 'rgba(255,77,94,0.75)' : 'rgba(73,198,242,0.55)';
          ctx.fillRect(x0 + 0.5, y, Math.max(1, x1 - x0 - 1), ln.y0 + laneH - y);
          const pk = rec && rec.grade.get(s.j);
          if (pk != null && pk > s.grade + 1e-4) { ctx.fillStyle = COL.peak; ctx.fillRect(x0 + 0.5, Y(pk) - 0.75, Math.max(1, x1 - x0 - 1), 1.5); }
        }
      } else {
        for (const jt of prof.joints) {
          const x = X(jt.x), y = Y(jt.kink), over = jt.kink > ln.limit;
          ctx.fillStyle = over ? COL.over : COL.kink;
          ctx.fillRect(x - 2, y, 4, ln.y0 + laneH - y);
          const pk = rec && rec.kink.get(jt.node);
          if (pk != null && pk > jt.kink + 1e-4) { ctx.fillStyle = COL.peak; ctx.fillRect(x - 3.5, Y(pk) - 0.75, 7, 1.5); }
        }
      }
      // labels
      ctx.textAlign = 'left'; ctx.fillStyle = ln.color;
      ctx.fillText(ln.label, 8, ln.y0 + laneH * 0.32);
      ctx.fillStyle = COL.muted; ctx.font = '600 9px ui-sans-serif, "Segoe UI", system-ui, sans-serif';
      const limTxt = ln.key === 'grade' ? t('results.strip.limitPct', { v: pct(ln.limit) }) : t('results.strip.limitDeg', { v: deg(ln.limit) });
      ctx.fillText(limTxt, 8, ln.y0 + laneH * 0.74);
      ctx.font = '700 9.5px ui-sans-serif, "Segoe UI", system-ui, sans-serif';
    }
    // trains
    const spans = trainSpans(sim);
    for (const t of spans) {
      const x0 = clamp(X(t.x0), padL, padL + cw), x1 = clamp(X(t.x1), padL, padL + cw);
      if (x1 - x0 < 1) continue;
      ctx.fillStyle = t.derailed ? 'rgba(255,77,94,0.16)' : COL.train;
      ctx.fillRect(x0, padT, x1 - x0, H - padT - padB);
      ctx.strokeStyle = t.derailed ? COL.over : COL.trainEdge; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x1 + 0.5, padT); ctx.lineTo(x1 + 0.5, H - padB); ctx.stroke();
      ctx.fillStyle = t.derailed ? COL.over : '#fff';
      ctx.beginPath(); ctx.moveTo(x1 - 4, padT); ctx.lineTo(x1 + 5, padT); ctx.lineTo(x1 + 0.5, padT + 6); ctx.closePath(); ctx.fill();
    }
    // derailment marker
    if (opts.derail && opts.derail.x != null) {
      const x = X(opts.derail.x);
      if (x >= padL && x <= padL + cw) {
        ctx.strokeStyle = COL.over; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, H - padB); ctx.stroke();
        ctx.fillStyle = COL.over; ctx.beginPath(); ctx.arc(x, H / 2, 4, 0, Math.PI * 2); ctx.fill();
      }
    }
    // readouts (right): live worst under the train so far + current limit
    const r = sim.ride || {};
    const rx = padL + cw + 10;
    ctx.textAlign = 'left';
    const row = (y, label, val, bad) => {
      ctx.fillStyle = COL.muted; ctx.font = '600 9px ui-sans-serif, "Segoe UI", system-ui, sans-serif'; ctx.fillText(label, rx, y - 7);
      ctx.fillStyle = bad ? '#ff8b97' : COL.text; ctx.font = '800 13px ui-sans-serif, "Segoe UI", system-ui, sans-serif'; ctx.fillText(val, rx, y + 6);
    };
    row(lanes[0].y0 + laneH / 2, t('results.strip.worstGrade'), t('results.strip.pct', { v: pct(r.grade || 0, true) }), (r.gradeRatio || 0) > 1);
    // the speed the worst kink was judged at (its limit depends on it), else the train's speed now
    const spd = r.kinkRatio > 0 && r.kinkSpeed > 0 ? r.kinkSpeed : opts.speed != null ? opts.speed : (spans[0] ? spans[0].speed : 0);
    row(lanes[1].y0 + laneH / 2, t('results.strip.worstKink'), deg(r.kink || 0, true) + '°' + (spd > 0.5 ? '  ' + t('results.strip.speed', { v: I() ? I().num(Math.round(spd)) : Math.round(spd) }) : ''), (r.kinkRatio || 0) > 1);
  }

  BG.RailInfo = { profile, Recorder, explain, retext, rideCard, drawStrip, kinkLimit, rules, trainSpans, fmt, pct, deg };
})(typeof window !== 'undefined' ? window : globalThis);
