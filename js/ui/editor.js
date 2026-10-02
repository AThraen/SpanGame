// SPAN — BG.Editor (SPEC §4.10): drag-and-drop bridge editing.
//
// Architecture: the editing logic ("core") works purely in world coordinates and never touches the DOM:
//   ed.pointerDown(x, y, o) / ed.pointerMove(x, y, o) / ed.pointerUp(x, y, o) / ed.rightClick(x, y, o)
//   ed.pointerCancel() / ed.longPress() / ed.keyDown(key, o)
// where o = {button, shift, ctrl, alt, meta, pointerType:'mouse'|'touch'|'pen'}.
// attach(canvas) adds a thin DOM layer: pointer events (mouse + touch + pen), wheel zoom, pan (middle/right drag,
// Space-drag, left-drag on empty space, two-finger pan/pinch), keyboard shortcuts. Node-testable with fakes.
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});

  const FALLBACK_MATS = {
    road: { id: 'road', name: 'Road', maxLength: 6, costPerMeter: 100, isRoad: true },
    reinforced_road: { id: 'reinforced_road', name: 'Reinforced Road', maxLength: 6, costPerMeter: 180, isRoad: true },
    wood: { id: 'wood', name: 'Wood', maxLength: 6, costPerMeter: 50 },
    steel: { id: 'steel', name: 'Steel', maxLength: 10, costPerMeter: 120 },
    rope: { id: 'rope', name: 'Rope', maxLength: 20, costPerMeter: 20, tensionOnly: true },
    cable: { id: 'cable', name: 'Steel Cable', maxLength: 40, costPerMeter: 60, tensionOnly: true },
  };
  const ORDER = ['road', 'reinforced_road', 'wood', 'steel', 'rope', 'cable'];
  const TOOLS = ['build', 'erase', 'pier', 'select'];

  const MAGNET = 0.6;        // m: joint magnet radius (spec)
  const MIN_LEN = 0.25;      // m: shortest beam the editor will create
  const AXIS_EPS = 0.02;     // m: a joint this close to the mirror axis is "on axis" (shared)
  const POS_EPS = 0.02;      // m: two joints this close are the same place
  const DRAG_PX = 5;         // px before a press becomes a drag (touch ×2)
  const LONG_PRESS_MS = 380; // hold still on a joint, then drag → move the joint
  const HISTORY = 200;
  const MIN_ZOOM = 2, MAX_ZOOM = 160;

  // ------------------------------------------------------------------ helpers
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hyp(dx, dy) { return Math.sqrt(dx * dx + dy * dy); }
  function matDef(id) { const M = BG.Materials; return (M && M[id]) || FALLBACK_MATS[id] || null; }
  function maxLenOf(id) { const d = matDef(id); return d && d.maxLength > 0 ? d.maxLength : 6; }
  function costOf(id) { const d = matDef(id); return d ? num(d.costPerMeter, 0) : 0; }
  function key(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
  function r4(v) { return Math.round(v * 10000) / 10000; }

  function emptyDesign() {
    if (BG.Model && BG.Model.emptyDesign) { try { return BG.Model.emptyDesign(); } catch (e) { /* fall through */ } }
    return { nodes: [], beams: [], piers: [] };
  }
  function cloneDesign(d) {
    if (BG.Model && BG.Model.clone) { try { return BG.Model.clone(d); } catch (e) { /* fall through */ } }
    d = d || {};
    return {
      nodes: (d.nodes || []).map((n) => ({ id: n.id, x: n.x, y: n.y })),
      beams: (d.beams || []).map((b) => ({ a: b.a, b: b.b, m: b.m })),
      piers: (d.piers || []).map((p) => ({ x: p.x, topY: p.topY })),
    };
  }
  function normalize(d) {
    if (!d || typeof d !== 'object') d = emptyDesign();
    if (!Array.isArray(d.nodes)) d.nodes = [];
    if (!Array.isArray(d.beams)) d.beams = [];
    if (!Array.isArray(d.piers)) d.piers = [];
    return d;
  }
  function sameDesign(a, b) {
    return JSON.stringify([a.nodes, a.beams, a.piers]) === JSON.stringify([b.nodes, b.beams, b.piers]);
  }
  // distance from point to segment
  function distSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = clamp(t, 0, 1);
    return hyp(px - (x1 + t * dx), py - (y1 + t * dy));
  }
  function segsCross(ax, ay, bx, by, cx, cy, dx, dy) {
    const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
    const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  }
  function inRectOpen(x, y, r) {
    const e = 1e-4;
    return x > Math.min(r.x0, r.x1) + e && x < Math.max(r.x0, r.x1) - e && y > Math.min(r.y0, r.y1) + e && y < Math.max(r.y0, r.y1) - e;
  }
  function segHitsRect(x1, y1, x2, y2, r) {
    if (BG.Model && BG.Model.segmentHitsRect) return BG.Model.segmentHitsRect(x1, y1, x2, y2, r);
    const e = 1e-4;
    const rx0 = Math.min(r.x0, r.x1) + e, rx1 = Math.max(r.x0, r.x1) - e, ry0 = Math.min(r.y0, r.y1) + e, ry1 = Math.max(r.y0, r.y1) - e;
    if (rx0 >= rx1 || ry0 >= ry1) return false;
    let t0 = 0, t1 = 1;
    const dx = x2 - x1, dy = y2 - y1, p = [-dx, dx, -dy, dy], q = [x1 - rx0, rx1 - x1, y1 - ry0, ry1 - y1];
    for (let i = 0; i < 4; i++) {
      if (Math.abs(p[i]) < 1e-12) { if (q[i] < 0) return false; continue; }
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return t1 - t0 > 1e-9;
  }
  function inTerrain(level, x, y, tol) {
    if (BG.Model && BG.Model.inTerrain) return BG.Model.inTerrain(level, x, y, tol);
    const t = (level && level.terrain) || {}, e = tol == null ? 0.05 : tol;
    if (y < num(t.floorY, -1e9) - e) return true;
    if (typeof t.leftEdge === 'number' && x < t.leftEdge - e && y < num(t.leftY, 0) - e) return true;
    if (typeof t.rightEdge === 'number' && x > t.rightEdge + e && y < num(t.rightY, 0) - e) return true;
    return false;
  }

  // ======================================================================== Editor
  class Editor {
    constructor(game) {
      this.game = game || {};
      this.level = null;                // optional explicit level (otherwise game.level)
      this._design = normalize(this.game.design || emptyDesign());
      this._tool = 'build';
      this._material = null;
      this._mirror = false;
      this.undoStack = [];
      this.redoStack = [];
      this.chainFrom = null;            // auto-chain: next beam starts here
      this.validation = { ok: true, errors: [] };
      this._sel = { nodes: new Set(), beams: new Set() }; // beams as unordered pair keys
      this._act = null;                 // active pointer gesture
      this._pending = null;             // snapshot taken at the start of a change
      this._depth = 0;
      this._cursor = null;
      this._lvlRef = undefined;
      this._lastSnapId = null;
      this._ownCam = { x: 0, y: 0, zoom: 30 };
      this._dom = null;
      this.state = {
        hoverNode: null, hoverBeam: null, hoverPier: null,
        dragFrom: null, chainFrom: null,
        ghost: null, ghosts: [],
        selection: { nodes: [], beams: [] }, selectBox: null,
        cursor: null, snap: null,
        tool: 'build', material: null, mirror: false, mirrorAxis: null, grid: 1,
        moving: false, moveNodes: [], moveArmed: null, mergeTarget: null, clamped: false,
        pierGhost: null, eraseTrail: [],
        invalidBeams: [], invalidNodes: [], errors: [], cost: 0,
      };
      this._syncLevel();
      this._changed(true);
    }

    // ---------------------------------------------------------------- properties
    get design() { return this._design; }
    set design(d) {
      this._syncLevel();
      this._design = normalize(d || emptyDesign());
      this._cancelAct();
      this.chainFrom = null;
      this._sel.nodes.clear(); this._sel.beams.clear();
      this._changed(true);
    }
    /** Load a design and reset undo history (call on level open). */
    load(design, level) {
      if (level) this.level = level;
      this._lvlRef = undefined;
      this.design = design;
      this.undoStack.length = 0; this.redoStack.length = 0;
    }
    get tool() { return this._tool; }
    set tool(t) { this.setTool(t); }
    get material() { return this._mat(); }
    set material(m) { this.setMaterial(m); }
    get mirror() { return this._mirror; }
    set mirror(v) { v = !!v; if (v !== this._mirror) { this._mirror = v; this._refresh(); this._uiChanged(); } }
    get cost() { return this.state.cost; }

    setTool(t) {
      if (TOOLS.indexOf(t) < 0) return false;
      if (t === 'pier' && !this._hasPierZones()) { this._toast('No pier zones on this level.'); this._sfx('error'); return false; }
      if (t !== this._tool) {
        this._cancelAct();
        this.chainFrom = null;
        if (t !== 'select') { this._sel.nodes.clear(); this._sel.beams.clear(); }
        this._tool = t;
        this._refresh();
        this._uiChanged();
      }
      return true;
    }
    setMaterial(m) {
      if (!matDef(m)) return false;
      if (!this._allowed(m)) { this._sfx('error'); this._toast((matDef(m).name || m) + ' is not available on this level.'); return false; }
      this._material = m;
      if (this._tool === 'erase' || this._tool === 'pier') this.setTool('build');
      this._refresh();
      this._uiChanged();
      return true;
    }
    toggleMirror() { this.mirror = !this._mirror; this._sfx('toggle', { on: this._mirror }); return this._mirror; }
    canUndo() { return this.undoStack.length > 0; }
    canRedo() { return this.redoStack.length > 0; }

    // ---------------------------------------------------------------- level / game access
    _level() { return this.level || (this.game && this.game.level) || null; }
    _syncLevel() {
      const lv = this._level();
      if (lv === this._lvlRef) return;
      this._lvlRef = lv;
      this.undoStack.length = 0; this.redoStack.length = 0;
      this.chainFrom = null;
      if (this._sel) { this._sel.nodes.clear(); this._sel.beams.clear(); }
      if (this._tool === 'pier' && !this._hasPierZones()) this._tool = 'build';
      this._cache = null;
    }
    _allowedList() {
      const lv = this._level();
      if (lv && Array.isArray(lv.materials) && lv.materials.length) return lv.materials.filter((m) => matDef(m));
      const order = (BG.MaterialOrder && BG.MaterialOrder.length) ? BG.MaterialOrder : ORDER;
      return order.filter((m) => matDef(m));
    }
    _allowed(m) { return this._allowedList().indexOf(m) >= 0; }
    _mat() {
      if (this._material && this._allowed(this._material)) return this._material;
      const list = this._allowedList();
      return list.indexOf('road') >= 0 ? 'road' : (list[0] || 'road');
    }
    _hasPierZones() {
      const lv = this._level();
      return !!(lv && Array.isArray(lv.pierZones) && lv.pierZones.length && num(lv.maxPiers, 1) > 0);
    }
    _editable() {
      const g = this.game || {};
      const s = g.state != null ? g.state : g.mode;
      return s == null || s === 'edit';
    }
    _axis() {
      const lv = this._level();
      const t = (lv && lv.terrain) || {};
      if (typeof t.leftEdge === 'number' && typeof t.rightEdge === 'number') return (t.leftEdge + t.rightEdge) / 2;
      const ba = lv && lv.buildArea;
      return ba ? (ba.x0 + ba.x1) / 2 : 0;
    }
    _renderer() { return (this.game && this.game.renderer) || null; }
    _zoom() {
      const r = this._renderer();
      const z = r && r.camera && r.camera.zoom;
      return z > 0 ? z : this._ownCam.zoom;
    }
    _px(n) { return n / this._zoom(); }
    _sfx(name, opts) {
      const a = (this.game && this.game.audio) || null;
      try { if (a && typeof a.play === 'function') a.play(name, opts || {}); } catch (e) { /* audio never breaks editing */ }
    }
    _toast(msg) {
      const g = this.game || {};
      try {
        if (g.hud && typeof g.hud.toast === 'function') g.hud.toast(msg, 'info');
        else if (typeof g.toast === 'function') g.toast(msg);
      } catch (e) { /* ignore */ }
    }
    _uiChanged() {
      const g = this.game || {};
      try { if (typeof g.onEditorChanged === 'function') g.onEditorChanged(this); } catch (e) { /* ignore */ }
    }
    _pan(x) {
      // stereo pan for audio from world x
      const r = this._renderer();
      try {
        if (r && r.worldToScreen && this._dom && this._dom.canvas) {
          const s = r.worldToScreen(x, 0);
          const w = this._dom.canvas.clientWidth || this._dom.canvas.width || 1;
          return clamp(((s.x != null ? s.x : s[0]) / w) * 2 - 1, -1, 1) * 0.6;
        }
      } catch (e) { /* ignore */ }
      return 0;
    }

    // ---------------------------------------------------------------- node access
    _nodes() {
      if (this._cache) return this._cache;
      const lv = this._level() || {};
      const out = [];
      (lv.anchors || []).forEach((a, i) => out.push({ id: 'a' + i, x: a.x, y: a.y, fixed: true, kind: 'anchor' }));
      this._design.piers.forEach((p, i) => out.push({ id: 'p' + i, x: p.x, y: p.topY, fixed: true, kind: 'pier' }));
      this._design.nodes.forEach((n) => out.push({ id: n.id, x: n.x, y: n.y, fixed: false, kind: 'node' }));
      const map = {};
      out.forEach((n) => { if (!map[n.id]) map[n.id] = n; });
      this._cache = { list: out, map };
      return this._cache;
    }
    _node(id) { return this._nodes().map[id] || null; }
    _userNode(id) { for (const n of this._design.nodes) if (n.id === id) return n; return null; }
    _isUser(id) { return typeof id === 'string' && id[0] === 'n' && !!this._userNode(id); }
    _invalidate() { this._cache = null; }
    _pickNode(x, y, r, filter) {
      let best = null, bd = r;
      for (const n of this._nodes().list) {
        if (filter && !filter(n)) continue;
        const d = hyp(n.x - x, n.y - y);
        if (d <= bd) { bd = d; best = n; }
      }
      return best;
    }
    _nodeAt(x, y) { return this._pickNode(x, y, POS_EPS); }
    _pickBeam(x, y, r) {
      let best = null, bd = r;
      const beams = this._design.beams;
      for (let i = 0; i < beams.length; i++) {
        const A = this._node(beams[i].a), B = this._node(beams[i].b);
        if (!A || !B) continue;
        const d = distSeg(x, y, A.x, A.y, B.x, B.y);
        if (d <= bd) { bd = d; best = i; }
      }
      return best;
    }
    _pickPier(x, y) {
      const lv = this._level() || {};
      const fy = num((lv.terrain || {}).floorY, -1e9);
      const rx = Math.max(0.7, this._px(10)), ry = Math.max(0.6, this._px(12));
      let best = null, bd = Infinity;
      this._design.piers.forEach((p, i) => {
        const dx = Math.abs(p.x - x);
        if (dx <= rx && y <= p.topY + ry && y >= fy - 1 && dx < bd) { bd = dx; best = i; }
      });
      return best;
    }
    _pickR(o) { return Math.max(MAGNET, this._px(o && o.pointerType === 'touch' ? 26 : 13)); }
    _magR(o) { return Math.max(MAGNET, this._px(o && o.pointerType === 'touch' ? 22 : 11)); }
    _beamIndex(a, b) {
      const k = key(a, b), beams = this._design.beams;
      for (let i = 0; i < beams.length; i++) if (key(beams[i].a, beams[i].b) === k) return i;
      return -1;
    }
    _nextId() {
      if (BG.Model && BG.Model.nextNodeId) { try { return BG.Model.nextNodeId(this._design); } catch (e) { /* fall through */ } }
      let max = 0;
      for (const n of this._design.nodes) { const m = /^n(\d+)$/.exec(n.id); if (m) max = Math.max(max, +m[1]); }
      return 'n' + (max + 1);
    }

    // ---------------------------------------------------------------- geometry rules
    _pointProblem(x, y) {
      const lv = this._level() || {};
      const ba = lv.buildArea;
      if (ba && (x < ba.x0 - 1e-6 || x > ba.x1 + 1e-6 || y < ba.y0 - 1e-6 || y > ba.y1 + 1e-6)) return 'outside_build_area';
      for (const r of lv.noBuild || []) if (inRectOpen(x, y, r)) return 'in_nobuild';
      if (inTerrain(lv, x, y, 0.05)) return 'in_terrain';
      return null;
    }
    _segProblem(ax, ay, bx, by) {
      const lv = this._level() || {};
      for (const r of lv.noBuild || []) if (segHitsRect(ax, ay, bx, by, r)) return 'in_nobuild';
      for (let k = 1; k < 8; k++) {
        const f = k / 8;
        if (inTerrain(lv, ax + (bx - ax) * f, ay + (by - ay) * f, 0.1)) return 'in_terrain';
      }
      return null;
    }
    _grid(o) { return o && o.shift ? 0.25 : 1; }
    // best grid point near P that stays within maxL of A
    _snapWithin(ax, ay, px, py, g, maxL) {
      const gx = Math.round(px / g) * g, gy = Math.round(py / g) * g;
      if (hyp(gx - ax, gy - ay) <= maxL + 1e-9) return { x: r4(gx), y: r4(gy) };
      let best = null, bd = Infinity;
      const bx = Math.floor(px / g), by = Math.floor(py / g);
      for (let i = -1; i <= 2; i++) for (let j = -1; j <= 2; j++) {
        const cx = (bx + i) * g, cy = (by + j) * g;
        if (hyp(cx - ax, cy - ay) > maxL + 1e-9) continue;
        const d = hyp(cx - px, cy - py);
        if (d < bd) { bd = d; best = { x: r4(cx), y: r4(cy) }; }
      }
      return best && bd <= g * 1.5 ? best : { x: px, y: py };
    }

    // ghost beam from joint `fromId` toward raw cursor (x,y): magnet, grid, max-length clamp
    _ghost(fromId, x, y, o) {
      const A = this._node(fromId);
      if (!A) return null;
      const m = this._mat();
      const maxL = maxLenOf(m);
      let ex, ey, endId = null, clamped = false;
      const mag = this._pickNode(x, y, this._magR(o), (n) => n.id !== fromId && hyp(n.x - A.x, n.y - A.y) <= maxL + 1e-6);
      if (mag) { ex = mag.x; ey = mag.y; endId = mag.id; }
      else {
        let px = x, py = y;
        const d = hyp(x - A.x, y - A.y);
        if (d > maxL) { px = A.x + ((x - A.x) * maxL) / d; py = A.y + ((y - A.y) * maxL) / d; clamped = true; }
        const s = this._snapWithin(A.x, A.y, px, py, this._grid(o), maxL);
        ex = s.x; ey = s.y;
        if (this._mirror) {
          const ax = this._axis();
          if (Math.abs(ex - ax) < this._magR(o) * 0.6 && hyp(ax - A.x, ey - A.y) <= maxL + 1e-9) ex = ax;
        }
        const at = this._nodeAt(ex, ey);
        if (at && at.id !== fromId) endId = at.id;
      }
      const len = hyp(ex - A.x, ey - A.y);
      const g = { x1: A.x, y1: A.y, x2: ex, y2: ey, valid: true, len, cost: Math.round(len * costOf(m)), m,
        maxLength: maxL, clamped, snapNode: endId, from: fromId, reason: null, mirror: false };
      g.reason = this._beamProblem(fromId, endId, A.x, A.y, ex, ey, m);
      g.valid = !g.reason;
      return g;
    }
    _beamProblem(aId, bId, ax, ay, bx, by, m) {
      const len = hyp(bx - ax, by - ay);
      if (aId === bId || len < MIN_LEN) return 'too_short';
      if (!this._allowed(m)) return 'material_not_allowed';
      if (len > maxLenOf(m) + 1e-6) return 'too_long';
      if (!bId) { const p = this._pointProblem(bx, by); if (p) return p; }
      const s = this._segProblem(ax, ay, bx, by);
      if (s) return s;
      if (aId && bId && this._beamIndex(aId, bId) >= 0) return 'duplicate_beam';
      return null;
    }
    _mirrorGhost(g) {
      if (!g || !this._mirror) return null;
      const ax = this._axis();
      const mx1 = 2 * ax - g.x1, mx2 = 2 * ax - g.x2;
      // identical to the original (symmetric beam) → no second ghost
      if ((Math.abs(mx1 - g.x2) < POS_EPS && Math.abs(g.y1 - g.y2) < POS_EPS) || (Math.abs(mx1 - g.x1) < POS_EPS && Math.abs(mx2 - g.x2) < POS_EPS)) return null;
      const a = this._partner(g.from, false), b = g.snapNode ? this._partner(g.snapNode, false) : (this._nodeAt(mx2, g.y2) || {}).id || null;
      if (!a && g.from[0] !== 'n') return null; // anchor with no mirrored anchor: no mirror beam
      const mg = Object.assign({}, g, { x1: mx1, x2: mx2, mirror: true, from: a, snapNode: b });
      mg.reason = this._beamProblem(a || '?a', b, mx1, g.y1, mx2, g.y2, g.m);
      if (!a) { const p = this._pointProblem(mx1, g.y1); if (p) mg.reason = mg.reason || p; }
      mg.valid = !mg.reason;
      return mg;
    }

    // mirror partner of joint `id` (same id when on the axis). create: make a user joint if missing.
    _partner(id, create) {
      const n = this._node(id);
      if (!n) return null;
      const ax = this._axis();
      if (Math.abs(n.x - ax) < AXIS_EPS) return id;
      const mx = 2 * ax - n.x;
      const at = this._nodeAt(mx, n.y);
      if (at) return at.id;
      if (!create || n.kind !== 'node') return null;
      if (this._pointProblem(mx, n.y)) return null;
      return this._addNode(mx, n.y);
    }

    // ---------------------------------------------------------------- mutations (low level)
    _addNode(x, y) {
      const id = this._nextId();
      this._design.nodes.push({ id, x: r4(x), y: r4(y) });
      this._invalidate();
      return id;
    }
    _addBeam(a, b, m) {
      if (!a || !b || a === b || this._beamIndex(a, b) >= 0) return false;
      this._design.beams.push({ a, b, m });
      return true;
    }
    _degree() {
      const deg = {};
      for (const b of this._design.beams) { deg[b.a] = (deg[b.a] || 0) + 1; deg[b.b] = (deg[b.b] || 0) + 1; }
      return deg;
    }
    _pruneOrphans(keep) {
      const deg = this._degree();
      const before = this._design.nodes.length;
      this._design.nodes = this._design.nodes.filter((n) => deg[n.id] || (keep && keep.indexOf(n.id) >= 0));
      if (this._design.nodes.length !== before) {
        this._invalidate();
        const alive = new Set(this._design.nodes.map((n) => n.id));
        for (const id of Array.from(this._sel.nodes)) if (!alive.has(id)) this._sel.nodes.delete(id);
        if (this.chainFrom && this.chainFrom[0] === 'n' && !alive.has(this.chainFrom)) this.chainFrom = null;
      }
    }
    _removeBeamKeys(keys) {
      if (!keys.size) return 0;
      const before = this._design.beams.length;
      this._design.beams = this._design.beams.filter((b) => !keys.has(key(b.a, b.b)));
      for (const k of keys) this._sel.beams.delete(k);
      return before - this._design.beams.length;
    }
    _mirrorKey(a, b) {
      const pa = this._partner(a, false), pb = this._partner(b, false);
      return pa && pb ? key(pa, pb) : null;
    }
    _removeNodes(ids) {
      const set = new Set(ids.filter((id) => this._isUser(id)));
      if (!set.size) return 0;
      this._design.beams = this._design.beams.filter((b) => !set.has(b.a) && !set.has(b.b));
      this._design.nodes = this._design.nodes.filter((n) => !set.has(n.id));
      for (const id of set) this._sel.nodes.delete(id);
      if (set.has(this.chainFrom)) this.chainFrom = null;
      this._invalidate();
      return set.size;
    }
    _removePier(k) {
      const piers = this._design.piers;
      if (k < 0 || k >= piers.length) return;
      const dead = 'p' + k;
      this._design.beams = this._design.beams.filter((b) => b.a !== dead && b.b !== dead);
      const ren = (id) => { const m = /^p(\d+)$/.exec(id); return m && +m[1] > k ? 'p' + (+m[1] - 1) : id; };
      for (const b of this._design.beams) { b.a = ren(b.a); b.b = ren(b.b); }
      if (this.chainFrom === dead) this.chainFrom = null; else if (this.chainFrom) this.chainFrom = ren(this.chainFrom);
      piers.splice(k, 1);
      this._sel.beams.clear();
      this._invalidate();
    }
    // replace joint `from` by joint `to` everywhere (merge); drops self/duplicate beams
    _mergeNode(from, to) {
      if (!from || !to || from === to || !this._isUser(from)) return false;
      const seen = new Set();
      const out = [];
      for (const b of this._design.beams) {
        const a = b.a === from ? to : b.a, c = b.b === from ? to : b.b;
        if (a === c) continue;
        const k = key(a, c);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ a, b: c, m: b.m });
      }
      this._design.beams = out;
      this._design.nodes = this._design.nodes.filter((n) => n.id !== from);
      if (this.chainFrom === from) this.chainFrom = to;
      this._sel.nodes.delete(from);
      this._invalidate();
      return true;
    }

    // ---------------------------------------------------------------- history
    _snapshot() { return cloneDesign(this._design); }
    _begin() { if (this._depth++ === 0) this._pending = this._snapshot(); }
    _commit() {
      if (this._depth <= 0) return false;
      if (--this._depth > 0) return false;
      const before = this._pending;
      this._pending = null;
      if (!before || sameDesign(before, this._design)) return false;
      this.undoStack.push(before);
      if (this.undoStack.length > HISTORY) this.undoStack.shift();
      this.redoStack.length = 0;
      this._changed();
      return true;
    }
    _abort() {
      if (this._pending) this._restore(this._pending);
      this._pending = null;
      this._depth = 0;
      this._changed();
    }
    _restore(snap) {
      const c = cloneDesign(snap);
      // keep object identity so anyone holding ed.design stays in sync
      this._design.nodes = c.nodes; this._design.beams = c.beams; this._design.piers = c.piers;
      this._invalidate();
    }
    undo() {
      this._syncLevel();
      this._cancelAct();
      if (!this.undoStack.length) { this._sfx('error'); return false; }
      this.redoStack.push(this._snapshot());
      this._restore(this.undoStack.pop());
      this._afterHistoryJump();
      return true;
    }
    redo() {
      this._syncLevel();
      this._cancelAct();
      if (!this.redoStack.length) { this._sfx('error'); return false; }
      this.undoStack.push(this._snapshot());
      this._restore(this.redoStack.pop());
      this._afterHistoryJump();
      return true;
    }
    _afterHistoryJump() {
      this.chainFrom = null;
      this._sel.nodes.clear(); this._sel.beams.clear();
      this._changed();
      this._sfx('click');
    }

    // after every design change: validation, cost, notify game
    _changed(silent) {
      this._invalidate();
      const lv = this._level();
      const st = this.state;
      let errors = [];
      if (lv && BG.Model && typeof BG.Model.validate === 'function') {
        try { const r = BG.Model.validate(lv, this._design); errors = (r && r.errors) || []; } catch (e) { errors = []; }
      } else if (lv && BG.Templates && typeof BG.Templates.checkGeometry === 'function') {
        try { errors = BG.Templates.checkGeometry(lv, this._design) || []; } catch (e) { errors = []; }
      }
      this.validation = { ok: errors.length === 0, errors };
      st.errors = errors;
      st.invalidBeams = errors.filter((e) => typeof e.beamIndex === 'number').map((e) => e.beamIndex);
      st.invalidNodes = errors.filter((e) => typeof e.nodeId === 'string').map((e) => e.nodeId);
      let cost = 0;
      if (lv && BG.Model && typeof BG.Model.cost === 'function') {
        try { cost = BG.Model.cost(lv, this._design).total; } catch (e) { cost = 0; }
      } else {
        for (const b of this._design.beams) { const A = this._node(b.a), B = this._node(b.b); if (A && B) cost += hyp(B.x - A.x, B.y - A.y) * costOf(b.m); }
        cost = Math.round(cost);
      }
      st.cost = cost;
      this._refresh();
      if (!silent) {
        const g = this.game || {};
        try { if (typeof g.onDesignChanged === 'function') g.onDesignChanged(this._design); } catch (e) { if (root.console) console.error(e); }
      }
    }

    // ---------------------------------------------------------------- high-level operations
    /** Place a beam from joint `fromId` following ghost g (with mirror). Returns end joint id or null. */
    _placeBeam(fromId, g) {
      if (!g || !g.valid) { this._sfx('error'); return null; }
      this._begin();
      let end = g.snapNode || this._addNode(g.x2, g.y2);
      this._addBeam(fromId, end, g.m);
      if (this._mirror) {
        const mg = this._mirrorGhost(g);
        if (mg && mg.valid) {
          const a = this._partner(fromId, true);
          const b = this._partner(end, true);
          if (a && b && a !== b && this._beamIndex(a, b) < 0) this._addBeam(a, b, g.m);
          this._pruneOrphans([fromId, end]);
        }
      }
      this._commit();
      this._sfx('place', { material: g.m, pan: this._pan(g.x2) });
      return end;
    }

    /** Build a beam between two world points/joints programmatically (used by tests & tools). */
    buildBeam(fromId, x, y, o) {
      const g = this._ghost(fromId, x, y, o);
      return this._placeBeam(fromId, g);
    }

    _eraseBeamAt(i) {
      const b = this._design.beams[i];
      if (!b) return false;
      const keys = new Set([key(b.a, b.b)]);
      if (this._mirror) { const mk = this._mirrorKey(b.a, b.b); if (mk) keys.add(mk); }
      this._removeBeamKeys(keys);
      this._pruneOrphans(this.chainFrom ? [this.chainFrom] : null);
      this._invalidate();
      return true;
    }
    _eraseNodeId(id) {
      if (!this._isUser(id)) return false;
      const ids = [id];
      if (this._mirror) { const p = this._partner(id, false); if (p && p !== id) ids.push(p); }
      this._removeNodes(ids);
      this._pruneOrphans();
      return true;
    }
    _erasePierAt(k) {
      const p = this._design.piers[k];
      if (!p) return false;
      const ks = [k];
      if (this._mirror) {
        const mx = 2 * this._axis() - p.x;
        this._design.piers.forEach((q, j) => { if (j !== k && Math.abs(q.x - mx) < POS_EPS * 5 && Math.abs(q.topY - p.topY) < POS_EPS * 5) ks.push(j); });
      }
      ks.sort((a, b) => b - a).forEach((j) => this._removePier(j));
      this._pruneOrphans();
      return true;
    }
    /** Erase whatever is under (x,y): user joint > beam > pier. */
    _eraseAt(x, y, o) {
      const r = this._pickR(o);
      const n = this._pickNode(x, y, r * 0.8, (q) => q.kind === 'node');
      if (n) return this._eraseNodeId(n.id);
      const bi = this._pickBeam(x, y, Math.max(0.3, this._px(o && o.pointerType === 'touch' ? 14 : 8)));
      if (bi != null) return this._eraseBeamAt(bi);
      const pi = this._pickPier(x, y);
      if (pi != null) return this._erasePierAt(pi);
      return false;
    }
    _eraseSweep(x0, y0, x1, y1, o) {
      const keys = new Set();
      const r = Math.max(0.25, this._px(o && o.pointerType === 'touch' ? 12 : 6));
      for (const b of this._design.beams) {
        const A = this._node(b.a), B = this._node(b.b);
        if (!A || !B) continue;
        if (segsCross(x0, y0, x1, y1, A.x, A.y, B.x, B.y) || distSeg(x1, y1, A.x, A.y, B.x, B.y) <= r) {
          keys.add(key(b.a, b.b));
          if (this._mirror) { const mk = this._mirrorKey(b.a, b.b); if (mk) keys.add(mk); }
        }
      }
      const n = this._removeBeamKeys(keys);
      if (n) { this._pruneOrphans(); this._invalidate(); }
      return n;
    }

    deleteSelection() {
      this._syncLevel();
      const nodes = Array.from(this._sel.nodes), beams = Array.from(this._sel.beams);
      if (!nodes.length && !beams.length) return false;
      this._begin();
      const keys = new Set(beams);
      if (this._mirror) {
        for (const k of beams) { const [a, b] = k.split('|'); const mk = this._mirrorKey(a, b); if (mk) keys.add(mk); }
        for (const id of nodes.slice()) { const p = this._partner(id, false); if (p && p !== id) nodes.push(p); }
      }
      this._removeBeamKeys(keys);
      this._removeNodes(nodes);
      this._pruneOrphans();
      this._sel.nodes.clear(); this._sel.beams.clear();
      const changed = this._commit();
      if (changed) this._sfx('erase');
      this._refresh();
      return changed;
    }
    selectAll() {
      this._design.nodes.forEach((n) => this._sel.nodes.add(n.id));
      this._design.beams.forEach((b) => this._sel.beams.add(key(b.a, b.b)));
      if (this._tool !== 'select') { this._tool = 'select'; this._uiChanged(); }
      this._refresh();
    }
    clearSelection() { this._sel.nodes.clear(); this._sel.beams.clear(); this._refresh(); }
    select(ids, beamIdx) {
      this._sel.nodes.clear(); this._sel.beams.clear();
      (ids || []).forEach((id) => { if (this._isUser(id)) this._sel.nodes.add(id); });
      (beamIdx || []).forEach((i) => { const b = this._design.beams[i]; if (b) this._sel.beams.add(key(b.a, b.b)); });
      this._refresh();
    }

    clear() {
      this._syncLevel();
      this._cancelAct();
      const d = this._design;
      if (!d.nodes.length && !d.beams.length && !d.piers.length) return false;
      this._begin();
      d.nodes = []; d.beams = []; d.piers = [];
      this.chainFrom = null;
      this._sel.nodes.clear(); this._sel.beams.clear();
      this._invalidate();
      this._commit();
      this._sfx('erase');
      return true;
    }

    applyTemplate(id, opts) {
      this._syncLevel();
      const lv = this._level();
      const T = BG.Templates;
      if (!lv || !T || typeof T.generate !== 'function') { this._sfx('error'); return false; }
      let frag = null;
      try { frag = T.generate(id, lv, Object.assign({ design: cloneDesign(this._design) }, opts || {})); } catch (e) { frag = null; }
      if (!frag || !Array.isArray(frag.beams) || !frag.beams.length) { this._sfx('error'); this._toast('That template does not fit this crossing.'); return false; }
      this._cancelAct();
      this._begin();
      const c = cloneDesign(normalize(frag));
      this._design.nodes = c.nodes; this._design.beams = c.beams; this._design.piers = c.piers;
      this.chainFrom = null;
      this._sel.nodes.clear(); this._sel.beams.clear();
      this._invalidate();
      this._commit();
      this._sfx('place', { material: 'steel' });
      return true;
    }

    // ---------------------------------------------------------------- moving joints
    _beginMove(ids, gx, gy) {
      const entries = [];
      const seen = new Set();
      const add = (id, sign, lockX) => {
        if (seen.has(id) || !this._isUser(id)) return;
        seen.add(id);
        const n = this._userNode(id);
        entries.push({ id, sx: n.x, sy: n.y, sign, lockX });
      };
      for (const id of ids) {
        let lock = false;
        if (this._mirror) {
          const p = this._partner(id, false);
          if (p === id) lock = true;
          add(id, 1, lock);
          if (p && p !== id && ids.indexOf(p) < 0) add(p, -1, false);
        } else add(id, 1, false);
      }
      if (!entries.length) return false;
      const moved = new Set(entries.map((e) => e.id));
      const beams = [];
      this._design.beams.forEach((b) => {
        if (!moved.has(b.a) && !moved.has(b.b)) return;
        const A = this._node(b.a), B = this._node(b.b);
        // only constrain beams that are legal now (an existing beam always reports itself as a duplicate)
        const p = A && B ? this._beamProblem(b.a, b.b, A.x, A.y, B.x, B.y, b.m) : 'missing';
        beams.push({ b, ok: !p || p === 'duplicate_beam' });
      });
      entries.forEach((e) => { e.ok = !this._pointProblem(e.sx, e.sy); });
      this._begin();
      this._act = { type: 'move', entries, beams, gx, gy, single: ids.length === 1, merge: null, lastT: 1 };
      this.state.moving = true;
      return true;
    }
    _applyMove(dx, dy, t) {
      const a = this._act;
      for (const e of a.entries) {
        const n = this._userNode(e.id);
        n.x = r4(e.sx + (e.lockX ? 0 : e.sign * dx * t));
        n.y = r4(e.sy + dy * t);
      }
      this._invalidate();
    }
    _moveValid() {
      const a = this._act;
      for (const e of a.entries) {
        if (!e.ok) continue;
        const n = this._userNode(e.id);
        if (this._pointProblem(n.x, n.y)) return false;
      }
      for (const it of a.beams) {
        if (!it.ok) continue;
        const A = this._node(it.b.a), B = this._node(it.b.b);
        const len = hyp(B.x - A.x, B.y - A.y);
        if (len > maxLenOf(it.b.m) + 1e-6 || len < MIN_LEN) return false;
        if (this._segProblem(A.x, A.y, B.x, B.y)) return false;
      }
      return true;
    }
    _moveTo(x, y, o) {
      const a = this._act;
      let dx = x - a.gx, dy = y - a.gy;
      const g = this._grid(o);
      a.merge = null;
      if (a.single) {
        const e = a.entries[0];
        let tx = e.sx + dx, ty = e.sy + dy;
        const moving = new Set(a.entries.map((q) => q.id));
        const mag = this._pickNode(tx, ty, this._magR(o), (n) => !moving.has(n.id));
        if (mag) { tx = mag.x; ty = mag.y; a.merge = mag.id; }
        else { tx = Math.round(tx / g) * g; ty = Math.round(ty / g) * g; }
        if (e.lockX) tx = e.sx;
        if (this._mirror && !e.lockX && !mag) {
          const ax = this._axis();
          if (Math.abs(tx - ax) < this._magR(o) * 0.6) tx = ax; // snap onto the axis
        }
        dx = tx - e.sx; dy = ty - e.sy;
      } else {
        dx = Math.round(dx / g) * g; dy = Math.round(dy / g) * g;
      }
      this._applyMove(dx, dy, 1);
      let t = 1;
      if (!this._moveValid()) {
        a.merge = null;
        let lo = 0, hi = 1;
        for (let i = 0; i < 22; i++) {
          const mid = (lo + hi) / 2;
          this._applyMove(dx, dy, mid);
          if (this._moveValid()) lo = mid; else hi = mid;
        }
        t = lo;
        this._applyMove(dx, dy, t);
        // prefer a nearby grid point that is still legal (keeps designs tidy)
        if (a.single && t > 0) {
          const e = a.entries[0], n = this._userNode(e.id);
          const cx = n.x, cy = n.y, txr = e.sx + dx, tyr = e.sy + dy;
          let best = null, bd = Infinity;
          for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
            const gx = (Math.round(cx / g) + i) * g, gy = (Math.round(cy / g) + j) * g;
            const ddx = e.lockX ? 0 : gx - e.sx, ddy = gy - e.sy;
            this._applyMove(ddx, ddy, 1);
            if (this._moveValid()) { const d = hyp(gx - txr, gy - tyr); if (d < bd) { bd = d; best = [ddx, ddy]; } }
          }
          if (best && bd <= hyp(cx - txr, cy - tyr) + g * 0.75) this._applyMove(best[0], best[1], 1);
          else this._applyMove(dx, dy, t);
        }
      }
      a.lastT = t;
      this.state.clamped = t < 1;
      if (t < 1 && !a.clampedOnce) { a.clampedOnce = true; this._sfx('error'); }
      if (t >= 1) a.clampedOnce = false;
      this.state.mergeTarget = a.merge;
      this._changed(true);
    }
    _endMove() {
      const a = this._act;
      if (a.merge && a.single) {
        const e = a.entries[0];
        const target = a.merge;
        let partnerFrom = null, partnerTo = null;
        if (this._mirror && a.entries[1]) {
          partnerFrom = a.entries[1].id;
          const T = this._node(target), ax = this._axis();
          if (T && Math.abs(T.x - ax) < AXIS_EPS) partnerTo = target;
          else if (T) { const q = this._pickNode(2 * ax - T.x, T.y, POS_EPS, (n) => n.id !== partnerFrom); partnerTo = q ? q.id : null; }
        }
        this._mergeNode(e.id, target);
        if (partnerFrom && partnerTo && partnerTo !== partnerFrom) this._mergeNode(partnerFrom, partnerTo);
        this._sfx('snap');
      }
      this._act = null;
      this.state.moving = false;
      this.state.mergeTarget = null;
      this.state.clamped = false;
      if (this._commit()) this._sfx('place', { material: 'wood' });
      this._changed(true);
    }

    // ---------------------------------------------------------------- piers
    _zoneAt(x) {
      const lv = this._level() || {};
      for (const z of lv.pierZones || []) if (x >= Math.min(z.x0, z.x1) - 1e-6 && x <= Math.max(z.x0, z.x1) + 1e-6) return z;
      return null;
    }
    _pierX(x, o) {
      const lv = this._level() || {};
      let best = null, bd = Infinity;
      for (const z of lv.pierZones || []) {
        const x0 = Math.min(z.x0, z.x1), x1 = Math.max(z.x0, z.x1);
        const cx = clamp(x, x0, x1);
        const d = Math.abs(cx - x);
        if (d < bd) { bd = d; best = { z, x0, x1 }; }
      }
      if (!best || bd > Math.max(0.75, this._px(16))) return null;
      const g = this._grid(o);
      let sx = clamp(Math.round(x / g) * g, best.x0, best.x1);
      // magnet onto a user joint so the pier supports it
      const n = this._pickNode(x, this._cursor ? this._cursor.y : 0, Infinity, (q) => q.kind === 'node' && Math.abs(q.x - x) < this._magR(o) && q.x >= best.x0 && q.x <= best.x1);
      if (n && Math.abs(n.x - x) < this._magR(o) * 0.8) sx = n.x;
      return r4(sx);
    }
    _pierTop(x, y, o) {
      const lv = this._level() || {};
      const t = lv.terrain || {};
      const fy = num(t.floorY, -10);
      const top = lv.buildArea ? lv.buildArea.y1 : fy + 200;
      let ty = Math.round(y / this._grid(o)) * this._grid(o);
      const r = this._magR(o);
      // magnet: deck level between the banks, and joints right above/below the pier
      if (typeof t.leftEdge === 'number' && typeof t.rightEdge === 'number' && t.rightEdge > t.leftEdge) {
        const dy = num(t.leftY, 0) + (num(t.rightY, 0) - num(t.leftY, 0)) * (x - t.leftEdge) / (t.rightEdge - t.leftEdge);
        if (Math.abs(y - dy) < r) ty = dy;
      }
      const n = this._pickNode(x, y, r, (q) => q.kind === 'node' && Math.abs(q.x - x) < POS_EPS);
      if (n) ty = n.y;
      return r4(clamp(ty, fy + 1, top));
    }
    _pierNear(x, skip) {
      return this._design.piers.some((p, i) => skip.indexOf(i) < 0 && Math.abs(p.x - x) < 1.5);
    }
    _pierDown(x, y, o) {
      const lv = this._level() || {};
      const hit = this._pickPier(x, y);
      if (hit != null) {
        const p = this._design.piers[hit];
        const idx = [hit];
        if (this._mirror) {
          const mx = 2 * this._axis() - p.x;
          this._design.piers.forEach((q, j) => { if (j !== hit && Math.abs(q.x - mx) < 0.05 && Math.abs(q.topY - p.topY) < 0.05) idx.push(j); });
        }
        this._begin();
        this._act = { type: 'pier', idx, x: p.x, off: p.topY - y };
        return 'handled';
      }
      const px = this._pierX(x, o);
      if (px == null) { this._sfx('error'); this._toast('Piers can only stand in the marked pier zones.'); return 'handled'; }
      const maxP = num(lv.maxPiers, 99);
      if (this._design.piers.length >= maxP) { this._sfx('error'); this._toast('Pier limit reached (' + maxP + ').'); return 'handled'; }
      if (this._pierNear(px, [])) { this._sfx('error'); this._toast('Too close to another pier.'); return 'handled'; }
      const topY = this._pierTop(px, y, o);
      if (lv.noBuild && lv.noBuild.some((r) => segHitsRect(px, num((lv.terrain || {}).floorY, -10), px, topY, r))) {
        this._sfx('error'); this._toast('Piers may not enter the no-build zone.'); return 'handled';
      }
      this._begin();
      this._design.piers.push({ x: px, topY });
      const idx = [this._design.piers.length - 1];
      if (this._mirror) {
        const mx = r4(2 * this._axis() - px);
        if (Math.abs(mx - px) > 1.5 && this._zoneAt(mx) && this._design.piers.length < maxP && !this._pierNear(mx, idx)) {
          this._design.piers.push({ x: mx, topY });
          idx.push(this._design.piers.length - 1);
        }
      }
      this._invalidate();
      this._act = { type: 'pier', idx, x: px, created: true, off: 0 };
      this._sfx('pier');
      this._changed(true);
      return 'handled';
    }
    _pierMove(x, y, o) {
      const a = this._act;
      const lv = this._level() || {};
      const p0 = this._design.piers[a.idx[0]];
      let topY = this._pierTop(p0.x, y + (a.off || 0), o);
      const fy = num((lv.terrain || {}).floorY, -10);
      // refuse heights that enter a no-build zone: clamp below it
      for (const r of lv.noBuild || []) {
        for (const k of a.idx) {
          const p = this._design.piers[k];
          if (segHitsRect(p.x, fy, p.x, topY, r)) topY = Math.min(topY, Math.min(r.y0, r.y1));
        }
      }
      // keep beams attached to the pier top within max length
      const ok = (ty) => {
        for (const k of a.idx) {
          const id = 'p' + k, p = this._design.piers[k];
          for (const b of this._design.beams) {
            if (b.a !== id && b.b !== id) continue;
            const o2 = this._node(b.a === id ? b.b : b.a);
            if (o2 && hyp(o2.x - p.x, o2.y - ty) > maxLenOf(b.m) + 1e-6) return false;
          }
        }
        return true;
      };
      const start = p0.topY;
      if (!ok(topY)) {
        let lo = 0, hi = 1;
        for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (ok(start + (topY - start) * m)) lo = m; else hi = m; }
        topY = r4(start + (topY - start) * lo);
        this.state.clamped = true;
      } else this.state.clamped = false;
      for (const k of a.idx) this._design.piers[k].topY = topY;
      this._invalidate();
      this._changed(true);
    }
    _pierUp() {
      const a = this._act;
      // merge user joints sitting exactly on a pier top into the pier (the pier now supports them)
      for (const k of a.idx) {
        const p = this._design.piers[k];
        if (!p) continue;
        const n = this._pickNode(p.x, p.topY, Math.max(POS_EPS, 0.05), (q) => q.kind === 'node');
        if (n) this._mergeNode(n.id, 'p' + k);
      }
      this._act = null;
      this._commit();
      this._changed(true);
    }

    // ---------------------------------------------------------------- core input (world coordinates)
    pointerDown(x, y, o) {
      o = o || {};
      this._syncLevel();
      this._cursor = { x, y };
      if (!this._editable()) return 'pan';
      if (this._act) this._cancelAct();
      const button = o.button || 0;
      if (button === 2) return 'pan';
      const tool = this._tool;
      this._downAt = { x, y };
      if (tool === 'build') {
        const n = this._pickNode(x, y, this._pickR(o));
        if (n && n.kind === 'node' && (o.ctrl || o.alt || o.meta)) {
          this._beginMove([n.id], x, y);
          this._refresh();
          return 'handled';
        }
        if (n) {
          this._act = { type: 'press', node: n.id, sx: x, sy: y, moved: false, armed: false, user: n.kind === 'node' };
          this._refresh();
          return 'handled';
        }
        if (this.chainFrom) {
          this._act = { type: 'chainpress', sx: x, sy: y, moved: false };
          this._refresh();
          return 'handled';
        }
        return 'pan';
      }
      if (tool === 'erase') {
        this._begin();
        this._act = { type: 'erase', lx: x, ly: y };
        this.state.eraseTrail = [{ x, y }];
        if (this._eraseAt(x, y, o)) { this._sfx('erase', { pan: this._pan(x) }); this._changed(true); }
        this._refresh();
        return 'handled';
      }
      if (tool === 'pier') {
        const r = this._pierDown(x, y, o);
        this._refresh();
        return r;
      }
      if (tool === 'select') {
        const n = this._pickNode(x, y, this._pickR(o), (q) => q.kind === 'node');
        if (n) {
          if (!this._sel.nodes.has(n.id)) {
            if (!o.shift) { this._sel.nodes.clear(); this._sel.beams.clear(); }
            this._sel.nodes.add(n.id);
          } else if (o.shift) { this._sel.nodes.delete(n.id); this._refresh(); return 'handled'; }
          this._act = { type: 'selpress', sx: x, sy: y, moved: false, node: n.id };
          this._refresh();
          return 'handled';
        }
        const bi = this._pickBeam(x, y, Math.max(0.3, this._px(8)));
        if (bi != null) {
          const b = this._design.beams[bi], k = key(b.a, b.b);
          if (!o.shift) { this._sel.nodes.clear(); this._sel.beams.clear(); this._sel.beams.add(k); }
          else if (this._sel.beams.has(k)) this._sel.beams.delete(k); else this._sel.beams.add(k);
          this._refresh();
          return 'handled';
        }
        if (!o.shift) { this._sel.nodes.clear(); this._sel.beams.clear(); }
        this._act = { type: 'box', sx: x, sy: y, x, y };
        this._refresh();
        return 'handled';
      }
      return 'ignored';
    }

    pointerMove(x, y, o) {
      o = o || {};
      this._cursor = { x, y };
      this._mods = o;
      const a = this._act;
      const thr = this._px(DRAG_PX * (o.pointerType === 'touch' ? 2 : 1));
      if (a && (a.type === 'press' || a.type === 'chainpress' || a.type === 'selpress') && !a.moved && hyp(x - a.sx, y - a.sy) > thr) {
        a.moved = true;
        if (a.type === 'press') {
          if (a.armed && a.user) { const n = a.node; this._act = null; this._beginMove([n], a.sx, a.sy); }
          else a.type = 'drag';
        } else if (a.type === 'selpress') {
          const ids = Array.from(this._sel.nodes);
          this._act = null;
          this._beginMove(ids.length ? ids : [a.node], a.sx, a.sy);
        }
      }
      const b = this._act;
      if (b) {
        if (b.type === 'move') this._moveTo(x, y, o);
        else if (b.type === 'erase') {
          if (this._eraseSweep(b.lx, b.ly, x, y, o)) { this._sfx('erase', { pan: this._pan(x) }); this._changed(true); }
          b.lx = x; b.ly = y;
          const tr = this.state.eraseTrail;
          tr.push({ x, y });
          if (tr.length > 24) tr.shift();
        } else if (b.type === 'pier') this._pierMove(x, y, o);
        else if (b.type === 'box') { b.x = x; b.y = y; }
      }
      this._refresh(o);
    }

    pointerUp(x, y, o) {
      o = o || {};
      this._cursor = { x, y };
      const a = this._act;
      if (!a) { this._refresh(o); return; }
      this._act = null;
      if (a.type === 'press') {
        // a click on a joint
        if (this.chainFrom && this.chainFrom !== a.node) {
          const N = this._node(a.node);
          const g = N ? this._ghost(this.chainFrom, N.x, N.y, o) : null;
          if (g && g.snapNode === a.node) {
            const end = this._placeBeam(this.chainFrom, g);
            if (end) this.chainFrom = end;
          } else {
            this.chainFrom = a.node; this._sfx('click');
          }
        } else if (this.chainFrom === a.node) {
          this.chainFrom = null;
        } else {
          this.chainFrom = a.node;
          this._sfx('click');
        }
      } else if (a.type === 'drag') {
        const g = this._ghost(a.node, x, y, o);
        if (g && g.reason === 'too_short') this.chainFrom = a.node; // dropped back on itself: just start a chain
        else {
          const end = this._placeBeam(a.node, g);
          this.chainFrom = end || a.node;
        }
      } else if (a.type === 'chainpress') {
        const g = this._ghost(this.chainFrom, x, y, o);
        if (g && g.reason === 'too_short') { /* tapped the chain joint again: nothing */ }
        else {
          const end = this._placeBeam(this.chainFrom, g);
          if (end) this.chainFrom = end;
        }
      } else if (a.type === 'move') {
        this._act = a;
        this._endMove();
      } else if (a.type === 'erase') {
        this.state.eraseTrail = [];
        this._commit();
      } else if (a.type === 'pier') {
        this._act = a;
        this._pierUp();
      } else if (a.type === 'box') {
        const x0 = Math.min(a.sx, x), x1 = Math.max(a.sx, x), y0 = Math.min(a.sy, y), y1 = Math.max(a.sy, y);
        const inside = (n) => n && n.x >= x0 && n.x <= x1 && n.y >= y0 && n.y <= y1;
        for (const n of this._design.nodes) if (inside(n)) this._sel.nodes.add(n.id);
        for (const b of this._design.beams) if (inside(this._node(b.a)) && inside(this._node(b.b))) this._sel.beams.add(key(b.a, b.b));
      }
      this._refresh(o);
    }

    /** Right-click (no drag): end chain / cancel gesture, otherwise erase what is under the cursor. */
    rightClick(x, y, o) {
      o = o || {};
      if (!this._editable()) return false;
      if (this._act) { this._cancelAct(); this._refresh(); return true; }
      if (this.chainFrom) { this.chainFrom = null; this._refresh(); return true; }
      this._begin();
      const hit = this._eraseAt(x, y, o);
      this._commit();
      if (hit) this._sfx('erase', { pan: this._pan(x) });
      this._refresh();
      return hit;
    }

    /** Abort the current gesture and revert anything it changed (e.g. second finger landed). */
    pointerCancel() {
      const a = this._act;
      this._act = null;
      if (a && (a.type === 'move' || a.type === 'erase' || a.type === 'pier')) this._abort();
      this.state.moving = false;
      this.state.eraseTrail = [];
      this._refresh();
    }
    _cancelAct() { if (this._act) this.pointerCancel(); }

    /** Long press on a joint (DOM timer): the next drag moves the joint instead of drawing a beam. */
    longPress() {
      const a = this._act;
      if (a && a.type === 'press' && !a.moved && a.user) {
        a.armed = true;
        this.state.moveArmed = a.node;
        this._sfx('snap');
        return true;
      }
      return false;
    }

    escape() {
      if (this._act) { this._cancelAct(); return true; }
      if (this.chainFrom) { this.chainFrom = null; this._refresh(); return true; }
      if (this._sel.nodes.size || this._sel.beams.size) { this.clearSelection(); return true; }
      if (this._tool !== 'build') { this.setTool('build'); return true; }
      return false;
    }

    /** Keyboard shortcut handling. Returns true when the key was used. */
    keyDown(k, o) {
      o = o || {};
      if (!this._editable()) return false;
      this._syncLevel();
      const lower = String(k || '').toLowerCase();
      if (o.ctrl || o.meta) {
        if (lower === 'z') { if (o.shift) this.redo(); else this.undo(); return true; }
        if (lower === 'y') { this.redo(); return true; }
        if (lower === 'a') { this.selectAll(); return true; }
        return false;
      }
      if (/^[1-9]$/.test(lower)) {
        const list = this._allowedList();
        const m = list[+lower - 1];
        if (!m) return false;
        this.setMaterial(m);
        this._sfx('click');
        return true;
      }
      switch (lower) {
        case 'e': this.setTool(this._tool === 'erase' ? 'build' : 'erase'); this._sfx('click'); return true;
        case 'p': this.setTool(this._tool === 'pier' ? 'build' : 'pier'); this._sfx('click'); return true;
        case 'b': this.setTool('build'); this._sfx('click'); return true;
        case 's': case 'v': this.setTool(this._tool === 'select' ? 'build' : 'select'); this._sfx('click'); return true;
        case 'm': this.toggleMirror(); return true;
        case 'escape': case 'esc': return this.escape() || true;
        case 'delete': case 'backspace': {
          if (this._sel.nodes.size || this._sel.beams.size) return this.deleteSelection() || true;
          const st = this.state;
          if (st.hoverNode || st.hoverBeam != null || st.hoverPier != null) {
            const c = this._cursor;
            if (c) { this._begin(); const hit = this._eraseAt(c.x, c.y, this._mods); this._commit(); if (hit) this._sfx('erase'); this._refresh(); }
            return true;
          }
          return false;
        }
        default: return false;
      }
    }

    // ---------------------------------------------------------------- renderer state
    _refresh(o) {
      o = o || this._mods || {};
      const st = this.state;
      const a = this._act;
      const c = this._cursor;
      st.tool = this._tool;
      st.material = this._mat();
      st.mirror = this._mirror;
      st.mirrorAxis = this._mirror ? this._axis() : null;
      st.grid = this._grid(o);
      st.chainFrom = this.chainFrom;
      st.cursor = c ? { x: c.x, y: c.y } : null;
      st.snap = c ? { x: Math.round(c.x / st.grid) * st.grid, y: Math.round(c.y / st.grid) * st.grid } : null;
      st.hoverNode = null; st.hoverBeam = null; st.hoverPier = null; st.hoverBeamObj = null;
      st.ghost = null; st.ghosts = []; st.dragFrom = null; st.pierGhost = null; st.selectBox = null;
      if (!a || a.type !== 'press') st.moveArmed = a && a.type === 'move' ? st.moveArmed : null;
      const touch = o.pointerType === 'touch';
      if (c && (!touch || a)) {
        if (this._tool === 'erase') {
          const n = this._pickNode(c.x, c.y, this._pickR(o) * 0.8, (q) => q.kind === 'node');
          if (n) st.hoverNode = n.id;
          else {
            st.hoverBeam = this._pickBeam(c.x, c.y, Math.max(0.3, this._px(touch ? 14 : 8)));
            if (st.hoverBeam == null) st.hoverPier = this._pickPier(c.x, c.y);
          }
        } else if (this._tool === 'pier') {
          st.hoverPier = this._pickPier(c.x, c.y);
        } else {
          const n = this._pickNode(c.x, c.y, this._pickR(o), this._tool === 'select' ? (q) => q.kind === 'node' : null);
          if (n) st.hoverNode = n.id;
          else if (this._tool === 'select') st.hoverBeam = this._pickBeam(c.x, c.y, Math.max(0.3, this._px(8)));
        }
      }
      if (st.hoverBeam != null) st.hoverBeamObj = this._design.beams[st.hoverBeam] || null;
      // ghost beam
      if (this._tool === 'build' && c && this._editable()) {
        let from = null;
        if (a && a.type === 'drag') from = a.node;
        else if (a && a.type === 'press') from = this.chainFrom && this.chainFrom !== a.node ? this.chainFrom : null;
        else if (!a || a.type === 'chainpress') from = this.chainFrom;
        if (from && (!touch || a)) {
          const g = this._ghost(from, c.x, c.y, o);
          if (g && g.len > 0.05) {
            st.ghost = g;
            st.ghosts = [g];
            const mg = this._mirrorGhost(g);
            if (mg) st.ghosts.push(mg);
            if (g.snapNode && g.snapNode !== this._lastSnapId) this._sfx('snap');
            this._lastSnapId = g.snapNode;
          }
          st.dragFrom = from;
        }
        if (a && a.type === 'press' && !from) st.dragFrom = a.node;
      }
      if (this._tool === 'pier' && c && !a && (!touch)) {
        const px = this._pierX(c.x, o);
        if (px != null && st.hoverPier == null) {
          const lv = this._level() || {};
          const full = this._design.piers.length >= num(lv.maxPiers, 99);
          st.pierGhost = { x: px, topY: this._pierTop(px, c.y, o), valid: !full && !this._pierNear(px, []) };
        }
      }
      if (a && a.type === 'box') st.selectBox = { x0: Math.min(a.sx, a.x), y0: Math.min(a.sy, a.y), x1: Math.max(a.sx, a.x), y1: Math.max(a.sy, a.y) };
      st.moving = !!(a && a.type === 'move');
      st.moveNodes = st.moving ? a.entries.map((e) => e.id) : [];
      // selection as ids / beam indices
      const beams = [];
      if (this._sel.beams.size) this._design.beams.forEach((b, i) => { if (this._sel.beams.has(key(b.a, b.b))) beams.push(i); });
      st.selection = { nodes: Array.from(this._sel.nodes), beams };
      if (this._dom) this._dom.updateCursor();
    }

    // ================================================================ DOM layer
    attach(canvas, opts) {
      if (this._dom) this.detach();
      if (!canvas) return this;
      opts = opts || {};
      const ed = this;
      const win = opts.keyTarget || (canvas.ownerDocument && canvas.ownerDocument.defaultView) || (typeof window !== 'undefined' ? window : null);
      const dom = {
        canvas, win, pointers: new Map(), pan: null, right: null, pinch: null, ignoreTouch: false,
        space: false, spaceUsed: false, spaceState: null, timer: null, listeners: [],
        on(target, type, fn, o2) { if (!target || !target.addEventListener) return; target.addEventListener(type, fn, o2); this.listeners.push([target, type, fn, o2]); },
        updateCursor() {
          if (!canvas.style) return;
          let c = 'crosshair';
          if (dom.pan || dom.space) c = dom.pan ? 'grabbing' : 'grab';
          else if (ed.state.moving) c = 'grabbing';
          else if (ed._tool === 'erase') c = (ed.state.hoverBeam != null || ed.state.hoverNode || ed.state.hoverPier != null) ? 'pointer' : 'crosshair';
          else if (ed._tool === 'select') c = ed.state.hoverNode ? 'move' : 'default';
          else if (ed._tool === 'pier') c = ed.state.hoverPier != null ? 'ns-resize' : 'crosshair';
          else if (ed.state.hoverNode) c = 'pointer';
          if (canvas.style.cursor !== c) canvas.style.cursor = c;
        },
      };
      this._dom = dom;
      if (canvas.style) { canvas.style.touchAction = 'none'; canvas.style.userSelect = 'none'; }

      const local = (e) => {
        const r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
        return { sx: e.clientX - r.left, sy: e.clientY - r.top };
      };
      const mods = (e) => ({ shift: !!e.shiftKey, ctrl: !!e.ctrlKey, alt: !!e.altKey, meta: !!e.metaKey, button: e.button || 0, pointerType: e.pointerType || 'mouse' });
      const clearTimer = () => { if (dom.timer) { clearTimeout(dom.timer); dom.timer = null; } };
      const startPan = (sx, sy) => { dom.pan = { sx, sy, anchor: ed._s2w(sx, sy), moved: false }; dom.updateCursor(); };

      dom.on(canvas, 'pointerdown', (e) => {
        const p = local(e);
        dom.pointers.set(e.pointerId, { sx: p.sx, sy: p.sy, type: e.pointerType });
        try { if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        if (e.preventDefault) e.preventDefault();
        if (e.pointerType === 'touch' && dom.pointers.size >= 2) {
          clearTimer();
          ed.pointerCancel();
          dom.pan = null;
          const pts = Array.from(dom.pointers.values()).slice(0, 2);
          const mx = (pts[0].sx + pts[1].sx) / 2, my = (pts[0].sy + pts[1].sy) / 2;
          dom.pinch = { d0: Math.max(1, hyp(pts[0].sx - pts[1].sx, pts[0].sy - pts[1].sy)), z0: ed._cam().zoom, anchor: ed._s2w(mx, my) };
          dom.ignoreTouch = true;
          return;
        }
        if (dom.pointers.size > 1) return;
        const o = mods(e);
        const w = ed._s2w(p.sx, p.sy);
        if (o.button === 1 || (o.button === 0 && dom.space)) { if (dom.space) dom.spaceUsed = true; startPan(p.sx, p.sy); return; }
        if (o.button === 2) { dom.right = { sx: p.sx, sy: p.sy, moved: false }; return; }
        const r = ed.pointerDown(w.x, w.y, o);
        if (r === 'pan') { startPan(p.sx, p.sy); dom.pan.click = true; return; }
        if (ed._act && ed._act.type === 'press' && ed._act.user) {
          clearTimer();
          dom.timer = setTimeout(() => { dom.timer = null; if (ed.longPress()) { try { if (root.navigator && navigator.vibrate) navigator.vibrate(12); } catch (err) { /* */ } } }, LONG_PRESS_MS);
        }
      });
      dom.on(canvas, 'pointermove', (e) => {
        const p = local(e);
        const pp = dom.pointers.get(e.pointerId);
        if (pp) { pp.sx = p.sx; pp.sy = p.sy; }
        if (dom.pinch) {
          if (dom.pointers.size >= 2) {
            const pts = Array.from(dom.pointers.values()).slice(0, 2);
            const mx = (pts[0].sx + pts[1].sx) / 2, my = (pts[0].sy + pts[1].sy) / 2;
            const d = Math.max(1, hyp(pts[0].sx - pts[1].sx, pts[0].sy - pts[1].sy));
            const cam = ed._cam();
            cam.zoom = clamp(dom.pinch.z0 * (d / dom.pinch.d0), MIN_ZOOM, MAX_ZOOM);
            ed._placeWorldAt(mx, my, dom.pinch.anchor);
          }
          return;
        }
        if (dom.ignoreTouch && e.pointerType === 'touch') return;
        if (dom.pan) {
          if (hyp(p.sx - dom.pan.sx, p.sy - dom.pan.sy) > DRAG_PX) dom.pan.moved = true;
          ed._placeWorldAt(p.sx, p.sy, dom.pan.anchor);
          return;
        }
        if (dom.right) {
          if (hyp(p.sx - dom.right.sx, p.sy - dom.right.sy) > DRAG_PX) { startPan(dom.right.sx, dom.right.sy); dom.pan.moved = true; dom.right = null; ed._placeWorldAt(p.sx, p.sy, dom.pan.anchor); }
          return;
        }
        if (dom.timer && ed._act && ed._act.type === 'press') {
          const w0 = ed._act;
          const s0 = ed._w2s(w0.sx, w0.sy);
          if (s0 && hyp(p.sx - s0.x, p.sy - s0.y) > DRAG_PX * (e.pointerType === 'touch' ? 2 : 1)) clearTimer();
        }
        const w = ed._s2w(p.sx, p.sy);
        ed.pointerMove(w.x, w.y, mods(e));
      });
      const up = (e, cancelled) => {
        const p = local(e);
        dom.pointers.delete(e.pointerId);
        try { if (canvas.releasePointerCapture) canvas.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        clearTimer();
        if (dom.pinch) { if (dom.pointers.size < 2) dom.pinch = null; if (!dom.pointers.size) dom.ignoreTouch = false; return; }
        if (dom.ignoreTouch && e.pointerType === 'touch') { if (!dom.pointers.size) dom.ignoreTouch = false; return; }
        const w = ed._s2w(p.sx, p.sy);
        if (dom.pan) {
          const click = dom.pan.click && !dom.pan.moved;
          dom.pan = null;
          dom.updateCursor();
          if (click && !cancelled) ed._emptyClick(w.x, w.y, mods(e));
          return;
        }
        if (dom.right) { dom.right = null; if (!cancelled) ed.rightClick(w.x, w.y, mods(e)); return; }
        if (cancelled) { ed.pointerCancel(); return; }
        ed.pointerUp(w.x, w.y, mods(e));
      };
      dom.on(canvas, 'pointerup', (e) => up(e, false));
      dom.on(canvas, 'pointercancel', (e) => up(e, true));
      dom.on(canvas, 'pointerleave', (e) => {
        if (e.pointerType !== 'mouse' || dom.pointers.size) return;
        ed._cursor = null; ed._refresh();
      });
      dom.on(canvas, 'contextmenu', (e) => { if (e.preventDefault) e.preventDefault(); });
      dom.on(canvas, 'wheel', (e) => {
        if (e.preventDefault) e.preventDefault();
        const p = local(e);
        let dy = e.deltaY || 0;
        if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= 400;
        const f = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015));
        ed.zoomAt(p.sx, p.sy, f);
        const w = ed._s2w(p.sx, p.sy);
        ed.pointerMove(w.x, w.y, mods(e));
      }, { passive: false });

      const typing = (e) => {
        const t = e.target;
        if (!t) return false;
        const tag = (t.tagName || '').toLowerCase();
        return tag === 'input' || tag === 'textarea' || tag === 'select' || !!t.isContentEditable;
      };
      dom.on(win, 'keydown', (e) => {
        if (typing(e) || e.defaultPrevented) return;
        const k = e.key;
        if (k === ' ' || k === 'Spacebar' || e.code === 'Space') {
          if (!ed._editable()) return;
          if (e.preventDefault) e.preventDefault();
          if (!e.repeat) { dom.space = true; dom.spaceUsed = false; dom.spaceState = ed._gameState(); dom.updateCursor(); }
          return;
        }
        // camera keys
        const cam = ed._cam();
        const W = canvas.clientWidth || canvas.width || 800, H = canvas.clientHeight || canvas.height || 600;
        if (!e.ctrlKey && !e.metaKey) {
          if (k === '+' || k === '=') { ed.zoomAt(W / 2, H / 2, 1.2); if (e.preventDefault) e.preventDefault(); return; }
          if (k === '-' || k === '_') { ed.zoomAt(W / 2, H / 2, 1 / 1.2); if (e.preventDefault) e.preventDefault(); return; }
          const pan = { ArrowLeft: [-60, 0], ArrowRight: [60, 0], ArrowUp: [0, -60], ArrowDown: [0, 60] }[k];
          if (pan && cam) {
            const target = ed._s2w(W / 2 + pan[0], H / 2 + pan[1]);
            ed._placeWorldAt(W / 2, H / 2, target);
            if (e.preventDefault) e.preventDefault();
            return;
          }
          if ((k === 'f' || k === 'F' || k === 'Home') && ed._renderer() && typeof ed._renderer().fitToLevel === 'function') { ed._renderer().fitToLevel(); return; }
        }
        const used = ed.keyDown(k, { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, repeat: e.repeat });
        if (used && e.preventDefault) e.preventDefault();
      });
      dom.on(win, 'keyup', (e) => {
        const k = e.key;
        if (k === ' ' || k === 'Spacebar' || e.code === 'Space') {
          const wasHeld = dom.space;
          dom.space = false;
          dom.updateCursor();
          if (!wasHeld || dom.spaceUsed || typing(e)) return;
          // only fire Test if nobody else already reacted to this Space press
          if (ed._gameState() === dom.spaceState && ed._editable()) ed._test();
        }
      });
      dom.on(win, 'blur', () => { dom.space = false; dom.pan = null; dom.right = null; clearTimer(); });
      dom.updateCursor();
      return this;
    }

    detach() {
      const dom = this._dom;
      if (!dom) return this;
      if (dom.timer) clearTimeout(dom.timer);
      for (const [t, type, fn, o] of dom.listeners) { try { t.removeEventListener(type, fn, o); } catch (e) { /* ignore */ } }
      this._dom = null;
      this._cancelAct();
      this._cursor = null;
      this._refresh();
      return this;
    }

    _gameState() { const g = this.game || {}; return g.state != null ? g.state : g.mode; }
    _test() {
      const g = this.game || {};
      for (const fn of ['toggleTest', 'startTest', 'test', 'startSim']) {
        if (typeof g[fn] === 'function') { try { g[fn](); } catch (e) { if (root.console) console.error(e); } return true; }
      }
      return false;
    }
    // click on empty space (build tool, left button, no drag): ends chain
    _emptyClick(x, y, o) {
      if (this._tool === 'build' && this.chainFrom) { this.chainFrom = null; this._refresh(o); }
    }

    // ---------------------------------------------------------------- camera helpers
    _cam() {
      const r = this._renderer();
      return (r && r.camera) || this._ownCam;
    }
    _viewSize() {
      const c = this._dom && this._dom.canvas;
      return { w: (c && (c.clientWidth || c.width)) || 800, h: (c && (c.clientHeight || c.height)) || 600 };
    }
    _s2w(sx, sy) {
      const r = this._renderer();
      if (r && typeof r.screenToWorld === 'function') {
        try {
          const p = r.screenToWorld(sx, sy);
          if (p) return Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y };
        } catch (e) { /* fall through */ }
      }
      const cam = this._ownCam, v = this._viewSize();
      return { x: cam.x + (sx - v.w / 2) / cam.zoom, y: cam.y - (sy - v.h / 2) / cam.zoom };
    }
    _w2s(x, y) {
      const r = this._renderer();
      if (r && typeof r.worldToScreen === 'function') {
        try { const p = r.worldToScreen(x, y); if (p) return Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y }; } catch (e) { /* fall through */ }
      }
      const cam = this._ownCam, v = this._viewSize();
      return { x: (x - cam.x) * cam.zoom + v.w / 2, y: (cam.y - y) * cam.zoom + v.h / 2 };
    }
    // move the camera so that world point `target` sits under screen point (sx,sy).
    // Works for any linear camera convention: the camera→world derivative is probed numerically.
    _placeWorldAt(sx, sy, target) {
      const cam = this._cam();
      if (!cam) return;
      for (let pass = 0; pass < 2; pass++) {
        for (const ax of ['x', 'y']) {
          if (typeof cam[ax] !== 'number') continue;
          const w0 = this._s2w(sx, sy);
          const step = 1;
          cam[ax] += step;
          const w1 = this._s2w(sx, sy);
          cam[ax] -= step;
          let der = (w1[ax] - w0[ax]) / step;
          // renderer caches its transform per frame → assume camera.{x,y} is the world point at screen centre
          if (Math.abs(der) < 1e-12) der = 1;
          cam[ax] += (target[ax] - w0[ax]) / der;
        }
      }
      cam.manual = true;
      const r = this._renderer();
      if (r && typeof r.onCameraChanged === 'function') { try { r.onCameraChanged(); } catch (e) { /* ignore */ } }
    }
    zoomAt(sx, sy, factor) {
      const cam = this._cam();
      if (!cam || !(factor > 0)) return;
      const w = this._s2w(sx, sy);
      cam.zoom = clamp((cam.zoom || 30) * factor, MIN_ZOOM, MAX_ZOOM);
      this._placeWorldAt(sx, sy, w);
    }
  }

  Editor.MAGNET = MAGNET;
  Editor.MIN_LEN = MIN_LEN;
  Editor.LONG_PRESS_MS = LONG_PRESS_MS;
  BG.Editor = Editor;
})(typeof window !== 'undefined' ? window : globalThis);
