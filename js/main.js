// BG.Game — state machine (title → levelSelect → edit ⇄ sim → results) + main loop.
// Every dependency on other modules is guarded so the shell still runs if one is missing.
(function (root) {
  'use strict';
  const BG = (root.BG = root.BG || {});
  const STEP = 1 / 60;
  const MAX_STEPS_PER_FRAME = 10;
  const TOGGLE_GUARD_MS = 380;
  const DERAIL_SLOWMO = 0.5;   // s (real time) of slow motion when a train first derails
  const DERAIL_SLOW = 0.08;    // sim speed during it
  const DERAIL_EASE = 0.35;    // s to ease back to the chosen speed

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function nowMs() { return root.performance ? performance.now() : Date.now(); }
  function safe(fn, fallback) { try { return fn(); } catch (e) { console.error(e); return fallback; } }
  function sfx(name, o) { if (BG.Audio) safe(() => BG.Audio.play(name, o)); }
  function hud() { return BG.Hud || null; }
  function hudCall(name) {
    const H = BG.Hud;
    const args = Array.prototype.slice.call(arguments, 1);
    if (H && typeof H[name] === 'function') return safe(() => H[name].apply(H, args));
    return undefined;
  }
  function levels() { return Array.isArray(BG.Levels) ? BG.Levels : []; }
  function levelId(lv) { if (!lv) return null; if (lv.id != null) return lv.id; const i = levels().indexOf(lv); return i >= 0 ? i + 1 : null; }
  function emptyDesign() {
    if (BG.Model && BG.Model.emptyDesign) { const d = safe(() => BG.Model.emptyDesign()); if (d) return d; }
    return { nodes: [], beams: [], piers: [] };
  }
  function cloneDesign(d) {
    if (BG.Model && BG.Model.clone) { const c = safe(() => BG.Model.clone(d)); if (c) return c; }
    return JSON.parse(JSON.stringify(d));
  }
  function materialDef(id) {
    const M = BG.Materials && BG.Materials[id];
    if (M) return M;
    return BG.Hud && BG.Hud.material ? BG.Hud.material(id) : { id, name: id, costPerMeter: 0 };
  }
  function vehicleName(type) {
    const V = BG.Vehicles && BG.Vehicles[type];
    return (V && V.name) || ({ car: 'car', van: 'van', bus: 'bus', truck: 'truck', semi: 'semi-trailer', tanker: 'tanker', heavy: 'heavy hauler' }[type] || 'vehicle');
  }
  // name of a sim vehicle entry (road vehicle or train)
  function simVehicleName(v) {
    if (!v) return 'vehicle';
    if (v.kind === 'train' || v.type === 'train') {
      const T = BG.Trains && v.preset && BG.Trains[typeof v.preset === 'string' ? v.preset : v.preset.id];
      const nm = (T && T.name) || (v.preset && v.preset.name) || 'train';
      return /train|tram|handcar|express|local|freight|commuter/i.test(nm) ? nm : nm + ' train';
    }
    return vehicleName(v.type);
  }
  function isTrain(v) { return !!v && (v.kind === 'train' || v.type === 'train'); }
  // campaigns (Roads incl. the bonus chapter, Iron Road, Famous Bridges): the rules live in ONE table,
  // BG.Storage.CAMPAIGNS (unlock gate, finale ids, playable levels); the level select tabs in BG.Hud
  const CAMPAIGN_ORDER = ['road', 'rail', 'famous'];
  function campaignOf(lv) {
    if (BG.Storage && BG.Storage.campaignOf) return BG.Storage.campaignOf(lv);
    return lv && lv.campaign && lv.campaign !== 'road' ? lv.campaign : 'road';
  }
  function campaignOrder() { return (BG.Storage && BG.Storage.CAMPAIGN_ORDER) || CAMPAIGN_ORDER; }
  function campaignLevels(campaign) {
    if (BG.Storage && BG.Storage.campaignLevels) return BG.Storage.campaignLevels(levels(), campaign);
    return levels().filter(l => campaignOf(l) === campaign).sort((a, b) => a.id - b.id);
  }
  // the list a level unlocks along and Next follows: its campaign's main line, or its branching bonus chapter
  // (Anchorages, 54-58: BG.Storage.CAMPAIGNS.road.bonus)
  function unlockList(lv) {
    if (BG.Storage && BG.Storage.unlockList) return BG.Storage.unlockList(levels(), lv);
    return campaignLevels(campaignOf(lv));
  }
  // the branching bonus chapters ({id, name, first, last, unlockAfter}) of every campaign
  function bonusChapters() {
    const C = (BG.Storage && BG.Storage.CAMPAIGNS) || {};
    const out = [];
    campaignOrder().forEach(c => { (C[c] && C[c].bonus || []).forEach(b => out.push(b)); });
    return out;
  }
  // which finale a passed level ends ('road' after 50, 'bonus' after 53, 'anchorages' after 58, 'rail' after 120,
  // 'famous' after 212), or null
  function finaleOf(lv) {
    if (!lv || !BG.Storage || !BG.Storage.finaleOf) return null;
    return BG.Storage.finaleOf(lv);
  }
  function campaignOpen(campaign) {
    return !BG.Storage || !BG.Storage.isCampaignUnlocked || !!safe(() => BG.Storage.isCampaignUnlocked(campaign), true);
  }
  // a railway level: the Iron Road, or any level whose traffic includes a train (e.g. the Forth Bridge, 205)
  function isRailLevel(lv) {
    return !!lv && (campaignOf(lv) === 'rail' || (Array.isArray(lv.traffic) && lv.traffic.some(g => g && g.type === 'train')));
  }
  function gapOf(lv) { const t = lv && lv.terrain; return t ? (t.rightEdge - t.leftEdge) : 0; }
  function railMaterial(id) { const m = BG.Materials && BG.Materials[id]; return !!(m ? m.isRail : id === 'rail'); }
  // which horn a train sounds: steam whistle, diesel horn, high-speed chime, tram bell (or none)
  function hornFor(v) {
    const T = BG.Trains && v.preset && BG.Trains[typeof v.preset === 'string' ? v.preset : v.preset.id];
    const cars = (T && T.cars) || (v.cars || []).map(c => c.type);
    const has = t => cars.indexOf(t) >= 0;
    if (has('hs_power')) return 'chime';
    if (has('loco_steam')) return 'whistle';
    if (has('loco_diesel')) return 'diesel';
    if (has('tram')) return 'bell';
    return null;
  }
  function tractionFor(v) {
    const h = hornFor(v);
    return h === 'whistle' ? 'steam' : h === 'diesel' ? 'diesel' : h === 'chime' ? 'electric' : h === 'bell' ? 'electric' : 'none';
  }
  function allNodes(level, design) {
    if (BG.Model && BG.Model.allNodes) { const n = safe(() => BG.Model.allNodes(level, design)); if (n) return n; }
    const out = [];
    (level.anchors || []).forEach((a, i) => out.push({ id: 'a' + i, x: a.x, y: a.y, fixed: true }));
    (design.piers || []).forEach((p, i) => out.push({ id: 'p' + i, x: p.x, y: p.topY, fixed: true }));
    (design.nodes || []).forEach(n => out.push({ id: n.id, x: n.x, y: n.y, fixed: false }));
    return out;
  }
  function beamLength(level, design, beam, nodeMap) {
    if (BG.Model && BG.Model.beamLength) { const l = safe(() => BG.Model.beamLength(level, design, beam)); if (l != null && isFinite(l)) return l; }
    const map = nodeMap || indexNodes(allNodes(level, design));
    const a = map[beam.a], b = map[beam.b];
    return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
  }
  function indexNodes(list) { const m = {}; list.forEach(n => { m[n.id] = n; }); return m; }
  function fallbackCost(level, design) {
    const map = indexNodes(allNodes(level, design));
    let beams = 0;
    design.beams.forEach(b => { beams += beamLength(level, design, b, map) * (+materialDef(b.m).costPerMeter || 0); });
    const C = BG.Costs || { pierBase: 1000, pierPerMeter: 250 };
    const floorY = level.terrain ? level.terrain.floorY : 0;
    let piers = 0;
    (design.piers || []).forEach(p => { piers += (C.pierBase || 0) + (C.pierPerMeter || 0) * Math.max(0, p.topY - floorY); });
    return { total: Math.round(beams + piers), beams: Math.round(beams), piers: Math.round(piers) };
  }
  function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy || 1e-9;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1);
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  }
  function fmtLen(m) { return (Math.round(m * 100) / 100).toFixed(m < 10 ? 2 : 1) + ' m'; }
  function money(n) { return BG.Hud && BG.Hud.money ? BG.Hud.money(n) : '$' + Math.round(n); }

  // ------------------------------------------------------------------ demo scene (title)
  const DEMO_LEVEL = {
    id: 0, name: 'Demo', hint: '', theme: 'meadow',
    terrain: { leftEdge: 0, leftY: 0, rightEdge: 24, rightY: 0, floorY: -9, waterY: -6 },
    anchors: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 0, y: -3 }, { x: 24, y: -3 }],
    pierZones: [], maxPiers: 0, noBuild: [], buildArea: { x0: -2, x1: 26, y0: -8, y1: 12 },
    materials: ['road', 'steel', 'wood'], budget: 1e6,
    traffic: [{ type: 'car', count: 2, interval: 2.2 }, { type: 'van', count: 1, interval: 2.6 }, { type: 'car', count: 2, interval: 2.0 }, { type: 'bus', count: 1, interval: 3 }, { type: 'car', count: 2, interval: 2.2 }],
    timeLimit: 80, templates: false,
  };
  function demoDesign() {
    // Pratt through-truss, steel, 4 m panels.
    const nodes = [], beams = [];
    for (let i = 1; i <= 5; i++) nodes.push({ id: 'n' + i, x: i * 4, y: 0 });
    for (let i = 1; i <= 5; i++) nodes.push({ id: 'n' + (i + 5), x: i * 4, y: 4 });
    const deck = ['a0', 'n1', 'n2', 'n3', 'n4', 'n5', 'a1'];
    for (let i = 0; i < deck.length - 1; i++) beams.push({ a: deck[i], b: deck[i + 1], m: 'road' });
    const top = ['n6', 'n7', 'n8', 'n9', 'n10'];
    for (let i = 0; i < top.length - 1; i++) beams.push({ a: top[i], b: top[i + 1], m: 'steel' });
    for (let i = 0; i < 5; i++) beams.push({ a: 'n' + (i + 1), b: top[i], m: 'steel' });
    beams.push({ a: 'a0', b: 'n6', m: 'steel' }, { a: 'n10', b: 'a1', m: 'steel' });
    beams.push({ a: 'n6', b: 'n2', m: 'steel' }, { a: 'n7', b: 'n3', m: 'steel' }, { a: 'n9', b: 'n3', m: 'steel' }, { a: 'n10', b: 'n4', m: 'steel' });
    // under-deck struts to the lower anchors
    beams.push({ a: 'a2', b: 'n1', m: 'steel' }, { a: 'a3', b: 'n5', m: 'steel' });
    return { nodes, beams, piers: [] };
  }

  // ------------------------------------------------------------------ fallback renderer
  // Used only if BG.Renderer is not available, so the shell is still testable and playable.
  function FallbackRenderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = { x: 0, y: 0, zoom: 20 };
    this.level = null;
    this.t = 0;
  }
  FallbackRenderer.prototype = {
    resize() {
      const dpr = root.devicePixelRatio || 1;
      const w = this.canvas.clientWidth || root.innerWidth, hh = this.canvas.clientHeight || root.innerHeight;
      this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(hh * dpr);
      this.dpr = dpr; this.w = w; this.h = hh;
    },
    setLevel(level) { this.level = level; this.fitToLevel(); },
    fitToLevel() {
      if (!this.w) this.resize();
      const lv = this.level; if (!lv) return;
      const t = lv.terrain;
      const span = (t.rightEdge - t.leftEdge) + 24;
      this.camera.zoom = Math.min(this.w / span, (this.h * 0.7) / Math.max(12, (lv.buildArea ? lv.buildArea.y1 - Math.min(lv.buildArea.y0, t.floorY) : 20) + 6));
      this.camera.x = (t.leftEdge + t.rightEdge) / 2;
      this.camera.y = ((lv.buildArea ? lv.buildArea.y1 : 8) + t.floorY) / 2;
    },
    worldToScreen(x, y) { return { x: this.w / 2 + (x - this.camera.x) * this.camera.zoom, y: this.h / 2 - (y - this.camera.y) * this.camera.zoom }; },
    screenToWorld(px, py) { return { x: this.camera.x + (px - this.w / 2) / this.camera.zoom, y: this.camera.y - (py - this.h / 2) / this.camera.zoom }; },
    render(o) {
      const c = this.ctx, lv = o.level || this.level;
      if (!this.w || this.canvas.width !== Math.round((this.canvas.clientWidth || root.innerWidth) * (root.devicePixelRatio || 1))) this.resize();
      this.t += o.dt || 0.016;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const th = (BG.Hud && BG.Hud.theme) ? BG.Hud.theme(lv && lv.theme) : { sky: ['#8fd3f4', '#d8f3ff'], ground: '#5aa35a', deep: '#3d7a44', water: '#3d9bd6' };
      const g = c.createLinearGradient(0, 0, 0, this.h);
      g.addColorStop(0, th.sky[0]); g.addColorStop(1, th.sky[1]);
      c.fillStyle = g; c.fillRect(0, 0, this.w, this.h);
      // hills
      for (let k = 0; k < 2; k++) {
        c.fillStyle = k ? th.deep : th.ground; c.globalAlpha = k ? 0.25 : 0.18;
        c.beginPath(); c.moveTo(0, this.h);
        for (let x = 0; x <= this.w; x += 20) c.lineTo(x, this.h * (0.55 + k * 0.08) + Math.sin(x * 0.004 + k * 2 + this.camera.x * 0.01) * 40 + Math.sin(x * 0.011 + k) * 14);
        c.lineTo(this.w, this.h); c.fill();
      }
      c.globalAlpha = 1;
      if (!lv) return;
      const t = lv.terrain, W = (x, y) => this.worldToScreen(x, y), z = this.camera.zoom;
      const fl = W(0, t.floorY).y;
      if (t.waterY != null) {
        const wy = W(0, t.waterY).y;
        c.fillStyle = th.water; c.globalAlpha = 0.9; c.fillRect(0, wy + Math.sin(this.t * 1.5) * 1.5, this.w, this.h); c.globalAlpha = 1;
      }
      c.fillStyle = th.ground;
      const L = W(t.leftEdge, t.leftY), R = W(t.rightEdge, t.rightY);
      c.beginPath(); c.moveTo(0, L.y); c.lineTo(L.x, L.y); c.lineTo(L.x + z * 1.5, fl); c.lineTo(R.x - z * 1.5, fl); c.lineTo(R.x, R.y); c.lineTo(this.w, R.y); c.lineTo(this.w, this.h); c.lineTo(0, this.h); c.fill();
      if (t.waterY != null) { const wy = W(0, t.waterY).y; c.fillStyle = th.water; c.globalAlpha = 0.75; c.fillRect(L.x, wy, R.x - L.x, fl - wy); c.globalAlpha = 1; }
      c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(0, L.y, L.x, 3); c.fillRect(R.x, R.y, this.w - R.x, 3);
      if (o.mode === 'edit' && o.showGrid !== false) {
        c.strokeStyle = 'rgba(255,255,255,.12)'; c.lineWidth = 1;
        const ba = lv.buildArea || { x0: t.leftEdge, x1: t.rightEdge, y0: t.floorY, y1: 10 };
        const p0 = W(ba.x0, ba.y1), p1 = W(ba.x1, ba.y0);
        c.beginPath();
        for (let x = Math.ceil(ba.x0); x <= ba.x1; x++) { const p = W(x, 0).x; c.moveTo(p, p0.y); c.lineTo(p, p1.y); }
        for (let y = Math.ceil(ba.y0); y <= ba.y1; y++) { const p = W(0, y).y; c.moveTo(p0.x, p); c.lineTo(p1.x, p); }
        c.stroke();
        c.strokeStyle = 'rgba(255,255,255,.35)'; c.setLineDash([6, 6]); c.strokeRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y); c.setLineDash([]);
      }
      // beams
      const sim = o.mode !== 'edit' ? o.sim : null;
      let nodes, beams;
      if (sim && sim.nodes) { nodes = sim.nodes; beams = sim.beams.map(b => ({ a: nodes[b.a], b: nodes[b.b], m: b.m, s: o.peakView ? b.peak : b.stress, broken: b.broken })); }
      else { const map = indexNodes(allNodes(lv, o.design || { nodes: [], beams: [], piers: [] })); nodes = Object.values(map); beams = (o.design ? o.design.beams : []).map(b => ({ a: map[b.a], b: map[b.b], m: b.m })); }
      (o.design && o.design.piers || []).forEach(p => { const a = W(p.x - 0.6, p.topY), b = W(p.x + 0.6, t.floorY); c.fillStyle = '#9aa0a8'; c.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); });
      beams.forEach(b => {
        if (!b.a || !b.b || b.broken) return;
        const m = materialDef(b.m);
        const A = W(b.a.x, b.a.y), B = W(b.b.x, b.b.y);
        c.strokeStyle = (o.showStress && b.s != null) ? (BG.Hud ? BG.Hud.stressColor(Math.abs(b.s)) : '#f00') : (m.color || '#999');
        c.lineWidth = Math.max(2, (m.isRoad ? 0.45 : m.tensionOnly ? 0.08 : 0.25) * z);
        c.lineCap = 'round';
        c.beginPath(); c.moveTo(A.x, A.y); c.lineTo(B.x, B.y); c.stroke();
      });
      nodes.forEach(n => { const p = W(n.x, n.y); c.fillStyle = n.fixed ? '#d6d0c4' : '#fff'; c.strokeStyle = '#333'; c.lineWidth = 1.5; c.beginPath(); c.arc(p.x, p.y, n.fixed ? 5 : 3.5, 0, Math.PI * 2); c.fill(); c.stroke(); });
      if (sim && sim.vehicles) sim.vehicles.forEach(v => {
        if (v.state === 'waiting') return;
        const d = v.def || {}; const len = d.length || 4, ht = d.height || 1.5;
        c.save(); const p = W(v.x, v.y); c.translate(p.x, p.y); c.rotate(-(v.angle || 0));
        c.fillStyle = d.color || '#e63946'; c.fillRect(-len * z / 2, -ht * z, len * z, ht * z * 0.8); c.restore();
        (v.wheels || []).forEach(w => { const q = W(w.x, w.y); c.fillStyle = '#222'; c.beginPath(); c.arc(q.x, q.y, (w.r || 0.35) * z, 0, Math.PI * 2); c.fill(); });
      });
      const es = o.editorState;
      if (es && es.ghost) {
        const A = W(es.ghost.x1, es.ghost.y1), B = W(es.ghost.x2, es.ghost.y2);
        c.strokeStyle = es.ghost.valid ? 'rgba(255,255,255,.8)' : 'rgba(255,80,80,.9)'; c.lineWidth = 3; c.setLineDash([8, 6]);
        c.beginPath(); c.moveTo(A.x, A.y); c.lineTo(B.x, B.y); c.stroke(); c.setLineDash([]);
      }
    },
  };

  // ------------------------------------------------------------------ the game
  const Game = {
    state: 'boot',          // 'title' | 'levelSelect' | 'edit' | 'sim' | 'results'
    level: null,
    design: null,
    editor: null,
    renderer: null,
    effects: null,
    sim: null,
    speed: 1,
    paused: false,
    settings: null,
    canvas: null,
    pointer: { x: 0, y: 0, inside: false, down: false },
    lastResult: null,
    _acc: 0,
    _endTimer: 0,
    _lastToggle: -1e9,
    _demo: null,
    _saveTimer: 0,
    _lastSaved: null,
    _counts: null,
    _quietCounts: false,
    _lastTs: 0,

    init() {
      if (this._inited) return;
      this._inited = true;
      this.settings = BG.Storage ? BG.Storage.getSettings() : { volume: 0.7, muted: false, showStress: true, showGrid: true };
      // unlock rules v2 (chapter finales are gates): levels a returning player already had open stay open
      if (BG.Storage && BG.Storage.migrateUnlocks) safe(() => BG.Storage.migrateUnlocks(levels()));
      if (BG.Audio) { BG.Audio.setVolume(this.settings.volume); BG.Audio.setMuted(!!this.settings.muted); }
      this.canvas = document.getElementById('game-canvas');
      if (!this.canvas) { this.canvas = document.createElement('canvas'); this.canvas.id = 'game-canvas'; document.body.prepend(this.canvas); }

      // renderer (guarded)
      if (typeof BG.Renderer === 'function') this.renderer = safe(() => new BG.Renderer(this.canvas), null);
      if (!this.renderer) { this.renderer = new FallbackRenderer(this.canvas); this.usingFallbackRenderer = true; }
      // BG.Effects is a shared-instance facade (static methods); main feeds it events and update(dt).
      this._resize();
      root.addEventListener('resize', () => this._resize());

      this.audio = BG.Audio || null;
      this.hud = BG.Hud || null;
      hudCall('init', this);
      this._bindInput();
      this._bindAudioUnlock();

      // URL helpers for testing: ?level=N  ?screen=levels  ?unlockall
      let params = null;
      try { params = new URLSearchParams(root.location.search); } catch (e) { /* */ }
      if (params && params.has('unlockall') && BG.Storage) BG.Storage.set('unlockAll', true);
      const lvParam = params && params.get('level');
      if (lvParam && this.findLevel(+lvParam)) this.openLevel(+lvParam, { force: true });
      else if (params && params.get('screen') === 'levels') this.goLevelSelect();
      else this.goTitle();

      this._lastTs = nowMs();
      const loop = ts => { this._frame(ts); root.requestAnimationFrame(loop); };
      root.requestAnimationFrame(loop);
    },

    _resize() {
      const r = this.renderer;
      if (r && typeof r.resize === 'function') safe(() => r.resize());
      else if (this.canvas) {
        const dpr = root.devicePixelRatio || 1;
        this.canvas.width = Math.round(root.innerWidth * dpr);
        this.canvas.height = Math.round(root.innerHeight * dpr);
      }
      if ((this.state === 'title' || this.state === 'levelSelect') && r && r.fitToLevel) this._fitDemo();
    },

    // ---------------------------------------------------------------- level helpers
    findLevel(id) {
      const L = levels();
      return L.find(l => l && l.id === id) || (L[id - 1] && L[id - 1].id == null ? L[id - 1] : null);
    },
    levelIndex(lv) { return levels().indexOf(lv || this.level); },
    isUnlocked(id) {
      if (!BG.Storage) return true;
      return safe(() => BG.Storage.isUnlocked(id, levels()), id === 1);
    },
    continueTarget() {
      const L = levels();
      if (!L.length) return null;
      const S = BG.Storage;
      if (!S) return L[0];
      const prog = S.getProgress();
      // the last played level if unfinished; else the first unlocked, uncompleted level of the campaign
      // the player was last in (Roads, Iron Road or Famous Bridges); else of the Roads (the Iron Road after the Roads);
      // else last played; else first.
      const last = prog.lastLevel != null ? this.findLevel(prog.lastLevel) : null;
      if (last && !S.isCompleted(levelId(last))) return last;
      const camp = campaignOf(last);
      const open = list => list.find(l => this.isUnlocked(levelId(l)) && !S.isCompleted(levelId(l)));
      let firstOpen = open(campaignLevels(camp));
      for (const c of campaignOrder()) { if (firstOpen) break; if (c !== camp) firstOpen = open(campaignLevels(c)); }
      return firstOpen || last || L[0];
    },
    campaignOf(lv) { return campaignOf(lv || this.level); },
    // next playable level in the same campaign (Roads 1-53, Iron Road 101-120, Famous Bridges 201-212), or null at the end;
    // inside a branching bonus chapter (Anchorages 54-58) the next level of that chapter
    nextInCampaign(lv) {
      lv = lv || this.level;
      if (!lv) return null;
      const list = unlockList(lv);
      const i = list.indexOf(lv);
      if (i >= 0) return list[i + 1] || null;
      const all = levels();
      const nx = all[this.levelIndex(lv) + 1];
      return nx && campaignOf(nx) === campaignOf(lv) ? nx : null;
    },

    // ---------------------------------------------------------------- state transitions
    _setState(s) {
      this.state = s;
      document.body.dataset.state = s;
    },
    goTitle() {
      this._leaveLevel();
      this._setState('title');
      this._startDemo();
      hudCall('showScreen', 'title');
    },
    goLevelSelect() {
      this._leaveLevel();
      const wasLevel = !!this.level;
      this._setState('levelSelect');
      if (!this._demo) this._startDemo();
      // open the campaign tab of the level just played (or last played)
      let lastId = this._lastLevelId;
      if (lastId == null && BG.Storage) lastId = safe(() => BG.Storage.getProgress().lastLevel, null);
      const lastLv = lastId != null ? this.findLevel(lastId) : null;
      if (lastLv) hudCall('setCampaignTab', campaignOf(lastLv), true);
      hudCall('showScreen', 'levelSelect');
      const focus = this._lastLevelId != null ? this._lastLevelId : null;
      if (focus != null && wasLevel !== null) hudCall('scrollToLevel', focus);
    },
    continueGame() {
      const t = this.continueTarget();
      if (t) this.openLevel(levelId(t)); else this.goLevelSelect();
    },
    goBack() {
      if (this.state === 'results') this.backToEdit();
      else if (this.state === 'sim') this.stopSim();
      else if (this.state === 'edit') this.goLevelSelect();
      else if (this.state === 'levelSelect') this.goTitle();
    },

    openLevel(id, opts) {
      const lv = this.findLevel(id);
      if (!lv) { hudCall('toast', 'Level ' + id + ' is not available yet.', 'info'); return false; }
      if (!(opts && opts.force) && !this.isUnlocked(levelId(lv))) {
        sfx('error');
        const shut = BG.Storage && BG.Storage.lockText ? safe(() => BG.Storage.lockText(levelId(lv), levels()), null)
          : BG.Storage && BG.Storage.campaignLockText ? safe(() => BG.Storage.campaignLockText(campaignOf(lv)), null) : null;
        hudCall('toast', shut || 'Complete the previous level first.', 'info');
        return false;
      }
      this._leaveLevel();
      this._stopDemo();
      this.level = lv;
      this._lastLevelId = levelId(lv);
      if (BG.Storage) safe(() => BG.Storage.setLastLevel(levelId(lv)));

      // restore last design (sanitised against the level's node ids)
      let d = BG.Storage ? safe(() => BG.Storage.loadDesign(levelId(lv)), null) : null;
      d = this._sanitize(lv, d) || emptyDesign();
      this.design = d;
      this._lastSaved = this._serialize(d);
      this._counts = this._countsOf(d);

      const r = this.renderer;
      if (r) {
        // keep the level framed clear of the HUD (top bar, tool rail, bottom dock)
        if (typeof r.setInsets === 'function') safe(() => r.setInsets({ top: 92, bottom: 126, left: 104, right: 36 }));
        safe(() => r.setLevel && r.setLevel(lv));
        safe(() => r.fitToLevel && r.fitToLevel());
      }
      this._fx('setLevel', lv);
      this._fx('clear');

      // editor (fresh per level)
      this.editor = null;
      if (typeof BG.Editor === 'function') {
        this.editor = safe(() => new BG.Editor(this), null);
        const ed = this.editor;
        if (ed) {
          if (typeof ed.load === 'function') safe(() => ed.load(d, lv));
          else {
            safe(() => { if (typeof ed.setLevel === 'function') ed.setLevel(lv); else ed.level = lv; });
            safe(() => { if (typeof ed.setDesign === 'function') ed.setDesign(d); else ed.design = d; });
          }
          if (!ed.material || (lv.materials && lv.materials.indexOf(ed.material) < 0)) safe(() => this.setMaterial(this._defaultMaterial(lv), true));
          if (!ed.tool) ed.tool = 'build';
          safe(() => ed.attach && ed.attach(this.canvas));
        }
      }
      this.sim = null;
      this.paused = false;
      this.speed = 1;
      // camera follow: on by default for long gaps, where vehicles are tiny; the player's toggle
      // sticks for the rest of this level
      this.followOn = gapOf(lv) > 60;
      // track recording strip: on by default on railway levels (key T)
      this.trackOn = isRailLevel(lv);
      this._applyFollow(false);
      this._setState('edit');
      hudCall('showScreen', 'level');
      hudCall('enterLevel', lv);
      hudCall('flash');
      sfx('whoosh');
      return true;
    },
    _defaultMaterial(lv) {
      const mats = (lv && lv.materials) || ['road'];
      return mats.indexOf('road') >= 0 ? 'road' : mats[0];
    },
    _leaveLevel() {
      if (!this.level) return;
      this._saveNow();
      if (this.editor) { safe(() => this.editor.detach && this.editor.detach()); }
      this.editor = null;
      this.sim = null;
      if (BG.Audio) BG.Audio.stopEngines();
      this._applyFollow(false);
      hudCall('hideResults');
      this.level = null;
    },
    _sanitize(lv, d) {
      if (!d || !Array.isArray(d.beams) || !Array.isArray(d.nodes)) return null;
      d.piers = Array.isArray(d.piers) ? d.piers : [];
      const ids = new Set(allNodes(lv, d).map(n => n.id));
      const before = d.beams.length;
      d.beams = d.beams.filter(b => ids.has(b.a) && ids.has(b.b) && b.a !== b.b);
      if (before !== d.beams.length) console.warn('[SPAN] dropped', before - d.beams.length, 'beams with unknown endpoints from saved design');
      return d;
    },

    // ---------------------------------------------------------------- design access
    getDesign() {
      const ed = this.editor;
      if (ed && ed.design) this.design = ed.design;
      return this.design || emptyDesign();
    },
    getCost() {
      if (!this.level) return 0;
      const d = this.getDesign();
      if (BG.Model && BG.Model.cost) {
        const c = safe(() => BG.Model.cost(this.level, d), null);
        if (c && c.total != null) return c.total;
      }
      return fallbackCost(this.level, d).total;
    },
    _serialize(d) {
      try { return BG.Model && BG.Model.serialize ? BG.Model.serialize(d) : JSON.stringify(d); } catch (e) { return null; }
    },
    _saveNow() {
      if (!this.level || !BG.Storage) return;
      const d = this.getDesign();
      const s = this._serialize(d);
      if (s && s !== this._lastSaved) { safe(() => BG.Storage.saveDesign(levelId(this.level), d)); this._lastSaved = s; }
    },
    _countsOf(d) { return { beams: d.beams.length, piers: (d.piers || []).length, nodes: d.nodes.length }; },
    _replaceDesign(d) {
      const ed = this.editor;
      if (ed) { if (typeof ed.setDesign === 'function') ed.setDesign(d); else ed.design = d; }
      this.design = d;
    },

    // ---------------------------------------------------------------- editor passthroughs
    setTool(t) {
      const ed = this.editor; if (!ed || this.state !== 'edit') return;
      if (typeof ed.setTool === 'function') ed.setTool(t); else ed.tool = t;
    },
    setMaterial(id, silent) {
      const ed = this.editor; if (!ed) return;
      if (typeof ed.setMaterial === 'function') ed.setMaterial(id); else ed.material = id;
      if (ed.tool !== 'build' && ed.tool !== 'select' && ed.tool !== 'arch') { if (typeof ed.setTool === 'function') ed.setTool('build'); else ed.tool = 'build'; } // arch-tool: the arch tool keeps its tool
    },
    toggleMirror() {
      const ed = this.editor; if (!ed) return;
      if (typeof ed.toggleMirror === 'function') ed.toggleMirror(); else ed.mirror = !ed.mirror;
      if (typeof ed.toggleMirror !== 'function') sfx('toggle', { on: !!ed.mirror });
      hudCall('toast', ed.mirror ? 'Mirror symmetry on' : 'Mirror symmetry off', 'info', 1400);
    },
    undo() { const ed = this.editor; if (ed && ed.undo && this.state === 'edit') { this._quietCounts = true; ed.undo(); } },
    redo() { const ed = this.editor; if (ed && ed.redo && this.state === 'edit') { this._quietCounts = true; ed.redo(); } },
    clearDesign() {
      const ed = this.editor; if (this.state !== 'edit') return;
      const d = this.getDesign();
      if (!d.beams.length && !d.nodes.length && !(d.piers || []).length) { sfx('error'); return; }
      this._quietCounts = true;
      if (ed && ed.clear) ed.clear(); else { this._replaceDesign(emptyDesign()); sfx('erase'); }
      hudCall('toast', 'Bridge cleared — Ctrl+Z to undo', 'info');
    },
    applyTemplate(id) {
      const ed = this.editor; if (!ed || this.state !== 'edit') return;
      this._quietCounts = true;
      if (ed.applyTemplate) {
        const ok = safe(() => ed.applyTemplate(id), false);
        if (ok === false) return;
        const t = BG.Templates && BG.Templates.list ? BG.Templates.list.find(x => x.id === id) : null;
        hudCall('toast', (t ? t.name : 'Template') + ' placed — tweak it to fit the budget', 'info');
      }
    },

    // ---------------------------------------------------------------- simulation
    _guard() {
      const t = nowMs();
      if (t - this._lastToggle < TOGGLE_GUARD_MS) return false;
      this._lastToggle = t;
      return true;
    },
    toggleTest() {
      if (this.state === 'edit') this.startSim();
      else if (this.state === 'sim' || this.state === 'results') this.stopSim();
    },
    test() { this.toggleTest(); },
    startTest() { this.startSim(); },
    stopTest() { this.stopSim(); },
    startSim() {
      if (this.state !== 'edit' || !this.level) return false;
      if (nowMs() - this._lastToggle < TOGGLE_GUARD_MS) return false;
      const lv = this.level;
      const d = this.getDesign();
      if (!d.beams.length) {
        sfx('error'); hudCall('toast', 'Nothing to test yet — drag from an anchor to build a road.', 'warn', 3200);
        return false;
      }
      if (BG.Model && BG.Model.validate) {
        const v = safe(() => BG.Model.validate(lv, d), null);
        if (v && v.ok === false && v.errors && v.errors.length) {
          sfx('error');
          hudCall('toast', 'Can\'t test yet: ' + (v.errors[0].msg || v.errors[0].type) + (v.errors.length > 1 ? ' (+' + (v.errors.length - 1) + ' more)' : ''), 'warn', 3600);
          return false;
        }
      }
      if (typeof BG.Simulation !== 'function') {
        sfx('error'); hudCall('toast', 'Physics engine not loaded.', 'warn'); return false;
      }
      const sim = safe(() => new BG.Simulation(lv, cloneDesign(d), { seed: 1 }), null);
      if (!sim) { sfx('error'); hudCall('toast', 'Simulation failed to start.', 'warn'); return false; }
      if (BG.Model && BG.Model.roadConnected && !safe(() => BG.Model.roadConnected(lv, d), true)) {
        hudCall('toast', 'Heads up: the road does not connect both banks yet, so traffic cannot make it across.', 'warn', 4200);
      }
      if (this.editor) { this.editor.chainFrom = null; safe(() => this.editor._refresh && this.editor._refresh()); }
      this._lastToggle = nowMs();
      this._saveNow();
      this.sim = sim;
      this._acc = 0;
      this._endTimer = 0;
      this.paused = false;
      if (this.editor) safe(() => this.editor.detach && this.editor.detach());
      this._fx('clear');
      this._setState('sim');
      this._trainAudio = {};
      this._derailFx = null;
      this._trackProf = null;
      this._trackRec = BG.RailInfo && sim.ride ? new BG.RailInfo.Recorder(sim) : null;
      hudCall('hideDerail');
      this._applyFollow(!!this.followOn);
      hudCall('setMode', 'sim');
      hudCall('hideResults');
      sfx('start');
      return true;
    },

    // ---------------------------------------------------------------- camera follow
    // The renderer owns the camera; it may expose follow(on) (preferred), setFollow(on) or a boolean
    // `follow` property. Everything is guarded so a renderer without follow support is fine.
    hasFollow() {
      const r = this.renderer;
      return !!(r && (typeof r.follow === 'function' || typeof r.setFollow === 'function' || typeof r.follow === 'boolean'));
    },
    _applyFollow(on) {
      const r = this.renderer;
      if (!r) return;
      const was = !!this._followApplied;
      this._followApplied = !!on;
      if (typeof r.follow === 'function') safe(() => r.follow(!!on));
      else if (typeof r.setFollow === 'function') safe(() => r.setFollow(!!on));
      else if (typeof r.follow === 'boolean') r.follow = !!on;
      // following moved the camera: frame the whole crossing again for editing
      if (was && !on && this.state === 'edit' && typeof r.fitToLevel === 'function') safe(() => r.fitToLevel());
    },
    toggleFollow() {
      if (!this.level) return;
      this.followOn = !this.followOn;
      if (this.state === 'sim' || this.state === 'results') this._applyFollow(this.followOn);
      sfx('toggle', { on: this.followOn });
      hudCall('toast', this.followOn ? 'Camera follows the traffic' : 'Camera follow off', 'info', 1400);
    },
    setFollow(on) { if (!!on !== !!this.followOn) this.toggleFollow(); },
    // ---------------------------------------------------------------- track recording strip (rail)
    hasTrack() { return isRailLevel(this.level); },
    toggleTrack() {
      if (!this.level || !this.hasTrack()) return;
      this.trackOn = !this.trackOn;
      sfx('toggle', { on: this.trackOn });
      hudCall('toast', this.trackOn ? 'Track recording on' : 'Track recording off', 'info', 1400);
    },
    /** what the HUD's track strip draws this frame (null = hidden) */
    getTrackStrip() {
      const sim = this.sim;
      if (!this.trackOn || !sim || !sim.ride || (this.state !== 'sim' && this.state !== 'results')) return null;
      const RI = BG.RailInfo;
      if (!RI) return null;
      const prof = this._trackProf || (this._trackProf = safe(() => RI.profile(sim), null));
      const fx = this._derailFx;
      return { sim, rec: this._trackRec, profile: prof, derail: fx && fx.info ? { x: fx.info.x } : null };
    },
    /** the derailment highlight for the renderer: offending wheel (live) + rail segment(s) */
    getDerailMarker() {
      const fx = this._derailFx, sim = this.sim;
      if (!fx || !sim) return null;
      const info = fx.info || {}, ev = fx.ev || {};
      let wx = info.x, wy = info.y;
      const v = sim.vehicles && sim.vehicles[ev.i];
      const c = v && v.cars && v.cars[ev.car];
      const w = c && c.wheels && fx.detail && c.wheels[fx.detail.wheel];
      if (w && isFinite(w.x) && isFinite(w.y)) { wx = w.x; wy = w.y; }
      return { x: wx, y: wy, r: w ? w.r : 0.45, seg: info.seg, segPrev: info.segPrev, age: fx.age || 0, reason: info.reason };
    },
    stopSim() {
      if (this.state !== 'sim' && this.state !== 'results') return;
      if (!this._guard()) return;
      this.backToEdit(true);
    },
    backToEdit(fromStop) {
      if (this.state !== 'sim' && this.state !== 'results') return;
      const last = this.sim;
      if (last && last.beams) {
        const d = this.getDesign();
        this._lastPeaks = { keys: d.beams.map(b => b.a + '|' + b.b + '|' + b.m), peaks: d.beams.map((b, i) => last.beams[i] ? { p: +last.beams[i].peak || 0, broken: !!last.beams[i].broken } : null) };
      }
      this.sim = null;
      this.paused = false;
      if (BG.Audio) BG.Audio.stopEngines();
      this._fx('clear');
      this._setState('edit');
      this._applyFollow(false);
      this._derailFx = null;
      hudCall('hideDerail');
      if (this.editor) { this.editor.chainFrom = null; safe(() => this.editor.attach && this.editor.attach(this.canvas)); }
      hudCall('hideResults');
      hudCall('setMode', 'edit');
      sfx('stop');
    },
    restartSim() {
      if (this.state !== 'sim' && this.state !== 'results') return;
      const sp = this.speed;
      this.sim = null;
      this._setState('edit');
      this._lastToggle = -1e9;
      if (this.startSim()) this.speed = sp;
      else {
        if (this.editor) safe(() => this.editor.attach && this.editor.attach(this.canvas));
        hudCall('hideResults');
        hudCall('setMode', 'edit');
      }
    },
    retry() { this.restartSim(); },
    togglePause() {
      if (this.state !== 'sim') return;
      this.paused = !this.paused;
      if (this.paused && BG.Audio) BG.Audio.stopEngines();
    },
    pause() { if (this.state === 'sim') { this.paused = true; if (BG.Audio) BG.Audio.stopEngines(); } },
    resume() { if (this.state === 'sim') this.paused = false; },
    stepOnce() {
      if (this.state !== 'sim' || !this.sim) return;
      if (!this.paused) this.paused = true;
      this._stepSim();
    },
    setSpeed(s) {
      const allowed = [0.25, 1, 2, 4, 8];
      this.speed = allowed.indexOf(+s) >= 0 ? +s : 1;
    },
    _stepSim() {
      const sim = this.sim;
      if (!sim) return;
      safe(() => sim.step());
      this._drainEvents(sim, true);
    },
    _drainEvents(sim, withAudio) {
      let evs = null;
      if (typeof sim.drainEvents === 'function') evs = safe(() => sim.drainEvents(), null);
      else if (Array.isArray(sim.events)) { evs = sim.events.slice(); sim.events.length = 0; }
      if (!evs || !evs.length) return;
      for (let i = 0; i < evs.length; i++) this._onSimEvent(evs[i], sim, withAudio);
    },
    _panFor(x, y) {
      const r = this.renderer;
      if (!r || !r.worldToScreen || x == null) return 0;
      const p = safe(() => r.worldToScreen(x, y), null);
      if (!p) return 0;
      return clamp((p.x / (root.innerWidth || 1)) * 2 - 1, -1, 1) * 0.8;
    },
    _onSimEvent(ev, sim, withAudio) {
      if (!ev || !ev.type) return;
      const handled = this._effect(ev, sim);
      const shake = a => { if (!handled) this._shake(a); };
      const pan = this._panFor(ev.x, ev.y);
      switch (ev.type) {
        case 'break': {
          let m = ev.m;
          if (!m && sim.beams && sim.beams[ev.beamIndex]) m = sim.beams[ev.beamIndex].m;
          if (withAudio) sfx('break', { material: m, pan });
          shake(m === 'steel' || m === 'cable' ? 0.7 : 0.5);
          break;
        }
        case 'splash':
          if (withAudio) sfx('splash', { size: ev.size || 1, pan });
          shake(Math.min(0.6, 0.2 + (ev.size || 1) * 0.15));
          break;
        case 'vehicle_finish': if (withAudio) sfx('finish'); break;
        case 'vehicle_fall': shake(0.35); break;
        case 'pylon_fail': // a land pylon topples (SPEC §17)
          if (withAudio) sfx('break', { material: 'masonry', pan });
          shake(0.7);
          break;
        case 'derail': {
          const v = sim.vehicles && sim.vehicles[ev.i];
          if (!this._derailFx && sim === this.sim && BG.RailInfo) {
            const car = v && v.cars ? v.cars[ev.car] : null;
            const info = safe(() => BG.RailInfo.explain(ev.detail, sim, this.level, this.getDesign(), car), null);
            this._derailFx = { t0: nowMs(), age: 0, ev, detail: ev.detail || null, info, fresh: true };
            if (info) hudCall('showDerail', info);
          }
          if (withAudio) sfx('derail', { pan, heavy: v ? clamp(this._trainMass(v) / 1.5e6, 0, 1) : 0.5 });
          shake(0.75);
          break;
        }
        case 'creak': {
          if (!withAudio) break;
          const b = sim.beams && sim.beams[ev.beamIndex];
          const n = b && sim.nodes ? sim.nodes[b.a] : null;
          sfx('creak', { stress: ev.stress, material: b && b.m, pan: n ? this._panFor(n.x, n.y) : 0 });
          break;
        }
        default: break;
      }
    },
    _effect(ev, sim) {
      const targets = [];
      const r = this.renderer;
      if (r && r.effects && typeof r.effects === 'object') targets.push(r.effects);
      if (this.effects) targets.push(this.effects);
      if (BG.Effects && (typeof BG.Effects === 'object' || typeof BG.Effects === 'function')) targets.push(BG.Effects);
      if (r && targets.indexOf(r) < 0) targets.push(r);
      const generic = ['handleSimEvent', 'onSimEvent', 'handleEvent', 'onEvent', 'simEvent'];
      const specific = {
        break: ['spawnBreak', 'beamBreak', 'onBreak', 'breakBeam', 'spawnDebris'],
        splash: ['spawnSplash', 'onSplash', 'splash'],
      }[ev.type] || [];
      for (const t of targets) {
        for (const n of generic) if (typeof t[n] === 'function') { safe(() => t[n](ev, sim)); return true; }
        for (const n of specific) if (typeof t[n] === 'function') {
          safe(() => ev.type === 'splash' ? t[n](ev.x, ev.y, ev.size || 1, ev) : t[n](ev, sim));
          return true;
        }
      }
      return false;
    },
    _fx(method) {
      const E = BG.Effects;
      const args = Array.prototype.slice.call(arguments, 1);
      if (E && typeof E[method] === 'function') return safe(() => E[method].apply(E, args));
      return undefined;
    },
    _shake(amount) {
      const r = this.renderer;
      const cands = [[r, 'shake'], [r, 'addShake'], [r && r.effects, 'shake'], [r && r.effects, 'addShake'], [this.effects, 'shake'], [BG.Effects, 'shake'], [BG.Effects, 'addShake']];
      for (const [o, n] of cands) if (o && typeof o[n] === 'function') { safe(() => o[n](amount)); return; }
    },

    // ---------------------------------------------------------------- train audio
    _trainMass(v) {
      let m = 0;
      (v.cars || []).forEach(c => {
        const d = c.def || (BG.RailCars && BG.RailCars[c.type]) || {};
        if (d.mass) m += d.mass;
        else (d.bogies || []).forEach(b => { m += +b.mass || 0; });
      });
      return m || 50000;
    },
    _leadCar(v) {
      let lead = null;
      (v.cars || []).forEach(c => { if (c && (lead == null || c.x > lead.x)) lead = c; });
      return lead || v;
    },
    // per-train sound state: speed from the lead car's motion in sim time, braking, horn on approach
    _trainSound(sim, v, i) {
      const st = this._trainAudio || (this._trainAudio = {});
      const lead = this._leadCar(v);
      const t = +sim.time || 0;
      let a = st[i];
      if (!a) a = st[i] = { x: lead.x, t, speed: 0, horned: false, mass: this._trainMass(v), horn: hornFor(v), traction: tractionFor(v) };
      const dts = t - a.t;
      let decel = 0;
      if (dts > 1e-4) {
        const vx = v.vx != null && isFinite(v.vx) ? Math.abs(v.vx) : Math.abs(lead.x - a.x) / dts;
        decel = (a.speed - vx) / dts;
        a.speed += (vx - a.speed) * Math.min(1, dts * 8);
        a.x = lead.x; a.t = t;
      }
      a.braking = decel > 1.0 && a.speed > 2 ? Math.min(1, decel / 3) : (a.braking || 0) * 0.9;
      if (v.state !== 'driving') return null;
      const pan = this._panFor(lead.x, lead.y);
      const lv = this.level;
      const edge = lv && lv.terrain ? lv.terrain.leftEdge : 0;
      if (!a.horned && a.horn && lead.x > edge - 22 && BG.Audio) {
        a.horned = true;
        safe(() => BG.Audio.play('horn', { kind: a.horn, pan }));
      }
      return { key: 'train' + i, traction: a.traction, speed: a.speed * Math.sqrt(this.speed), simSpeed: a.speed, timeScale: this.speed,
        braking: a.braking, pan, mass: a.mass, gain: this.speed < 1 ? 0.5 : 1 };
    },
    // clickety-clack: a tick whenever a wheel rolls over a rail joint (bridge joints of rail beams,
    // plus regular seams every 15 m on the banks)
    _railSeams(sim) {
      if (this._seams && this._seams.sim === sim) return this._seams.xs;
      const xs = [];
      const lv = this.level, t = (lv && lv.terrain) || { leftEdge: 0, rightEdge: 0 };
      (sim.beams || []).forEach(b => {
        if (!railMaterial(b.m)) return;
        const A = sim.nodes[b.a], B = sim.nodes[b.b];
        if (A) xs.push(A.x); if (B) xs.push(B.x);
      });
      for (let x = t.leftEdge - 15; x > t.leftEdge - 140; x -= 15) xs.push(x);
      for (let x = t.rightEdge + 15; x < t.rightEdge + 140; x += 15) xs.push(x);
      xs.sort((p, q) => p - q);
      const out = xs.filter((x, k) => k === 0 || x - xs[k - 1] > 0.3);
      this._seams = { sim, xs: out, wheels: {} };
      return out;
    },
    _clickety(sim) {
      if (!BG.Audio || !BG.Audio.trainTick) return;
      const seams = this._railSeams(sim);
      if (!seams.length) return;
      const prev = this._seams.wheels;
      const count = (lo, hi) => { // seams in (lo, hi]
        let n = 0;
        for (let k = 0; k < seams.length; k++) { if (seams[k] > hi) break; if (seams[k] > lo) n++; }
        return n;
      };
      (sim.vehicles || []).forEach((v, i) => {
        if (!isTrain(v) || v.state !== 'driving') return;
        const a = this._trainAudio && this._trainAudio[i];
        const speed = a ? a.speed : Math.abs(v.vx || 0);
        const heavy = a ? clamp(a.mass / 1.5e6, 0, 1) : 0.3;
        (v.cars || []).forEach((c, ci) => {
          if (!c || c.state === 'derailed') return;
          (c.wheels || []).forEach((w, wi) => {
            const key = i + ':' + ci + ':' + wi;
            const px = prev[key];
            prev[key] = w.x;
            if (px == null || w.x <= px) return;
            if (count(px, w.x) > 0) safe(() => BG.Audio.trainTick(speed, { pan: this._panFor(w.x, w.y), heavy, timeScale: this.speed }));
          });
        });
      });
    },

    _updateSim(dt) {
      const sim = this.sim;
      if (!sim) return;
      // freeze-frame: the first derailment drops to slow motion for half a second, then eases back
      const fz = this._derailFx;
      // (aged by frame dt, not the wall clock, so scripted/headless runs pass through it too)
      const fzAge = fz ? fz.age : Infinity;
      if (fz) fz.age += Math.min(0.1, dt || 0);
      let scale = this.speed;
      if (fzAge < DERAIL_SLOWMO) scale = Math.min(scale, DERAIL_SLOW);
      else if (fzAge < DERAIL_SLOWMO + DERAIL_EASE) scale = Math.min(scale, DERAIL_SLOW + (scale - DERAIL_SLOW) * (fzAge - DERAIL_SLOWMO) / DERAIL_EASE);
      this._simScale = scale;
      if (!this.paused) {
        this._acc += dt * scale;
        let n = 0;
        while (this._acc >= STEP && n < MAX_STEPS_PER_FRAME) {
          this._stepSim(); this._acc -= STEP; n++;
          // stop on the derailing step so the freeze-frame starts exactly there
          if (this._derailFx && this._derailFx.fresh) { this._derailFx.fresh = false; this._acc = 0; break; }
        }
        if (n >= MAX_STEPS_PER_FRAME) this._acc = 0;
      }
      if (this._trackRec && BG.RailInfo) {
        this._trackProf = safe(() => BG.RailInfo.profile(sim), null);
        if (this._trackProf && !this.paused) this._trackRec.sample(this._trackProf);
      }
      // engines (road vehicles) and trains
      if (BG.Audio) {
        if (this.paused) BG.Audio.stopEngines();
        else {
          const list = [], trains = [];
          (sim.vehicles || []).forEach((v, i) => {
            if (isTrain(v)) { const t = this._trainSound(sim, v, i); if (t) trains.push(t); return; }
            if (v.state !== 'driving') return;
            list.push({ key: i, mass: (v.def && v.def.mass) || 1500, speed: Math.abs(v.vx || 0) * Math.sqrt(this.speed), pan: this._panFor(v.x, v.y), gain: this.speed < 1 ? 0.5 : 1 });
          });
          BG.Audio.updateEngines(list);
          if (BG.Audio.updateTrains) safe(() => BG.Audio.updateTrains(trains));
          if (trains.length) this._clickety(sim);
        }
      }
      // end-of-run detection (keep simulating a little for the drama)
      const lv = this.level;
      let status = sim.status;
      if (status === 'running' && lv && lv.timeLimit && sim.time > lv.timeLimit + 3) status = 'failed';
      if (status && status !== 'running') {
        if (!this.paused && fzAge > DERAIL_SLOWMO + DERAIL_EASE) this._endTimer += dt * Math.max(0.5, this.speed);
        if (this._endTimer > (status === 'success' ? 1.1 : 2.2)) this._finishRun(status);
      }
    },
    _finishRun(status) {
      const sim = this.sim, lv = this.level;
      if (!sim || !lv) return;
      if (BG.Audio) BG.Audio.stopEngines();
      // the run is over: let the steam / exhaust plume dissolve instead of hanging behind the results
      safe(() => { const E = (this.renderer && this.renderer.effects) || this.effects || BG.Effects; if (E && E.fadeSmoke) E.fadeSmoke(0.7); });
      const sum = (typeof sim.summary === 'function' ? safe(() => sim.summary(), null) : null) || {};
      const vehicles = sim.vehicles || [];
      const vt = sum.vehiclesTotal != null ? sum.vehiclesTotal : vehicles.length;
      const vf = sum.vehiclesFinished != null ? sum.vehiclesFinished : vehicles.filter(v => v.state === 'finished').length;
      const cost = this.getCost();
      const budget = +lv.budget || 0;
      const simOk = (sum.status || status) === 'success';
      const budgetOk = cost <= budget;
      const passed = simOk && budgetOk;
      let peak = sum.peakStress;
      if (peak == null && sim.beams) peak = sim.beams.reduce((m, b) => Math.max(m, b.peak || 0), 0);
      const broken = sum.brokenBeams != null ? sum.brokenBeams : (sim.beams || []).filter(b => b.broken).length;
      let stars = passed ? (cost <= budget * 0.7 ? 3 : cost <= budget * 0.85 ? 2 : 1) : 0;
      // Iron Road: the third star also needs the "Structure held" verdict (no member broke)
      const starHeld = stars === 3 && isRailLevel(lv) && broken > 0;
      if (starHeld) stars = 2;
      const reason = sim.failReason || (status === 'failed' && sim.status === 'running' ? 'timeout' : null);

      let title, text;
      if (passed) {
        title = stars === 3 ? 'Flawless engineering!' : stars === 2 ? 'Solid bridge!' : 'Bridge passed!';
        const noun = vehicles.length && vehicles.every(isTrain) ? 'train' : 'vehicle';
        text = (vt === 1 ? 'The ' + noun + ' crossed' : 'All ' + vt + ' ' + noun + 's crossed') + ' safely. ';
        if (stars === 3) text += 'Under 70% of budget — elegant and efficient.';
        else if (starHeld) text += 'Under 70% of budget, but ' + broken + ' member' + (broken === 1 ? '' : 's') + ' broke: on the railway the third star also needs the structure to hold.';
        else if (stars === 2) text += 'Get the cost under ' + money(budget * 0.7) + ' for the third star.';
        else text += 'Get under ' + money(budget * 0.85) + ' for another star.';
      } else if (simOk) {
        title = 'Over budget';
        text = 'Everything made it across, but the bridge is ' + money(cost - budget) + ' over budget. Trim some material and test again.';
      } else if (reason === 'derailed') {
        const lim = Object.assign({}, BG.RailRules || { maxGrade: 0.06, maxKinkDeg: 4 }, sim.railRules || lv.rail || {});
        const dt = vehicles.find(v => isTrain(v) && (v.state === 'derailed' || (v.cars || []).some(c => c && c.state === 'derailed')));
        const what = dt ? simVehicleName(dt) : 'train';
        const info = this._derailFx && this._derailFx.info;
        title = broken > 0 ? 'Derailed — and the bridge gave way!' : 'Derailed!';
        // a broken rail is explained by the first-break line appended below
        if (info && info.cause) text = info.cause + (info.at === 'broken' && (sum.firstBreak || sim.firstBreak) ? '' : ' ' + (info.advice || ''));
        else {
          text = 'The ' + what.toLowerCase() + ' came off the rails. Trains are far fussier than cars: keep the track grade under ' +
            Math.round(lim.maxGrade * 1000) / 10 + '% and the bend between rail segments under ' + lim.maxKinkDeg + '°. ' +
            (broken > 0 ? 'A broken or missing rail under a wheel derails it instantly — check the red members.' : 'Stiffen the deck so it sags less under the load, and avoid sharp kinks at the bridge ends.');
        }
      } else if (reason === 'vehicle_fell') {
        const fell = vehicles.find(v => v.state === 'fallen' || (isTrain(v) && (v.cars || []).some(c => c && c.state === 'fallen')));
        const what = (fell ? simVehicleName(fell) : 'vehicle').toLowerCase();
        const where = lv.terrain && lv.terrain.waterY != null ? 'into the water' : 'into the valley';
        title = broken > 0 ? 'Collapse!' : 'Off the edge!';
        text = (/^[aeiou]/.test(what) ? 'An ' : 'A ') + what + ' fell ' + where + '. ' + (broken > 0 ? broken + ' beam' + (broken === 1 ? '' : 's') + ' snapped — check the red members on the stress map.' : 'Make sure the road reaches all the way across, without gaps or steep steps.');
      } else if (reason === 'vehicle_jumped') {
        title = 'No jumping!';
        text = 'A vehicle flew across instead of driving. The road has to run continuously from bank to bank and carry the traffic all the way.';
      } else if (reason === 'stalled') {
        title = 'Traffic stuck';
        text = 'Every vehicle came to a stop on the bridge. Is the deck too steep, too bumpy, or sagging into a dip they cannot climb out of?';
      } else if (reason === 'timeout') {
        title = 'Out of time';
        text = 'Only ' + vf + ' of ' + vt + ' vehicles made it across in ' + (lv.timeLimit || Math.round(sim.time)) + ' s. Is the deck too steep, or sagging so much that traffic gets stuck?';
      } else {
        title = 'Bridge failed';
        text = 'Not every vehicle made it across. Strengthen the overloaded members and try again.';
      }

      // what gave way first, and why (teaches reading the stress map)
      const fb = sum.firstBreak || sim.firstBreak;
      const ft = sum.firstTopple || sim.firstTopple; // §17 a land pylon overturned its footing
      if (!passed && !simOk && ft && (!fb || ft.time <= fb.time)) {
        text += ' A land pylon toppled first: its footing could not hold the pull of its stays. Guy it back with backstays to an inland anchor behind it.';
      } else if (!passed && !simOk && fb) {
        const mname = (materialDef(fb.m).name || fb.m).toLowerCase();
        const kN = Math.round(Math.abs(fb.force || 0) / 1000);
        let why;
        if (fb.mode === 'bending') why = 'The ' + mname + ' deck bent too far at a joint - ' + (railMaterial(fb.m) ? 'track' : 'road') + ' needs a supported joint (a strut, hanger or chord below it) about every 5-6 m.';
        else if (fb.mode === 'compression') why = 'The first beam to fail was ' + mname + ' crushed in compression (' + kN + ' kN). Shorten it, double it up, or use a stronger material.';
        else why = 'The first beam to fail was ' + mname + ' pulled apart in tension (' + kN + ' kN). Share the load with more members or use a stronger material.';
        text += ' ' + why;
      }

      let rec = { entry: null, improved: false };
      const S = BG.Storage;
      // campaigns this result opens (the Iron Road after level 10, Famous Bridges after 15)
      const wasOpen = {};
      campaignOrder().forEach(c => { wasOpen[c] = campaignOpen(c); });
      // levels of this campaign that were locked before the run (to spot ones this result opens by skipping)
      const campList = unlockList(lv);
      // branching bonus chapters this result opens (Anchorages after level 40)
      const bonusFirst = b => levels().find(l => l && l.id === b.first);
      const bonusWasShut = bonusChapters().filter(b => bonusFirst(b) && !this.isUnlocked(b.first));
      const inCampaign = campList.indexOf(lv) >= 0;
      const wasLocked = inCampaign && passed ? campList.filter(l => !this.isUnlocked(levelId(l))) : [];
      if (S) rec = safe(() => S.recordResult(levelId(lv), { passed, stars, cost }), rec) || rec;
      const opened = campaignOrder().filter(c => !wasOpen[c] && campaignOpen(c) && campaignLevels(c).length > 0);
      const bonusOpened = bonusWasShut.filter(b => this.isUnlocked(b.first));
      // a level opened although the one right before it is unfinished: the player may skip one level
      const skipOpened = wasLocked.filter(l => {
        const i = campList.indexOf(l), prev = campList[i - 1];
        return i > 0 && this.isUnlocked(levelId(l)) && !!S && !S.isCompleted(levelId(prev));
      });
      const next = this.nextInCampaign(lv);
      const campaign = campaignOf(lv);
      const res = {
        passed, stars, cost, budget, title, reasonText: text, simOk, reason,
        time: sum.time != null ? sum.time : sim.time, peakStress: peak, vehiclesFinished: vf, vehiclesTotal: vt,
        brokenBeams: broken, hasNext: !!next, improved: !!rec.improved, best: rec.entry, firstBreak: fb || null,
        finale: passed && !!finaleOf(lv), finaleKind: passed ? finaleOf(lv) : null, campaign,
        railUnlocked: opened.includes('rail'), campaignsOpened: opened, skipUnlocked: skipOpened.map(levelId),
        bonusOpened: bonusOpened.map(b => b.id),
        rail: BG.RailInfo && sim.ride ? safe(() => BG.RailInfo.rideCard(sim, sum), null) : null,
        derail: this._derailFx && this._derailFx.info ? this._derailFx.info : null,
      };
      this.lastResult = res;
      this._setState('results');
      hudCall('setMode', 'results');
      hudCall('showResults', res);
      sfx(passed ? 'success' : 'fail');
      // a newly opened campaign gets a toast once the stars have landed
      const OPEN_TOAST = { rail: 'The Iron Road is open! Railway bridges await on the level select.', famous: 'Famous Bridges is open! Rebuild real bridges from history on the level select.' };
      opened.forEach((c, i) => setTimeout(() => {
        if (this.state !== 'results') return;
        hudCall('toast', OPEN_TOAST[c] || 'A new campaign is open on the level select.', 'good', 5200);
        if (c === 'rail') sfx('horn', { kind: 'whistle' });
      }, 1500 + i * 1800));
      // a hidden bonus chapter revealed by this result (Anchorages after level 40)
      bonusOpened.forEach((b, i) => setTimeout(() => {
        if (this.state !== 'results') return;
        hudCall('toast', 'A hidden chapter has opened: ' + b.name + ' (levels ' + b.first + '–' + b.last + ') on the level select.', 'good', 5200);
      }, 1500 + (opened.length + i) * 1800));
      // explain the unlock rule the moment it lets the player skip ahead
      skipOpened.forEach((l, i) => setTimeout(() => {
        if (this.state !== 'results') return;
        hudCall('toast', this.skipUnlockText(l), 'info', 5200);
      }, 1500 + (opened.length + bonusOpened.length + i) * 1800));
    },
    // "Level 13 unlocked - you can skip one level (chapter finales can't be skipped)"
    skipUnlockText(lv) {
      const H = BG.Hud;
      const camp = campaignOf(lv);
      const name = H && H.shortLabel ? safe(() => H.shortLabel(lv), null) : null;
      const unit = camp === 'famous' ? 'bridge' : 'level';
      const fin = camp === 'rail' ? 'line finales' : camp === 'famous' ? 'the finale' : 'chapter finales';
      return (name || 'Level ' + levelId(lv)) + ' unlocked — you can skip one ' + unit + ' (' + fin + ' can\'t be skipped)';
    },
    nextLevel() {
      const next = this.nextInCampaign(this.level);
      if (next) this.openLevel(levelId(next));
      else this.goLevelSelect();
    },

    // ---------------------------------------------------------------- settings
    setSetting(key, value) {
      this.settings = this.settings || {};
      this.settings[key] = value;
      if (BG.Storage) safe(() => BG.Storage.setSettings({ [key]: value }));
      if (key === 'volume' && BG.Audio) BG.Audio.setVolume(value);
      if (key === 'muted' && BG.Audio) BG.Audio.setMuted(value);
      if (key === 'showGrid' && this.renderer) this.renderer.showGrid = !!value;
      hudCall('applySettings');
    },
    resetProgress() {
      if (!BG.Storage) return;
      BG.Storage.resetProgress();
      levels().forEach(l => BG.Storage.clearDesign(levelId(l)));
      if (this.state === 'levelSelect') hudCall('buildLevelSelect');
      if (this.state === 'title') hudCall('refreshTitle');
    },
    sfx(name, o) { sfx(name, o); },
    playSound(name, o) { sfx(name, o); },
    toast(msg, kind) { hudCall('toast', msg, kind); },

    // ---------------------------------------------------------------- hover tooltip data
    getHoverInfo() {
      const p = this.pointer;
      if (!p.inside || !this.level) return null;
      const r = this.renderer;
      const ed = this.editor;
      if (this.state === 'edit') {
        if (!ed || !ed.state) return null;
        const st = ed.state;
        if (st.dragFrom || st.ghost) return null;
        let hb = st.hoverBeam;
        const d = this.getDesign();
        let beam = null;
        if (typeof hb === 'number') beam = d.beams[hb];
        else if (hb && typeof hb === 'object') beam = hb.a != null ? hb : (hb.index != null ? d.beams[hb.index] : null);
        if (!beam && st.hoverBeamObj) beam = st.hoverBeamObj;
        if (!beam && !st.hoverNode && !st.chainFrom && !st.moving && r && r.screenToWorld) {
          // editor only reports hovered beams for erase/select tools: hit-test ourselves for the tooltip
          const rect = this.canvas.getBoundingClientRect();
          const w = safe(() => r.screenToWorld(p.x - rect.left, p.y - rect.top), null);
          if (w) {
            const map = indexNodes(allNodes(this.level, d));
            const thr = 7 / ((r.camera && r.camera.zoom) || 20);
            let bd = thr;
            d.beams.forEach(b => {
              const A = map[b.a], B = map[b.b];
              if (!A || !B) return;
              const dd = distToSeg(w.x, w.y, A.x, A.y, B.x, B.y);
              if (dd < bd) { bd = dd; beam = b; }
            });
          }
        }
        if (!beam) return null;
        const m = materialDef(beam.m);
        const len = beamLength(this.level, d, beam);
        const rows = [['Length', fmtLen(len) + ' / ' + (m.maxLength || '?') + ' m'], ['Cost', money(len * (m.costPerMeter || 0))]];
        if (m.tensionOnly) rows.push(['Type', 'Tension only']);
        else if (m.isRoad) rows.push(['Type', 'Road deck']);
        const lp = this._lastPeaks, bi = d.beams.indexOf(beam);
        if (lp && bi >= 0 && lp.keys[bi] === beam.a + '|' + beam.b + '|' + beam.m && lp.peaks[bi]) {
          const q = lp.peaks[bi];
          rows.push(['Last test', q.broken ? 'broke' : 'peak ' + Math.round(q.p * 100) + '%', q.broken || q.p >= 0.9 ? 'bad' : q.p >= 0.7 ? 'warn' : 'good']);
        }
        return { x: p.x, y: p.y, title: m.name || beam.m, color: m.color, rows };
      }
      if ((this.state === 'sim' || this.state === 'results') && this.sim && r && r.screenToWorld) {
        const sim = this.sim;
        if (!sim.beams || !sim.nodes) return null;
        const rect = this.canvas.getBoundingClientRect();
        const w = safe(() => r.screenToWorld(p.x - rect.left, p.y - rect.top), null);
        if (!w) return null;
        const zoom = (r.camera && r.camera.zoom) || 20;
        const thr = 10 / zoom;
        let best = -1, bd = thr;
        for (let i = 0; i < sim.beams.length; i++) {
          const b = sim.beams[i];
          if (b.broken || b.fragment) continue;
          const A = sim.nodes[b.a], B = sim.nodes[b.b];
          if (!A || !B) continue;
          const dd = distToSeg(w.x, w.y, A.x, A.y, B.x, B.y);
          if (dd < bd) { bd = dd; best = i; }
        }
        if (best < 0) return null;
        const b = sim.beams[best];
        const m = b.material || materialDef(b.m);
        const f = +b.force || 0;
        const kind = Math.abs(f) < 1 ? '' : f > 0 ? ' tension' : ' compression';
        const s = Math.abs(+b.stress || 0), pk = +b.peak || 0;
        const rows = [
          ['Length', fmtLen(b.restLength || 0)],
          ['Force', (Math.abs(f) / 1000).toFixed(1) + ' kN' + kind],
          ['Stress', Math.round(s * 100) + '%', s >= 0.9 ? 'bad' : s >= 0.7 ? 'warn' : 'good'],
          ['Peak', Math.round(pk * 100) + '%', pk >= 0.9 ? 'bad' : pk >= 0.7 ? 'warn' : ''],
        ];
        if (b.bend != null) {
          const bd = Math.abs(+b.bend || 0);
          rows.splice(3, 0, ['of which bending', Math.round(bd * 100) + '%', bd >= 0.5 ? 'warn' : '']);
        }
        return { x: p.x, y: p.y, title: (m && m.name) || b.m, color: m && m.color, rows, stress: this.state === 'results' ? pk : s, peak: pk };
      }
      return null;
    },

    // ---------------------------------------------------------------- demo scene
    _startDemo() {
      const r = this.renderer;
      this._demo = { level: DEMO_LEVEL, design: demoDesign(), sim: null, t: 0, acc: 0 };
      if (r) { safe(() => r.setLevel && r.setLevel(DEMO_LEVEL)); this._fitDemo(); }
      this._newDemoSim();
    },
    _fitDemo() {
      const r = this.renderer;
      if (!r || !this._demo) return;
      safe(() => r.fitToLevel && r.fitToLevel());
      // place the demo bridge in the lower part of the screen, under the logo & buttons
      const cam = r.camera;
      if (!cam || typeof r.worldToScreen !== 'function') return;
      const W = root.innerWidth, H = root.innerHeight;
      const t = DEMO_LEVEL.terrain;
      const cx = (t.leftEdge + t.rightEdge) / 2;
      safe(() => {
        if (cam.zoom) cam.zoom = Math.min(cam.zoom * (W / H > 1.5 ? 0.92 : 1), (H * (H < 760 ? 0.095 : 0.125)) / 4.5);
        for (let it = 0; it < 2; it++) {
          ['x', 'y'].forEach(ax => {
            const want = ax === 'x' ? W * 0.5 : H * (H < 760 ? 0.82 : 0.84);
            const p0 = r.worldToScreen(cx, 0)[ax];
            cam[ax] += 1;
            const p1 = r.worldToScreen(cx, 0)[ax];
            const d = p1 - p0;
            cam[ax] -= 1;
            if (Math.abs(d) > 1e-6) cam[ax] += (want - p0) / d;
          });
        }
      });
    },
    _newDemoSim() {
      const dm = this._demo;
      if (!dm) return;
      dm.sim = null; dm.t = 0; dm.acc = 0; dm.end = 0;
      if (typeof BG.Simulation === 'function' && BG.Materials && BG.Vehicles) {
        dm.sim = safe(() => new BG.Simulation(DEMO_LEVEL, cloneDesign(dm.design), { seed: 7 }), null);
      }
    },
    _stopDemo() { this._demo = null; },
    _updateDemo(dt) {
      const dm = this._demo;
      if (!dm) return;
      dm.t += dt;
      const sim = dm.sim;
      if (!sim) return;
      dm.acc += dt;
      let n = 0;
      while (dm.acc >= STEP && n < 4) { safe(() => sim.step()); this._drainEvents(sim, false); dm.acc -= STEP; n++; }
      if (n >= 4) dm.acc = 0;
      if (sim.status !== 'running' || sim.time > 75) {
        dm.end += dt;
        if (dm.end > 1.5) this._newDemoSim();
      }
    },

    // ---------------------------------------------------------------- frame
    _frame(ts) {
      let dt = (ts - this._lastTs) / 1000;
      this._lastTs = ts;
      if (!(dt > 0)) dt = 0;
      dt = Math.min(dt, 0.1);
      const st = this.state;
      if (st === 'title' || st === 'levelSelect') this._updateDemo(dt);
      else if (st === 'sim') this._updateSim(dt);
      else if (st === 'edit') this._watchDesign(dt);

      if (!(st === 'sim' && this.paused)) this._fx('update', st === 'sim' ? dt * this.speed : dt);
      this._render(dt);
      hudCall('update', dt);
    },
    _watchDesign(dt) {
      // placement / erasure sounds only when there is no editor to play them
      const d = this.getDesign();
      const c = this._countsOf(d);
      const p = this._counts;
      if (p && !this._quietCounts && !this.editor) {
        if (c.beams > p.beams) {
          const last = d.beams[d.beams.length - 1];
          sfx('place', { material: last && last.m });
        } else if (c.piers > p.piers) sfx('pier');
        else if (c.beams < p.beams || c.piers < p.piers || c.nodes < p.nodes) sfx('erase');
      }
      this._quietCounts = false;
      this._counts = c;
      // autosave (throttled)
      this._saveTimer += dt;
      if (this._saveTimer > 0.6) { this._saveTimer = 0; this._saveNow(); }
    },
    _render(dt) {
      const r = this.renderer;
      if (!r || typeof r.render !== 'function') return;
      const st = this.state;
      const s = this.settings || {};
      let opts;
      if (st === 'title' || st === 'levelSelect' || st === 'boot') {
        const dm = this._demo;
        if (!dm) return;
        opts = { mode: dm.sim ? 'sim' : 'edit', level: dm.level, design: dm.design, sim: dm.sim, editorState: null, dt, showStress: false, peakView: false, showGrid: false, demo: true };
      } else if (this.level) {
        const mode = st === 'results' ? 'results' : st === 'sim' ? 'sim' : 'edit';
        opts = {
          mode, level: this.level, design: this.getDesign(), sim: mode === 'edit' ? null : this.sim,
          editorState: this.editor ? this.editor.state : null, dt,
          showStress: s.showStress !== false, peakView: mode === 'results', showGrid: s.showGrid !== false,
          undeformed: mode === 'results' && !!safe(() => { const H = hud(); return H && H.resultsInspecting && H.resultsInspecting(); }, false),
          paused: this.paused, timeScale: mode === 'sim' ? (this._simScale != null ? this._simScale : this.speed) : 1,
          derail: mode === 'edit' ? null : safe(() => this.getDerailMarker(), null),
        };
      } else return;
      if (this.effects) opts.effects = this.effects;
      safe(() => r.render(opts));
    },

    // ---------------------------------------------------------------- input
    _bindInput() {
      const c = this.canvas;
      const track = e => { this.pointer.x = e.clientX; this.pointer.y = e.clientY; this.pointer.inside = true; };
      c.addEventListener('pointermove', e => { track(e); if (this._spaceDown) this._spaceMoved = true; });
      c.addEventListener('pointerdown', e => { track(e); this.pointer.down = true; if (this._spaceDown) this._spaceMoved = true; });
      root.addEventListener('pointerup', () => { this.pointer.down = false; });
      c.addEventListener('pointerleave', () => { this.pointer.inside = false; });
      c.addEventListener('contextmenu', e => e.preventDefault());
      // capture phase: runs before the editor's own handlers so we can inspect its state first
      root.addEventListener('keydown', e => this._onKeyDown(e), true);
      root.addEventListener('keyup', e => this._onKeyUp(e), true);
      root.addEventListener('blur', () => { this._spaceDown = false; });
      document.addEventListener('visibilitychange', () => { if (document.hidden) this._saveNow(); });
      root.addEventListener('beforeunload', () => this._saveNow());
    },
    _editorBusy() {
      const ed = this.editor;
      if (!ed || !ed.state) return false;
      const s = ed.state;
      const sel = s.selection;
      const selCount = !sel ? 0 : Array.isArray(sel) ? sel.length : ((sel.nodes || []).length + (sel.beams || []).length);
      return !!(ed._act || s.dragFrom || s.chainFrom || ed.chainFrom || s.moving || selCount || (ed.tool && ed.tool !== 'build'));
    },
    _onKeyDown(e) {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range') return;
      const H = hud();
      const key = e.key;
      if (H && H.settingsOpen && H.settingsOpen()) {
        if (key === 'Escape') { e.preventDefault(); e.stopPropagation(); H.closeSettings(); }
        return;
      }
      const st = this.state;
      if (key === ' ' || e.code === 'Space') {
        // in edit mode the editor owns Space (tap = Test via game.toggleTest, hold + drag = pan)
        if (st === 'edit' && this.editor && this.editor.attach) return;
        e.preventDefault();
        if (e.repeat) return;
        if (st === 'edit') { this._spaceDown = true; this._spaceMoved = this.pointer.down; this._spaceAt = nowMs(); }
        else if (st === 'sim' || st === 'results') this.stopSim();
        else if (st === 'title') this.goLevelSelect();
        return;
      }
      if (key === 'Escape') {
        if (H && H.templatesOpen && H.templatesOpen()) { H.closeTemplates(); e.stopPropagation(); return; }
        if (st === 'results' && H && H.resultsInspecting && H.resultsInspecting()) { H.setInspecting(false); return; }
        if (st === 'edit' && this._editorBusy()) return; // let the editor cancel its drag/chain
        this.goBack();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = key.length === 1 ? key.toLowerCase() : key;
      if (st === 'sim' || st === 'results') {
        if (k === 'r') { e.preventDefault(); this.restartSim(); }
        else if (k === 'f') { e.preventDefault(); this.toggleFollow(); }
        else if (k === 't') { e.preventDefault(); this.toggleTrack(); }
        else if (st === 'sim' && k === 'p') this.togglePause();
        else if (st === 'sim' && (k === '.' || k === 'n')) this.stepOnce();
        else if (st === 'sim' && (k === '-' || k === '_')) { const S = [0.25, 1, 2, 4, 8]; this.setSpeed(S[Math.max(0, S.indexOf(this.speed) - 1)]); }
        else if (st === 'sim' && (k === '=' || k === '+')) { const S = [0.25, 1, 2, 4, 8]; this.setSpeed(S[Math.min(S.length - 1, S.indexOf(this.speed) + 1)]); }
        else if (st === 'results' && key === 'Enter') { if (this.lastResult && this.lastResult.passed) { if (this.lastResult.hasNext) this.nextLevel(); else this.goLevelSelect(); } else this.backToEdit(); }
        return;
      }
      if (st === 'edit' && !this.editor) {
        if (/^[1-9]$/.test(k)) {
          const mats = (this.level && this.level.materials) || [];
          const id = mats[+k - 1];
          if (id) { this.setMaterial(id); sfx('click'); }
        } else if (k === 'b') { this.setTool('build'); }
      }
      if (st === 'edit') {
        if (k === 'h' && this.level && this.level.hint) { hudCall('showHint'); }
      }
      if (st === 'levelSelect' && key === 'Enter') this.continueGame();
      if (st === 'title' && key === 'Enter') this.goLevelSelect();
    },
    _onKeyUp(e) {
      if (e.key === ' ' || e.code === 'Space') {
        if (!this._spaceDown) return;
        this._spaceDown = false;
        e.preventDefault();
        const held = nowMs() - (this._spaceAt || 0);
        // a quick tap tests; holding Space + dragging pans (editor), so don't test then
        if (this.state === 'edit' && held < 450 && !this._spaceMoved) this.startSim();
      }
    },
    _bindAudioUnlock() {
      const unlock = () => {
        if (!BG.Audio) return;
        BG.Audio.unlock();
        BG.Audio.startAmbient();
        const ctx = BG.Audio.context;
        if (ctx && ctx.state === 'running') {
          root.removeEventListener('pointerdown', unlock, true);
          root.removeEventListener('keydown', unlock, true);
          root.removeEventListener('touchend', unlock, true);
        }
      };
      root.addEventListener('pointerdown', unlock, true);
      root.addEventListener('keydown', unlock, true);
      root.addEventListener('touchend', unlock, true);
    },
  };

  Game.DEMO_LEVEL = DEMO_LEVEL;
  Game.FallbackRenderer = FallbackRenderer;
  BG.Game = Game;

  function boot() { safe(() => Game.init()); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
