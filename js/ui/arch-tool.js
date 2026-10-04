// SPAN — Arch & Curve tool (SPEC §18): BG.ArchTool + Editor.prototype extensions.
//
// Gesture (editor tool 'arch', key A): press on a start point (joint / anchor / pier top / empty grid point), drag
// to the end point, release; then move the pointer up / down to set the rise (or the sag below the chord) and click
// to place it. Touch: the same with the loupe; after the release a handle sits at the crown - drag (anywhere) to set
// the rise, tap to place (a tap on the handle itself does not). The bar's Place / Cancel buttons do the same; Esc /
// right-click / a two-finger tap cancel too. A click without a drag picks the start and a second click the end. +/- (or
// the wheel, or the -/+ chips) change the number of segments while the rise is set. The preview's labels stay clear of
// the HUD (above the curve, else below it).
//
// The curve itself comes from BG.Curves (js/core/curves.js): the fewest segments, all <= the material's max length
// (with a margin), joints on the 0.25 m grid. Endpoints reuse joints under the pointer (magnet), interior joints reuse
// joints they land on and split beams they land on (like the build tool). Options (contextual bar): shape (parabolic,
// circular, catenary), "Connect to deck" (on by default: vertical posts / hangers from every curve joint to the deck line
// above or below it, splitting deck beams where needed; a joint on the road where the curve crosses it), "Brace panels"
// and the connector material. Mirror mode mirrors an arch that lies on
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
  const ON_DECK = 0.45;       // m: a fixed curve end this close (vertically) to a deck joint has no brace partner
  const ON_LINE = 0.26;       // m: a curve joint this close to the deck line is put on it (joins / splits it): no connector
                              //    (a shorter one would be under the 0.25 m minimum member length)
  const SNAP_DECK = 0.45;     // m: a curve joint at a deck station this close to the deck is pinned onto it
  const POS_EPS = 0.02;
  const SHAPE_NAMES = { parabolic: 'editor.arch.shape.parabolic', circular: 'editor.arch.shape.circular', catenary: 'editor.arch.shape.catenary' }; // dictionary keys
  const POST_ORDER = ['steel', 'wood', 'girder', 'masonry', 'reinforced_road'];
  const HANGER_ORDER = ['cable', 'rope', 'steel', 'wood', 'girder'];
  const ARCH_ORDER = ['masonry', 'steel', 'wood', 'girder', 'cable', 'rope'];

  // Connect to deck is on by default: an arch under (or a cable over) a road is meant to carry it, and a bare
  // pin-jointed arch next to an unconnected deck fails - the most common newcomer surprise.
  const OPT = { shape: 'parabolic', connect: true, brace: true, connMat: 'auto' };

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
  // i18n (docs/I18N.md): every text goes through t(); numbers through BG.i18n's formatters
  function I() { return BG.i18n || null; }
  function t(key, params) { return I() ? I().t(key, params) : key; }
  function money(n) { return I() ? I().money(n) : '$' + Math.round(n); }
  function m1(v) { return I() ? I().meters(v, 1) : (Math.round(v * 10) / 10).toFixed(1) + ' m'; }
  function matName(id) { return Editor.matName ? Editor.matName(id) : ((matDef(id) || {}).name || id); }

  // why a curve (or one of its connectors) can't be built: editor.arch.reason.<code>. The part before a colon is the
  // short form (the "n members skipped: ..." line keeps only that)
  const REASON_PARAMS = {
    too_long: (p) => ({ max: I() ? I().meters(maxLenOf(p.m)) : maxLenOf(p.m) + ' m' }),
    material_not_allowed: (p) => ({ name: matName(p.m) }),
    tension_only: (p) => ({ name: matName(p.m) }),
    stone_hangs: (p) => ({ name: matName(p.m) }),
    near_terrain: () => ({ gap: I() ? I().meters(0.5) : '0.5 m' }),
    span_short: () => ({ min: I() ? I().meters(MIN_CHORD) : MIN_CHORD + ' m' }),
  };
  function reasonText(r, plan) {
    const k = 'editor.arch.reason.' + r;
    if (!r || !I() || !I().has(k, 'en')) return String(r || '').replace(/_/g, ' ');
    return t(k, REASON_PARAMS[r] ? REASON_PARAMS[r](plan || {}) : null);
  }

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

  /** the starting rise after a touch release: a fifth of the span (a sag for cables), but clear of a deck line
   *  under the middle - a cable hangs down to 1 m above the road, an arch under a road rises to 1 m below it */
  P._archDefaultRise = function (s) {
    const span = Math.max(hyp(s.b.x - s.a.x, s.b.y - s.a.y), 1);
    const sg = tensionOnly(this._mat()) ? -1 : 1;
    let r = span * 0.2;
    const mx = (s.a.x + s.b.x) / 2, my = (s.a.y + s.b.y) / 2;
    let deck = null; // the nearest deck line on the side the curve bends to
    for (const b of this._design.beams) {
      if (!isDeck(b.m)) continue;
      const A = this._node(b.a), B = this._node(b.b);
      if (!A || !B || Math.abs(B.x - A.x) < 1e-6 || mx < Math.min(A.x, B.x) - 1e-6 || mx > Math.max(A.x, B.x) + 1e-6) continue;
      const y = A.y + (B.y - A.y) * (mx - A.x) / (B.x - A.x);
      if ((y - my) * sg > 0.5 && (deck == null || Math.abs(y - my) < Math.abs(deck - my))) deck = y;
    }
    if (deck != null) r = Math.min(r, Math.abs(deck - my) - 1);
    r = Math.max(GRID, snap(r, GRID));
    // and one the rules allow, if there is one (a cable from a bank anchor up to a tower must not dip into the bank)
    const keep = { phase: s.phase, rise: s.rise };
    s.phase = 'rise';
    let best = sg * r;
    for (let k = 0; k <= 8; k++) {
      const q = sg * Math.max(GRID, snap(r * (1 - k / 8), GRID));
      s.rise = q;
      const plan = this._archPlan();
      // valid, and the ideal curve itself stays out of the ground (the handle sits on it)
      const inGround = plan && plan.curve && plan.curve.samples.some((p, i) => i % 24 === 0 && this._pointProblem(p.x, p.y) === 'in_terrain');
      if (plan && plan.valid && !inGround) { best = q; break; }
    }
    s.phase = keep.phase; s.rise = keep.rise;
    return best;
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
      const h = s.plan && s.plan.crown;
      const onHandle = !!(h && s.touch && hyp(x - h.x, y - h.y) <= this._px(30));
      s.press = { sx: x, sy: y, moved: false, rise0: s.rise, onHandle };
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
      // a tap places the curve; on touch a tap on the handle itself does not (it reads as "grab", not "place")
      if (pr && !pr.moved && !pr.onHandle) this._archCommit();
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

  /** Connect to deck lines the curve up with the deck: stations strictly inside [x0, x1] at the user deck joints
   *  (a number, or {x, y} pinning the curve joint onto the deck joint when the curve passes within SNAP_DECK of it),
   *  plus {x, y} where the curve crosses a deck beam (a through arch: the joint sits on the road and joins it). */
  P._archStations = function (x0, x1, curve) {
    const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
    const out = [];
    const taken = (x) => out.some((q) => Math.abs((q.x != null ? q.x : q) - x) < 0.5);
    const deckBeams = [];
    for (const b of this._design.beams) {
      if (!isDeck(b.m)) continue;
      const A = this._node(b.a), B = this._node(b.b);
      if (A && B) deckBeams.push([A, B]);
    }
    const yc = (x) => (curve ? C().yAt(curve, x) : null);
    for (const [A, B] of deckBeams) {
      for (const N of [A, B]) {
        if (N.kind !== 'node' || !(N.x > lo + 0.5 && N.x < hi - 0.5) || taken(N.x)) continue;
        const y = yc(N.x);
        out.push(y != null && Math.abs(y - N.y) < SNAP_DECK ? { x: N.x, y: N.y } : N.x);
      }
    }
    if (curve) {
      for (const [A, B] of deckBeams) {
        const L = A.x <= B.x ? A : B, R = A.x <= B.x ? B : A;
        const a = Math.max(L.x, lo + 0.5), b = Math.min(R.x, hi - 0.5);
        if (!(b - a > 1e-6) || R.x - L.x < 1e-6) continue;
        const dy = (x) => { const y = yc(x); return y == null ? null : y - (L.y + (R.y - L.y) * (x - L.x) / (R.x - L.x)); };
        let fa = dy(a), fb = dy(b);
        if (fa == null || fb == null || fa * fb > 0) continue;
        let p = a, q = b;
        for (let i = 0; i < 40; i++) { const m = (p + q) / 2, fm = dy(m); if (fm == null) break; if (fa * fm <= 0) { q = m; fb = fm; } else { p = m; fa = fm; } }
        const x = snap((p + q) / 2, GRID);
        if (x <= L.x + 0.3 || x >= R.x - 0.3 || x <= lo + 0.5 || x >= hi - 0.5 || taken(x)) continue; // at a deck joint: that station handles it
        out.push({ x, y: r4(L.y + (R.y - L.y) * (x - L.x) / (R.x - L.x)) });
      }
    }
    return out.sort((p, q) => (p.x != null ? p.x : p) - (q.x != null ? q.x : q));
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
      const st = this._archStations(L.x, R.x, curve);
      if (st.length) seg = Cv.alignedSegment(curve, st, so);
      if (seg && !seg.ok) seg = null;
    }
    if (!seg) seg = Cv.segment(curve, so);
    // with Connect to deck, a joint that grazes the deck line goes onto it (joined, like a deck crossing)
    const deckY = (x, y) => {
      for (const b of this._design.beams) {
        if (!isDeck(b.m)) continue;
        const A = this._node(b.a), B = this._node(b.b);
        if (!A || !B || Math.abs(B.x - A.x) < 1e-6 || x <= Math.min(A.x, B.x) + 1e-6 || x >= Math.max(A.x, B.x) - 1e-6) continue;
        const yd = A.y + (B.y - A.y) * (x - A.x) / (B.x - A.x);
        if (Math.abs(yd - y) < ON_LINE) return r4(yd);
      }
      return null;
    };
    const joints = seg.points.map((p, i) => {
      if (i === 0) return { id: L.id, x: L.x, y: L.y, kind: L.kind, end: true };
      if (i === seg.points.length - 1) return { id: R.id, x: R.x, y: R.y, kind: R.kind, end: true };
      if (OPT.connect && !p.pinY) { const yd = deckY(p.x, p.y); if (yd != null) p = { x: p.x, y: yd, station: p.station, pinY: true }; }
      const at = this._pickNode(p.x, p.y, p.pinY ? POS_EPS : REUSE, (q) => q.id !== L.id && q.id !== R.id);
      return at ? { id: at.id, x: at.x, y: at.y, kind: at.kind, reused: true } : { id: null, x: p.x, y: p.y, kind: 'new', station: !!p.station, onDeck: !!p.pinY };
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
      if (Math.abs(dy) < ON_LINE) return { onDeck: true, target: j.id }; // on the deck line (joins it): nothing to connect
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
   *  like the deck / through arch templates). pairs: [{A:{id,x,y}, D:{id,x,y}|null}]. Under a hanging cable the
   *  panel diagonals swap between tension and compression as the load moves: crossed cables (tension-only pairs)
   *  there, never a lone wood strut that buckles. */
  P._archBraces = function (pairs, curveMat) {
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
      const tensFits = tens && len <= maxLenOf(tens) + 1e-6;
      let m = tensionOnly(curveMat) && tensFits ? tens : struct && len <= maxLenOf(struct) + 1e-6 ? struct : tensFits ? tens : null;
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
      if (same(P0.D, P0.A) || same(P1.D, P1.A)) continue; // a curve joint on the deck: the panel is a triangle already
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
    // connectors + bracing (preview): from every curve joint to the deck line above / below it (not while the end
    // is still being dragged: a flat chord's posts are only noise)
    if (OPT.connect && s.phase === 'rise') {
      const seen = {};
      for (const js of [plan.joints].concat(plan.mirror ? [plan.mirror.joints] : [])) {
        const cp = this._archConnectPlan(js, seen);
        plan.connectors = plan.connectors.concat(cp.connectors);
        if (OPT.brace) plan.braces = plan.braces.concat(this._archBraces(cp.pairs, m));
      }
    }
    const segsAll = plan.segs.concat(plan.mirror ? plan.mirror.segs : []);
    const extra = plan.connectors.concat(plan.braces);
    plan.cost = segsAll.reduce((t, q) => t + q.cost, 0) + extra.reduce((t, c) => t + (c.valid ? c.cost : 0), 0);
    const bad = segsAll.find((q) => !q.valid);
    plan.valid = !bad;
    plan.reason = bad ? bad.reason : null;
    plan.reasonText = bad ? reasonText(bad.reason, plan) : null;
    const skip = extra.filter((c) => !c.valid);
    plan.skipped = skip.length;
    plan.skipReason = skip.length ? reasonText(skip[0].reason, Object.assign({}, plan, { m: skip[0].m })) : null;
    plan.noDeck = OPT.connect && !this._design.beams.some((b) => isDeck(b.m));
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
    let posts = 0, skipped = 0, braces = 0, skipWhy = null;
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
        if (!c.valid) { skipped++; skipWhy = skipWhy || c; continue; }
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
          for (const b of this._archBraces(pairs, plan.m)) {
            if (!b.valid) { skipped++; skipWhy = skipWhy || b; continue; }
            if (this._addBeam(b.a, b.b, b.m)) braces++;
          }
        }
      }
    }
    this._invalidate();
    this._commit();
    this._sfx('place', { material: plan.m, pan: this._pan(plan.crown ? plan.crown.x : plan.a.x) });
    if (OPT.connect && !posts && !braces && !this._design.beams.some((b) => isDeck(b.m))) {
      if (!this._archToldNoDeck) this._toast(t('editor.arch.toast.deckFirst'));
      this._archToldNoDeck = true;
    } else if (skipped) {
      this._toast(t('editor.arch.toast.skipped', { n: skipped, why: reasonText(skipWhy.reason, { m: skipWhy.m }).replace(/:.*$/, '') }));
    }
    BG.ArchTool.placed = (BG.ArchTool.placed || 0) + 1;
    this.lastArch = { ids, mirror: mids, posts, braces, skipped, n: plan.n, rise: plan.rise, shape: plan.shape, m: plan.m, aligned: plan.aligned };
    this._arch = { phase: 'idle' };
    if (s) s.phase = 'idle';
    this._refresh();
    return true;
  };

  /** place the curve being set (the bar's Place button); false when there is none or it is invalid */
  P.archPlace = function () {
    const s = this._arch;
    if (!s || s.phase !== 'rise') { this._sfx('error'); return false; }
    s.press = null;
    return this._archCommit();
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
    if (set.ids.length < 3 || !set.move.length) { this._sfx('error'); this._toast(t('editor.arch.toast.smoothMin', { n: 3 })); return false; }
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
    let frac = 1;
    if (!valid()) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; apply(mid, true); if (valid()) lo = mid; else hi = mid; }
      frac = lo;
      apply(frac, true);
      if (!valid()) { apply(0, false); frac = 0; }
    }
    const changed = this._commit();
    this._changed(true);
    if (!changed) { this._sfx('error'); this._toast(t(frac === 0 ? 'editor.arch.toast.smoothBlocked' : 'editor.arch.toast.smoothDone')); return false; }
    this._sfx('place', { material: 'steel' });
    if (frac < 1) this._toast(t('editor.arch.toast.smoothPart'));
    this.lastSmooth = { moved: moves.length, t: frac };
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
    if (!av || !r || !r.camera) return;
    if (!av.plan) { if (av.phase === 'idle' && state.mode !== 'sim') drawIdleHint(r, ctx, av, sh); return; }
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
    // labels (screen space): kept clear of the HUD (top bar, the arch bar, the rail, the palette) - above the
    // preview when there is room, else below it, and inside the screen sideways
    r._screenXf(ctx, sh.x, sh.y);
    const name = matName(plan.m);
    const lines = [];
    const rs = plan.rise;
    if (av.phase === 'drag' || av.phase === 'end' || !plan.n) lines.push({ text: t('editor.arch.label.span', { name, span: m1(plan.span) }), bad: false });
    else lines.push({ text: t(rs < 0 ? 'editor.arch.label.planSag' : 'editor.arch.label.planRise', { shape: t(SHAPE_NAMES[plan.shape]), n: plan.n, name, span: m1(plan.span), h: m1(Math.abs(rs)), cost: money(plan.cost) }), bad: !plan.valid });
    let sub = null, bad = false;
    if (plan.reasonText && (av.phase === 'rise' || (plan.reason === 'span_short' && av.phase !== 'drag'))) { sub = plan.reasonText; bad = true; }
    else if (av.phase === 'rise') {
      sub = t('editor.arch.sub.' + (av.touch ? 'touch' : 'mouse') + (rs < 0 ? 'Sag' : 'Rise'));
      const valid = plan.connectors.filter((c) => c.valid).length;
      if (plan.connectors.length) {
        sub = t(plan.connectors.some((c) => c.kind === 'hanger') ? 'editor.arch.sub.hangers' : 'editor.arch.sub.posts', { n: valid }) + ' · ' + sub;
      } else if (plan.noDeck) sub = t('editor.arch.sub.noDeck') + ' · ' + sub;
      if (plan.skipped) sub = t('editor.arch.sub.skipped', { n: plan.skipped, why: String(plan.skipReason || '').replace(/:.*$/, '') }) + ' · ' + sub;
      const free = [plan.a, plan.b].filter((e) => e && !e.id).length;
      if (free && !plan.skipped) sub = t(free === 2 ? 'editor.arch.sub.freeBoth' : 'editor.arch.sub.freeOne') + ' · ' + sub;
    } else if (av.phase === 'end') sub = t(av.touch ? 'editor.arch.sub.tapEnd' : 'editor.arch.sub.clickEnd');
    else if (av.phase === 'drag') sub = t(av.touch ? 'editor.arch.sub.liftEnd' : 'editor.arch.sub.releaseEnd');
    if (sub) lines.push({ text: BG.Mobile && BG.Mobile.touchText ? BG.Mobile.touchText(sub) : sub, bad, small: true });
    // the preview's screen extent
    let minY = Infinity, maxY = -Infinity;
    const ext = (x, y) => { const q = r.worldToScreen(x, y); if (q.y < minY) minY = q.y; if (q.y > maxY) maxY = q.y; };
    if (plan.curve && plan.curve.samples) for (let i = 0; i < plan.curve.samples.length; i += 12) ext(plan.curve.samples[i].x, plan.curve.samples[i].y);
    ext(plan.a.x, plan.a.y); ext(plan.b.x, plan.b.y);
    for (const c of plan.connectors.concat(plan.braces || [])) { ext(c.x1, c.y1); ext(c.x2, c.y2); }
    if (plan.mirror) for (const j of plan.mirror.joints) ext(j.x, j.y);
    const cx = r.worldToScreen(plan.crown ? plan.crown.x : (plan.a.x + plan.b.x) / 2, 0).x;
    placeLabels(r, ctx, lines, cx, minY - (h ? (av.touch ? 22 : 14) : 10), maxY + 14);
  }

  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'; // = the renderer's label font
  /** the canvas area not covered by HUD panels (CSS px, canvas coordinates); set by the browser part below */
  function safeArea(r) {
    const W = r.W || 800, H = r.H || 600;
    const s = (BG.ArchTool && BG.ArchTool.safeRect && BG.ArchTool.safeRect()) || null;
    return s ? { top: Math.max(0, s.top), left: Math.max(0, s.left), right: Math.min(W, s.right), bottom: Math.min(H, s.bottom) } : { top: 0, left: 0, right: W, bottom: H };
  }
  /** draw a stack of labels (first = main, nearest the preview) above yAbove, or below yBelow when there is no room */
  function placeLabels(r, ctx, lines, cx, yAbove, yBelow) {
    const S = safeArea(r), GAP = 5;
    const dims = lines.map((l) => { const size = l.small ? 10 : 12; ctx.font = '700 ' + size + 'px ' + FONT; const mt = ctx.measureText ? ctx.measureText(l.text) : null; return { size, w: (mt && mt.width > 0 ? mt.width : l.text.length * size * 0.56) + size * 1.3, h: size * 1.9 }; });
    const total = dims.reduce((t, d) => t + d.h, 0) + GAP * (dims.length - 1);
    let y0, dir; // y0 = the main label's edge nearest the preview; dir = -1 stacks upward, +1 downward
    if (yAbove - total >= S.top + 4) { y0 = yAbove; dir = -1; }
    else if (yBelow + total <= S.bottom - 4) { y0 = yBelow; dir = 1; }
    else { y0 = S.top + 4 + total; dir = -1; }
    let y = y0;
    const drawn = [];
    lines.forEach((l, i) => {
      const d = dims[i];
      const yc = y + dir * d.h / 2;
      const x = Math.min(Math.max(cx, S.left + d.w / 2 + 6), Math.max(S.left + d.w / 2 + 6, S.right - d.w / 2 - 6));
      const bg = l.small ? (l.bad ? 'rgba(90,10,6,0.9)' : 'rgba(18,24,36,0.78)') : (l.bad ? 'rgba(200,40,30,0.92)' : 'rgba(18,24,36,0.88)');
      r._label(ctx, x, yc, l.text, bg, l.small ? (l.bad ? '#ffd0c8' : '#d8e4f4') : '#ffffff', d.size);
      drawn.push({ text: l.text, x: x - d.w / 2, y: yc - d.h / 2, w: d.w, h: d.h });
      y += dir * (d.h + GAP);
    });
    BG.ArchTool.lastLabels = drawn; // (tests: where the labels went, canvas CSS px)
  }
  /** the idle hint (no curve in progress): a pill at the bottom of the free area until a first curve is placed */
  function drawIdleHint(r, ctx, av, sh) {
    if (BG.ArchTool.placed || !r._label) return;
    r._screenXf(ctx, sh.x, sh.y);
    const S = safeArea(r);
    const d = root.document;
    const touch = !!(d && d.documentElement && d.documentElement.classList && d.documentElement.classList.contains('m-touch'));
    const text = t(touch ? 'editor.arch.idleTouch' : 'editor.arch.idle');
    placeLabels(r, ctx, [{ text, small: true }], (S.left + S.right) / 2, S.bottom - 10, S.bottom);
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
    const tpl = doc.createElement('template');
    tpl.innerHTML = `<div class="arch-bar glass" role="toolbar" data-i18n-aria="editor.arch.bar.aria">
        <div class="ab-sec ab-arch">
          <div class="ab-head"><b data-i18n="editor.arch.bar.title"></b><small data-ab="help"></small></div>
          <div class="ab-row ab-shapes" role="radiogroup" data-i18n-aria="editor.arch.bar.shape">
            <button type="button" class="ab-chip" data-ab-shape="parabolic" data-i18n-title="editor.arch.bar.parabolicTip" data-i18n="editor.arch.shape.parabolic"></button>
            <button type="button" class="ab-chip" data-ab-shape="circular" data-i18n-title="editor.arch.bar.circularTip" data-i18n="editor.arch.shape.circular"></button>
            <button type="button" class="ab-chip" data-ab-shape="catenary" data-i18n-title="editor.arch.bar.catenaryTip" data-i18n="editor.arch.shape.catenary"></button>
          </div>
          <div class="ab-row ab-act">
            <button type="button" class="ab-chip ab-place" data-ab="place" data-i18n-title="editor.arch.bar.placeTip" data-i18n="editor.arch.bar.place"></button>
            <button type="button" class="ab-chip ab-cancel" data-ab="cancel" data-i18n-title="editor.arch.bar.cancelTip" data-i18n="editor.arch.bar.cancel"></button>
          </div>
          <div class="ab-row ab-segs"><span data-i18n="editor.arch.bar.segments"></span>
            <button type="button" class="ab-chip ab-sq" data-ab="minus" data-i18n-title="editor.arch.bar.fewer">−</button><b data-ab="n"></b>
            <button type="button" class="ab-chip ab-sq" data-ab="plus" data-i18n-title="editor.arch.bar.more">+</button></div>
          <label class="ab-row ab-conn" data-i18n-title="editor.arch.bar.connectTip"><span data-i18n="editor.arch.bar.connect"></span><input type="checkbox" class="switch" data-ab="connect"></label>
          <label class="ab-row ab-brace" data-i18n-title="editor.arch.bar.braceTip"><span data-i18n="editor.arch.bar.brace"></span><input type="checkbox" class="switch" data-ab="brace"></label>
          <div class="ab-row ab-cmat"><span data-i18n="editor.arch.bar.connector"></span><select data-ab="cmat" data-i18n-aria="editor.arch.bar.connectorAria"></select></div>
        </div>
        <div class="ab-sec ab-select">
          <button type="button" class="btn btn-glass ab-smooth" data-ab="smooth" data-i18n-title="editor.arch.bar.smoothTip">${hudIcon('arch')}<span data-i18n="editor.arch.bar.smooth"></span></button>
          <small data-ab="selInfo"></small>
        </div>
      </div>`;
    const bar = tpl.content.firstElementChild;
    if (I()) I().apply(bar);
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
        if (!ed.archSegments(a === 'plus' ? 1 : -1)) { ed._sfx('error'); toast(t(isTouch() ? 'editor.arch.toast.segsFirstTouch' : 'editor.arch.toast.segsFirst')); }
      } else if (a === 'place') ed.archPlace();
      else if (a === 'cancel') ed.archCancel();
      else if (a === 'smooth') ed.smoothSelection();
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
      updateBar(BG.Hud); // at once (the dependent controls enable / disable with Connect to deck)
    });
    UI.bar = bar;
    return bar;
  }
  // the part of the canvas no HUD panel covers (canvas CSS px): the curve's labels stay inside it
  const SAFE = { t: 0, rect: null };
  BG.ArchTool.safeRect = function () {
    const now = Date.now();
    if (SAFE.rect && now - SAFE.t < 250) return SAFE.rect;
    const g = game(), cv = g && g.canvas;
    if (!cv || !cv.getBoundingClientRect) return null;
    const c = cv.getBoundingClientRect();
    const out = { top: 0, left: 0, right: c.width, bottom: c.height };
    const box = (sel) => {
      const el = doc.querySelector(sel);
      if (!el || !el.getClientRects().length) return null;
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.height > 0 ? { top: b.top - c.top, bottom: b.bottom - c.top, left: b.left - c.left, right: b.right - c.left } : null;
    };
    for (const sel of ['#screen-level .topbar', '#screen-level .arch-bar.show']) { const b = box(sel); if (b && b.top < c.height / 2) out.top = Math.max(out.top, b.bottom + 6); }
    const rail = box('#screen-level .rail');
    if (rail && rail.right < c.width / 3) out.left = Math.max(out.left, rail.right + 6);
    for (const sel of ['#screen-level .palette', '#screen-level .test-btn', '.m-mat-chip']) {
      const b = box(sel);
      if (b && b.top > c.height / 2 && b.left < c.width * 0.75 && b.right > c.width * 0.25) out.bottom = Math.min(out.bottom, b.top - 6);
    }
    SAFE.t = now; SAFE.rect = out;
    return out;
  };

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
    const sig = [mode, OPT.shape, OPT.connect, OPT.brace, OPT.connMat, av ? av.phase : '', plan ? plan.n + '/' + plan.nMin + '/' + (av.n || 0) + '/' + plan.valid : '', allowed.join(','), selN, smoothN, isTouch(), lv && lv.id, I() ? I().lang() : ''].join('|');
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
      info.textContent = smoothN ? t('editor.arch.bar.selected', { n: selN }) : t('editor.arch.bar.selectHint');
      bar.querySelector('[data-ab=smooth]').disabled = !smoothN;
      return;
    }
    bar.querySelectorAll('[data-ab-shape]').forEach((b) => { const on = b.dataset.abShape === OPT.shape; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); b.setAttribute('role', 'radio'); });
    const nEl = bar.querySelector('[data-ab=n]');
    nEl.textContent = plan && plan.n ? (av.n ? String(plan.n) : t('editor.arch.bar.nAuto', { n: plan.n })) : t('editor.arch.bar.auto');
    const conn = bar.querySelector('[data-ab=connect]');
    if (conn.checked !== OPT.connect) conn.checked = OPT.connect;
    const br = bar.querySelector('[data-ab=brace]');
    if (br.checked !== OPT.brace) br.checked = OPT.brace;
    bar.querySelector('.ab-brace').classList.toggle('dim', !OPT.connect);
    br.disabled = !OPT.connect; // bracing and the connector material only matter with Connect to deck
    // Place / Cancel while a curve is being set (a tap on the canvas also places; Esc / two fingers also cancel)
    const active = !!(av && av.phase && av.phase !== 'idle');
    bar.classList.toggle('placing', active);
    if (active && !UI.wasActive && bar.scrollLeft) bar.scrollLeft = 0; // phones: bring Place / Cancel into view
    UI.wasActive = active;
    const place = bar.querySelector('[data-ab=place]');
    place.disabled = !(av && av.phase === 'rise' && plan && plan.valid);
    const sel = bar.querySelector('[data-ab=cmat]');
    const opts = ['auto'].concat(allowed.filter((m) => !isDeck(m)));
    const html = opts.map((m) => '<option value="' + esc(m) + '">' + esc(m === 'auto' ? t('editor.arch.bar.connectorAuto') : matName(m)) + '</option>').join('');
    if (sel._html !== html) { sel.innerHTML = html; sel._html = html; }
    sel.value = opts.indexOf(OPT.connMat) >= 0 ? OPT.connMat : 'auto';
    sel.disabled = !OPT.connect;
    bar.querySelector('.ab-cmat').classList.toggle('dim', !OPT.connect);
    const help = bar.querySelector('[data-ab=help]');
    const touch = isTouch();
    help.textContent = t(!av || av.phase === 'idle' ? (touch ? 'editor.arch.help.startTouch' : 'editor.arch.help.start')
      : av.phase === 'rise' ? (touch ? 'editor.arch.help.riseTouch' : 'editor.arch.help.rise') : 'editor.arch.help.release');
  }

  // hints: levels whose hint mentions arches point at the tool
  // (editor.arch.hintMatch: a regex source per language, since level.hint reads in the current language)
  function archHint(level) { const h = level && level.hint; return typeof h === 'string' && new RegExp(t('editor.arch.hintMatch'), 'i').test(h); }

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
          const hint = I() ? I().levelText(lv, 'hint') : lv.hint;
          const plain = !text || text === lv.hint || text === hint || (tt && (text === tt(lv.hint) || text === tt(hint)));
          const tip = t(isTouch() ? 'editor.arch.hintTouch' : 'editor.arch.hint');
          if (plain && (text || '').indexOf(tip) < 0) text = (text || hint) + ' ' + tip;
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
