// SPAN — Arch & Curve tool (SPEC §18): BG.ArchTool + Editor.prototype extensions.
//
// Gesture (editor tool 'arch', key A): press on a start point (joint / anchor / pier top / empty grid point), drag
// to the end point, release; then move the pointer up / down to set the rise (or the sag below the chord) and click
// to place it. Touch: the same with the loupe; after the release a handle sits at the crown - drag (anywhere) to set
// the rise, tap to place. Esc / right-click / a two-finger tap cancels. A click without a drag picks the start and a
// second click the end. +/- (or the wheel, or the -/+ chips) change the number of segments while the rise is set.
//
// The curve itself comes from BG.Curves (js/core/curves.js): the fewest segments, all <= the material's max length
// (with a margin), joints on the 0.25 m grid. Endpoints reuse joints under the pointer (magnet), interior joints reuse
// joints they land on and split beams they land on (like the build tool). Options (contextual bar): shape (parabolic,
// circular, catenary), "Connect to deck" (vertical posts / hangers from every curve joint to the deck line above or
// below it, splitting deck beams where needed) and the connector material. Mirror mode mirrors an arch that lies on
// one side of the axis. One placement = one undo step.
//
// The Select tool gets "Smooth": >= 3 selected joints are moved onto a parabola (through the end joints, least
// squares) and spaced evenly along it, on the grid and within the rules (one undo step).
//
// Classic script, loaded after js/main.js. Core logic is DOM-free (Node tests drive it through the editor's world-
// coordinate API); the DOM bits (contextual bar, hint, two-finger tap) only run in a browser.
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});
  const Editor = BG.Editor;
  if (!Editor) return;
  const P = Editor.prototype;
  const C = () => BG.Curves;

  const GRID = 0.25;          // m: interior joints and the rise snap to this grid
  const MIN_CHORD = 1;        // m: shortest start-end distance for a curve
  const REUSE = 0.3;          // m: an interior curve joint this close to an existing joint uses that joint
  const DECK_REUSE = 1.0;     // m (horizontal): a connector lands on an existing deck joint this close
  const ON_DECK = 0.45;       // m: a curve joint this close to the deck line needs no connector
  const POS_EPS = 0.02;
  const SHAPE_NAMES = { parabolic: 'Parabolic', circular: 'Circular', catenary: 'Catenary' };
  const POST_ORDER = ['steel', 'wood', 'girder', 'masonry', 'reinforced_road'];
  const HANGER_ORDER = ['cable', 'rope', 'steel', 'wood', 'girder'];
  const ARCH_ORDER = ['masonry', 'steel', 'wood', 'girder', 'cable', 'rope'];

  const OPT = { shape: 'parabolic', connect: false, brace: true, connMat: 'auto' };

  function hyp(x, y) { return Math.sqrt(x * x + y * y); }
  function r4(v) { return Math.round(v * 10000) / 10000; }
  function snap(v, g) { return Math.round(Math.round(v / g) * g * 10000) / 10000; }
  function matDef(id) { return (BG.Materials && BG.Materials[id]) || null; }
  function maxLenOf(id) { const d = matDef(id); return d && d.maxLength > 0 ? d.maxLength : 6; }
  function costOf(id) { const d = matDef(id); return d && d.costPerMeter > 0 ? d.costPerMeter : 0; }
  function isDeck(id) { const d = matDef(id); return !!(d && (d.isRoad || d.isRail)); }
  function tensionOnly(id) { const d = matDef(id); return !!(d && d.tensionOnly); }
  function compressionOnly(id) {
    const d = matDef(id);
    return !!d && !d.tensionOnly && (+d.compressionLimit || 0) > 0 && (+d.tensionLimit || 0) < 0.05 * (+d.compressionLimit || 0);
  }
  function key(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function m1(v) { return (Math.round(v * 10) / 10).toFixed(1); }

  const REASON = {
    too_long: (p) => 'A segment is longer than ' + maxLenOf(p.m) + ' m',
    too_short: () => 'Too short',
    in_nobuild: () => 'Crosses a no-build zone',
    in_terrain: () => 'Passes through the ground',
    near_terrain: () => 'Joints must stay 0.5 m clear of the ground',
    outside_build_area: () => 'Outside the build area',
    underwater: () => (BG.Model && BG.Model.UNDERWATER_MSG) || "Can't build under water - use a pier",
    roadway: () => (BG.Model && BG.Model.ROADWAY_MSG) || 'Keep the road clear',
    material_not_allowed: (p) => ((matDef(p.m) || {}).name || p.m) + ' is not available here',
    tension_only: (p) => ((matDef(p.m) || {}).name || p.m) + ' only carries tension: drag the curve below the line to hang it',
    stone_hangs: (p) => ((matDef(p.m) || {}).name || p.m) + ' only carries compression: raise the curve into an arch',
    rail_too_steep: () => 'Track must be laid nearly level',
    span_short: () => 'Drag further: the curve needs at least ' + MIN_CHORD + ' m',
  };
  function reasonText(r, plan) { const f = REASON[r]; return f ? f(plan || {}) : String(r || '').replace(/_/g, ' '); }

  // ================================================================ options
  P.archOptions = function () { return OPT; };
  P.setArchShape = function (s) {
    if (!SHAPE_NAMES[s]) return false;
    OPT.shape = s;
    this._sfx('click');
    this._refresh();
    this._uiChanged();
    return true;
  };
  P.setArchConnect = function (on) { OPT.connect = !!on; this._sfx('toggle', { on: OPT.connect }); this._refresh(); this._uiChanged(); return OPT.connect; };
  P.setArchBrace = function (on) { OPT.brace = !!on; this._sfx('toggle', { on: OPT.brace }); this._refresh(); this._uiChanged(); return OPT.brace; };
  P.setArchConnector = function (m) {
    OPT.connMat = m && m !== 'auto' && matDef(m) ? m : 'auto';
    this._refresh();
    this._uiChanged();
    return OPT.connMat;
  };
  /** change the segment count of the curve being placed (delta = +1 / -1); false when there is none */
  P.archSegments = function (delta) {
    const s = this._arch;
    if (!s || (s.phase !== 'rise' && s.phase !== 'drag') || !s.plan || !s.plan.n) return false;
    const cur = s.n || s.plan.n;
    const nMin = s.plan.nMin || 1;
    const next = Math.max(nMin, Math.min(80, cur + (delta > 0 ? 1 : -1)));
    s.n = next <= nMin ? 0 : next; // 0 = automatic (the fewest)
    if (next === cur) this._sfx('error'); else this._sfx('click');
    this._refresh();
    return true;
  };
  /** the connector material for a post (compression) or hanger (tension) */
  P._archConnMat = function (kind) {
    const allowed = this._allowedList();
    const ok = (m) => allowed.indexOf(m) >= 0 && !isDeck(m);
    if (OPT.connMat !== 'auto' && ok(OPT.connMat) && !(kind === 'post' && tensionOnly(OPT.connMat))) return OPT.connMat;
    for (const m of kind === 'post' ? POST_ORDER : HANGER_ORDER) if (ok(m)) return m;
    for (const m of allowed) if (!isDeck(m) && !(kind === 'post' && tensionOnly(m))) return m;
    return null;
  };

  // ================================================================ session
  P._archReset = function () {
    const had = !!(this._arch && this._arch.phase !== 'idle');
    this._arch = { phase: 'idle' };
    return had;
  };
  P.archActive = function () { return !!(this._arch && this._arch.phase && this._arch.phase !== 'idle'); };
  P.archCancel = function () {
    const had = this._archReset();
    if (had) this._sfx('click');
    this._refresh();
    return had;
  };

  // start / end point: a joint under the pointer (magnet), else the grid point
  P._archEndpoint = function (x, y, o, notId) {
    const n = this._pickNode(x, y, this._magR(o), notId ? (q) => q.id !== notId : null);
    if (n) return { id: n.id, x: n.x, y: n.y, kind: n.kind };
    const g = this._grid(o);
    let sx = snap(x, g), sy = snap(y, g);
    if (this._mirror) {
      const ax = this._axis();
      if (Math.abs(sx - ax) < this._magR(o) * 0.6) sx = ax;
    }
    const at = this._nodeAt(sx, sy);
    if (at && at.id !== notId) return { id: at.id, x: at.x, y: at.y, kind: at.kind };
    return { id: null, x: sx, y: sy, kind: 'new' };
  };

  P._archDefaultRise = function (s) {
    const span = Math.max(hyp(s.b.x - s.a.x, s.b.y - s.a.y), 1);
    const sg = tensionOnly(this._mat()) ? -1 : 1;
    return sg * Math.max(GRID, snap(span * 0.2, GRID));
  };
  P._archMidY = function (s) { return (s.a.y + s.b.y) / 2; };

  P._archDown = function (x, y, o) {
    const s = this._arch || (this._arch = { phase: 'idle' });
    s.touch = o.pointerType === 'touch';
    if (s.phase === 'idle') {
      const a = this._archEndpoint(x, y, o, null);
      this._arch = { phase: 'drag', a, b: a, rise: 0, n: 0, touch: s.touch, sx: x, sy: y, moved: false };
      this._sfx('click');
    } else if (s.phase === 'end') {
      s.phase = 'drag';
      s.b = this._archEndpoint(x, y, o, s.a.id);
      s.moved = true;
    } else if (s.phase === 'rise') {
      s.press = { sx: x, sy: y, moved: false, rise0: s.rise };
    }
    return 'handled';
  };

  P._archMove = function (x, y, o) {
    const s = this._arch;
    if (!s || s.phase === 'idle') return;
    const thr = this._px(5 * (o.pointerType === 'touch' ? 2 : 1));
    if (s.phase === 'drag' || s.phase === 'end') {
      if (s.phase === 'drag' && !s.moved && hyp(x - s.sx, y - s.sy) > thr) s.moved = true;
      if (s.phase === 'end' || s.moved) {
        const b = this._archEndpoint(x, y, o, s.a.id);
        if (b.id !== (s.b && s.b.id) && b.id) this._sfx('snap');
        s.b = b;
      }
    } else if (s.phase === 'rise') {
      if (s.press) {
        if (!s.press.moved && hyp(x - s.press.sx, y - s.press.sy) > thr) s.press.moved = true;
        if (s.press.moved) s.rise = snap(s.press.rise0 + (y - s.press.sy), GRID);
      } else if (o.pointerType !== 'touch') {
        s.rise = snap(y - this._archMidY(s), GRID); // mouse: the crown follows the pointer's height
      }
    }
  };

  P._archUp = function (x, y, o) {
    const s = this._arch;
    if (!s || s.phase === 'idle') return;
    if (s.phase === 'drag') {
      if (s.moved) s.b = this._archEndpoint(x, y, o, s.a.id);
      const chord = s.b ? hyp(s.b.x - s.a.x, s.b.y - s.a.y) : 0;
      if (chord < MIN_CHORD) {
        // a click: the start is set, the next click (or drag) sets the end; clicking the start again cancels
        if (s.clicked) { this._archReset(); this._sfx('click'); return; }
        s.phase = 'end'; s.clicked = true; s.b = s.a;
        return;
      }
      s.phase = 'rise';
      s.ry = y;
      s.rise = s.touch || o.pointerType === 'touch' ? this._archDefaultRise(s) : snap(y - this._archMidY(s), GRID);
      if (!s.touch && Math.abs(s.rise) < GRID && tensionOnly(this._mat())) s.rise = this._archDefaultRise(s);
      this._sfx('snap');
    } else if (s.phase === 'end') {
      // released without pressing (touch: tap) - handled by down/up pairs; nothing to do
    } else if (s.phase === 'rise') {
      const pr = s.press;
      s.press = null;
      if (pr && !pr.moved) this._archCommit();
    }
  };

  // ================================================================ planning (no mutation)
  P._archSegProblem = function (A, B, m) {
    if (!A.id) { const p = this._pointProblem(A.x, A.y); if (p) return p; }
    const r = this._beamProblem(A.id || '?arch', B.id || null, A.x, A.y, B.x, B.y, m);
    if (r === 'duplicate_beam') return null; // already there: the placement just keeps it
    if (r) return r;
    const d = matDef(m);
    if (d && d.isRail && Math.abs(B.y - A.y) > ((BG.Model && BG.Model.RAIL_MAX_SLOPE) || 0.25) * Math.abs(B.x - A.x) + 1e-6) return 'rail_too_steep';
    return null;
  };

  /** x positions of deck joints strictly inside [x0, x1] (Connect to deck lines the curve up under / over them) */
  P._archStations = function (x0, x1) {
    const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
    const xs = [];
    for (const b of this._design.beams) {
      if (!isDeck(b.m)) continue;
      for (const id of [b.a, b.b]) {
        const N = this._node(id);
        if (N && N.x > lo + 0.5 && N.x < hi - 0.5 && !xs.some((x) => Math.abs(x - N.x) < 0.3)) xs.push(N.x);
      }
    }
    return xs.sort((a, b) => a - b);
  };

  /** joints + segments of a curve between endpoints a, b (objects {id, x, y}) */
  P._archCurveJoints = function (a, b, rise, n, m) {
    const Cv = C();
    const flip = b.x < a.x - 1e-9;
    const L = flip ? b : a, R = flip ? a : b;
    const curve = Cv.make(OPT.shape, L.x, L.y, R.x, R.y, rise);
    const so = { maxLen: maxLenOf(m), grid: GRID, n: n || 0 };
    let seg = null;
    if (OPT.connect) {
      const st = this._archStations(L.x, R.x);
      if (st.length) seg = Cv.alignedSegment(curve, st, so);
      if (seg && !seg.ok) seg = null;
    }
    if (!seg) seg = Cv.segment(curve, so);
    const joints = seg.points.map((p, i) => {
      if (i === 0) return { id: L.id, x: L.x, y: L.y, kind: L.kind, end: true };
      if (i === seg.points.length - 1) return { id: R.id, x: R.x, y: R.y, kind: R.kind, end: true };
      const at = this._pickNode(p.x, p.y, REUSE, (q) => q.id !== L.id && q.id !== R.id);
      return at ? { id: at.id, x: at.x, y: at.y, kind: at.kind, reused: true } : { id: null, x: p.x, y: p.y, kind: 'new', station: !!p.station };
    });
    return { curve, seg, joints };
  };

  /** the deck line above / below a joint: connector plan {x1,y1 (joint), x2,y2 (deck), target, kind, m, reason};
   *  {onDeck: true} when the joint is on the deck already; null when there is no deck over / under it */
  P._archConnector = function (j) {
    const beams = this._design.beams;
    let best = null;
    for (let i = 0; i < beams.length; i++) {
      const b = beams[i];
      if (!isDeck(b.m)) continue;
      if (j.id && (b.a === j.id || b.b === j.id)) return { onDeck: true, target: j.id };
      const A = this._node(b.a), B = this._node(b.b);
      if (!A || !B) continue;
      const x0 = Math.min(A.x, B.x), x1 = Math.max(A.x, B.x);
      if (x1 - x0 < 1e-6 || j.x < x0 - 1e-6 || j.x > x1 + 1e-6) continue;
      const yd = A.y + (B.y - A.y) * (j.x - A.x) / (B.x - A.x);
      const dy = yd - j.y;
      if (Math.abs(dy) < ON_DECK) return { onDeck: true, target: j.id }; // on the deck line: nothing to connect
      if (!best || Math.abs(dy) < Math.abs(best.dy)) best = { i, A, B, yd, dy };
    }
    if (!best) return null;
    let target = null, tx = j.x, ty = r4(best.yd);
    for (const N of [best.A, best.B]) {
      if (Math.abs(N.x - j.x) <= DECK_REUSE && (!target || Math.abs(N.x - j.x) < Math.abs(target.x - j.x))) target = N;
    }
    if (target) { tx = target.x; ty = target.y; }
    const fixedJ = j.kind === 'anchor' || j.kind === 'pier';
    if (fixedJ && (!target || target.kind !== 'node')) return null; // fixed to fixed (or a cliff bolt under the road end): pointless
    if (j.kind === 'anchor' && j.end) return null;
    const kind = best.dy > 0 ? 'post' : 'hanger';
    const m = this._archConnMat(kind);
    const c = { x1: j.x, y1: j.y, x2: tx, y2: ty, target: target ? target.id : null, kind, m, from: j.id, reason: null };
    if (!m) c.reason = 'material_not_allowed';
    else {
      c.reason = this._beamProblem(j.id || '?arch', c.target, j.x, j.y, tx, ty, m);
      if (c.reason === 'duplicate_beam') return { onDeck: false, exists: true, target: c.target };
    }
    c.valid = !c.reason;
    c.len = hyp(tx - j.x, ty - j.y);
    c.cost = c.valid ? Math.round(c.len * costOf(m)) : 0;
    return c;
  };

  /** a deck joint right above / below a fixed curve end (a cliff bolt under the road anchor): the brace partner */
  P._archEndDeck = function (j) {
    let best = null;
    for (const b of this._design.beams) {
      if (!isDeck(b.m)) continue;
      for (const id of [b.a, b.b]) {
        const N = this._node(id);
        if (!N || N.id === j.id || Math.abs(N.x - j.x) > DECK_REUSE || Math.abs(N.y - j.y) < ON_DECK) continue;
        if (!best || Math.abs(N.x - j.x) + Math.abs(N.y - j.y) * 0.01 < Math.abs(best.x - j.x) + Math.abs(best.y - j.y) * 0.01) best = N;
      }
    }
    return best ? { id: best.id, x: best.x, y: best.y } : null;
  };

  /** spandrel bracing between the curve joints A[i] and their deck partners D[i] (diagonals sloping toward mid-span,
   *  like the deck / through arch templates). pairs: [{A:{id,x,y}, D:{id,x,y}|null}] */
  P._archBraces = function (pairs) {
    const out = [];
    const n = pairs.length - 1, mid = n / 2;
    const struct = this._archConnMat('post');
    const allowed = this._allowedList();
    const tens = HANGER_ORDER.find((q) => allowed.indexOf(q) >= 0 && tensionOnly(q)) || null;
    const same = (p, q) => p && q && ((p.id && p.id === q.id) || (Math.abs(p.x - q.x) < POS_EPS && Math.abs(p.y - q.y) < POS_EPS));
    const seen = {};
    const add = (p, q) => {
      if (!p || !q || same(p, q)) return null;
      const k = p.id && q.id ? key(p.id, q.id) : p.x + ',' + p.y + '|' + q.x + ',' + q.y;
      if (seen[k]) return null;
      seen[k] = 1;
      const len = hyp(q.x - p.x, q.y - p.y);
      let m = struct && len <= maxLenOf(struct) + 1e-6 ? struct : tens && len <= maxLenOf(tens) + 1e-6 ? tens : null;
      if (!m) return null;
      let reason = this._beamProblem(p.id || '?arch', q.id || '?deck', p.x, p.y, q.x, q.y, m);
      if (reason === 'duplicate_beam') return null;
      const b = { x1: p.x, y1: p.y, x2: q.x, y2: q.y, a: p.id, b: q.id, m, kind: 'brace', len, valid: !reason, reason };
      b.cost = b.valid ? Math.round(len * costOf(m)) : 0;
      out.push(b);
      return b;
    };
    for (let i = 0; i < n; i++) {
      const P0 = pairs[i], P1 = pairs[i + 1];
      if (!P0.D || !P1.D || same(P0.D, P1.D)) continue;
      const left = i + 1 <= mid, right = i >= mid;
      const d1 = [P0.D, P1.A], d2 = [P1.D, P0.A];
      const want = [];
      if (left || !right) want.push(d1);
      if (right || !left) want.push(d2);
      for (const d of want) {
        const b = add(d[0], d[1]);
        if (b && tensionOnly(b.m)) { const o = d === d1 ? d2 : d1; add(o[0], o[1]); } // a cable diagonal: brace both ways
      }
    }
    return out;
  };

  P._archSegs = function (joints, m, rise) {
    const segs = [];
    const matReason = tensionOnly(m) && rise > 1e-6 ? 'tension_only' : compressionOnly(m) && rise < -1e-6 ? 'stone_hangs' : null;
    for (let i = 0; i < joints.length - 1; i++) {
      const A = joints[i], B = joints[i + 1];
      const reason = matReason || this._archSegProblem(A, B, m);
      const len = hyp(B.x - A.x, B.y - A.y);
      segs.push({ x1: A.x, y1: A.y, x2: B.x, y2: B.y, m, len, cost: Math.round(len * costOf(m)), valid: !reason, reason });
    }
    return segs;
  };

  /** connectors + brace partners for a list of curve joints (preview: ids may be null) */
  P._archConnectPlan = function (joints, seen) {
    const connectors = [], pairs = [];
    for (const j of joints) {
      const k = j.id || (j.x.toFixed(3) + ',' + j.y.toFixed(3));
      let c = seen[k];
      if (c === undefined) { c = this._archConnector(j); seen[k] = c; if (c && c.x2 != null) connectors.push(c); }
      let D = null;
      if (c && c.onDeck) D = { id: j.id, x: j.x, y: j.y };
      else if (c && c.exists) { const N = this._node(c.target); D = N ? { id: N.id, x: N.x, y: N.y } : null; }
      else if (c && c.x2 != null && c.valid) D = { id: c.target, x: c.x2, y: c.y2 };
      else if (j.end && (j.kind === 'anchor' || j.kind === 'pier')) D = this._archEndDeck(j);
      pairs.push({ A: { id: j.id, x: j.x, y: j.y }, D });
    }
    return { connectors, pairs };
  };

  P._archPlan = function () {
    const s = this._arch;
    if (!s || !s.a || !s.b || s.phase === 'idle') return null;
    const m = this._mat();
    const chord = hyp(s.b.x - s.a.x, s.b.y - s.a.y);
    const plan = { m, shape: OPT.shape, rise: s.phase === 'rise' ? s.rise : 0, span: Math.abs(s.b.x - s.a.x), chord, a: s.a, b: s.b, n: 0, nMin: 0,
      joints: [], segs: [], connectors: [], braces: [], mirror: null, cost: 0, valid: false, reason: null };
    if (chord < MIN_CHORD) { plan.reason = 'span_short'; plan.reasonText = reasonText('span_short', plan); return plan; }
    const cj = this._archCurveJoints(s.a, s.b, plan.rise, s.n, m);
    plan.curve = cj.curve; plan.n = cj.seg.n; plan.nMin = cj.seg.nMin; plan.joints = cj.joints; plan.aligned = !!cj.seg.aligned;
    plan.rise = cj.curve.rise; // circular arcs clamp to a half circle
    plan.segs = this._archSegs(cj.joints, m, plan.rise);
    // mirror: a curve entirely on one side of the axis gets a mirrored twin
    if (this._mirror) {
      const ax = this._axis(), e = POS_EPS;
      const lo = Math.min(s.a.x, s.b.x), hi = Math.max(s.a.x, s.b.x);
      if (hi <= ax + e || lo >= ax - e) {
        const mj = cj.joints.map((j) => {
          const mx = r4(2 * ax - j.x);
          if (Math.abs(j.x - ax) < e && j.id) return { id: j.id, x: j.x, y: j.y, kind: j.kind, end: j.end };
          const at = this._nodeAt(mx, j.y) || (j.end ? null : this._pickNode(mx, j.y, REUSE));
          if (at) return { id: at.id, x: at.x, y: at.y, kind: at.kind, end: j.end };
          if (j.end && j.kind !== 'new' && j.kind !== 'node') return null; // anchor / pier without a twin
          return { id: null, x: mx, y: j.y, kind: 'new', end: j.end };
        });
        if (mj.every(Boolean) && !mj.every((q, i) => q.id && q.id === cj.joints[i].id)) {
          plan.mirror = { joints: mj, segs: this._archSegs(mj, m, plan.rise) };
        }
      }
    }
    // connectors + bracing (preview): from every curve joint to the deck line above / below it
    if (OPT.connect) {
      const seen = {};
      for (const js of [plan.joints].concat(plan.mirror ? [plan.mirror.joints] : [])) {
        const cp = this._archConnectPlan(js, seen);
        plan.connectors = plan.connectors.concat(cp.connectors);
        if (OPT.brace) plan.braces = plan.braces.concat(this._archBraces(cp.pairs));
      }
    }
    const segsAll = plan.segs.concat(plan.mirror ? plan.mirror.segs : []);
    const extra = plan.connectors.concat(plan.braces);
    plan.cost = segsAll.reduce((t, q) => t + q.cost, 0) + extra.reduce((t, c) => t + (c.valid ? c.cost : 0), 0);
    const bad = segsAll.find((q) => !q.valid);
    plan.valid = !bad;
    plan.reason = bad ? bad.reason : null;
    plan.reasonText = bad ? reasonText(bad.reason, plan) : null;
    plan.skipped = extra.filter((c) => !c.valid).length;
    plan.crown = cj.curve.at(0.5);
    return plan;
  };

  // ================================================================ placing
  P._archBuildJoints = function (joints) {
    const ids = joints.map((j) => j.id || this._addNode(j.x, j.y));
    joints.forEach((j, i) => { if (!j.id) this._splitAt(ids[i], null); });
    return ids;
  };
  P._archCommit = function () {
    const s = this._arch;
    const plan = this._archPlan();
    if (!plan || !plan.valid) {
      this._sfx('error');
      if (plan && plan.reasonText) this._toast(plan.reasonText);
      return false;
    }
    this._begin();
    const ids = this._archBuildJoints(plan.joints);
    for (let i = 0; i < ids.length - 1; i++) this._addBeam(ids[i], ids[i + 1], plan.m);
    let mids = [];
    if (plan.mirror) {
      mids = this._archBuildJoints(plan.mirror.joints);
      for (let i = 0; i < mids.length - 1; i++) this._addBeam(mids[i], mids[i + 1], plan.m);
    }
    let posts = 0, skipped = 0, braces = 0;
    if (OPT.connect) {
      const partner = {};
      const live = (id, end) => { const N = this._node(id); return N ? { id, x: N.x, y: N.y, kind: N.kind, end } : null; };
      // posts / hangers, built one by one on the live design (each may split a deck beam)
      for (const id of ids.concat(mids)) {
        if (partner[id] !== undefined) continue;
        const j = live(id, id === ids[0] || id === ids[ids.length - 1] || id === mids[0] || id === mids[mids.length - 1]);
        const c = j ? this._archConnector(j) : null;
        partner[id] = null;
        if (!c) continue;
        if (c.onDeck || c.exists) { partner[id] = c.target; continue; }
        if (!c.valid) { skipped++; continue; }
        let t = c.target;
        if (!t) { t = this._addNode(c.x2, c.y2); this._splitAt(t, id); }
        if (this._addBeam(id, t, c.m)) posts++;
        partner[id] = t;
      }
      if (OPT.brace) {
        for (const list of [ids, mids]) {
          if (!list.length) continue;
          const pairs = list.map((id, i) => {
            const A = live(id, i === 0 || i === list.length - 1);
            let D = partner[id] ? live(partner[id]) : null;
            if (!D && A.end && (A.kind === 'anchor' || A.kind === 'pier')) D = this._archEndDeck(A);
            return { A, D };
          });
          for (const b of this._archBraces(pairs)) {
            if (!b.valid) { skipped++; continue; }
            if (this._addBeam(b.a, b.b, b.m)) braces++;
          }
        }
      }
    }
    this._invalidate();
    this._commit();
    this._sfx('place', { material: plan.m, pan: this._pan(plan.crown ? plan.crown.x : plan.a.x) });
    if (OPT.connect && !posts && !braces && !this._design.beams.some((b) => isDeck(b.m))) this._toast('Build the deck first: the curve connects to the road or track above or below it.');
    else if (skipped) this._toast(skipped + ' connecting member' + (skipped === 1 ? '' : 's') + ' skipped (they would break the rules).');
    this.lastArch = { ids, mirror: mids, posts, braces, skipped, n: plan.n, rise: plan.rise, shape: plan.shape, m: plan.m, aligned: plan.aligned };
    this._arch = { phase: 'idle' };
    if (s) s.phase = 'idle';
    this._refresh();
    return true;
  };

  /** Programmatic placement (tests / tools): a curve from (x0, y0) to (x1, y1) with the given rise. */
  P.placeArch = function (x0, y0, x1, y1, rise, o) {
    o = Object.assign({ pointerType: 'mouse' }, o || {});
    if (o.shape) OPT.shape = o.shape;
    if (o.connect != null) OPT.connect = !!o.connect;
    if (o.connMat) OPT.connMat = o.connMat;
    if (o.brace != null) OPT.brace = !!o.brace;
    const a = this._archEndpoint(x0, y0, o, null);
    const b = this._archEndpoint(x1, y1, o, a.id);
    this._arch = { phase: 'rise', a, b, rise: snap(rise, GRID), n: o.n || 0, touch: false };
    const ok = this._archCommit();
    if (!ok) this._archReset();
    return ok ? this.lastArch : null;
  };

  // ================================================================ Smooth (select tool)
  P.canSmooth = function () { return this._tool === 'select' && this._smoothSet().move.length >= 1; };
  P._smoothSet = function () {
    const ids = Array.from(this._sel.nodes).filter((id) => this._isUser(id));
    const out = { ids, move: [], fixed: [] };
    if (ids.length < 3) return out;
    const onDeck = (id) => this._design.beams.some((b) => (b.a === id || b.b === id) && isDeck(b.m));
    // deck joints stay put when the selection also holds non-deck joints (a box around an arch catches the road)
    let use = ids;
    const nonDeck = ids.filter((id) => !onDeck(id));
    if (nonDeck.length >= 3 && nonDeck.length < ids.length) use = nonDeck;
    if (use.length < 3) return out;
    const pts = use.map((id) => { const n = this._node(id); return { id, x: n.x, y: n.y }; }).sort((a, b) => a.x - b.x || a.y - b.y);
    // a fixed joint (anchor / pier) the chain continues to beyond an end becomes the curve's end
    const ext = (end, dir) => {
      let best = null;
      for (const b of this._design.beams) {
        if (b.a !== end.id && b.b !== end.id) continue;
        const o = this._node(b.a === end.id ? b.b : b.a);
        if (!o || o.kind === 'node' || (o.x - end.x) * dir <= 0.05) continue;
        if (!best || Math.abs(o.x - end.x) < Math.abs(best.x - end.x)) best = o;
      }
      return best;
    };
    const L = ext(pts[0], -1), R = ext(pts[pts.length - 1], 1);
    out.chain = (L ? [{ id: L.id, x: L.x, y: L.y, fixed: true }] : []).concat(pts).concat(R ? [{ id: R.id, x: R.x, y: R.y, fixed: true }] : []);
    out.chain[0].fixed = true;
    out.chain[out.chain.length - 1].fixed = true;
    out.move = out.chain.filter((q) => !q.fixed);
    out.fixed = out.chain.filter((q) => q.fixed);
    return out;
  };
  P.smoothSelection = function () {
    this._syncLevel();
    if (!this._editable()) return false;
    const set = this._smoothSet();
    if (set.ids.length < 3 || !set.move.length) { this._sfx('error'); this._toast('Select at least 3 joints along a curve to smooth them.'); return false; }
    const ch = set.chain;
    const fit = C().fitParabola(ch);
    const A = ch[0], B = ch[ch.length - 1];
    const curve = C().make('parabolic', A.x, A.y, B.x, B.y, fit.rise);
    const target = C().snapped(curve, ch.length - 1, GRID);
    const moves = [];
    ch.forEach((q, i) => { if (!q.fixed) moves.push({ id: q.id, sx: q.x, sy: q.y, tx: target[i].x, ty: target[i].y }); });
    // only rules that hold now are enforced (like a joint drag)
    const moved = new Set(moves.map((q) => q.id));
    const beams = this._design.beams.filter((b) => moved.has(b.a) || moved.has(b.b)).filter((b) => {
      const P1 = this._node(b.a), P2 = this._node(b.b);
      const p = P1 && P2 ? this._beamProblem(b.a, b.b, P1.x, P1.y, P2.x, P2.y, b.m) : 'missing';
      return !p || p === 'duplicate_beam';
    });
    const okNow = {};
    moves.forEach((q) => { okNow[q.id] = !this._pointProblem(q.sx, q.sy); });
    const apply = (t, grid) => {
      for (const q of moves) {
        const n = this._userNode(q.id);
        let x = q.sx + (q.tx - q.sx) * t, y = q.sy + (q.ty - q.sy) * t;
        if (grid) { x = snap(x, GRID); y = snap(y, GRID); }
        n.x = r4(x); n.y = r4(y);
      }
      this._invalidate();
    };
    const valid = () => {
      for (const q of moves) { if (!okNow[q.id]) continue; const n = this._userNode(q.id); if (this._pointProblem(n.x, n.y)) return false; }
      for (const b of beams) {
        const P1 = this._node(b.a), P2 = this._node(b.b);
        const len = hyp(P2.x - P1.x, P2.y - P1.y);
        if (len > maxLenOf(b.m) + 1e-6 || len < Editor.MIN_LEN) return false;
        if (this._segProblem(P1.x, P1.y, P2.x, P2.y)) return false;
        if (this._roadwayProblem(b.a, b.b, P1.x, P1.y, P2.x, P2.y, b.m)) return false;
      }
      // no two joints on the same spot
      for (const q of moves) { const n = this._userNode(q.id); if (this._pickNode(n.x, n.y, POS_EPS, (o) => o.id !== q.id)) return false; }
      return true;
    };
    this._cancelAct();
    this._begin();
    apply(1, true);
    let t = 1;
    if (!valid()) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; apply(mid, true); if (valid()) lo = mid; else hi = mid; }
      t = lo;
      apply(t, true);
      if (!valid()) { apply(0, false); t = 0; }
    }
    const changed = this._commit();
    this._changed(true);
    if (!changed) { this._sfx('error'); this._toast(t === 0 ? "Can't smooth these joints without breaking a rule." : 'Already smooth.'); return false; }
    this._sfx('place', { material: 'steel' });
    if (t < 1) this._toast('Smoothed part of the way: further would break a rule.');
    this.lastSmooth = { moved: moves.length, t };
    return true;
  };

  // ================================================================ editor hooks (wrappers call through)
  function wrap(name, fn) {
    const orig = P[name];
    if (typeof orig !== 'function' || orig.__arch) return;
    const w = fn(orig);
    w.__arch = true;
    P[name] = w;
  }
  wrap('setTool', (orig) => function (t) {
    if (t !== this._tool) this._archReset();
    const was = this._tool;
    const r = orig.apply(this, arguments);
    if (r && t === 'arch' && was !== 'arch' && isDeck(this._mat())) {
      // a curve of road or track makes no sense: start with the best arch material on offer
      const allowed = this._allowedList();
      const m = ARCH_ORDER.find((q) => allowed.indexOf(q) >= 0 && !(tensionOnly(q) && ARCH_ORDER.some((z) => allowed.indexOf(z) >= 0 && !tensionOnly(z))));
      if (m) { this._material = m; this._refresh(); this._uiChanged(); }
    }
    return r;
  });
  wrap('_cancelAct', (orig) => function () { this._archReset(); return orig.apply(this, arguments); });
  wrap('pointerDown', (orig) => function (x, y, o) {
    if (this._tool !== 'arch') return orig.apply(this, arguments);
    o = o || {};
    this._syncLevel();
    this._cursor = { x, y };
    if (!this._editable()) return 'pan';
    if ((o.button || 0) === 2 || (o.button || 0) === 1) return 'pan';
    this._archDown(x, y, o);
    this._refresh(o);
    return 'handled';
  });
  wrap('pointerMove', (orig) => function (x, y, o) {
    if (this._tool !== 'arch') return orig.apply(this, arguments);
    o = o || {};
    this._cursor = { x, y };
    this._mods = o;
    this._archMove(x, y, o);
    this._refresh(o);
  });
  wrap('pointerUp', (orig) => function (x, y, o) {
    if (this._tool !== 'arch') return orig.apply(this, arguments);
    o = o || {};
    this._cursor = { x, y };
    this._archUp(x, y, o);
    this._refresh(o);
  });
  wrap('pointerCancel', (orig) => function () {
    const s = this._arch;
    if (this._tool === 'arch' && s) {
      if (s.phase === 'drag' || s.phase === 'end') this._archReset(); // a second finger landed mid-drag
      else if (s.phase === 'rise') s.press = null;                      // keep the curve: pinch-zoom is fine
    }
    return orig.apply(this, arguments);
  });
  wrap('rightClick', (orig) => function () {
    if (this._tool === 'arch' && this.archActive()) { this.archCancel(); return true; }
    return orig.apply(this, arguments);
  });
  wrap('escape', (orig) => function () {
    if (this._tool === 'arch' && this.archActive()) { this.archCancel(); return true; }
    return orig.apply(this, arguments);
  });
  wrap('keyDown', (orig) => function (k, o) {
    o = o || {};
    const lower = String(k || '').toLowerCase();
    if (this._editable() && !(o.ctrl || o.meta || o.alt)) {
      if (lower === 'a') { this._syncLevel(); this.setTool(this._tool === 'arch' ? 'build' : 'arch'); this._sfx('click'); return true; }
      if (this._archKey(lower)) return true;
    }
    return orig.apply(this, arguments);
  });
  /** +/- while a curve is being placed change its segment count (DOM layer asks before zooming) */
  P._archKey = function (k) {
    if (this._tool !== 'arch' || !this.archActive() || !this._arch.plan) return false;
    if (k === '+' || k === '=' || k === 'add') return this.archSegments(1);
    if (k === '-' || k === '_' || k === 'subtract') return this.archSegments(-1);
    return false;
  };
  /** wheel while the rise is being set changes the segment count (DOM layer asks before zooming) */
  P._archWheel = function (dy) {
    const s = this._arch;
    if (this._tool !== 'arch' || !s || s.phase !== 'rise') return false;
    s.wheel = (s.wheel || 0) + dy;
    if (Math.abs(s.wheel) >= 60 || Math.abs(dy) >= 60) { this.archSegments(s.wheel < 0 ? 1 : -1); s.wheel = 0; }
    return true;
  };
  wrap('_refresh', (orig) => function () {
    const r = orig.apply(this, arguments);
    const st = this.state;
    if (this._tool === 'arch' && this._arch && this._arch.phase !== 'idle') {
      const s = this._arch;
      s.plan = this._archPlan();
      st.arch = { phase: s.phase, plan: s.plan, a: s.a, b: s.b, rise: s.rise, n: s.n, touch: !!s.touch, shape: OPT.shape, connect: OPT.connect,
        handle: s.phase === 'rise' && s.plan && s.plan.crown ? s.plan.crown : null, pressing: !!(s.press && s.press.moved) };
      st.dragFrom = s.a && s.a.id ? s.a.id : null;
    } else st.arch = this._tool === 'arch' ? { phase: 'idle', shape: OPT.shape, connect: OPT.connect } : null;
    st.smooth = this._tool === 'select' ? this._smoothSet().move.length : 0;
    return r;
  });
  // DOM layer: a two-finger tap (no pinch, quick) cancels the curve being placed
  wrap('attach', (orig) => function (canvas) {
    const r = orig.apply(this, arguments);
    const dom = this._dom;
    if (!dom || !canvas || !canvas.addEventListener) return r;
    const ed = this;
    const t2 = { pts: new Map(), start: 0, max: 0, moved: false };
    dom.on(canvas, 'pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      t2.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (t2.pts.size === 1) { t2.start = Date.now(); t2.max = 1; t2.moved = false; }
      t2.max = Math.max(t2.max, t2.pts.size);
    });
    dom.on(canvas, 'pointermove', (e) => {
      const p = t2.pts.get(e.pointerId);
      if (p && hyp(e.clientX - p.x, e.clientY - p.y) > 14) t2.moved = true;
    });
    const up = (e) => {
      if (!t2.pts.has(e.pointerId)) return;
      t2.pts.delete(e.pointerId);
      if (t2.pts.size === 0 && t2.max === 2 && !t2.moved && Date.now() - t2.start < 400 && ed._tool === 'arch' && ed.archActive()) ed.archCancel();
    };
    dom.on(canvas, 'pointerup', up);
    dom.on(canvas, 'pointercancel', up);
    return r;
  });

  // ================================================================ rendering (called by BG.Renderer in edit mode)
  function drawOverlay(r, ctx, state, sh) {
    const es = state && state.editorState;
    const av = es && es.arch;
    if (!av || !av.plan || !r || !r.camera) return;
    const plan = av.plan;
    const z = r.camera.zoom, px = 1 / z;
    const style = BG.Renderer && BG.Renderer.materialStyle;
    const item = (q) => ({ ax: q.x1, ay: q.y1, bx: q.x2, by: q.y2, m: q.m, st: style ? style(q.m) : { w: 0.3, color: '#ccc' }, s: null, i: -1, broken: false, sag: 0 });
    r._worldXf(ctx, sh.x, sh.y);
    ctx.save();
    // the ideal curve, dashed
    if (plan.curve && plan.curve.samples) {
      ctx.setLineDash([6 * px, 6 * px]);
      ctx.lineWidth = 1.5 * px;
      ctx.strokeStyle = plan.valid ? 'rgba(255,236,170,0.75)' : 'rgba(255,120,100,0.7)';
      ctx.beginPath();
      plan.curve.samples.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.setLineDash([6 * px, 6 * px]); ctx.lineWidth = 1.5 * px; ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath(); ctx.moveTo(plan.a.x, plan.a.y); ctx.lineTo(plan.b.x, plan.b.y); ctx.stroke(); ctx.setLineDash([]);
    }
    const drawSegs = (segs, alpha) => {
      for (const q of segs) {
        const it = item(q);
        if (q.valid) {
          ctx.globalAlpha = 0.35 * alpha; r._halo(ctx, [it], '#ffffff', 5);
          ctx.globalAlpha = 0.85 * alpha; r._drawBeamItems(ctx, [it], {});
        } else {
          ctx.globalAlpha = 0.85 * alpha; r._halo(ctx, [it], '#ff3b30', 6);
          ctx.globalAlpha = 0.5 * alpha; r._drawBeamItems(ctx, [it], {});
        }
      }
      ctx.globalAlpha = 1;
    };
    if (plan.n) {
      drawSegs(plan.segs, 1);
      if (plan.mirror) drawSegs(plan.mirror.segs, 0.6);
      for (const c of plan.connectors.concat(plan.braces || [])) {
        if (!c.valid) {
          ctx.globalAlpha = 0.6; ctx.setLineDash([3 * px, 4 * px]); ctx.strokeStyle = '#ff6a5a'; ctx.lineWidth = 2 * px;
          ctx.beginPath(); ctx.moveTo(c.x1, c.y1); ctx.lineTo(c.x2, c.y2); ctx.stroke(); ctx.setLineDash([]);
          continue;
        }
        const it = item(c);
        ctx.globalAlpha = 0.3; r._halo(ctx, [it], '#7fe0ff', 4);
        ctx.globalAlpha = 0.7; r._drawBeamItems(ctx, [it], {});
      }
      ctx.globalAlpha = 1;
      // joints: filled = new, ringed = an existing joint the curve uses
      const joints = plan.joints.concat(plan.mirror ? plan.mirror.joints : []);
      for (const j of joints) {
        ctx.beginPath(); ctx.arc(j.x, j.y, Math.max(0.12, 4 * px), 0, Math.PI * 2);
        if (j.id) { ctx.strokeStyle = '#ffd34a'; ctx.lineWidth = 2.5 * px; ctx.stroke(); }
        else { ctx.fillStyle = '#ffffff'; ctx.fill(); }
      }
    }
    // end markers
    ctx.fillStyle = '#ffd34a';
    for (const e of [plan.a, plan.b]) { ctx.beginPath(); ctx.arc(e.x, e.y, Math.max(0.16, 5 * px), 0, Math.PI * 2); ctx.fill(); }
    // rise handle at the crown (a grip with up / down arrows; bigger on touch)
    const h = av.handle;
    if (h) {
      const R = (av.touch ? 15 : 9) * px;
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = av.pressing ? '#ffd34a' : 'rgba(18,24,36,0.85)';
      ctx.strokeStyle = '#ffd34a'; ctx.lineWidth = 2 * px;
      ctx.beginPath(); ctx.arc(h.x, h.y, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = av.pressing ? '#1b2233' : '#ffd34a';
      const a = R * 0.55;
      ctx.beginPath(); ctx.moveTo(h.x, h.y + a * 1.25); ctx.lineTo(h.x - a * 0.7, h.y + a * 0.25); ctx.lineTo(h.x + a * 0.7, h.y + a * 0.25); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(h.x, h.y - a * 1.25); ctx.lineTo(h.x - a * 0.7, h.y - a * 0.25); ctx.lineTo(h.x + a * 0.7, h.y - a * 0.25); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    // labels (screen space)
    r._screenXf(ctx, sh.x, sh.y);
    const top = plan.curve ? plan.curve.samples.reduce((m, p) => (p.y > m.y ? p : m), plan.curve.samples[0]) : { x: (plan.a.x + plan.b.x) / 2, y: Math.max(plan.a.y, plan.b.y) };
    const p = r.worldToScreen(plan.crown ? plan.crown.x : top.x, top.y);
    const name = (matDef(plan.m) || {}).name || plan.m;
    let text;
    if (!plan.n) text = 'span ' + m1(plan.span) + ' m';
    else {
      const rs = plan.rise;
      text = SHAPE_NAMES[plan.shape] + '  ·  ' + plan.n + ' × ' + name + '  ·  span ' + m1(plan.span) + ' m  ·  ' + (rs < 0 ? 'sag ' + m1(-rs) : 'rise ' + m1(rs)) + ' m  ·  ' + money(plan.cost);
    }
    const yoff = h ? (av.touch ? 40 : 30) : 26;
    r._label(ctx, p.x, p.y - yoff, text, plan.valid || !plan.n ? 'rgba(18,24,36,0.88)' : 'rgba(200,40,30,0.92)', '#ffffff', 12);
    let sub = null, bad = false;
    if (plan.reasonText && (plan.n || av.phase === 'rise')) { sub = plan.reasonText; bad = true; }
    else if (av.phase === 'rise') {
      sub = av.touch ? 'Drag to set the ' + (plan.rise < 0 ? 'sag' : 'rise') + ' · tap to place · −/+ segments'
        : 'Move up/down for the rise · click to place · +/− or wheel: segments · Esc cancels';
      if (plan.connectors.length) sub = plan.connectors.filter((c) => c.valid).length + ' ' + (plan.connectors.some((c) => c.kind === 'hanger') ? 'hangers' : 'posts') + ' to the deck' + (plan.skipped ? ' (' + plan.skipped + ' skipped)' : '') + ' · ' + sub;
    } else if (av.phase === 'end') sub = av.touch ? 'Tap the end point' : 'Click the end point';
    if (sub) {
      const txt = BG.Mobile && BG.Mobile.touchText ? BG.Mobile.touchText(sub) : sub;
      r._label(ctx, p.x, p.y - yoff - 24, txt, bad ? 'rgba(90,10,6,0.88)' : 'rgba(18,24,36,0.72)', bad ? '#ffd0c8' : '#d8e4f4', 10);
    }
  }

  BG.ArchTool = { OPT, SHAPE_NAMES, drawOverlay, reasonText, GRID };

  // ================================================================ browser: contextual bar, hint, game hooks
  const doc = root.document;
  if (!doc) return;

  function game() { return BG.Game || null; }
  function editor() { const g = game(); return g && g.editor; }
  function hudIcon(n) { return BG.Hud && BG.Hud.icon ? BG.Hud.icon(n) : ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function isTouch() { return doc.documentElement.classList.contains('m-touch'); }

  const UI = { bar: null, sig: '' };
  function buildBar() {
    if (UI.bar) return UI.bar;
    const lvl = doc.getElementById('screen-level');
    if (!lvl) return null;
    const t = doc.createElement('template');
    t.innerHTML = `<div class="arch-bar glass" role="toolbar" aria-label="Arch and curve options">
        <div class="ab-sec ab-arch">
          <div class="ab-head"><b>Arch &amp; Curve</b><small data-ab="help"></small></div>
          <div class="ab-row ab-shapes" role="radiogroup" aria-label="Curve shape">
            <button type="button" class="ab-chip" data-ab-shape="parabolic" title="Parabolic: the ideal arch under a uniform deck load (and the shape of a suspension cable)">Parabolic</button>
            <button type="button" class="ab-chip" data-ab-shape="circular" title="Circular: the Roman arch, at most a half circle">Circular</button>
            <button type="button" class="ab-chip" data-ab-shape="catenary" title="Catenary: a hanging cable - drag below the line to sag it, above it for a catenary arch">Catenary</button>
          </div>
          <div class="ab-row ab-segs"><span>Segments</span>
            <button type="button" class="ab-chip ab-sq" data-ab="minus" title="Fewer segments (−)">−</button><b data-ab="n">auto</b>
            <button type="button" class="ab-chip ab-sq" data-ab="plus" title="More segments (+)">+</button></div>
          <label class="ab-row ab-conn" title="Line the curve up with the deck joints and add vertical posts (curve under the deck) or hangers (curve over it) to the road or track"><span>Connect to deck</span><input type="checkbox" class="switch" data-ab="connect"></label>
          <label class="ab-row ab-brace" title="Diagonals between the curve and the deck in every panel: a pin-jointed arch with only posts sways"><span>Brace panels</span><input type="checkbox" class="switch" data-ab="brace"></label>
          <div class="ab-row ab-cmat"><span>Posts / hangers</span><select data-ab="cmat" aria-label="Connector material"></select></div>
        </div>
        <div class="ab-sec ab-select">
          <button type="button" class="btn btn-glass ab-smooth" data-ab="smooth" title="Fit a smooth curve through the selected joints and space them evenly">${hudIcon('arch')}<span>Smooth</span></button>
          <small data-ab="selInfo"></small>
        </div>
      </div>`;
    const bar = t.content.firstElementChild;
    lvl.appendChild(bar);
    bar.addEventListener('click', (e) => {
      const ed = editor();
      if (!ed) return;
      const sh = e.target.closest('[data-ab-shape]');
      if (sh) { ed.setArchShape(sh.dataset.abShape); UI.sig = ''; sh.blur && sh.blur(); return; }
      const b = e.target.closest('[data-ab]');
      if (!b) return;
      const a = b.dataset.ab;
      if (a === 'minus' || a === 'plus') {
        if (!ed.archSegments(a === 'plus' ? 1 : -1)) { ed._sfx('error'); toast(isTouch() ? 'Drag a curve first, then change its segments.' : 'Drag a curve first, then change its segments (+/−).'); }
      } else if (a === 'smooth') ed.smoothSelection();
      if (b.blur && b.tagName === 'BUTTON') b.blur();
      UI.sig = '';
    });
    bar.addEventListener('change', (e) => {
      const ed = editor();
      const el = e.target;
      if (!ed || !el.dataset) return;
      if (el.dataset.ab === 'connect') ed.setArchConnect(el.checked);
      if (el.dataset.ab === 'brace') ed.setArchBrace(el.checked);
      if (el.dataset.ab === 'cmat') ed.setArchConnector(el.value);
      if (el.blur) el.blur();
      UI.sig = '';
    });
    UI.bar = bar;
    return bar;
  }
  function toast(msg) { try { if (BG.Hud && BG.Hud.toast) BG.Hud.toast(msg, 'info'); } catch (e) { /* */ } }

  function updateBar(hud) {
    const ed = editor();
    const bar = buildBar();
    if (!bar) return;
    const lv = hud && hud.level;
    const tool = ed ? ed.tool : null;
    const smoothN = ed && ed.state ? ed.state.smooth || 0 : 0;
    const selN = ed && ed.state && ed.state.selection ? (ed.state.selection.nodes || []).length : 0;
    const mode = hud && hud.screen === 'level' && hud.mode === 'edit' ? (tool === 'arch' ? 'arch' : tool === 'select' && selN >= 3 ? 'select' : '') : '';
    const av = ed && ed.state && ed.state.arch;
    const plan = av && av.plan;
    const allowed = ed ? ed._allowedList() : [];
    const sig = [mode, OPT.shape, OPT.connect, OPT.brace, OPT.connMat, av ? av.phase : '', plan ? plan.n + '/' + plan.nMin + '/' + (av.n || 0) : '', allowed.join(','), selN, smoothN, isTouch(), lv && lv.id].join('|');
    if (sig === UI.sig) return;
    UI.sig = sig;
    if (mode && !UI.shown && hud && hud.hideHint) hud.hideHint(); // the bar sits where the hint shows (H brings it back)
    UI.shown = !!mode;
    bar.classList.toggle('show', !!mode);
    bar.classList.toggle('mode-arch', mode === 'arch');
    bar.classList.toggle('mode-select', mode === 'select');
    if (!mode) return;
    if (mode === 'select') {
      const info = bar.querySelector('[data-ab=selInfo]');
      info.textContent = smoothN ? selN + ' joints selected' : 'Select joints along a curve';
      bar.querySelector('[data-ab=smooth]').disabled = !smoothN;
      return;
    }
    bar.querySelectorAll('[data-ab-shape]').forEach((b) => { const on = b.dataset.abShape === OPT.shape; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); b.setAttribute('role', 'radio'); });
    const nEl = bar.querySelector('[data-ab=n]');
    nEl.textContent = plan && plan.n ? String(plan.n) + (av.n ? '' : ' (auto)') : 'auto';
    const conn = bar.querySelector('[data-ab=connect]');
    if (conn.checked !== OPT.connect) conn.checked = OPT.connect;
    const br = bar.querySelector('[data-ab=brace]');
    if (br.checked !== OPT.brace) br.checked = OPT.brace;
    bar.querySelector('.ab-brace').classList.toggle('dim', !OPT.connect);
    const sel = bar.querySelector('[data-ab=cmat]');
    const opts = ['auto'].concat(allowed.filter((m) => !isDeck(m)));
    const html = opts.map((m) => '<option value="' + esc(m) + '">' + esc(m === 'auto' ? 'Auto' : (matDef(m) || {}).name || m) + '</option>').join('');
    if (sel._html !== html) { sel.innerHTML = html; sel._html = html; }
    sel.value = opts.indexOf(OPT.connMat) >= 0 ? OPT.connMat : 'auto';
    bar.querySelector('.ab-cmat').classList.toggle('dim', !OPT.connect);
    const help = bar.querySelector('[data-ab=help]');
    const touch = isTouch();
    help.textContent = !av || av.phase === 'idle' ? (touch ? 'Drag from start to end' : 'Drag from start to end (A)')
      : av.phase === 'rise' ? (touch ? 'Drag to set the rise, tap to place' : 'Move up/down, click to place') : (touch ? 'Release at the end point' : 'Release at the end point');
  }

  // hints: levels whose hint mentions arches point at the tool
  function archHint(level) { return !!(level && typeof level.hint === 'string' && /\barch/i.test(level.hint)); }

  function install() {
    const H = BG.Hud, G = BG.Game;
    if (H && !H.__arch) {
      H.__arch = true;
      const wrapH = (name, fn) => { if (typeof H[name] === 'function') { const o = H[name]; H[name] = fn(o); } };
      wrapH('update', (o) => function () { const r = o.apply(this, arguments); try { updateBar(this); } catch (e) { /* the bar never breaks the HUD */ } return r; });
      wrapH('showHint', (o) => function (text, ms) {
        const lv = this.level;
        if (lv && archHint(lv)) {
          const tt = BG.Mobile && BG.Mobile.touchText;
          const plain = !text || text === lv.hint || (tt && text === tt(lv.hint));
          if (plain && !/Arch tool/.test(text || '')) text = (text || lv.hint) + (isTouch() ? ' Try the Arch tool.' : ' Try the Arch tool (A).');
        }
        return o.call(this, text, ms);
      });
      wrapH('setMode', (o) => function (mode) { const r = o.apply(this, arguments); UI.sig = ''; return r; });
    }
    if (G && !G.__arch) {
      G.__arch = true;
      // the cost bar shows the projected total while a curve is being placed
      const gc = G.getCost;
      if (typeof gc === 'function') {
        G.getCost = function () {
          const c = gc.apply(this, arguments);
          const ed = this.editor, av = ed && ed.state && ed.state.arch;
          return this.state === 'edit' && av && av.plan && av.plan.n && (av.phase === 'rise' || av.phase === 'drag') ? c + av.plan.cost : c;
        };
      }
      const ss = G.startSim;
      if (typeof ss === 'function') G.startSim = function () { const ed = this.editor; if (ed && ed.archActive && ed.archActive()) ed.archCancel(); return ss.apply(this, arguments); };
    }
  }
  install();
})(typeof window !== 'undefined' ? window : globalThis);
